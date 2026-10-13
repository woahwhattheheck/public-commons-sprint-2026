#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Run the unchanged, privately installed grant analyst under its original writer lease."""
from __future__ import annotations
import argparse
import ast
import io
import zipfile
from urllib.parse import urlsplit,parse_qs
from http.server import ThreadingHTTPServer
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

CONNECTION_SCHEMA = "stellar-forge.grant-analyst-workbench-connection.v1"
SOURCE_SCHEMA = "stellar-forge.grant-analyst-workbench-source.v1"

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


MODULES = {}
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
    required = {"application/analyst.py", "application/learning.py", "application/study.py",
                "application/public/index.html", "application/public/app.js", "application/public/learning.js",
                "application/public/study.js", "application/public/style.css", "application/run_reference_workflow.py",
                "application/run_learning_workflow.py", "application/run_study_workflow.py",
                "receive_commission.py", "commission-template.json", "COMMISSIONED_RECEIVING.md"}
    need(required <= names, "The private authority omits an original application component.")
    tree = ast.parse(raw(root / "application" / "analyst.py", 33554432, False), filename="analyst.py")
    declared = [ast.literal_eval(node.value) for node in tree.body if isinstance(node, ast.Assign) and
                any(isinstance(target, ast.Name) and target.id == "SOURCE_FILES" for target in node.targets)]
    need(len(declared) == 1 and isinstance(declared[0], list) and
         all(isinstance(name, str) and "application/" + name in names for name in declared[0]) and
         len(declared[0]) == len(set(declared[0])), "Retain every source member declared by the original analyst.")
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
    for name in ("learning", "study", "analyst"):
        need(name not in sys.modules, "The private original module is already loaded: " + name)
        spec = importlib.util.spec_from_file_location(name, root / "application" / (name + ".py"))
        value = importlib.util.module_from_spec(spec)
        sys.modules[name] = value
        spec.loader.exec_module(value)
        MODULES[name] = value
    return manifest

def module(name):
    need(name in MODULES, "Select an installed original module.")
    return MODULES[name]

def inside(root, path):
    return path == root or root in path.parents

def complete_identity(path, maximum):
    path = Path(path)
    need(path.is_absolute() and path.resolve() == path, "Use a canonical complete file.")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_size <= maximum and
             before.st_uid == os.getuid() and before.st_mode & 0o077 == 0, "Keep complete intake private and owned.")
        digest, count = hashlib.sha256(), 0
        while True:
            part = os.read(fd, 1048576)
            if not part:
                break
            count += len(part); digest.update(part)
        after = os.fstat(fd)
        need(count == before.st_size and all(getattr(before, k) == getattr(after, k) for k in
             ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")), "Complete intake changed.")
        return {"path": str(path), "bytes": count, "sha256": digest.hexdigest()}
    finally:
        os.close(fd)

def compare_prefix(before, after):
    left, right = before["state"], after["state"]
    for key in ("schema", "id", "name", "createdAt"):
        need(left[key] == right[key], "Original workspace identity changed: " + key)
    for key in ("editions", "codebooks", "audit"):
        need(right[key][:len(left[key])] == left[key], "Original complete history changed: " + key)
    for key, value in left["requests"].items():
        need(right["requests"].get(key) == value, "Original saved request changed")
    for key, value in left["reviews"].items():
        need(right["reviews"].get(key, [])[:len(value)] == value, "Original grant decision history changed")
    for key, value in before["objects"].items():
        need(after["objects"].get(key) == value, "Original source or evidence object changed")
    old_cycles = {x["id"]: x for x in left.get("learningCycles", [])}
    new_cycles = {x["id"]: x for x in right.get("learningCycles", [])}
    for identity_, value in old_cycles.items():
        current = new_cycles.get(identity_)
        need(current is not None, "Original learning cycle disappeared")
        for key in set(value) - {"actions", "reviews"}:
            need(current.get(key) == value[key], "Original learning finding or baseline changed")
        need(current["reviews"][:len(value["reviews"])] == value["reviews"], "Original complete cycle review changed")
        actions = {x["id"]: x for x in current["actions"]}
        for old in value["actions"]:
            need(old["id"] in actions and actions[old["id"]]["revisions"][:len(old["revisions"])] == old["revisions"],
                 "Original complete action history changed")
            need(all(actions[old["id"]].get(key) == value for key, value in old.items() if key != "revisions"),
                 "Original learning action identity changed")
    new_studies = {x["id"]: x for x in right.get("studies", [])}
    for value in left.get("studies", []):
        current = new_studies.get(value["id"])
        need(current is not None, "Original study disappeared")
        for key in set(value) - {"revision", "questionEditions", "scopeEditions", "evidence", "answers", "releases", "history"}:
            need(current.get(key) == value[key], "Original study identity changed")
        for key in ("questionEditions", "scopeEditions", "evidence", "answers", "releases", "history"):
            need(current[key][:len(value[key])] == value[key], "Original full study history changed: " + key)
        need(current["revision"] >= value["revision"], "Study revision moved backwards")

def receive_lock(destination_path):
    destination = Path(destination_path)
    need(destination.is_absolute() and destination.resolve() == destination,
         "Use the canonical original receiving destination.")
    directory(destination.parent)
    return lock(destination.parent / (".grant-analyst-receive-" + sha(str(destination).encode()) + ".lock"))

def receive_workspace(configuration, archive_path, destination_path):
    core, study, learning = module("analyst"), module("study"), module("learning")
    destination, archive = Path(destination_path), Path(archive_path)
    need(destination.is_absolute() and destination.resolve() == destination and
         archive.is_absolute() and archive.resolve() == archive, "Select complete canonical receiving paths.")
    for selected in (Path(configuration["applicationDirectory"]), Path(configuration["directory"])):
        need(not inside(selected, destination) and not inside(destination, selected),
             "Receive separately from current source and workspace.")
    for path in (configuration["connectionFile"], configuration["sourceManifestFile"]):
        need(not inside(destination, Path(path)), "Keep selected authority and connection outside receiving.")
    directory(destination.parent)
    selected = complete_identity(archive, 1024**3 + 64*1024**2)
    sidecar = receive_lock(destination)
    writer = None
    try:
        if not destination.exists():
            received = core.receive_workspace(archive, destination)
            need(received["archiveSha256"] == selected["sha256"], "Original archive changed during receiving.")
            return received
        directory(destination)
        directory(destination / "workspace")
        writer = lock(destination / "workspace" / "grant-analyst-operator.lock")
        receipt = document(destination / "RECEIVING.json", 33554432)
        need(receipt.get("archiveSha256") == selected["sha256"] and receipt.get("bytes") == selected["bytes"],
             "Existing receiving belongs to another complete archive.")
        retained = complete_identity(destination / "original-handover.zip", 1024**3 + 64*1024**2)
        need(retained["sha256"] == selected["sha256"] and retained["bytes"] == selected["bytes"],
             "Original received archive changed.")
        with zipfile.ZipFile(archive) as zipped:
            members = zipped.namelist()
            need(len(members) == len(set(members)) and "MANIFEST.json" in members and
                 sum(item.file_size for item in zipped.infolist()) <= core.MAX_HANDOVER_BYTES,
                 "Invalid complete original handover.")
            manifest = json.loads(zipped.read("MANIFEST.json"))
            need(manifest.get("schema") == "tjlabs.grant-analyst-handover.v1" and isinstance(manifest.get("files"), list),
                 "Select the original complete analyst handover.")
            paths = [row.get("path") for row in manifest["files"]]
            need(len(paths) == len(set(paths)) and set(paths) | {"MANIFEST.json"} == set(members) and
                 document(destination / "MANIFEST.json", 33554432) == manifest and receipt.get("files") == len(members),
                 "Received original member inventory changed.")
            original_state = json.loads(zipped.read("workspace/workspace.json"))
            original_objects, observed_objects = {}, {}
            for row in manifest["files"]:
                name = row["path"]
                need(isinstance(name, str) and not name.startswith("/") and "\\" not in name and
                     all(part not in ("", ".", "..") for part in name.split("/")) and
                     name.split("/")[0] in ("workspace", "source", "reports"), "Unsafe original handover member.")
                info = zipped.getinfo(name)
                need(type(row.get("bytes")) is int and info.file_size == row["bytes"] and
                     (info.external_attr >> 16) & 0o170000 != 0o120000, "Original member type or length differs.")
                digest, count = hashlib.sha256(), 0
                with zipped.open(info) as incoming:
                    while part := incoming.read(1048576):
                        count += len(part); digest.update(part)
                need(count == row["bytes"] and digest.hexdigest() == row["sha256"], "Original member bytes differ.")
                # Workspace edits and later evidence remain owned by the native model.
                # Received source, reports and original source editions stay exact.
                if not name.startswith("workspace/") or name.startswith(("workspace/sources/", "workspace/evidence/")):
                    present = complete_identity(destination / name, core.MAX_HANDOVER_BYTES)
                    need(present["bytes"] == row["bytes"] and present["sha256"] == row["sha256"],
                         "An original received immutable member changed.")
                    if name.startswith("workspace/"):
                        relative_name = name[len("workspace/"):]
                        original_objects[relative_name] = {key: row[key] for key in ("bytes", "sha256")}
                        observed_objects[relative_name] = {key: present[key] for key in ("bytes", "sha256")}
        with core.locked(destination / "workspace"):
            current = core.state(destination / "workspace")
            need(current["id"] == manifest["workspace"] == receipt["workspace"], "Received workspace identity changed.")
            learning.validate(core, current)
            study.validate(core, destination / "workspace", current)
            for entry in current["editions"]:
                core.grant_package(destination / "workspace", entry)
            compare_prefix({"state": original_state, "objects": original_objects},
                           {"state": current, "objects": observed_objects})
        return {"directory": str(destination), "workspace": current["id"], "archiveSha256": selected["sha256"],
                "source": str(destination / "source"), "workspacePath": str(destination / "workspace")}
    finally:
        if writer is not None:
            os.close(writer)
        os.close(sidecar)

def main():
    parser = argparse.ArgumentParser(description="Managed original grant analyst host", allow_abbrev=False)
    parser.add_argument("--request", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    request_path = Path(args.request)
    request = document(request_path)
    need(request.get("schema") == "stellar-forge.grant-analyst-managed-request.v1", "Select the complete managed request.")
    need(sys.version_info >= (3, 10), "The original analyst requires Python 3.10 or later.")
    c = request["configuration"]
    need(sha(raw(request["configurationFile"], 131072)) == request["configurationSha256"], "The reviewed launch changed.")
    bridge = request["bridge"]
    need(Path(bridge["path"]) == Path(__file__).resolve() and sha(raw(bridge["path"], 1048576, False)) == bridge["sha256"],
         "The selected managed host changed.")
    need(Path(sys.executable).absolute() == Path(c["python"]).absolute(), "Keep the selected Python invocation path.")
    root = Path(c["directory"])
    root_identity = directory(root)
    directory(request_path.parent)
    source(c)
    core, learning, study = module("analyst"), module("learning"), module("study")
    # Retain the complete generic exchange source with this original launch.
    names = ["learning-exchange-host.py","learning-exchange-host.mjs","learning-exchange-host.css","learning-exchange.mjs","learning-exchange-offline.mjs","learning-exchange-offline.css","learning-exchange-offline.html","learning-exchange-render.mjs"]
    declared = bridge.get("assets")
    need(isinstance(declared, list) and len(declared) == len(names) and
         all(isinstance(row, dict) and set(row) == {"name", "bytes", "sha256"} for row in declared) and
         {row["name"] for row in declared} == set(names),
         "Select the complete installed Learning exchange assets.")
    assets = {}
    for row in declared:
        body = raw(Path(bridge["path"]).parent / row["name"], 4194304, False)
        need(type(row["bytes"]) is int and len(body) == row["bytes"] and sha(body) == row["sha256"],
             "An installed Learning exchange asset changed.")
        assets[row["name"]] = body
    helper_path = Path(bridge["path"]).parent / "learning-exchange-host.py"
    helper_spec = importlib.util.spec_from_file_location("_merchant_learning_exchange", helper_path)
    exchange = importlib.util.module_from_spec(helper_spec)
    exec(compile(assets["learning-exchange-host.py"], str(helper_path), "exec"), exchange.__dict__)
    exchange.install_guard(core, learning)
    original_index = raw(core.PROGRAM / "public" / "index.html", 33554432)
    authority = document(c["sourceManifestFile"], 33554432)
    index_rows = [row for row in authority["files"] if row["path"] == "application/public/index.html"]
    need(len(index_rows) == 1 and len(original_index) == index_rows[0]["bytes"] and
         sha(original_index) == index_rows[0]["sha256"], "The original console entry changed.")
    need(original_index.count(b"</head>") == 1 and original_index.count(b"</body>") == 1,
         "The original console entry needs its complete head and body.")
    exchange_index = original_index.replace(b"</head>", b'<link rel="stylesheet" href="/_merchant/learning-exchange-host.css"></head>')
    exchange_index = exchange_index.replace(b"</body>", b'<script type="module" src="/_merchant/learning-exchange-host.mjs"></script></body>')
    stop_requested = threading.Event()
    owner = {"server": None, "serving": False}
    connection_lease = writer = published = None
    def stop(*_):
        stop_requested.set()
        if owner["server"] is not None and owner["serving"]:
            threading.Thread(target=owner["server"].shutdown, name="grant-analyst-shutdown", daemon=True).start()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, stop)
    try:
        connection_lease = lock(c["connectionFile"] + ".lock")
        writer = lock(root / "grant-analyst-operator.lock")
        need(not stop_requested.is_set(), "The launch stopped before opening.")
        if not (root / "workspace.json").exists():
            need(c.get("workspaceName"), "Name a new original analyst workspace explicitly.")
            core.initialize(root, c["workspaceName"])
        with core.locked(root):
            current = core.state(root)
            need(c.get("workspaceName") is None or current["name"] == c["workspaceName"], "Keep the original workspace name.")
            learning.validate(core, current); study.validate(core, root, current)
            for entry in current["editions"]:
                core.grant_package(root, entry)
        identity = {"workspaceId": current["id"], "workspaceName": current["name"]}
        class ManagedServer(ThreadingHTTPServer):
            daemon_threads = False
            block_on_close = True
            def __init__(self, address, original_handler):
                class ManagedHandler(original_handler):
                    def setup(self):
                        self.request.settimeout(30)
                        super().setup()
                    def checked_state(self):
                        with core.locked(root):
                            selected = core.state(root)
                            need(selected["id"] == identity["workspaceId"] and selected["name"] == identity["workspaceName"],
                                 "The selected original workspace changed.")
                            return selected
                    def do_GET(self):
                        route = urlsplit(self.path)
                        if route.path == "/":
                            return self.send(200, exchange_index, "text/html; charset=utf-8")
                        if route.path.startswith("/_merchant/learning-exchange") and route.path.count("/") == 2:
                            name = route.path.rsplit("/", 1)[-1]
                            if name in assets and not name.endswith(".py"):
                                kind = "text/css; charset=utf-8" if name.endswith(".css") else "text/html; charset=utf-8" if name.endswith(".html") else "text/javascript; charset=utf-8"
                                return self.send(200, assets[name], kind)
                        if route.path == "/_merchant/learning-exchange/receipt":
                            try:
                                need(self.authorized(), "Use the current original private console connection.")
                                query = parse_qs(route.query)
                                need(set(query) == {"requestId"} and len(query["requestId"]) == 1 and
                                     re.fullmatch(r"[A-Za-z0-9._:-]{1,180}", query["requestId"][0]),
                                     "Select the original saved request.")
                                with core.locked(root):
                                    selected = core.state(root)
                                    need(selected["id"] == identity["workspaceId"] and selected["name"] == identity["workspaceName"],
                                         "The original workspace changed.")
                                    result = {"workspaceId": selected["id"], "requestId": query["requestId"][0],
                                              "receipt": selected["requests"].get(query["requestId"][0])}
                                return self.send(200, core.public_json(result).encode())
                            except Exception as error:
                                return self.send(400, core.public_json({"error": str(error)}).encode())
                        if route.path in ("/_merchant/info", "/_merchant/state", "/_merchant/report"):
                            try:
                                need(self.authorized(), "Use the current original private console connection.")
                                with core.locked(root):
                                    selected = core.state(root)
                                    need(selected["id"] == identity["workspaceId"] and selected["name"] == identity["workspaceName"],
                                         "The original workspace changed.")
                                    if route.path == "/_merchant/info":
                                        result = {**self.server.managed_info, "limits": {"sourceBytes": core.MAX_BODY,
                                            "jsonBytes": core.MAX_BODY * 2, "handoverBytes": core.MAX_HANDOVER_BYTES}}
                                    elif route.path == "/_merchant/state":
                                        result = selected
                                    else:
                                        result = core.report(root, selected, parse_qs(route.query).get("edition", [""])[0])
                                return self.send(200, core.public_json(result).encode())
                            except Exception as error:
                                return self.send(400, core.public_json({"error": str(error)}).encode())
                        if route.path.startswith("/api/"):
                            try:
                                need(self.authorized(), "Use the current original private console connection.")
                                self.checked_state()
                            except Exception as error:
                                return self.send(400, core.public_json({"error": str(error)}).encode())
                        return super().do_GET()
                    def do_POST(self):
                        route = urlsplit(self.path)
                        if route.path == "/_merchant/learning-exchange/context":
                            try:
                                need(self.authorized(), "Use the current original private console connection.")
                                origin = self.headers.get("Origin")
                                need(not origin or origin == "http://" + self.headers.get("Host", ""), "Use the original local console.")
                                need(self.headers.get("Content-Type", "").split(";")[0] == "application/json", "Use complete JSON input.")
                                length = int(self.headers.get("Content-Length", "0"))
                                need(0 < length <= core.MAX_BODY * 2, "Select complete original Learning context.")
                                body = json.loads(self.rfile.read(length))
                                with core.locked(root):
                                    selected = core.state(root)
                                    need(selected["id"] == identity["workspaceId"] and selected["name"] == identity["workspaceName"],
                                         "The original workspace changed.")
                                    result = exchange.build_context(core, learning, root, selected, body)
                                return self.send(200, core.public_json(result).encode())
                            except Exception as error:
                                return self.send(400, core.public_json({"error": str(error)}).encode())
                        if route.path != "/_merchant/receive":
                            try:
                                need(self.authorized(), "Use the current original private console connection.")
                                self.checked_state()
                            except Exception as error:
                                return self.send(400, core.public_json({"error": str(error)}).encode())
                            return super().do_POST()
                        try:
                            need(self.authorized(), "Use the current original private console connection.")
                            self.checked_state()
                            origin = self.headers.get("Origin")
                            need(not origin or origin == "http://" + self.headers.get("Host", ""), "Use the original local console.")
                            need(self.headers.get("Content-Type", "").split(";")[0] == "application/json", "Use complete JSON input.")
                            length = int(self.headers.get("Content-Length", "0"))
                            need(0 < length <= 131072, "Select complete archive and receiving paths.")
                            body = json.loads(self.rfile.read(length))
                            need(isinstance(body, dict) and set(body) == {"archivePath", "destination"}, "Select the complete receiving input.")
                            result = receive_workspace(c, body["archivePath"], body["destination"])
                            return self.send(200, core.public_json(result).encode())
                        except Exception as error:
                            return self.send(400, core.public_json({"error": str(error)}).encode())
                super().__init__(address, ManagedHandler)
                owner["server"] = self
            def serve_forever(self, poll_interval=0.2):
                owner["serving"] = True
                try:
                    if not stop_requested.is_set():
                        return super().serve_forever(poll_interval)
                finally:
                    owner["serving"] = False
        def startup_print(value, *args, **kwargs):
            nonlocal published
            actual = json.loads(value)
            link = urlsplit(actual["url"])
            need(link.scheme == "http" and link.hostname == "127.0.0.1" and
                 link.port == owner["server"].server_port and re.fullmatch(r"[A-Za-z0-9_-]{43}", link.fragment),
                 "Retain the actual original analyst listener and private token.")
            need(actual["workspace"] == str(root) and actual["port"] == link.port, "Original startup changed workspace.")
            need(not stop_requested.is_set(), "The launch stopped before publication.")
            token_file = request_path.parent / "original-console-token"
            save(token_file, (link.fragment + "\n").encode())
            connection = {"schema": CONNECTION_SCHEMA, "launchId": request["launchId"], "instanceId": request["launchId"],
                **identity, "directory": str(root), "applicationDirectory": c["applicationDirectory"],
                "directoryIdentity": {"dev": root_identity["dev"], "ino": root_identity["ino"]},
                "sourceManifestFile": c["sourceManifestFile"], "sourceManifestSha256": c["sourceManifestSha256"],
                "python": c["python"], "capabilityFile": str(token_file), "origin": "http://127.0.0.1:" + str(link.port),
                "pid": os.getpid(), "startedAt": request["startedAt"], "actor": c["actor"],
                "configurationFile": request["configurationFile"], "configurationSha256": request["configurationSha256"]}
            owner["server"].managed_info = {k: v for k, v in connection.items() if k not in ("capabilityFile", "configurationFile")}
            save(c["connectionFile"], encode(connection)); published = connection
            save(request_path.parent / "original-startup.json", encode(actual))
        # Capture the unchanged factory's actual server and printed original token.
        # Original request handlers, mutation model and reporting remain untouched.
        core.ThreadingHTTPServer = ManagedServer
        core.print = startup_print
        core.serve(root, request["port"])
    finally:
        if owner["server"] is not None:
            owner["server"].server_close()
        if published is not None:
            try:
                actual = document(c["connectionFile"], 131072)
                if actual.get("launchId") == request["launchId"]:
                    Path(c["connectionFile"]).unlink()
            except FileNotFoundError:
                pass
        if writer is not None:
            os.close(writer)
        if connection_lease is not None:
            os.close(connection_lease)

if __name__ == "__main__":
    main()
