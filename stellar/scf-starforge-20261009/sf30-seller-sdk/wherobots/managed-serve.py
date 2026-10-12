#!/usr/bin/env python3
"""Supervise the original Wherobots HTTP server through its existing ready hook."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import sys
import threading
import uuid

ROOT = Path(__file__).resolve().parents[4]
PRODUCT = Path(__file__).resolve().parent
SCHEMA = "stellar-forge.wherobots-application-worker.v1"

def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")

def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()

def file_identity(path):
    path = Path(path)
    if path.resolve() != path or not path.is_file() or path.is_symlink():
        raise ValueError("The selected source must be an original canonical file.")
    with path.open("rb") as stream:
        before = os.fstat(stream.fileno())
        hash_value = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hash_value.update(chunk)
        after = os.fstat(stream.fileno())
        named = path.stat()
    keys = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
    if any(getattr(before, key) != getattr(after, key) for key in keys) or (after.st_dev, after.st_ino) != (named.st_dev, named.st_ino):
        raise ValueError("The original source changed during startup.")
    return {"bytes": before.st_size, "sha256": hash_value.hexdigest()}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        raise ValueError("Select a supported local port.")
    stopped = threading.Event()
    listener = {}
    def stop(_number, _frame):
        if stopped.is_set():
            return
        stopped.set()
        if "server" in listener:
            threading.Thread(target=listener["server"].shutdown, name="wherobots-stop", daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    raw = sys.stdin.buffer.read(65537)
    if len(raw) > 65536:
        raise ValueError("The original application selection exceeds 64 KiB.")
    selected = json.loads(raw)
    if selected.get("schema") != "stellar-forge.wherobots-application-selection.v1":
        raise ValueError("Select the original saved application.")
    source, binding = selected["source"], selected["binding"]
    if Path(source["root"]).resolve() != ROOT or digest(source["files"]) != source["sha256"]:
        raise ValueError("The original installed source selection changed.")
    selected_binding = {key: value for key, value in binding.items() if key != "bindingSha256"}
    if digest(selected_binding) != binding["bindingSha256"]:
        raise ValueError("The original workspace selection changed.")
    for item in source["files"]:
        name = Path(item["name"])
        if name.is_absolute() or ".." in name.parts or not name.parts:
            raise ValueError("The original source name is invalid.")
        observed = file_identity(ROOT / name)
        if observed != {"bytes": item["bytes"], "sha256": item["sha256"]}:
            raise ValueError("The original installed source file changed.")
    for item in binding["configurationFiles"]:
        observed = file_identity(item["path"])
        if observed != {"bytes": item["bytes"], "sha256": item["sha256"]}:
            raise ValueError("The reviewed runtime or private connection changed.")
    if Path(sys.executable).resolve() != Path(binding["pythonRealPath"]):
        raise ValueError("The selected native Python executable changed.")
    if stopped.is_set():
        return 0
    sys.path.insert(0, str(PRODUCT / "source"))
    from wherobots_operator.storage import Workspace
    from wherobots_operator.server import serve
    from wherobots_operator.native import runtime_info
    runtime = runtime_info()
    with Workspace(binding["directory"]) as workspace:
        if workspace.workspace_id != binding["workspaceId"]:
            raise ValueError("The directory contains another original workspace.")
        if stopped.is_set():
            return 0
        def ready(url, server, _operator):
            # ThreadingHTTPServer's existing close now waits for accepted requests.
            # Idle keep-alive sockets have a timeout; active file transfers and
            # native task work drain through the original owner.
            server.daemon_threads = False
            server.block_on_close = True
            handler_class = server.RequestHandlerClass
            handler_class.timeout = 30
            original_handle = handler_class._handle
            def handle_request(handler, method):
                # Shutdown stops new connections; an existing HTTP/1.1 browser
                # can still poll or submit work on its retained connection.
                # Reject its next request while accepted work finishes normally.
                if stopped.is_set():
                    handler.close_connection = True
                    try:
                        handler._send(503, {"error": "APPLICATION_CLOSING",
                            "message": "The application is closing. Reopen it from Applications."},
                            headers={"Connection": "close"})
                    except (BrokenPipeError, ConnectionResetError):
                        pass
                    return
                try:
                    return original_handle(handler, method)
                finally:
                    if stopped.is_set():
                        handler.close_connection = True
            handler_class._handle = handle_request
            listener["server"] = server
            if stopped.is_set():
                threading.Thread(target=server.shutdown, name="wherobots-stop", daemon=True).start()
            else:
                value = {"schema": SCHEMA, "state": "READY", "url": url,
                    "workspace_id": workspace.workspace_id, "directory": str(workspace.directory),
                    "sourceRoot": str(ROOT), "sourceSha256": source["sha256"],
                    "bindingSha256": binding["bindingSha256"], "pid": os.getpid(),
                    "parentPid": os.getppid(), "instanceId": str(uuid.uuid4()), "runtime": runtime}
                print(json.dumps(value, ensure_ascii=False, separators=(",", ":")), flush=True)
        serve(workspace, host="127.0.0.1", port=args.port, on_ready=ready)
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (KeyboardInterrupt, SystemExit):
        raise
    except BaseException as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)}), file=sys.stderr, flush=True)
        raise SystemExit(1)
