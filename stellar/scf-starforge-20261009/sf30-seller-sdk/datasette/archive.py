#!/usr/bin/env python3
"""Complete Datasette workspace custody and relocation over the shared archive engine."""
from __future__ import annotations

from contextlib import ExitStack, closing
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import uuid

SCHEMA = "stellar-forge.datasette-workspace-archive.v1"
WORKSPACE_SCHEMA = "stellar-forge.datasette-workspace.v1"
RECEIVING_SCHEMA = "stellar-forge.datasette-workspace-receiving.v1"
REQUEST = ".source-archive-datasette-request.json"
HISTORY = "datasette-receiving-history.json"
MIB = 1024 * 1024
MAX_JSON = 32 * MIB
MAX_FILE = 2 * 1024 * MIB
HASH = re.compile(r"[a-f0-9]{64}\Z")
CHUNK = MIB


class Fault(Exception):
    def __init__(self, code, message=None):
        self.code, self.message = code, message or code
        super().__init__(self.message)


def fail(code, message=None):
    raise Fault("DATASETTE_ARCHIVE_" + code, message)


def shared_engine():
    path = Path(__file__).resolve().parents[1] / "source_bundle_archive.py"
    spec = importlib.util.spec_from_file_location("sf30_source_bundle_archive", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ENGINE = shared_engine()
POLICY = ENGINE.ArchivePolicy(SCHEMA, max_expanded_bytes=MAX_FILE - 16 * MIB,
                             max_members=30000, max_manifest_bytes=MAX_JSON,
                             max_file_bytes=MAX_FILE - 16 * MIB, receipt_name=None,
                             prefix="DATASETTE_ARCHIVE", error_type=Fault)


def encode(value):
    return (ENGINE.encoded(value) + "\n").encode("utf-8")


def checksum(raw):
    return hashlib.sha256(raw).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def absolute(value, *, physical=True):
    if not isinstance(value, str) or not value or "\x00" in value:
        fail("PATH_INVALID", "Use an absolute, normalized filesystem path.")
    path = Path(value)
    if not path.is_absolute() or path == Path("/") or str(path) != value or physical and path.resolve() != path:
        fail("PATH_INVALID", "Use an absolute, normalized path without symbolic links.")
    return path


def relative(value):
    if (not isinstance(value, str) or not value or value.startswith("/") or "\\" in value
            or "\x00" in value or any(p in ("", ".", "..") for p in value.split("/"))
            or value.split("/")[0].startswith(".source-archive-")):
        fail("PATH_INVALID", "The archive contains an invalid relative path.")
    return value


def signature(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
            info.st_ctime_ns, info.st_mode, info.st_nlink)


def pin(path, maximum=MAX_FILE):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        fail("REGULAR_FILE_REQUIRED", "Workspace source must be a regular file with one link.")
    result = ENGINE.file_hash(path, POLICY, maximum=maximum)
    if signature(info) != signature(path.lstat()):
        fail("SOURCE_CHANGED", "A workspace source changed while it was being retained.")
    return result


def read_raw(path, maximum=MAX_JSON):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > maximum:
            fail("REGULAR_FILE_REQUIRED")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            raw = stream.read(maximum + 1)
        if len(raw) > maximum or signature(before) != signature(os.fstat(fd)) or signature(before) != signature(path.lstat()):
            fail("SOURCE_CHANGED")
        return raw
    finally:
        os.close(fd)


def parse(raw):
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                fail("JSON_INVALID", "Saved JSON contains a repeated field.")
            result[key] = value
        return result
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs,
                          parse_constant=lambda _value: fail("JSON_INVALID"))
    except (UnicodeError, ValueError, TypeError):
        fail("JSON_INVALID", "Saved JSON must contain complete UTF-8 JSON.")


def read_json(path):
    return parse(read_raw(path))


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def private_dirs(root, destination):
    ENGINE.private_directories(root, destination, policy=POLICY)


def atomic_raw(path, raw):
    temporary = path.with_name(".source-archive-stage-" + path.name + "-" + uuid.uuid4().hex)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(fd)
        os.replace(temporary, path)
        sync_dir(path.parent)
    finally:
        os.close(fd)
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def create_raw(path, raw):
    expected = {"bytes": str(len(raw)), "sha256": checksum(raw)}
    if path.exists():
        if pin(path, max(MAX_JSON, len(raw))) != expected:
            fail("RECEIVING_CONFLICT", "The retained original file has different bytes.")
        return
    temporary = path.with_name(".source-archive-stage-" + path.name + "-" + uuid.uuid4().hex)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(fd)
        try:
            os.link(temporary, path)
        except FileExistsError:
            if pin(path, max(MAX_JSON, len(raw))) != expected:
                fail("RECEIVING_CONFLICT")
        temporary.unlink()
        sync_dir(path.parent)
    finally:
        os.close(fd)
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def retain_file(source, destination, expected):
    if destination.exists():
        if pin(destination) != expected:
            fail("RECEIVING_CONFLICT", "An original retained file has changed.")
        return
    temporary = destination.with_name(".source-archive-stage-" + destination.name + "-" + uuid.uuid4().hex)
    source_fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    target_fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        before = os.fstat(source_fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            fail("REGULAR_FILE_REQUIRED")
        digest, size = hashlib.sha256(), 0
        with os.fdopen(source_fd, "rb", closefd=False) as original, os.fdopen(target_fd, "wb", closefd=False) as retained:
            for chunk in iter(lambda: original.read(CHUNK), b""):
                size += len(chunk)
                if size > int(expected["bytes"]):
                    fail("SOURCE_CHANGED")
                digest.update(chunk)
                retained.write(chunk)
            retained.flush()
            os.fsync(target_fd)
        if ({"bytes": str(size), "sha256": digest.hexdigest()} != expected
                or signature(before) != signature(os.fstat(source_fd))
                or signature(before) != signature(source.lstat())):
            fail("SOURCE_CHANGED")
        try:
            os.link(temporary, destination)
        except FileExistsError:
            if pin(destination) != expected:
                fail("RECEIVING_CONFLICT")
        temporary.unlink()
        sync_dir(destination.parent)
    finally:
        os.close(source_fd)
        os.close(target_fd)
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def ignored(name, member=None):
    return (name == "publisher.lock" or name.startswith(".source-archive-")
            or member in ("dataset/control.json", "dataset/control.sock"))


def inventory(root, output=None):
    files, directories = [], []
    def visit(directory):
        for child in sorted(directory.iterdir(), key=lambda item: item.name):
            name = child.relative_to(root).as_posix()
            if ignored(child.name, name) or child == output:
                continue
            info = child.lstat()
            relative(name)
            if stat.S_ISDIR(info.st_mode):
                directories.append(name)
                visit(child)
            elif stat.S_ISREG(info.st_mode):
                if len(files) >= POLICY.max_members - 1:
                    fail("INVENTORY_LIMIT")
                files.append({"path": name, **pin(child, POLICY.max_file_bytes)})
            else:
                fail("REGULAR_FILE_REQUIRED", "A workspace member is a symbolic link, socket or other non-file.")
    visit(root)
    return files, directories


def contained(value, origin, label):
    if not isinstance(value, str) or "\x00" in value:
        fail("BINDING_INVALID", "The saved " + label + " path is invalid.")
    path = Path(value)
    if not path.is_absolute() or path == origin or str(path) != value or ".." in path.parts or not path.is_relative_to(origin):
        fail("EXTERNAL_BINDING", "The saved " + label + " must be retained inside the original workspace.")
    name = path.relative_to(origin).as_posix()
    relative(name)
    return name


def readonly_database(path):
    return sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)


def source_rows(path, origin):
    if not path.exists():
        return []
    for suffix in ("-wal", "-journal"):
        sibling = Path(str(path) + suffix)
        if sibling.exists() and sibling.stat().st_size:
            fail("PUBLISHER_NOT_IDLE", "Close the original publisher transaction before exporting its workspace.")
    before = pin(path)
    rows = []
    with closing(readonly_database(path)) as database:
        found = database.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_selections'").fetchone()
        if found:
            for sequence, request, raw in database.execute("SELECT sequence,request,data FROM source_selections ORDER BY sequence"):
                data = parse(raw.encode("utf-8"))
                selected = data.get("input") if isinstance(data, dict) else None
                if not isinstance(selected, dict):
                    fail("SOURCE_SELECTION_INVALID")
                name = contained(selected.get("sourceFile"), origin, "publisher source selection")
                rows.append({"sequence": sequence, "request": request,
                             "sourceFile": selected["sourceFile"], "relative": name})
    if pin(path) != before:
        fail("SOURCE_CHANGED")
    return rows


def publisher_bindings(root, files):
    names = {item["path"] for item in files}
    result = []
    for item in files:
        if item["path"] != "publisher/workspace.json":
            continue
        settings = read_json(root / item["path"])
        if not isinstance(settings, dict) or not ("sourceFile" in settings and "targetDirectory" in settings):
            continue
        source = contained(settings["sourceFile"], root, "publisher source")
        target = contained(settings["targetDirectory"], root, "publisher target")
        if source not in names:
            fail("BOUND_SOURCE_MISSING", "The saved publisher source must be included in this workspace.")
        if (root / target).exists() and not (root / target).is_dir():
            fail("BINDING_INVALID", "The saved publisher target must be a directory.")
        database_file = str(Path(item["path"]).parent / "publisher.sqlite")
        database = root / database_file
        rows = source_rows(database, root)
        if any(row["relative"] not in names for row in rows):
            fail("BOUND_SOURCE_MISSING", "A saved publisher source selection is missing from this workspace.")
        result.append({"settingsFile": item["path"],
                       "sourceFile": {"original": settings["sourceFile"], "relative": source},
                       "targetDirectory": {"original": settings["targetDirectory"], "relative": target, "exists": (root / target).is_dir()},
                       "databaseFile": database_file if database.exists() else None,
                       "sourceSelections": rows})
    return result


def validate_manifest(manifest):
    if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA:
        fail("SCHEMA_INVALID")
    workspace = manifest.get("workspace")
    if (not isinstance(workspace, dict) or workspace.get("schema") != WORKSPACE_SCHEMA
            or not isinstance(workspace.get("workspaceId"), str) or not workspace["workspaceId"]):
        fail("WORKSPACE_INVALID")
    origin = absolute(workspace.get("originDirectory"), physical=False)
    files = manifest.get("files")
    directories = manifest.get("directories")
    bindings = manifest.get("bindings")
    if not isinstance(files, list) or not isinstance(directories, list) or not isinstance(bindings, list):
        fail("MANIFEST_INVALID")
    if len(directories) > POLICY.max_members:
        fail("INVENTORY_LIMIT")
    names = {relative(item["path"]) for item in files}
    directory_names = [relative(name) for name in directories]
    if len(directory_names) != len(set(directory_names)) or names.intersection(directory_names) or "workspace.json" not in names:
        fail("MANIFEST_INVALID")
    for binding in bindings:
        if not isinstance(binding, dict) or relative(binding.get("settingsFile")) not in names:
            fail("BINDING_INVALID")
        for field in ("sourceFile", "targetDirectory"):
            value = binding.get(field)
            if (not isinstance(value, dict) or
                    contained(value.get("original"), origin, field) != value.get("relative")):
                fail("BINDING_INVALID")
        if binding["sourceFile"]["relative"] not in names:
            fail("BOUND_SOURCE_MISSING")
        if type(binding["targetDirectory"].get("exists")) is not bool:
            fail("BINDING_INVALID")
        if binding["targetDirectory"]["exists"] and binding["targetDirectory"]["relative"] not in directory_names:
            fail("BOUND_SOURCE_MISSING")
        database_file = binding.get("databaseFile")
        if database_file is not None and relative(database_file) not in names:
            fail("BOUND_SOURCE_MISSING")
        selections = binding.get("sourceSelections")
        if not isinstance(selections, list):
            fail("BINDING_INVALID")
        for selected in selections:
            if (not isinstance(selected, dict) or
                    contained(selected.get("sourceFile"), origin, "source selection") != selected.get("relative")
                    or selected["relative"] not in names):
                fail("BOUND_SOURCE_MISSING")
    original = {key: manifest[key] for key in ("schema", "workspace", "files", "directories", "bindings")}
    if manifest.get("snapshotSha256") != checksum(encode(original)):
        fail("MANIFEST_DIGEST_MISMATCH")
    return origin


def lock_publishers(root, files, stack):
    for item in files:
        if item["path"] != "publisher/workspace.json":
            continue
        settings = read_json(root / item["path"])
        if not isinstance(settings, dict) or not ("sourceFile" in settings and "targetDirectory" in settings):
            continue
        path = (root / item["path"]).parent / "publisher.lock"
        fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
        stack.callback(os.close, fd)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            fail("REGULAR_FILE_REQUIRED")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail("PUBLISHER_BUSY", "Finish the original publisher operation before exporting this workspace.")


def export_workspace(input):
    root, output = absolute(input.get("directory")), absolute(input.get("outputFile"))
    if output == root or output.name.startswith(".source-archive-"):
        fail("PATH_INVALID")
    workspace = read_json(root / "workspace.json")
    if not isinstance(workspace, dict) or workspace.get("schema") != WORKSPACE_SCHEMA:
        fail("WORKSPACE_INVALID")
    if input.get("workspaceId") is not None and input["workspaceId"] != workspace.get("workspaceId"):
        fail("WORKSPACE_CHANGED")
    with ExitStack() as stack:
        first_files, _ = inventory(root, output)
        lock_publishers(root, first_files, stack)
        files, directories = inventory(root, output)
        if first_files != files:
            fail("SOURCE_CHANGED")
        bindings = publisher_bindings(root, files)
        manifest = {"schema": SCHEMA,
                    "workspace": {"schema": WORKSPACE_SCHEMA, "workspaceId": workspace["workspaceId"],
                                  "createdAt": workspace.get("createdAt"), "originDirectory": str(root)},
                    "files": files, "directories": directories, "bindings": bindings}
        manifest["snapshotSha256"] = checksum(encode(manifest))
        validate_manifest(manifest)
        result = ENGINE.archive({"source": str(root), "destination": str(output),
                                 "manifest": manifest, "inventory": files}, policy=POLICY)
        final_files, final_directories = inventory(root, output)
        if final_files != files or final_directories != directories:
            fail("SOURCE_CHANGED", "Workspace contents changed during export. Retain the same output and inspect the original operation.")
    return {"schema": SCHEMA, "archiveFile": str(output), "sha256": result["archive"]["sha256"],
            "bytes": result["archive"]["bytes"], "workspaceId": workspace["workspaceId"],
            "manifestSha256": checksum(ENGINE.encoded(manifest).encode("utf-8")),
            "snapshotSha256": manifest["snapshotSha256"], "manifest": manifest,
            "reused": bool(result.get("reused") or result.get("reconciled"))}


def ensure_destination(root, archive_sha):
    if not root.exists():
        root.mkdir(mode=0o700, parents=True)
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700:
        fail("PRIVATE_DIRECTORY_REQUIRED")
    request_file = root / REQUEST
    if request_file.exists():
        request = read_json(request_file)
        if (request.get("schema") != RECEIVING_SCHEMA or request.get("sha256") != archive_sha
                or request.get("directory") != str(root)):
            fail("RECEIVING_CONFLICT", "This receiving directory belongs to another original archive.")
        return request
    if any(path.name != "publisher.lock" for path in root.iterdir()):
        fail("RECEIVING_DIRECTORY_NOT_EMPTY", "Receive into a new directory to preserve the existing workspace.")
    return None


def rebind_json(root, custody, binding, origin):
    name = binding["settingsFile"]
    preimage = custody / "preimages" / name
    original = read_json(preimage)
    if (original.get("sourceFile") != binding["sourceFile"]["original"]
            or original.get("targetDirectory") != binding["targetDirectory"]["original"]):
        fail("BINDING_INVALID")
    updated = dict(original)
    updated["sourceFile"] = str(root / binding["sourceFile"]["relative"])
    updated["targetDirectory"] = str(root / binding["targetDirectory"]["relative"])
    raw = read_raw(preimage) if updated == original else encode(updated)
    return {"path": name, "kind": "publisher-settings", "before": pin(preimage),
            "after": {"bytes": str(len(raw)), "sha256": checksum(raw)},
            "sourceFile": {"before": original["sourceFile"], "after": updated["sourceFile"]},
            "targetDirectory": {"before": original["targetDirectory"], "after": updated["targetDirectory"]},
            "_raw": raw}


def rebind_database(root, custody, binding, origin):
    name = binding.get("databaseFile")
    if name is None:
        return None
    original = custody / "preimages" / name
    selected = source_rows(original, origin)
    if selected != binding["sourceSelections"]:
        fail("SOURCE_SELECTION_INVALID", "Saved source selections differ from their original archive manifest.")
    before = pin(original)
    if not selected or origin == root:
        return None
    postimage = custody / "postimages" / name
    private_dirs(root, postimage.parent)
    note_file = postimage.with_name(postimage.name + ".relocation.json")
    if postimage.exists() and note_file.exists():
        note = read_json(note_file)
        if note.get("before") != before or note.get("after") != pin(postimage):
            fail("RECEIVING_CONFLICT")
        return note
    if postimage.exists():
        postimage.unlink()
        for suffix in ("-journal", "-wal", "-shm"):
            try:
                Path(str(postimage) + suffix).unlink()
            except FileNotFoundError:
                pass
        sync_dir(postimage.parent)
    retain_file(original, postimage, before)
    with closing(sqlite3.connect(postimage)) as database:
        database.execute("PRAGMA journal_mode=DELETE")
        database.execute("PRAGMA synchronous=FULL")
        for row in selected:
            found = database.execute("SELECT data FROM source_selections WHERE sequence=? AND request=?",
                                     (row["sequence"], row["request"])).fetchone()
            if found is None:
                fail("SOURCE_SELECTION_INVALID")
            data = parse(found[0].encode("utf-8"))
            data["input"]["sourceFile"] = str(root / row["relative"])
            database.execute("UPDATE source_selections SET data=? WHERE sequence=? AND request=?",
                             (ENGINE.encoded(data), row["sequence"], row["request"]))
        database.commit()
    fd = os.open(postimage, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    note = {"path": name, "kind": "publisher-source-selections", "before": before, "after": pin(postimage),
            "rows": [{"sequence": row["sequence"], "request": row["request"],
                      "before": row["sourceFile"], "after": str(root / row["relative"])} for row in selected],
            "postimage": postimage.relative_to(root).as_posix()}
    create_raw(note_file, encode(note))
    return note


def complete_receive(root, custody, manifest, request):
    origin = validate_manifest(manifest)
    originals = {item["path"]: {"bytes": item["bytes"], "sha256": item["sha256"]} for item in manifest["files"]}
    preimages = set()
    for binding in manifest["bindings"]:
        preimages.add(binding["settingsFile"])
        if binding.get("databaseFile"):
            preimages.add(binding["databaseFile"])
    if HISTORY in originals:
        preimages.add(HISTORY)
    for name in sorted(preimages):
        destination = custody / "preimages" / name
        private_dirs(root, destination.parent)
        if destination.exists():
            if pin(destination) != originals[name]:
                fail("RECEIVING_CONFLICT")
        else:
            retain_file(root / name, destination, originals[name])
    changes = []
    for binding in manifest["bindings"]:
        settings = rebind_json(root, custody, binding, origin)
        if settings["after"] != settings["before"]:
            changes.append(settings)
        database = rebind_database(root, custody, binding, origin)
        if database is not None:
            changes.append(database)
    mutable = {change["path"]: change for change in changes}
    for name, expected in originals.items():
        if name == HISTORY:
            continue
        actual = pin(root / name)
        if actual != expected and (name not in mutable or actual != mutable[name]["after"]):
            fail("RECEIVING_FILE_CHANGED", "A received source changed before relocation completed: " + name)
    for change in changes:
        target = root / change["path"]
        current = pin(target)
        if current == change["after"]:
            continue
        if current != change["before"]:
            fail("RECEIVING_FILE_CHANGED")
        if "_raw" in change:
            atomic_raw(target, change["_raw"])
        else:
            temporary = target.with_name(".source-archive-stage-" + target.name + "-" + uuid.uuid4().hex)
            retain_file(root / change["postimage"], temporary, change["after"])
            os.replace(temporary, target)
            sync_dir(target.parent)
    for name in manifest["directories"]:
        private_dirs(root, root / name)
    settings = read_json(root / "workspace.json")
    if settings.get("schema") != WORKSPACE_SCHEMA or settings.get("workspaceId") != request["workspaceId"]:
        fail("WORKSPACE_CHANGED")
    history = {"schema": "stellar-forge.datasette-receiving-history.v1", "receipts": []}
    if HISTORY in originals:
        history = read_json(custody / "preimages" / HISTORY)
        if (not isinstance(history, dict) or history.get("schema") != "stellar-forge.datasette-receiving-history.v1"
                or not isinstance(history.get("receipts"), list)):
            fail("RECEIVING_HISTORY_INVALID")
    public_changes = [{key: value for key, value in change.items() if key != "_raw"} for change in changes]
    completed = {key: value for key, value in request.items() if key != "phase"}
    completed.update({"phase": "COMPLETE", "sourceDirectory": str(origin),
                      "relocations": public_changes, "completedAt": request.get("completedAt") or now(),
                      "manifestFile": (custody / "manifest.json").relative_to(root).as_posix(),
                      "originalArchive": (custody / "original.zip").relative_to(root).as_posix(),
                      "preimagesDirectory": (custody / "preimages").relative_to(root).as_posix()})
    # Pin the completion timestamp before publishing either resumable final file.
    request["completedAt"] = completed["completedAt"]
    atomic_raw(root / REQUEST, encode(request))
    history["receipts"].append(completed)
    expected_history = encode(history)
    history_path = root / HISTORY
    if history_path.exists():
        current = pin(history_path)
        accepted = [{"bytes": str(len(expected_history)), "sha256": checksum(expected_history)}]
        if HISTORY in originals:
            accepted.append(originals[HISTORY])
        if current not in accepted:
            fail("RECEIVING_HISTORY_CHANGED")
    atomic_raw(history_path, expected_history)
    create_raw(custody / "receipt.json", encode(completed))
    atomic_raw(root / REQUEST, encode(completed))
    return completed


def receive_workspace(input):
    source, root = absolute(input.get("archiveFile")), absolute(input.get("directory"))
    expected = input.get("sha256")
    if not isinstance(expected, str) or not HASH.fullmatch(expected):
        fail("HASH_REQUIRED", "Receive the original archive with its complete SHA256.")
    original_pin = pin(source, POLICY.max_archive_bytes)
    if original_pin["sha256"] != expected:
        fail("HASH_MISMATCH", "The selected archive differs from its required original SHA256.")
    inspected = ENGINE.inspect({"archive": str(source)}, policy=POLICY)
    manifest = inspected["manifest"]
    validate_manifest(manifest)
    manifest_raw = ENGINE.encoded(manifest).encode("utf-8")
    manifest_sha = checksum(manifest_raw)
    request = ensure_destination(root, expected)
    custody = root / "receiving" / expected
    if any(item["path"] == "receiving" or item["path"].startswith("receiving/" + expected + "/")
           for item in manifest["files"]):
        fail("CUSTODY_PATH_CONFLICT")
    if request is not None:
        if request.get("manifestSha256") != manifest_sha or request.get("workspaceId") != manifest["workspace"]["workspaceId"]:
            fail("RECEIVING_CONFLICT")
        if request.get("phase") == "COMPLETE":
            if pin(custody / "original.zip", POLICY.max_archive_bytes) != original_pin:
                fail("ORIGINAL_ARCHIVE_CHANGED")
            return {**request, "reused": True, "manifest": manifest}
        if request.get("phase") not in ("EXTRACTING", "EXTRACTED"):
            fail("RECEIVING_STATE_INVALID")
    else:
        request = {"schema": RECEIVING_SCHEMA, "sha256": expected, "bytes": original_pin["bytes"],
                   "workspaceId": manifest["workspace"]["workspaceId"], "directory": str(root),
                   "archiveFile": str(custody / "original.zip"), "manifestSha256": manifest_sha,
                   "snapshotSha256": manifest["snapshotSha256"], "phase": "EXTRACTING", "startedAt": now()}
        create_raw(root / REQUEST, encode(request))
    private_dirs(root, custody)
    retain_file(source, custody / "original.zip", original_pin)
    create_raw(custody / "manifest.json", manifest_raw)
    if request["phase"] == "EXTRACTING":
        ENGINE.extract({"archive": str(custody / "original.zip"), "destination": str(root)}, policy=POLICY)
        for name in manifest["directories"]:
            private_dirs(root, root / name)
        request["phase"] = "EXTRACTED"
        atomic_raw(root / REQUEST, encode(request))
    completed = complete_receive(root, custody, manifest, request)
    return {**completed, "reused": False, "manifest": manifest}


def main():
    raw = sys.stdin.buffer.read(65537)
    if len(raw) > 65536:
        fail("REQUEST_LIMIT")
    request = parse(raw)
    if not isinstance(request, dict):
        fail("REQUEST_INVALID")
    operation = request.get("operation")
    if operation == "export":
        return export_workspace(request)
    if operation == "receive":
        return receive_workspace(request)
    fail("OPERATION_INVALID")


if __name__ == "__main__":
    try:
        result = main()
        sys.stdout.write(ENGINE.encoded({"ok": True, "result": result}) + "\n")
    except Exception as issue:
        code = getattr(issue, "code", "DATASETTE_ARCHIVE_NATIVE_FAILED")
        message = getattr(issue, "message", str(issue))
        sys.stdout.write(ENGINE.encoded({"ok": False, "error": code, "message": message}) + "\n")
        sys.exit(1)
