#!/usr/bin/env python3
"""Rebase only original SF101 orders.file_path inside a newly restored receiver."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import sys
from urllib.parse import quote


def require(value, message):
    if not value:
        raise ValueError(message)


def private_path(value, directory=False):
    require(isinstance(value, str) and os.path.isabs(value) and value != "/" and
            os.path.normpath(value) == value and os.path.realpath(value) == value,
            "Restored path must be absolute and must not traverse a symlink")
    info = os.lstat(value)
    require((stat.S_ISDIR(info.st_mode) if directory else
             stat.S_ISREG(info.st_mode) and info.st_nlink == 1) and not info.st_mode & 0o077,
            "Restored state and files must remain private and regular")
    return Path(value)


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def scalar(value):
    # Preserve SQLite types as well as values; no token or row content is emitted.
    if value is None:
        return ["null"]
    if isinstance(value, bytes):
        return ["blob", value.hex()]
    if isinstance(value, int):
        return ["integer", str(value)]
    if isinstance(value, float):
        return ["real", value.hex()]
    return ["text", value]


def identity(db):
    digest = hashlib.sha256()
    counts = {}

    def add(row):
        digest.update(json.dumps([scalar(value) for value in row],
                                 ensure_ascii=True, separators=(",", ":")).encode() + b"\n")

    add([db.execute("PRAGMA application_id").fetchone()[0],
         db.execute("PRAGMA user_version").fetchone()[0]])
    schema = list(db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name"))
    for row in schema:
        add(row)
    for kind, name, _table, sql in schema:
        if kind != "table":
            continue
        columns = [row[1] for row in db.execute("PRAGMA table_info(" + identifier(name) + ")")]
        selected = [column for column in columns if name != "orders" or column != "file_path"]
        require(selected, "Original receiver table has no retained identity columns")
        fields = ",".join(identifier(column) for column in selected)
        # Original SF101 tables have rowids. Retain them as well as every public
        # column; WITHOUT ROWID extensions retain their declared primary keys.
        has_rowid = "WITHOUT ROWID" not in (sql or "").upper()
        prefix = "_rowid_," if has_rowid and "_rowid_" not in columns else ""
        order = "_rowid_" if prefix else fields
        add([name, *selected])
        count = 0
        for row in db.execute("SELECT " + prefix + fields + " FROM " + identifier(name) + " ORDER BY " + order):
            add(row)
            count += 1
        counts[name] = count
    return digest.hexdigest(), counts


def relocated(value, roots):
    require(isinstance(value, str) and os.path.isabs(value) and os.path.normpath(value) == value,
            "Order content path must be absolute and normalized")
    matched = [root for root in roots if value == root["from"] or
               root["kind"] == "directory" and value.startswith(root["from"] + "/")]
    require(len(matched) == 1, "An order file is outside the explicitly selected recovery roots")
    root = matched[0]
    return root["to"] if value == root["from"] else str(Path(root["to"]) / os.path.relpath(value, root["from"]))


def content(path, expected_sha, expected_size):
    private_path(path)
    require(isinstance(expected_size, int) and 0 < expected_size <= 32 * 1024 * 1024,
            "Original order file size is outside SF101 limits")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        require(before.st_size == expected_size, "Restored approved file size differs from its original order")
        digest = hashlib.sha256()
        size = 0
        with os.fdopen(os.dup(fd), "rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
                size += len(chunk)
        after = os.fstat(fd)
        require(size == expected_size and digest.hexdigest() == expected_sha and
                (before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                "Restored approved file bytes differ from their original order")
    finally:
        os.close(fd)


def run(value):
    os.umask(0o077)
    state = private_path(value["state"], directory=True)
    database = private_path(str(state / "merchant.sqlite3"))
    roots = value["mappings"]
    require(isinstance(roots, list) and roots, "Explicit original-to-restored root mappings required")
    db = sqlite3.connect("file:" + quote(str(database), safe="/") + "?mode=rw",
                         uri=True, timeout=5, isolation_level=None)
    try:
        db.execute("PRAGMA synchronous=FULL")
        db.execute("BEGIN IMMEDIATE")
        require(db.execute("PRAGMA quick_check").fetchone()[0] == "ok", "Restored receiver database is inconsistent")
        require(not list(db.execute("PRAGMA foreign_key_check")), "Restored receiver relationships are inconsistent")
        columns = {row[1] for row in db.execute("PRAGMA table_info(orders)")}
        require({"order_ref", "file_path", "file_sha256", "file_bytes"} <= columns,
                "Original SF101 orders table required; no schema migration is performed")
        before, counts = identity(db)
        changes = []
        files = set()
        for reference, old, digest, size in db.execute(
                "SELECT order_ref,file_path,file_sha256,file_bytes FROM orders ORDER BY order_ref"):
            new = relocated(old, roots)
            content(new, digest, size)
            changes.append((new, reference, old, digest, size))
            files.add((new, digest, size))
        for change in changes:
            cursor = db.execute("UPDATE orders SET file_path=? WHERE order_ref=? AND file_path=? "
                                "AND file_sha256=? AND file_bytes=?", change)
            require(cursor.rowcount == 1, "Original order changed during its restored path update")
        after, after_counts = identity(db)
        require(after == before and after_counts == counts,
                "Receiver identities or non-path data changed; restored transaction rolled back")
        for new, reference, _old, _digest, _size in changes:
            require(db.execute("SELECT file_path FROM orders WHERE order_ref=?", (reference,)).fetchone()[0] == new,
                    "Restored order path did not retain its selected mapping")
        db.execute("COMMIT")
        return {"status": "ORIGINAL_ORDER_PATHS_REBASED", "orders": len(changes),
                "verifiedFiles": len(files), "verifiedBytes": sum(size for _path, _digest, size in files),
                "identitySha256Before": before, "identitySha256After": after,
                "tableCounts": counts, "updatedColumns": ["orders.file_path"]}
    except Exception:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    try:
        print(json.dumps(run(json.load(sys.stdin))))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
