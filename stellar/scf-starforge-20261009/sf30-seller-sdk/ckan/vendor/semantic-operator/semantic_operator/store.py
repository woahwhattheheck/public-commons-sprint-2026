"""Application records, immutable source files and resumable local requests."""
from __future__ import annotations
import contextlib
import json
from pathlib import Path
import re
import secrets
import sqlite3
import threading
from datetime import datetime, timezone
from .security import atomic_write, canonical, digest, private_directory, private_read, read_json, MAX_FILE

def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def identifier(value, label="Identifier"):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}", value):
        raise ValueError(label + " must be a stable identifier without path characters.")
    return value

def standalone_database(data):
    """Use a standalone SQLite image without changing its pages or row data.

    SQLite's in-memory deserializer cannot open a WAL-mode image. Its documented
    workaround changes only the read/write format bytes to rollback mode:
    https://www.sqlite.org/c3ref/deserialize.html
    A backup() image already contains all committed pages and needs no WAL.
    """
    if (not isinstance(data, bytes) or len(data) < 100
            or data[:16] != b"SQLite format 3\x00"
            or data[18] not in (1, 2) or data[19] not in (1, 2)):
        raise ValueError("The retained application database is not a SQLite image.")
    return data[:18] + b"\x01\x01" + data[20:]


class ApplicationStore:
    def __init__(self, root):
        self.root = private_directory(root)
        self.blobs = private_directory(self.root / "sources")
        self.lock = threading.RLock()
        self.path = self.root / "application.sqlite3"
        if self.path.exists():
            private_read(self.path)
        self.db = sqlite3.connect(self.path, isolation_level=None, check_same_thread=False, timeout=15)
        self.path.chmod(0o600)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS documents(
          kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,
          sha256 TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
          PRIMARY KEY(kind,id));
        CREATE TABLE IF NOT EXISTS history(
          kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,
          sha256 TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,
          PRIMARY KEY(kind,id,revision));
        CREATE TABLE IF NOT EXISTS artifacts(
          id TEXT PRIMARY KEY,name TEXT NOT NULL,media_type TEXT NOT NULL,sha256 TEXT NOT NULL,
          bytes INTEGER NOT NULL,role TEXT NOT NULL,source_reference TEXT NOT NULL,
          backup INTEGER NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS operations(
          id TEXT PRIMARY KEY,kind TEXT NOT NULL,input_sha256 TEXT NOT NULL,actor TEXT NOT NULL,
          status TEXT NOT NULL,result TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        """)
        self.db.execute("INSERT OR IGNORE INTO metadata VALUES('workspace_id',?)", (secrets.token_hex(16),))
        self.db.execute("INSERT OR IGNORE INTO metadata VALUES('created_at',?)", (now(),))

    @contextlib.contextmanager
    def transaction(self):
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                yield
                self.db.execute("COMMIT")
            except BaseException:
                self.db.execute("ROLLBACK")
                raise

    @property
    def workspace_id(self):
        with self.lock:
            return self.db.execute("SELECT value FROM metadata WHERE key='workspace_id'").fetchone()[0]

    def document(self, kind, record_id):
        with self.lock:
            row = self.db.execute("SELECT * FROM documents WHERE kind=? AND id=?", (kind, record_id)).fetchone()
            if row is None:
                raise KeyError("The selected " + kind + " does not exist.")
            return {**dict(row), "payload": read_json(row["payload"])}

    def documents(self, kind):
        with self.lock:
            return [{**dict(row), "payload": read_json(row["payload"])}
                    for row in self.db.execute("SELECT * FROM documents WHERE kind=? ORDER BY updated_at DESC,id", (kind,))]

    def save(self, kind, record_id, payload, *, actor, expected_revision=None):
        identifier(kind, "Record kind")
        identifier(record_id)
        encoded = canonical(payload)
        if len(encoded) > 8 * 1024 * 1024:
            raise ValueError("This record exceeds 8 MiB.")
        fingerprint = digest(encoded)
        with self.transaction():
            row = self.db.execute("SELECT * FROM documents WHERE kind=? AND id=?", (kind, record_id)).fetchone()
            if expected_revision is not None and expected_revision != (row["revision"] if row else 0):
                raise ValueError("The selected record changed; retain the current revision before editing.")
            if row and row["sha256"] == fingerprint:
                return {**dict(row), "payload": read_json(row["payload"])}
            revision = row["revision"] + 1 if row else 1
            timestamp = now()
            created = row["created_at"] if row else timestamp
            self.db.execute("INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?,?,?)",
                            (kind, record_id, revision, encoded.decode(), fingerprint, created, timestamp))
            self.db.execute("INSERT INTO history VALUES(?,?,?,?,?,?,?)",
                            (kind, record_id, revision, encoded.decode(), fingerprint, actor, timestamp))
        return self.document(kind, record_id)

    def history(self, kind, record_id):
        with self.lock:
            return [{**dict(row), "payload": read_json(row["payload"])} for row in self.db.execute(
                "SELECT * FROM history WHERE kind=? AND id=? ORDER BY revision", (kind, record_id))]

    def add_artifact(self, data, *, name, media_type="application/octet-stream", role="source",
                     source_reference, include_in_backup=True):
        if not isinstance(data, bytes) or len(data) > MAX_FILE:
            raise ValueError("Choose a file of at most 64 MiB.")
        if not isinstance(name, str) or not name.strip() or len(name) > 240 or any(c in name for c in "\r\n\0/\\"):
            raise ValueError("Choose a filename without directory or control characters.")
        if (not isinstance(media_type, str) or len(media_type) > 200 or not re.fullmatch(
                r"[A-Za-z0-9.+_-]+/[A-Za-z0-9.+_-]+(?:; *charset=(?:utf-8|us-ascii))?",
                media_type, flags=re.IGNORECASE)):
            raise ValueError("Choose a valid media type with an optional UTF-8 or US-ASCII charset.")
        if not isinstance(source_reference, str) or not source_reference.strip() or len(source_reference)>8000:
            raise ValueError("Keep the original source reference with this file.")
        sha = digest(data)
        path = self.blobs / (sha + ".bin")
        if path.exists():
            if digest(private_read(path)) != sha:
                raise ValueError("The retained original source bytes no longer match their identity.")
        else:
            atomic_write(path, data, replace=False)
        key = "file-" + digest(canonical({"name":name, "sha256":sha, "role":role,
                                          "source_reference":source_reference, "backup":bool(include_in_backup)}))[:32]
        with self.lock:
            self.db.execute("INSERT OR IGNORE INTO artifacts VALUES(?,?,?,?,?,?,?,?,?)",
                            (key, name, media_type, sha, len(data), role, source_reference, int(include_in_backup), now()))
        return self.artifact(key)

    def artifact(self, artifact_id, *, with_bytes=False):
        with self.lock:
            row = self.db.execute("SELECT * FROM artifacts WHERE id=?", (artifact_id,)).fetchone()
            if row is None:
                raise KeyError("The original file is missing.")
            result = dict(row)
        if with_bytes:
            data = private_read(self.blobs / (result["sha256"] + ".bin"))
            if len(data) != result["bytes"] or digest(data) != result["sha256"]:
                raise ValueError("The original source bytes are incomplete or changed.")
            return result, data
        return result

    def artifacts(self):
        with self.lock:
            return [dict(row) for row in self.db.execute("SELECT * FROM artifacts ORDER BY created_at DESC,id")]

    def begin(self, operation_id, kind, inputs, actor):
        identifier(operation_id, "Operation ID")
        if len(operation_id) < 8 or not isinstance(actor, str) or not actor.strip() or len(actor) > 200:
            raise ValueError("Keep a stable operation ID and an identified local operator.")
        fingerprint = digest(canonical({"kind":kind, "inputs":inputs, "actor":actor}))
        with self.transaction():
            row = self.db.execute("SELECT * FROM operations WHERE id=?", (operation_id,)).fetchone()
            if row:
                if row["input_sha256"] != fingerprint:
                    raise ValueError("The original operation ID belongs to different inputs or an operator.")
                if row["status"] == "complete":
                    return read_json(row["result"])
                self.db.execute("UPDATE operations SET status='running',error=NULL,updated_at=? WHERE id=?", (now(), operation_id))
                return None
            timestamp = now()
            self.db.execute("INSERT INTO operations VALUES(?,?,?,?,?,NULL,NULL,?,?)",
                            (operation_id, kind, fingerprint, actor, "running", timestamp, timestamp))
        return None

    def finish(self, operation_id, result):
        with self.lock:
            self.db.execute("UPDATE operations SET status='complete',result=?,error=NULL,updated_at=? WHERE id=?",
                            (canonical(result).decode(), now(), operation_id))
        return result

    def interrupted(self, operation_id, error):
        with self.lock:
            self.db.execute("UPDATE operations SET status='interrupted',error=?,updated_at=? WHERE id=? AND status!='complete'",
                            (str(error)[:2000], now(), operation_id))

    def operation(self, operation_id):
        with self.lock:
            row = self.db.execute("SELECT * FROM operations WHERE id=?", (operation_id,)).fetchone()
            if row is None:
                raise KeyError("No original request has this operation ID.")
            return {**dict(row), "result":read_json(row["result"]) if row["result"] else None}

    def operations(self):
        with self.lock:
            rows = self.db.execute("SELECT * FROM operations ORDER BY updated_at DESC LIMIT 200").fetchall()
            return [{**dict(row), "result":read_json(row["result"]) if row["result"] else None} for row in rows]

    def snapshot(self):
        with self.lock:
            copy = sqlite3.connect(":memory:")
            try:
                self.db.backup(copy)
                # Recovery files do not recursively include earlier recovery exports.
                copy.execute("DELETE FROM artifacts WHERE backup=0")
                copy.commit()
                data = standalone_database(copy.serialize())
            finally:
                copy.close()
            files = {"application.sqlite3":data}
            for row in self.db.execute("SELECT DISTINCT sha256 FROM artifacts WHERE backup=1"):
                name = "sources/" + row["sha256"] + ".bin"
                body = private_read(self.root / name)
                if digest(body) != row["sha256"]:
                    raise ValueError("An original source changed before recovery export.")
                files[name] = body
            return files

    def close(self):
        with self.lock:
            try:
                self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            finally:
                # A full volume can reject checkpointing. Close the handle while
                # retaining SQLite's original journal for the next native reopen.
                self.db.close()
