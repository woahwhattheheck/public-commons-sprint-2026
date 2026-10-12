#!/usr/bin/env python3
"""MIT. Run the original native merchant receiver beside its private transport."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import subprocess
import sys
from datetime import datetime, timezone
from uuid import uuid4


def emit(value):
    print(json.dumps(value), flush=True)


def stop_owned(child):
    if child is None or child.poll() is not None:
        return
    child.terminate()
    try:
        child.wait(timeout=10)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait()


def interrupted(_signum, _frame):
    raise KeyboardInterrupt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, type=Path,
                        help="Private retained receiving directory; reuse it for the same operation.")
    parser.add_argument("--node", default="node", help="Existing Node.js24+ executable.")
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    directory = args.directory.expanduser().resolve()
    driver = here / "merchant-journey.mjs"
    bridge_source = here / "playground-bridge.py"
    node = shutil.which(args.node)
    if not node or not driver.is_file() or not bridge_source.is_file():
        raise RuntimeError("Use the complete receiving source and an existing Node24+ executable")
    version = subprocess.run([node, "--version"], check=True, capture_output=True, text=True).stdout.strip()
    if int(version.lstrip("v").split(".")[0]) < 24:
        raise RuntimeError("This portable receiver requires Node24 or newer")
    os.umask(0o077)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = (directory / "receiver.lock").open("a+b")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        raise RuntimeError("The original receiving directory already has an active receiver")
    attempt = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:8]
    metadata = directory / "native" / attempt
    metadata.mkdir(parents=True, mode=0o700)
    sources = {}
    for path in sorted(here.parent.rglob("*")):
        if path.is_file() and directory not in path.parents and "node_modules" not in path.parts:
            sources[str(path.relative_to(here.parent))] = {
                "bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
    state = {"schema": "stellar-forge.opensearch-receiving-attempt.v1",
             "phase": "STARTING", "node": version, "nodeExecutable": node,
             "python": sys.version.split()[0], "directory": str(directory),
             "metadata": str(metadata), "sources": sources}
    state_path = metadata / "receiver-state.json"

    def save(phase, **extra):
        state.update(phase=phase, updatedAt=datetime.now(timezone.utc).isoformat(), **extra)
        temporary = state_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(state, indent=2) + "\n")
        temporary.replace(state_path)

    bridge = None
    child = None
    errors = None
    old_sigterm = signal.signal(signal.SIGTERM, interrupted)
    try:
        save("STARTING")
        errors = (metadata / "bridge-stderr.log").open("a", encoding="utf-8")
        bridge = subprocess.Popen(
            [sys.executable, "-u", str(bridge_source), str(metadata)],
            stdout=subprocess.PIPE, stderr=errors, text=True,
        )
        with selectors.DefaultSelector() as selector:
            selector.register(bridge.stdout, selectors.EVENT_READ)
            if not selector.select(timeout=180):
                raise RuntimeError("Anonymous transport bootstrap exceeded180 seconds; inspect this attempt")
            line = bridge.stdout.readline()
        if not line:
            bridge.wait()
            raise RuntimeError("Anonymous transport ended before ready; inspect bridge-stderr.log")
        ready = json.loads(line)
        if ready.get("index") != "opensearch_dashboards_sample_data_flights":
            raise RuntimeError("The original public flights index is unavailable")
        environment = os.environ.copy()
        environment["OPENSEARCH_PLAYGROUND_ENDPOINT"] = ready["endpoint"]
        environment["OPENSEARCH_NATIVE_METADATA"] = str(metadata)
        environment["OPENSEARCH_RECEIVING_DIRECTORY"] = str(directory)
        save("BRIDGE_READY", engineVersion=ready["version"], index=ready["index"], bridgePid=bridge.pid)
        emit({"phase": "native_receiver_ready", "directory": str(directory),
              "metadata": str(metadata), "engineVersion": ready["version"],
              "sourceFiles": len(sources)})
        child = subprocess.Popen([node, "--max-old-space-size=192", str(driver)], env=environment)
        save("RUNNING", driverPid=child.pid)
        status = child.wait()
        save("COMPLETE" if status == 0 else "FAILED", driverExitCode=status)
        emit({"phase": "native_receiver_finished", "driverExitCode": status,
              "directory": str(directory), "metadata": str(metadata)})
        return status
    except KeyboardInterrupt:
        save("INTERRUPTED")
        return 130
    except Exception as error:
        save("FAILED", receiverError=str(error))
        emit({"phase": "native_receiver_error", "error": str(error), "metadata": str(metadata)})
        return 1
    finally:
        stop_owned(child)
        stop_owned(bridge)
        if bridge is not None and bridge.stdout is not None:
            bridge.stdout.close()
        if errors is not None:
            errors.close()
        signal.signal(signal.SIGTERM, old_sigterm)
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        emit({"phase": "native_receiver_setup_error", "error": str(error)})
        raise SystemExit(1)
