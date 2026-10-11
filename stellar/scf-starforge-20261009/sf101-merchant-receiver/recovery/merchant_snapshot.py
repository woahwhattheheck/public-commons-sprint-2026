"""Consistent recovery images for the original SF101 merchant and paid files.

SQLite's online backup retains orders, native events, access policy and additive
application tables. Every original paid file is captured by its authorized
digest, so restore can rebind paths after the old host disappears. Encryption
and transport use the existing sf101-merchant-recovery application.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
from datetime import datetime, timezone

_spec = importlib.util.spec_from_file_location(
    "_sf101_snapshot_receiver", Path(__file__).resolve().parents[1] / "receiver.py"
)
receiver = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(receiver)

SCHEMA = "stellar-forge.sf101.merchant-snapshot.v1"
CHUNK = 1024 * 1024


def _digest(path: Path) -> tuple[str, int]:
    value = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while chunk := stream.read(CHUNK):
            value.update(chunk)
            size += len(chunk)
    return value.hexdigest(), size


def _private_file(path: Path) -> None:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
        raise ValueError("Snapshot files must be real private regular files")


def _destination(raw: str | Path) -> Path:
    text = str(raw)
    target = Path(text)
    if not target.is_absolute() or os.path.normpath(text) != text or text == "/":
        raise ValueError("An absolute normalized new destination is required")
    for parent in target.parents:
        if parent.is_symlink():
            raise ValueError("Destination parents must not be symlinks")
    if not target.parent.is_dir():
        raise ValueError("Destination parent must already exist")
    target.mkdir(mode=0o700, exist_ok=False)
    return target


def _create_file(path: Path) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(fd)


def _write_json(path: Path, value: dict) -> None:
    data = (json.dumps(value, sort_keys=True, ensure_ascii=False,
                       allow_nan=False, indent=2) + "\n").encode("utf-8")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def _sync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _copy_verified(source: Path, destination: Path, expected_digest: str,
                   expected_bytes: int) -> None:
    with receiver.snapshot_private_file(str(source), directory=destination.parent) as content:
        if content.sha256 != expected_digest or content.size != expected_bytes:
            raise ValueError("Paid file no longer matches its original merchant order")
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as stream:
            while chunk := content.stream.read(CHUNK):
                stream.write(chunk)
            stream.flush()
            os.fsync(stream.fileno())


def create_snapshot(state: str | Path, destination: str | Path) -> dict:
    state = receiver.require_private_dir(str(state))
    target = _destination(destination)
    try:
        assets = target / "assets"
        assets.mkdir(mode=0o700)
        database = target / "merchant.sqlite3"
        _create_file(database)
        source = receiver.connect(state)
        output = sqlite3.connect(database)
        try:
            source.backup(output, pages=256)
            output.execute("PRAGMA journal_mode=DELETE")
            output.commit()
            output.row_factory = sqlite3.Row
            if output.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise ValueError("Original merchant database failed SQLite integrity check")
            orders = output.execute(
                "SELECT order_ref,file_path,file_sha256,file_bytes FROM orders ORDER BY order_ref"
            ).fetchall()
        finally:
            output.close()
            source.close()

        mapped = []
        for order in orders:
            digest, size = order["file_sha256"], order["file_bytes"]
            if (not receiver.is_match(receiver.ID_RE, digest) or
                    not isinstance(size, int) or isinstance(size, bool) or size < 1):
                raise ValueError("Original merchant order has an invalid paid-file identity")
            relative = "assets/" + digest + ".bin"
            asset = target / relative
            if not asset.exists():
                _copy_verified(Path(order["file_path"]), asset, digest, size)
            elif _digest(asset) != (digest, size):
                raise ValueError("Paid-file identities disagree inside the original merchant state")
            mapped.append({"orderRef": order["order_ref"], "path": relative,
                           "sha256": digest, "bytes": size})
        with database.open("rb") as stream:
            os.fsync(stream.fileno())
        db_digest, db_bytes = _digest(database)
        manifest = {
            "schema": SCHEMA, "createdAt": datetime.now(timezone.utc).isoformat(),
            "sourceStateDigest": hashlib.sha256(str(state).encode("utf-8")).hexdigest(),
            "database": {"path": "merchant.sqlite3", "sha256": db_digest, "bytes": db_bytes},
            "orders": mapped,
        }
        _write_json(target / "snapshot.json", manifest)
        _sync_directory(assets)
        _sync_directory(target)
        _sync_directory(target.parent)
        return {"schema": SCHEMA, "snapshot": str(target),
                "manifestSha256": _digest(target / "snapshot.json")[0],
                "databaseSha256": db_digest, "orders": len(mapped),
                "uniquePaidFiles": len({item["sha256"] for item in mapped})}
    except BaseException:
        # Remove only this invocation's exclusively created incomplete image.
        shutil.rmtree(target)
        raise


def inspect_snapshot(snapshot: str | Path) -> dict:
    source = receiver.require_private_dir(str(snapshot))
    manifest_path = source / "snapshot.json"
    _private_file(manifest_path)
    if manifest_path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError("Snapshot manifest is too large")
    manifest = json.loads(manifest_path.read_text("utf-8"))
    if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA:
        raise ValueError("Unknown merchant snapshot schema")
    database = manifest.get("database")
    if not isinstance(database, dict) or database.get("path") != "merchant.sqlite3":
        raise ValueError("Snapshot database identity is missing")
    db_path = source / "merchant.sqlite3"
    _private_file(db_path)
    if _digest(db_path) != (database.get("sha256"), database.get("bytes")):
        raise ValueError("Snapshot database bytes changed")
    orders = manifest.get("orders")
    if not isinstance(orders, list):
        raise ValueError("Snapshot order mapping is missing")
    assets = source / "assets"
    asset_info = assets.lstat()
    if not stat.S_ISDIR(asset_info.st_mode) or asset_info.st_mode & 0o077:
        raise ValueError("Snapshot assets must be a real private directory")
    seen = set()
    checked = {}
    for item in orders:
        if not isinstance(item, dict) or not receiver.is_match(receiver.REF_RE, item.get("orderRef")):
            raise ValueError("Invalid snapshot order reference")
        if item["orderRef"] in seen:
            raise ValueError("Duplicate snapshot order reference")
        seen.add(item["orderRef"])
        digest = item.get("sha256")
        if not receiver.is_match(receiver.ID_RE, digest) or item.get("path") != "assets/" + digest + ".bin":
            raise ValueError("Invalid snapshot paid-file mapping")
        size = item.get("bytes")
        if isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= receiver.MAX_FILE:
            raise ValueError("Invalid snapshot paid-file size")
        asset = source / item["path"]
        _private_file(asset)
        if digest not in checked:
            checked[digest] = _digest(asset)
        if checked[digest] != (digest, size):
            raise ValueError("Snapshot paid-file bytes changed")
    # No sidecar creation or implicit recovery against a completed image.
    connection = sqlite3.connect(db_path.as_uri() + "?mode=ro&immutable=1", uri=True)
    try:
        if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("Snapshot database failed SQLite integrity check")
        original = {
            row[0]: (row[1], row[2])
            for row in connection.execute("SELECT order_ref,file_sha256,file_bytes FROM orders")
        }
    finally:
        connection.close()
    supplied = {item["orderRef"]: (item["sha256"], item["bytes"]) for item in orders}
    if original != supplied:
        raise ValueError("Snapshot files do not close over every original paid order")
    return {"manifest": manifest, "manifestSha256": _digest(manifest_path)[0]}


def restore_snapshot(snapshot: str | Path, destination: str | Path) -> dict:
    inspected = inspect_snapshot(snapshot)
    source = Path(snapshot)
    manifest = inspected["manifest"]
    target = _destination(destination)
    try:
        assets = target / "paid-files"
        assets.mkdir(mode=0o700)
        for item in manifest["orders"]:
            installed = assets / (item["sha256"] + ".bin")
            if not installed.exists():
                _copy_verified(source / item["path"], installed, item["sha256"], item["bytes"])
        db_path = target / "merchant.sqlite3"
        _create_file(db_path)
        original = sqlite3.connect(
            (source / "merchant.sqlite3").as_uri() + "?mode=ro&immutable=1", uri=True
        )
        restored = sqlite3.connect(db_path, isolation_level=None)
        try:
            original.backup(restored, pages=256)
            restored.execute("PRAGMA synchronous=FULL")
            restored.execute("BEGIN IMMEDIATE")
            for item in manifest["orders"]:
                changed = restored.execute(
                    "UPDATE orders SET file_path=? WHERE order_ref=? AND file_sha256=? AND file_bytes=?",
                    (str(assets / (item["sha256"] + ".bin")), item["orderRef"],
                     item["sha256"], item["bytes"]),
                )
                if changed.rowcount != 1:
                    raise ValueError("Restored order no longer matches the snapshot")
            restored.execute("COMMIT")
            restored.execute("PRAGMA journal_mode=WAL")
        finally:
            restored.close()
            original.close()
        # Original events, policies and additive tables remain. Quota reservations
        # remain reserved rather than being implicitly cancelled during restore.
        receipt = {"schema": SCHEMA, "state": str(target),
                   "snapshotManifestSha256": inspected["manifestSha256"],
                   "orders": len(manifest["orders"]),
                   "restoredAt": datetime.now(timezone.utc).isoformat()}
        _write_json(target / "restoration.json", receipt)
        _sync_directory(assets)
        _sync_directory(target)
        _sync_directory(target.parent)
        return receipt
    except BaseException:
        shutil.rmtree(target)
        raise
