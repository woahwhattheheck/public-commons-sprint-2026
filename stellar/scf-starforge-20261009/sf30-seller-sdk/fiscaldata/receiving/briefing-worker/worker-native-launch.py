#!/usr/bin/env python3
"""Use the original native ForegroundLaunch for the prepared Fiscal receiving."""
import hashlib
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace

root = Path(__file__).resolve().parent.parent
config_bytes = (root / "inbox/worker-config.json").read_bytes()
config = json.loads(config_bytes)
runtime = json.loads((root / "worker-runtime.json").read_text())
if runtime.get("schema") != "fiscal-briefing-worker-runtime.v1" or runtime.get("configurationSha256") != hashlib.sha256(config_bytes).hexdigest():
    raise ValueError("Use the original setup's exact retained runtime selection")
for field in ("operationId", "workerId", "sandboxId", "directory"):
    if runtime.get(field) != config.get(field):
        raise ValueError("Original runtime and operation identities differ")
config = {**config, **{key: runtime[key] for key in ("node", "playwrightModules", "chromium", "chromiumDirectory")}}
operation = "fiscal-treasury-briefing-7108-20261012"
if config["schema"] != "fiscal-briefing-worker.v1" or config["operationId"] != operation or config["directory"] != str(root):
    raise ValueError("Retain the exact original worker and source selection")
host = Path(config["controllerHost"])
if root not in host.parents or host.resolve() != host:
    raise ValueError("Use the complete original controller within this private handoff")
shared = "/root/commons-scf-0b8d-20261012/control"
if config["sharedStateRoot"] != shared:
    raise ValueError("Keep the existing worker's shared native capacity roots")
os.environ["SWARM_STATE_ROOT"] = shared
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
sys.path.insert(0, str(host))
from native_foreground import load_native, ForegroundLaunch
native = load_native(host)
args = SimpleNamespace(
    peer="7108-scf-integration", operation_id=operation, project=str(root),
    java=None, node=None, artifact=[],
    artifact_on_success=[
        "native-output/receiving-result.json", "worker-output/continuation-result.json",
        "worker-output/customer-briefing.tar.gz", "worker-output/customer-briefing-manifest.json",
        "worker-output/native-cli-history.json", "caller-substitutions.json",
        "worker-output/qa-briefing-desktop.png", "worker-output/qa-removed-observation-desktop.png",
        "worker-output/qa-briefing-mobile.png", "worker-output/qa-removed-observation-mobile.png"
    ],
    runtime_path=[
        str(host), str(root / "inbox"), str(root / "worker-receive.mjs"),
        str(root / "worker-runtime.json"), str(Path(sys.executable).resolve()),
        config["node"], config["playwrightModules"], config["chromiumDirectory"]
    ],
    command=[config["node"], str(root / "worker-receive.mjs")],
    memory_mib=512, memory_reserve_mib=128, memory_reclaim="clean-cache",
    memory_reservations_root=config["memoryReservationsRoot"],
    disk_space=[str(root) + "=32"], disk_inodes=[], disk_reserve_mib=64,
    disk_reserve_inodes=128, disk_reservations_root=config["diskReservationsRoot"],
    runtime_consumers_root=config["runtimeConsumersRoot"],
    records_root=str(root / "control/records"), worker_root=str(root / "control/workers"),
    temp_root=str(root / "control/tmp")
)
launcher = ForegroundLaunch(native)
try:
    report = native.start(args, launcher=launcher)
    print(json.dumps({key: report.get(key) for key in ("ok", "state", "operation_id", "record", "memory", "disk", "process", "supervisor", "reused")}), flush=True)
finally:
    if launcher.root is not None:
        code = launcher.handoff()
        if code is not None:
            raise SystemExit(code)
