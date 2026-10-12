"""Inspect and recoverably receive a complete, offline Analysis workspace.

The original application owns normal database recovery after publication.
Receiving copies verified bytes; it never constructs an AnalysisWorkspace.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import errno
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import sys
import uuid
import zipfile

from .analysis_workbooks import _open_private, _publish_received_directory
from .errors import BuyerError, StateError
from .storage import dump, lock, parse, private_directory, sync_directory

_ARCHIVE = "stellar-forge.analysis-workspace-archive.v1"
_JOURNAL = "stellar-forge.analysis-workspace-receiving.v1"
_RECEIPT = "stellar-forge.analysis-workspace-receipt.v1"
_MARKER = "workspace-archive-receipt.json"
_ID = re.compile(r"[a-f0-9]{32}")
_HASH = re.compile(r"[a-f0-9]{64}")
_MAX_RECORD = 1024 * 1024
_BLOCK = 1024 * 1024
_TABLES = {"sf_dataset_versions", "sf_dataset_views", "sf_dataset_activations",
           "sf_analysis_format", "sf_analysis_sources", "sf_analysis_queries",
           "sf_analysis_query_history", "sf_analysis_jobs"}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _error(code, operation=None):
    raise StateError("WORKSPACE_ARCHIVE_RECEIVE_" + code, operation=operation)


def _identifier(value):
    if not isinstance(value, str) or not _ID.fullmatch(value):
        _error("OPERATION_ID_INVALID")
    return value


def _private_folder(path, *, create=True):
    missing, current = [], Path(path).expanduser().absolute()
    while create and not os.path.lexists(current):
        missing.append(current)
        current = current.parent
    folder = private_directory(Path(path), create=create)
    info = folder.lstat()
    if hasattr(os, "getuid") and info.st_uid != os.getuid():
        _error("PRIVATE_DIRECTORY_REQUIRED")
    for created in missing:
        sync_directory(created.parent)
    return folder


def _record(path):
    with _open_private(path) as stream:
        raw = stream.read(_MAX_RECORD + 1)
    if len(raw) > _MAX_RECORD:
        _error("JOURNAL_INVALID")
    result = parse(raw)
    if not isinstance(result, dict):
        _error("JOURNAL_INVALID")
    return result


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        _error("MEMBER_PATH_INVALID")
    path = PurePosixPath(value)
    if (not path.parts or path.is_absolute() or str(path) != value
            or any(part in {"", ".", ".."} for part in path.parts)
            or value == _MARKER):
        _error("MEMBER_PATH_INVALID")
    return value


def _files(inspection):
    manifest = inspection.get("manifest")
    if not isinstance(manifest, dict) or manifest.get("schema") != _ARCHIVE:
        _error("MANIFEST_INVALID")
    _identifier(manifest.get("id"))
    _identifier(manifest.get("workspace_id"))
    files, names = manifest.get("files"), set()
    if not isinstance(files, list) or not files:
        _error("MANIFEST_INVALID")
    for item in files:
        if not isinstance(item, dict):
            _error("MANIFEST_INVALID")
        name = _relative(item.get("path"))
        if (name in names or type(item.get("bytes")) is not int or item["bytes"] < 0
                or not isinstance(item.get("sha256"), str)
                or not _HASH.fullmatch(item["sha256"])):
            _error("MANIFEST_INVALID")
        names.add(name)
    database = manifest.get("database")
    if (not isinstance(database, dict) or database.get("path") != "datasets.sqlite3"
            or sum(item == database for item in files) != 1):
        _error("DATABASE_MEMBER_INVALID")
    # A regular file cannot also be a directory for another retained payload.
    if any(str(parent) in names for name in names for parent in PurePosixPath(name).parents
           if str(parent) != "."):
        _error("MEMBER_PATH_INVALID")
    return manifest, files


def _file_matches(path, expected):
    if not os.path.lexists(path):
        return False
    with _open_private(path) as stream:
        info = os.fstat(stream.fileno())
        if info.st_size != expected["bytes"]:
            return False
        if hashlib.file_digest(stream, "sha256").hexdigest() != expected["sha256"]:
            return False
        # A killed writer may have left complete bytes in the page cache.
        os.fsync(stream.fileno())
    return True


def _member(package, entry, destination):
    if os.path.lexists(destination):
        with _open_private(destination):
            pass
        destination.unlink()
    sha, size = hashlib.sha256(), 0
    with package.open("workspace/" + entry["path"]) as source:
        with destination.open("xb") as output:
            os.fchmod(output.fileno(), 0o600)
            for block in iter(lambda: source.read(_BLOCK), b""):
                size += len(block)
                if size > entry["bytes"]:
                    _error("MEMBER_CHANGED")
                sha.update(block)
                output.write(block)
            output.flush()
            os.fsync(output.fileno())
    if size != entry["bytes"] or sha.hexdigest() != entry["sha256"]:
        _error("MEMBER_CHANGED")
    sync_directory(destination.parent)


def _staged_tree(staging, files, *, complete=False):
    expected = {entry["path"] for entry in files}
    allowed_dirs = {str(parent) for name in expected for parent in PurePosixPath(name).parents
                    if str(parent) != "."}
    found = set()
    for root, directories, names in os.walk(staging, followlinks=False):
        folder = Path(root)
        _private_folder(folder, create=False)
        for name in directories:
            path = folder / name
            if path.is_symlink() or path.relative_to(staging).as_posix() not in allowed_dirs:
                _error("STAGING_CHANGED")
        for name in names:
            path = folder / name
            relative = path.relative_to(staging).as_posix()
            if relative not in expected and relative != _MARKER:
                _error("STAGING_CHANGED")
            with _open_private(path):
                pass
            if relative != _MARKER:
                found.add(relative)
    if complete and found != expected:
        _error("STAGING_INCOMPLETE")


def _validate_database(staging, manifest):
    path = staging / "datasets.sqlite3"
    # Immutable inspection neither creates WAL/SHM files nor runs application
    # initialization or interrupted-job reconciliation on the original bytes.
    uri = path.as_uri() + "?mode=ro&immutable=1"
    try:
        db = sqlite3.connect(uri, uri=True)
        try:
            db.execute("PRAGMA query_only=ON")
            db.execute("PRAGMA trusted_schema=OFF")
            if (db.execute("PRAGMA application_id").fetchone()[0] != 0x53464442
                    or db.execute("PRAGMA user_version").fetchone()[0] != 1
                    or db.execute("PRAGMA quick_check").fetchall() != [("ok",)]):
                _error("DATABASE_INVALID")
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not _TABLES.issubset(tables):
                _error("DATABASE_FORMAT_INVALID")
            identity = db.execute("SELECT schema,workspace_id FROM sf_analysis_format WHERE id=1").fetchall()
            if identity != [("stellar-forge.customer-analysis.v1", manifest["workspace_id"])]:
                _error("DATABASE_IDENTITY_CHANGED")
            counts = manifest.get("table_rows", {})
            if not isinstance(counts, dict):
                _error("DATABASE_COUNTS_INVALID")
            for name, expected in counts.items():
                if name not in tables or type(expected) is not int or expected < 0:
                    _error("DATABASE_COUNTS_INVALID")
                quoted = '"' + name.replace('"', '""') + '"'
                if db.execute("SELECT COUNT(*) FROM " + quoted).fetchone()[0] != expected:
                    _error("DATABASE_ROWS_CHANGED")
        finally:
            db.close()
    except sqlite3.Error:
        _error("DATABASE_INVALID")


def _published(target, state):
    if not os.path.lexists(target):
        return False
    _private_folder(target, create=False)
    info = target.lstat()
    if (state.get("phase") not in {"prepared", "complete"}
            or state.get("directory") != {"device": info.st_dev, "inode": info.st_ino}
            or _record(target / _MARKER) != state.get("marker")):
        _error("TARGET_EXISTS", state["operation_id"])
    return True


def _finish(control, target, state, reused):
    # This also covers rename succeeding immediately before process termination.
    sync_directory(target.parent)
    sync_directory(control)
    if state["phase"] != "complete":
        state["phase"] = "complete"
        state["result"] = {**state["marker"], "state": "complete", "completed_at": _now()}
        dump(control / "operation.json", state)
    return {**state["result"], "reused": reused}


def _write_marker(control, staging, marker):
    # The existing atomic JSON writer may leave its temporary file on SIGKILL.
    # Keep those write temporaries in the private journal, outside payloads.
    temporary = control / "publication.json"
    dump(temporary, marker)
    os.replace(temporary, staging / _MARKER)
    sync_directory(staging)
    sync_directory(control)


def restore_archive(archive, target, *, operation=None, expected_sha256=None):
    """Receive one exact archive into an absent destination, with crash recovery.

    A caller can retain a UUID32 ``operation`` before dispatch. Without one, the
    destination's private journal allocates it once. Repeating the same command
    returns the saved result after completion, preserving later customer edits.
    """
    from .workspace_archive import inspect_archive

    if operation is not None:
        operation = _identifier(operation)
    inspection = inspect_archive(archive, expected_sha256=expected_sha256)
    manifest, files = _files(inspection)
    target = Path(target).expanduser().absolute()
    if not target.name or target.name in {".", ".."}:
        _error("TARGET_INVALID")
    parent = _private_folder(target.parent)
    target = parent / target.name
    control = parent / (".analysis-receive-" + hashlib.sha256(os.fsencode(target.name)).hexdigest()[:24])
    if os.path.lexists(target) and not os.path.lexists(control / "operation.json"):
        _error("TARGET_EXISTS", operation)
    control = _private_folder(control)
    sync_directory(control.parent)
    record_path, staging = control / "operation.json", control / "content"
    binding = {"schema": _JOURNAL, "target": str(target), "archive_id": manifest["id"],
               "workspace_id": manifest["workspace_id"], "archive_sha256": inspection["archive"]["sha256"],
               "archive_bytes": inspection["archive"]["bytes"], "manifest_sha256": inspection["manifest_sha256"]}
    with lock(control):
        reused = os.path.lexists(record_path)
        if reused:
            state = _record(record_path)
            if (any(state.get(key) != value for key, value in binding.items())
                    or state.get("phase") not in {"extracting", "prepared", "complete"}
                    or not isinstance(state.get("operation_id"), str)
                    or not _ID.fullmatch(state["operation_id"])
                    or operation is not None and operation != state["operation_id"]):
                _error("OPERATION_CHANGED", operation)
        else:
            if os.path.lexists(staging) or os.path.lexists(target):
                _error("TARGET_EXISTS", operation)
            operation = operation or uuid.uuid4().hex
            state = {**binding, "operation_id": operation, "phase": "extracting", "created_at": _now()}
            # The retained operation lock already serializes first creation.
            # Rename publication avoids a hardlink alias left by SIGKILL
            # between an exclusive writer's link and temporary-file unlink.
            dump(record_path, state)
        operation = state["operation_id"]
        if _published(target, state):
            return _finish(control, target, state, True)
        if state["phase"] == "complete":
            _error("PUBLISHED_DIRECTORY_MISSING", operation)
        if not os.path.lexists(staging):
            if state["phase"] == "prepared":
                _error("STAGING_MISSING", operation)
            _private_folder(staging)
            sync_directory(control)
        else:
            _private_folder(staging, create=False)
        if state["phase"] == "prepared":
            info = staging.lstat()
            if state.get("directory") != {"device": info.st_dev, "inode": info.st_ino}:
                _error("STAGING_CHANGED", operation)
        _staged_tree(staging, files)
        ready = {entry["path"] for entry in files if _file_matches(staging / entry["path"], entry)}
        # A partial ZIP member is re-extracted from its beginning. Release only
        # those exact incomplete private members before admitting the retry.
        for entry in files:
            path = staging / entry["path"]
            if entry["path"] not in ready and os.path.lexists(path):
                with _open_private(path):
                    pass
                path.unlink()
                sync_directory(path.parent)
        required = sum(entry["bytes"] for entry in files if entry["path"] not in ready)
        space = os.statvfs(control)
        free = (space.f_bfree if hasattr(os, "geteuid") and os.geteuid() == 0 else space.f_bavail) * space.f_frsize
        if required > free:
            _error("STORAGE_REQUIRED", operation)
        with _open_private(Path(inspection["archive"].get("path", archive)).expanduser().absolute()) as source:
            before = os.fstat(source.fileno())
            if (before.st_size != binding["archive_bytes"]
                    or hashlib.file_digest(source, "sha256").hexdigest() != binding["archive_sha256"]):
                _error("ARCHIVE_CHANGED", operation)
            source.seek(0)
            with zipfile.ZipFile(source) as package:
                raw = package.read("archive-manifest.json")
                if hashlib.sha256(raw).hexdigest() != binding["manifest_sha256"]:
                    _error("ARCHIVE_CHANGED", operation)
                for entry in files:
                    if entry["path"] in ready:
                        continue
                    destination = staging / entry["path"]
                    _private_folder(destination.parent)
                    _member(package, entry, destination)
            after = os.fstat(source.fileno())
            if ((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                    != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)):
                _error("ARCHIVE_CHANGED", operation)
        _staged_tree(staging, files, complete=True)
        _validate_database(staging, manifest)
        if state["phase"] != "prepared":
            marker = {"schema": _RECEIPT, "operation_id": operation, "archive_id": manifest["id"],
                      "workspace_id": manifest["workspace_id"], "archive_sha256": binding["archive_sha256"],
                      "archive_bytes": binding["archive_bytes"], "manifest_sha256": binding["manifest_sha256"],
                      "target": str(target), "database_path": str(target / "datasets.sqlite3"),
                      "files": len(files), "bytes": sum(entry["bytes"] for entry in files),
                      "created_at": state["created_at"], "prepared_at": _now(), "reused_staged_files": len(ready)}
            _write_marker(control, staging, marker)
            info = staging.lstat()
            state.update(phase="prepared", directory={"device": info.st_dev, "inode": info.st_ino}, marker=marker)
        elif _record(staging / _MARKER) != state.get("marker"):
            _error("STAGING_CHANGED", operation)
        for root, directories, names in os.walk(staging, topdown=False):
            sync_directory(Path(root))
        dump(record_path, state)
        try:
            _publish_received_directory(staging, target)
        except StateError as error:
            if error.code == "ANALYSIS_WORKBOOK_ATOMIC_DIRECTORY_PUBLICATION_UNAVAILABLE":
                _error("ATOMIC_PUBLICATION_UNAVAILABLE", operation)
            raise
        return _finish(control, target, state, reused)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Inspect or receive a complete original Analysis workspace archive.")
    commands = parser.add_subparsers(dest="command", required=True)
    inspect = commands.add_parser("inspect", help="Validate all archive members and print the receiving review")
    inspect.add_argument("archive", type=Path)
    inspect.add_argument("--sha256", dest="expected_sha256")
    receive = commands.add_parser("receive", help="Resume one private restore and atomically publish its complete workspace")
    receive.add_argument("archive", type=Path)
    receive.add_argument("target", type=Path, help="Absent destination below a private parent directory")
    receive.add_argument("--operation", help="Retained receiving operation UUID32")
    receive.add_argument("--sha256", dest="expected_sha256")
    args = parser.parse_args(argv)
    try:
        os.umask(0o077)
        if args.command == "inspect":
            from .workspace_archive import inspect_archive
            result = inspect_archive(args.archive, expected_sha256=args.expected_sha256)
        else:
            result = restore_archive(args.archive, args.target, operation=args.operation,
                                     expected_sha256=args.expected_sha256)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
        return 0
    except BuyerError as error:
        result = {"error": error.code}
        if error.operation:
            result["operation_id"] = error.operation
    except (zipfile.BadZipFile, EOFError, KeyError, ValueError):
        result = {"error": "WORKSPACE_ARCHIVE_RECEIVE_ARCHIVE_INVALID"}
    except OSError as error:
        code = "STORAGE_FULL" if error.errno in {errno.ENOSPC, errno.EDQUOT} else "IO_ERROR"
        result = {"error": "WORKSPACE_ARCHIVE_RECEIVE_" + code, "errno": error.errno}
    except KeyboardInterrupt:
        print(json.dumps({"error": "WORKSPACE_ARCHIVE_RECEIVE_INTERRUPTED"}), file=sys.stderr)
        return 130
    print(json.dumps(result, ensure_ascii=False, allow_nan=False), file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
