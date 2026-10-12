#!/usr/bin/env python3
"""Admit the GIS receiving operation through the worker's maintained controller."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--root", required=True)
parser.add_argument("--controller-host", required=True)
parser.add_argument("--shared-state-root", required=True)
parser.add_argument("--python", default=sys.executable)
parser.add_argument("--chromium")
parser.add_argument("--node")
parser.add_argument("--playwright")
arguments = parser.parse_args()
root = Path(arguments.root).resolve(strict=True)
controller = Path(arguments.controller_host).resolve(strict=True)
shared = Path(arguments.shared_state_root).resolve(strict=True)
os.environ["SWARM_STATE_ROOT"] = str(shared)
sys.path.insert(0, str(controller))
from native_foreground import ForegroundLaunch, load_native

command = [arguments.python, "-B", str(root / "inbox" / "native_spatial_receive.py"),
           "--root", str(root / "customer-run"),
           "--source-capsule", str(root / "inbox" / "source-capsule.json"),
           "--customer-zip", str(root / "inbox" / "SCF_DuckDB_Customer_Receiving_20261012.zip"),
           "--python", arguments.python, "--install-runtime", "--acquire-spatial"]
runtime_paths = [str(controller), str(root / "inbox"), arguments.python,
                 str(Path(arguments.python).resolve())]
for name in ("chromium", "node", "playwright"):
    value = getattr(arguments, name)
    if value:
        command.extend(["--" + name, value])
        runtime_paths.append(value)

native = load_native(controller)
intent = SimpleNamespace(
    peer="5eee-scf-duckdb-gis", operation_id="SCF-DUCKDB-GIS-CUSTOMER-5EEE-20261012",
    project=str(root), java=None, node=None,
    artifact=["customer-run/receiving.json", "customer-run/operation/native-gis-result.json",
              "customer-run/operation/browser/browser-result.json",
              "customer-run/operation/portable/handoff.json"],
    runtime_path=runtime_paths, command=command,
    memory_mib=768, memory_reserve_mib=128, memory_reclaim="clean-cache",
    memory_reservations_root=str(shared / "capacity" / "memory"),
    disk_space=[str(root) + "=1024"], disk_inodes=[str(root) + "=2048"],
    disk_reserve_mib=128, disk_reserve_inodes=128,
    disk_reservations_root=str(shared / "capacity" / "disk"),
    records_root=str(root / "control" / "records"), worker_root=str(root / "control" / "worker"),
    temp_root=str(root / "control" / "tmp"))
launch = ForegroundLaunch(native)
try:
    result = native.start(intent, launcher=launch)
    print(json.dumps({key: result.get(key) for key in
                     ("ok", "state", "operation_id", "record", "memory", "disk",
                      "process", "supervisor", "reused")}), flush=True)
finally:
    if launch.root is not None:
        code = launch.handoff()
        if code is not None:
            raise SystemExit(code)
