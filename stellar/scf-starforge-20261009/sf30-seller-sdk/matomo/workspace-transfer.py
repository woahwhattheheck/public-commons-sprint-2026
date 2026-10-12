#!/usr/bin/env python3
"""Matomo authoring-workspace custody over the maintained streaming archive.

No source request, seller launch, query execution, payment, or arbitrary SQL is
performed here. Node owns creation of the receiving workspace and its lease.
"""
from __future__ import annotations
import argparse
from contextlib import ExitStack, contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from source_bundle_archive import ArchiveFault, ArchivePolicy, archive, extract, inspect, file_hash, encoded

SCHEMA = "stellar-forge.matomo-authoring-workspace.v1"
POLICY = ArchivePolicy(SCHEMA, max_expanded_bytes=16 * 1024**3,
    max_file_bytes=8 * 1024**3, max_members=20000,
    receipt_name="received-workspace.json", prefix="MATOMO_WORKSPACE_ARCHIVE")
HASH = re.compile(r"^[a-f0-9]{64}$")
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$")
ROOTS = ("requests", "catalogs", "captures", "editions", "comparisons")
SOURCE_TABLES = {
    "requests": ("id", "owner", "kind", "input", "state", "attempts", "accepted_attempt", "created_at"),
    "attempts": ("request_id", "number", "state", "request", "result", "body_path", "created_at"),
    "catalogs": ("id", "scope", "state", "data", "created_at"),
    "captures": ("id", "selection", "state", "data", "created_at", "updated_at"),
    "capture_tables": ("capture_id", "id", "data"),
    "report_rows": ("capture_id", "id", "table_id", "row_index", "source_request", "source_index", "data_json", "metadata_json", "context"),
    "editions": ("id", "capture_id", "state", "data", "created_at"),
    "comparisons": ("id", "data", "created_at"),
    "edition_reviews": ("sequence", "edition_id", "data"),
    "comparison_reviews": ("sequence", "comparison_id", "finding_id", "data"),
}
COUNTS = tuple(SOURCE_TABLES) + ("actions", "history", "merchants", "merchant_packages", "deliveries", "handovers", "receivings")


def fail(code):
    raise ArchiveFault("MATOMO_PRODUCT_" + code)


def canonical(value, *, directory=False, create=False):
    path = Path(value)
    if not path.is_absolute() or path.resolve() != path:
        fail("CANONICAL_PATH_REQUIRED")
    if create:
        path.mkdir(mode=0o700, parents=False, exist_ok=True)
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or info.st_mode & 0o077:
        fail("PRIVATE_PATH_REQUIRED")
    if directory and not stat.S_ISDIR(info.st_mode) or not directory and (
            not stat.S_ISREG(info.st_mode) or info.st_nlink != 1):
        fail("PRIVATE_PATH_REQUIRED")
    return path


def read_json(path, limit=32 * 1024**2):
    path = canonical(str(path))
    if path.stat().st_size > limit:
        fail("JSON_LIMIT")
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                fail("JSON_DUPLICATE_KEY")
            value[key] = item
        return value
    with path.open("r", encoding="utf-8") as stream:
        return json.load(stream, object_pairs_hook=pairs,
            parse_constant=lambda _value: fail("JSON_NUMBER_INVALID"))


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def reconcile_link(target):
    stage = target.with_name(target.name + ".matomo-product-pending")
    try:
        left, right = target.lstat(), stage.lstat()
    except FileNotFoundError:
        return
    if (left.st_dev, left.st_ino) == (right.st_dev, right.st_ino):
        if not stat.S_ISREG(left.st_mode) or left.st_nlink != 2 or left.st_mode & 0o077:
            fail("RETAINED_STAGE_INVALID")
        stage.unlink()
        sync_directory(target.parent)


def publish(path, raw):
    """One immutable, replayable destination, inside the caller's held lease."""
    reconcile_link(path)
    if path.exists():
        if canonical(str(path)).read_bytes() != raw:
            fail("RETAINED_METADATA_CONFLICT")
        return
    stage = path.with_name(path.name + ".matomo-product-pending")
    if stage.exists():
        canonical(str(stage))
        if stage.read_bytes() != raw:
            stage.unlink()
    if not stage.exists():
        fd = os.open(stage, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            with os.fdopen(fd, "wb", closefd=False) as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
        finally:
            os.close(fd)
    try:
        os.link(stage, path, follow_symlinks=False)
    except FileExistsError:
        # A previous exclusive publication may have completed before interruption.
        if path.read_bytes() != raw:
            fail("RETAINED_METADATA_CONFLICT")
    stage.unlink()
    sync_directory(path.parent)


@contextmanager
def lock(path, *, create=False):
    flags = os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    if create:
        flags |= os.O_CREAT
    fd = os.open(path, flags, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077:
            fail("LEASE_INVALID")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail("WORKSPACE_OPEN")
        yield
    finally:
        os.close(fd)


def all_files(root):
    paths = []
    for directory, folders, names in os.walk(root, followlinks=False):
        current = Path(directory)
        canonical(str(current), directory=True)
        for folder in folders:
            canonical(str(current / folder), directory=True)
        for name in names:
            path = canonical(str(current / name))
            relative = path.relative_to(root).as_posix()
            if name.endswith(("-wal", "-shm", "-journal", ".matomo-pending", ".matomo-product-pending")):
                fail("RECOVERY_BEFORE_EXPORT_REQUIRED")
            if relative.split("/")[0].startswith(".source-archive-"):
                fail("ARCHIVE_ENGINE_FILES_AT_WORKSPACE_ROOT")
            paths.append(relative)
            if len(paths) > POLICY.max_members:
                fail("FILE_LIMIT")
    return sorted(paths)


def connect(path):
    canonical(str(path))
    connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    connection.execute("PRAGMA trusted_schema=OFF")
    connection.execute("PRAGMA query_only=ON")
    return connection


def snapshot(root):
    settings = read_json(root / "workspace.json", 65536)
    initialized = read_json(root / "initialized.json", 4096)
    if settings.get("schema") != "stellar-forge.matomo-workspace.v1" or (
            initialized.get("schema") != "stellar-forge.matomo-initialization.v1" or
            initialized.get("workspaceId") != settings.get("id") or
            initialized.get("sourceSha256") != settings.get("sourceSha256")):
        fail("WORKSPACE_IDENTITY_INVALID")
    with connect(root / "matomo.sqlite") as db:
        if db.execute("PRAGMA quick_check").fetchone() != ("ok",) or db.execute("PRAGMA foreign_key_check").fetchone():
            fail("DATABASE_INTEGRITY")
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table, columns in SOURCE_TABLES.items():
            if table not in tables:
                if table.endswith("_reviews"):
                    continue
                fail("SOURCE_TABLE_MISSING")
            actual = tuple(row[1] for row in db.execute('PRAGMA table_info("' + table + '")'))
            if actual != columns:
                fail("SOURCE_TABLE_SCHEMA_CHANGED")
        revision_row = db.execute("SELECT value FROM state WHERE name='revision'").fetchone()
        revision = int(revision_row[0]) if revision_row else -1
        if revision < 0 or revision > 9007199254740991:
            fail("REVISION_INVALID")
        counts = {table: db.execute('SELECT COUNT(*) FROM "' + table + '"').fetchone()[0]
                  for table in COUNTS if table in tables}
    return {
        "workspaceId": settings["id"], "sourceSha256": settings["sourceSha256"],
        "source": settings["source"], "revision": revision, "counts": counts,
        "workspace": file_hash(root / "workspace.json", POLICY),
        "database": file_hash(root / "matomo.sqlite", POLICY),
    }


def export_workspace(input):
    source = canonical(input["directory"], directory=True)
    destination = Path(input["archive"])
    parent = canonical(str(destination.parent), directory=True)
    if destination.resolve() != destination or destination.is_relative_to(source):
        fail("ARCHIVE_OUTSIDE_WORKSPACE_REQUIRED")
    operation = input["operationId"]
    if not isinstance(operation, str) or not ID.fullmatch(operation):
        fail("OPERATION_ID_INVALID")
    owned = ".matomo-product-export-" + hashlib.sha256(destination.name.encode()).hexdigest() + ".lock"
    with lock(parent / owned, create=True), ExitStack() as stack:
        stack.enter_context(lock(source / "publisher.lock"))
        paths = all_files(source)
        for name in paths:
            if name != "publisher.lock" and Path(name).name == "publisher.lock":
                stack.enter_context(lock(source / name))
        before = snapshot(source)
        inventory, total = [], 0
        for name in paths:
            pin = file_hash(source / name, POLICY)
            total += int(pin["bytes"])
            if total > POLICY.max_expanded_bytes:
                fail("WORKSPACE_BYTE_LIMIT")
            inventory.append({"path": name, **pin, "mode": stat.S_IMODE((source / name).stat().st_mode)})
        if paths != all_files(source) or before != snapshot(source):
            fail("SOURCE_CHANGED")
        metadata = parent / (destination.name + ".matomo-export.json")
        initial = {"schema": "stellar-forge.matomo-product-export.v1", "operationId": operation,
            "source": before, "inventorySha256": hashlib.sha256(encoded(inventory).encode()).hexdigest()}
        reconcile_link(metadata)
        if metadata.exists():
            retained = read_json(metadata)
            if {key: retained.get(key) for key in initial} != initial:
                fail("EXPORT_IDENTITY_CONFLICT")
            created_at = retained["createdAt"]
        else:
            created_at = datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")
            publish(metadata, (encoded({**initial, "createdAt": created_at}) + "\n").encode())
        manifest = {"schema": SCHEMA, "export": {"operationId": operation, "createdAt": created_at},
            "snapshot": before, "files": inventory,
            "receiving": {"mode": "independent-editable-source",
                "sourceTables": list(SOURCE_TABLES),
                "originalRecords": "All original files, merchant records and action history remain in the retained archive.",
                "merchantDrafts": "An operator may adopt a saved draft through the original local compiler.",
                "providerRequests": 0, "paymentInference": "NONE"}}
        result = archive({"source": str(source), "destination": str(destination),
                          "inventory": inventory, "manifest": manifest}, policy=POLICY)
        if paths != all_files(source) or before != snapshot(source):
            fail("SOURCE_CHANGED")
        return {"schema": "stellar-forge.matomo-product-export.v1", "operationId": operation,
            "archive": {"path": str(destination), **result["archive"]},
            "manifestSha256": hashlib.sha256((encoded(manifest) + "\n").encode()).hexdigest(),
            "snapshot": before, "members": result["members"], "reused": result.get("reused", False)}



def receiving_budget(value):
    manifest, pin = value["manifest"], value["archive"]
    files = manifest["files"]
    originals = sum(int(item["bytes"]) for item in files)
    working = [item for item in files if item["path"].split("/")[0] in ROOTS]
    copied = sum(int(item["bytes"]) for item in working)
    manifest_bytes = len((encoded(manifest) + "\n").encode("utf-8"))
    # Original ZIP + complete extracted origin + editable source copies remain
    # distinct custody. This is a lower bound: new SQLite and recovery metadata
    # and subsequent edits also count at the next complete export.
    minimum = int(pin["bytes"]) + originals + manifest_bytes + copied
    minimum_members = len(files) + len(working) + 3
    reasons = []
    if int(pin["bytes"]) > POLICY.max_file_bytes:
        reasons.append("retained-archive-exceeds-export-file-limit")
    if minimum > POLICY.max_expanded_bytes:
        reasons.append("minimum-complete-export-exceeds-expanded-limit")
    if minimum_members > POLICY.max_members:
        reasons.append("minimum-complete-export-exceeds-member-limit")
    return {
        "status": "ALREADY_EXCEEDS_EXPORT_POLICY" if reasons else "WITHIN_POLICY_BEFORE_NEW_METADATA",
        "archiveBytes": pin["bytes"], "originalFilesBytes": str(originals),
        "editableSourceCopyBytes": str(copied), "originalManifestBytes": str(manifest_bytes),
        "minimumReexportExpandedBytes": str(minimum),
        "remainingBeforeNewMetadataBytes": str(max(0, POLICY.max_expanded_bytes - minimum)),
        "minimumReexportMembers": minimum_members,
        "expandedLimitBytes": str(POLICY.max_expanded_bytes),
        "fileLimitBytes": str(POLICY.max_file_bytes), "memberLimit": POLICY.max_members,
        "reasons": reasons, "newMetadataAndLaterEditsIncluded": False,
    }


def inspect_archive(input):
    path = canonical(input["archive"])
    result = inspect({"archive": str(path)}, policy=POLICY)
    manifest = result["manifest"]
    snap = manifest.get("snapshot", {})
    if not HASH.fullmatch(snap.get("sourceSha256", "")) or not isinstance(snap.get("source"), dict):
        fail("SNAPSHOT_INVALID")
    for name, pin in (("workspace.json", snap.get("workspace")), ("matomo.sqlite", snap.get("database"))):
        match = next((item for item in manifest["files"] if item["path"] == name), None)
        if not isinstance(pin, dict) or match is None or any(match.get(key) != pin.get(key) for key in ("bytes", "sha256")):
            fail("SNAPSHOT_INVALID")
    return {**result, "manifestSha256": hashlib.sha256((encoded(manifest) + "\n").encode()).hexdigest(),
            "receivingBudget": receiving_budget(result)}


def copy_pinned(source, target, pin):
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    canonical(str(target.parent), directory=True)
    reconcile_link(target)
    if target.exists():
        if file_hash(target, POLICY, maximum=POLICY.max_archive_bytes) != {key: pin[key] for key in ("bytes", "sha256")}:
            fail("WORKING_FILE_CONFLICT")
        return
    stage = target.with_name(target.name + ".matomo-product-pending")
    if stage.exists():
        canonical(str(stage))
        if file_hash(stage, POLICY, maximum=POLICY.max_archive_bytes) == {key: pin[key] for key in ("bytes", "sha256")}:
            os.link(stage, target, follow_symlinks=False)
            stage.unlink()
            sync_directory(target.parent)
            return
        stage.unlink()
    fd = os.open(stage, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        digest, size = hashlib.sha256(), 0
        with canonical(str(source)).open("rb") as original, os.fdopen(fd, "wb", closefd=False) as output:
            for chunk in iter(lambda: original.read(1024**2), b""):
                size += len(chunk)
                if size > int(pin["bytes"]):
                    fail("SOURCE_CHANGED")
                digest.update(chunk)
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        if str(size) != pin["bytes"] or digest.hexdigest() != pin["sha256"]:
            fail("SOURCE_CHANGED")
        os.link(stage, target, follow_symlinks=False)
        stage.unlink()
        sync_directory(target.parent)
    finally:
        os.close(fd)


def receive_files(input):
    root = canonical(input["directory"], directory=True)
    value = inspect_archive(input)
    if value["archive"] != input["archivePin"]:
        fail("ARCHIVE_CHANGED")
    received = root / "received" / input["archivePin"]["sha256"]
    received.mkdir(mode=0o700, parents=True, exist_ok=True)
    canonical(str(received), directory=True)
    retained_archive = received / "source.zip"
    copy_pinned(Path(input["archive"]), retained_archive, input["archivePin"])
    original = received / "original"
    original.mkdir(mode=0o700, exist_ok=True)
    result = extract({"archive": str(retained_archive), "destination": str(original)}, policy=POLICY)
    for item in result["manifest"]["files"]:
        mode = item.get("mode", 0o600)
        if type(mode) is not int or mode & ~0o700 or not mode & 0o400:
            fail("SOURCE_MODE_INVALID")
        os.chmod(original / item["path"], mode)
    if snapshot(original) != result["manifest"]["snapshot"]:
        fail("SOURCE_SNAPSHOT_CHANGED")
    # Copy only source authoring material. Original host-bound commercial work
    # stays byte-exact in original/ and is inspected or adopted explicitly.
    for item in result["manifest"]["files"]:
        if item["path"].split("/")[0] in ROOTS:
            copy_pinned(original / item["path"], root / item["path"], item)
    return {"archive": value["archive"], "manifest": result["manifest"], "manifestSha256": value["manifestSha256"],
            "original": "received/" + value["archive"]["sha256"] + "/original"}


def populate(input):
    root = canonical(input["directory"], directory=True)
    original = canonical(str(root / input["original"]), directory=True)
    expected = input["snapshot"]
    if snapshot(original) != expected:
        fail("SOURCE_SNAPSHOT_CHANGED")
    source = connect(original / "matomo.sqlite")
    target_path = canonical(str(root / "matomo.sqlite"))
    target = sqlite3.connect(target_path)
    target.execute("PRAGMA trusted_schema=OFF")
    target.execute("PRAGMA foreign_keys=ON")
    target.execute("PRAGMA synchronous=FULL")
    marker = encoded({"archive": input["archivePin"], "workspaceId": expected["workspaceId"],
                      "sourceSha256": expected["sourceSha256"]})
    try:
        target.execute("BEGIN IMMEDIATE")
        target.execute("CREATE TABLE IF NOT EXISTS received_source_state(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
        old = target.execute("SELECT value FROM received_source_state WHERE key='import'").fetchone()
        if old:
            if old[0] != marker:
                fail("SOURCE_IMPORT_CONFLICT")
            target.rollback()
            return {"reused": True, "counts": expected["counts"]}
        for table in ("actions", "history", "merchants", "merchant_packages", "deliveries", "handovers", "receivings"):
            if target.execute('SELECT COUNT(*) FROM "' + table + '"').fetchone()[0]:
                fail("EMPTY_RECEIVING_WORKSPACE_REQUIRED")
        available = {row[0] for row in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table, columns in SOURCE_TABLES.items():
            if target.execute('SELECT COUNT(*) FROM "' + table + '"').fetchone()[0]:
                fail("EMPTY_RECEIVING_WORKSPACE_REQUIRED")
            if table not in available:
                continue
            actual = tuple(row[1] for row in target.execute('PRAGMA table_info("' + table + '")'))
            if actual != columns:
                fail("RECEIVER_SCHEMA_CHANGED")
            quoted = ",".join('"' + name + '"' for name in columns)
            writer = 'INSERT INTO "' + table + '"(' + quoted + ') VALUES(' + ",".join("?" for _ in columns) + ')'
            reader = source.execute('SELECT ' + quoted + ' FROM "' + table + '" ORDER BY rowid')
            while rows := reader.fetchmany(256):
                target.executemany(writer, rows)
        if target.execute("PRAGMA foreign_key_check").fetchone():
            fail("RECEIVER_FOREIGN_KEY")
        target.execute("INSERT INTO received_source_state(key,value) VALUES('import',?)", (marker,))
        target.commit()
        return {"reused": False, "counts": expected["counts"]}
    except BaseException:
        target.rollback()
        raise
    finally:
        source.close()
        target.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("export", "inspect", "receive-files", "populate"))
    command = parser.parse_args().command
    raw = sys.stdin.buffer.read(1024**2 + 1)
    if len(raw) > 1024**2:
        fail("INPUT_LIMIT")
    value = json.loads(raw)
    result = {"export": export_workspace, "inspect": inspect_archive,
              "receive-files": receive_files, "populate": populate}[command](value)
    sys.stdout.write(encoded(result) + "\n")


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        code = getattr(error, "code", "MATOMO_PRODUCT_NATIVE_FAILED")
        sys.stderr.write(json.dumps({"error": code}) + "\n")
        sys.exit(1)
