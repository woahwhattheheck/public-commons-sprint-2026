"""One owning workspace/server/browser continuation of the retained ECB capture."""
from pathlib import Path
import argparse
import fcntl
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--operation-root", type=Path, required=True, help="Completed native ECB operation directory")
parser.add_argument("--capture-root", type=Path, required=True, help="Original captured provider files and receipts")
parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parent.parent,
                    help="Maintained sf30-seller-sdk/sdmx source directory")
parser.add_argument("--driver", type=Path, default=Path(__file__).resolve().with_name("browser-driver.cjs"))
parser.add_argument("--browser-debug", action="store_true", help="Include native Chromium startup and stderr")
ARGS = parser.parse_args()
BASE = ARGS.operation_root.expanduser().resolve()
SOURCE = ARGS.source_root.expanduser().resolve()
CAPTURE = ARGS.capture_root.expanduser().resolve()
PRIVATE = BASE / "workspace" / "tmp"
PRIVATE.mkdir(parents=True, exist_ok=True)
os.environ["TMPDIR"] = str(PRIVATE)
os.environ["SQLITE_TMPDIR"] = str(PRIVATE)
os.environ["SF30_XML_NODE"] = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE", "node")
tempfile.tempdir = str(PRIVATE)
sys.path.insert(0, str(SOURCE))
from sdmx_workspace import Workspace
from sdmx_server import OperatorServer

def write_private(path, value):
    data = (json.dumps(value, indent=2) + "\n").encode()
    temporary = path.with_suffix(path.suffix + ".pending")
    with os.fdopen(os.open(temporary, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600), "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)

def memory():
    result = {"tmpfs_available": os.statvfs(BASE).f_bavail * os.statvfs(BASE).f_frsize}
    for name in ("memory.current", "memory.max", "memory.events"):
        path = Path("/sys/fs/cgroup") / name
        try:
            result[name] = path.read_text().strip()
        except OSError:
            pass
    return result

def main():
    lock = (BASE / "browser-owner.lock").open("a+")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    operation = json.loads((BASE / "native-operation.json").read_text())
    output = BASE / "browser"
    output.mkdir(exist_ok=True, mode=0o700)
    temporary = PRIVATE / "operator-browser-temporary"
    temporary.mkdir(exist_ok=True, mode=0o700)
    workspace = Workspace(BASE / "workspace")
    server = OperatorServer(workspace, 0)
    thread = threading.Thread(target=server.serve_forever, name="sdmx-original-operator", daemon=False)
    thread.start()
    child = None
    status = {"schema": "stellar-forge.sdmx-browser-owner.v1", "status": "RUNNING",
              "workspace": str(BASE / "workspace"), "before": memory()}
    ready_path = BASE / "browser-ready.json"
    try:
        sources = {}
        for role, name, receipt_name in (
            ("catalog", "ecb-dataflows.xml", "ecb-dataflows.xml.receipt.json"),
            ("metadata", "ecb-exr-dataflow.xml", "ecb-exr-dataflow.receipt.json"),
            ("generic", "ecb-exr-2025-generic.xml", "ecb-exr-2025-generic.xml.receipt.json"),
            ("csv", "ecb-exr-2025.csv", "ecb-exr-2025.csv.receipt.json"),
        ):
            ident = operation["sources"][name]
            info = workspace.source(ident)["source"]
            receipt = json.loads((CAPTURE / receipt_name).read_text())
            sources[role] = {"id": ident, "path": str(CAPTURE / name), "label": info["label"],
                "origin": receipt["url"], "kind": info["kind"]}
        ready = {"schema": "stellar-forge.sdmx-browser-ready.v1", "url": server.url,
            "workspace": str(BASE / "workspace"), "source_root": str(SOURCE),
            "output_directory": str(output), "sources": sources,
            "original_project": operation["export"]["project"],
            "original_snapshot": operation["export"]["snapshot"],
            "original_packet": operation["packet"]["path"],
            "review_title": "ECB operator review - original 2025 capture"}
        write_private(ready_path, ready)
        env = dict(os.environ, TMPDIR=str(temporary))
        if ARGS.browser_debug:
            env["DEBUG"] = "pw:browser"
        argv = [os.environ.get("CODEX_PRIMARY_RUNTIME_NODE", "node"), "--max-old-space-size=192",
                str(ARGS.driver.expanduser().resolve()), str(ready_path)]
        print(json.dumps({"phase": "operator_ready", "ready_path": str(ready_path), "before": status["before"]}), flush=True)
        child = subprocess.Popen(argv, env=env, start_new_session=True)
        returncode = child.wait(timeout=420)
        status.update({"browser_exit": returncode, "status": "PASS" if returncode == 0 else "FAILED"})
        return returncode
    finally:
        if child is not None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait(timeout=5)
        server.shutdown()
        server.server_close()
        thread.join(timeout=10)
        workspace.close()
        shutil.rmtree(temporary, ignore_errors=True)
        status["after"] = memory()
        write_private(output / "owner-result.json", status)
        print(json.dumps({"phase": "operator_closed", **status}), flush=True)
        lock.close()

def terminate_owner(signum, frame):
    raise KeyboardInterrupt

if __name__ == "__main__":
    signal.signal(signal.SIGTERM, terminate_owner)
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
