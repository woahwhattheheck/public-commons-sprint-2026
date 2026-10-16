"""Deterministic projection from immutable events to current operation state."""

from __future__ import annotations

import sqlite3
from typing import Any

from claim_recovery_reduce_claim import apply_claim, apply_takeover
from claim_recovery_reduce_owner import apply_owned_event


def _initial_state(operation_id: str) -> dict[str, Any]:
    return {
        "operation_id": operation_id,
        "generation": 0,
        "owner": None,
        "status": "unclaimed",
        "claimed_at": None,
        "last_seen_at": None,
        "lease_minutes": 90,
        "source_ref": "",
        "summary": "",
        "checkpoint_json": None,
        "checkpoint_at": None,
        "completed_at": None,
        "released_at": None,
        "blocked_at": None,
        "last_event_id": None,
        "revision": 0,
    }


def rebuild_operation(connection: sqlite3.Connection, operation_id: str) -> None:
    rows = connection.execute(
        """
        SELECT * FROM events
        WHERE operation_id = ?
        ORDER BY occurred_at ASC, event_id ASC
        """,
        (operation_id,),
    ).fetchall()
    connection.execute("DELETE FROM anomalies WHERE operation_id = ?", (operation_id,))
    if not rows:
        connection.execute("DELETE FROM operations WHERE operation_id = ?", (operation_id,))
        return

    state = _initial_state(operation_id)
    for row in rows:
        kind = row["kind"]
        if kind == "claim":
            accepted = apply_claim(connection, operation_id, state, row)
        elif kind == "takeover":
            accepted = apply_takeover(connection, operation_id, state, row)
        else:
            accepted = apply_owned_event(connection, operation_id, state, row)
        if not accepted:
            continue
        if row["source_ref"]:
            state["source_ref"] = row["source_ref"]
        if row["summary"]:
            state["summary"] = row["summary"]
        state["last_event_id"] = row["event_id"]
        state["revision"] += 1

    connection.execute(
        """
        INSERT INTO operations(
            operation_id, generation, owner, status, claimed_at, last_seen_at,
            lease_minutes, source_ref, summary, checkpoint_json, checkpoint_at,
            completed_at, released_at, blocked_at, last_event_id, revision
        ) VALUES(
            :operation_id, :generation, :owner, :status, :claimed_at, :last_seen_at,
            :lease_minutes, :source_ref, :summary, :checkpoint_json, :checkpoint_at,
            :completed_at, :released_at, :blocked_at, :last_event_id, :revision
        )
        ON CONFLICT(operation_id) DO UPDATE SET
            generation = excluded.generation,
            owner = excluded.owner,
            status = excluded.status,
            claimed_at = excluded.claimed_at,
            last_seen_at = excluded.last_seen_at,
            lease_minutes = excluded.lease_minutes,
            source_ref = excluded.source_ref,
            summary = excluded.summary,
            checkpoint_json = excluded.checkpoint_json,
            checkpoint_at = excluded.checkpoint_at,
            completed_at = excluded.completed_at,
            released_at = excluded.released_at,
            blocked_at = excluded.blocked_at,
            last_event_id = excluded.last_event_id,
            revision = excluded.revision
        """,
        state,
    )
