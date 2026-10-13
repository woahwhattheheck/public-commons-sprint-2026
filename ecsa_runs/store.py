"""SQLite job registry with fenced leases and immutable, content-addressed payloads."""
from __future__ import annotations
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time
import uuid
from typing import Any, Iterator
from . import codec

TERMINAL = {"complete", "failed", "cancelled"}
SCHEMA = """
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(
 id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, family TEXT NOT NULL,
 name TEXT NOT NULL, kind TEXT NOT NULL, spec_sha TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('queued','running','cancelling','complete','failed','cancelled')),
 created REAL NOT NULL, updated REAL NOT NULL, started REAL, finished REAL,
 attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL,
 lease_token TEXT, lease_owner TEXT, lease_until REAL,
 result_sha TEXT, error TEXT, metrics_json TEXT NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(state, created, id);
CREATE TABLE IF NOT EXISTS events(
 seq INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL,
 at REAL NOT NULL, kind TEXT NOT NULL, details TEXT NOT NULL,
 FOREIGN KEY(job_id) REFERENCES jobs(id));
CREATE INDEX IF NOT EXISTS job_events ON events(job_id,seq);
"""

def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def check_sha(sha: str) -> str:
    if len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
        raise ValueError("Invalid SHA-256 reference")
    return sha

class RunStore:
    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / "blobs").mkdir(exist_ok=True)
        (self.root / "logs").mkdir(exist_ok=True)
        self.db = self.root / "runs.sqlite3"
        with self.connection() as con:
            con.execute("PRAGMA journal_mode=WAL")
            con.executescript(SCHEMA)
            con.execute("INSERT OR IGNORE INTO settings VALUES('schema','1')")
            con.execute("INSERT OR IGNORE INTO settings VALUES('workspace_id',?)", (uuid.uuid4().hex,))
            version = con.execute("SELECT value FROM settings WHERE key='schema'").fetchone()[0]
            if version != "1": raise ValueError(f"Unsupported workspace schema {version}")

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        con = sqlite3.connect(self.db, timeout=30, isolation_level=None)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys=ON")
        con.execute("PRAGMA synchronous=FULL")
        try: yield con
        finally: con.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self.connection() as con:
            con.execute("BEGIN IMMEDIATE")
            try:
                yield con
                con.execute("COMMIT")
            except BaseException:
                con.execute("ROLLBACK")
                raise

    def blob_path(self, sha: str) -> Path:
        return self.root / "blobs" / check_sha(sha)

    def put_bytes(self, data: bytes) -> str:
        sha = digest(data)
        target = self.blob_path(sha)
        if target.exists():
            if digest(target.read_bytes()) != sha: raise ValueError(f"Corrupt blob {sha}")
            return sha
        tmp = target.with_name("." + sha + "." + uuid.uuid4().hex)
        try:
            with tmp.open("xb") as f:
                f.write(data); f.flush(); os.fsync(f.fileno())
            os.replace(tmp, target)
        finally:
            tmp.unlink(missing_ok=True)
        return sha

    def read_bytes(self, sha: str) -> bytes:
        data = self.blob_path(sha).read_bytes()
        if digest(data) != sha: raise ValueError(f"Corrupt blob {sha}")
        return data

    def put(self, value: Any) -> str: return self.put_bytes(codec.dumps(value))
    def read(self, sha: str) -> Any: return codec.loads(self.read_bytes(sha))

    @staticmethod
    def _event(con, job_id: str, kind: str, details: dict | None = None):
        con.execute("INSERT INTO events(job_id,at,kind,details) VALUES(?,?,?,?)",
                    (job_id, time.time(), kind, json.dumps(details or {}, sort_keys=True)))

    def submit(self, spec: dict, request_key: str | None = None, max_attempts: int = 2) -> dict:
        if not isinstance(max_attempts, int) or max_attempts < 1: raise ValueError("max_attempts must be positive")
        for key in ("family", "name", "kind", "snapshot_sha", "inputs"):
            if key not in spec: raise ValueError(f"Missing run specification field {key}")
        if not isinstance(spec["family"], str) or not spec["family"]: raise ValueError("family is required")
        if spec["kind"] not in ("baseline", "scenario"): raise ValueError("kind must be baseline or scenario")
        self.read(spec["snapshot_sha"])
        sha = self.put(spec)
        key = request_key or sha
        job_id = "job-" + uuid.uuid4().hex
        now = time.time()
        with self.transaction() as con:
            old = con.execute("SELECT * FROM jobs WHERE request_key=?", (key,)).fetchone()
            if old:
                if old["spec_sha"] != sha: raise ValueError("Request key already identifies different inputs")
                return dict(old)
            con.execute("""INSERT INTO jobs(id,request_key,family,name,kind,spec_sha,state,
                        created,updated,max_attempts) VALUES(?,?,?,?,?,?,'queued',?,?,?)""",
                        (job_id, key, spec["family"], spec["name"], spec["kind"], sha, now, now, max_attempts))
            self._event(con, job_id, "submitted", {"spec_sha": sha})
            return dict(con.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())

    def get(self, job_id: str) -> dict:
        with self.connection() as con:
            row = con.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if row is None: raise KeyError(job_id)
        return dict(row)

    def list(self, state: str | None = None, family: str | None = None,
             limit: int = 100, offset: int = 0) -> list[dict]:
        if limit < 1 or offset < 0: raise ValueError("Invalid page")
        clauses, args = [], []
        for column, value in (("state", state), ("family", family)):
            if value is not None: clauses.append(column + "=?"); args.append(value)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self.connection() as con:
            return [dict(r) for r in con.execute("SELECT * FROM jobs" + where +
                    " ORDER BY created DESC,id DESC LIMIT ? OFFSET ?", (*args, limit, offset))]

    def events(self, job_id: str) -> list[dict]:
        with self.connection() as con:
            return [dict(r) for r in con.execute("SELECT * FROM events WHERE job_id=? ORDER BY seq", (job_id,))]

    def counts(self) -> dict:
        with self.connection() as con:
            return dict(con.execute("SELECT state,count(*) FROM jobs GROUP BY state").fetchall())

    def _recover(self, con, now):
        expired = con.execute("SELECT * FROM jobs WHERE state IN ('running','cancelling') AND lease_until<?", (now,)).fetchall()
        for row in expired:
            state = ("cancelled" if row["state"] == "cancelling" else
                     "queued" if row["attempt"] < row["max_attempts"] else "failed")
            con.execute("""UPDATE jobs SET state=?,lease_token=NULL,lease_owner=NULL,lease_until=NULL,
                        updated=?,finished=?,error=? WHERE id=?""",
                        (state, now, now if state in TERMINAL else None,
                         "Execution lease expired; previous attempt retained", row["id"]))
            self._event(con, row["id"], "lease_recovered", {"attempt": row["attempt"], "state": state})

    def recover(self) -> dict:
        with self.transaction() as con: self._recover(con, time.time())
        return self.counts()

    def claim(self, owner: str, lease_seconds: float = 30, job_ids: list[str] | None = None) -> dict | None:
        if lease_seconds <= 0: raise ValueError("lease_seconds must be positive")
        now = time.time()
        with self.transaction() as con:
            self._recover(con, now)
            query, args = "SELECT * FROM jobs WHERE state='queued'", []
            if job_ids is not None:
                if not job_ids: return None
                query += " AND id IN (" + ",".join("?" for _ in job_ids) + ")"
                args.extend(job_ids)
            row = con.execute(query + " ORDER BY created,id LIMIT 1", args).fetchone()
            if row is None: return None
            token = uuid.uuid4().hex
            con.execute("""UPDATE jobs SET state='running',attempt=attempt+1,started=?,updated=?,finished=NULL,
                        lease_token=?,lease_owner=?,lease_until=?,error=NULL WHERE id=?""",
                        (now, now, token, owner, now + lease_seconds, row["id"]))
            self._event(con, row["id"], "started", {"owner": owner, "attempt": row["attempt"] + 1})
            return dict(con.execute("SELECT * FROM jobs WHERE id=?", (row["id"],)).fetchone())

    def heartbeat(self, job_id: str, token: str, lease_seconds: float = 30) -> bool:
        now = time.time()
        with self.transaction() as con:
            cur = con.execute("""UPDATE jobs SET lease_until=?,updated=? WHERE id=? AND lease_token=?
                              AND lease_until>=? AND state IN ('running','cancelling')""",
                              (now + lease_seconds, now, job_id, token, now))
            return cur.rowcount == 1

    def finish(self, job_id: str, token: str, result_sha: str | None = None,
               error: str | None = None, metrics: dict | None = None, retry: bool = False) -> bool:
        if result_sha is not None: self.read_bytes(result_sha)
        now = time.time()
        with self.transaction() as con:
            row = con.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if (not row or row["lease_token"] != token or row["lease_until"] < now
                or row["state"] not in ("running", "cancelling")): return False
            state = ("cancelled" if row["state"] == "cancelling" else "complete" if result_sha else
                     "queued" if retry and row["attempt"] < row["max_attempts"] else "failed")
            con.execute("""UPDATE jobs SET state=?,updated=?,finished=?,lease_token=NULL,lease_owner=NULL,
                        lease_until=NULL,result_sha=?,error=?,metrics_json=? WHERE id=?""",
                        (state, now, now if state in TERMINAL else None, result_sha if state == "complete" else None,
                         error, json.dumps(metrics or {}, sort_keys=True), job_id))
            self._event(con, job_id, state, {"result_sha": result_sha, "error": error, "metrics": metrics or {}})
            return True

    def cancel(self, job_id: str) -> dict:
        now = time.time()
        with self.transaction() as con:
            row = con.execute("SELECT state FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row is None: raise KeyError(job_id)
            if row["state"] not in TERMINAL:
                state = "cancelled" if row["state"] == "queued" else "cancelling"
                con.execute("UPDATE jobs SET state=?,updated=?,finished=? WHERE id=?",
                            (state, now, now if state == "cancelled" else None, job_id))
                self._event(con, job_id, "cancel_requested")
        return self.get(job_id)

    def retry(self, job_id: str) -> dict:
        with self.transaction() as con:
            row = con.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row is None: raise KeyError(job_id)
            if row["state"] not in ("failed", "cancelled"): raise ValueError("Only failed/cancelled runs can be retried")
            con.execute("UPDATE jobs SET state='queued',max_attempts=max(max_attempts,attempt+1),updated=?,finished=NULL WHERE id=?",
                        (time.time(), job_id))
            self._event(con, job_id, "retry_requested")
        return self.get(job_id)

    def result(self, job_id: str) -> dict:
        row = self.get(job_id)
        if row["state"] != "complete" or not row["result_sha"]: raise ValueError("Run has no completed result")
        from .artifacts import restore_artifacts
        return restore_artifacts(self, self.read(row["result_sha"]), job_id)

    def put_file(self, path: str | Path, *, expected: dict | None = None) -> tuple[str, int]:
        """Stream a complete file; reuse a matching known blob without staging it.

        expected is the original file descriptor's sha256 and byte length. Both
        the selected source and any existing immutable body are checked. A new
        body still uses one complete capture pass before atomic publication.
        """
        selected = None
        if expected is not None:
            if not isinstance(expected, dict):
                raise TypeError('Expected file metadata must be an original descriptor')
            sha = check_sha(expected.get('sha256'))
            size = expected.get('bytes')
            if type(size) is not int or size < 0:
                raise ValueError('Expected file byte length must be nonnegative')
            selected = (sha, size)
        path = Path(path)

        # A file already frozen in this store needs no second capture.
        if path.parent.resolve() == (self.root / 'blobs').resolve() and len(path.name) == 64:
            sha = check_sha(path.name)
            size = self.verify_blob(sha)
            if selected is not None and (sha, size) != selected:
                raise ValueError(f'Original file metadata differs: {path}')
            return sha, size

        def identity(value):
            return (value.st_dev, value.st_ino, value.st_size,
                    value.st_mtime_ns, value.st_ctime_ns)

        before = identity(path.stat())
        if selected is not None and before[2] != selected[1]:
            raise ValueError(f'Original file length differs: {path}')

        def capture(output=None):
            h, size = hashlib.sha256(), 0
            with path.open('rb') as source:
                if identity(os.fstat(source.fileno())) != before:
                    raise RuntimeError(f'File changed before capture: {path}')
                while chunk := source.read(1024 * 1024):
                    if output is not None:
                        output.write(chunk)
                    h.update(chunk)
                    size += len(chunk)
                if identity(os.fstat(source.fileno())) != before:
                    raise RuntimeError(f'File changed during capture: {path}')
            if identity(path.stat()) != before:
                raise RuntimeError(f'File changed during capture: {path}')
            result = h.hexdigest(), size
            if selected is not None and result != selected:
                raise ValueError(f'Original file bytes differ: {path}')
            return result

        if selected is not None and self.blob_path(selected[0]).exists():
            sha, size = capture()
            if self.verify_blob(sha) != size:
                raise ValueError(f'Retained file length differs: {sha}')
            return sha, size

        tmp = self.root / 'blobs' / ('.incoming-' + uuid.uuid4().hex)
        try:
            with tmp.open('xb') as output:
                sha, size = capture(output)
                output.flush()
                os.fsync(output.fileno())
            target = self.blob_path(sha)
            if target.exists():
                if self.verify_blob(sha) != size:
                    raise ValueError(f'Retained file length differs: {sha}')
            else:
                os.replace(tmp, target)
            return sha, size
        finally:
            tmp.unlink(missing_ok=True)

    def verify_blob(self, sha: str) -> int:
        h, size = hashlib.sha256(), 0
        with self.blob_path(sha).open('rb') as src:
            while chunk := src.read(1024 * 1024): h.update(chunk); size += len(chunk)
        if h.hexdigest() != sha: raise ValueError(f'Corrupt blob {sha}')
        return size

    def copy_blob(self, sha: str, target: str | Path):
        """Copy (never hardlink) immutable input bytes, verifying in one streaming pass."""
        target = Path(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        h = hashlib.sha256()
        tmp = target.with_name('.' + target.name + '-' + uuid.uuid4().hex)
        try:
            with self.blob_path(sha).open('rb') as src, tmp.open('xb') as dst:
                while chunk := src.read(1024 * 1024): dst.write(chunk); h.update(chunk)
                dst.flush(); os.fsync(dst.fileno())
            if h.hexdigest() != sha: raise ValueError(f'Corrupt blob {sha}')
            os.replace(tmp, target)
        finally: tmp.unlink(missing_ok=True)

    def save_project(self, value: dict):
        sha = self.put(value)
        with self.transaction() as con:
            con.execute("INSERT INTO settings VALUES('project_sha',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (sha,))
        return sha

    def project(self) -> dict:
        with self.connection() as con:
            row = con.execute("SELECT value FROM settings WHERE key='project_sha'").fetchone()
        return self.read(row[0]) if row else {}
