#!/usr/bin/env python3
"""Prepare filesystem placement, then use the original native command operator.

The placement journal precedes the native request. It retains the authored path
bindings and exact input copies. Commands, memory/disk admission, process
ownership, runtime registration, cancellation and recovery remain native.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
from types import SimpleNamespace
import sys

if __package__:
    from . import native_placement_files as files
    from . import native_reservation as reservation_lifetime
    from .worker_capacity import snapshot as capacity_snapshot
else:
    import native_placement_files as files
    import native_reservation as reservation_lifetime
    from worker_capacity import snapshot as capacity_snapshot

SCHEMA = "commons.native-placement/v1"
MIB = 1024 * 1024
DISPATCH_FILES = ("process.json", "output.log", "command-completion.dat")
TERMINAL_PREDECESSOR_PATH = ".placement-predecessor"
TERMINAL_PREDECESSOR_STAGING = ".placement-predecessor-copy"
DEFAULT_BINDINGS = {
    "run": {"mode": "empty", "target": "run"},
    "records": {"mode": "empty", "target": "records"},
    "worker": {"mode": "empty", "target": "worker"},
    "temporary": {"mode": "empty", "target": "temporary"},
}
DEFAULT_NATIVE = {
    "project": {"binding": "run"},
    "records_root": {"binding": "records"},
    "worker_root": {"binding": "worker"},
    "temp_root": {"binding": "temporary"},
    "java": None, "node": None, "artifact": [], "runtime_path": [],
    "memory_mib": None, "memory_reserve_mib": 256, "memory_reclaim": "none",
    "memory_reservations_root": None, "runtime_consumers_root": None,
    "disk_space": [], "disk_inodes": [],
    "disk_reserve_mib": 64, "disk_reserve_inodes": 128,
    "disk_reservations_root": None,
}


def now():
    return datetime.now(timezone.utc).isoformat()


def _stable_id(value, name):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}", value):
        raise ValueError(name + " needs 1–160 letters, digits, dots, colons, underscores or hyphens")
    return value


def _absolute(value, name):
    if not isinstance(value, str) or not Path(value).expanduser().is_absolute():
        raise ValueError(name + " must be an explicit absolute path")
    return str(Path(value).expanduser().resolve())


def _json_value(value):
    # Validate plain JSON and detach it from the caller's mutable dictionaries.
    return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))


def normalize(spec):
    spec = _json_value(spec)
    if spec.get("schema", SCHEMA) != SCHEMA:
        raise ValueError("Use the native placement schema")
    _stable_id(spec.get("placement_id"), "placement_id")
    native = {**deepcopy(DEFAULT_NATIVE), **spec.get("native", {})}
    if not isinstance(native.get("operation_id"), str) or not native["operation_id"]:
        raise ValueError("Select the original native operation_id")
    if not isinstance(native.get("peer"), str) or not native["peer"]:
        raise ValueError("Select the original native peer")
    if not isinstance(native.get("command"), list) or not native["command"]:
        raise ValueError("Supply the complete original command argument array")
    bindings = {**deepcopy(DEFAULT_BINDINGS), **spec.get("bindings", {})}
    for name, binding in bindings.items():
        _stable_id(name, "binding name")
        if not isinstance(binding, dict) or binding.get("mode") not in ("retain", "copy", "empty"):
            raise ValueError("Each binding needs retain, copy or empty mode")
        if "role" in binding:
            from swarm_cloud_worker import STORAGE_ROLES
            if binding["role"] not in STORAGE_ROLES:
                raise ValueError("Choose a native source, installation, archive, cache, case or logs role")
        if binding["mode"] in ("retain", "copy"):
            binding["source"] = _absolute(binding.get("source"), name + ".source")
            excludes = binding.get("excludes", [])
            if not isinstance(excludes, list):
                raise ValueError("Source exclusions must be an explicit relative-path list")
            binding["excludes"] = sorted({files.relative_path(value) for value in excludes})
        if binding["mode"] in ("copy", "empty"):
            binding["target"] = files.relative_path(binding.get("target"))
        if binding["mode"] == "retain" and "target" in binding:
            raise ValueError("A retained-in-place source does not have a copied target")
    placed = [(name, value) for name, value in bindings.items() if value["mode"] != "retain"]
    for index, (name, binding) in enumerate(placed):
        for other_name, other in placed[index + 1:]:
            a, b = binding["target"], other["target"]
            if a == b:
                raise ValueError("Two bindings select the same output path")
            if a.startswith(b + "/") and other["mode"] == "copy":
                raise ValueError("Copy targets cannot contain another binding; select a separate exact source root")
            if b.startswith(a + "/") and binding["mode"] == "copy":
                raise ValueError("Copy targets cannot contain another binding; select a separate exact source root")
    candidates = spec.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise ValueError("Supply the ordered candidate filesystem roots")
    ids = set()
    for candidate in candidates:
        if not isinstance(candidate, dict):
            raise ValueError("Candidate roots need an id and absolute root")
        _stable_id(candidate.get("id"), "candidate id")
        if candidate["id"] in ids:
            raise ValueError("Candidate identities must be distinct")
        ids.add(candidate["id"])
        candidate["root"] = _absolute(candidate.get("root"), "candidate root")
    predecessor = spec.get("predecessor")
    if predecessor is not None:
        if not isinstance(predecessor, dict):
            raise ValueError("Select the exact predecessor request and supervisor")
        predecessor["record"] = _absolute(predecessor.get("record"), "predecessor record")
        if not re.fullmatch(r"[0-9a-f]{64}", str(predecessor.get("request_sha256", ""))):
            raise ValueError("Select the SHA-256 of the original predecessor request.json")
        if not isinstance(predecessor.get("expected_supervisor"), dict):
            raise ValueError("Select the original observed predecessor supervisor identity")
        mode = predecessor.get("mode", "cancel-undispatched")
        if mode not in ("cancel-undispatched", "terminal-result"):
            raise ValueError("Select cancel-undispatched or terminal-result predecessor mode")
        if mode == "terminal-result":
            if not re.fullmatch(r"[0-9a-f]{64}", str(predecessor.get("result_sha256", ""))):
                raise ValueError("Pin the exact completed predecessor result.json SHA-256")
            for binding in bindings.values():
                target = binding.get("target", "")
                if any(target == value or target.startswith(value + "/")
                       for value in (TERMINAL_PREDECESSOR_PATH, TERMINAL_PREDECESSOR_STAGING)):
                    raise ValueError("The terminal predecessor's private retention path is reserved")
    return {**spec, "schema": SCHEMA, "native": native, "bindings": bindings,
            "candidates": candidates,
            "business_operation_id": spec.get("business_operation_id", native["operation_id"])}


def _root(plans_root, placement_id):
    return Path(_absolute(str(plans_root), "plans_root")) / files.sha256(
        _stable_id(placement_id, "placement_id").encode("utf-8"))


@contextmanager
def _lock(directory):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if directory.is_symlink():
        raise ValueError("The retained placement journal must be its actual directory")
    descriptor = os.open(directory / ".lock", os.O_RDWR | os.O_CREAT, 0o600)
    with os.fdopen(descriptor, "a") as stream:
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
        yield


def _native(selected=None):
    if selected is not None:
        return selected
    if __package__:
        from . import swarm_cloud_job
    else:
        import swarm_cloud_job
    return swarm_cloud_job


def _runtime(native):
    if __package__:
        from . import native_runtime_handoff
    else:
        import native_runtime_handoff
    value = native_runtime_handoff.runtime_identity(native)
    directory = Path(__file__).resolve().parent
    own = {name: files.sha256((directory / name).read_bytes())
           for name in ("native_placement.py", "native_placement_files.py")}
    return {"native": value, "placement": own}


def _paths(spec, candidate):
    directory = Path(candidate["root"]) / ("native-placement-" + files.sha256(
        spec["placement_id"].encode("utf-8"))[:24])
    result = {}
    for name, binding in spec["bindings"].items():
        result[name] = (binding["source"] if binding["mode"] == "retain"
                        else str(directory / binding["target"]))
    return directory, result


def _path(value, bindings):
    if isinstance(value, str):
        return _absolute(value, "native path")
    if not isinstance(value, dict) or set(value) - {"binding", "relative"}:
        raise ValueError("A path must be absolute or select one named binding")
    name = value.get("binding")
    if name not in bindings:
        raise ValueError("Unknown placement binding: " + str(name))
    relative = value.get("relative")
    return str(Path(bindings[name]) / files.relative_path(relative)) if relative else bindings[name]


def _argument(value, bindings):
    if isinstance(value, str):
        if "\x00" in value:
            raise ValueError("Native arguments cannot contain NUL")
        return value
    return _path(value, bindings)


def _storage_path(value, bindings):
    from swarm_cloud_worker import STORAGE_ROLES
    if isinstance(value, str):
        role, separator, path = value.partition("=")
        if not separator:
            raise ValueError("Storage paths use ROLE=PATH or an explicit role/path binding")
    elif isinstance(value, dict) and set(value) == {"role", "path"}:
        role, path = value["role"], value["path"]
    else:
        raise ValueError("Storage paths use ROLE=PATH or an explicit role/path binding")
    if role not in STORAGE_ROLES:
        raise ValueError("Choose a native source, installation, archive, cache, case or logs role")
    return role + "=" + _path(path, bindings)


def render_args(spec, candidate):
    directory, paths = _paths(spec, candidate)
    result = deepcopy(spec["native"])
    for key in ("project", "records_root", "worker_root", "temp_root"):
        result[key] = _path(result[key], paths)
    result["command"] = [_argument(value, paths) for value in result["command"]]
    result["runtime_path"] = [_path(value, paths) for value in result.get("runtime_path", [])]
    # Source copies and retained source stay visible to the original runtime-use
    # registry for exactly this native operation's lifetime.
    result["runtime_path"] = sorted(set(result["runtime_path"] + [
        paths[name] for name, binding in spec["bindings"].items()
        if binding["mode"] in ("copy", "retain")]))
    # Role labels expose selected storage through the same native job status.
    # They also become original runtime consumers, including created case/cache paths.
    selected_roles = result.get("storage_path", [])
    if not isinstance(selected_roles, list):
        raise ValueError("native.storage_path must be an explicit role/path list")
    role_paths = [_storage_path(value, paths) for value in selected_roles]
    role_paths += [binding["role"] + "=" + paths[name]
                   for name, binding in spec["bindings"].items() if binding.get("role")]
    if role_paths:
        result["storage_path"] = sorted(set(role_paths))
    for key, quantity in (("disk_space", "mib"), ("disk_inodes", "count")):
        rendered = []
        for row in result.get(key, []):
            if isinstance(row, str):
                rendered.append(row)
            elif isinstance(row, dict) and type(row.get(quantity)) is int and row[quantity] > 0:
                rendered.append(_path(row.get("path"), paths) + "=" + str(row[quantity]))
            else:
                raise ValueError(key + " requires an original path and positive " + quantity)
        result[key] = rendered
    return result, paths, directory


def _inputs(spec):
    result = {}
    for name, binding in spec["bindings"].items():
        if binding["mode"] in ("retain", "copy"):
            result[name] = files.inventory(binding["source"], excludes=binding.get("excludes", []))
            expected = binding.get("manifest_sha256")
            if expected is not None and expected != result[name]["sha256"]:
                raise ValueError("The selected source manifest changed: " + name)
    return result


def _capacity(spec, candidate, inputs, predecessor_inventory=None):
    args, paths, directory = render_args(spec, candidate)
    if __package__:
        from .cloud_disk import specification as disk_specification
        from .cloud_memory import specification as memory_specification
    else:
        from cloud_disk import specification as disk_specification
        from cloud_memory import specification as memory_specification
    disk = None
    if args["disk_space"] or args["disk_inodes"]:
        disk = disk_specification(args["disk_space"], args["disk_inodes"],
            args["disk_reserve_mib"], args["disk_reserve_inodes"], args["disk_reservations_root"])
    elif args["disk_reserve_mib"] != 64 or args["disk_reserve_inodes"] != 128 or args["disk_reservations_root"]:
        raise ValueError("Native disk reserve options require declared disk paths")
    if args["memory_mib"] is not None:
        memory_specification(args["memory_mib"], args["memory_reserve_mib"],
                             args["memory_reservations_root"], args["memory_reclaim"])
    requests = disk["paths"] if disk else []
    observed = capacity_snapshot([str(directory), *[row["path"] for row in requests]],
                                 nearest_existing=True)
    rows = observed["filesystems"]
    reasons, grouped = [], {}
    record = Path(args["records_root"]) / hashlib.sha256(args["operation_id"].encode("utf-8")).hexdigest()
    control_issue = reservation_lifetime.control_location_issue(record)
    if control_issue is not None and not (record / "request.json").is_file():
        reasons.append(control_issue)
    for index, row in enumerate(rows):
        if row.get("status") != "ok" or type(row.get("available_bytes")) is not int:
            reasons.append({"code": "FILESYSTEM_UNAVAILABLE", "path": row.get("requested_path")})
            continue
        device = str(row["device"])
        group = grouped.setdefault(device, {"device": row["device"], "paths": [],
            "available_bytes": row["available_bytes"], "available_inodes": row.get("inodes_available"),
            "requested_bytes": 0, "requested_inodes": 0, "copy_bytes": 0, "copy_inodes": 0,
            "memory_backed": row.get("memory_backed"), "filesystem": row.get("filesystem")})
        group["paths"].append(row["requested_path"])
        group["available_bytes"] = min(group["available_bytes"], row["available_bytes"])
        if type(group["available_inodes"]) is int and type(row.get("inodes_available")) is int:
            group["available_inodes"] = min(group["available_inodes"], row["inodes_available"])
        else:
            group["available_inodes"] = None
        if index:
            group["requested_bytes"] += requests[index - 1]["bytes"]
            group["requested_inodes"] += requests[index - 1]["inodes"]
    original = rows[0]
    if original.get("status") == "ok":
        group = grouped[str(original["device"])]
        copied = [value for name, value in inputs.items()
                  if spec["bindings"][name]["mode"] == "copy"]
        if predecessor_inventory is not None:
            copied.append(predecessor_inventory)
        # Copy bytes are additional to the command's original declaration.
        # A terminal record is retained on this selected filesystem too.
        # Allow one filesystem block per copied entry and two MiB for journals.
        group["copy_bytes"] = sum(value["copy_bytes"] + 4096 * value["entries_count"]
                                  for value in copied) + 2 * MIB
        group["copy_inodes"] = sum(value["entries_count"] for value in copied) + 64
    for group in grouped.values():
        reserve_bytes = disk["reserve_bytes"] if disk else 0
        reserve_inodes = disk["reserve_inodes"] if disk else 0
        group["required_bytes"] = group["requested_bytes"] + group["copy_bytes"] + reserve_bytes
        group["required_inodes"] = group["requested_inodes"] + group["copy_inodes"] + reserve_inodes
        if group["available_bytes"] < group["required_bytes"]:
            reasons.append({"code": "INSUFFICIENT_BYTES", "device": group["device"],
                            "needed": group["required_bytes"], "available": group["available_bytes"]})
        if group["available_inodes"] is not None and group["available_inodes"] < group["required_inodes"]:
            reasons.append({"code": "INSUFFICIENT_INODES", "device": group["device"],
                            "needed": group["required_inodes"], "available": group["available_inodes"]})
    return {"id": candidate["id"], "root": candidate["root"], "directory": str(directory),
        "eligible": not reasons, "reasons": reasons, "filesystems": list(grouped.values()),
        "observation": observed, "bindings": paths, "native_args": args,
        "selection_scope": "source placement estimate; original native admission reserves and rechecks capacity"}



def _observe_preparation_allocation(candidate):
    """Resolve an overlay counter shortfall during explicit source placement."""
    if candidate["eligible"] or any(
            row["code"] != "INSUFFICIENT_BYTES" for row in candidate["reasons"]):
        return
    observed = candidate["observation"]["filesystems"]
    groups = [row for row in candidate["filesystems"]
              if row["available_bytes"] < row["required_bytes"]]
    # A successful allocation cannot repair an unrelated inode or device failure.
    for group in groups:
        original = [row for row in observed if row.get("device") == group["device"]]
        if (group.get("filesystem") != "overlay" or not original
                or any(row.get("available_bytes_source") != "statvfs_f_bavail"
                       or type(row.get("free_including_reserved_bytes")) is not int
                       for row in original)):
            return
    if __package__:
        from .worker_capacity import allocation_probe
    else:
        from worker_capacity import allocation_probe
    for group in groups:
        results = group.setdefault("prepare_allocation_observations", [])
        anchors = set()
        for requested in group["paths"]:
            result = None
            try:
                selected = Path(requested)
                if selected.resolve() != selected:
                    raise ValueError("The selected canonical allocation path changed")
                anchor = selected
                while not anchor.exists() and anchor != anchor.parent:
                    anchor = anchor.parent
                if anchor.is_file():
                    anchor = anchor.parent
                before = anchor.stat()
                identity = (str(anchor), before.st_dev, before.st_ino)
                if identity in anchors:
                    continue
                anchors.add(identity)
                result = allocation_probe(str(anchor), group["required_bytes"],
                    nearest_existing=False, expected_device=group["device"])
                result["directory_identity"] = {
                    "path": str(anchor), "device": before.st_dev, "inode": before.st_ino}
                result["selected_path"] = requested
                after = anchor.stat()
                if (anchor.resolve() != anchor or selected.resolve() != selected
                        or (after.st_dev, after.st_ino) != (before.st_dev, before.st_ino)):
                    raise ValueError("The observed allocation directory changed")
            except (OSError, ValueError, RuntimeError) as exc:
                original_result = result
                result = {"status": "error", "selected_path": requested,
                          "error": {"type": type(exc).__name__, "errno": getattr(exc, "errno", None),
                                    "message": str(exc)}}
                if original_result is not None:
                    result["original_allocation_observation"] = original_result
            results.append(result)
            if (result.get("status") != "ok" or not result.get("allocation_released")
                    or result.get("allocated_extent_bytes") != group["required_bytes"]):
                candidate["reasons"].append({"code": "PREPARE_ALLOCATION_FAILED",
                    "device": group["device"], "path": requested, "observation": result})
                return
        if not results:
            return
        group["counter_available_bytes"] = group["available_bytes"]
        group["available_bytes"] = group["required_bytes"]
        group["available_bytes_source"] = "observed_exact_preparation_allocation"
    candidate["reasons"] = [row for row in candidate["reasons"]
        if not (row["code"] == "INSUFFICIENT_BYTES" and any(
            group["device"] == row["device"]
            and group["available_bytes"] >= group["required_bytes"] for group in groups))]
    candidate["eligible"] = not candidate["reasons"]


def preview(spec, *, native=None):
    spec = normalize(spec)
    predecessor, predecessor_inventory = None, None
    selected = spec.get("predecessor")
    if selected:
        native = _native(native)
        root, original, raw = _original(native, selected)
        with native.run_lock(root):
            root, original, raw = _original(native, selected)
            predecessor = _predecessor_view(native, root, original, raw)
            if selected.get("mode") == "terminal-result":
                _check_predecessor(predecessor, selected, terminal=True)
                predecessor_inventory = files.inventory(
                    str(root), excludes=[".lock", ".supervisor.lock"])
    inputs = _inputs(spec)
    candidates = [_capacity(spec, candidate, inputs, predecessor_inventory)
                  for candidate in spec["candidates"]]
    value = {"schema": SCHEMA, "spec": spec, "spec_sha256": files.sha256(files.canonical(spec)),
             "observed_at": now(), "inputs": inputs, "candidates": candidates,
             "eligible_candidates": [row["id"] for row in candidates if row["eligible"]],
             "predecessor": predecessor}
    if predecessor_inventory is not None:
        value["predecessor_inventory"] = predecessor_inventory
    return value


def prepare(spec, plans_root, *, candidate_id=None, native=None):
    spec = normalize(spec)
    directory = _root(plans_root, spec["placement_id"])
    native = _native(native)
    with _lock(directory):
        request = files.read_json(directory / "placement.json")
        fingerprint = files.sha256(files.canonical(spec))
        if request is not None:
            if request.get("schema") != SCHEMA or request.get("spec_sha256") != fingerprint:
                raise ValueError("This placement identity already retains another authored specification")
            if candidate_id is not None and request["selected"]["id"] != candidate_id:
                raise ValueError("Keep the selected placement; choose a new identity for a changed destination")
            return inspect(plans_root, spec["placement_id"], native=native)
        value = preview(spec, native=native)
        rows = [row for row in value["candidates"] if candidate_id is None or row["id"] == candidate_id]
        selected = None
        for row in rows:
            _observe_preparation_allocation(row)
            if row["eligible"]:
                selected = row
                break
        value["eligible_candidates"] = [row["id"] for row in value["candidates"] if row["eligible"]]
        if selected is None:
            return {"schema": SCHEMA, "placement_id": spec["placement_id"],
                    "phase": "awaiting_capacity", "candidates": value["candidates"],
                    "journal": str(directory), "native_request_created": False}
        predecessor = spec.get("predecessor")
        if predecessor:
            original = value["predecessor"]
            _check_predecessor(original, predecessor,
                               terminal=predecessor.get("mode") == "terminal-result")
            if original["operation_id"] == spec["native"]["operation_id"]:
                raise ValueError("A placement continuation needs a distinct native operation ID")
        request = {**value, "created_at": now(), "selected": selected, "runtime": _runtime(native)}
        files.retain_json(directory / "placement.json", request)
        files.save_json(directory / "state.json", {"phase": "prepared", "updated_at": now(),
            "placement_id": spec["placement_id"], "native_record": str(native.run_path(
                selected["native_args"]["operation_id"], selected["native_args"]["records_root"]))})
        return inspect(plans_root, spec["placement_id"], native=native)


def _load(plans_root, placement_id):
    directory = _root(plans_root, placement_id)
    request = files.read_json(directory / "placement.json")
    if request is None or request.get("schema") != SCHEMA or request["spec"]["placement_id"] != placement_id:
        raise ValueError("No retained placement for that identity")
    if files.sha256(files.canonical(request["spec"])) != request["spec_sha256"]:
        raise ValueError("Preserve the original placement specification")
    state = files.read_json(directory / "state.json") or {
        "phase": "prepared", "placement_id": placement_id, "updated_at": request["created_at"]}
    _verify_storage(directory, request, state)
    return directory, request, state


def _save_state(directory, state, **values):
    state = {**state, **values, "updated_at": now()}
    files.save_json(directory / "state.json", state)
    return state


def _verify_storage(directory, request, state):
    """Keep a selected filesystem and its original namespace across calls."""
    selected = request["selected"]
    expected = selected["observation"]["filesystems"]
    current = capacity_snapshot([row["requested_path"] for row in expected],
                               nearest_existing=True)["filesystems"]
    if len(current) != len(expected):
        raise ValueError("The selected filesystem observation is incomplete")
    for before, after in zip(expected, current):
        if (after.get("status") != "ok" or before.get("device") != after.get("device")
                or before.get("filesystem") != after.get("filesystem")):
            raise ValueError("The selected filesystem changed for " + before["requested_path"]
                             + "; select a persistent source placement before continuation")
    for group in selected["filesystems"]:
        for observation in group.get("prepare_allocation_observations", []):
            identity = observation.get("directory_identity")
            if observation.get("status") != "ok" or not identity:
                raise ValueError("The original preparation allocation is incomplete")
            anchor = Path(identity["path"])
            info = anchor.stat()
            target = Path(observation["selected_path"])
            if (anchor.resolve() != anchor or target.resolve() != target
                    or (info.st_dev, info.st_ino) != (identity["device"], identity["inode"])):
                raise ValueError("The original preparation allocation directory changed")
    # A prepared/copying placement may not yet have written both owner markers.
    # Every later phase must still see its exact original namespace, including
    # empty writable bindings which have no copied-file inventory to verify.
    if state.get("phase") in (None, "prepared", "copying"):
        return
    root = Path(selected["directory"])
    marker = {"schema": SCHEMA, "placement_id": request["spec"]["placement_id"],
              "spec_sha256": request["spec_sha256"], "journal": str(directory)}
    claim = root.parent / ("." + root.name + ".owner.json")
    if (root.is_symlink() or not root.is_dir()
            or files.read_json(claim) != marker
            or files.read_json(root / "placement-owner.json") != marker):
        raise ValueError("The original placed namespace is unavailable; retain its journal and source")
    for name, binding in request["spec"]["bindings"].items():
        if binding["mode"] != "retain":
            destination = Path(selected["bindings"][name])
            if (not destination.exists() or destination.is_symlink()
                    or binding["mode"] == "empty" and not destination.is_dir()
                    or not destination.resolve(strict=True).is_relative_to(root.resolve(strict=True))):
                raise ValueError("The original placed binding is unavailable: " + name)


def _original(native, selected):
    root = Path(selected["record"]).resolve(strict=True)
    raw = (root / "request.json").read_bytes()
    request = json.loads(raw)
    if (request.get("schema") != native.SCHEMA or
            native.run_path(request["intent"]["operation_id"], root.parent).resolve() != root):
        raise ValueError("Select the original native request directory")
    if selected.get("request_sha256") and files.sha256(raw) != selected["request_sha256"]:
        raise ValueError("The original predecessor request changed")
    return root, request, raw


def _predecessor_view(native, root, request, raw):
    state = native.read_json(root / "state.json") or {}
    try:
        result_raw = (root / "result.json").read_bytes()
    except FileNotFoundError:
        result_raw = None
    result = json.loads(result_raw) if result_raw is not None else {}
    report = native.inspect(root)
    dispatched = any((root / name).exists() for name in DISPATCH_FILES) or bool(
        state.get("process") or result.get("process") or report.get("process_alive"))
    cancel_error = str(result.get("error", ""))
    cancelled = (result.get("state") == "launch_failed" and result.get("stop_requested") is True
                 and (result.get("cancelled_before_dispatch") is True
                      or cancel_error in ("stopped_before_dispatch", "stopped_before_disk_dispatch",
                                          "stopped_before_memory_dispatch")))
    resources_released = all(
        (report.get(name + "_admission") or {}).get("state") == "released"
        for name in ("disk", "memory") if request["intent"].get(name))
    # The result is authoritative even if the last state checkpoint still says
    # running. Positive native identity checks cover every retained process,
    # including a child written before state.json received its process field.
    launch = native.read_json(root / "supervisor-launch.json") or {}
    identities = [item for item in (
        state.get("supervisor"), state.get("process"), result.get("supervisor"),
        result.get("process"), native.read_json(root / "process.json"),
        launch.get("supervisor")) if item is not None]
    identities_ended = bool(identities) and all(native._supervisor_ended(item) for item in identities)
    try:
        ended_at = datetime.fromisoformat(result.get("ended_at", ""))
        dated_exit = ended_at.tzinfo is not None
    except (ValueError, TypeError):
        dated_exit = False
    completed_result = bool(
        result.get("state") in ("completed", "failed")
        and type(result.get("exit_code")) is int and dated_exit
        and (result["state"] == "completed") == (result["exit_code"] == 0)
        and isinstance(result.get("supervisor"), dict)
        and isinstance(result.get("process"), dict)
        and report.get("exit_code") == result["exit_code"]
        and report.get("ended_at") == result["ended_at"])
    completed_and_released = bool(
        completed_result and identities_ended and resources_released
        and not report.get("supervisor_alive") and not report.get("process_alive")
        and (report.get("runtime_use") or {}).get("state") in (None, "complete"))
    return {"operation_id": request["intent"]["operation_id"], "record": str(root),
        "request_sha256": files.sha256(raw), "supervisor": state.get("supervisor"),
        "undispatched": not dispatched, "cancelled_before_dispatch": cancelled,
        "terminal_and_released": bool(cancelled and not dispatched
            and not report.get("supervisor_alive") and not report.get("process_alive")
            and native._supervisor_ended(state.get("supervisor")) and resources_released),
        "completed_and_released": completed_and_released,
        "completed_result": {key: result.get(key) for key in ("state", "exit_code", "ended_at")}
            if completed_result else None,
        "original_identities_ended": identities_ended,
        "resources_released": resources_released,
        "native": report, "result_sha256": files.sha256(result_raw)
            if result_raw is not None else None}


def _check_predecessor(view, selected, *, terminal=False):
    if (view["request_sha256"] != selected["request_sha256"]
            or view["supervisor"] != selected["expected_supervisor"]):
        raise ValueError("The predecessor source or supervisor changed; inspect its same original record")
    if selected.get("mode") == "terminal-result":
        if view["result_sha256"] != selected["result_sha256"]:
            raise ValueError("The selected predecessor result changed; retain and inspect its exact outcome")
        if not view["completed_and_released"]:
            raise ValueError("The pinned predecessor needs its actual completed result, ended processes and released resources")
    else:
        if not view["undispatched"]:
            raise ValueError("The predecessor dispatched; select its actual terminal result for a changed continuation")
        if terminal and not view["terminal_and_released"]:
            raise ValueError("The original predecessor cancellation and resource release are not complete")


def inspect_predecessor(record, *, native=None):
    native = _native(native)
    root, request, raw = _original(native, {"record": record})
    with native.run_lock(root):
        root, request, raw = _original(native, {"record": str(root)})
        return _predecessor_view(native, root, request, raw)


def _cancel_predecessor(directory, request, state, native):
    selected = request["spec"].get("predecessor")
    if not selected:
        return state, None
    if selected.get("mode") == "terminal-result":
        raise ValueError("A terminal-result predecessor is retained by materialize without cancellation")
    root, original, raw = _original(native, selected)
    with native.run_lock(root):
        root, original, raw = _original(native, selected)
        view = _predecessor_view(native, root, original, raw)
        if view["supervisor"] != selected["expected_supervisor"]:
            raise ValueError("The predecessor supervisor changed")
        if not view["undispatched"]:
            raise ValueError("The predecessor dispatched; preserve its original command")
        state = _save_state(directory, state, phase="stopping_predecessor")
        # This is the existing native stop implementation under its original
        # run lock. The same-lock observation prevents racing into a started
        # command between an inspection and a public stop call.
        handoff = native.read_json(root / "runtime-handoff.json")
        if handoff is not None:
            if __package__:
                from . import native_runtime_handoff
            else:
                import native_runtime_handoff
            active = native_runtime_handoff.active(native, root)
            if active and active.get("phase") not in ("resumed", "resumed_elsewhere", "cancelled"):
                raise ValueError("Continue the predecessor's existing runtime handoff before storage relocation")
        native._stop_locked(root, expected_supervisor=selected["expected_supervisor"])
        view = _predecessor_view(native, root, original, raw)
        if not view["terminal_and_released"]:
            return _save_state(directory, state, phase="waiting_predecessor",
                               predecessor=view), view
        # Repeat the original idempotent release to retain the native runtime
        # registration outcome as well as memory/disk release after cancellation.
        release = native._release_cancelled_capacity(root, original,
                                                    native.read_json(root / "state.json") or {})
        if not release.get("ok"):
            return _save_state(directory, state, phase="waiting_predecessor_release",
                               predecessor=view), view
        destination = directory / "predecessor"
        retained = files.read_json(directory / "predecessor-manifest.json")
        if retained is None:
            retained = files.inventory(str(root), excludes=[".lock", ".supervisor.lock"])
            files.retain_json(directory / "predecessor-manifest.json", retained)
        files.copy_inventory(retained, destination, workspace_root=directory,
                             staging=directory / "predecessor-copy")
        state = _save_state(directory, state, phase="predecessor_retained", predecessor=view,
                            predecessor_manifest_sha256=retained["sha256"])
        return state, view


def _terminal_predecessor_destination(request):
    return Path(request["selected"]["directory"]) / TERMINAL_PREDECESSOR_PATH


def _retain_terminal_predecessor(directory, request, state, native):
    selected = request["spec"]["predecessor"]
    root, original, raw = _original(native, selected)
    with native.run_lock(root):
        root, original, raw = _original(native, selected)
        view = _predecessor_view(native, root, original, raw)
        _check_predecessor(view, selected, terminal=True)
        retained = request.get("predecessor_inventory")
        if retained is None:
            raise ValueError("Prepare the terminal predecessor's complete original record inventory")
        files.assert_inventory(retained)
        files.retain_json(directory / "predecessor-manifest.json", retained)
        destination = _terminal_predecessor_destination(request)
        placed = Path(request["selected"]["directory"])
        files.copy_inventory(retained, destination, workspace_root=placed,
                             staging=placed / TERMINAL_PREDECESSOR_STAGING)
        state = _save_state(directory, state, phase="predecessor_retained",
                            predecessor=view, predecessor_retained_path=str(destination),
                            predecessor_manifest_sha256=retained["sha256"])
        return state, view


def _verify_inputs(request):
    for value in request["inputs"].values():
        files.assert_inventory(value)


def _materialize(directory, request, state, native):
    if _runtime(native) != request["runtime"]:
        raise ValueError("Use the selected original native and placement runtime closure")
    selected = request["selected"]
    root = Path(selected["directory"])
    marker = {"schema": SCHEMA, "placement_id": request["spec"]["placement_id"],
              "spec_sha256": request["spec_sha256"], "journal": str(directory)}
    root.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    claim = root.parent / ("." + root.name + ".owner.json")
    retained_claim = files.read_json(claim)
    if retained_claim is None and (root.exists() or root.is_symlink()):
        raise ValueError("The selected namespace predates this placement")
    files.retain_json(claim, marker)
    if root.is_symlink():
        raise ValueError("The selected namespace changed its actual directory")
    root.mkdir(exist_ok=True, mode=0o700)
    files.retain_json(root / "placement-owner.json", marker)
    _verify_inputs(request)
    state = _save_state(directory, state, phase="copying")
    spec = request["spec"]
    ordered = sorted(spec["bindings"].items(),
        key=lambda item: (0 if item[1]["mode"] == "empty" else 1,
                          item[1].get("target", "").count("/"), item[0]))
    for name, binding in ordered:
        destination = Path(selected["bindings"][name])
        if binding["mode"] == "retain":
            continue
        files.contained(destination, root)
        if binding["mode"] == "empty":
            if destination.is_symlink() or (destination.exists() and not destination.is_dir()):
                raise ValueError("The new writable binding is not its original directory")
            destination.mkdir(parents=True, exist_ok=True, mode=0o700)
        else:
            def progress(value):
                nonlocal state
                # Native source copies are resumable per file. Periodic readable
                # progress avoids writing a separate receipt for every entry.
                if value["entries_complete"] == value["entries_total"] or value["entries_complete"] % 128 == 0:
                    state = _save_state(directory, state, phase="copying",
                                        copying={"binding": name, **value})
            result = files.copy_inventory(request["inputs"][name], destination,
                workspace_root=root, staging=root / "source-copy-staging", progress=progress)
            state = _save_state(directory, state, phase="copying",
                copied={**state.get("copied", {}), name: result})
    for name, binding in spec["bindings"].items():
        if binding["mode"] != "retain":
            current = Path(selected["bindings"][name]).resolve(strict=True)
            if not current.is_relative_to(root.resolve(strict=True)):
                raise ValueError("A writable binding changed its actual filesystem path")
    for key in ("project", "records_root", "worker_root", "temp_root"):
        if not Path(selected["native_args"][key]).is_dir():
            raise ValueError("The native " + key + " must be an actual directory")
    _verify_inputs(request)
    return _save_state(directory, state, phase="materialized", copying=None)


def materialize(plans_root, placement_id, *, native=None, cancel_predecessor=False):
    native = _native(native)
    directory = _root(plans_root, placement_id)
    with _lock(directory):
        directory, request, state = _load(plans_root, placement_id)
        record = native.run_path(request["selected"]["native_args"]["operation_id"],
                                 request["selected"]["native_args"]["records_root"])
        if (record / "request.json").exists():
            return inspect(plans_root, placement_id, native=native)
        if state.get("phase") not in ("materialized", "ready", "predecessor_retained",
                                      "waiting_predecessor", "waiting_predecessor_release",
                                      "stopping_predecessor"):
            state = _materialize(directory, request, state, native)
        else:
            _verify_inputs(request)
            for name, binding in request["spec"]["bindings"].items():
                if binding["mode"] == "copy":
                    files.verify_copy(request["inputs"][name], request["selected"]["bindings"][name])
        predecessor = request["spec"].get("predecessor")
        if predecessor and predecessor.get("mode") == "terminal-result":
            if cancel_predecessor:
                raise ValueError("Use materialize to retain this terminal-result predecessor")
            state, view = _retain_terminal_predecessor(directory, request, state, native)
        elif predecessor:
            if not cancel_predecessor and state.get("phase") != "predecessor_retained":
                return {"schema": SCHEMA, "placement_id": placement_id, "phase": "materialized",
                    "predecessor_action": "cancel-predecessor", "journal": str(directory),
                    "selected": request["selected"]["id"]}
            state, view = _cancel_predecessor(directory, request, state, native)
            if not view["terminal_and_released"] or state["phase"] != "predecessor_retained":
                return inspect(plans_root, placement_id, native=native)
        state = _save_state(directory, state, phase="ready")
        return inspect(plans_root, placement_id, native=native)


def native_args(plans_root, placement_id, *, native=None):
    native = _native(native)
    directory, request, state = _load(plans_root, placement_id)
    if state.get("phase") not in ("ready", "start_pending", "native"):
        raise ValueError("Materialize the same placement and finish its predecessor before launch")
    return SimpleNamespace(**deepcopy(request["selected"]["native_args"]))


def start(plans_root, placement_id, *, native=None, launcher=None):
    native = _native(native)
    directory = _root(plans_root, placement_id)
    with _lock(directory):
        directory, request, state = _load(plans_root, placement_id)
        args = native_args(plans_root, placement_id, native=native)
        record = native.run_path(args.operation_id, args.records_root)
        existing = (record / "request.json").exists()
        if not existing:
            if _runtime(native) != request["runtime"]:
                raise ValueError("Use the selected original runtime for this retained placement")
            _verify_inputs(request)
            for name, binding in request["spec"]["bindings"].items():
                if binding["mode"] == "copy":
                    files.verify_copy(request["inputs"][name], request["selected"]["bindings"][name])
            if request["spec"].get("predecessor"):
                selected = request["spec"]["predecessor"]
                root, original, raw = _original(native, selected)
                with native.run_lock(root):
                    root, original, raw = _original(native, selected)
                    view = _predecessor_view(native, root, original, raw)
                    _check_predecessor(view, selected, terminal=True)
                    if selected.get("mode") == "terminal-result":
                        files.assert_inventory(request["predecessor_inventory"])
                        files.verify_copy(request["predecessor_inventory"],
                                          _terminal_predecessor_destination(request))
            state = _save_state(directory, state, phase="start_pending", native_record=str(record))
        # Native start is idempotent on the exact original operation/intent and
        # owns the actual request save, runtime use, capacity and supervisor.
        report = native.start(args, launcher=launcher)
        try:
            _save_state(directory, state, phase="native", native_record=report["record"],
                        native_started_at=state.get("native_started_at", now()))
            pending = False
        except OSError:
            # The native record remains authoritative after accepted dispatch.
            pending = True
        return {"schema": SCHEMA, "placement_id": placement_id, "journal": str(directory),
                "selected": request["selected"]["id"], "bindings": request["selected"]["bindings"],
                "native": report, "placement_checkpoint_pending": pending}


def inspect(plans_root, placement_id, *, native=None):
    native = _native(native)
    directory, request, state = _load(plans_root, placement_id)
    args = request["selected"]["native_args"]
    record = native.run_path(args["operation_id"], args["records_root"])
    original = native.inspect(record) if (record / "request.json").is_file() else None
    return {"schema": SCHEMA, "placement_id": placement_id,
        "business_operation_id": request["spec"]["business_operation_id"],
        "phase": "native" if original else state.get("phase", "prepared"),
        "journal": str(directory), "manifest": str(directory / "placement.json"),
        "selected": request["selected"]["id"], "directory": request["selected"]["directory"],
        "bindings": request["selected"]["bindings"], "native_args": args,
        "source_manifests": {name: {"source": value["source"], "sha256": value["sha256"],
            "entries": value["entries_count"], "copy_bytes": value["copy_bytes"]}
            for name, value in request["inputs"].items()},
        "state": state, "native": original}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    view = sub.add_parser("preview")
    view.add_argument("--spec", required=True)
    view.add_argument("--full", action="store_true", help="include every retained input manifest row")
    pred = sub.add_parser("predecessor")
    pred.add_argument("--record", required=True)
    prepare_parser = sub.add_parser("prepare")
    prepare_parser.add_argument("--spec", required=True)
    prepare_parser.add_argument("--plans-root", required=True)
    prepare_parser.add_argument("--candidate")
    for action in ("materialize", "cancel-predecessor", "args", "run", "status", "stop",
                   "resume-capacity", "logs"):
        command = sub.add_parser(action)
        command.add_argument("--plans-root", required=True)
        command.add_argument("--placement-id", required=True)
        if action == "logs":
            command.add_argument("--offset", type=int, default=0)
        if action == "resume-capacity":
            command.add_argument("--recover-failure")
    args = parser.parse_args(argv)
    native = _native()
    try:
        if args.action == "preview":
            value = preview(files.read_json(args.spec), native=native)
            if not args.full:
                value = {**value, "inputs": {name: {key: item[key] for key in
                    ("source", "sha256", "entries_count", "copy_bytes", "allocated_bytes", "files",
                     "directories", "symbolic_links", "excludes")}
                    for name, item in value["inputs"].items()}}
                if value.get("predecessor_inventory") is not None:
                    item = value["predecessor_inventory"]
                    value["predecessor_inventory"] = {key: item[key] for key in
                        ("source", "sha256", "entries_count", "copy_bytes", "allocated_bytes",
                         "files", "directories", "symbolic_links", "excludes")}
        elif args.action == "predecessor":
            value = inspect_predecessor(args.record, native=native)
        elif args.action == "prepare":
            value = prepare(files.read_json(args.spec), args.plans_root,
                            candidate_id=args.candidate, native=native)
        elif args.action in ("materialize", "cancel-predecessor"):
            value = materialize(args.plans_root, args.placement_id, native=native,
                                cancel_predecessor=args.action == "cancel-predecessor")
        elif args.action == "args":
            value = vars(native_args(args.plans_root, args.placement_id, native=native))
        elif args.action == "run":
            if __package__:
                from .native_foreground import ForegroundLaunch
            else:
                from native_foreground import ForegroundLaunch
            launcher = ForegroundLaunch(native)
            value = start(args.plans_root, args.placement_id, native=native, launcher=launcher)
            print(json.dumps(value), flush=True)
            if not value["native"].get("reused"):
                launcher.handoff()
            else:
                report, offset = native.stream_log(Path(value["native"]["record"]), follow=True)
                print(json.dumps({"native": report, "next_log_offset": offset}), flush=True)
                return native.exit_status(report)
            return native.exit_status(native.inspect(Path(value["native"]["record"])))
        elif args.action == "status":
            value = inspect(args.plans_root, args.placement_id, native=native)
        else:
            value = inspect(args.plans_root, args.placement_id, native=native)
            if not value["native"]:
                raise ValueError("This placement has no native request yet")
            root = Path(value["native"]["record"])
            if args.action == "stop":
                state = native.read_json(root / "state.json") or {}
                value = native.stop(root, expected_supervisor=state.get("supervisor"))
            elif args.action == "logs":
                if args.offset < 0:
                    raise ValueError("The log offset must be nonnegative")
                value, offset = native.stream_log(root, offset=args.offset, follow=False)
                value = {"native": value, "next_log_offset": offset}
            else:
                if __package__:
                    from .native_foreground import resume_foreground
                else:
                    from native_foreground import resume_foreground
                value = resume_foreground(native, value["native_args"]["operation_id"],
                    value["native_args"]["records_root"], action="resume-capacity",
                    recover_failure=args.recover_failure)
        print(json.dumps(value, ensure_ascii=False, indent=2), flush=True)
        return 75 if value.get("phase") in ("awaiting_capacity", "waiting_predecessor",
                                           "waiting_predecessor_release") else 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"ok": False, "error": type(error).__name__,
                          "message": str(error), "errno": getattr(error, "errno", None)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
