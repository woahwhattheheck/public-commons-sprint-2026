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
parser.add_argument("--operation-root", type=Path, required=True,
                    help="Existing native operation, or a new private receiving directory")
parser.add_argument("--capture-root", type=Path, required=True,
                    help="Original captured provider files and receipts")
parser.add_argument("--project-packet", type=Path,
                    help="Exact exported project packet used to open a new receiving operation")
parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parent.parent,
                    help="Maintained sf30-seller-sdk/sdmx source directory")
parser.add_argument("--driver", type=Path, default=Path(__file__).resolve().with_name("browser-driver.cjs"))
parser.add_argument("--browser-debug", action="store_true", help="Include native Chromium startup and stderr")
ARGS = parser.parse_args()
BASE = ARGS.operation_root.expanduser().resolve()
SOURCE = ARGS.source_root.expanduser().resolve()
CAPTURE = ARGS.capture_root.expanduser().resolve()
BASE.mkdir(parents=True, exist_ok=True, mode=0o700)
BOOTSTRAP_TEMP = BASE / "owner-tmp"
BOOTSTRAP_TEMP.mkdir(exist_ok=True, mode=0o700)
os.environ["TMPDIR"] = str(BOOTSTRAP_TEMP)
os.environ["SQLITE_TMPDIR"] = str(BOOTSTRAP_TEMP)
os.environ.setdefault("SF30_XML_NODE", os.environ.get("CODEX_PRIMARY_RUNTIME_NODE", "node"))
tempfile.tempdir = str(BOOTSTRAP_TEMP)
sys.path.insert(0, str(SOURCE))
from sdmx_workspace import Workspace
from sdmx_server import OperatorServer

CAPTURES = (
    ("catalog", "ecb-dataflows.xml"),
    ("metadata", "ecb-exr-dataflow.xml"),
    ("generic", "ecb-exr-2025-generic.xml"),
    ("csv", "ecb-exr-2025.csv"),
)

def write_private(path, value):
    data = (json.dumps(value, indent=2) + "\n").encode()
    temporary = path.with_suffix(path.suffix + ".pending")
    with os.fdopen(os.open(temporary, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600), "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)

def file_identity(path):
    digest, size = hashlib.sha256(), 0
    with path.open("rb") as stream:
        while block := stream.read(65536):
            digest.update(block)
            size += len(block)
    return {"sha256": digest.hexdigest(), "bytes": size}

def captured_sources():
    records = []
    for role, name in CAPTURES:
        path = CAPTURE / name
        receipt_path = CAPTURE / (name + ".receipt.json")
        if not receipt_path.exists() and name == "ecb-exr-dataflow.xml":
            # The first local capture used this name; the published example uses
            # the complete original filename plus .receipt.json.
            receipt_path = CAPTURE / "ecb-exr-dataflow.receipt.json"
        receipt = json.loads(receipt_path.read_text())
        identity = file_identity(path)
        if any(receipt.get(key) != value for key, value in identity.items()):
            raise ValueError("Captured source differs from its retained receipt: " + name)
        if not isinstance(receipt.get("url"), str) or not receipt["url"].startswith(("https://", "http://")):
            raise ValueError("Captured source needs its original provider URL: " + name)
        records.append({"role": role, "name": name, "path": path,
                        "receipt": receipt, "id": identity["sha256"], **identity})
    return records

def prepare_operation(workspace, records, operation, restore):
    packet = ARGS.project_packet.expanduser().resolve() if ARGS.project_packet else None
    if restore:
        if packet is None and operation:
            previous = operation.get("packet", {}).get("path")
            packet = Path(previous).expanduser().resolve() if previous else None
        if packet is None or not packet.is_file():
            raise ValueError("Use --project-packet with the original exported SDMX project for a new operation")
        restored = workspace.import_packet(packet)
        project = {"id": restored["project"]["id"], "revision": restored["project"]["revision"]}
        snapshot = restored["build"]["snapshot"]
        if operation and (operation["export"]["project"] != project or operation["export"]["snapshot"] != snapshot):
            raise ValueError("The supplied packet differs from the original operation's saved project")
    else:
        project = operation["export"]["project"]
        view = workspace.project(project["id"], project["revision"])
        snapshot = view["build"]["snapshot"]
        if snapshot != operation["export"]["snapshot"]:
            raise ValueError("The retained native project differs from the original operation snapshot")

    known = {item["id"]: item for item in workspace.state()["sources"]}
    source_ids = dict(operation.get("sources", {})) if operation else {}
    sources = {}
    for item in records:
        old_id = source_ids.get(item["name"])
        if old_id is not None and old_id != item["id"]:
            raise ValueError("The captured edition differs from the operation source: " + item["name"])
        info = known.get(item["id"])
        if restore or info is None:
            metadata = {"name": item["name"], "label": info["label"] if info else item["name"],
                        "origin": item["receipt"]["url"], "kind": "auto", "receipt": item["receipt"]}
            headers = item["receipt"].get("response_headers", {})
            media_type = next((value for key, value in headers.items() if key.lower() == "content-type"), None)
            if media_type:
                metadata["media_type"] = media_type
            with item["path"].open("rb") as stream:
                info = workspace.add_source(stream, metadata)
            if info["id"] != item["id"]:
                raise ValueError("Retained source identity changed: " + item["name"])
        source_ids[item["name"]] = info["id"]
        sources[item["role"]] = {"id": info["id"], "path": str(item["path"]), "label": info["label"],
                                  "origin": item["receipt"]["url"], "kind": info["kind"]}
    if restore:
        packet_record = {"path": str(packet), **file_identity(packet), "project": project,
                         "snapshot": snapshot, "source_count": restored["source_count"],
                         "revision_count": restored["revision_count"]}
        previous = operation or {}
        operation = {**previous, "schema": previous.get("schema", "stellar-forge.sdmx-browser-receiving-operation.v1"),
                     "sources": source_ids, "export": {**previous.get("export", {}), "project": project, "snapshot": snapshot},
                     "packet": packet_record}
        write_private(BASE / "native-operation.json", operation)
    return operation, sources

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
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BaseException:
        lock.close()
        raise
    output = BASE / "browser"
    output.mkdir(exist_ok=True, mode=0o700)
    child = server = thread = workspace = temporary = None
    status = {"schema": "stellar-forge.sdmx-browser-owner.v1", "status": "RUNNING",
              "workspace": str(BASE / "workspace"), "before": memory()}
    ready_path = BASE / "browser-ready.json"
    try:
        records = captured_sources()
        operation_path = BASE / "native-operation.json"
        operation = json.loads(operation_path.read_text()) if operation_path.exists() else None
        workspace_path = BASE / "workspace"
        exists = (workspace_path / "workspace.json").is_file()
        if not exists:
            if not ARGS.project_packet and not (operation and operation.get("packet", {}).get("path")):
                raise ValueError("A new operation requires --project-packet; existing completed operations reopen directly")
            if workspace_path.exists():
                # Recover only the empty scratch directories left by the old
                # owner startup. An existing workspace's data is never removed.
                old_temporary = workspace_path / "tmp"
                if old_temporary.is_dir():
                    old_temporary.rmdir()
                workspace_path.rmdir()
        workspace = Workspace(workspace_path, create=not exists)
        private = workspace_path / "tmp"
        os.environ["TMPDIR"] = os.environ["SQLITE_TMPDIR"] = str(private)
        tempfile.tempdir = str(private)
        operation, sources = prepare_operation(workspace, records, operation, not exists or operation is None)
        temporary = private / "operator-browser-temporary"
        temporary.mkdir(exist_ok=True, mode=0o700)
        server = OperatorServer(workspace, 0)
        thread = threading.Thread(target=server.serve_forever, name="sdmx-original-operator", daemon=False)
        thread.start()
        ready = {"schema": "stellar-forge.sdmx-browser-ready.v1", "url": server.url,
            "workspace": str(workspace_path), "source_root": str(SOURCE),
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
    except BaseException as error:
        status.update({"status": "FAILED", "error": type(error).__name__ + ": " + str(error)})
        raise
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
        if server is not None:
            if thread is not None and thread.is_alive():
                server.shutdown()
            server.server_close()
        if thread is not None:
            thread.join(timeout=10)
        if workspace is not None:
            workspace.close()
        if temporary is not None:
            shutil.rmtree(temporary, ignore_errors=True)
        status["after"] = memory()
        try:
            write_private(output / "owner-result.json", status)
            print(json.dumps({"phase": "operator_closed", **status}), flush=True)
        finally:
            lock.close()

def terminate_owner(signum, frame):
    raise KeyboardInterrupt

if __name__ == "__main__":
    signal.signal(signal.SIGTERM, terminate_owner)
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
