#!/usr/bin/env python3
"""Launch the one original file-job operation through the existing worker controller."""
from pathlib import Path
from types import SimpleNamespace
import hashlib
import json
import os
import runpy
import sys

ROOT = Path(__file__).resolve().parent.parent
OPERATION = "SCF-NDJSON-FILE-JOBS-3AD791-20261012"
setup = runpy.run_path(str(ROOT / "inbox/prepare-ndjson.py"))
before = json.loads(setup["read_regular"](ROOT / "prepared-inputs.json", 1024 * 1024))
receipt = setup["prepare"](before["sharedStateRoot"])
if receipt["operationId"] != OPERATION:
    raise RuntimeError("original native operation differs")
shared = Path(receipt["sharedStateRoot"])
os.environ["SWARM_STATE_ROOT"] = str(shared)
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
host = ROOT / "controller/host"
sys.path.insert(0, str(host))
from native_foreground import ForegroundLaunch, load_native
native = load_native(host)
runtime = receipt["runtime"]
args = SimpleNamespace(
    peer="3ad791-ndjson-file-jobs", operation_id=OPERATION,
    project=str(ROOT / "project"), java=None, node=None,
    command=[runtime["python"], "-B", str(ROOT / "inbox/execute-ndjson.py")],
    artifact=[],
    artifact_on_success=["receiving", "native-input.json", "runtime-receipt.json", "source-manifest.json"],
    artifact_on_failure=["receiving", "native-input.json", "runtime-receipt.json",
                         "runtime-install.stdout.log", "runtime-install.stderr.log", "native-preparation-error.json"],
    runtime_path=[str(host), str(ROOT / "project"), str(ROOT / "inbox"),
                  runtime["node"], runtime["python"], str(Path(runtime["npm"]).parent.parent)],
    memory_mib=512, memory_reserve_mib=128, memory_reclaim="clean-cache",
    memory_reservations_root=str(shared / "capacity/memory"),
    disk_space=[str(ROOT) + "=96"], disk_inodes=[str(ROOT) + "=8192"],
    disk_reserve_mib=64, disk_reserve_inodes=128,
    disk_reservations_root=str(shared / "capacity/disk"),
    records_root=str(ROOT / "control/records"),
    worker_root=str(ROOT / "control/worker"), temp_root=str(ROOT / "control/tmp"),
)
launch = ForegroundLaunch(native)
try:
    result = native.start(args, launcher=launch)
    print(json.dumps({
        "schema": "scf.ndjson-file-jobs-equipped-launch.v1",
        "operationId": OPERATION,
        "expectedRecord": str(ROOT / "control/records" / hashlib.sha256(OPERATION.encode()).hexdigest()),
        "native": {name: result.get(name) for name in
                   ("ok", "state", "operation_id", "record", "memory", "disk", "process", "supervisor", "reused")}
    }, sort_keys=True), flush=True)
finally:
    if launch.root is not None:
        code = launch.handoff()
        if code is not None:
            raise SystemExit(code)
