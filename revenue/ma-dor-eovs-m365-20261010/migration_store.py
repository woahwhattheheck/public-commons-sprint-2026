"""Original SQLite store for the retained migration workbench (standard library only)."""
from __future__ import annotations

import contextlib
import fcntl
import hashlib
import functools
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import threading
from datetime import datetime, timezone
from uuid import uuid4

SCHEMA = "ma-dor.migration-workspace/v1"
SHA = re.compile(r"^[0-9a-f]{64}$")
FLAT = re.compile(r"^[A-Za-z0-9_-]{1,120}$")
MAX_PAGE = 500

class MigrationError(ValueError):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code, self.details = code, details or {}
    def as_dict(self):
        return {"code": self.code, "message": str(self), "details": self.details}

def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)

def identity(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()

def parse_json(text):
    try:
        return json.loads(text, parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
    except (ValueError, TypeError) as exc:
        raise MigrationError("INVALID_JSON", "Invalid JSON", {"error": str(exc)}) from exc

def text(value, name, *, optional=False, max_length=8192):
    if optional and value is None:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > max_length or any(ord(c) < 32 and c not in "\t\n\r" for c in value):
        raise MigrationError("INVALID_FIELD", f"{name} must be a nonempty string", {"field": name})
    return value

def identifier(value, name="id"):
    if not isinstance(value, str) or not FLAT.fullmatch(value):
        raise MigrationError("INVALID_ID", f"{name} must be a flat alphanumeric, underscore or hyphen identifier", {"field": name})
    return value

def digest(value):
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise MigrationError("INVALID_SHA256", "Expected a lowercase SHA256")
    return value

def integer(value, name, *, minimum=0, maximum=None):
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum or (maximum is not None and value > maximum):
        raise MigrationError("INVALID_INTEGER", f"Invalid {name}", {"field": name})
    return value

def page(payload):
    return integer(payload.get("offset", 0), "offset"), integer(payload.get("limit", 100), "limit", minimum=1, maximum=MAX_PAGE)

def basename(value):
    if not isinstance(value, str) or not value or value in (".", "..") or "/" in value or "\\" in value or "\x00" in value or len(value) > 240 or any(ord(c) < 32 for c in value):
        raise MigrationError("INVALID_FILENAME", "Use an ordinary file basename")
    return value

def regular(path):
    info = os.lstat(path)
    if not stat.S_ISREG(info.st_mode):
        raise MigrationError("NOT_REGULAR_FILE", "Expected a regular file", {"path": str(path)})
    return info

def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def file_hash(path_or_file):
    close = not hasattr(path_or_file, "read")
    handle = open(path_or_file, "rb") if close else path_or_file
    sha, count = hashlib.sha256(), 0
    try:
        if not close:
            handle.seek(0)
        while True:
            part = handle.read(1024 * 1024)
            if not part:
                break
            sha.update(part)
            count += len(part)
        return {"sha256": sha.hexdigest(), "bytes": count}
    finally:
        if close:
            handle.close()
        else:
            handle.seek(0)

def synchronized(fn):
    @functools.wraps(fn)
    def wrapped(self, *args, **kwargs):
        with self._mutex:
            return fn(self, *args, **kwargs)
    return wrapped

DDL = """
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS files(
 sha256 TEXT PRIMARY KEY,bytes INTEGER NOT NULL,relative_path TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operations(
 id TEXT PRIMARY KEY,operation TEXT NOT NULL,request_sha256 TEXT NOT NULL,request_json TEXT NOT NULL,
 actor TEXT NOT NULL,status TEXT NOT NULL,reserved_revision INTEGER NOT NULL,created_at TEXT NOT NULL,
 finished_at TEXT,result_json TEXT,error_json TEXT,checkpoint_json TEXT);
CREATE TABLE IF NOT EXISTS events(
 revision INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,operation_id TEXT,
 actor TEXT NOT NULL,type TEXT NOT NULL,payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS entities(
 kind TEXT NOT NULL,id TEXT NOT NULL,created_revision INTEGER NOT NULL,body_json TEXT NOT NULL,PRIMARY KEY(kind,id));
CREATE TABLE IF NOT EXISTS sources(
 id TEXT PRIMARY KEY,file_sha256 TEXT NOT NULL REFERENCES files(sha256),filename TEXT NOT NULL,format TEXT NOT NULL,
 context_json TEXT NOT NULL,columns_json TEXT NOT NULL,normalizer_version TEXT NOT NULL,status TEXT NOT NULL,
 created_revision INTEGER NOT NULL,created_at TEXT NOT NULL,row_count INTEGER NOT NULL DEFAULT 0,
 issue_count INTEGER NOT NULL DEFAULT 0,summary_json TEXT NOT NULL DEFAULT '{}',error_json TEXT);
CREATE TABLE IF NOT EXISTS rows(
 id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES sources(id),ordinal INTEGER NOT NULL,
 role TEXT NOT NULL,namespace TEXT NOT NULL,source_key TEXT,target_key TEXT,task_id TEXT,round_label TEXT,job_id TEXT,
 raw_json TEXT NOT NULL,values_json TEXT NOT NULL,presence_json TEXT NOT NULL,issues_json TEXT NOT NULL,locator_json TEXT NOT NULL,
 UNIQUE(source_id,ordinal));
CREATE INDEX IF NOT EXISTS rows_source_order ON rows(source_id,ordinal);
CREATE INDEX IF NOT EXISTS rows_identity ON rows(namespace,source_key);
CREATE INDEX IF NOT EXISTS rows_target ON rows(namespace,target_key);
CREATE INDEX IF NOT EXISTS rows_round ON rows(source_id,task_id,round_label,job_id);
CREATE TABLE IF NOT EXISTS mapping_entries(
 id TEXT PRIMARY KEY,mapping_id TEXT NOT NULL,ordinal INTEGER NOT NULL,kind TEXT NOT NULL,
 body_json TEXT NOT NULL,source_row_id TEXT,target_row_id TEXT,source_principal TEXT,target_principal TEXT,raw_status TEXT,
 UNIQUE(mapping_id,ordinal));
CREATE INDEX IF NOT EXISTS mapping_source ON mapping_entries(mapping_id,source_row_id);
CREATE INDEX IF NOT EXISTS mapping_principal ON mapping_entries(mapping_id,source_principal);
CREATE INDEX IF NOT EXISTS mapping_status ON mapping_entries(mapping_id,raw_status);
CREATE TABLE IF NOT EXISTS round_members(
 round_id TEXT NOT NULL,row_id TEXT NOT NULL REFERENCES rows(id),PRIMARY KEY(round_id,row_id));
CREATE INDEX IF NOT EXISTS round_members_row ON round_members(round_id,row_id);
CREATE INDEX IF NOT EXISTS mapping_target ON mapping_entries(mapping_id,target_row_id);
CREATE TABLE IF NOT EXISTS reconciliation_members(
 reconciliation_id TEXT NOT NULL,side TEXT NOT NULL,row_id TEXT NOT NULL REFERENCES rows(id),
 PRIMARY KEY(reconciliation_id,side,row_id));
CREATE INDEX IF NOT EXISTS members_side ON reconciliation_members(reconciliation_id,side,row_id);
CREATE TABLE IF NOT EXISTS correction_updates(
 id TEXT PRIMARY KEY,correction_id TEXT NOT NULL,revision INTEGER NOT NULL,body_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS correction_current ON correction_updates(correction_id,revision,id);
CREATE TABLE IF NOT EXISTS reconciliation_items(
 id TEXT PRIMARY KEY,reconciliation_id TEXT NOT NULL,expected_row_id TEXT,observed_row_id TEXT,
 identity_key TEXT,status TEXT NOT NULL,body_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS items_page ON reconciliation_items(reconciliation_id,id);
CREATE INDEX IF NOT EXISTS items_expected ON reconciliation_items(reconciliation_id,expected_row_id);
CREATE INDEX IF NOT EXISTS items_observed ON reconciliation_items(reconciliation_id,observed_row_id);
CREATE INDEX IF NOT EXISTS items_status ON reconciliation_items(reconciliation_id,status);
"""

def describe_backup(path):
    """Read identity and original object inventory from one completed SQLite snapshot."""
    path = Path(path).absolute()
    for p in [*reversed(path.parent.parents), path.parent]:
        if p.exists() and p.is_symlink():
            raise MigrationError("SYMLINK", "Snapshot path must be ordinary")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as held:
        st = os.fstat(held.fileno())
        if not stat.S_ISREG(st.st_mode):
            raise MigrationError("SNAPSHOT_TYPE", "Snapshot must be a regular file")
        actual = file_hash(held)
        # /proc opens the exact held inode, so replacement of the pathname cannot mix identities.
        db = sqlite3.connect(f"file:/proc/self/fd/{held.fileno()}?mode=ro&immutable=1", uri=True, isolation_level=None)
        try:
            if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise MigrationError("SNAPSHOT_INTEGRITY", "Original SQLite snapshot is incomplete or invalid")
            row = db.execute("SELECT value_json FROM meta WHERE key='project'").fetchone()
            project = parse_json(row[0]) if row else {}
            if project.get("schema") != SCHEMA:
                raise MigrationError("SNAPSHOT_SCHEMA", "Snapshot is not this original operating workspace")
            files = []
            for sha, size, relative in db.execute("SELECT sha256,bytes,relative_path FROM files ORDER BY sha256"):
                digest(sha)
                integer(size, "file.bytes")
                if relative != f"objects/{sha[:2]}/{sha}":
                    raise MigrationError("SNAPSHOT_OBJECT", "Original snapshot has a noncanonical object path")
                files.append({"sha256":sha,"bytes":size,"relative_path":relative})
            deliveries = [parse_json(row[0]) for row in db.execute("SELECT body_json FROM entities WHERE kind='delivery' ORDER BY id")]
            return {"path":str(path),**actual,"workspace_id":project["id"],"revision":project["revision"],"files":files,"deliveries":deliveries}
        except sqlite3.DatabaseError as exc:
            raise MigrationError("SNAPSHOT_INTEGRITY", "Original SQLite snapshot cannot be read", {"error":str(exc)}) from exc
        finally:
            db.close()

class Store:
    def __init__(self, directory, *, create=False, title="Migration workbench"):
        self.root = Path(directory).absolute()
        self._mutex = threading.RLock()
        self._lock_fd = None
        self.conn = None
        self._closed = False
        # Reject existing symlink components, including a symlinked workspace ancestor.
        for ancestor in [*reversed(self.root.parents), self.root]:
            if ancestor.exists() and ancestor.is_symlink():
                raise MigrationError("SYMLINK", "Workspace paths must be ordinary directories")
        existed = self.root.exists()
        if not existed:
            if not create:
                raise MigrationError("WORKSPACE_NOT_FOUND", "Workspace does not exist")
            self.root.mkdir(parents=True, mode=0o700)
        if not self.root.is_dir():
            raise MigrationError("WORKSPACE_NOT_DIRECTORY", "Workspace is not a directory")
        database = self.root / "workspace.sqlite3"
        if database.is_symlink():
            raise MigrationError("SYMLINK", "Original SQLite database must not be a symlink")
        if create and database.exists():
            raise MigrationError("WORKSPACE_EXISTS", "Use create=False to reopen the existing workspace")
        if not create and not database.exists():
            raise MigrationError("WORKSPACE_NOT_FOUND", "The original workspace database is absent")
        try:
            lock_path = self.root / "owner.lock"
            self._lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
            try:
                if not stat.S_ISREG(os.fstat(self._lock_fd).st_mode):
                    raise MigrationError("WORKSPACE_LOCK", "Owner lock must be a regular file")
                fcntl.flock(self._lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise MigrationError("WORKSPACE_BUSY", "The original workspace already has an active owner") from exc
            for leaf in ("objects", "staging"):
                p = self.root / leaf
                if p.is_symlink():
                    raise MigrationError("SYMLINK", "Workspace members must not be symlinks")
                p.mkdir(mode=0o700, exist_ok=True)
            if database.exists():
                regular(database)
            self.conn = sqlite3.connect(database, timeout=10, isolation_level=None, check_same_thread=False)
            self.conn.row_factory = sqlite3.Row
            self.conn.execute("PRAGMA foreign_keys=ON")
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.execute("PRAGMA synchronous=FULL")
            self.conn.execute("PRAGMA busy_timeout=10000")
            os.chmod(database, 0o600)
            if create:
                self.conn.executescript(DDL)
                with self.transaction():
                    project = {"schema": SCHEMA, "id": "workspace-" + uuid4().hex, "title": text(title, "title"), "revision": 0, "created_at": now()}
                    self.conn.execute("INSERT INTO meta VALUES('project',?)", (canonical(project),))
            else:
                project = self.project
                if project.get("schema") != SCHEMA:
                    raise MigrationError("WORKSPACE_SCHEMA", "Unsupported original workspace schema")
                required = {r[0] for r in self.conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                if not {"meta","files","sources","rows","operations","events","mapping_entries","round_members",
                        "reconciliation_members","reconciliation_items","correction_updates","entities"} <= required:
                    raise MigrationError("WORKSPACE_SCHEMA", "Incomplete original workspace schema")
        except BaseException:
            self.close()
            raise

    def __enter__(self):
        return self
    def __exit__(self, *args):
        self.close()

    @contextlib.contextmanager
    def transaction(self):
        with self._mutex:
            owner = not self.conn.in_transaction
            if owner:
                self.conn.execute("BEGIN IMMEDIATE")
            try:
                yield self.conn
                if owner:
                    self.conn.execute("COMMIT")
            except BaseException:
                if owner and self.conn.in_transaction:
                    self.conn.execute("ROLLBACK")
                raise

    @property
    @synchronized
    def project(self):
        row = self.conn.execute("SELECT value_json FROM meta WHERE key='project'").fetchone()
        if not row:
            raise MigrationError("WORKSPACE_SCHEMA", "Original project metadata is absent")
        return parse_json(row[0])

    def event(self, operation_id, actor, event_type, payload):
        project = self.project
        revision = project["revision"] + 1
        project["revision"] = revision
        self.conn.execute("UPDATE meta SET value_json=? WHERE key='project'", (canonical(project),))
        self.conn.execute("INSERT INTO events VALUES(?,?,?,?,?,?,?)",
                          (revision, "event-" + identity({"workspace": project["id"], "revision": revision})[:40],
                           now(), operation_id, actor, event_type, canonical(payload)))
        return revision

    @synchronized
    def _operation(self, operation_id, required=True):
        row = self.conn.execute("SELECT * FROM operations WHERE id=?", (operation_id,)).fetchone()
        if not row:
            if required:
                raise MigrationError("OPERATION_NOT_FOUND", "Original operation not found", {"id": operation_id})
            return None
        out = dict(row)
        for key in ("request", "result", "error", "checkpoint"):
            value = out.pop(key + "_json")
            out[key] = parse_json(value) if value is not None else None
        return out

    def checkpoint(self, operation_id, value):
        with self.transaction():
            self.conn.execute("UPDATE operations SET checkpoint_json=? WHERE id=?", (canonical(value), operation_id))

    def execute(self, operation, payload, handler):
        if not isinstance(payload, dict):
            raise MigrationError("INVALID_PAYLOAD", "Mutation payload must be an object")
        op_id = identifier(payload.get("operation_id"), "operation_id")
        actor = text(payload.get("actor"), "actor", max_length=512)
        expected = integer(payload.get("expected_revision"), "expected_revision")
        semantic = {k: v for k, v in payload.items() if k not in ("operation_id", "expected_revision")}
        request_sha = identity({"operation": operation, "payload": semantic})
        with self._mutex:
            old = self._operation(op_id, required=False)
            if old:
                if old["operation"] != operation or old["request_sha256"] != request_sha:
                    raise MigrationError("OPERATION_ID_REUSED", "Operation ID is already bound to a different request")
                if old["status"] == "SUCCEEDED":
                    return {"revision": old["result"]["revision"], "operation_id": op_id, "reused": True, "result": old["result"]["result"]}
                raise MigrationError("OPERATION_REQUIRES_RESUME", "Continue the retained original operation with operation.resume", {"operation": old})
            with self.transaction():
                actual = self.project["revision"]
                if expected != actual:
                    raise MigrationError("REVISION_CONFLICT", "Workspace changed", {"expected_revision": expected, "actual_revision": actual})
                created = now()
                rev = self.event(op_id, actor, "operation.reserved", {"operation": operation, "request_sha256": request_sha})
                self.conn.execute("INSERT INTO operations(id,operation,request_sha256,request_json,actor,status,reserved_revision,created_at) VALUES(?,?,?,?,?,'RUNNING',?,?)",
                                  (op_id, operation, request_sha, canonical(payload), actor, rev, created))
            return self._run_original(op_id, handler, reused=False)

    def _run_original(self, operation_id, handler, *, reused):
        op = self._operation(operation_id)
        try:
            result = handler(op)
            if not isinstance(result, dict) or not isinstance(result.get("id"), str):
                raise MigrationError("RESULT_CONTRACT", "Mutation must return an object with id")
            with self.transaction():
                rev = self.event(operation_id, op["actor"], "operation.completed", {"operation": op["operation"], "result_id": result["id"]})
                saved = {"revision": rev, "result": result}
                self.conn.execute("UPDATE operations SET status='SUCCEEDED',finished_at=?,result_json=?,error_json=NULL WHERE id=?",
                                  (now(), canonical(saved), operation_id))
            return {"revision": rev, "operation_id": operation_id, "reused": reused, "result": result}
        except BaseException as exc:
            error = exc.as_dict() if isinstance(exc, MigrationError) else {"code": type(exc).__name__, "message": str(exc)}
            try:
                with self.transaction():
                    self.event(operation_id, op["actor"], "operation.interrupted", {"operation": op["operation"], "error": error})
                    self.conn.execute("UPDATE operations SET status='INTERRUPTED',error_json=?,finished_at=? WHERE id=?",
                                      (canonical(error), now(), operation_id))
            except BaseException:
                pass
            raise

    def resume_original(self, operation_id, *, actor, reason, expected_revision, handler):
        identifier(operation_id)
        text(actor, "actor")
        text(reason, "reason")
        integer(expected_revision, "expected_revision")
        with self._mutex:
            op = self._operation(operation_id)
            if op["status"] == "SUCCEEDED":
                return {"revision": op["result"]["revision"], "operation_id": operation_id, "reused": True, "result": op["result"]["result"]}
            with self.transaction():
                actual = self.project["revision"]
                if expected_revision != actual:
                    raise MigrationError("REVISION_CONFLICT", "Workspace changed", {"actual_revision": actual})
                self.event(operation_id, actor, "operation.resumed", {"reason": reason, "original_actor": op["actor"], "original_request_sha256": op["request_sha256"]})
                self.conn.execute("UPDATE operations SET status='RUNNING',finished_at=NULL WHERE id=?", (operation_id,))
            return self._run_original(operation_id, handler, reused=True)

    @synchronized
    def get_entity(self, kind, entity_id, *, required=True):
        row = self.conn.execute("SELECT body_json FROM entities WHERE kind=? AND id=?", (kind, entity_id)).fetchone()
        if not row:
            if required:
                raise MigrationError("ENTITY_NOT_FOUND", "Retained entity not found", {"kind": kind, "id": entity_id})
            return None
        return parse_json(row[0])

    def put_entity(self, kind, entity_id, body, created_revision):
        if body.get("id") != entity_id:
            raise MigrationError("ENTITY_IDENTITY", "Entity body does not match its ID")
        with self.transaction():
            old = self.get_entity(kind, entity_id, required=False)
            if old is not None and old != body:
                raise MigrationError("IMMUTABLE_ENTITY", "Completed entity already exists with different bytes", {"kind": kind, "id": entity_id})
            self.conn.execute("INSERT OR IGNORE INTO entities VALUES(?,?,?,?)", (kind, entity_id, created_revision, canonical(body)))
        return body

    @synchronized
    def list_entities(self, kind, *, offset=0, limit=100):
        integer(offset, "offset")
        integer(limit, "limit", minimum=1, maximum=MAX_PAGE)
        count = self.conn.execute("SELECT count(*) FROM entities WHERE kind=?", (kind,)).fetchone()[0]
        rows = self.conn.execute("SELECT body_json FROM entities WHERE kind=? ORDER BY created_revision DESC,id LIMIT ? OFFSET ?", (kind, limit, offset))
        return {"rows": [parse_json(r[0]) for r in rows], "total": count, "offset": offset, "limit": limit}

    @synchronized
    def file_info(self, sha256):
        digest(sha256)
        row = self.conn.execute("SELECT * FROM files WHERE sha256=?", (sha256,)).fetchone()
        if not row:
            raise MigrationError("FILE_NOT_FOUND", "Retained original file not found", {"sha256": sha256})
        return dict(row)

    @synchronized
    def open_file(self, sha256):
        info = self.file_info(sha256)
        expected = f"objects/{sha256[:2]}/{sha256}"
        if info["relative_path"] != expected:
            raise MigrationError("FILE_PATH", "Original file-table path is not canonical")
        parent = self.root / "objects" / sha256[:2]
        if parent.is_symlink():
            raise MigrationError("SYMLINK", "Object directory is a symlink")
        fd = os.open(self.root / expected, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        handle = os.fdopen(fd, "rb")
        try:
            st = os.fstat(handle.fileno())
            if not stat.S_ISREG(st.st_mode) or st.st_size != info["bytes"]:
                raise MigrationError("FILE_IDENTITY", "Retained original size/type changed")
            actual = file_hash(handle)
            if actual["sha256"] != sha256 or actual["bytes"] != info["bytes"]:
                raise MigrationError("FILE_IDENTITY", "Retained original SHA256 changed")
            return handle
        except BaseException:
            handle.close()
            raise

    def stage_file(self, binary_stream, filename, *, expected_sha256=None, expected_bytes=None):
        filename = basename(filename)
        if expected_sha256 is not None:
            digest(expected_sha256)
        if expected_bytes is not None:
            integer(expected_bytes, "expected_bytes")
        token = uuid4().hex
        temporary = self.root / "staging" / (token + ".part")
        sha, size = hashlib.sha256(), 0
        with self._mutex:
            try:
                with open(temporary, "xb") as out:
                    os.chmod(temporary, 0o600)
                    while True:
                        block = binary_stream.read(1024 * 1024)
                        if not block:
                            break
                        if not isinstance(block, bytes):
                            raise MigrationError("BINARY_STREAM", "stage_file needs a binary stream")
                        sha.update(block)
                        size += len(block)
                        if expected_bytes is not None and size > expected_bytes:
                            raise MigrationError("FILE_LENGTH", "Source exceeds declared original byte length")
                        out.write(block)
                    out.flush()
                    os.fsync(out.fileno())
                actual = sha.hexdigest()
                if (expected_sha256 is not None and actual != expected_sha256) or (expected_bytes is not None and size != expected_bytes):
                    raise MigrationError("FILE_IDENTITY", "Original file does not match declared identity", {"sha256": actual, "bytes": size})
                parent = self.root / "objects" / actual[:2]
                if parent.is_symlink():
                    raise MigrationError("SYMLINK", "Object directory must not be a symlink")
                parent.mkdir(mode=0o700, exist_ok=True)
                sync_directory(self.root / "objects")
                destination = parent / actual
                if destination.exists():
                    regular(destination)
                    if file_hash(destination) != {"sha256": actual, "bytes": size}:
                        raise MigrationError("FILE_IDENTITY", "Existing immutable object differs")
                else:
                    os.link(temporary, destination)
                    os.chmod(destination, 0o400)
                sync_directory(parent)
                with self.transaction():
                    old = self.conn.execute("SELECT bytes,relative_path FROM files WHERE sha256=?", (actual,)).fetchone()
                    relative = f"objects/{actual[:2]}/{actual}"
                    if old and (old["bytes"] != size or old["relative_path"] != relative):
                        raise MigrationError("FILE_IDENTITY", "Original file ledger conflicts")
                    self.conn.execute("INSERT OR IGNORE INTO files VALUES(?,?,?,?)", (actual, size, relative, now()))
                # Only the verified complete duplicate staging member is retired.
                temporary.unlink()
                sync_directory(self.root / "staging")
                return {"sha256": actual, "bytes": size, "filename": filename}
            except BaseException as exc:
                try:
                    receipt = {"schema": "ma-dor.staging-attempt/v1", "id": token, "filename": filename,
                               "expected_sha256": expected_sha256, "expected_bytes": expected_bytes, "written_bytes": size,
                               "partial": temporary.name, "error": str(exc), "recorded_at": now()}
                    with open(self.root / "staging" / (token + ".json"), "x", encoding="utf-8") as out:
                        out.write(canonical(receipt))
                        out.flush()
                        os.fsync(out.fileno())
                except BaseException:
                    pass
                raise

    describe_backup = staticmethod(lambda path: describe_backup(path))

    def backup_to(self, new_path):
        destination = Path(new_path).absolute()
        for p in [*reversed(destination.parent.parents), destination.parent]:
            if p.exists() and p.is_symlink():
                raise MigrationError("SYMLINK", "Backup path must be ordinary")
        destination.parent.mkdir(parents=True, exist_ok=True)
        with self._mutex:
            if self.conn.in_transaction:
                raise MigrationError("SNAPSHOT_TRANSACTION", "Call backup_to outside an open write transaction")
            if destination.exists() or destination.is_symlink():
                raise MigrationError("SNAPSHOT_EXISTS", "Reuse the existing completed snapshot with describe_backup; do not replace it")
            temporary = destination.parent / (destination.name + ".partial-" + uuid4().hex)
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
            os.close(fd)
            snapshot = sqlite3.connect(temporary, isolation_level=None)
            try:
                self.conn.backup(snapshot, pages=256)
                snapshot.execute("PRAGMA journal_mode=DELETE")
            finally:
                snapshot.close()
            # A failed/incomplete temporary snapshot remains its own original attempt.
            info = describe_backup(temporary)
            with open(temporary, "rb") as handle:
                os.fsync(handle.fileno())
            os.link(temporary, destination)
            os.chmod(destination, 0o400)
            sync_directory(destination.parent)
            if file_hash(destination) != {"sha256":info["sha256"],"bytes":info["bytes"]}:
                raise MigrationError("SNAPSHOT_IDENTITY", "Published snapshot changed")
            temporary.unlink()
            sync_directory(destination.parent)
            info["path"] = str(destination)
            return info

    @synchronized
    def close(self):
        if self._closed:
            return
        if self.conn is not None:
            self.conn.close()
            self.conn = None
        if self._lock_fd is not None:
            # Closing this retained descriptor releases its original flock.
            # Keep it available if the close itself has not completed.
            os.close(self._lock_fd)
            self._lock_fd = None
        self._closed = True
