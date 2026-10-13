"""Retained storage for original receiving programmes using the native worker.

The caller owns its work directory. Native capacity, runtime consumers and
restorable cache retirement remain the existing Commons implementations.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import time


CHUNK = 1024 * 1024


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def file_identity(path):
    path = Path(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Select an original regular file: " + str(path))
        h = hashlib.sha256()
        for chunk in iter(lambda: source.read(CHUNK), b""):
            h.update(chunk)
        after = os.fstat(source.fileno())
    current = path.lstat()
    fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
    if (not stat.S_ISREG(current.st_mode)
            or any(getattr(before, key) != getattr(after, key)
                   or getattr(after, key) != getattr(current, key) for key in fields)):
        raise ValueError("The selected file changed during reading: " + str(path))
    return {"path": str(path.resolve()), "bytes": after.st_size, "sha256": h.hexdigest()}


def sync_directory(directory):
    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def private(directory):
    directory = Path(directory)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = directory.lstat()
    if (not stat.S_ISDIR(info.st_mode) or directory.is_symlink()
            or info.st_uid != os.getuid() or info.st_mode & 0o077
            or directory.resolve() != directory):
        raise ValueError("Use the original private receiving directory: " + str(directory))
    return directory


@contextmanager
def publication(destination, *, replace=False):
    """Write a complete temporary file, then expose it atomically."""
    destination = Path(destination)
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix="." + destination.name + ".", suffix=".pending",
                                dir=destination.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        yield temporary
        with temporary.open("rb") as stream:
            os.fsync(stream.fileno())
        if replace:
            if destination.is_symlink():
                raise ValueError("The original receiving record became a link")
            os.replace(temporary, destination)
        else:
            try:
                os.link(temporary, destination, follow_symlinks=False)
            except FileExistsError:
                actual, expected = file_identity(destination), file_identity(temporary)
                if any(actual[key] != expected[key] for key in ("bytes", "sha256")):
                    raise ValueError("The original retained destination differs: " + str(destination))
        sync_directory(destination.parent)
    finally:
        temporary.unlink(missing_ok=True)


def save_bytes(path, body, *, replace=False):
    with publication(path, replace=replace) as temporary:
        with temporary.open("wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())


def save_json(path, value, *, replace=False):
    save_bytes(path, canonical(value), replace=replace)


def copy_file(source, destination, *, expected=None):
    source = Path(source)
    before = file_identity(source)
    if expected and any(before[key] != expected[key] for key in ("bytes", "sha256")):
        raise ValueError("The selected source bytes differ before staging")
    with publication(destination) as temporary:
        h = hashlib.sha256()
        size = 0
        with source.open("rb") as incoming, temporary.open("wb") as outgoing:
            for chunk in iter(lambda: incoming.read(CHUNK), b""):
                outgoing.write(chunk)
                h.update(chunk)
                size += len(chunk)
            outgoing.flush()
            os.fsync(outgoing.fileno())
        after = file_identity(source)
        if (size != before["bytes"] or h.hexdigest() != before["sha256"]
                or any(after[key] != before[key] for key in ("bytes", "sha256"))):
            raise ValueError("The original source changed while staging")
    return file_identity(destination)


def open_work(parent, identity, *, directory=None):
    """Reopen this caller's original directory and keep its sole lifetime lock."""
    parent = Path(parent).expanduser().resolve()
    key = hashlib.sha256(canonical(identity)).hexdigest()[:24]
    root = Path(directory).expanduser().resolve() if directory else parent / ("allium-receiving-" + key)
    existed = root.exists()
    if existed and (not root.is_dir() or root.is_symlink()):
        raise ValueError("The original work path is not a directory")
    marker = root / "receiving-storage.json"
    if existed and not marker.is_file():
        unexpected = [p.name for p in root.iterdir() if p.name != "receiving-storage.lock"
                      and not (p.name.startswith(".receiving-storage.json.") and p.name.endswith(".pending"))]
        if unexpected:
            raise ValueError("The work path contains files from another operation")
    private(root)
    handle = (root / "receiving-storage.lock").open("a+b")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        value = {"schema": "commons.receiving-storage/v1", "identity": identity,
                 "directory": str(root), "owner_uid": os.getuid()}
        save_json(marker, value)
        return root, handle
    except BaseException:
        handle.close()
        raise


def select_source_alias(work, identity, source):
    """Point only this receiver's convenience alias at its verified installation."""
    work, source = Path(work).resolve(), Path(source).resolve(strict=True)
    marker = json.loads((work / "receiving-storage.json").read_bytes())
    if marker.get("identity") != identity or marker.get("directory") != str(work):
        raise ValueError("The selected source alias is not this original operation")
    if not source.is_dir():
        raise ValueError("The verified native source is not a directory")
    alias = work / "source"
    previous = None
    if alias.exists() or alias.is_symlink():
        if not alias.is_symlink():
            raise ValueError("Preserve the existing original source directory")
        previous = os.readlink(alias)
        if alias.resolve() == source:
            return {"previous": previous, "source": str(source), "reused": True}
    selection = {"identity": identity, "alias": str(alias), "previous": previous,
                 "source": str(source)}
    key = hashlib.sha256(canonical(selection)).hexdigest()
    save_json(work / ("source-alias-" + key + ".json"), selection)
    temporary = work / (".source." + str(os.getpid()) + "." + str(time.time_ns()) + ".pending")
    try:
        temporary.symlink_to(source, target_is_directory=True)
        os.replace(temporary, alias)
        sync_directory(work)
    finally:
        temporary.unlink(missing_ok=True)
    return {**selection, "reused": False}


def storage_inventory(roles, *, processes=False, consumers=True):
    """Use the existing live cgroup/filesystem and native process observations."""
    roots = list(dict.fromkeys(str(Path(path).expanduser().resolve())
                               for values in roles.values() for path in values))
    try:
        from worker_capacity import snapshot
        observed = snapshot(roots, nearest_existing=True,
                            storage_roots=roots if consumers else None,
                            process_storage=processes)
    except ImportError:
        observed = {"provider": "portable receiving filesystem inventory", "filesystems": []}
        for selected in roots:
            anchor = Path(selected)
            while not anchor.exists() and anchor != anchor.parent:
                anchor = anchor.parent
            counters = os.statvfs(anchor)
            observed["filesystems"].append({"path": selected, "device": anchor.stat().st_dev,
                "available_bytes": counters.f_bavail * counters.f_frsize,
                "available_inodes": counters.f_favail})
        memory = {}
        for key in ("memory.current", "memory.max", "memory.events", "memory.stat"):
            source = Path("/sys/fs/cgroup") / key
            if source.is_file():
                memory[key] = source.read_text()
        observed["cgroup"] = memory
    return {"roles": {role: [str(Path(path).expanduser().resolve()) for path in paths]
                      for role, paths in roles.items()},
            "observed_at": time.time(),
            "native_record": os.environ.get("SWARM_NATIVE_RECORD"),
            "capacity": observed}


def runtime_candidates(customer_state, source_commit):
    """Read only this customer's retained original runtime observations."""
    if customer_state is None:
        return []
    directory = Path(customer_state) / "runtime-observations"
    if not directory.is_dir():
        return []
    rows = []
    for child in directory.iterdir():
        path = child / "runtime-resolution.json"
        if not child.is_dir() or child.is_symlink() or not path.is_file() or path.is_symlink():
            continue
        try:
            value = json.loads(path.read_bytes())
            if value.get("status") == "READY" and value.get("sourceCommit") == source_commit:
                runtime = Path(value["directory"])
                if runtime.is_absolute() and runtime.is_dir():
                    rows.append((path.stat().st_mtime_ns, str(runtime)))
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return list(dict.fromkeys(path for _, path in sorted(rows, reverse=True)))


def uploaded_results(request, result):
    """Interpret the official per-file result; process exit zero is insufficient."""
    items = request.get("uploads", [])
    rows = result.get("results") if isinstance(result, dict) else None
    if not isinstance(rows, list) or len(rows) != len(items):
        raise ValueError("The upload result does not cover the complete selected delivery")
    accepted = []
    for selected, row in zip(items, rows):
        if (not isinstance(row, dict) or row.get("local_path") != selected["local_path"]
                or row.get("purpose") != selected["purpose"]):
            raise ValueError("An upload result belongs to a different selected file")
        if (row.get("status") == "succeeded" and isinstance(row.get("library_file_id"), str)
                and row["library_file_id"] and isinstance(row.get("file_id"), str) and row["file_id"]):
            accepted.append(row)
        elif row.get("status") != "failed":
            raise ValueError("An upload result has an unsupported completion state")
    return accepted


def save_uploads(request, path, invoke):
    """Save confirmed files once; explicit continuation submits only pending files."""
    path = Path(path)
    selection = [{**item, **{key: value for key, value in file_identity(item["local_path"]).items()
                             if key in ("bytes", "sha256")}} for item in request["uploads"]]
    previous = json.loads(path.read_bytes()) if path.is_file() else None
    if previous and previous.get("selection") != selection:
        raise ValueError("This upload continuation selects different original bytes")
    record = previous or {"schema": "commons.receiving-uploads/v1", "selection": selection,
                          "confirmed": [], "attempts": []}
    confirmed = {row["local_path"]: row for row in record["confirmed"]}
    for item in record["confirmed"]:
        uploaded_results({"uploads": [{"local_path": item["local_path"], "purpose": item["purpose"]}]},
                         {"results": [item]})
    pending = [item for item in request["uploads"] if item["local_path"] not in confirmed]
    if pending:
        current = {"uploads": pending}
        record["pending"] = pending
        save_json(path, record, replace=True)
        exit_code, raw = invoke(current)
        try:
            result = json.loads(raw)
            accepted = uploaded_results(current, result)
            for item in accepted:
                confirmed[item["local_path"]] = item
        except (ValueError, TypeError) as error:
            result = {"error": str(error), "response": raw.decode(errors="replace")
                      if isinstance(raw, bytes) else str(raw)}
        record["attempts"].append({"exit_code": exit_code, "result": result})
        record["confirmed"] = [confirmed[item["local_path"]] for item in request["uploads"]
                               if item["local_path"] in confirmed]
    record["pending"] = [item for item in request["uploads"] if item["local_path"] not in confirmed]
    record["complete"] = not record["pending"]
    save_json(path, record, replace=True)
    return record


def retire_copies(work, identity, entries, journal, *, reference, closed=False,
                  journal_directory=None, runtime_consumers_root=None):
    """Retire selected copies; explicit closed mode uses registered external recovery."""
    if type(closed) is not bool or (journal_directory is not None and not closed):
        raise ValueError("External recovery is an explicit closed-copy selection")
    if closed and journal_directory is None:
        raise ValueError("Select the owner-private external recovery directory")
    work, journal = Path(work).resolve(), Path(journal).resolve()
    marker = json.loads((work / "receiving-storage.json").read_bytes())
    if marker.get("identity") != identity or marker.get("directory") != str(work):
        raise ValueError("The selected cache is not this original receiving operation")
    try:
        from swarm_cloud_cache import create_plan, load_plan, retire
    except ImportError:
        return {"state": "retained", "operator": "swarm_cloud_cache",
                "work": str(work), "entries": entries, "reference": reference}
    selected = []
    for item in entries:
        target = Path(item["path"])
        if not target.is_absolute() or target.resolve() != target or not target.is_relative_to(work):
            raise ValueError("Retirement selects only exact private receiving paths")
        relative = target.relative_to(work).as_posix()
        first = Path(relative).parts[0]
        if (first in ("runtimes", "runtime", "delivery", "delivery-archives", "save-tools", "save-state")
                or first.startswith("runtime-")):
            raise ValueError("Retain original installations, deliverables and upload continuation")
        backing = file_identity(item["custody"])
        if target == Path(backing["path"]):
            raise ValueError("Retain the original backing file")
        custody = {"kind": "tar-member" if item.get("member") else "file",
                   "path": backing["path"], "size": backing["bytes"],
                   "sha256": backing["sha256"], "reference": reference}
        if item.get("member"):
            custody["member"] = item["member"]
        selected.append({"path": relative, "match": "complete", "custody": custody})
    if not selected:
        return {"entries": [], "allocated_bytes_released": 0}
    strategy = "release" if closed else "retire"
    manifest = {"version": 1, "operation_id": identity["operation"], "cache_root": str(work),
                "strategy": strategy, "entries": selected}
    if closed:
        manifest.update(ownership={"closed": True, "reference": reference},
                        journal_directory=str(journal_directory))
    journal.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not journal.exists():
        create_plan(manifest, journal, runtime_consumers_root=runtime_consumers_root)
    else:
        previous = load_plan(journal)
        previous_selection = [{"path": entry["path"], "match": entry["match"],
                               "custody": entry["custody"]} for entry in previous["entries"]]
        if (previous["operation_id"] != identity["operation"]
                or previous["cache_root"] != str(work)
                or previous.get("strategy", "retire") != strategy
                or previous_selection != selected):
            raise ValueError("The existing retirement plan selects different original copies")
        if closed and (previous["external_journal"]["directory"] != str(Path(journal_directory).resolve())
                or previous["ownership"] != {"closed": True, "reference": reference}):
            raise ValueError("Keep the original closed-copy recovery and owner selection")
    if closed:
        from cache_closed_release import prepare, release
        saved = load_plan(journal)
        prepared = prepare(journal, expected_plan=saved["plan_id"],
                           runtime_consumers_root=runtime_consumers_root)
        return release(prepared["retained_plan"], expected_plan=saved["plan_id"],
                       runtime_consumers_root=runtime_consumers_root)
    return retire(journal, file_use=True, runtime_consumers_root=runtime_consumers_root)


# These placement observations augment the maintained worker snapshot. They are
# advisory; the original native memory/disk admission remains authoritative.
class StoragePlacementError(RuntimeError):
    def __init__(self, message, record):
        super().__init__(message)
        self.record = record


def _temporary_footprint(value):
    required = {"working_bytes", "working_inodes", "process_memory_bytes"}
    optional = {"reserve_bytes", "reserve_inodes", "reserve_memory_bytes"}
    if not isinstance(value, dict) or not required <= value.keys() or value.keys() - required - optional:
        raise ValueError("Specify the original working bytes, inodes and process-memory footprint")
    result = {key: value.get(key, 0) for key in sorted(required | optional)}
    if any(type(item) is not int or item < 0 for item in result.values()):
        raise ValueError("The original storage footprint uses nonnegative integer counters")
    if not result["working_bytes"] or not result["working_inodes"]:
        raise ValueError("The original working footprint must include bytes and inodes")
    return result


def _temporary_location(value):
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise ValueError("Choose an absolute original temporary-volume path")
    path = Path(os.path.abspath(path))
    anchor = path
    while True:
        try:
            info = anchor.lstat()
            break
        except FileNotFoundError:
            if anchor == anchor.parent:
                raise
            anchor = anchor.parent
    if not stat.S_ISDIR(info.st_mode) or anchor.is_symlink() or anchor.resolve() != anchor:
        raise ValueError("The temporary-volume ancestor must be an existing real directory")
    return path, anchor


RECLAIM_OBSERVATION_MAX_AGE_SECONDS = 5.0


def _reclaim_estimate(capacity, now):
    """Estimate current-subtree reclaim without changing any kernel setting."""
    result = {"state": "unavailable", "estimated_bytes": 0,
              "clean_inactive_file_bytes": 0, "reclaimable_slab_bytes": 0,
              "errors": [], "maximum_age_seconds": RECLAIM_OBSERVATION_MAX_AGE_SECONDS}
    try:
        started = datetime.fromisoformat(capacity["started_at"].replace("Z", "+00:00"))
        finished = datetime.fromisoformat(capacity["finished_at"].replace("Z", "+00:00"))
        if started.tzinfo is None or finished.tzinfo is None:
            raise ValueError("timezone missing")
        start, end = started.timestamp(), finished.timestamp()
        if not start <= end <= now or now - start > RECLAIM_OBSERVATION_MAX_AGE_SECONDS:
            raise ValueError("observation outside freshness window")
    except (KeyError, TypeError, AttributeError, ValueError, OverflowError, OSError):
        result["errors"].append("reclaim_observation_stale_or_unobserved")
        return result
    group = capacity.get("cgroup_memory", {})
    levels = group.get("levels", [])
    current = levels[0].get("current_bytes") if levels else None
    counters = group.get("stat_bytes")
    names = ("file", "shmem", "inactive_file", "file_dirty", "file_writeback",
             "file_mapped", "slab", "slab_reclaimable", "slab_unreclaimable")
    if (type(current) is not int or current < 0 or not isinstance(counters, dict)
            or any(type(counters.get(key)) is not int or counters[key] < 0 for key in names)):
        result["errors"].append("reclaim_counters_unobserved")
        return result
    # file includes shmem. Inactive-file is a list counter, so bound it by
    # non-shmem file before conservatively excluding dirty/writeback/mapped.
    file_bytes = max(0, min(counters["inactive_file"],
                           max(0, counters["file"] - counters["shmem"]))
                     - counters["file_dirty"] - counters["file_writeback"]
                     - counters["file_mapped"])
    # slab is distinct from file; do not add slab's total and subtypes.
    slab_bytes = max(0, min(counters["slab_reclaimable"],
                           max(0, counters["slab"] - counters["slab_unreclaimable"])))
    estimate = min(current, file_bytes + slab_bytes)
    result.update(state="estimated", estimated_bytes=estimate,
                  clean_inactive_file_bytes=file_bytes,
                  reclaimable_slab_bytes=slab_bytes,
                  current_subtree_bytes=current,
                  observed_age_seconds=now - start,
                  counters={key: counters[key] for key in names})
    return result


def _memory_placement(capacity, now):
    """Keep raw bounds and an explicitly reclaim-dependent projection."""
    group = capacity.get("cgroup_memory", {})
    host = capacity.get("host_memory", {})
    levels = group.get("levels", [])
    reclaim = _reclaim_estimate(capacity, now)
    raw_ceilings, estimated_ceilings, bounds, errors = [], [], [], []
    if not levels:
        errors.append("current_cgroup_unobserved")
    for level in levels:
        used, maximum = level.get("current_bytes"), level.get("max_bytes")
        status = level.get("max_status")
        if type(used) is not int or used < 0 or status not in ("finite", "unlimited"):
            errors.append("cgroup_limit_unobserved")
        elif status == "finite":
            if type(maximum) is not int or maximum < 0:
                errors.append("cgroup_limit_unobserved")
            else:
                # The same current-subtree pages are inside every ancestor.
                # Project that one credit independently; never add ancestor credits.
                credit = min(used, reclaim["estimated_bytes"])
                raw = max(0, maximum - used)
                estimated = max(0, maximum - (used - credit))
                raw_ceilings.append(raw)
                estimated_ceilings.append(estimated)
                bounds.append({"directory": level.get("directory"),
                               "current_bytes": used, "max_bytes": maximum,
                               "uncommitted_headroom_bytes": raw,
                               "estimated_headroom_bytes": estimated,
                               "applied_reclaim_bytes": credit})
    available = host.get("available_bytes")
    if type(available) is int and available >= 0:
        raw_ceilings.append(available)
        estimated_ceilings.append(available)
    else:
        errors.append("host_availability_unobserved")
    raw = min(raw_ceilings) if raw_ceilings else None
    estimated = min(estimated_ceilings) if estimated_ceilings else None
    return {"state": "unavailable" if errors or not raw_ceilings else "observed",
            "headroom_bytes": estimated, "uncommitted_headroom_bytes": raw,
            "estimated_headroom_bytes": estimated,
            "estimated_reclaimable_bytes": reclaim["estimated_bytes"],
            "reclaim": reclaim, "cgroup_bounds": bounds,
            "protection_context": [{"directory": level.get("directory"),
                                    "protection": level.get("protection", {})}
                                   for level in levels],
            "host_available_bytes": available, "errors": errors}


def _placement_inventory(paths):
    """Project the maintained counters; estimated reclaim is not a reservation."""
    inventory = storage_inventory({"temporary": paths}, consumers=False)
    capacity = inventory["capacity"]
    memory = _memory_placement(capacity, time.time())
    rows = []
    for value in paths:
        path, anchor = _temporary_location(value)
        matches = [row for row in capacity.get("filesystems", [])
                   if row.get("requested_path") == str(path)]
        if len(matches) != 1:
            rows.append({"path": str(path), "state": "unavailable",
                         "reason": "original_filesystem_observation_required"})
            continue
        observed = matches[0]
        counters = (observed.get("available_bytes"), observed.get("inodes_available"))
        good = (observed.get("status") == "ok" and not observed.get("read_only", True)
                and observed.get("observed_path") == str(anchor)
                and type(observed.get("device")) is int
                and observed["device"] == anchor.stat().st_dev
                and all(type(number) is int and number >= 0 for number in counters)
                and isinstance(observed.get("mountpoint"), str)
                and isinstance(observed.get("filesystem"), str))
        rows.append({"path": str(path), "anchor": str(anchor),
                     "device": observed.get("device"), "filesystem": observed.get("filesystem"),
                     "mountpoint": observed.get("mountpoint"),
                     "available_bytes": counters[0], "available_inodes": counters[1],
                     "state": "observed" if good else "unavailable"})
    inventory["placement"] = {"state": "observed", "observed_at": time.time(),
                              "filesystems": rows, "memory": memory}
    return inventory


def _select_temporary_parent_observed(candidates, footprint, *, retained_directory=None,
                            same_process_save=False, memory_mode="raw"):
    """Choose before writing; a choice is not a native reservation.

    working_bytes/inodes describe additional simultaneous working capacity,
    including archive/upload staging. Recovery keeps this original request.
    process_memory_bytes is additional process working memory.
    """
    footprint = _temporary_footprint(footprint)
    if memory_mode not in ("raw", "kernel_reclaim"):
        raise ValueError("Memory mode must be raw or kernel_reclaim")
    if type(same_process_save) is not bool:
        raise ValueError("Declare whether the original caller retains same-process saving")
    original = None
    if retained_directory is not None:
        original, anchor = _temporary_location(retained_directory)
        if original != anchor:
            raise ValueError("Restore the original retained work directory before continuing")
        paths = [str(original)]
    else:
        if not isinstance(candidates, (tuple, list)) or not candidates:
            raise ValueError("Select at least one existing temporary-volume parent")
        paths = list(dict.fromkeys(str(_temporary_location(path)[0]) for path in candidates))
        for path in paths:
            selected, anchor = _temporary_location(path)
            if selected != anchor:
                raise ValueError("Temporary-volume candidates must already exist")
    inventory = _placement_inventory(paths)
    projection = inventory["placement"]
    memory = projection.get("memory", {})
    decisions = []
    for row in projection.get("filesystems", []):
        reasons = []
        ephemeral = row.get("filesystem") in {"tmpfs", "devtmpfs", "ramfs"}
        estimated = memory_mode == "kernel_reclaim" and not ephemeral
        admission_headroom = memory.get("estimated_headroom_bytes" if estimated
                                        else "uncommitted_headroom_bytes")
        required_memory = (footprint["process_memory_bytes"] + footprint["reserve_memory_bytes"]
                           + (footprint["working_bytes"] if ephemeral else 0))
        requires_reclaim = (required_memory > memory["uncommitted_headroom_bytes"]
                            if memory.get("state") == "observed" else None)
        if row.get("state") != "observed":
            reasons.append("filesystem_unobserved")
        else:
            if row["available_bytes"] < footprint["working_bytes"] + footprint["reserve_bytes"]:
                reasons.append("filesystem_bytes")
            if row["available_inodes"] < footprint["working_inodes"] + footprint["reserve_inodes"]:
                reasons.append("filesystem_inodes")
            if memory.get("state") != "observed":
                reasons.append("memory_unobserved")
            elif admission_headroom < required_memory:
                reasons.append("cgroup_or_host_memory")
            if ephemeral and not same_process_save:
                reasons.append("same_process_save_required")
        decision = {**row, "ephemeral": ephemeral, "reasons": reasons,
                    "required_memory_bytes": required_memory,
                    "requires_reclaim": requires_reclaim,
                    "admission_headroom_bytes": admission_headroom,
                    "memory_admission": ("estimated_kernel_reclaim"
                        if estimated and requires_reclaim else "uncommitted"),
                    "allocation_guaranteed": False}
        decisions.append(decision)
        if not reasons:
            return {"schema": "commons.receiving-temporary-choice/v1",
                    "parent": str(original.parent) if original else row["path"],
                    "retained_directory": str(original) if original else None,
                    "footprint": footprint, "same_process_save": same_process_save,
                    "memory_mode": memory_mode,
                    "selected": decision, "requires_reclaim": requires_reclaim,
                    "inventory": inventory}
    raise StoragePlacementError("No selected temporary volume admits the original working footprint",
        {"state": "PLACEMENT_UNAVAILABLE", "footprint": footprint,
         "retained_directory": str(original) if original else None,
         "decisions": decisions, "inventory": inventory})


DEFAULT_PLACEMENT_RECLAIM_BYTES = 256 * 1024 * 1024
MAX_PLACEMENT_RECLAIM_BYTES = 1024 * 1024 * 1024


def select_temporary_parent(candidates, footprint, *, retained_directory=None,
                            same_process_save=False, reclaim_bytes=0,
                            memory_mode="raw"):
    """Select storage with a retained, explicit process-memory admission mode.

    Raw headroom remains the default. An explicit kernel_reclaim choice may
    use the fresh conservative estimate on persistent filesystems only; Linux
    performs ordinary allocation-time reclamation under its unchanged limits.
    This estimate is never a reservation. Optional current-group reclaim and
    its actual result remain separate, including a read-only cgroup error.
    """
    if memory_mode not in ("raw", "kernel_reclaim"):
        raise ValueError("Memory mode must be raw or kernel_reclaim")
    if type(reclaim_bytes) is not int or not 0 <= reclaim_bytes <= MAX_PLACEMENT_RECLAIM_BYTES:
        raise ValueError("Placement reclaim budget must be 0..1073741824 bytes")
    try:
        choice = _select_temporary_parent_observed(candidates, footprint,
            retained_directory=retained_directory, same_process_save=same_process_save)
        choice["memory_mode"] = memory_mode
        return choice
    except StoragePlacementError as first:
        original = first.record
        projection = original.get("inventory", {}).get("placement", {})
        memory = projection.get("memory", {})
        eligible = [row for row in original.get("decisions", [])
                    if row.get("reasons") == ["cgroup_or_host_memory"]]
        if (not eligible or memory.get("state") != "observed"
                or (not reclaim_bytes and memory_mode == "raw")):
            raise
        reclaim = None
        if reclaim_bytes:
            retained_footprint = original["footprint"]
            deficits = [
                retained_footprint["process_memory_bytes"] + retained_footprint["reserve_memory_bytes"]
                + (retained_footprint["working_bytes"] if row["ephemeral"] else 0)
                - memory["uncommitted_headroom_bytes"] for row in eligible]
            requested = min(reclaim_bytes, min(deficits))
            if requested <= 0:
                raise
            reclaim = {"budget_bytes": reclaim_bytes, "requested_bytes": requested,
                       "original_inventory": original["inventory"],
                       "original_decisions": original["decisions"]}
            try:
                if __package__:
                    from .worker_capacity import reclaim_current_cgroup
                else:
                    from worker_capacity import reclaim_current_cgroup
                reclaim["result"] = reclaim_current_cgroup(requested,
                    expected_cgroup=original["inventory"]["capacity"].get("cgroup_memory", {}))
            except ImportError as error:
                reclaim["result"] = {"state": "UNAVAILABLE", "request_attempted": False,
                    "request_written": False,
                    "error": {"kind": type(error).__name__, "message": str(error)}}
            result = reclaim["result"]
            if (result.get("selection_cgroup_unchanged") is False
                    or result.get("current_cgroup_unchanged") is False):
                raise StoragePlacementError("The original current-cgroup identity changed during placement",
                    {**original, "state": "PLACEMENT_CHANGED", "capacity_reclaim": reclaim}) from first
        try:
            choice = _select_temporary_parent_observed(candidates, footprint,
                retained_directory=retained_directory, same_process_save=same_process_save,
                memory_mode=memory_mode)
        except StoragePlacementError as refreshed:
            if reclaim is not None:
                refreshed.record["capacity_reclaim"] = reclaim
            raise
        if reclaim is not None:
            choice["capacity_reclaim"] = reclaim
        return choice


def open_selected_work(identity, candidates, footprint, *, directory=None,
                       same_process_save=False,
                       reclaim_bytes=DEFAULT_PLACEMENT_RECLAIM_BYTES,
                       memory_mode="raw"):
    """Recheck the chosen volume, then retain the existing marker and work lock."""
    if memory_mode not in ("raw", "kernel_reclaim"):
        raise ValueError("Memory mode must be raw or kernel_reclaim")
    original = Path(directory).expanduser() if directory is not None else None
    if original is not None and not original.is_absolute():
        raise ValueError("Use the absolute original work directory")
    previous = None
    if original is None:
        key = hashlib.sha256(canonical(identity)).hexdigest()[:24]
        existing = []
        for parent in candidates:
            path, _ = _temporary_location(parent)
            possible = path / ("allium-receiving-" + key)
            if possible.exists() or possible.is_symlink():
                existing.append(possible)
        if len(set(existing)) > 1:
            raise ValueError("Select the authoritative original work directory; multiple copies exist")
        if existing:
            original = existing[0]
    if original is not None:
        original = Path(os.path.abspath(original))
        marker = original / "receiving-temporary.json"
        if marker.exists() or marker.is_symlink():
            file_identity(marker)
            previous = json.loads(marker.read_bytes())
            if (previous.get("schema") != "commons.receiving-temporary-placement/v1"
                    or previous.get("identity") != identity or previous.get("directory") != str(original)
                    or previous.get("footprint") != _temporary_footprint(footprint)
                    or previous.get("same_process_save") != same_process_save
                    or previous.get("memory_mode", "raw") != memory_mode):
                raise ValueError("Preserve the original receiving placement and working footprint")
        else:
            # open_work validates its existing identity marker or a setup that
            # stopped before publishing that marker. Do not choose a new root.
            retained_marker = original / "receiving-storage.json"
            if retained_marker.exists() or retained_marker.is_symlink():
                file_identity(retained_marker)
                retained = json.loads(retained_marker.read_bytes())
                if retained != {"schema": "commons.receiving-storage/v1", "identity": identity,
                                "directory": str(original), "owner_uid": os.getuid()}:
                    raise ValueError("The retained work directory belongs to another operation")
    choice = select_temporary_parent(candidates, footprint, retained_directory=original,
                                     same_process_save=same_process_save, reclaim_bytes=reclaim_bytes,
                                     memory_mode=memory_mode)
    # Selection has no reservation semantics. Reobserve the chosen device just
    # before open_work performs the first marker/lock/directory writes.
    try:
        fresh = select_temporary_parent([choice["parent"]], footprint, retained_directory=original,
                                        same_process_save=same_process_save, memory_mode=memory_mode)
    except StoragePlacementError as error:
        if "capacity_reclaim" in choice:
            error.record["capacity_reclaim"] = choice["capacity_reclaim"]
        error.record["original_choice"] = choice
        raise
    if "capacity_reclaim" in choice:
        fresh["capacity_reclaim"] = choice["capacity_reclaim"]
    if any(choice["selected"].get(key) != fresh["selected"].get(key)
           for key in ("device", "filesystem", "mountpoint")):
        raise StoragePlacementError("The selected temporary filesystem changed before setup",
                                    {"state": "PLACEMENT_CHANGED", "choice": choice, "fresh": fresh})
    if previous and any(previous.get(key) != fresh["selected"].get(key)
                        for key in ("device", "filesystem", "mountpoint")):
        raise StoragePlacementError("The original receiving filesystem identity changed",
                                    {"state": "PLACEMENT_CHANGED", "placement": previous, "fresh": fresh})
    root = handle = None
    try:
        root, handle = open_work(fresh["parent"], identity, directory=original)
        paths = {name: str(root / name) for name in ("temporary", "render", "archives", "save-state")}
        placement = {"schema": "commons.receiving-temporary-placement/v1", "identity": identity,
                     "directory": str(root), "footprint": fresh["footprint"],
                     "same_process_save": same_process_save,
                     **{key: fresh["selected"][key] for key in ("device", "filesystem", "mountpoint", "ephemeral")},
                     "paths": paths, "state_parent": paths["save-state"]}
        if memory_mode != "raw":
            placement["memory_mode"] = memory_mode
        if previous is not None and previous != placement:
            raise ValueError("Preserve the original receiving role paths")
        save_json(root / "receiving-temporary.json", placement)
        for path in paths.values():
            private(path)
            if Path(path).stat().st_dev != placement["device"]:
                raise ValueError("The original temporary role moved to another filesystem")
        save_json(root / ("placement-observation-" + str(time.time_ns()) + ".json"), fresh)
        return root, handle, placement
    except BaseException as error:
        failure = {"state": "PLACEMENT_SETUP_FAILED", "choice": fresh,
                   "directory": str(root) if root else None,
                   "error": {"name": type(error).__name__, "message": str(error)}}
        if root is not None:
            try:
                save_json(root / ("placement-failure-" + str(time.time_ns()) + ".json"), failure)
            except OSError as secondary:
                failure["record_error"] = {"name": type(secondary).__name__, "message": str(secondary)}
        if handle is not None:
            handle.close()
        if isinstance(error, (KeyboardInterrupt, SystemExit)):
            raise
        raise StoragePlacementError("Original temporary setup failed before product work", failure) from error


def temporary_environment(placement, environment=None):
    """Return child-only temporary bindings from the original prepared placement."""
    if placement.get("schema") != "commons.receiving-temporary-placement/v1":
        raise ValueError("Use this original caller's prepared temporary placement")
    result = dict(os.environ if environment is None else environment)
    temporary = placement["paths"]["temporary"]
    result.update(TMPDIR=temporary, TMP=temporary, TEMP=temporary)
    return result


def validate_temporary_placement(placement, *, refresh=False, reclaim_bytes=0):
    """Verify the retained role binding before an original launch or save."""
    if not isinstance(placement, dict) or placement.get("schema") != "commons.receiving-temporary-placement/v1":
        raise ValueError("Use the original prepared temporary placement")
    memory_mode = placement.get("memory_mode", "raw")
    if memory_mode not in ("raw", "kernel_reclaim"):
        raise ValueError("Memory mode must be raw or kernel_reclaim")
    root, anchor = _temporary_location(placement["directory"])
    if root != anchor:
        raise ValueError("Restore the original receiving directory before continuation")
    marker = root / "receiving-temporary.json"
    file_identity(marker)
    if json.loads(marker.read_bytes()) != placement:
        raise ValueError("The original temporary placement changed")
    for path in placement["paths"].values():
        selected, existing = _temporary_location(path)
        if selected != existing or root not in selected.parents or selected.stat().st_dev != placement["device"]:
            raise ValueError("The original temporary role binding changed")
    if placement["state_parent"] != placement["paths"]["save-state"]:
        raise ValueError("Preserve the original Library state_parent")
    if refresh:
        choice = select_temporary_parent([root.parent], placement["footprint"],
            retained_directory=root, same_process_save=placement["same_process_save"],
            reclaim_bytes=reclaim_bytes, memory_mode=memory_mode)
        if any(choice["selected"][key] != placement[key] for key in ("device", "filesystem", "mountpoint", "ephemeral")):
            raise ValueError("The original temporary filesystem changed")
        return choice
    return placement
