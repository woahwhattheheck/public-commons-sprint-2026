"""Consistent private workspace backup and atomic recovery on Linux."""
from __future__ import annotations

import ctypes
from contextlib import closing
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import zipfile

from .store import OpsError, digest


CHUNK = 1024 * 1024
MAX_EXPANDED = 32 * 1024**3


def _sha(path):
    checksum = hashlib.sha256()
    with open(path, "rb") as stream:
        while chunk := stream.read(CHUNK):
            checksum.update(chunk)
    return checksum.hexdigest()


def _snapshot(source, target):
    with closing(sqlite3.connect(Path(source).as_uri() + "?mode=ro", uri=True)) as original:
        with closing(sqlite3.connect(target)) as destination:
            original.backup(destination, pages=256)
            destination.execute("PRAGMA journal_mode=DELETE")
    os.chmod(target, 0o600)


def _publish_file(temporary, destination):
    os.link(temporary, destination)
    descriptor = os.open(destination.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def backup_workspace(engine, out):
    """Snapshot queued work and its internal SQLite destination together."""
    destination = Path(out).expanduser().absolute()
    if destination.exists() or destination.is_symlink():
        raise FileExistsError("Choose a new backup filename")
    if not destination.parent.is_dir():
        raise ValueError("The backup parent directory must exist")
    descriptor, name = tempfile.mkstemp(prefix=".mercury-backup-", dir=destination.parent)
    os.close(descriptor)
    archive = Path(name)
    try:
        with engine.store.worker_lock() as acquired:
            if not acquired:
                raise OpsError("WORKER_ACTIVE", "The current delivery is still running; retry backup when that operation finishes.", 409)
            with tempfile.TemporaryDirectory(prefix=".mercury-snapshot-", dir=destination.parent) as temporary:
                staging = Path(temporary)
                _snapshot(engine.store.path, staging / "operations.sqlite3")
                document = asdict(engine.config)
                document["workspace"] = "."
                document["schema"] = "mercury-event-operations/v1"
                local_customer = False
                sqlite_restore_path = None
                sink = engine.config.destination
                if sink["kind"] == "sqlite":
                    selected = (engine.config.workspace / sink["path"]).resolve()
                    try:
                        selected.relative_to(engine.config.workspace.resolve())
                        internal = True
                    except ValueError:
                        internal = False
                    sqlite_restore_path = "customer.sqlite3" if internal else str(selected)
                    if internal and selected.is_file():
                        _snapshot(selected, staging / "customer.sqlite3")
                        local_customer = True
                (staging / "config.json").write_text(json.dumps(document, indent=2) + "\n")
                os.chmod(staging / "config.json", 0o600)
                files = sorted(path for path in staging.iterdir() if path.is_file())
                manifest = {"schema": "mercury-ops.backup.v1", "local_customer": local_customer,
                    "sqlite_restore_path": sqlite_restore_path,
                    "files": {path.name: {"bytes": path.stat().st_size, "sha256": _sha(path)} for path in files}}
                with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=3, allowZip64=True) as package:
                    package.writestr("manifest.json", json.dumps(manifest, separators=(",", ":")))
                    for path in files:
                        package.write(path, arcname=path.name)
        with open(archive, "rb") as stream:
            os.fsync(stream.fileno())
        result = {"path": str(destination), "bytes": archive.stat().st_size, "sha256": _sha(archive),
            "local_customer_included": local_customer, "files": list(manifest["files"])}
        _publish_file(archive, destination)
        return result
    finally:
        archive.unlink(missing_ok=True)


def _new_directory(source, destination):
    libc = ctypes.CDLL(None, use_errno=True)
    rename = getattr(libc, "renameat2", None)
    if rename is None:
        raise OSError("This Linux runtime must provide renameat2 for atomic create-only restore")
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(source), -100, os.fsencode(destination), 1):
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), str(destination))


def restore_workspace(database, into):
    """Verify archive lengths/hashes and install a new private workspace."""
    archive = Path(database).expanduser().resolve()
    destination = Path(into).expanduser().absolute()
    if destination.exists() or destination.is_symlink():
        raise FileExistsError("Restore into a new directory")
    if not destination.parent.is_dir():
        raise ValueError("The restore parent directory must exist")
    staging = Path(tempfile.mkdtemp(prefix=".mercury-restore-", dir=destination.parent))
    try:
        with zipfile.ZipFile(archive) as package:
            entries = package.infolist()
            names = [entry.filename for entry in entries]
            allowed = {"manifest.json", "config.json", "operations.sqlite3", "customer.sqlite3"}
            if len(names) != len(set(names)) or not {"manifest.json", "config.json", "operations.sqlite3"}.issubset(names) or not set(names).issubset(allowed):
                raise ValueError("Backup contains an invalid file inventory")
            if any(entry.is_dir() for entry in entries) or sum(entry.file_size for entry in entries) > MAX_EXPANDED:
                raise ValueError("Backup exceeds the supported 32 GiB expanded size")
            if package.getinfo("manifest.json").file_size > 65536 or package.getinfo("config.json").file_size > 262144:
                raise ValueError("Backup metadata is too large")
            manifest = json.loads(package.read("manifest.json"))
            if manifest.get("schema") != "mercury-ops.backup.v1" or not isinstance(manifest.get("files"), dict):
                raise ValueError("Unsupported backup format")
            if set(manifest["files"]) != set(names) - {"manifest.json"}:
                raise ValueError("Backup file inventory does not match its manifest")
            if manifest.get("local_customer") is not ("customer.sqlite3" in names):
                raise ValueError("Backup local customer inventory is inconsistent")
            for name, expected in manifest["files"].items():
                info = package.getinfo(name)
                if info.file_size != expected.get("bytes"):
                    raise ValueError("Backup file length does not match its manifest")
                target = staging / name
                descriptor = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                checksum, count = hashlib.sha256(), 0
                with os.fdopen(descriptor, "wb") as stream, package.open(name) as original:
                    while chunk := original.read(CHUNK):
                        stream.write(chunk)
                        checksum.update(chunk)
                        count += len(chunk)
                    stream.flush()
                    os.fsync(stream.fileno())
                if count != info.file_size or checksum.hexdigest() != expected.get("sha256"):
                    raise ValueError("Backup file does not match its manifest hash")
        document = json.loads((staging / "config.json").read_text())
        for name in ("operations.sqlite3", "customer.sqlite3"):
            path = staging / name
            if path.exists():
                with closing(sqlite3.connect(path)) as connection:
                    if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                        raise ValueError("The recovered database failed its integrity check")
        operation_db = staging / "operations.sqlite3"
        with closing(sqlite3.connect(operation_db)) as connection:
            schema = connection.execute("SELECT value FROM metadata WHERE key='schema'").fetchone()
            if schema != ("mercury-ops.store.v1",):
                raise ValueError("The archive is not a Mercury operations workspace")
            if document.get("destination", {}).get("kind") == "sqlite":
                restored_path = manifest.get("sqlite_restore_path")
                if not isinstance(restored_path, str) or not (restored_path == "customer.sqlite3" or Path(restored_path).is_absolute()):
                    raise ValueError("The recovered SQLite destination has no explicit retained path")
                old_binding = connection.execute("SELECT value FROM metadata WHERE key='binding_sha256'").fetchone()[0]
                document["destination"]["path"] = restored_path
                binding = {"network": document["network"], "provider_scope": document["provider_scope"],
                    "provider_base": document["api_base"].rstrip("/"), "destination": document["destination"]}
                connection.execute("UPDATE metadata SET value=? WHERE key='binding_sha256'", (digest(binding),))
                connection.execute("INSERT OR REPLACE INTO metadata VALUES('restored_original_binding',?)", (old_binding,))
            connection.execute("INSERT OR REPLACE INTO metadata VALUES('restored_archive_sha256',?)", (_sha(archive),))
            connection.commit()
        document["workspace"] = "."
        (staging / "config.json").write_text(json.dumps(document, indent=2) + "\n")
        operation_db.rename(staging / "mercury_ops.sqlite3")
        (staging / "RESTORE.txt").write_text("Supply the original credential environment, then serve with config.json. Retained event IDs and delivery outcomes continue in this workspace.\n")
        os.chmod(staging / "RESTORE.txt", 0o600)
        for path in staging.iterdir():
            if path.is_file():
                with open(path, "rb") as stream:
                    os.fsync(stream.fileno())
        _new_directory(staging, destination)
        directory_fd = os.open(destination.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        return {"workspace": str(destination), "config_path": str(destination / "config.json"),
            "archive_sha256": _sha(archive), "local_customer_included": manifest["local_customer"],
            "credential_variables": [document.get(key) for key in ("provider_token_env", "webhook_secret_env", "operator_token_env")]}
    finally:
        if staging.exists():
            shutil.rmtree(staging)
