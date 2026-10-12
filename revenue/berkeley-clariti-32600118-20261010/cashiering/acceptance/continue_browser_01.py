#!/usr/bin/env python3
"""Continue the accepted Berkeley browser checkpoint after its recorded navigation failure."""
from pathlib import Path
import hashlib
import json
import os
import socket
import subprocess
import sys

ROOT = Path("/workspace/scratch/82e467d92cd6/berkeley-cashiering-engineering")
LOGICAL_OPERATION = "berkeley-daily-cashiering-browser-82e4-20261012"
NATIVE_OPERATION = LOGICAL_OPERATION + "-continuation-01"
ORIGINAL_RECORD = "b61600ae0b69a827ef5e19a5a5a721a0944af5989fcf314ff9fa2b279eb8482d"
SOURCE_COMMIT = "94003ed441a0633b828ed7b8ac389c064706427d"
BEFORE_SHA256 = "f6b27b7b6c23b9b339065b6258b2b1a667ddda4f41133e52fe809e8ed75e43ca"
AFTER_BLOB = "b1e34381bfbacaf96e511f165d6d39d59d4f8999"
CHECKPOINT_SHA256 = "58cded4b5be777c515027a67090c1afb7f507fab7b1faaf91370c9578cc6c1f9"
NODE = Path("/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node")
PYTHON = Path("/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3")
PLAYWRIGHT = Path("/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")
BROWSER = Path("/workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell")
SOURCE = ROOT / "source/revenue/berkeley-clariti-32600118-20261010"
CONTROLLER = ROOT / "browser-continuation.mjs"
BEFORE_LINE = "async function tab(name,p=page){await clickAction('tab',{tab:name},p,'#app');}"
AFTER_LINE = """async function tab(name,p=page){await clickAction('tab',{tab:name},p,'#app nav[aria-label="Cashiering workspace"]');}"""

def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def sha256(data):
    return hashlib.sha256(data).hexdigest()

def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

def main():
    require(len(sys.argv) == 1, "This retained continuation has no alternate case or input arguments.")
    selection = json.loads((ROOT / "native-run/native-host-source.json").read_text())
    host = Path(selection["original_host"])
    require(host == Path("/workspace/scratch/d76c9c89fb9e/native-prepared-stop-20261012/host") and len(selection["files"]) == 71,
            "The original complete maintained host selection differs.")
    for item in selection["files"]:
        require(git_blob((host / item["path"]).read_bytes()) == item["sha"],
                "The retained complete native host changed: " + item["path"])
    sys.path.insert(0, str(host))
    import swarm_cloud_job as native

    records = ROOT / "native-records"
    original = records / ORIGINAL_RECORD
    observed = native.inspect(original, runtime_view="compact")
    require(observed.get("operation_id") == LOGICAL_OPERATION, "Original native identity differs.")
    require(observed.get("state") == "failed" and observed.get("exit_code") == 1,
            "The original failed child must remain the retained original.")
    require(observed.get("supervisor_alive") is False and observed.get("process_alive") is False,
            "The original native process is still active or uncertain.")
    continuation = native.run_path(NATIVE_OPERATION, records)
    if continuation.exists():
        existing = native.inspect(continuation, runtime_view="compact")
        print(json.dumps({
            "status": "existing_continuation",
            "record": str(continuation),
            "operation_id": NATIVE_OPERATION,
            "state": existing.get("state"),
            "supervisor_alive": existing.get("supervisor_alive"),
            "process_alive": existing.get("process_alive"),
            "action": "No second dispatch. Observe or recover this recorded continuation."
        }), flush=True)
        return

    checkpoint_path = ROOT / "browser-run/checkpoint.json"
    checkpoint_bytes = checkpoint_path.read_bytes()
    require(sha256(checkpoint_bytes) == CHECKPOINT_SHA256,
            "The accepted checkpoint changed; reconcile its actual state before this first continuation.")
    checkpoint = json.loads(checkpoint_bytes)
    require(checkpoint["operation"] == LOGICAL_OPERATION and checkpoint["status"] == "STOPPED",
            "The original logical browser operation is not at its retained stop.")
    phases = checkpoint["phases"]
    require(len(phases) == 9 and all(value["status"] == "PASS" for value in phases.values()),
            "Expected the nine accepted original browser phases.")
    require(checkpoint["active_phase"]["key"] == "10-explicit-allocation",
            "The saved unfinished phase differs.")
    require(not any(key.startswith("allocate-") for key in checkpoint["actions"]),
            "An allocation outcome exists; reconcile it before this continuation.")
    last = checkpoint["attempts"][-1]
    require("strict mode violation" in last["error"]["message"] and
            "reconciliation" in last["error"]["message"] and
            "resolved to 2 elements" in last["error"]["message"],
            "The retained stop is not the reviewed navigation selector failure.")
    require(not last.get("cleanup_error") and checkpoint["server"].get("closed_at") and
            checkpoint["server"].get("exit_code") == 0,
            "Original application cleanup is incomplete.")
    with socket.socket() as probe:
        probe.settimeout(0.5)
        require(probe.connect_ex(("127.0.0.1", 8798)) != 0,
                "The intended loopback port already has a listener; preserve it and reconcile ownership.")
    for relative, identity in last["source"].items():
        data = (SOURCE / relative).read_bytes()
        require(len(data) == identity["bytes"] and sha256(data) == identity["sha256"],
                "A production source changed: " + relative)
    for executable in (NODE, PYTHON, PLAYWRIGHT, BROWSER):
        require(executable.is_file(), "A retained dependency is absent: " + str(executable))

    before = CONTROLLER.read_bytes()
    if git_blob(before) == AFTER_BLOB:
        corrected = before
    else:
        require(sha256(before) == BEFORE_SHA256, "Controller preimage is not the retained f797 source.")
        value = before.decode("utf-8")
        require(value.count(BEFORE_LINE) == 1, "The original navigation selector is not unique in source.")
        corrected = value.replace(BEFORE_LINE, AFTER_LINE).encode("utf-8")
        require(git_blob(corrected) == AFTER_BLOB, "The correction differs from its verified Git blob.")
        temporary = CONTROLLER.with_name(CONTROLLER.name + ".navigation-correction.tmp")
        temporary.write_bytes(corrected)
        os.replace(temporary, CONTROLLER)
    subprocess.run([str(NODE), "--check", str(CONTROLLER)], check=True)

    argv = [
        str(PYTHON), "-B", str(host / "swarm_cloud_job.py"), "run", "local",
        "--operation-id", NATIVE_OPERATION, "--project", str(ROOT),
        "--worker-root", str(ROOT / "browser-worker"),
        "--temp-root", str(ROOT / "browser-tmp"),
        "--records-root", str(records),
        "--memory-mib", "512", "--memory-reserve-mib", "256",
        "--memory-reservations-root", "/workspace/shared/swarm/capacity/memory",
        "--memory-reclaim", "clean-cache",
        "--disk-space", str(ROOT) + "=64",
        "--disk-inodes", str(ROOT) + "=2048",
        "--disk-reserve-mib", "16", "--disk-reserve-inodes", "64",
        "--disk-reservations-root", "/workspace/shared/swarm/capacity/disk",
        "--artifact", "browser-run", "--",
        str(NODE), str(CONTROLLER),
        "--root", str(ROOT), "--source", str(SOURCE),
        "--native-result", str(ROOT / "native-run/result.json"),
        "--output", str(ROOT / "browser-run"),
        "--python", str(PYTHON), "--playwright", str(PLAYWRIGHT),
        "--browser", str(BROWSER), "--port", "8798",
        "--operation-id", LOGICAL_OPERATION,
    ]
    receipt = {
        "schema": "berkeley.cashiering.browser-native-continuation.v1",
        "original_record": str(original),
        "native_operation_id": NATIVE_OPERATION,
        "logical_operation_id": LOGICAL_OPERATION,
        "source_commit": SOURCE_COMMIT,
        "controller": {"path": str(CONTROLLER), "bytes": len(corrected),
                       "sha256": sha256(corrected), "git_blob": AFTER_BLOB},
        "checkpoint": {"path": str(checkpoint_path), "bytes": len(checkpoint_bytes),
                       "sha256": CHECKPOINT_SHA256},
        "accepted_phase_ids": list(phases),
        "continue_at": "10-explicit-allocation",
        "database_path": checkpoint["database_path"],
        "run_id": checkpoint["bindings"]["run_id"],
        "command": argv,
    }
    destination = ROOT / "browser-run/continuation-01-source.json"
    if destination.exists():
        require(json.loads(destination.read_text()) == receipt,
                "A different continuation source receipt already exists.")
    else:
        temporary = destination.with_suffix(".tmp")
        temporary.write_text(json.dumps(receipt, indent=2) + "\n")
        os.replace(temporary, destination)
    print(json.dumps({"status": "prepared", "receipt": str(destination),
                      "original_record": str(original), "native_operation_id": NATIVE_OPERATION,
                      "logical_operation_id": LOGICAL_OPERATION, "accepted_phases": 9,
                      "controller_sha256": receipt["controller"]["sha256"]}), flush=True)
    # This exact maintained host's ordinary run local follows the child itself.
    # --follow is a separate resume/log option and is not used for first registration.
    os.execv(str(PYTHON), argv)

if __name__ == "__main__":
    main()
