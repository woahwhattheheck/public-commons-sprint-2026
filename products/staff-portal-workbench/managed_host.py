#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Run the unchanged, privately installed staff portal under its original writer lease."""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import json
import os
import secrets
import signal
import stat
import sys
import threading
from pathlib import Path

CONNECTION_SCHEMA = "stellar-forge.staff-portal-workbench-connection.v1"
SOURCE_SCHEMA = "stellar-forge.staff-portal-workbench-source.v1"

def need(value, message):
    if not value:
        raise RuntimeError(message)

def raw(path, maximum, private=True):
    path = Path(path)
    need(path.is_absolute() and path.resolve() == path, "Select a canonical complete file.")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_size <= maximum, "Select a complete regular file within its capacity.")
        need(not private or before.st_uid == os.getuid() and before.st_mode & 0o077 == 0, "Keep the original file private and owned.")
        with os.fdopen(os.dup(fd), "rb") as incoming:
            body = incoming.read(maximum + 1)
        after = os.fstat(fd)
        need(len(body) == before.st_size and all(getattr(before, k) == getattr(after, k) for k in
             ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")), "The original file changed while being read.")
        return body
    finally:
        os.close(fd)

def document(path, maximum=4194304):
    return json.loads(raw(path, maximum).decode("utf-8"))

def sha(body):
    return hashlib.sha256(body).hexdigest()

def directory(path):
    path = Path(path)
    info = path.lstat()
    need(path.is_absolute() and path.resolve() == path and stat.S_ISDIR(info.st_mode) and
         info.st_uid == os.getuid() and info.st_mode & 0o077 == 0, "Select the owned private original directory.")
    return {"path": str(path), "dev": str(info.st_dev), "ino": str(info.st_ino)}

def lock(path):
    path = Path(path)
    directory(path.parent)
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_mode & 0o077 == 0,
             "Retain the same owned private writer lock.")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        need(path.stat().st_ino == info.st_ino and path.stat().st_dev == info.st_dev, "The original writer lock changed.")
        return fd
    except BaseException:
        os.close(fd)
        raise

def save(path, body):
    path = Path(path)
    directory(path.parent)
    temporary = path.with_name("." + path.name + "." + secrets.token_hex(8))
    try:
        with temporary.open("xb") as output:
            os.chmod(temporary, 0o600)
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        temporary.unlink(missing_ok=True)

def encode(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")

def source(configuration):
    root = Path(configuration["applicationDirectory"])
    directory(root)
    manifest_path = configuration["sourceManifestFile"]
    body = raw(manifest_path, 4194304)
    need(sha(body) == configuration["sourceManifestSha256"], "The reviewed private source authority changed.")
    manifest = json.loads(body.decode("utf-8"))
    need(set(manifest) == {"schema", "files"} and manifest["schema"] == SOURCE_SCHEMA and
         isinstance(manifest["files"], list) and 7 <= len(manifest["files"]) <= 25000, "Select a complete original source authority.")
    names = set()
    folded = set()
    size = 0
    for member in manifest["files"]:
        need(isinstance(member, dict) and set(member) == {"path", "bytes", "sha256"}, "Retain complete original source metadata.")
        name = member["path"]
        need(isinstance(name, str) and 0 < len(name) <= 4096 and "\\" not in name and
             all(ord(c) >= 32 and ord(c) != 127 for c in name) and
             all(p not in ("", ".", "..", "__pycache__") for p in name.split("/")) and name.casefold() not in folded,
             "Select an exact original source member once.")
        names.add(name)
        folded.add(name.casefold())
        need(type(member["bytes"]) is int and 0 <= member["bytes"] <= 33554432, "Select the original source size.")
        size += member["bytes"]
        need(size <= 33554432, "The original source exceeds its complete receiving capacity.")
        body = raw(root / name, 33554432, private=False)
        need(len(body) == member["bytes"] and sha(body) == member["sha256"], "Original source changed: " + name)
    actual = set()
    for current, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            need(not (Path(current) / name).is_symlink(), "Original source contains a linked member.")
        dirs[:] = [name for name in dirs if name != "__pycache__"]
        for name in files:
            path = Path(current) / name
            need(path.is_file(), "Original source contains a non-file.")
            actual.add(path.relative_to(root).as_posix())
    need(actual == names, "Retain the whole exact original source.")
    sys.path.insert(0, str(root))
    import portal_delivery
    need(set(portal_delivery.SOURCE_FILES) == names, "The installed original receiver declares a different complete source edition.")
    return manifest

def main():
    parser = argparse.ArgumentParser(description="Managed original staff portal host", allow_abbrev=False)
    parser.add_argument("--request", required=True)
    args = parser.parse_args()
    request_path = Path(args.request)
    request = document(request_path)
    need(request.get("schema") == "stellar-forge.staff-portal-managed-request.v1", "Select the original managed request.")
    need(sys.version_info >= (3, 11), "The original staff portal requires Python 3.11 or later.")
    c = request["configuration"]
    original = raw(request["configurationFile"], 65536)
    need(sha(original) == request["configurationSha256"], "The reviewed launch configuration changed.")
    bridge = request["bridge"]
    need(Path(bridge["path"]) == Path(__file__).resolve() and sha(raw(bridge["path"], 1048576, False)) == bridge["sha256"],
         "The selected managed host changed.")
    need(Path(sys.executable).absolute() == Path(c["python"]).absolute(), "Keep the selected original Python invocation path.")
    root = Path(c["directory"])
    root_identity = directory(root)
    directory(request_path.parent)
    source(c)
    import engine
    import portal_server
    from portal_workspace import open_manager

    stop_requested = threading.Event()
    repeat_stop = threading.Event()
    owner = {"server": None, "serving": False}
    def stop(*_):
        repeat_stop.set()
        stop_requested.set()
        if owner["server"] is not None and owner["serving"]:
            threading.Thread(target=owner["server"].shutdown, name="staff-portal-shutdown", daemon=True).start()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, stop)
    connection_lease = None
    writer = None
    published = None
    server = None
    serving_thread = None
    serving_failure = []
    try:
        connection_lease = lock(c["connectionFile"] + ".lock")
        writer = lock(root / "portal-operator.lock")
        need(not stop_requested.is_set(), "The original launch was stopped before opening.")
        if c.get("expectedWorkspaceId"):
            need((root / "registry.sqlite3").is_file(), "The selected original registry is missing.")
        manager = open_manager(root)
        if c.get("expectedWorkspaceId"):
            manager.get(c["expectedWorkspaceId"])
        saved_path = root / "portal-operator.json"
        saved = document(saved_path, 65536) if saved_path.exists() else None
        if saved is not None:
            need(saved.get("schema") == portal_server.SERVICE and type(saved.get("port")) is int and 1 <= saved["port"] <= 65535,
                 "The original saved browser origin is invalid.")
        port = request["port"] or (saved["port"] if saved else 0)
        key = secrets.token_urlsafe(36)
        capability_path = request_path.parent / "access-key"
        save(capability_path, (key + "\n").encode("ascii"))
        class ManagedHandler(portal_server.PortalHandler):
            def get(self):
                if self.path == "/api/merchant/info":
                    self.session()
                    self.json({**self.server.managed_info, "limits": {"uploadBytes": 1073741824, "jsonBytes": 8388608},
                               "views": ["portal", "migration", "insights", "editorial"]})
                    return
                super().get()
        server = portal_server.PortalServer(("127.0.0.1", port), manager, key,
                    thoughtfarmer_origins=c["allowedOrigins"], insights_local_http=c["insightsLocalHttp"])
        server.RequestHandlerClass = ManagedHandler
        owner["server"] = server
        actual_port = server.server_address[1]
        save(saved_path, encode({"schema": portal_server.SERVICE, "port": actual_port}))
        connection = {"schema": CONNECTION_SCHEMA, "launchId": request["launchId"], "instanceId": request["launchId"],
            "directory": str(root), "directoryIdentity": root_identity, "applicationDirectory": c["applicationDirectory"],
            "sourceManifestFile": c["sourceManifestFile"], "sourceManifestSha256": c["sourceManifestSha256"],
            "python": c["python"], "capabilityFile": str(capability_path), "origin": "http://127.0.0.1:" + str(actual_port),
            "pid": os.getpid(), "startedAt": request["startedAt"], "actor": c["actor"],
            "allowedOrigins": c["allowedOrigins"], "insightsLocalHttp": c["insightsLocalHttp"]}
        if c.get("expectedWorkspaceId"):
            connection["expectedWorkspaceId"] = c["expectedWorkspaceId"]
        server.managed_info = {k: v for k, v in connection.items() if k != "capabilityFile"}
        body = encode(connection)
        save(c["connectionFile"], body)
        published = sha(body)
        print(json.dumps({"state": "READY", "launchId": request["launchId"], "pid": os.getpid()}, separators=(",", ":")), flush=True)
        def serve():
            try:
                server.serve_forever(poll_interval=0.2)
            except BaseException as exc:
                serving_failure.append(exc)
        serving_thread = threading.Thread(target=serve, name="staff-portal-http", daemon=False)
        # Publish serving ownership before start; an early shutdown waits for the
        # original serve_forever loop. Reconcile any earlier Stop after start.
        owner["serving"] = True
        serving_thread.start()
        if stop_requested.is_set():
            server.shutdown()
        serving_thread.join()
        if serving_failure:
            raise serving_failure[0]
    finally:
        # Never release this owner while original HTTP workers can still use it.
        if serving_thread is not None and serving_thread.is_alive():
            server.shutdown()
            serving_thread.join()
        owner["serving"] = False
        while server is not None:
            try:
                server.server_close()
                server = None
            except BaseException as exc:
                print(json.dumps({"state": "CLOSING", "component": "original-http", "error": str(exc)}), file=sys.stderr, flush=True)
                repeat_stop.clear()
                repeat_stop.wait()
        if published is not None:
            path = Path(c["connectionFile"])
            if path.exists() and sha(raw(path, 65536)) == published:
                path.unlink()
                fd = os.open(path.parent, os.O_RDONLY)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
        if writer is not None:
            os.close(writer)
        if connection_lease is not None:
            os.close(connection_lease)

if __name__ == "__main__":
    try:
        main()
    except BaseException as exc:
        print(json.dumps({"state": "CLOSED", "error": {"type": type(exc).__name__, "message": str(exc)}}), file=sys.stderr, flush=True)
        raise SystemExit(1)
