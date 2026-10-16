"""SQLite schema and anomaly persistence for the claim recovery ledger."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from claim_recovery_core import LedgerError, SCHEMA_VERSION


def connect_database(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10.0)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 10000")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = FULL")
    initialize_schema(connection)
    return connection


def initialize_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS events (
            event_id TEXT PRIMARY KEY,
            operation_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            actor TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            generation INTEGER,
            expected_generation INTEGER,
            lease_minutes INTEGER NOT NULL,
            source_ref TEXT NOT NULL,
            summary TEXT NOT NULL,
            reason TEXT NOT NULL,
            checkpoint_json TEXT,
            event_sha256 TEXT NOT NULL,
            ingested_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_events_operation_time
            ON events(operation_id, occurred_at, event_id);

        CREATE TABLE IF NOT EXISTS operations (
            operation_id TEXT PRIMARY KEY,
            generation INTEGER NOT NULL,
            owner TEXT,
            status TEXT NOT NULL,
            claimed_at TEXT,
            last_seen_at TEXT,
            lease_minutes INTEGER NOT NULL,
            source_ref TEXT NOT NULL,
            summary TEXT NOT NULL,
            checkpoint_json TEXT,
            checkpoint_at TEXT,
            completed_at TEXT,
            released_at TEXT,
            blocked_at TEXT,
            last_event_id TEXT,
            revision INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS anomalies (
            operation_id TEXT NOT NULL,
            event_id TEXT NOT NULL,
            code TEXT NOT NULL,
            detail TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY(operation_id, event_id, code)
        );

        CREATE INDEX IF NOT EXISTS idx_anomalies_operation
            ON anomalies(operation_id, created_at);
        """
    )
    current = connection.execute(
        "SELECT value FROM meta WHERE key = 'schema_version'"
    ).fetchone()
    if current is None:
        connection.execute(
            "INSERT INTO meta(key, value) VALUES('schema_version', ?)",
            (str(SCHEMA_VERSION),),
        )
    elif int(current["value"]) != SCHEMA_VERSION:
        raise LedgerError(
            f"unsupported database schema {current['value']}; expected {SCHEMA_VERSION}"
        )
    connection.commit()


def record_anomaly(
    connection: sqlite3.Connection,
    operation_id: str,
    event_id: str,
    code: str,
    detail: str,
    created_at: str,
) -> None:
    connection.execute(
        """
        INSERT OR REPLACE INTO anomalies(
            operation_id, event_id, code, detail, created_at
        ) VALUES(?, ?, ?, ?, ?)
        """,
        (operation_id, event_id, code, detail, created_at),
    )
