#!/usr/bin/env python3
"""MIT. Full GTFS workspace transfer through the original publisher and dataset layout.

The owning wrapper gates its root/publisher mutations and closes an idle original
scheduler before export. This module additionally holds the ORIGINAL dataset
writer.lease flock, never deletes a lock, and retains every data file. A received
workspace keeps its identity, revision and history. Only the two documented
publisher runtime paths are relocated, with their exact original bytes retained.

CLI: export --workspace ROOT --output FILE --workspace-id UUID
     inspect --archive FILE --sha256 SHA256
     receive --archive FILE --sha256 SHA256 --output NEW_ROOT --workspace-id UUID
"""
from __future__ import annotations

import argparse
import contextlib
import ctypes
import datetime as dt
import errno
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tarfile
import tempfile

SCHEMA = "stellar-forge.gtfs-workspace-bundle.v1"
WORKSPACE_SCHEMA = "stellar-forge.gtfs-workspace.v1"
PUBLISHER_SCHEMA = "stellar-forge.frictionless-publisher-workspace.v1"
RECEIPT_SCHEMA = "stellar-forge.gtfs-workspace-receipt.v1"
HASH = re.compile(r"[a-f0-9]{64}\Z")
UUID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\Z")
CHUNK = 1024 * 1024
META_MAX = 64 * 1024 * 1024
ARCHIVE_MAX = 8 * 1024**3
TOTAL_MAX = 128 * 1024**3
FILE_MAX = 64 * 1024**3
ENTRY_MAX = 100000

class ArchiveError(ValueError):
    def __init__(self, code, message, status=409):
        self.code, self.status = code, status
        super().__init__(message)

def fail(code, message, status=409):
    raise ArchiveError(code, message, status)

def valid_hash(value):
    return isinstance(value, str) and HASH.fullmatch(value) is not None

def valid_uuid(value):
    return isinstance(value, str) and UUID.fullmatch(value) is not None

def stamp():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def parse(raw, label):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                fail("GTFS_ARCHIVE_JSON", label + " repeats a JSON key.", 422)
            result[key] = value
        return result
    def constant(_):
        fail("GTFS_ARCHIVE_JSON", label + " contains a non-finite JSON value.", 422)
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=unique,
                           parse_constant=constant)
    except (UnicodeError, json.JSONDecodeError):
        fail("GTFS_ARCHIVE_JSON", label + " must be complete UTF-8 JSON.", 422)
    if not isinstance(value, dict):
        fail("GTFS_ARCHIVE_JSON", label + " must be an object.", 422)
    return value

def member(value):
    if not isinstance(value, str) or not value or len(value.encode("utf-8")) > 4096:
        fail("GTFS_ARCHIVE_PATH", "An archive member has an invalid path.", 422)
    path = PurePosixPath(value)
    if ("\\" in value or any(ord(c) < 32 for c in value) or path.is_absolute()
            or str(path) != value or any(p in ("", ".", "..") for p in path.parts)):
        fail("GTFS_ARCHIVE_PATH", "Archive members must be ordinary relative paths.", 422)
    return value

def signature(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)

def directory(path, create=False):
    path = Path(path).absolute()
    if create:
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode)
            or stat.S_IMODE(info.st_mode) & 0o077 or path.resolve() != path):
        fail("GTFS_PRIVATE_DIRECTORY", "Use a private directory without symlink components.")
    return path

def ordinary(info, path):
    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
            or stat.S_IMODE(info.st_mode) & 0o7077 or info.st_size > FILE_MAX):
        fail("GTFS_PRIVATE_FILE", "Use a private ordinary retained file: " + str(path))

def opened(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
                 | getattr(os, "O_CLOEXEC", 0))
    handle = os.fdopen(fd, "rb")
    try:
        info = os.fstat(handle.fileno())
        ordinary(info, path)
        if signature(Path(path).lstat()) != signature(info):
            fail("GTFS_WORKSPACE_CHANGED", "A retained file changed before reading.")
        return handle, info
    except BaseException:
        handle.close()
        raise

def after_read(handle, path, before, count):
    after = os.fstat(handle.fileno())
    named = Path(path).lstat()
    if count != before.st_size or signature(after) != signature(before) or signature(named) != signature(before):
        fail("GTFS_WORKSPACE_CHANGED", "A retained file changed while being read: " + str(path))

def fingerprint(path, maximum=FILE_MAX):
    handle, before = opened(path)
    with handle:
        if before.st_size > maximum:
            fail("GTFS_ARCHIVE_SIZE", "The selected file exceeds the transfer size limit.", 413)
        digest, count = hashlib.sha256(), 0
        while chunk := handle.read(CHUNK):
            count += len(chunk)
            if count > maximum:
                fail("GTFS_ARCHIVE_SIZE", "The selected file exceeds the transfer size limit.", 413)
            digest.update(chunk)
        after_read(handle, path, before, count)
    return {"bytes": count, "sha256": digest.hexdigest()}, signature(before)

def read_small(path, maximum=META_MAX):
    handle, before = opened(path)
    with handle:
        if before.st_size > maximum:
            fail("GTFS_ARCHIVE_METADATA_SIZE", "Retained metadata exceeds its supported size.", 413)
        raw = handle.read(maximum + 1)
        after_read(handle, path, before, len(raw))
        if len(raw) > maximum:
            fail("GTFS_ARCHIVE_METADATA_SIZE", "Retained metadata exceeds its supported size.", 413)
        return raw

def create(path, raw, mode=0o600):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open("xb") as handle:
        os.chmod(path, 0o600)
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(path, mode)

def sync(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def inside(path, root):
    try:
        Path(path).absolute().relative_to(root)
        return True
    except ValueError:
        return False

def absent(path):
    try:
        Path(path).lstat()
        return False
    except FileNotFoundError:
        return True

def output_file(path, root=None):
    path = Path(path).absolute()
    if root is not None and inside(path, root):
        fail("GTFS_EXPORT_OUTSIDE_WORKSPACE", "Save complete archives in the configured external exports directory.")
    directory(path.parent, True)
    if not absent(path):
        fail("GTFS_ARCHIVE_EXISTS", "Reconcile the original export request and its existing archive.")
    return path

@contextlib.contextmanager
def dataset_exclusion(root):
    """Use the same retained inode and flock protocol as writer-lease.mjs."""
    target = root / "dataset"
    if absent(target):
        yield {"present": False}
        if not absent(target):
            fail("GTFS_WORKSPACE_CHANGED", "The original dataset target appeared during export.")
        return
    directory(target)
    if sys.platform != "linux":
        fail("DATASET_LINUX_FLOCK_REQUIRED", "The original dataset writer uses Linux flock; export on its installed Linux runtime.")
    import fcntl
    lock = target / "writer.lease"
    fd = os.open(lock, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
                 | getattr(os, "O_CLOEXEC", 0), 0o600)
    held = False
    try:
        def check():
            info, named = os.fstat(fd), lock.lstat()
            ordinary(info, lock)
            if (info.st_dev, info.st_ino) != (named.st_dev, named.st_ino) or not stat.S_ISREG(named.st_mode):
                fail("DATASET_LEASE_CHANGED", "The original dataset writer lease changed.")
            return info
        check()
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            held = True
        except BlockingIOError:
            fail("DATASET_WRITER_RUNNING", "Stop and close the original dataset seller/writer, then retry this export request.")
        info = check()
        if not absent(target / "writer.lock"):
            fail("DATASET_LEGACY_WRITER_REQUIRES_OWNER",
                 "Reconcile and close the original legacy dataset writer before export; its lock is retained.")
        yield {"present": True, "device": str(info.st_dev), "inode": str(info.st_ino)}
        check()
        if not absent(target / "writer.lock"):
            fail("DATASET_LEGACY_WRITER_REQUIRES_OWNER", "An original legacy writer lock appeared during export.")
    finally:
        if held:
            fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)

def check_sqlite_quiescent(root):
    for name in ("publisher.sqlite", "schedule.sqlite"):
        for suffix in ("-journal", "-wal", "-shm"):
            if not absent(root / "publisher" / (name + suffix)):
                fail("GTFS_PUBLISHER_BUSY",
                     "Close the original idle scheduler and drain/reconcile the publisher database before export.")

def workspace_binding(root, expected_id):
    if not valid_uuid(expected_id):
        fail("GTFS_WORKSPACE_ID", "Supply the original GTFS workspace UUID.", 422)
    raw = read_small(root / "workspace.json")
    state = parse(raw, "workspace.json")
    if (state.get("schema") != WORKSPACE_SCHEMA or state.get("id") != expected_id
            or type(state.get("revision")) is not int or state["revision"] < 0):
        fail("GTFS_WORKSPACE_BINDING", "The selected workspace identity or revision differs.")
    if state.get("pending") is not None:
        fail("GTFS_WORKSPACE_BUSY", "Reconcile the original pending workspace request before exporting.")
    expected = {"directory": "publisher", "sourceFile": "selected-source.json", "targetDirectory": "dataset"}
    if state.get("publisher") is not None and state["publisher"] != expected:
        fail("GTFS_PUBLISHER_BINDING", "The GTFS publisher must retain its original internal source and dataset paths.")
    publisher = None
    settings_path = root / "publisher" / "workspace.json"
    if not absent(settings_path):
        settings_raw = read_small(settings_path, 4096)
        settings = parse(settings_raw, "publisher/workspace.json")
        if (settings.get("schema") != PUBLISHER_SCHEMA
                or settings.get("sourceFile") != str(root / "selected-source.json")
                or settings.get("targetDirectory") != str(root / "dataset")):
            fail("GTFS_EXTERNAL_PUBLISHER_BINDING",
                 "This workspace's original publisher must use its retained selected-source.json and dataset directory.")
        if (absent(root / "selected-source.json")
                and (state.get("selection") is not None or state.get("selectedEditionId") is not None)):
            fail("GTFS_SELECTED_SOURCE_MISSING", "The selected original publisher source is missing.")
        publisher = {
            "file": "publisher/workspace.json", "sha256": sha(settings_raw),
            "sourceFile": "selected-source.json", "targetDirectory": "dataset",
            "originalSourceFile": settings["sourceFile"],
            "originalTargetDirectory": settings["targetDirectory"],
        }
    selected = root / "selected-source.json"
    if not absent(selected):
        config = parse(read_small(selected), "selected-source.json")
        connection = config.get("connection")
        if (config.get("schema") != "stellar-forge.frictionless-source.v1"
                or not isinstance(connection, dict)
                or not valid_hash(connection.get("sha256"))):
            fail("GTFS_SELECTED_SOURCE_INVALID", "Use the original retained Frictionless source selection.")
        name = member(connection.get("file"))
        if not name.startswith("editions/") or not name.endswith("/capture/capture.json"):
            fail("GTFS_EXTERNAL_SOURCE_BINDING", "The selected source must remain relative to this workspace's retained edition.")
        if absent(root / name):
            fail("GTFS_SELECTED_SOURCE_MISSING", "The selected original capture is missing.")
    return state, raw, publisher

def inventory(root, hash_files=True):
    files, directories, observed, excluded = [], [], {}, []
    total = 0
    def walk(base, prefix=""):
        nonlocal total
        info = base.lstat()
        if (not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode)
                or stat.S_IMODE(info.st_mode) & 0o7077):
            fail("GTFS_PRIVATE_DIRECTORY", "A retained workspace directory is not private: " + prefix)
        observed[prefix] = signature(info)
        if prefix:
            if len(files) + len(directories) >= ENTRY_MAX:
                fail("GTFS_ARCHIVE_ENTRIES", "The complete workspace exceeds the transfer entry limit.", 413)
            directories.append(prefix)
        with os.scandir(base) as iterator:
            children = sorted(iterator, key=lambda entry: entry.name)
        for entry in children:
            name = member(prefix + "/" + entry.name if prefix else entry.name)
            path = base / entry.name
            child = path.lstat()
            if stat.S_ISDIR(child.st_mode):
                walk(path, name)
                continue
            if name == "dataset/control.sock":
                if not stat.S_ISSOCK(child.st_mode):
                    fail("GTFS_DATASET_CONTROL_INVALID", "The retained native control socket has an unexpected file type.")
                observed[name] = signature(child)
                excluded.append({"file": name, "kind": "socket", "reason": "Original local listener is recreated by the dataset seller."})
                continue
            ordinary(child, path)
            if name == "dataset/control.json":
                raw = read_small(path, 1024)
                control = parse(raw, name)
                if control.get("schema") != "stellar-forge.dataset-control.v1":
                    fail("GTFS_DATASET_CONTROL_INVALID", "The retained native control descriptor needs its original owner.")
                observed[name] = signature(child)
                excluded.append({"file": name, "kind": "control", "bytes": len(raw), "sha256": sha(raw),
                                 "reason": "Original local listener credentials are recreated by the dataset seller."})
                continue
            if len(files) + len(directories) >= ENTRY_MAX:
                fail("GTFS_ARCHIVE_ENTRIES", "The complete workspace exceeds the transfer entry limit.", 413)
            total += child.st_size
            if total > TOTAL_MAX:
                fail("GTFS_ARCHIVE_SIZE", "The complete workspace exceeds the transfer byte limit.", 413)
            metadata = {"file": name, "bytes": child.st_size, "mode": format(stat.S_IMODE(child.st_mode), "04o")}
            if hash_files:
                checked, sig = fingerprint(path)
                metadata.update(checked)
                observed[name] = sig
            else:
                observed[name] = signature(child)
            files.append(metadata)
    walk(root)
    return {"files": files, "directories": directories, "observed": observed, "excluded": excluded, "totalBytes": total}

def validate_manifest(manifest):
    if manifest.get("schema") != SCHEMA:
        fail("GTFS_ARCHIVE_SCHEMA", "Select an original GTFS workspace archive.", 422)
    if (not valid_uuid(manifest.get("workspaceId"))
            or type(manifest.get("revision")) is not int or manifest["revision"] < 0
            or not valid_hash(manifest.get("workspaceJsonSha256"))):
        fail("GTFS_ARCHIVE_BINDING", "The workspace archive identity is invalid.", 422)
    origin = manifest.get("sourceDirectory")
    if (not isinstance(origin, str) or not PurePosixPath(origin).is_absolute()
            or str(PurePosixPath(origin)) != origin or origin == "/"
            or "\\" in origin or any(ord(c) < 32 for c in origin)
            or any(part in (".", "..") for part in PurePosixPath(origin).parts)):
        fail("GTFS_ARCHIVE_BINDING", "The original workspace directory is invalid.", 422)
    items, directories = manifest.get("files"), manifest.get("directories")
    if not isinstance(items, list) or not items or not isinstance(directories, list) or len(items) + len(directories) > ENTRY_MAX:
        fail("GTFS_ARCHIVE_ENTRIES", "The complete archive member list is invalid.", 422)
    dirs = set()
    for name in directories:
        name = member(name)
        if name in dirs:
            fail("GTFS_ARCHIVE_DUPLICATE", "The archive repeats a directory.", 422)
        dirs.add(name)
    declared, total = {}, 0
    for item in items:
        if not isinstance(item, dict) or set(item) != {"file", "bytes", "sha256", "mode"}:
            fail("GTFS_ARCHIVE_MANIFEST", "A retained file declaration is invalid.", 422)
        name = member(item["file"])
        if (name in declared or name in dirs or type(item["bytes"]) is not int
                or not 0 <= item["bytes"] <= FILE_MAX or not valid_hash(item["sha256"])
                or not isinstance(item["mode"], str) or not re.fullmatch(r"0[0-7]{3}", item["mode"])
                or int(item["mode"], 8) & 0o7077):
            fail("GTFS_ARCHIVE_MANIFEST", "A retained file identity is invalid.", 422)
        total += item["bytes"]
        if total > TOTAL_MAX:
            fail("GTFS_ARCHIVE_SIZE", "The archive's complete expanded data exceeds its limit.", 413)
        declared[name] = item
    for name in [*dirs, *declared]:
        for parent in PurePosixPath(name).parents:
            if str(parent) != "." and str(parent) not in dirs:
                fail("GTFS_ARCHIVE_MANIFEST", "The archive omits a parent directory.", 422)
    if (type(manifest.get("fileCount")) is not int or type(manifest.get("totalBytes")) is not int
            or manifest["fileCount"] != len(declared) or manifest["totalBytes"] != total
            or "workspace.json" not in declared
            or declared["workspace.json"]["sha256"] != manifest["workspaceJsonSha256"]):
        fail("GTFS_ARCHIVE_MANIFEST", "The complete workspace manifest totals or root binding differ.", 422)
    excluded = manifest.get("runtimeExclusions", [])
    if not isinstance(excluded, list) or len(excluded) > 2:
        fail("GTFS_ARCHIVE_MANIFEST", "The native runtime exclusions are invalid.", 422)
    exclusions = set()
    for item in excluded:
        if not isinstance(item, dict) or item.get("file") not in ("dataset/control.sock", "dataset/control.json"):
            fail("GTFS_ARCHIVE_MANIFEST", "Only original local dataset listener state can be omitted.", 422)
        name = item["file"]
        if name in exclusions or name in dirs or name in declared:
            fail("GTFS_ARCHIVE_MANIFEST", "A runtime exclusion conflicts with retained data.", 422)
        exclusions.add(name)
    publisher = manifest.get("publisherRelocation")
    if publisher is not None:
        if (not isinstance(publisher, dict)
                or publisher.get("file") != "publisher/workspace.json"
                or publisher.get("sourceFile") != "selected-source.json"
                or publisher.get("targetDirectory") != "dataset"
                or publisher.get("originalSourceFile") != origin + "/selected-source.json"
                or publisher.get("originalTargetDirectory") != origin + "/dataset"
                or publisher["file"] not in declared
                or publisher.get("sha256") != declared[publisher["file"]]["sha256"]):
            fail("GTFS_ARCHIVE_PUBLISHER_BINDING", "The original publisher runtime relocation declaration is invalid.", 422)
    elif "publisher/workspace.json" in declared:
        fail("GTFS_ARCHIVE_PUBLISHER_BINDING", "The original publisher runtime declaration is missing.", 422)
    return declared, dirs

def result_summary(manifest, manifest_raw, archive_identity):
    return {
        "schema": SCHEMA, "workspaceId": manifest["workspaceId"], "revision": manifest["revision"],
        "workspaceJsonSha256": manifest["workspaceJsonSha256"], "sourceDirectory": manifest["sourceDirectory"],
        "manifestSha256": sha(manifest_raw), "archiveSha256": archive_identity["sha256"],
        "bytes": archive_identity["bytes"], "fileCount": manifest["fileCount"],
        "totalBytes": manifest["totalBytes"], "publisherRelocation": manifest.get("publisherRelocation"),
        "runtimeExclusions": manifest.get("runtimeExclusions", []),
    }

def export_workspace(workspace, output, workspace_id):
    root = directory(workspace)
    destination = output_file(output, root)
    state, state_raw, publisher = workspace_binding(root, workspace_id)
    with dataset_exclusion(root):
        check_sqlite_quiescent(root)
        snapshot = inventory(root)
        observed_state = next((item for item in snapshot["files"] if item["file"] == "workspace.json"), None)
        if observed_state is None or observed_state["sha256"] != sha(state_raw):
            fail("GTFS_WORKSPACE_CHANGED", "The original workspace changed before export.")
        manifest = {
            "schema": SCHEMA, "createdAt": stamp(), "workspaceId": workspace_id,
            "revision": state["revision"], "workspaceJsonSha256": sha(state_raw),
            "sourceDirectory": str(root), "fileCount": len(snapshot["files"]),
            "totalBytes": snapshot["totalBytes"], "directories": snapshot["directories"],
            "files": snapshot["files"], "runtimeExclusions": snapshot["excluded"],
            "publisherRelocation": publisher,
        }
        validate_manifest(manifest)
        manifest_raw = encoded(manifest)
        if len(manifest_raw) > META_MAX:
            fail("GTFS_ARCHIVE_METADATA_SIZE", "The complete manifest exceeds its transfer limit.", 413)
        fd, temporary_name = tempfile.mkstemp(prefix=".gtfs-workspace-export-", dir=destination.parent)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(fd, "wb") as handle:
                with gzip.GzipFile(fileobj=handle, mode="wb", filename="", mtime=0) as compressed:
                    with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.PAX_FORMAT) as archive:
                        item = tarfile.TarInfo("bundle.json")
                        item.size, item.mode, item.mtime = len(manifest_raw), 0o600, 0
                        archive.addfile(item, io.BytesIO(manifest_raw))
                        for expected in snapshot["files"]:
                            path = root / expected["file"]
                            source, before = opened(path)
                            with source:
                                if signature(before) != snapshot["observed"][expected["file"]]:
                                    fail("GTFS_WORKSPACE_CHANGED", "A retained file changed before capture.")
                                item = tarfile.TarInfo("workspace/" + expected["file"])
                                item.size, item.mode, item.mtime = expected["bytes"], int(expected["mode"], 8), 0
                                class Reader:
                                    def __init__(self):
                                        self.digest, self.count = hashlib.sha256(), 0
                                    def read(self, size):
                                        part = source.read(size)
                                        self.digest.update(part)
                                        self.count += len(part)
                                        return part
                                reader = Reader()
                                archive.addfile(item, reader)
                                extra = source.read(1)
                                after_read(source, path, before, reader.count)
                                if extra or reader.digest.hexdigest() != expected["sha256"]:
                                    fail("GTFS_WORKSPACE_CHANGED", "A retained file differs from its complete manifest.")
                handle.flush()
                os.fsync(handle.fileno())
            check_sqlite_quiescent(root)
            current = inventory(root, hash_files=False)
            if current["observed"] != snapshot["observed"] or current["excluded"] != snapshot["excluded"]:
                fail("GTFS_WORKSPACE_CHANGED", "The workspace changed during complete archive capture.")
            identity, _ = fingerprint(temporary, ARCHIVE_MAX)
            publish_new(temporary, destination, "GTFS_ARCHIVE_EXISTS")
            sync(destination.parent)
            return {"file": str(destination), **result_summary(manifest, manifest_raw, identity)}
        finally:
            temporary.unlink(missing_ok=True)

def validate_root_payload(manifest, declared, captured):
    raw = captured.get("workspace.json")
    if raw is None or sha(raw) != manifest["workspaceJsonSha256"]:
        fail("GTFS_ARCHIVE_ROOT_CHANGED", "The archive's original workspace JSON differs.", 422)
    state = parse(raw, "workspace.json")
    if (state.get("schema") != WORKSPACE_SCHEMA or state.get("id") != manifest["workspaceId"]
            or state.get("revision") != manifest["revision"] or type(state.get("revision")) is not int
            or state.get("pending") is not None):
        fail("GTFS_ARCHIVE_ROOT_CHANGED", "The archived root identity, revision or operation state differs.", 422)
    expected = {"directory": "publisher", "sourceFile": "selected-source.json", "targetDirectory": "dataset"}
    if state.get("publisher") is not None and state["publisher"] != expected:
        fail("GTFS_ARCHIVE_PUBLISHER_BINDING", "The archived root publisher binding differs.", 422)
    publisher = manifest.get("publisherRelocation")
    if publisher is not None:
        settings_raw = captured.get("publisher/workspace.json")
        if settings_raw is None or sha(settings_raw) != publisher["sha256"]:
            fail("GTFS_ARCHIVE_PUBLISHER_BINDING", "The original publisher settings differ.", 422)
        settings = parse(settings_raw, "publisher/workspace.json")
        if (settings.get("schema") != PUBLISHER_SCHEMA
                or settings.get("sourceFile") != publisher["originalSourceFile"]
                or settings.get("targetDirectory") != publisher["originalTargetDirectory"]):
            fail("GTFS_ARCHIVE_PUBLISHER_BINDING", "The original publisher paths differ from their relocation declaration.", 422)
        if ("selected-source.json" not in captured
                and (state.get("selection") is not None or state.get("selectedEditionId") is not None)):
            fail("GTFS_ARCHIVE_SOURCE_BINDING", "The selected original publisher source is absent.", 422)
    if "selected-source.json" in captured:
        config = parse(captured["selected-source.json"], "selected-source.json")
        connection = config.get("connection")
        if config.get("schema") != "stellar-forge.frictionless-source.v1" or not isinstance(connection, dict):
            fail("GTFS_ARCHIVE_SOURCE_BINDING", "The original selected source is invalid.", 422)
        name = member(connection.get("file"))
        if (not name.startswith("editions/") or not name.endswith("/capture/capture.json")
                or name not in declared or connection.get("sha256") != declared[name]["sha256"]):
            fail("GTFS_ARCHIVE_SOURCE_BINDING", "The selected source must point to its exact retained capture.", 422)
    return state

def stream_archive(archive_file, expected_sha256, destination=None, workspace_id=None):
    if not isinstance(expected_sha256, str) or not HASH.fullmatch(expected_sha256):
        fail("GTFS_ARCHIVE_HASH_REQUIRED", "Supply the original complete archive SHA-256.", 422)
    path = Path(archive_file).absolute()
    raw, before = opened(path)
    with raw:
        if before.st_size > ARCHIVE_MAX:
            fail("GTFS_ARCHIVE_SIZE", "The complete archive exceeds its transfer limit.", 413)
        digest, compressed_bytes = hashlib.sha256(), 0
        while chunk := raw.read(CHUNK):
            compressed_bytes += len(chunk)
            digest.update(chunk)
        after_read(raw, path, before, compressed_bytes)
        if digest.hexdigest() != expected_sha256:
            fail("GTFS_ARCHIVE_HASH_MISMATCH", "The selected archive differs from its original SHA-256.", 422)
        raw.seek(0)
        identity = {"sha256": expected_sha256, "bytes": compressed_bytes}
        captured, seen, total = {}, set(), 0
        class ExpandedReader:
            def __init__(self, handle):
                self.handle, self.total = handle, 0
            def read(self, size=-1):
                if size < 0:
                    size = CHUNK
                data = self.handle.read(size)
                self.total += len(data)
                if self.total > TOTAL_MAX + META_MAX + ENTRY_MAX * 8192:
                    fail("GTFS_ARCHIVE_SIZE", "The archive exceeds its complete expanded limit.", 413)
                return data
        try:
            with gzip.GzipFile(fileobj=raw, mode="rb") as compressed:
                with tarfile.open(fileobj=ExpandedReader(compressed), mode="r|", ignore_zeros=True) as archive:
                    members = iter(archive)
                    first = next(members, None)
                    if (first is None or first.name != "bundle.json" or not first.isfile()
                            or first.linkname or not 0 < first.size <= META_MAX):
                        fail("GTFS_ARCHIVE_MANIFEST", "The archive must begin with its complete manifest.", 422)
                    with archive.extractfile(first) as manifest_file:
                        manifest_raw = manifest_file.read(META_MAX + 1)
                    if len(manifest_raw) != first.size:
                        fail("GTFS_ARCHIVE_TRUNCATED", "The archive manifest is incomplete.", 422)
                    manifest = parse(manifest_raw, "bundle.json")
                    declared, directories = validate_manifest(manifest)
                    if workspace_id is not None and manifest["workspaceId"] != workspace_id:
                        fail("GTFS_WORKSPACE_BINDING", "This archive belongs to a different original workspace.")
                    if destination is not None:
                        for name in sorted(directories, key=lambda value: (len(PurePosixPath(value).parts), value)):
                            (destination / name).mkdir(mode=0o700)
                    for item in members:
                        full_name = member(item.name)
                        if not full_name.startswith("workspace/"):
                            fail("GTFS_ARCHIVE_MEMBER", "An archive member is outside its declared workspace.", 422)
                        name = member(full_name[len("workspace/"):])
                        expected = declared.get(name)
                        if (expected is None or name in seen or not item.isfile() or item.linkname
                                or item.size != expected["bytes"]
                                or stat.S_IMODE(item.mode) != int(expected["mode"], 8)):
                            fail("GTFS_ARCHIVE_MEMBER", "An archive member differs from the complete manifest.", 422)
                        seen.add(name)
                        total += item.size
                        keep = name in ("workspace.json", "publisher/workspace.json", "selected-source.json")
                        if keep and item.size > META_MAX:
                            fail("GTFS_ARCHIVE_METADATA_SIZE", "Retained application metadata is too large.", 413)
                        chunks, count, digest = [], 0, hashlib.sha256()
                        target = None
                        try:
                            if destination is not None:
                                target = (destination / name).open("xb")
                                os.fchmod(target.fileno(), 0o600)
                            with archive.extractfile(item) as source:
                                while chunk := source.read(min(CHUNK, item.size - count + 1)):
                                    count += len(chunk)
                                    if count > item.size:
                                        fail("GTFS_ARCHIVE_TRUNCATED", "An archive member has extra bytes.", 422)
                                    digest.update(chunk)
                                    if target is not None:
                                        target.write(chunk)
                                    if keep:
                                        chunks.append(chunk)
                            if count != item.size or digest.hexdigest() != expected["sha256"]:
                                fail("GTFS_ARCHIVE_MEMBER_CHANGED", "An original retained file failed complete verification: " + name, 422)
                            if keep:
                                captured[name] = b"".join(chunks)
                            if target is not None:
                                target.flush()
                                os.fchmod(target.fileno(), int(expected["mode"], 8))
                                os.fsync(target.fileno())
                        finally:
                            if target is not None:
                                target.close()
                    if seen != set(declared) or total != manifest["totalBytes"]:
                        fail("GTFS_ARCHIVE_TRUNCATED", "The archive omits original retained workspace files.", 422)
            after_read(raw, path, before, compressed_bytes)
        except (tarfile.TarError, gzip.BadGzipFile, EOFError) as error:
            fail("GTFS_ARCHIVE_INVALID", "The complete archive could not be decoded: " + str(error), 422)
    state = validate_root_payload(manifest, declared, captured)
    return manifest, manifest_raw, captured, identity, state

def inspect_archive(archive_file, expected_sha256):
    manifest, manifest_raw, _, identity, _ = stream_archive(archive_file, expected_sha256)
    return {"file": str(Path(archive_file).absolute()), "verified": True,
            **result_summary(manifest, manifest_raw, identity)}

def publish_new(source, destination, collision_code):
    """Atomic create-only promotion, without a crash window retaining two links."""
    if sys.platform != "linux":
        fail("GTFS_ATOMIC_PUBLISH_LINUX_REQUIRED", "Publish the original archive or workspace on its installed Linux runtime.")
    library = ctypes.CDLL(None, use_errno=True)
    rename = getattr(library, "renameat2", None)
    if rename is None:
        fail("GTFS_ATOMIC_PUBLISH_UNAVAILABLE", "This runtime needs Linux create-only file and directory promotion.")
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(source), -100, os.fsencode(destination), 1) != 0:
        code = ctypes.get_errno()
        if code in (errno.EEXIST, errno.ENOTEMPTY):
            fail(collision_code, "The original destination already exists; reconcile its original transfer.")
        if code in (errno.ENOSYS, errno.EINVAL, errno.EOPNOTSUPP):
            fail("GTFS_ATOMIC_PUBLISH_UNAVAILABLE", "The target filesystem does not support create-only file and directory promotion.")
        raise OSError(code, os.strerror(code), str(destination))

def recovered_receive(destination, expected_id, manifest, manifest_raw, identity):
    root = directory(destination)
    receipt_root = root / ".gtfs-receive" / identity["sha256"]
    receipt = parse(read_small(receipt_root / "receipt.json"), "original receiving receipt")
    retained_manifest = read_small(receipt_root / "source-manifest.json")
    if (receipt.get("schema") != RECEIPT_SCHEMA or receipt.get("archiveSha256") != identity["sha256"]
            or receipt.get("archiveBytes") != identity["bytes"] or receipt.get("workspaceId") != expected_id
            or receipt.get("receivedDirectory") != str(root)
            or receipt.get("manifestSha256") != sha(manifest_raw) or retained_manifest != manifest_raw
            or receipt.get("workspaceJsonSha256") != manifest["workspaceJsonSha256"]):
        fail("GTFS_RECEIVE_EXISTS", "The existing directory has a different original receiving receipt.")
    current_raw = read_small(root / "workspace.json")
    current = parse(current_raw, "current workspace.json")
    if current.get("schema") != WORKSPACE_SCHEMA or current.get("id") != expected_id or type(current.get("revision")) is not int:
        fail("GTFS_RECEIVE_EXISTS", "The existing directory no longer has this original workspace identity.")
    # A lost reply must never restore over later operator work. This returns the
    # exact previous receipt and explicitly reports the current root revision.
    return {
        "directory": str(root), "receiptFile": str(receipt_root / "receipt.json"),
        "receivedAt": receipt["receivedAt"], "recovered": True,
        "currentRevision": current["revision"], "currentWorkspaceJsonSha256": sha(current_raw),
        "relocations": receipt["relocations"], **result_summary(manifest, manifest_raw, identity),
    }

def receive_workspace(archive_file, output, expected_sha256, workspace_id):
    if not valid_uuid(workspace_id):
        fail("GTFS_WORKSPACE_ID", "Supply the original GTFS workspace UUID.", 422)
    destination = Path(output).absolute()
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if destination.parent.resolve() != destination.parent or destination == destination.parent:
        fail("GTFS_PRIVATE_DIRECTORY", "Choose an original normalized receiving path without symlink components.")
    if not absent(destination):
        manifest, manifest_raw, _, identity, _ = stream_archive(archive_file, expected_sha256, workspace_id=workspace_id)
        try:
            return recovered_receive(destination, workspace_id, manifest, manifest_raw, identity)
        except FileNotFoundError:
            fail("GTFS_RECEIVE_EXISTS", "The existing directory is not this completed original transfer.")
    if sys.platform != "linux":
        fail("GTFS_RECEIVE_LINUX_REQUIRED", "Receive this original publisher workspace on its installed Linux runtime.")
    temporary = Path(tempfile.mkdtemp(prefix=".gtfs-workspace-receive-", dir=destination.parent))
    try:
        manifest, manifest_raw, captured, identity, state = stream_archive(
            archive_file, expected_sha256, destination=temporary, workspace_id=workspace_id)
        receipt_relative = ".gtfs-receive/" + expected_sha256
        receipt_root = temporary / receipt_relative
        receipt_root.mkdir(parents=True, mode=0o700)
        create(receipt_root / "source-manifest.json", manifest_raw)
        relocations = []
        declared = manifest.get("publisherRelocation")
        if declared is not None:
            original_raw = captured["publisher/workspace.json"]
            original = parse(original_raw, "publisher/workspace.json")
            create(receipt_root / "publisher-workspace.original.json", original_raw)
            relocated = {**original, "sourceFile": str(destination / declared["sourceFile"]),
                         "targetDirectory": str(destination / declared["targetDirectory"])}
            new_raw = encoded(relocated)
            current_file = temporary / "publisher" / "workspace.json"
            replacement = current_file.with_name(".workspace-relocation-" + expected_sha256 + ".json")
            create(replacement, new_raw)
            os.replace(replacement, current_file)
            sync(current_file.parent)
            relocations.append({
                "file": "publisher/workspace.json", "originalSha256": sha(original_raw),
                "receivedSha256": sha(new_raw), "originalFile": receipt_relative + "/publisher-workspace.original.json",
                "fields": {
                    "sourceFile": {"before": original["sourceFile"], "after": relocated["sourceFile"]},
                    "targetDirectory": {"before": original["targetDirectory"], "after": relocated["targetDirectory"]},
                },
            })
        if sha(read_small(temporary / "workspace.json")) != manifest["workspaceJsonSha256"]:
            fail("GTFS_ARCHIVE_ROOT_CHANGED", "Receiving changed the original workspace state.")
        receipt = {
            "schema": RECEIPT_SCHEMA, "receivedAt": stamp(), "workspaceId": workspace_id,
            "revision": state["revision"], "workspaceJsonSha256": manifest["workspaceJsonSha256"],
            "archiveSha256": expected_sha256, "archiveBytes": identity["bytes"],
            "manifestSha256": sha(manifest_raw), "sourceDirectory": manifest["sourceDirectory"],
            "receivedDirectory": str(destination), "originalFileCount": manifest["fileCount"],
            "originalBytes": manifest["totalBytes"], "relocations": relocations,
            "runtimeExclusions": manifest.get("runtimeExclusions", []),
        }
        create(receipt_root / "receipt.json", encoded(receipt))
        # Every directory and every original file is durable before publication.
        for base, subdirs, _ in os.walk(temporary, topdown=False):
            sync(Path(base))
        publish_new(temporary, destination, "GTFS_RECEIVE_EXISTS")
        sync(destination.parent)
        return {
            "directory": str(destination), "receiptFile": str(destination / receipt_relative / "receipt.json"),
            "receivedAt": receipt["receivedAt"], "recovered": False, "relocations": relocations,
            "currentRevision": state["revision"], "currentWorkspaceJsonSha256": manifest["workspaceJsonSha256"],
            **result_summary(manifest, manifest_raw, identity),
        }
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export", help="Export the whole gated original workspace.")
    export.add_argument("--workspace", required=True)
    export.add_argument("--output", required=True)
    export.add_argument("--workspace-id", required=True)
    inspect = commands.add_parser("inspect", help="Verify every archive member and expose the original root identity.")
    inspect.add_argument("--archive", required=True)
    inspect.add_argument("--sha256", required=True)
    receive = commands.add_parser("receive", help="Receive privately into a new original workspace directory.")
    receive.add_argument("--archive", required=True)
    receive.add_argument("--sha256", required=True)
    receive.add_argument("--output", required=True)
    receive.add_argument("--workspace-id", required=True)
    args = parser.parse_args()
    if args.command == "export":
        result = export_workspace(args.workspace, args.output, args.workspace_id)
    elif args.command == "inspect":
        result = inspect_archive(args.archive, args.sha256)
    else:
        result = receive_workspace(args.archive, args.output, args.sha256, args.workspace_id)
    sys.stdout.buffer.write(encoded(result))
    sys.stdout.buffer.flush()

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.stderr.write(json.dumps({"error": "GTFS_ARCHIVE_CANCELLED",
                                     "message": "The original transfer stopped before its next completion."}) + "\n")
        sys.exit(130)
    except Exception as error:
        sys.stderr.write(json.dumps({"error": getattr(error, "code", "GTFS_ARCHIVE_FAILED"),
                                     "status": getattr(error, "status", 409),
                                     "message": str(error)}, ensure_ascii=False) + "\n")
        sys.exit(1)
