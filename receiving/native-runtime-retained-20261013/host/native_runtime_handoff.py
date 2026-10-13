#!/usr/bin/env python3
"""Move one original, undispatched capacity queue to its selected runtime."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
import uuid

if __package__:
    from . import native_handoff_capacity as capacity_changes
else:
    import native_handoff_capacity as capacity_changes

SCHEMA = "commons.native-runtime-handoff/v1"
DISPATCH_FILES = ("process.json", "output.log", "command-completion.dat")
RUNTIME_FILES = ("swarm_cloud_job.py", "swarm_cloud_worker.py", "native_foreground.py",
                 "native_runtime_handoff.py", "native_handoff_capacity.py", "native_handoff_placement.py", "offload_build.py", "cloud_memory.py",
                 "cloud_disk.py", "worker_capacity.py", "cloud_residency.py",
                 "runtime_consumers.py", "swarm_cloud_cache.py", "swarm_cloud_dependencies.py",
                 "run_bounded.py", "native_completion.py")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def runtime_identity(native):
    if __package__:
        from .runtime_source import python_sources
    else:
        from runtime_source import python_sources
    root = Path(native.__file__).resolve().parent
    selected = [name for name in RUNTIME_FILES if (root / name).is_file()]
    files = {name: saved["sha256"] for name, saved in python_sources(root, selected).items()}
    required = {"swarm_cloud_job.py", "swarm_cloud_worker.py", "native_foreground.py",
                "native_runtime_handoff.py", "worker_capacity.py"}
    if not required.issubset(files):
        raise ValueError("Install the original runtime and handoff helper together")
    value = {"host_root": str(root), "files": files}
    return {**value, "sha256": digest(canonical(value))}


def _request(native, root):
    raw = (root / "request.json").read_bytes()
    request = json.loads(raw)
    if (request.get("schema") != native.SCHEMA or
            native.run_path(request["intent"]["operation_id"], root.parent) != root):
        raise ValueError("The handoff must retain its exact original native record")
    if not (request["intent"].get("memory") or request["intent"].get("disk")):
        raise ValueError("Only an original capacity queue can hand off before dispatch")
    memory = request["intent"].get("memory") or {}
    storage = memory.get("storage_mode", "included")
    if storage != "included" and storage not in getattr(native, "MEMORY_ADMISSION_STORAGE_MODES", ()):
        raise ValueError("The selected runtime does not support this original memory/storage contract")
    if (root / "offload.json").exists():
        import offload_build
        if Path(offload_build.__file__).resolve().parent != Path(native.__file__).resolve().parent:
            raise ValueError("Use the selected runtime's original offload reader")
        offload_build.memory_for_native_start(native.read_json(root / "offload.json"), request)
    return request, digest(raw)


def _directory(root, handoff_id):
    if not isinstance(handoff_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}", handoff_id):
        raise ValueError("Use a stable, nonempty handoff identity of at most 160 characters")
    return root / "runtime-handoffs" / digest(handoff_id.encode())


def active(native, root):
    pointer = native.read_json(root / "runtime-handoff.json")
    if pointer is None:
        return None
    if pointer.get("schema") != SCHEMA:
        raise ValueError("Preserve the original runtime handoff record")
    directory = _directory(root, pointer["handoff_id"])
    value = native.read_json(directory / "handoff.json")
    if not value or value.get("schema") != SCHEMA or value.get("handoff_id") != pointer["handoff_id"]:
        raise ValueError("The original runtime handoff journal is incomplete")
    _validate_transition(value)
    return value


def _validate_transition(value):
    selection = value["selection"]
    stop = value["stop_request"]
    if (selection.get("handoff_id") != value["handoff_id"] or
            value["runtime"].get("sha256") != selection.get("expected_runtime_sha256") or
            stop.get("supervisor") != selection.get("expected_supervisor") or stop.get("signal") != "SIGTERM" or
            stop.get("runtime_handoff") != {"handoff_id": value["handoff_id"],
                "request_sha256": selection.get("expected_request_sha256"),
                "runtime_sha256": selection.get("expected_runtime_sha256")}):
        raise ValueError("Preserve the exact authored handoff transition and stop request")
    capacity_changes.validate_selection(value)


def _save(native, root, value):
    directory = _directory(root, value["handoff_id"])
    directory.parent.mkdir(exist_ok=True, mode=0o700)
    directory.mkdir(exist_ok=True, mode=0o700)
    native.save_json(directory / "handoff.json", value)


def inspect(native, root, handoff_id, *, amendments=None, placement=None):
    with native.run_lock(root):
        request, sha = _request(native, root)
        state = native.read_json(root / "state.json") or {}
        runtime = runtime_identity(native)
        selection = {"handoff_id": handoff_id, "expected_request_sha256": sha,
                     "expected_supervisor": state.get("supervisor"),
                     "expected_runtime_sha256": runtime["sha256"]}
        report = {}
        if amendments is not None or placement is not None:
            reviewed = capacity_changes.review(native, request, amendments, placement=placement)
            if reviewed["amendments"]:
                selection["capacity_amendments"] = reviewed["amendments"]
            if reviewed.get("placement"):
                selection["placement"] = reviewed["placement"]["changes"]
            report["capacity_review"] = reviewed
        return {"schema": SCHEMA, "operation_id": request["intent"]["operation_id"],
                "state": native.inspect(root)["state"], "runtime": runtime,
                "handoff": selection, **report}


def prepare(native, root, options):
    """Persist the exact authored transition before requesting any stop."""
    required = {"handoff_id", "expected_request_sha256", "expected_supervisor", "expected_runtime_sha256"}
    if (not required.issubset(options) or set(options) - required - {"capacity_amendments", "placement"}):
        raise ValueError("Select the inspected request, supervisor, runtime and optional capacity changes")
    _directory(root, options["handoff_id"])
    if getattr(native, "RUNTIME_HANDOFF_SCHEMA", None) != SCHEMA:
        raise ValueError("Install the original native runtime handoff integration")
    with native.run_lock(root):
        request, sha = _request(native, root)
        runtime = runtime_identity(native)
        if options["expected_runtime_sha256"] != runtime["sha256"]:
            raise ValueError("The selected runtime changed; inspect that same operation")
        current = active(native, root)
        if current and current["handoff_id"] == options["handoff_id"]:
            if (current["selection"] != options or
                    not capacity_changes.matches_request(native, current, request, sha)):
                raise ValueError("A handoff identity cannot select another request, owner or runtime")
            return current
        if options["expected_request_sha256"] != sha:
            raise ValueError("The original request changed; inspect that same operation")
        if current and current.get("phase") not in ("resumed", "resumed_elsewhere"):
            raise ValueError("Continue the existing original handoff identity")
        directory = _directory(root, options["handoff_id"])
        orphan = native.read_json(directory / "handoff.json") if directory.exists() else None
        state = native.read_json(root / "state.json") or {}
        supervisor = options["expected_supervisor"]
        if not isinstance(supervisor, dict) or not supervisor or state.get("supervisor") != supervisor:
            raise ValueError("The original queued supervisor changed; inspect its current owner")
        # The original resume path can recover a positively ended supervisor
        # between capacity admission and command allocation. Permit that same
        # undispatched state to select its maintained runtime first.
        interrupted_start = (state.get("state") == "starting" and
                             native._supervisor_ended(supervisor))
        if ((state.get("state") not in native.CAPACITY_QUEUED_STATES and not interrupted_start) or
                state.get("process") or
                any((root / name).exists() for name in (*DISPATCH_FILES, "result.json", "stop-request.json"))):
            raise ValueError("Preserve started commands and prior cancellation; only an undispatched queue can hand off")
        # An interrupted first atomic save can leave only its owned directory.
        # With no journal or member there is no authored transition to replace;
        # retain the same inspected request/owner and enter the original save.
        # Any member or symlink continues through exact orphan validation.
        unwritten = (directory.is_dir() and not directory.is_symlink()
                     and not any(directory.iterdir()))
        if directory.exists() and not unwritten:
            if (not orphan or orphan.get("schema") != SCHEMA or orphan.get("handoff_id") != options["handoff_id"] or
                    orphan.get("selection") != options or orphan.get("runtime") != runtime or
                    orphan.get("operation_id") != request["intent"]["operation_id"] or orphan.get("phase") != "prepared"):
                raise ValueError("This handoff identity already belongs to another retained transition")
            _validate_transition(orphan)
            if orphan.get("capacity_plan"):
                capacity_changes.prepare(native, root, request, options, state)
                _archive(directory / "request.json", (root / "request.json").read_bytes())
                capacity_changes.validate_prepared(native, root, orphan, directory)
            native.save_json(root / "runtime-handoff.json", {"schema": SCHEMA, "handoff_id": options["handoff_id"]})
            return orphan
        value = {"schema": SCHEMA, "handoff_id": options["handoff_id"], "selection": options,
                 "operation_id": request["intent"]["operation_id"], "runtime": runtime,
                 "prepared_at": native.now(), "phase": "prepared",
                 "stop_request": {"requested_at": native.now(), "signal": "SIGTERM", "supervisor": supervisor,
                                  "runtime_handoff": {"handoff_id": options["handoff_id"],
                                                      "request_sha256": sha, "runtime_sha256": runtime["sha256"]}}}
        if "capacity_amendments" in options or "placement" in options:
            value["capacity_plan"] = capacity_changes.prepare(native, root, request, options, state)
            if (value["capacity_plan"]["amendments"] != options.get("capacity_amendments", {}) or
                    (value["capacity_plan"].get("placement") or {}).get("changes") != options.get("placement")):
                raise ValueError("Use the inspected normalized capacity and placement selection")
        _save(native, root, value)
        if value.get("capacity_plan"):
            _archive(directory / "request.json", (root / "request.json").read_bytes())
        native.save_json(root / "runtime-handoff.json", {"schema": SCHEMA, "handoff_id": options["handoff_id"]})
        return value


def _archive(path, raw):
    """Retain exact native bytes without exposing a partially written archive."""
    if path.exists():
        if path.read_bytes() != raw:
            raise ValueError("The original handoff archive changed")
        return
    temporary = path.with_name("." + path.name + "." + uuid.uuid4().hex)
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.read_bytes() != raw:
                raise ValueError("The original handoff archive changed")
        descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        temporary.unlink(missing_ok=True)


def _report(native, root, value, **extra):
    handoff = {"schema": SCHEMA, "handoff_id": value["handoff_id"],
               "phase": value["phase"], "runtime_sha256": value["runtime"]["sha256"]}
    plan = value.get("capacity_plan")
    if plan:
        applied = value.get("capacity_application") or {}
        handoff["capacity"] = {"before": plan["before"], "after": plan["after"],
            "amendment_ids": {name: change["amendment_id"] for name, change in plan["amendments"].items()},
            "applied": bool(applied.get("applied_at")),
            "request_sha256": applied.get("saved_request_sha256")}
        if plan.get("placement"):
            physical = plan["placement"]
            handoff["placement"] = {"amendment_id": physical["changes"]["amendment_id"],
                "previous": physical["before"], "next": physical["after"],
                "applied": bool(applied.get("applied_at")),
                "runtime_use_before": applied.get("runtime_use_before")}
    return {**native.inspect(root), "reused": True, "resumed": False, **extra,
            "runtime_handoff": handoff}


def cancel_pending(native, root, *, expected_supervisor=None):
    """Public cancellation wins over a prepared handoff under the same run lock."""
    state = native.read_json(root / "state.json") or {}
    if expected_supervisor is not None and state.get("supervisor") != expected_supervisor:
        return False
    value = active(native, root)
    if not value or value.get("phase") in ("resumed", "resumed_elsewhere", "cancelled"):
        return False
    value.update(phase="cancelled", cancelled_at=native.now(),
                 cancellation={"source": "native.stop", "supervisor": state.get("supervisor")})
    _save(native, root, value)
    return True


def resume(native, root, *, require_memory=False, launcher=None, wait_seconds=25):
    """Consume the prepared transition through the original stop and resume locks."""
    deadline = time.monotonic() + wait_seconds
    while True:
        with native.run_lock(root):
            value = active(native, root)
            if not value:
                raise ValueError("Prepare the original handoff before resuming it")
            if value["phase"] in ("resumed", "resumed_elsewhere", "cancelled"):
                return _report(native, root, value)
            if not callable(launcher) or getattr(launcher, "retains_native_supervisor", False) is not True:
                raise ValueError("Use the original retained foreground launcher for a prepared runtime handoff")
            capacity_changes.validate_prepared(native, root, value, _directory(root, value["handoff_id"]))
            selection = value["selection"]
            request, sha = _request(native, root)
            if not capacity_changes.matches_request(native, value, request, sha):
                raise ValueError("The handoff's original request changed")
            if require_memory and not request["intent"].get("memory"):
                raise ValueError("This original operation has no memory admission request")
            if runtime_identity(native) != value["runtime"]:
                raise ValueError("Retain the exact installed runtime selected for this handoff")
            state = native.read_json(root / "state.json") or {}
            supervisor = selection["expected_supervisor"]
            if state.get("supervisor") != supervisor:
                if value["phase"] in ("archived", "resuming") and state.get("supervisor"):
                    value.update(phase="resumed_elsewhere", observed_at=native.now(),
                                 replacement_supervisor=state["supervisor"])
                    _save(native, root, value)
                    return _report(native, root, value)
                raise ValueError("The original supervisor changed; this handoff cannot stop its replacement")
            if state.get("process") or any((root / name).exists() for name in DISPATCH_FILES):
                raise ValueError("Command dispatch raced this handoff; retain the original outcome without replay")
            stop = native.read_json(root / "stop-request.json")
            result = native.read_json(root / "result.json")
            if stop is not None and stop != value["stop_request"]:
                raise ValueError("Preserve the separately requested cancellation; it is not this handoff")
            if native.alive(supervisor):
                if result is not None and not (result.get("state") == "launch_failed" and
                        result.get("stop_requested") is True and result.get("supervisor") == supervisor and
                        not result.get("cancelled_before_dispatch") and
                        result.get("error") in ("stopped_before_memory_dispatch", "stopped_before_disk_dispatch", "stopped_before_dispatch")):
                    raise ValueError("Preserve the original terminal outcome")
                if stop is None:
                    if value["phase"] != "prepared" or state.get("state") not in native.CAPACITY_QUEUED_STATES:
                        raise ValueError("Only the selected original queued owner can accept this handoff")
                    acknowledgment = native._stop_locked(root, expected_supervisor=supervisor,
                                                        authored_stop_request=value["stop_request"])
                    if not acknowledgment.get("stop_requested"):
                        return _report(native, root, value, handoff_stop=acknowledgment)
                    value.update(phase="stop_requested", stop_requested_at=native.now())
                    _save(native, root, value)
                pending = _report(native, root, value)
            else:
                # An invisible holder remains the owner. Acquire the same
                # inode before archiving, amending or removing any result.
                with native.supervisor_lock(root, reuse_current=True) as descriptor:
                    if descriptor is None:
                        pending = _report(native, root, value, supervisor_lock_held=True,
                                          recovery_state="supervisor_lifetime_held")
                    else:
                        state = native.read_json(root / "state.json") or {}
                        if state.get("supervisor") != supervisor:
                            raise ValueError("The selected supervisor changed before acquiring its lifetime lock")
                        if state.get("process") or any((root / name).exists() for name in DISPATCH_FILES):
                            raise ValueError("Command dispatch preceded this handoff; preserve the original outcome")
                        if native._legacy_queue_gate_pending(root, state):
                            return _report(native, root, value, recovery_state="legacy_queue_gate_unresolved")
                        current_request, current_sha = _request(native, root)
                        if not capacity_changes.matches_request(native, value, current_request, current_sha):
                            raise ValueError("The handoff request changed before acquiring its lifetime lock")
                        stop = native.read_json(root / "stop-request.json")
                        result = native.read_json(root / "result.json")
                        if stop is not None and stop != value["stop_request"]:
                            raise ValueError("Preserve the separately requested cancellation; it is not this handoff")
                        if not native._supervisor_ended(supervisor):
                            return _report(native, root, value, recovery_state="supervisor_identity_unavailable")
                        directory = _directory(root, value["handoff_id"])
                        if value["phase"] not in ("archived", "resuming"):
                            if stop is None and result is None and value["phase"] == "prepared":
                                value.update(phase="archived", previous_owner_ended=True, archive={})
                            else:
                                if (stop != value["stop_request"] or not result or result.get("state") != "launch_failed" or
                                        result.get("stop_requested") is not True or result.get("supervisor") != supervisor or
                                        result.get("cancelled_before_dispatch") or
                                        result.get("error") not in ("stopped_before_memory_dispatch", "stopped_before_disk_dispatch", "stopped_before_dispatch")):
                                    raise ValueError("Wait for the exact original pre-dispatch stop acknowledgment; retain other outcomes")
                                archive = {}
                                for name in ("stop-request.json", "result.json", "state.json"):
                                    raw = (root / name).read_bytes()
                                    _archive(directory / name, raw)
                                    archive[name] = {"bytes": len(raw), "sha256": digest(raw)}
                                value.update(phase="archived", archive=archive, acknowledged_at=native.now())
                            _save(native, root, value)
                        value = capacity_changes.apply(native, root, value, directory,
                            lambda updated: _save(native, root, updated))
                        # A crash between archiving, unlinking and acquisition continues
                        # this same transition. Another original cancellation is never erased.
                        for name in ("stop-request.json", "result.json"):
                            path = root / name
                            if not path.exists():
                                continue
                            entry = value["archive"].get(name)
                            raw = path.read_bytes()
                            if not entry or len(raw) != entry["bytes"] or digest(raw) != entry["sha256"]:
                                raise ValueError("The native stop/outcome changed after its handoff archive")
                            archived = (directory / name).read_bytes()
                            if archived != raw:
                                raise ValueError("Retain the exact original archived native bytes")
                            path.unlink()
                        value.update(phase="resuming", resuming_at=native.now())
                        _save(native, root, value)
                        report = native._resume_capacity_locked(root, require_memory=require_memory, launcher=launcher)
                        if report.get("resumed"):
                            next_state = native.read_json(root / "state.json") or {}
                            value.update(phase="resumed", resumed_at=native.now(),
                                         replacement_supervisor=next_state.get("supervisor"))
                            _save(native, root, value)
                        return _report(native, root, value, **report)
        if time.monotonic() >= deadline:
            return pending
        time.sleep(0.25)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("inspect", "prepare"))
    parser.add_argument("operation_id")
    parser.add_argument("--host-root", default=str(Path(__file__).resolve().parent))
    parser.add_argument("--records-root")
    parser.add_argument("--handoff-id")
    parser.add_argument("--selection", help="JSON file containing the inspected handoff selection")
    parser.add_argument("--amendments", help="explicit memory/disk amendment JSON; inspect only")
    parser.add_argument("--placement", help="complete prepared physical placement JSON; inspect only")
    args = parser.parse_args(argv)
    try:
        from native_foreground import load_native
        native = load_native(args.host_root)
        root = native.run_path(args.operation_id, args.records_root)
        if not root.is_dir():
            raise ValueError("Select the original existing capacity record")
        if args.action == "inspect":
            _directory(root, args.handoff_id)
            amendments = json.loads(Path(args.amendments).read_text()) if args.amendments else None
            placement = json.loads(Path(args.placement).read_text()) if args.placement else None
            value = inspect(native, root, args.handoff_id, amendments=amendments, placement=placement)
        else:
            if args.amendments or args.placement:
                raise ValueError("Retain the capacity changes inside the inspected selection")
            if not args.selection:
                raise ValueError("Select the inspected original handoff JSON")
            selection = json.loads(Path(args.selection).read_text())
            if isinstance(selection, dict) and "handoff" in selection:
                selection = selection["handoff"]
            value = prepare(native, root, selection)
        print(json.dumps(value, ensure_ascii=False), flush=True)
        return 0
    except (OSError, ValueError, KeyError, TypeError, ImportError) as exc:
        print(json.dumps({"ok": False, "schema": SCHEMA, "error": type(exc).__name__, "message": str(exc)}),
              file=sys.stderr, flush=True)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
