"""Private, durable original inputs and operations; native jobs remain in Wherobots."""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import threading
from datetime import datetime, timezone
import uuid

SCHEMA = "starforge.wherobots.workspace.v1"
HEX = re.compile(r"[0-9a-f]{64}\Z")
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}\Z")


class OperationError(Exception):
    def __init__(self, code, message, *, status=422, details=None):
        super().__init__(message)
        self.code, self.status, self.details = code, status, details

    def as_dict(self):
        return {"error": self.code, "message": str(self), "status": self.status,
                **({"details": self.details} if self.details is not None else {})}


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def identifier(value, label="ID"):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise OperationError("INVALID_ID", f"Use a nonempty {label} of at most 240 ordinary identifier characters.")
    return value


def private_directory(path, *, create=False):
    path = Path(path).absolute()
    if create:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        info = path.lstat()
    except FileNotFoundError:
        raise OperationError("WORKSPACE_NOT_FOUND", "Open an existing workspace, or initialize a new directory.", status=404) from None
    if not stat.S_ISDIR(info.st_mode) or path.resolve() != path:
        raise OperationError("INVALID_DIRECTORY", "Use a real directory without symbolic links.")
    if os.name != "nt" and info.st_mode & 0o077:
        raise OperationError("PRIVATE_DIRECTORY_REQUIRED", "Use a workspace directory accessible only to its owner (mode 0700).")
    return path


def sync_directory(path):
    if os.name != "nt":
        fd = os.open(str(path), os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def hash_file(path):
    h, size = hashlib.sha256(), 0
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
            size += len(chunk)
    return h.hexdigest(), size


class Workspace:
    """A single SQLite ledger and immutable content objects, shared by CLI and UI."""
    def __init__(self, directory, create=False, title="Wherobots operations"):
        self.directory = private_directory(directory, create=create)
        self.objects = self.directory / "objects"
        self.locks = self.directory / "locks"
        for path in (self.objects, self.locks):
            private_directory(path, create=True)
        database = self.directory / "workspace.sqlite3"
        if database.is_symlink() or (database.exists() and not database.is_file()):
            raise OperationError("INVALID_WORKSPACE", "Open the original regular workspace database.")
        if not create and not database.exists():
            raise OperationError("WORKSPACE_NOT_FOUND", "This directory has no original workspace database.", status=404)
        self._mutex = threading.RLock()
        self.db = sqlite3.connect(database, timeout=30, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        if os.name != "nt":
            os.chmod(database, 0o600)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        with self.db:
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS records(
                    kind TEXT NOT NULL,id TEXT NOT NULL,sha256 TEXT NOT NULL,body BLOB NOT NULL,
                    PRIMARY KEY(kind,id));
                CREATE TABLE IF NOT EXISTS record_history(
                    kind TEXT NOT NULL,id TEXT NOT NULL,sha256 TEXT NOT NULL,body BLOB NOT NULL,
                    recorded_at TEXT NOT NULL,PRIMARY KEY(kind,id,sha256));
                CREATE TABLE IF NOT EXISTS events(
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,id TEXT NOT NULL,
                    recorded_at TEXT NOT NULL,body BLOB NOT NULL);
            """)
            self.db.execute("INSERT OR IGNORE INTO metadata VALUES('schema',?)", (SCHEMA,))
            self.db.execute("INSERT OR IGNORE INTO metadata VALUES('workspace_id',?)", (uuid.uuid4().hex,))
            self.db.execute("INSERT OR IGNORE INTO metadata VALUES('created_at',?)", (now(),))
            self.db.execute("INSERT OR IGNORE INTO metadata VALUES('title',?)", (str(title),))
        metadata = dict(self.db.execute("SELECT key,value FROM metadata"))
        if metadata["schema"] != SCHEMA:
            self.db.close()
            raise OperationError("WORKSPACE_SCHEMA", "Open this workspace with its matching application version.")
        self.workspace_id = metadata["workspace_id"]
        self.title = metadata["title"]

    def close(self):
        with self._mutex:
            self.db.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def get_record(self, kind, record_id):
        identifier(kind, "record kind"); identifier(record_id)
        with self._mutex:
            row = self.db.execute("SELECT body,sha256 FROM records WHERE kind=? AND id=?", (kind, record_id)).fetchone()
        if row is None:
            raise OperationError("RECORD_NOT_FOUND", f"No retained {kind} has ID {record_id}.", status=404)
        return {**json.loads(row["body"]), "revision_sha256": row["sha256"]}

    def records(self, kind):
        identifier(kind, "record kind")
        with self._mutex:
            rows = self.db.execute("SELECT body,sha256 FROM records WHERE kind=? ORDER BY id", (kind,)).fetchall()
        return [{**json.loads(row["body"]), "revision_sha256": row["sha256"]} for row in rows]

    def save_record(self, kind, record_id, body, expected_revision=None):
        identifier(kind, "record kind"); identifier(record_id)
        if not isinstance(body, dict):
            raise OperationError("RECORD_OBJECT_REQUIRED", "A retained record must be a JSON object.")
        value = {key: item for key, item in body.items() if key != "revision_sha256"}
        raw = canonical(value)
        if len(raw) > 32 * 1024 * 1024:
            raise OperationError("RECORD_TOO_LARGE", "Retain large original files as content objects.")
        sha = hashlib.sha256(raw).hexdigest()
        with self._mutex:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                old = self.db.execute("SELECT sha256 FROM records WHERE kind=? AND id=?", (kind, record_id)).fetchone()
                if old and old[0] == sha:
                    self.db.rollback()
                    return {**value, "revision_sha256": sha}
                if (old[0] if old else None) != expected_revision:
                    raise OperationError("REVISION_CHANGED", "Reopen the current saved version before applying this change.",
                                         status=409, details={"kind": kind, "id": record_id,
                                                              "current_revision": old[0] if old else None})
                self.db.execute("INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET sha256=excluded.sha256,body=excluded.body",
                                (kind, record_id, sha, raw))
                self.db.execute("INSERT OR IGNORE INTO record_history VALUES(?,?,?,?,?)", (kind, record_id, sha, raw, now()))
                self.db.commit()
            except BaseException:
                self.db.rollback()
                raise
        return {**value, "revision_sha256": sha}

    def event(self, kind, record_id, value):
        identifier(kind); identifier(record_id)
        raw = canonical(value)
        if len(raw) > 1024 * 1024:
            raise OperationError("EVENT_TOO_LARGE", "Reference retained source objects from an operation event.")
        with self._mutex, self.db:
            cursor = self.db.execute("INSERT INTO events(kind,id,recorded_at,body) VALUES(?,?,?,?)", (kind, record_id, now(), raw))
        return cursor.lastrowid

    def events(self, kind, record_id, after=0, limit=100):
        identifier(kind); identifier(record_id)
        if type(after) is not int or after < 0 or type(limit) is not int or not 1 <= limit <= 1000:
            raise OperationError("INVALID_PAGE", "Use a nonnegative cursor and a page size between 1 and 1000.")
        with self._mutex:
            rows = self.db.execute("SELECT seq,recorded_at,body FROM events WHERE kind=? AND id=? AND seq>? ORDER BY seq LIMIT ?",
                                   (kind, record_id, after, limit + 1)).fetchall()
        items = [{"seq": row["seq"], "recorded_at": row["recorded_at"], "event": json.loads(row["body"])} for row in rows[:limit]]
        return {"items": items, "has_more": len(rows) > limit, "next_cursor": items[-1]["seq"] if items else after}

    def put_object(self, source):
        partial = self.objects / (".partial-" + uuid.uuid4().hex)
        fd = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        h, size = hashlib.sha256(), 0
        try:
            with os.fdopen(fd, "wb") as out:
                if isinstance(source, (bytes, bytearray)):
                    chunks = [source]
                    stream = None
                else:
                    source = Path(source)
                    if source.is_symlink() or not source.is_file():
                        raise OperationError("ORIGINAL_FILE_REQUIRED", "Select a complete regular source file.")
                    stream = source.open("rb")
                    before = os.fstat(stream.fileno())
                    chunks = iter(lambda: stream.read(1024 * 1024), b"")
                try:
                    for chunk in chunks:
                        h.update(chunk); size += len(chunk); out.write(chunk)
                    if stream is not None:
                        after = os.fstat(stream.fileno())
                        if (before.st_ino, before.st_dev, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                                after.st_ino, after.st_dev, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                            raise OperationError("SOURCE_CHANGED", "The source changed during capture; select its complete saved version.", status=409)
                    out.flush(); os.fsync(out.fileno())
                finally:
                    if stream is not None:
                        stream.close()
            sha = h.hexdigest()
            target = self.objects / sha
            try:
                os.link(partial, target)
            except FileExistsError:
                if hash_file(self.object_path(sha)) != (sha, size):
                    raise OperationError("OBJECT_CONFLICT", "A retained object differs from its declared content identity.", status=409)
            sync_directory(self.objects)
            return {"sha256": sha, "bytes": size}
        finally:
            with contextlib.suppress(FileNotFoundError):
                partial.unlink()

    def object_path(self, sha):
        if not isinstance(sha, str) or not HEX.fullmatch(sha):
            raise OperationError("OBJECT_ID", "Select a complete SHA256 content identity.")
        path = self.objects / sha
        if path.is_symlink() or not path.is_file():
            raise OperationError("OBJECT_NOT_FOUND", "The complete original content object is unavailable.", status=404)
        return path

    @contextlib.contextmanager
    def operation_lock(self, operation_id):
        identifier(operation_id, "operation ID")
        path = self.locks / (hashlib.sha256(operation_id.encode()).hexdigest() + ".lock")
        fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            if os.name == "nt":
                import msvcrt
                if os.fstat(fd).st_size == 0:
                    os.write(fd, b"0")
                os.lseek(fd, 0, os.SEEK_SET)
                try:
                    msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                except OSError:
                    raise OperationError("OPERATION_ACTIVE", "The original operation is already running; reopen its status.", status=409) from None
            else:
                import fcntl
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise OperationError("OPERATION_ACTIVE", "The original operation is already running; reopen its status.", status=409) from None
            yield
        finally:
            os.close(fd)
