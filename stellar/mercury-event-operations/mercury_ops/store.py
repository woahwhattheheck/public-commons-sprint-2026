"""Durable Mercury intake, canonical events and worker custody."""
from __future__ import annotations

import base64
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import time


class OpsError(Exception):
    def __init__(self, code, message, http_status=400, details=None):
        super().__init__(message)
        self.code, self.message, self.http_status = code, message, http_status
        self.details = details


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else encoded(value).encode()).hexdigest()


def operation_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", value):
        raise OpsError("INVALID_OPERATION_ID", "Use an operation ID of 1–128 letters, numbers, dots, colons, underscores or hyphens.")
    return value


def decode_row(row):
    if row is None:
        return None
    result = dict(row)
    for key in ("payload", "result", "error", "canonical", "contracts", "topic_filters", "last_result"):
        if isinstance(result.get(key), str):
            result[key] = json.loads(result[key])
    return result


class Store:
    def __init__(self, workspace, binding):
        self.root = Path(workspace).absolute()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.root.is_symlink():
            raise OpsError("PRIVATE_WORKSPACE_REQUIRED", "Use a private workspace directory, not a symbolic link.")
        os.chmod(self.root, 0o700)
        self.path = self.root / "mercury_ops.sqlite3"
        if self.path.is_symlink():
            raise OpsError("PRIVATE_WORKSPACE_REQUIRED", "The workspace database must be a regular private file.")
        fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
        os.chmod(self.path, 0o600)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS notifications(
                    seq INTEGER PRIMARY KEY AUTOINCREMENT, notification_id TEXT UNIQUE NOT NULL,
                    body BLOB NOT NULL,body_sha TEXT NOT NULL,tx_hash TEXT NOT NULL,contract_id TEXT NOT NULL,
                    provider_timestamp TEXT NOT NULL,received_at REAL NOT NULL,last_received_at REAL NOT NULL,
                    arrivals INTEGER NOT NULL,state TEXT NOT NULL,task_id TEXT NOT NULL,error TEXT);
                CREATE TABLE IF NOT EXISTS jobs(
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT UNIQUE NOT NULL,
                    contracts TEXT NOT NULL,topic_filters TEXT NOT NULL DEFAULT '{}',ledger_from INTEGER NOT NULL,ledger_to INTEGER NOT NULL,
                    page_size INTEGER NOT NULL,cursor INTEGER,pages INTEGER NOT NULL DEFAULT 0,
                    events_seen INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL,
                    created_at REAL NOT NULL,updated_at REAL NOT NULL,error TEXT);
                CREATE TABLE IF NOT EXISTS tasks(
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,
                    payload TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
                    failures INTEGER NOT NULL DEFAULT 0,generation INTEGER NOT NULL DEFAULT 0,
                    due_at REAL NOT NULL,lease_token TEXT,lease_until REAL,
                    created_at REAL NOT NULL,updated_at REAL NOT NULL,error TEXT,result TEXT);
                CREATE INDEX IF NOT EXISTS tasks_due ON tasks(state,due_at,seq);
                CREATE TABLE IF NOT EXISTS attempts(
                    task_id TEXT NOT NULL,number INTEGER NOT NULL,token TEXT NOT NULL,
                    state TEXT NOT NULL,started_at REAL NOT NULL,finished_at REAL,error TEXT,result TEXT,
                    PRIMARY KEY(task_id,number));
                CREATE TABLE IF NOT EXISTS observations(
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL,attempt INTEGER NOT NULL,
                    request_path TEXT NOT NULL,http_status INTEGER NOT NULL,body BLOB NOT NULL,
                    body_sha TEXT NOT NULL,received_at REAL NOT NULL,UNIQUE(task_id,attempt));
                CREATE TABLE IF NOT EXISTS events(
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,
                    provider_row_id INTEGER UNIQUE NOT NULL,canonical TEXT NOT NULL,canonical_sha TEXT NOT NULL,
                    contract_id TEXT NOT NULL,tx_hash TEXT NOT NULL,event_index INTEGER,
                    first_seen_at REAL NOT NULL,last_seen_at REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS deliveries(
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE NOT NULL,
                    task_id TEXT UNIQUE NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
                    updated_at REAL NOT NULL,error TEXT,last_result TEXT);
                CREATE TABLE IF NOT EXISTS event_sources(
                    event_id TEXT NOT NULL,source_kind TEXT NOT NULL,source_id TEXT NOT NULL,
                    task_id TEXT NOT NULL,attempt INTEGER NOT NULL,observed_at REAL NOT NULL,
                    PRIMARY KEY(event_id,source_kind,source_id,task_id,attempt));
            """)
        with self.transaction() as db:
            if not any(row[1] == "generation" for row in db.execute("PRAGMA table_info(tasks)")):
                db.execute("ALTER TABLE tasks ADD COLUMN generation INTEGER NOT NULL DEFAULT 0")
            if not any(row[1] == "topic_filters" for row in db.execute("PRAGMA table_info(jobs)")):
                db.execute("ALTER TABLE jobs ADD COLUMN topic_filters TEXT NOT NULL DEFAULT '{}'")
            wanted = digest(binding)
            previous = db.execute("SELECT value FROM metadata WHERE key='binding_sha256'").fetchone()
            if previous and previous[0] != wanted:
                raise OpsError("WORKSPACE_BINDING_MISMATCH", "This workspace is already bound to another network, provider scope or destination.", 409)
            db.execute("INSERT OR IGNORE INTO metadata VALUES('binding_sha256',?)", (wanted,))
            db.execute("INSERT OR IGNORE INTO metadata VALUES('schema','mercury-ops.store.v1')")
        descriptor = os.open(self.root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=15000")
        db.execute("PRAGMA synchronous=FULL")
        try:
            yield db
        finally:
            db.close()

    @contextmanager
    def transaction(self):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                yield db
                db.execute("COMMIT")
            except BaseException:
                db.execute("ROLLBACK")
                raise

    @contextmanager
    def worker_lock(self):
        path = self.root / "worker.lock"
        if path.is_symlink():
            raise OpsError("PRIVATE_WORKSPACE_REQUIRED", "The worker lock must be a private regular file.")
        fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
        acquired = False
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
            except BlockingIOError:
                pass
            yield acquired
        finally:
            if acquired:
                fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)

    def one(self, table, key, value):
        if (table, key) not in {("events", "event_id"), ("notifications", "notification_id"),
                ("jobs", "job_id"), ("tasks", "task_id"), ("deliveries", "event_id")}:
            raise ValueError("Unknown store entity")
        with self.connect() as db:
            row = decode_row(db.execute(f"SELECT * FROM {table} WHERE {key}=?", (value,)).fetchone())
        if row is None:
            raise OpsError("NOT_FOUND", "The retained record was not found.", 404)
        return row

    def page(self, table, *, limit=100, after=None, state=None):
        if table not in {"events", "notifications", "jobs", "tasks", "deliveries"}:
            raise ValueError("Unknown store entity")
        if type(limit) is not int or not 1 <= limit <= 500:
            raise OpsError("INVALID_LIMIT", "Choose a result limit between 1 and 500.")
        clauses, values = [], []
        if after is not None and after != "":
            if not re.fullmatch(r"[1-9][0-9]{0,18}", str(after)):
                raise OpsError("INVALID_CURSOR", "Use the returned next_cursor for the next page.")
            clauses.append("seq<?"); values.append(int(after))
        if state:
            if table == "events":
                raise OpsError("INVALID_FILTER", "Filter delivery state in the deliveries view.")
            clauses.append("state=?"); values.append(state)
        # Bodies and canonical rows are detail/export fields, not list payloads.
        fields = {"notifications": "seq,notification_id,tx_hash,contract_id,state,arrivals,received_at,last_received_at,task_id,error",
                  "events": "seq,event_id,provider_row_id,contract_id,tx_hash,event_index,first_seen_at,last_seen_at"}.get(table, "*")
        query = f"SELECT {fields} FROM {table}" + (" WHERE " + " AND ".join(clauses) if clauses else "") + " ORDER BY seq DESC LIMIT ?"
        with self.connect() as db:
            rows = [decode_row(row) for row in db.execute(query, (*values, limit + 1))]
            if table == "events":
                for row in rows:
                    delivery = db.execute("SELECT state FROM deliveries WHERE event_id=?", (row["event_id"],)).fetchone()
                    row["delivery_state"] = delivery[0] if delivery else None
        return {"items": rows[:limit], "next_cursor": str(rows[limit-1]["seq"]) if len(rows) > limit else None}

    @staticmethod
    def enqueue(db, task_id, kind, payload, *, due_at=None):
        moment = time.time()
        previous = db.execute("SELECT kind,payload FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        body = encoded(payload)
        if previous:
            if previous["kind"] != kind or previous["payload"] != body:
                raise OpsError("TASK_INPUT_CONFLICT", "The task ID already retains different input.", 409)
            return False
        db.execute("INSERT INTO tasks(task_id,kind,payload,state,due_at,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?)",
                   (task_id, kind, body, moment if due_at is None else due_at, moment, moment))
        return True

    @staticmethod
    def retain_observation(db, task, page):
        db.execute("INSERT OR IGNORE INTO observations(task_id,attempt,request_path,http_status,body,body_sha,received_at) VALUES(?,?,?,?,?,?,?)",
                   (task["task_id"], task["attempts"], page.request_path, page.http_status,
                    page.raw_body, digest(page.raw_body), page.received_at))

    def attempts(self, task_id):
        with self.connect() as db:
            return [decode_row(row) for row in db.execute("SELECT * FROM attempts WHERE task_id=? ORDER BY number DESC LIMIT 100", (task_id,))]

    def notification_detail(self, notification_id):
        row = self.one("notifications", "notification_id", notification_id)
        row["raw_body_base64"] = base64.b64encode(row.pop("body")).decode("ascii")
        return row
