"""Owner-only non-acquisition transition rules."""

from __future__ import annotations

import sqlite3
from typing import Any

from claim_recovery_core import TERMINAL_STATUSES
from claim_recovery_schema import record_anomaly


def apply_owned_event(
    connection: sqlite3.Connection,
    operation_id: str,
    state: dict[str, Any],
    row: sqlite3.Row,
) -> bool:
    event_id = row["event_id"]
    kind = row["kind"]
    actor = row["actor"]
    occurred_at = row["occurred_at"]
    current = int(state["generation"])
    event_generation = row["generation"] or current
    owner = state["owner"]
    status = state["status"]

    if current == 0:
        record_anomaly(
            connection, operation_id, event_id, "EVENT_BEFORE_CLAIM",
            f"{kind} arrived before a valid claim", occurred_at,
        )
        return False
    if event_generation != current:
        record_anomaly(
            connection, operation_id, event_id, "STALE_GENERATION_EVENT",
            f"event generation {event_generation}; current is {current}", occurred_at,
        )
        return False
    if actor != owner:
        record_anomaly(
            connection, operation_id, event_id, "NON_OWNER_EVENT",
            f"event actor {actor} does not own generation {current} ({owner})", occurred_at,
        )
        return False
    if status in TERMINAL_STATUSES:
        record_anomaly(
            connection, operation_id, event_id, "EVENT_AFTER_TERMINAL",
            f"{kind} arrived after terminal state {status}", occurred_at,
        )
        return False

    state["last_seen_at"] = occurred_at
    if kind == "heartbeat":
        state["status"] = "blocked" if status == "blocked" else "active"
    elif kind == "checkpoint":
        if row["checkpoint_json"] is None:
            record_anomaly(
                connection, operation_id, event_id, "CHECKPOINT_METADATA_MISSING",
                "checkpoint event requires checkpoint metadata", occurred_at,
            )
            return False
        state["checkpoint_json"] = row["checkpoint_json"]
        state["checkpoint_at"] = occurred_at
    elif kind == "block":
        state["status"] = "blocked"
        state["blocked_at"] = occurred_at
    elif kind == "release":
        state["status"] = "released"
        state["released_at"] = occurred_at
    elif kind == "complete":
        state["status"] = "complete"
        state["completed_at"] = occurred_at
    return True
