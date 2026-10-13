#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Own the original Hive HTTP server and join its actual handlers on Applications Stop."""
from __future__ import annotations
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import signal
import sys
import threading

def need(value, message):
    if not value:
        raise ValueError(message)

def read(path):
    path = Path(path)
    need(path.is_absolute() and path.resolve() == path and not path.is_symlink(),
         "Select a canonical original file")
    before = path.stat()
    with path.open("rb") as stream:
        body = stream.read()
        after = os.fstat(stream.fileno())
    need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
         (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) and len(body) == before.st_size,
         "Original input changed while opening")
    return body

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection", required=True, type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    selected = json.loads(read(args.selection))
    need(selected.get("schema") == "stellar-forge.hive-managed-selection.v1", "Select the complete managed launch")
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    need(sys.platform == "linux", "The original native Hive operator requires Linux")
    # Parent death joins this same server owner, including the parent-before-prctl race.
    libc = ctypes.CDLL(None, use_errno=True)
    need(libc.prctl(1, signal.SIGTERM, 0, 0, 0) == 0, "Could not bind the Applications owner lifetime")
    need(os.getppid() == selected["ownerPid"] and not stop.is_set(), "The selected Applications owner ended during startup")
    for fd, path in ((3, selected["workspaceLock"]), (4, selected["connectionLock"])):
        actual, wanted = os.fstat(fd), Path(path).stat()
        need((actual.st_dev, actual.st_ino) == (wanted.st_dev, wanted.st_ino), "Keep both original inherited managed leases")
    source = Path(selected["applicationDirectory"])
    sys.path.insert(0, str(source))
    import yaml
    from hive_desk.server import create_server
    from hive_desk.workspace import Workspace
    from hive_desk.native import inspect_binary
    need(yaml.__version__ == "6.0.3", "Select the exact installed PyYAML dependency")
    runtime_body = read(selected["runtimeReadyFile"])
    runtime = json.loads(runtime_body)
    need(hashlib.sha256(runtime_body).hexdigest() == selected["runtimeSelectionSha256"],
         "The native runtime receipt changed before startup")
    need(Path(sys.executable).absolute() == Path(selected["python"]), "Use the selected independent runtime Python")
    dependency_files = {row["path"]: row for row in runtime["yaml"]["files"]}
    loaded_yaml = [yaml]
    if sys.modules.get("yaml._yaml") is not None:
        loaded_yaml.append(sys.modules["yaml._yaml"])
    for module in loaded_yaml:
        module_path = str(Path(module.__file__).resolve())
        descriptor = dependency_files.get(module_path)
        need(descriptor is not None, "The loaded PyYAML module is outside the selected independent installation")
        body = read(module_path)
        need(len(body) == descriptor["bytes"] and hashlib.sha256(body).hexdigest() == descriptor["sha256"],
             "The actually imported PyYAML module differs from its retained dependency")
    router = inspect_binary(runtime["router"]["path"])
    need(router["sha256"] == runtime["router"]["sha256"] and router["bytes"] == runtime["router"]["bytes"],
         "The original published Hive executable changed")
    with Workspace(selected["directory"], create=True) as ws:
        original_id = ws.meta("id")
    httpd = None
    serving = None
    failures = []
    try:
        httpd = create_server(selected["directory"], source, "127.0.0.1", selected["port"])
        original_handler = httpd.RequestHandlerClass
        class ManagedHandler(original_handler):
            def route(self, method):
                if self.path == "/api/merchant-info":
                    need(method == "GET" and self.headers.get("X-Hive-Managed-Launch") == selected["nonce"],
                         "Use the current private managed launch connection")
                    with Workspace(selected["directory"]) as ws:
                        return self.response(200, {
                            "schema": "stellar-forge.hive-routing-live.v1",
                            "launchId": selected["launchId"], "pid": os.getpid(),
                            "directory": selected["directory"], "applicationDirectory": str(source),
                            "sourceManifestSha256": selected["sourceManifestSha256"],
                            "runtimeSelectionSha256": selected["runtimeSelectionSha256"],
                            "workspace": ws.summary()})
                return super().route(method)
        httpd.RequestHandlerClass = ManagedHandler
        def run_server():
            try:
                httpd.serve_forever(poll_interval=0.2)
            except BaseException as error:
                failures.append(error)
            finally:
                stop.set()
        serving = threading.Thread(target=run_server, name="hive-original-http", daemon=False)
        serving.start()
        if os.getppid() != selected["ownerPid"]:
            stop.set()
        print(json.dumps({"schema": "stellar-forge.hive-managed-child.v1",
            "launchId": selected["launchId"], "pid": os.getpid(), "instanceId": original_id,
            "origin": "http://127.0.0.1:" + str(httpd.server_port)}, separators=(",", ":")), flush=True)
        stop.wait()
    finally:
        if httpd is not None:
            if serving is not None and serving.is_alive():
                httpd.shutdown()
            if serving is not None:
                serving.join()
            # Original non-daemon request threads are joined here, independently of serve_forever.
            httpd.server_close()
    if failures:
        raise failures[0]

if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        print(json.dumps({"error": {"type": type(error).__name__, "message": str(error)}},
                         separators=(",", ":")), file=sys.stderr, flush=True)
        raise
