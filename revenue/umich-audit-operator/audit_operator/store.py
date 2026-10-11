"""Private versioned records, immutable sources and atomic operation replay."""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import stat
import tempfile
import threading
from datetime import datetime, timedelta, timezone

DOMAIN_KINDS = frozenset({
    "engagement", "audit_area", "sub_activity", "observation", "management_action",
    "evidence", "review_decision", "receiving_projection", "follow_up_review",
    "source_mapping", "risk", "workpaper", "advisory_memo", "questionnaire_response",
})
ROLES = frozenset({
    "auditor", "unit_leadership", "executive", "board_regents", "faic",
    "it_leadership", "medicine_it_leadership", "advisory",
})
MAX_SOURCE = 64 * 1024 * 1024
MAX_RECORD = 8 * 1024 * 1024

def now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")

def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)

def digest(value):
    return hashlib.sha256(value).hexdigest()

def fingerprint(value):
    return digest(encoded(value).encode("utf-8"))

def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,180}", value):
        raise ValueError("Invalid saved identifier.")
    return value

def safe_name(value):
    name = str(value).replace("\\", "/").rsplit("/", 1)[-1]
    if not name or name in {".", ".."} or any(ord(c) < 32 for c in name):
        raise ValueError("Use a nonempty file name without control characters.")
    return name[:240]

def private_directory(path):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("Workspace directories must be real directories.")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077:
        raise ValueError("Use a private workspace directory with mode 0700.")
    if hasattr(os, "getuid") and info.st_uid != os.getuid():
        raise ValueError("The current operator must own the workspace directory.")
    return path

def fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def atomic_write(path, data):
    path = Path(path)
    private_directory(path.parent)
    fd, temporary = tempfile.mkstemp(prefix=".write-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def private_bytes(path, maximum=MAX_SOURCE):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        before = os.fstat(descriptor)
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or
            before.st_mode & 0o077 or before.st_size > maximum or
            (hasattr(os, "getuid") and before.st_uid != os.getuid())):
            raise ValueError("Expected an owned, private regular file.")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            data = stream.read(maximum + 1)
        after = os.fstat(descriptor)
        if (len(data) != before.st_size or before.st_size != after.st_size or
            before.st_mtime_ns != after.st_mtime_ns or before.st_ctime_ns != after.st_ctime_ns):
            raise ValueError("The original file changed while it was read.")
        return data
    finally:
        os.close(descriptor)

class Conflict(ValueError):
    pass

class Forbidden(PermissionError):
    pass

def validate_record(record):
    if not isinstance(record, dict):
        raise ValueError("A record must be an object.")
    for key in ("kind", "id", "revision", "source", "payload", "created_at", "updated_at"):
        if key not in record:
            raise ValueError("A saved record is missing " + key + ".")
    identifier(record["kind"])
    identifier(record["id"])
    revision = record["revision"]
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        raise ValueError("A local record revision must be a positive integer.")
    source = record["source"]
    if not isinstance(source, dict) or not isinstance(record["payload"], dict):
        raise ValueError("Source identity and record payload must be objects.")
    for key, maximum in (("namespace", 256), ("id", 1024)):
        if not isinstance(source.get(key), str) or not source[key] or len(source[key]) > maximum:
            raise ValueError("Retain the source namespace and original ID.")
    for key in ("created_at", "updated_at"):
        if record[key] is not None:
            if not isinstance(record[key], str):
                raise ValueError("Record timestamps must be ISO dates or retained nulls.")
            datetime.fromisoformat(record[key].replace("Z", "+00:00"))
    if len(encoded(record).encode()) > MAX_RECORD:
        raise ValueError("One structured record may contain at most 8 MiB.")
    return record

class Store:
    def __init__(self, root):
        raw = Path(root).expanduser().absolute()
        if raw.is_symlink():
            raise ValueError("The workspace cannot be a symbolic link.")
        self.root = private_directory(raw)
        if self.root.resolve() != self.root:
            raise ValueError("Use the real workspace path.")
        self.objects = private_directory(self.root / "objects")
        self.lock = threading.RLock()
        dbpath = self.root / "workspace.sqlite"
        if dbpath.exists():
            fd = os.open(dbpath, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            try:
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077:
                    raise ValueError("The workspace database must be a private regular file.")
            finally:
                os.close(fd)
        else:
            atomic_write(dbpath, b"")
        self.db = sqlite3.connect(dbpath, timeout=30, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sources(
                id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS revisions(
                kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,
                sha256 TEXT NOT NULL,body TEXT NOT NULL,
                PRIMARY KEY(kind,id,revision));
            CREATE TABLE IF NOT EXISTS heads(
                kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,
                PRIMARY KEY(kind,id),
                FOREIGN KEY(kind,id,revision) REFERENCES revisions(kind,id,revision));
            CREATE TABLE IF NOT EXISTS operations(
                id TEXT PRIMARY KEY,action TEXT NOT NULL,request_sha256 TEXT NOT NULL,
                actor TEXT NOT NULL,state TEXT NOT NULL,result TEXT,error TEXT,
                created_at TEXT NOT NULL,completed_at TEXT);
            CREATE TABLE IF NOT EXISTS events(
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,created_at TEXT NOT NULL,
                actor TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,detail TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS grants(
                id TEXT PRIMARY KEY,token_sha256 TEXT UNIQUE NOT NULL,body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions(
                token_sha256 TEXT PRIMARY KEY,grant_id TEXT NOT NULL,expires_at TEXT NOT NULL,
                FOREIGN KEY(grant_id) REFERENCES grants(id));
        """)
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO settings VALUES('workspace_id',?)", (secrets.token_hex(16),))
            self.db.execute("INSERT OR IGNORE INTO settings VALUES('schema_version','1')")
        os.chmod(dbpath, 0o600)
        self._ensure_owner()

    def close(self):
        with self.lock:
            self.db.close()

    def setting(self, key):
        with self.lock:
            row = self.db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return row["value"] if row else None

    def _event(self, actor, action, entity, detail):
        self.db.execute("INSERT INTO events(created_at,actor,action,entity,detail) VALUES(?,?,?,?,?)",
                        (now(), str(actor)[:180], action, entity, encoded(detail)))

    def _ensure_owner(self):
        keypath = self.root / "operator.key"
        if keypath.exists():
            token = private_bytes(keypath, 256).decode().strip()
            if self.authenticate_token(token) is None:
                raise ValueError("The retained operator key does not match this workspace.")
            return
        with self.lock, self.db:
            token = secrets.token_urlsafe(36)
            body = {"id": "owner", "label": "Workspace operator", "role": "auditor",
                    "unit_ids": [], "selected_record_ids": [], "recipient_unit_ids": [],
                    "admin": True, "active": True, "created_at": now(), "expires_at": None}
            self.db.execute("DELETE FROM sessions")
            self.db.execute("DELETE FROM grants")
            self.db.execute("INSERT INTO grants VALUES(?,?,?)", ("owner", digest(token.encode()), encoded(body)))
            atomic_write(keypath, (token + "\n").encode())

    def owner_key(self):
        return private_bytes(self.root / "operator.key", 256).decode().strip()

    def authenticate_token(self, token):
        if not isinstance(token, str) or not 20 <= len(token) <= 160:
            return None
        with self.lock:
            row = self.db.execute("SELECT body FROM grants WHERE token_sha256=?", (digest(token.encode()),)).fetchone()
        body = json.loads(row["body"]) if row else None
        if not body or not body.get("active") or body.get("expires_at") and body["expires_at"] <= now():
            return None
        return body

    def open_session(self, token):
        with self.lock, self.db:
            grant = self.authenticate_token(token)
            if not grant:
                raise Forbidden("The private access link is invalid, expired or revoked.")
            value = secrets.token_urlsafe(36)
            expires = (datetime.now(timezone.utc) + timedelta(hours=8)).isoformat()
            if grant.get("expires_at"):
                expires = min(expires, grant["expires_at"])
            self.db.execute("INSERT INTO sessions VALUES(?,?,?)", (digest(value.encode()), grant["id"], expires))
            self.db.execute("DELETE FROM sessions WHERE expires_at<=?", (now(),))
            return value, grant

    def session(self, token):
        if not isinstance(token, str) or len(token) > 160:
            return None
        with self.lock:
            row = self.db.execute(
                "SELECT g.body,s.expires_at FROM sessions s JOIN grants g ON g.id=s.grant_id WHERE s.token_sha256=?",
                (digest(token.encode()),)).fetchone()
        if not row or row["expires_at"] <= now():
            return None
        body = json.loads(row["body"])
        if not body.get("active") or body.get("expires_at") and body["expires_at"] <= now():
            return None
        return body

    def end_session(self, token):
        with self.lock, self.db:
            self.db.execute("DELETE FROM sessions WHERE token_sha256=?", (digest(str(token).encode()),))

    def grants(self):
        with self.lock:
            return [json.loads(r["body"]) for r in self.db.execute("SELECT body FROM grants ORDER BY id")]

    def create_grant(self, request, actor):
        if not actor.get("admin"):
            raise Forbidden("Only the workspace owner can create access links.")
        role = request.get("role")
        if role not in ROLES:
            raise ValueError("Choose a supported reporting role.")
        units = request.get("unit_ids", [])
        recipients = request.get("recipient_unit_ids", [])
        selected = request.get("selected_record_ids", [])
        for values in (units, recipients, selected):
            if not isinstance(values, list) or len(values) > 1000 or any(not isinstance(x, str) or not x or len(x) > 180 for x in values):
                raise ValueError("Access scope must be an explicit list of identifiers.")
        if role in {"unit_leadership", "it_leadership", "medicine_it_leadership"} and not units:
            raise ValueError("Choose the units this access link may read.")
        if role == "advisory" and (not recipients or not selected or not set(recipients).issubset(units)):
            raise ValueError("An advisory link requires its own recipient units and selected records.")
        expires_days = request.get("expires_days", 30)
        if isinstance(expires_days, bool) or not isinstance(expires_days, int) or not 1 <= expires_days <= 366:
            raise ValueError("Access links expire after 1 to 366 days.")
        token = secrets.token_urlsafe(36)
        value = {"id": "grant-" + secrets.token_hex(12), "label": str(request.get("label", "")).strip()[:120],
                 "role": role, "unit_ids": sorted(set(units)), "recipient_unit_ids": sorted(set(recipients)),
                 "selected_record_ids": sorted(set(selected)), "admin": False, "active": True,
                 "created_at": now(), "expires_at": (datetime.now(timezone.utc) + timedelta(days=expires_days)).isoformat()}
        if not value["label"]:
            raise ValueError("Name the person or receiving team for this access link.")
        with self.lock, self.db:
            self.db.execute("INSERT INTO grants VALUES(?,?,?)", (value["id"], digest(token.encode()), encoded(value)))
            self._event(actor["id"], "access_created", value["id"], {k: value[k] for k in ("label", "role", "unit_ids", "expires_at")})
        return {"grant": value, "token": token}

    def revoke_grant(self, grant_id, actor):
        if not actor.get("admin") or grant_id == "owner":
            raise Forbidden("Only the owner can revoke another access link.")
        with self.lock, self.db:
            row = self.db.execute("SELECT body FROM grants WHERE id=?", (identifier(grant_id),)).fetchone()
            if not row:
                raise KeyError("The access link was not found.")
            body = json.loads(row["body"])
            body["active"] = False
            body["revoked_at"] = now()
            self.db.execute("UPDATE grants SET body=? WHERE id=?", (encoded(body), grant_id))
            self.db.execute("DELETE FROM sessions WHERE grant_id=?", (grant_id,))
            self._event(actor["id"], "access_revoked", grant_id, {})
        return body

    def bytes(self, sha256):
        if not re.fullmatch(r"[a-f0-9]{64}", str(sha256)):
            raise ValueError("Invalid source hash.")
        data = private_bytes(self.objects / sha256)
        if digest(data) != sha256:
            raise ValueError("The retained source failed its original hash check.")
        return data

    def _blob(self, data):
        if not isinstance(data, bytes) or len(data) > MAX_SOURCE:
            raise ValueError("One original source or export may contain at most 64 MiB.")
        sha256 = digest(data)
        path = self.objects / sha256
        if path.exists():
            if self.bytes(sha256) != data:
                raise ValueError("Retained source bytes changed.")
        else:
            atomic_write(path, data)
        return sha256

    def _source(self, data, name, media_type, role, namespace="", locator=None):
        if not self.db.in_transaction:
            raise RuntimeError("Source adoption requires an atomic operation.")
        sha256 = self._blob(data)
        source_id = "source-" + fingerprint({"sha256": sha256, "name": safe_name(name), "role": role, "namespace": namespace})[:32]
        row = self.db.execute("SELECT body FROM sources WHERE id=?", (source_id,)).fetchone()
        if row:
            return json.loads(row["body"])
        body = {"id": source_id, "name": safe_name(name), "sha256": sha256, "bytes": len(data),
                "media_type": str(media_type)[:180], "role": str(role)[:100], "namespace": str(namespace)[:256],
                "locator": locator, "created_at": now()}
        self.db.execute("INSERT INTO sources VALUES(?,?,?)", (source_id, sha256, encoded(body)))
        return body

    def source(self, source_id):
        with self.lock:
            row = self.db.execute("SELECT body FROM sources WHERE id=?", (identifier(source_id),)).fetchone()
        if not row:
            raise KeyError("The original source was not found.")
        return json.loads(row["body"])

    def sources(self):
        with self.lock:
            return [json.loads(r["body"]) for r in self.db.execute("SELECT body FROM sources ORDER BY id")]

    def get(self, kind, record_id, revision=None):
        identifier(kind)
        identifier(record_id)
        with self.lock:
            if revision is None:
                row = self.db.execute("SELECT r.body FROM revisions r JOIN heads h USING(kind,id,revision) WHERE kind=? AND id=?",
                                      (kind, record_id)).fetchone()
            else:
                row = self.db.execute("SELECT body FROM revisions WHERE kind=? AND id=? AND revision=?",
                                      (kind, record_id, int(revision))).fetchone()
        if not row:
            raise KeyError(kind + "/" + record_id + " was not found.")
        return json.loads(row["body"])

    def records(self, kind=None):
        sql = "SELECT r.body FROM revisions r JOIN heads h USING(kind,id,revision)"
        args = ()
        if kind is not None:
            sql += " WHERE kind=?"
            args = (identifier(kind),)
        with self.lock:
            return [json.loads(r["body"]) for r in self.db.execute(sql + " ORDER BY kind,id", args)]

    def history(self, kind, record_id):
        with self.lock:
            return [json.loads(r["body"]) for r in self.db.execute(
                "SELECT body FROM revisions WHERE kind=? AND id=? ORDER BY revision DESC", (identifier(kind), identifier(record_id)))]

    def _insert_record(self, record, expected, actor, preserve_revision=False):
        if not self.db.in_transaction:
            raise RuntimeError("Record adoption requires an atomic operation.")
        validate_record(record)
        row = self.db.execute("SELECT revision FROM heads WHERE kind=? AND id=?", (record["kind"], record["id"])).fetchone()
        current = row["revision"] if row else 0
        if current != expected:
            raise Conflict("This record is now revision " + str(current) + "; reopen it before saving.")
        if not preserve_revision and record["revision"] != current + 1:
            raise Conflict("The next local revision must follow the retained current revision.")
        if preserve_revision and record["revision"] <= current:
            raise Conflict("Receiving cannot overwrite an existing local revision.")
        value = encoded(record)
        self.db.execute("INSERT INTO revisions VALUES(?,?,?,?,?)",
                        (record["kind"], record["id"], record["revision"], digest(value.encode()), value))
        self.db.execute("INSERT INTO heads VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision",
                        (record["kind"], record["id"], record["revision"]))
        self._event(actor, "record_saved", record["id"], {"kind": record["kind"], "revision": record["revision"],
                                                       "previous_revision": current, "sha256": digest(value.encode())})
        return record

    def execute(self, operation_id, action, request, actor, work):
        identifier(operation_id)
        request_hash = fingerprint(request)
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                row = self.db.execute("SELECT * FROM operations WHERE id=?", (operation_id,)).fetchone()
                if row:
                    if row["action"] != action or row["request_sha256"] != request_hash or row["actor"] != actor:
                        raise Conflict("This operation ID belongs to another action, actor or input.")
                    if row["state"] == "complete":
                        self.db.rollback()
                        return {**json.loads(row["result"]), "replayed": True}
                    raise Conflict("The original operation failed: " + str(row["error"]))
                started = now()
                result = work()
                if not isinstance(result, dict):
                    raise TypeError("An operation must return a structured result.")
                result = {**result, "operation_id": operation_id}
                self.db.execute("INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,?)",
                    (operation_id, action, request_hash, actor, "complete", encoded(result), None, started, now()))
                self._event(actor, action, operation_id, {"request_sha256": request_hash})
                self.db.commit()
                return result
            except BaseException:
                self.db.rollback()
                raise

    def snapshot(self, include_history=False):
        with self.lock:
            result = {"format": "commons-audit-snapshot/1", "workspace_id": self.setting("workspace_id"),
                      "records": [r for r in self.records() if r["kind"] in DOMAIN_KINDS],
                      "sources": self.sources(), "captured_at": now()}
            if include_history:
                result["revisions"] = [json.loads(r["body"]) for r in self.db.execute(
                    "SELECT body FROM revisions ORDER BY kind,id,revision") if json.loads(r["body"])["kind"] in DOMAIN_KINDS]
        return result

    def selection_hash(self):
        with self.lock:
            return fingerprint([{"kind": r["kind"], "id": r["id"], "revision": r["revision"], "sha256": r["sha256"]}
                                for r in self.db.execute("SELECT r.* FROM revisions r JOIN heads h USING(kind,id,revision) ORDER BY kind,id")])

    def operations(self, before=None, limit=100):
        limit = max(1, min(int(limit), 1000))
        with self.lock:
            rows = self.db.execute("SELECT * FROM operations WHERE (? IS NULL OR created_at<?) ORDER BY created_at DESC LIMIT ?",
                                   (before, before, limit)).fetchall()
        return [{k: r[k] for k in ("id", "action", "actor", "state", "error", "created_at", "completed_at")} for r in rows]

    def events(self, before=None, limit=200):
        limit = max(1, min(int(limit), 2000))
        with self.lock:
            rows = self.db.execute("SELECT * FROM events WHERE (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?",
                                   (before, before, limit)).fetchall()
        return [{**dict(r), "detail": json.loads(r["detail"])} for r in rows]

    @contextlib.contextmanager
    def backup_snapshot(self):
        with self.lock, tempfile.TemporaryDirectory(prefix=".backup-", dir=self.root) as folder:
            path = Path(folder) / "workspace.sqlite"
            target = sqlite3.connect(path)
            target.row_factory = sqlite3.Row
            try:
                self.db.backup(target)
                sources = [json.loads(r["body"]) for r in target.execute("SELECT body FROM sources")]
                # Internal artifacts also use the same source table. No credential file is copied.
                target.close()
                os.chmod(path, 0o600)
                yield path, sources
            finally:
                with contextlib.suppress(Exception):
                    target.close()
