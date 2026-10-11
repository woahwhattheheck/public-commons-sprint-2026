#!/usr/bin/env python3
"""Private pipe adapter: original SF36 audit and SQLite's native online backup.

No reservation, consent, finality attestation, wallet or network operation lives here.
The snapshot process holds the original writer lock until its parent finishes the
file capture. Verification opens the retained database read-only.
"""
import base64
import json
import os
from pathlib import Path
import sqlite3
import stat
import sys
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "sf36-spend-governor"))
from governor import Governor, secret, validate_policy


def checkpoint(governor):
    result = governor.audit()
    last = governor.db.execute("SELECT sequence,mac FROM journal ORDER BY sequence DESC LIMIT 1").fetchone()
    states = dict(governor.db.execute("SELECT state,count(*) FROM reservations GROUP BY state"))
    return {"outcome": result["outcome"], "rows": result["rows"], "events": result["events"],
            "sequence": last[0] if last else 0, "journalMac": last[1] if last else "0" * 64,
            "reserved": states.get("reserved", 0), "settled": states.get("settled", 0)}


def identity(database):
    observed = os.stat(database, follow_symlinks=False)
    if not (stat.S_ISREG(observed.st_mode) and observed.st_nlink == 1
            and observed.st_uid == os.getuid() and observed.st_mode & 0o077 == 0):
        raise RuntimeError("original ledger must be an existing private file")
    return {"dev": observed.st_dev, "ino": observed.st_ino}


def existing_governor(database, policy, keys, *, readonly):
    # Reuse the original audit without its create-if-missing schema initializer.
    # An encrypted native SQLite snapshot is standalone: immutable verification
    # does not create sidecar files or follow an unretained WAL.
    original = Governor.__new__(Governor)
    original.limits = validate_policy(policy)
    original.ck, original.ak, original.ok = [secret(k, "recovery key") for k in keys]
    mode = "ro&immutable=1" if readonly else "rw"
    original.db = sqlite3.connect("file:" + quote(database) + "?mode=" + mode,
                                 uri=True, isolation_level=None, timeout=10)
    try:
        tables = {row[0] for row in original.db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        if not {"reservations", "journal"}.issubset(tables):
            raise RuntimeError("original ledger tables are missing")
        return original
    except Exception:
        original.close()
        raise


def run():
    os.umask(0o077)
    mode, database, policy_file = sys.argv[1:4]
    policy = json.loads(Path(policy_file).read_text())
    values = json.loads(sys.stdin.readline())
    keys = [base64.b64decode(values["keys"]["SF36_" + name + "_KEY_B64"], validate=True)
            for name in ("CONSENT", "AUDIT", "OPERATOR")]
    if mode == "snapshot":
        expected = values["identity"]
        if identity(database) != expected:
            raise RuntimeError("original ledger changed before open")
        original = existing_governor(database, policy, keys, readonly=False)
        try:
            original.db.execute("PRAGMA busy_timeout=10000")
            original.db.execute("BEGIN IMMEDIATE")
            if identity(database) != expected:
                raise RuntimeError("original ledger changed while opening")
            observed = checkpoint(original)
            destination = sys.argv[4]
            fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(fd)
            # A separate reader sees the same committed state while the writer
            # reservation excludes new commits. Never copy a live WAL piecemeal.
            reader = sqlite3.connect("file:" + quote(database) + "?mode=ro", uri=True)
            target = sqlite3.connect(destination)
            try:
                if identity(database) != expected:
                    raise RuntimeError("original ledger changed before snapshot")
                reader.backup(target)
            finally:
                target.close()
                reader.close()
            print(json.dumps({"status": "CAPTURE_LOCKED", "checkpoint": observed}), flush=True)
            if sys.stdin.readline().strip() != "release":
                raise RuntimeError("capture parent disconnected")
            if checkpoint(original) != observed or identity(database) != expected:
                raise RuntimeError("original ledger changed")
            original.db.execute("ROLLBACK")
        finally:
            original.close()
    elif mode == "verify":
        original = existing_governor(database, policy, keys, readonly=True)
        try:
            original.db.execute("BEGIN")
            if original.db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError("SQLite snapshot integrity failure")
            print(json.dumps({"status": "LEDGER_VERIFIED", "checkpoint": checkpoint(original)}), flush=True)
        finally:
            original.close()
    else:
        raise ValueError("unsupported recovery mode")


if __name__ == "__main__":
    try:
        run()
    except Exception:
        # Do not echo keys, private records, wallet paths or arbitrary exceptions.
        print(json.dumps({"status": "LEDGER_RECOVERY_FAILED"}), flush=True)
        sys.exit(1)
