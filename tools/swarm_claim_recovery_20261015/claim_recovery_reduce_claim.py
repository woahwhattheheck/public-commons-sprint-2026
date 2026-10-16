"""Claim and takeover transition rules."""

from __future__ import annotations

import sqlite3
from typing import Any

from claim_recovery_schema import record_anomaly


def apply_claim(
    connection: sqlite3.Connection,
    operation_id: str,
    state: dict[str, Any],
    row: sqlite3.Row,
) -> bool:
    event_id = row["event_id"]
    actor = row["actor"]
    occurred_at = row["occurred_at"]
    requested = row["generation"]
    current = int(state["generation"])
    owner = state["owner"]
    status = state["status"]

    if status == "unclaimed":
        generation = requested or 1
        if generation != 1:
            record_anomaly(
                connection, operation_id, event_id, "INITIAL_GENERATION_GAP",
                f"initial claim requested generation {generation}; expected 1", occurred_at,
            )
            return False
    elif actor == owner and status in {"active", "blocked"}:
        generation = requested or current
        if generation != current:
            record_anomaly(
                connection, operation_id, event_id, "OWNER_GENERATION_MISMATCH",
                f"owner renewal requested generation {generation}; current is {current}", occurred_at,
            )
            return False
    elif status == "released":
        generation = requested or current + 1
        if generation != current + 1:
            record_anomaly(
                connection, operation_id, event_id, "REOPEN_GENERATION_MISMATCH",
                f"released operation requires generation {current + 1}", occurred_at,
            )
            return False
    elif status == "complete":
        record_anomaly(
            connection, operation_id, event_id, "COMPLETED_REOPEN_REJECTED",
            "completed operations are immutable; create a successor operation id", occurred_at,
        )
        return False
    else:
        record_anomaly(
            connection, operation_id, event_id, "CONFLICTING_CLAIM",
            f"{actor} attempted to claim generation {current} owned by {owner}", occurred_at,
        )
        return False

    state.update(
        generation=generation,
        owner=actor,
        status="active",
        claimed_at=occurred_at,
        last_seen_at=occurred_at,
        lease_minutes=row["lease_minutes"],
        completed_at=None,
        released_at=None,
        blocked_at=None,
    )
    return True


def apply_takeover(
    connection: sqlite3.Connection,
    operation_id: str,
    state: dict[str, Any],
    row: sqlite3.Row,
) -> bool:
    event_id = row["event_id"]
    occurred_at = row["occurred_at"]
    generation = row["generation"]
    expected = row["expected_generation"]
    current = int(state["generation"])

    if generation is None or expected is None:
        record_anomaly(
            connection, operation_id, event_id, "TAKEOVER_GUARD_MISSING",
            "takeover requires generation and expected_generation", occurred_at,
        )
        return False
    if expected != current:
        record_anomaly(
            connection, operation_id, event_id, "TAKEOVER_EXPECTATION_MISMATCH",
            f"expected generation {expected}; current is {current}", occurred_at,
        )
        return False
    if generation != current + 1:
        record_anomaly(
            connection, operation_id, event_id, "TAKEOVER_GENERATION_MISMATCH",
            f"takeover generation must be {current + 1}", occurred_at,
        )
        return False
    if not row["reason"]:
        record_anomaly(
            connection, operation_id, event_id, "TAKEOVER_REASON_MISSING",
            "takeover requires a reason and provider readback", occurred_at,
        )
        return False

    state.update(
        generation=generation,
        owner=row["actor"],
        status="active",
        claimed_at=occurred_at,
        last_seen_at=occurred_at,
        lease_minutes=row["lease_minutes"],
        completed_at=None,
        released_at=None,
        blocked_at=None,
    )
    return True
