"""Event ingestion, operation lookup, and stale-work classification."""

from __future__ import annotations

import io
import json
import sqlite3
import sys
from datetime import datetime
from typing import Any, Iterable, Mapping

from claim_recovery_core import (
    Classification,
    LedgerError,
    Thresholds,
    canonical_json,
    canonical_time,
    normalize_event,
    parse_time,
    utc_now,
)
from claim_recovery_reducer import rebuild_operation
from claim_recovery_schema import connect_database

def insert_events(
    connection: sqlite3.Connection, events: Iterable[Mapping[str, Any]]
) -> tuple[int, int, list[str]]:
    inserted = 0
    duplicates = 0
    affected: set[str] = set()
    normalized_events = [normalize_event(event) for event in events]
    try:
        connection.execute("BEGIN IMMEDIATE")
        for event in normalized_events:
            existing = connection.execute(
                "SELECT event_sha256 FROM events WHERE event_id = ?",
                (event["event_id"],),
            ).fetchone()
            if existing is not None:
                if existing["event_sha256"] != event["event_sha256"]:
                    raise LedgerError(
                        f"event_id collision with different content: {event['event_id']}"
                    )
                duplicates += 1
                continue
            connection.execute(
                """
                INSERT INTO events(
                    event_id, operation_id, kind, actor, occurred_at, generation,
                    expected_generation, lease_minutes, source_ref, summary,
                    reason, checkpoint_json, event_sha256, ingested_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event["event_id"],
                    event["operation_id"],
                    event["kind"],
                    event["actor"],
                    event["occurred_at"],
                    event["generation"],
                    event["expected_generation"],
                    event["lease_minutes"],
                    event["source_ref"],
                    event["summary"],
                    event["reason"],
                    canonical_json(event["checkpoint"])
                    if event["checkpoint"] is not None
                    else None,
                    event["event_sha256"],
                    canonical_time(utc_now()),
                ),
            )
            inserted += 1
            affected.add(event["operation_id"])
        for operation_id in sorted(affected):
            rebuild_operation(connection, operation_id)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return inserted, duplicates, sorted(affected)


def read_jsonl(path: str) -> list[dict[str, Any]]:
    stream: io.TextIOBase
    close_stream = False
    if path == "-":
        stream = sys.stdin
    else:
        stream = open(path, "r", encoding="utf-8")
        close_stream = True
    events: list[dict[str, Any]] = []
    try:
        for line_number, line in enumerate(stream, start=1):
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            try:
                value = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise LedgerError(f"invalid JSON on line {line_number}: {exc}") from exc
            if not isinstance(value, dict):
                raise LedgerError(f"line {line_number} must contain a JSON object")
            events.append(value)
    finally:
        if close_stream:
            stream.close()
    return events


def get_operation(connection: sqlite3.Connection, operation_id: str) -> sqlite3.Row:
    row = connection.execute(
        "SELECT * FROM operations WHERE operation_id = ?", (operation_id,)
    ).fetchone()
    if row is None:
        raise LedgerError(f"unknown operation {operation_id!r}")
    return row


def classify_row(
    row: Mapping[str, Any], now: datetime, thresholds: Thresholds
) -> Classification:
    thresholds.validate()
    status = row["status"]
    checkpoint = row["checkpoint_json"] is not None
    last_seen_raw = row["last_seen_at"] or row["claimed_at"]
    if last_seen_raw:
        age = max(0, int((now - parse_time(last_seen_raw)).total_seconds() // 60))
    else:
        age = 0

    if status == "complete":
        return Classification("complete", age, checkpoint, "none")
    if status == "released":
        return Classification("released", age, checkpoint, "available for a new explicit claim")
    if status == "blocked":
        if age >= thresholds.recovery_minutes:
            action = "read provider state, then repair or explicitly take over"
        else:
            action = "resolve recorded blocker with current owner"
        return Classification("blocked", age, checkpoint, action)
    if age < thresholds.watch_minutes:
        return Classification("active", age, checkpoint, "continue current ownership")
    if age < thresholds.recovery_minutes:
        return Classification("watch", age, checkpoint, "check original thread before duplicating")
    if age < thresholds.abandoned_minutes:
        return Classification(
            "recovery_candidate",
            age,
            checkpoint,
            "read provider result and original thread; resume from checkpoint if inactive",
        )
    return Classification(
        "abandoned",
        age,
        checkpoint,
        "read provider result, then guarded takeover using expected generation",
    )


def operation_dict(
    row: sqlite3.Row, now: datetime, thresholds: Thresholds
) -> dict[str, Any]:
    classification = classify_row(row, now, thresholds)
    checkpoint = json.loads(row["checkpoint_json"]) if row["checkpoint_json"] else None
    return {
        "operation_id": row["operation_id"],
        "generation": row["generation"],
        "owner": row["owner"],
        "status": row["status"],
        "classification": classification.name,
        "age_minutes": classification.age_minutes,
        "recovery_ready": classification.recovery_ready,
        "next_action": classification.next_action,
        "claimed_at": row["claimed_at"],
        "last_seen_at": row["last_seen_at"],
        "lease_minutes": row["lease_minutes"],
        "source_ref": row["source_ref"],
        "summary": row["summary"],
        "checkpoint": checkpoint,
        "checkpoint_at": row["checkpoint_at"],
        "completed_at": row["completed_at"],
        "released_at": row["released_at"],
        "blocked_at": row["blocked_at"],
        "revision": row["revision"],
    }


def list_operations(
    connection: sqlite3.Connection, now: datetime, thresholds: Thresholds
) -> list[dict[str, Any]]:
    rows = connection.execute(
        "SELECT * FROM operations ORDER BY COALESCE(last_seen_at, claimed_at) DESC, operation_id"
    ).fetchall()
    anomaly_counts = {
        row["operation_id"]: int(row["count"])
        for row in connection.execute(
            "SELECT operation_id, COUNT(*) AS count FROM anomalies GROUP BY operation_id"
        ).fetchall()
    }
    operations = [operation_dict(row, now, thresholds) for row in rows]
    for item in operations:
        item["anomaly_count"] = anomaly_counts.get(item["operation_id"], 0)
    rank = {
        "abandoned": 0,
        "recovery_candidate": 1,
        "blocked": 2,
        "watch": 3,
        "active": 4,
        "released": 5,
        "complete": 6,
    }
    operations.sort(
        key=lambda item: (
            rank.get(item["classification"], 99),
            -int(item["age_minutes"]),
            item["operation_id"],
        )
    )
    return operations


