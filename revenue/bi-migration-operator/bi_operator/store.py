"""Versioned local workspaces, content-addressed inputs, and durable operations."""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import tempfile
import threading
from datetime import datetime, timezone


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", value):
        raise ValueError("Use a nonempty identifier containing letters, numbers, underscores or hyphens.")
    return value


def atomic_write(path, data, mode=0o600):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=".write-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class Conflict(ValueError):
    pass


class Store:
    def __init__(self, root):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.blobs = self.root / "objects"
        self.blobs.mkdir(exist_ok=True, mode=0o700)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.root / "workspace.sqlite", timeout=20, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS blobs(
                digest TEXT PRIMARY KEY, size INTEGER NOT NULL, name TEXT NOT NULL,
                media_type TEXT NOT NULL, created TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS revisions(
                kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,
                payload TEXT NOT NULL,created TEXT NOT NULL,actor TEXT NOT NULL,
                PRIMARY KEY(kind,id,revision));
            CREATE TABLE IF NOT EXISTS heads(
                kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,
                PRIMARY KEY(kind,id));
            CREATE TABLE IF NOT EXISTS operations(
                id TEXT PRIMARY KEY,action TEXT NOT NULL,request_digest TEXT NOT NULL,
                state TEXT NOT NULL,result TEXT,error TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events(
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,created TEXT NOT NULL,
                action TEXT NOT NULL,entity TEXT NOT NULL,detail TEXT NOT NULL);
        """)
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO settings VALUES('workspace_id',?)", (secrets.token_hex(16),))
            self.db.execute("INSERT OR IGNORE INTO settings VALUES('access_token',?)", (secrets.token_urlsafe(32),))
        os.chmod(self.root / "workspace.sqlite", 0o600)

    def close(self):
        with self.lock:
            self.db.close()

    def setting(self, key):
        with self.lock:
            row = self.db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
            return row["value"] if row else None

    def event(self, action, entity, detail):
        self.db.execute("INSERT INTO events(created,action,entity,detail) VALUES(?,?,?,?)",
                        (now(), action, entity, encoded(detail)))

    def blob(self, data, name, media_type="application/octet-stream"):
        if len(data) > 64 * 1024 * 1024:
            raise ValueError("One input may contain at most 64 MiB.")
        sha = digest(data)
        path = self.blobs / sha
        with self.lock:
            if path.exists():
                if path.is_symlink() or digest(path.read_bytes()) != sha:
                    raise ValueError("An existing workspace object failed its digest check.")
            else:
                atomic_write(path, data)
            with self.db:
                self.db.execute("INSERT OR IGNORE INTO blobs VALUES(?,?,?,?,?)",
                                (sha, len(data), Path(name).name, media_type, now()))
        return {"digest": sha, "bytes": len(data), "name": Path(name).name, "media_type": media_type}

    def bytes(self, sha):
        if not re.fullmatch(r"[0-9a-f]{64}", str(sha)):
            raise ValueError("Invalid object digest.")
        path = self.blobs / sha
        if path.is_symlink():
            raise ValueError("Workspace objects cannot be symbolic links.")
        data = path.read_bytes()
        if digest(data) != sha:
            raise ValueError("Workspace object content has changed.")
        return data

    def get(self, kind, entity_id, revision=None):
        identifier(kind)
        identifier(entity_id)
        with self.lock:
            if revision is None:
                row = self.db.execute(
                    "SELECT r.* FROM revisions r JOIN heads h USING(kind,id,revision) WHERE kind=? AND id=?",
                    (kind, entity_id)).fetchone()
            else:
                row = self.db.execute("SELECT * FROM revisions WHERE kind=? AND id=? AND revision=?",
                                      (kind, entity_id, int(revision))).fetchone()
        if not row:
            raise KeyError(f"{kind}/{entity_id} revision {revision or 'current'} was not found.")
        return self._record(row)

    @staticmethod
    def _record(row):
        return {**{k: row[k] for k in ("kind", "id", "revision", "created", "actor")},
                "payload": json.loads(row["payload"])}

    def list(self, kind, limit=1000):
        identifier(kind)
        with self.lock:
            rows = self.db.execute(
                "SELECT r.* FROM revisions r JOIN heads h USING(kind,id,revision) WHERE kind=? ORDER BY r.created DESC,r.id LIMIT ?",
                (kind, min(int(limit), 10000))).fetchall()
        return [self._record(r) for r in rows]

    def history(self, kind, entity_id):
        identifier(kind)
        identifier(entity_id)
        with self.lock:
            return [self._record(r) for r in self.db.execute(
                "SELECT * FROM revisions WHERE kind=? AND id=? ORDER BY revision DESC",
                (kind, entity_id)).fetchall()]

    def put(self, kind, payload, entity_id=None, expected=0, actor="operator"):
        identifier(kind)
        entity_id = identifier(entity_id or secrets.token_hex(10))
        if not isinstance(payload, dict):
            raise ValueError("An entity payload must be an object.")
        value = encoded(payload)
        if len(value.encode()) > 24 * 1024 * 1024:
            raise ValueError("An entity is too large.")
        actor = str(actor).strip()[:180] or "operator"
        with self.lock, self.db:
            self.db.execute("BEGIN IMMEDIATE")
            row = self.db.execute("SELECT revision FROM heads WHERE kind=? AND id=?", (kind, entity_id)).fetchone()
            current = row["revision"] if row else 0
            if current != int(expected):
                raise Conflict(f"{kind}/{entity_id} is now revision {current}; reload before saving.")
            revision = current + 1
            self.db.execute("INSERT INTO revisions VALUES(?,?,?,?,?,?)",
                            (kind, entity_id, revision, value, now(), actor))
            self.db.execute("INSERT INTO heads VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision",
                            (kind, entity_id, revision))
            self.event("save", f"{kind}/{entity_id}/{revision}", {"previous_revision": current, "actor": actor})
        return self.get(kind, entity_id, revision)

    def begin_operation(self, operation_id, action, request):
        identifier(operation_id)
        request_hash = digest(encoded(request).encode())
        with self.lock, self.db:
            row = self.db.execute("SELECT * FROM operations WHERE id=?", (operation_id,)).fetchone()
            if row:
                if row["request_digest"] != request_hash or row["action"] != action:
                    raise Conflict("This operation ID already belongs to different inputs.")
                if row["state"] == "complete":
                    return json.loads(row["result"])
                saved = self.db.execute(
                    "SELECT * FROM revisions WHERE json_extract(payload,'$._operation_id')=? ORDER BY created DESC,revision DESC LIMIT 1",
                    (operation_id,)).fetchone()
                if saved:
                    result = self._record(saved)
                    self.db.execute("UPDATE operations SET state='complete',result=?,error=NULL,updated=? WHERE id=?",
                                    (encoded(result), now(), operation_id))
                    self.event("operation_recovered", operation_id, {"kind": result["kind"], "id": result["id"], "revision": result["revision"]})
                    return result
                raise Conflict(f"This operation is {row['state']}. Inspect it before starting another explicit operation.")
            self.db.execute("INSERT INTO operations VALUES(?,?,?,?,?,?,?,?)",
                            (operation_id, action, request_hash, "running", None, None, now(), now()))
            self.event("operation_started", operation_id, {"action": action, "request_digest": request_hash})
        return None

    def finish_operation(self, operation_id, result=None, error=None):
        with self.lock, self.db:
            state = "failed" if error else "complete"
            self.db.execute("UPDATE operations SET state=?,result=?,error=?,updated=? WHERE id=?",
                            (state, encoded(result) if result is not None else None, str(error)[:2000] if error else None, now(), operation_id))
            self.event("operation_" + state, operation_id, {"error": str(error)[:500] if error else None})

    def operations(self):
        with self.lock:
            return [dict(r) for r in self.db.execute(
                "SELECT id,action,state,error,created,updated FROM operations ORDER BY created DESC LIMIT 300")]

    def events(self):
        with self.lock:
            return [{**dict(r), "detail": json.loads(r["detail"])} for r in self.db.execute(
                "SELECT * FROM events ORDER BY sequence DESC LIMIT 500")]

    @contextlib.contextmanager
    def snapshot(self):
        with self.lock, tempfile.TemporaryDirectory(prefix="backup-", dir=self.root) as temp:
            path = Path(temp) / "workspace.sqlite"
            target = sqlite3.connect(path)
            try:
                self.db.backup(target)
                objects = [dict(r) for r in self.db.execute("SELECT digest,size,name,media_type FROM blobs")]
            finally:
                target.close()
            yield path, objects
