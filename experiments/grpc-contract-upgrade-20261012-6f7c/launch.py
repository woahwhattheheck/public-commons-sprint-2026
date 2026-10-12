#!/usr/bin/env python3
"""Run the complete original gRPC Contract upgrades workflow in one native placement.

The maintained placement, admission, supervision and artifact checkpoint tools
own execution. This caller supplies the selected public source and the one
operator journey; it never starts the earlier reflection/streaming operation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path("/workspace/scratch/6f7c5af20f40/scf-grpc-contract-upgrade")
SOURCE = ROOT / "source"
PAYLOAD = ROOT / "payload"
RUNNER = ROOT / "journey.mjs"
HOST = Path("/workspace/scratch/d76c9c89fb9e/native-prepared-stop-20261012/host")
NODE = Path("/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node")
MODULES = Path("/workspace/scratch/6f7c5af20f40/scf-grpc-runtime/node_modules")
CHROME = Path("/workspace/scratch/7573d13065d5/aurora_ops/browser-runtime/tmp/chromium")
PLAYWRIGHT = Path("/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")
RECORDS = ROOT / "jobs"
PLANS = ROOT / "placements"
OPERATION = "SCF-GRPC-CONTRACT-UPGRADE-20261012-6F7C"
PLACEMENT = "scf-grpc-contract-upgrade-private-20261012-6f7c"
CANDIDATE = "/dev/scf-grpc-contract-upgrade-6f7c"
HOST_SHA256 = "136c70426e445c3a4d03ed1ada7419383f11d4798f1c58f14a9f6aa2a96af737"
MIB = 1024 * 1024


def require(value, message):
    if not value:
        raise ValueError(message)


def blob(value):
    return hashlib.sha1(b"blob " + str(len(value)).encode("ascii") + b"\0" + value).hexdigest()


def selected_file(path, maximum):
    path = Path(path)
    require(path.resolve(strict=True) == path and not path.is_symlink(),
            "Keep the canonical selected file: " + str(path))
    with path.open("rb") as stream:
        before = os.fstat(stream.fileno())
        value = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
    require(len(value) <= maximum and before.st_size == after.st_size == len(value) and
            (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) ==
            (after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns),
            "The selected file changed: " + str(path))
    return value


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def specification():
    driver = selected_file(RUNNER, 128 * 1024)
    selection = selected_file(PAYLOAD / "selection.json", 4 * MIB)
    selected = json.loads(selection)
    pins = json.loads(selected_file(ROOT / "operation-source.json", MIB))
    require(selected["operation"] == OPERATION and pins["operation"] == OPERATION,
            "Keep the original upgrade operation")
    require(blob(driver) == pins["driver_git_blob"] and
            hashlib.sha256(selection).hexdigest() == pins["selection_sha256"],
            "Keep the complete reviewed driver and selected source edition")
    require(selected["commit"] == pins["source_commit"],
            "Keep the source commit selected for this original operation")
    return {
        "schema": "commons.native-placement/v1",
        "placement_id": PLACEMENT,
        "business_operation_id": OPERATION,
        "source_identity": pins,
        "resource_plan": {
            "process_memory_mib": 1024,
            "private_growth_mib": 128,
            "memory_mib": 1152,
            "memory_reserve_mib": 256,
            "persistent_checkpoint_mib": 64,
            "notes": [
                "One real native gRPC server, one original workspace, then one browser with two pages.",
                "The copied public source and private workspace, downloads and captures fit the 128 MiB private envelope.",
                "Private tmpfs growth is included in memory; placement also counts its source-copy allocation.",
                "The complete native checkpoint is synchronously retained outside the private invocation before exit."
            ]
        },
        "candidates": [{"id": "private-dev", "root": CANDIDATE}],
        "bindings": {
            "source": {"mode": "copy", "source": str(SOURCE), "target": "source",
                       "excludes": ["experiments", ".git", "node_modules"]},
            "patches": {"mode": "retain", "source": str(PAYLOAD)},
            "runner": {"mode": "retain", "source": str(RUNNER)}
        },
        "native": {
            "operation_id": OPERATION, "peer": "scf_integration6f7c",
            "command": [str(NODE), {"binding": "runner"},
                "--source", {"binding": "source"},
                "--patches", {"binding": "patches"},
                "--work-root", {"binding": "run"},
                "--node-modules", str(MODULES), "--chrome", str(CHROME),
                "--playwright", str(PLAYWRIGHT)],
            "project": {"binding": "run"}, "records_root": str(RECORDS),
            "worker_root": {"binding": "worker"}, "temp_root": {"binding": "temporary"},
            "memory_mib": 1152, "memory_reserve_mib": 256,
            "memory_reclaim": "clean-cache",
            "memory_reservations_root": "/workspace/shared/swarm/capacity/memory",
            "disk_reservations_root": "/workspace/shared/swarm/capacity/disk",
            "runtime_consumers_root": None,
            "disk_space": [{"path": {"binding": "run"}, "mib": 128},
                           {"path": str(ROOT), "mib": 64}],
            "disk_inodes": [{"path": {"binding": "run"}, "count": 4096},
                            {"path": str(ROOT), "count": 2048}],
            "disk_reserve_mib": 64, "disk_reserve_inodes": 128,
            "artifact": [], "artifact_on_success": ["result.json", "executed-source.json",
                "checkpoint-receipt.json"],
            "artifact_on_failure": [], "retain_artifacts": True,
            "runtime_path": [str(NODE.parent.parent), str(MODULES), str(CHROME.parent),
                             str(PLAYWRIGHT)]
        }
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("preview", "run", "status"))
    args = parser.parse_args()
    sys.path.insert(0, str(HOST))
    from native_foreground import ForegroundLaunch, load_native
    from native_runtime_handoff import runtime_identity
    import native_placement as placement
    native = load_native(HOST)
    record = native.run_path(OPERATION, RECORDS)
    if args.action == "status":
        emit({"operation": OPERATION, "record": str(record),
              "native": native.inspect(record) if (record / "request.json").is_file() else None})
        return 0
    if (record / "request.json").is_file():
        status = native.inspect(record)
        emit({"operation": OPERATION, "record": str(record), "reused": True, "native": status,
              "action": "Read the original session or its retained checkpoint; do not bind another private namespace."})
        return native.exit_status(status) if status.get("state") in ("completed", "failed", "launch_failed") else 75
    require(runtime_identity(native)["sha256"] == HOST_SHA256,
            "Use the complete original checkpoint-capable native runtime")
    spec = specification()
    if args.action == "preview":
        emit({"operation": OPERATION, "placement": placement.preview(spec, native=native)})
        return 0
    prepared = placement.prepare(spec, str(PLANS), native=native)
    emit({"stage": "placement_prepared", "result": prepared})
    if prepared["phase"] == "awaiting_capacity":
        return 75
    previous_phase = None
    while True:
        ready = placement.materialize(str(PLANS), PLACEMENT, native=native)
        phase = ready["phase"]
        if phase != previous_phase:
            emit({"stage": "placement_materialized", "result": ready})
            previous_phase = phase
        if phase == "ready":
            break
        require(phase in ("waiting_predecessor", "waiting_predecessor_release"),
                "Inspect the original retained placement phase: " + str(phase))
        time.sleep(2)
    launcher = ForegroundLaunch(native)
    started = None
    try:
        started = placement.start(str(PLANS), PLACEMENT, native=native, launcher=launcher)
        emit({"stage": "native_started", "result": started})
    finally:
        if launcher.root is not None:
            status = launcher.handoff()
            if status is not None:
                return status
    observed = native.inspect(Path(started["native"]["record"]))
    emit({"stage": "native_observed", "result": observed})
    return native.exit_status(observed)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError) as error:
        emit({"operation": OPERATION, "error": type(error).__name__, "message": str(error),
              "errno": getattr(error, "errno", None)})
        raise SystemExit(2)
