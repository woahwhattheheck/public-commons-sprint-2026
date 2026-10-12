#!/usr/bin/env python3
"""Run the complete original gRPC service-health merchant/customer workflow in one native placement.

The maintained placement, admission, supervision and artifact checkpoint tools
own execution. This caller supplies the selected public source and the one
operator journey; it preserves the separate request-stream and contract-upgrade operations.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import time

ROOT = Path("/workspace/scratch/9b238a12a516/grpc-health/native-operation")
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
OPERATION = "SCF-GRPC-SERVICE-HEALTH-20261012-9B23"
PLACEMENT = "scf-grpc-service-health-private-20261012-9b23"
CANDIDATE = "/dev/scf-grpc-service-health-9b23"
HOST_SHA256 = "136c70426e445c3a4d03ed1ada7419383f11d4798f1c58f14a9f6aa2a96af737"
SOURCE_COMMIT = "8eb016b93dbbc0becb0400b7e8df37dc23aad5d0"
DRIVER_BLOB = "797d17ec5208164bc9d144fa06ddbc84e10e52bd"
MEMORY_RESERVATIONS = Path("/workspace/shared/swarm/capacity/memory")
DISK_RESERVATIONS = Path("/workspace/shared/swarm/capacity/disk")
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
        require(stat.S_ISREG(before.st_mode) and before.st_size <= maximum,
                "Keep the bounded regular selected file: " + str(path))
        value = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
    require(len(value) <= maximum and before.st_size == after.st_size == len(value) and
            (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) ==
            (after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns),
            "The selected file changed: " + str(path))
    return value


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def configure(args):
    """Select existing worker paths; the operation, source and runtime stay pinned."""
    global ROOT, SOURCE, PAYLOAD, RUNNER, HOST, NODE, MODULES, CHROME, PLAYWRIGHT
    global RECORDS, PLANS, CANDIDATE, MEMORY_RESERVATIONS, DISK_RESERVATIONS
    ROOT = Path(args.root).expanduser().resolve(strict=True)
    HOST = Path(args.host).expanduser().resolve(strict=True)
    require(ROOT.is_dir() and HOST.is_dir(), "Select the prepared source root and maintained native host")
    SOURCE, PAYLOAD, RUNNER = ROOT / "source", ROOT / "payload", ROOT / "journey.mjs"
    RECORDS, PLANS = ROOT / "jobs", ROOT / "placements"
    # Resolve existing executable/package paths before the maintained runtime records them.
    NODE = Path(args.node).expanduser().resolve(strict=False)
    MODULES = Path(args.node_modules).expanduser().resolve(strict=False)
    CHROME = Path(args.chrome).expanduser().resolve(strict=False)
    PLAYWRIGHT = Path(args.playwright).expanduser().resolve(strict=False)
    candidate = Path(args.private_root).expanduser().resolve(strict=False)
    require(candidate != ROOT and ROOT not in candidate.parents and candidate not in ROOT.parents,
            "Keep retained source/records outside the invocation-private placement")
    CANDIDATE = str(candidate)
    MEMORY_RESERVATIONS = Path(args.memory_reservations_root).expanduser().resolve(strict=True)
    DISK_RESERVATIONS = Path(args.disk_reservations_root).expanduser().resolve(strict=True)
    require(MEMORY_RESERVATIONS.is_dir() and DISK_RESERVATIONS.is_dir(),
            "Select this worker's existing shared memory and disk reservation directories")
    for registry in (MEMORY_RESERVATIONS, DISK_RESERVATIONS):
        require(registry != candidate and candidate not in registry.parents,
                "Keep shared admission records outside the invocation-private placement")


def specification():
    require(SOURCE.is_dir() and PAYLOAD.is_dir(), "Run the exact source preparation first")
    require(NODE.is_file() and os.access(NODE, os.X_OK) and
            CHROME.is_file() and os.access(CHROME, os.X_OK),
            "Select the existing Node and Chromium executables")
    require(MODULES.is_dir() and PLAYWRIGHT.is_dir(),
            "Select the complete installed native and browser dependency closures")
    driver = selected_file(RUNNER, 128 * 1024)
    selection = selected_file(PAYLOAD / "selection.json", 4 * MIB)
    selected = json.loads(selection)
    pins = json.loads(selected_file(ROOT / "operation-source.json", MIB))
    require(selected["operation"] == OPERATION and pins["operation"] == OPERATION,
            "Keep the original service-health operation")
    require(blob(driver) == pins["driver_git_blob"] and
            hashlib.sha256(selection).hexdigest() == pins["selection_sha256"],
            "Keep the complete reviewed driver and selected source edition")
    require(selected["commit"] == pins["source_commit"] == SOURCE_COMMIT and
            pins["driver_git_blob"] == DRIVER_BLOB,
            "Keep the exact merged product and reviewed driver for this original operation")
    return {
        "schema": "commons.native-placement/v1",
        "placement_id": PLACEMENT,
        "business_operation_id": OPERATION,
        "source_identity": pins,
        "resource_plan": {
            "process_memory_mib": 1024,
            "source_copy_mib": 192,
            "private_growth_mib": 128,
            "memory_mib": 1344,
            "memory_reserve_mib": 256,
            "persistent_checkpoint_mib": 64,
            "notes": [
                "One real native gRPC server, the original workspace and merchant MCP, then one desktop/narrow browser editor.",
                "The complete 134,247,028-byte public source has a 192 MiB memory allowance including file/directory allocation.",
                "Private workspace, downloads and captures have a separate 128 MiB growth allowance.",
                "All tmpfs source and growth charges are included in memory; placement separately adds measured source-copy disk/inodes.",
                "The complete native checkpoint is synchronously retained outside the private invocation before exit."
            ]
        },
        "candidates": [{"id": "private-dev", "root": CANDIDATE}],
        "bindings": {
            "source": {"mode": "copy", "source": str(SOURCE), "target": "source",
                       "excludes": [".git", "node_modules"]},
            "selection": {"mode": "retain", "source": str(PAYLOAD / "selection.json")},
            "runner": {"mode": "retain", "source": str(RUNNER)}
        },
        "native": {
            "operation_id": OPERATION, "peer": "scf_engineering9b23",
            "command": [str(NODE), "--max-old-space-size=512", {"binding": "runner"},
                "--source", {"binding": "source"},
                "--selection", {"binding": "selection"},
                "--work-root", {"binding": "run"},
                "--node-modules", str(MODULES), "--chrome", str(CHROME),
                "--playwright", str(PLAYWRIGHT)],
            "project": {"binding": "run"}, "records_root": str(RECORDS),
            "worker_root": {"binding": "worker"}, "temp_root": {"binding": "temporary"},
            "memory_mib": 1344, "memory_reserve_mib": 256,
            "memory_reclaim": "clean-cache",
            "memory_reservations_root": str(MEMORY_RESERVATIONS),
            "disk_reservations_root": str(DISK_RESERVATIONS),
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
    parser.add_argument("--root", default=str(ROOT), help="Existing source-preparation root; retained records stay here")
    parser.add_argument("--host", default=str(HOST), help="Existing complete maintained 34-module native host")
    parser.add_argument("--node", default=str(NODE), help="Existing Node 22+ executable")
    parser.add_argument("--node-modules", default=str(MODULES), help="Existing complete original merchant/native dependency closure")
    parser.add_argument("--chrome", default=str(CHROME), help="Existing Chromium executable")
    parser.add_argument("--playwright", default=str(PLAYWRIGHT), help="Existing Playwright package directory")
    parser.add_argument("--private-root", default=CANDIDATE, help="Invocation-private native placement root")
    parser.add_argument("--memory-reservations-root", default=str(MEMORY_RESERVATIONS),
                        help="This worker's existing shared memory admission directory")
    parser.add_argument("--disk-reservations-root", default=str(DISK_RESERVATIONS),
                        help="This worker's existing shared disk admission directory")
    args = parser.parse_args()
    configure(args)
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
