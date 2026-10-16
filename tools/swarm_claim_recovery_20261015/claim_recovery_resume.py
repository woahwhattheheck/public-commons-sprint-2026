"""Bounded recovery packet generation."""

from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any

from claim_recovery_core import Thresholds, canonical_time
from claim_recovery_store import get_operation, operation_dict

def resume_packet(
    connection: sqlite3.Connection,
    operation_id: str,
    now: datetime,
    thresholds: Thresholds,
) -> dict[str, Any]:
    row = get_operation(connection, operation_id)
    item = operation_dict(row, now, thresholds)
    events = connection.execute(
        """
        SELECT event_id, kind, actor, occurred_at, generation, source_ref, summary, reason
        FROM events WHERE operation_id = ?
        ORDER BY occurred_at DESC, event_id DESC LIMIT 20
        """,
        (operation_id,),
    ).fetchall()
    anomalies = connection.execute(
        """
        SELECT event_id, code, detail, created_at
        FROM anomalies WHERE operation_id = ?
        ORDER BY created_at ASC, event_id ASC
        """,
        (operation_id,),
    ).fetchall()
    return {
        "schema_version": 1,
        "generated_at": canonical_time(now),
        "operation": item,
        "event_tail": [dict(event) for event in reversed(events)],
        "anomalies": [dict(anomaly) for anomaly in anomalies],
        "acquisition_guard": {
            "requires_provider_readback": True,
            "expected_generation": item["generation"],
            "suggested_command": (
                "python claim_recovery.py --db <ledger.sqlite> takeover "
                f"--operation {operation_id!r} --actor <new-owner> "
                f"--expected-generation {item['generation']} --reason <provider-readback>"
            ),
        },
    }


