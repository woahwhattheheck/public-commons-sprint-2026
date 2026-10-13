#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Run the unchanged, privately installed catalogue delivery under its original writer lease."""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import importlib.util
import importlib
import re
import json
import os
import secrets
import signal
import stat
import sys
import threading
from pathlib import Path

CONNECTION_SCHEMA = "stellar-forge.catalogue-delivery-workbench-connection.v1"
SOURCE_SCHEMA = "stellar-forge.catalogue-delivery-workbench-source.v1"

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


PACKAGE = "_merchant_catalogue_original"
def source(configuration):
    root = Path(configuration["applicationDirectory"])
    directory(root)
    body = raw(configuration["sourceManifestFile"], 33554432)
    need(sha(body) == configuration["sourceManifestSha256"], "The reviewed private source authority changed.")
    manifest = json.loads(body.decode("utf-8"))
    need(set(manifest) == {"schema", "files"} and manifest["schema"] == SOURCE_SCHEMA and
         isinstance(manifest["files"], list) and 14 <= len(manifest["files"]) <= 25000,
         "Select a complete original source authority.")
    names, folded, size = set(), set(), 0
    for member in manifest["files"]:
        need(isinstance(member, dict) and set(member) == {"path", "bytes", "sha256"},
             "Retain complete original source metadata.")
        name = member["path"]
        need(isinstance(name, str) and 0 < len(name) <= 4096 and "\\" not in name and
             all(ord(c) >= 32 and ord(c) != 127 for c in name) and
             all(p not in ("", ".", "..", "__pycache__") for p in name.split("/")) and name.casefold() not in folded,
             "Select each exact original source member once.")
        names.add(name); folded.add(name.casefold())
        need(type(member["bytes"]) is int and 0 <= member["bytes"] <= 33554432 and
             isinstance(member["sha256"], str) and re.fullmatch(r"[a-f0-9]{64}", member["sha256"]),
             "Select the original complete source identity.")
        size += member["bytes"]
        need(size <= 33554432, "The original source exceeds complete source capacity.")
        data = raw(root / name, 33554432, private=False)
        need(len(data) == member["bytes"] and sha(data) == member["sha256"], "Original source changed: " + name)
    required = {"__init__.py", "delivery_store.py", "ckan_transport.py", "web.py", "mcp.py", "cli.py",
                "implementation.py", "approval_store.py", "approval_web.py", "approval_transport.py",
                "approval_archive.py", "approval_cli.py", "approval_receiving.py", "static/index.html", "approval_static/index.html",
                "receiving_backend/compose.yaml", "ckan-bridge/pyproject.toml"}
    need(required <= names, "The private authority omits an original application component.")
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
    need(PACKAGE not in sys.modules, "The original private package is already loaded.")
    spec = importlib.util.spec_from_file_location(PACKAGE, root / "__init__.py",
                                                  submodule_search_locations=[str(root)])
    package = importlib.util.module_from_spec(spec)
    sys.modules[PACKAGE] = package
    spec.loader.exec_module(package)
    return manifest

def module(name):
    return importlib.import_module(PACKAGE + "." + name)

def credentials(configuration):
    result = {}
    for name, item in configuration.get("environment", {}).items():
        need(re.fullmatch(r"[A-Z][A-Z0-9_]{1,127}", name) and not re.fullmatch(
            r"HOME|PATH|SHELL|USER|LOGNAME|PWD|TMPDIR|VIRTUAL_ENV|XDG_.*|PYTHON.*|LD_.*|NODE_.*|CATALOGUE_DELIVERY_LEASE_ROOT|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY", name),
            "Select a service credential reference.")
        data = raw(item["file"], 16384)
        need(len(data) == item["bytes"] and sha(data) == item["sha256"],
             "The selected private credential file changed.")
        value = data.decode("utf-8").strip()
        need(value and all(ord(c) >= 32 and ord(c) != 127 for c in value),
             "Use a complete single-line original service credential.")
        result[name] = value
    return result


def receive_implementation(invoke, configuration, archive_path, destination_path, **options):
    root = Path(configuration["directory"])
    destination, archive = Path(destination_path), Path(archive_path)
    need(destination.is_absolute() and destination.resolve() == destination and
         archive.is_absolute() and archive.resolve() == archive, "Use complete canonical receiving paths.")
    protected = [root, Path(configuration["applicationDirectory"]), Path(configuration["connectionFile"]).parent]
    need(not any(destination == p or p in destination.parents or destination in p.parents for p in protected),
         "Receive independently from the active source, workspace and controls.")
    directory(destination.parent)
    destination.mkdir(mode=0o700, exist_ok=True)
    directory(destination)
    receiving_root = destination / "workspace"
    receiving_root.mkdir(mode=0o700, exist_ok=True)
    directory(receiving_root)
    receiving_writer = lock(receiving_root / "catalogue-operator.lock")
    try:
        return invoke(str(archive), str(destination), **options)
    finally:
        os.close(receiving_writer)

def main():
    parser = argparse.ArgumentParser(description="Managed original catalogue delivery host", allow_abbrev=False)
    parser.add_argument("--request", required=True)
    args = parser.parse_args()
    request_path = Path(args.request)
    request = document(request_path)
    need(request.get("schema") == "stellar-forge.catalogue-delivery-managed-request.v1", "Select the original managed request.")
    need(sys.version_info >= (3, 11), "The original catalogue requires Python 3.11 or later.")
    c = request["configuration"]
    original = raw(request["configurationFile"], 131072)
    need(sha(original) == request["configurationSha256"], "The reviewed launch configuration changed.")
    bridge = request["bridge"]
    need(Path(bridge["path"]) == Path(__file__).resolve() and sha(raw(bridge["path"], 1048576, False)) == bridge["sha256"],
         "The selected managed host changed.")
    need(Path(sys.executable).absolute() == Path(c["python"]).absolute(), "Keep the selected Python invocation path.")
    root = Path(c["directory"])
    root_identity = directory(root)
    directory(request_path.parent)
    source(c)
    delivery, approval_module, approval_web, mcp, implementation = (
        module(name) for name in ("delivery_store", "approval_store", "approval_web", "mcp", "implementation"))
    environment = credentials(c)
    if c.get("leaseRoot"):
        environment["CATALOGUE_DELIVERY_LEASE_ROOT"] = c["leaseRoot"]
    stop_requested, repeat_stop = threading.Event(), threading.Event()
    owner = {"server": None, "serving": False}
    def stop(*_):
        repeat_stop.set(); stop_requested.set()
        selected = owner["server"]
        if selected is not None:
            selected.workbench.stop.set()
            if owner["serving"]:
                threading.Thread(target=selected.shutdown, name="catalogue-delivery-shutdown", daemon=True).start()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, stop)
    connection_lease = writer = published = server = operator = serving_thread = None
    serving_failure = []
    try:
        connection_lease = lock(c["connectionFile"] + ".lock")
        writer = lock(root / "catalogue-operator.lock")
        need(not stop_requested.is_set(), "The launch stopped before opening.")
        store = delivery.Store(root, environment=environment)
        approval = approval_module.ApprovalStore(store)
        # The original HTTP worker is the only optional recurring worker.
        server = approval_web.create_server(approval, host="127.0.0.1", port=request["port"], worker=c["worker"])
        server.daemon_threads = False
        server.block_on_close = True
        operator = mcp.Operator(store, worker=False, approval=True)
        operator.approval = approval
        class ManagedHandler(approval_web.Handler):
            def setup(self):
                self.request.settimeout(30)
                super().setup()
            def _get(self):
                if self.path == "/_merchant/info":
                    self._guard()
                    return self._json({**self.server.managed_info, "views": ["catalogue", "implementation", "approval"],
                                       "limits": {"sourceBytes": store.maximum_source_bytes, "jsonBytes": 8388608}})
                if self.path == "/_merchant/catalogue":
                    self._guard()
                    return self._json({"tools": operator.tools, "resources": operator.resources,
                                       "resourceTemplates": operator.resource_templates, "server": mcp.SERVER})
                return super()._get()
            def _post(self):
                if self.path not in ("/_merchant/call", "/_merchant/resource", "/_merchant/implementation/receive"):
                    return super()._post()
                self._guard(mutation=True)
                body = self._body()
                if self.path == "/_merchant/call":
                    if set(body) != {"name", "arguments"} or not isinstance(body["name"], str):
                        raise delivery.DeliveryError("MCP_ARGUMENT", "Supply the original tool name and complete arguments.")
                    definition = operator.tool_by_name.get(body["name"])
                    if definition is None:
                        raise delivery.DeliveryError("MCP_ARGUMENT", "Select an original declared catalogue tool.")
                    try:
                        mcp.validate(body["arguments"], definition["inputSchema"])
                    except mcp.ProtocolError as exc:
                        raise delivery.DeliveryError("MCP_ARGUMENT", str(exc)) from exc
                    return self._json(operator.call(body["name"], body["arguments"]))
                if self.path == "/_merchant/resource":
                    if set(body) != {"uri"} or not isinstance(body["uri"], str) or not 1 <= len(body["uri"]) <= 1024:
                        raise delivery.DeliveryError("MCP_ARGUMENT", "Select the original complete resource URI.")
                    return self._json(operator.resource(body["uri"]))
                if set(body) != {"archivePath", "destination"}:
                    raise delivery.DeliveryError("RECEIVING_ARGUMENT", "Select the complete declared archive and destination.")
                result = receive_implementation(implementation.receive_package, c, body["archivePath"], body["destination"])
                return self._json(result)
        server.RequestHandlerClass = ManagedHandler
        owner["server"] = server
        capability_path = request_path.parent / "access-key"
        save(capability_path, (server.workbench.token + "\n").encode("ascii"))
        connection = {"schema": CONNECTION_SCHEMA, "launchId": request["launchId"], "instanceId": request["launchId"],
            "directory": str(root), "directoryIdentity": root_identity, "applicationDirectory": c["applicationDirectory"],
            "sourceManifestFile": c["sourceManifestFile"], "sourceManifestSha256": c["sourceManifestSha256"],
            "python": c["python"], "capabilityFile": str(capability_path), "origin": server.workbench.url,
            "pid": os.getpid(), "startedAt": request["startedAt"], "actor": c["actor"], "worker": c["worker"],
            "environmentNames": sorted(c.get("environment", {})), "leaseRoot": c.get("leaseRoot"),
            "configurationFile": request["configurationFile"],
            "configurationSha256": request["configurationSha256"]}
        server.managed_info = {k: v for k, v in connection.items() if k not in ("capabilityFile", "configurationFile")}
        body = encode(connection)
        save(c["connectionFile"], body); published = sha(body)
        print(json.dumps({"state": "READY", "launchId": request["launchId"], "pid": os.getpid()}, separators=(",", ":")), flush=True)
        def serve():
            try:
                server.serve_forever(poll_interval=0.2)
            except BaseException as exc:
                serving_failure.append(exc)
        serving_thread = threading.Thread(target=serve, name="catalogue-delivery-http", daemon=False)
        owner["serving"] = True
        serving_thread.start()
        if stop_requested.is_set():
            server.shutdown()
        serving_thread.join()
        if serving_failure:
            raise serving_failure[0]
    finally:
        if server is not None:
            server.workbench.stop.set()
        if serving_thread is not None and serving_thread.is_alive():
            server.shutdown(); serving_thread.join()
        owner["serving"] = False
        # Join real HTTP handlers, the single original recurring worker and every
        # original native executor before releasing the workspace writer.
        while server is not None:
            try:
                server.server_close()
                if server.workbench.worker_thread is not None:
                    server.workbench.worker_thread.join()
                server = None
            except BaseException as exc:
                print(json.dumps({"state": "CLOSING", "component": "original-http-worker",
                                  "error": type(exc).__name__}), file=sys.stderr, flush=True)
                repeat_stop.clear(); repeat_stop.wait()
        while operator is not None:
            try:
                operator.close()
                operator = None
            except BaseException as exc:
                print(json.dumps({"state": "CLOSING", "component": "original-native-executor",
                                  "error": type(exc).__name__}), file=sys.stderr, flush=True)
                repeat_stop.clear(); repeat_stop.wait()
        if published is not None:
            path = Path(c["connectionFile"])
            if path.exists() and sha(raw(path, 131072)) == published:
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
