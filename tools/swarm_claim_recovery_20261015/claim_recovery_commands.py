"""Command implementations for the claim recovery CLI."""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from typing import Any

from claim_recovery_core import (
    HEX_64_RE,
    LedgerError,
    SCHEMA_VERSION,
    Thresholds,
    canonical_json,
    canonical_time,
    parse_time,
    utc_now,
)
from claim_recovery_format import (
    anomalies_to_csv,
    atomic_write_text,
    format_anomalies_table,
    format_table,
    list_anomalies,
    operations_to_csv,
)
from claim_recovery_resume import resume_packet
from claim_recovery_schema import connect_database
from claim_recovery_store import get_operation, insert_events, list_operations, read_jsonl
from claim_recovery_view import render_html

def build_event_from_args(args: argparse.Namespace, kind: str, connection: sqlite3.Connection) -> dict[str, Any]:
    operation_id = args.operation
    now = parse_time(args.at) if args.at else utc_now()
    existing = connection.execute(
        "SELECT * FROM operations WHERE operation_id = ?", (operation_id,)
    ).fetchone()
    generation: int | None = getattr(args, "generation", None)
    expected_generation: int | None = getattr(args, "expected_generation", None)

    if kind == "claim":
        if existing is None:
            generation = 1
        elif existing["owner"] == args.actor and existing["status"] in {"active", "blocked"}:
            generation = existing["generation"]
        elif existing["status"] == "released":
            generation = existing["generation"] + 1
        else:
            raise LedgerError(
                f"operation is {existing['status']} generation {existing['generation']} owned by {existing['owner']}; use guarded takeover after provider readback"
            )
    elif kind == "takeover":
        if existing is None:
            raise LedgerError("cannot take over an unknown operation; use claim")
        if existing["status"] == "complete":
            raise LedgerError("completed operations are immutable; create a successor operation id")
        if existing["status"] == "released":
            raise LedgerError("released operations can be acquired with claim; takeover is unnecessary")
        if expected_generation != existing["generation"]:
            raise LedgerError(
                f"expected generation {expected_generation}; current is {existing['generation']}"
            )
        last_seen = parse_time(existing["last_seen_at"] or existing["claimed_at"])
        age_minutes = max(0, int((now - last_seen).total_seconds() // 60))
        if age_minutes < int(existing["lease_minutes"]):
            raise LedgerError(
                f"generation {existing['generation']} still has a live {existing['lease_minutes']} minute lease "
                f"({age_minutes} minutes old); read the provider state and wait for expiry or have the owner release it"
            )
        generation = existing["generation"] + 1
    else:
        if existing is None:
            raise LedgerError("operation must be claimed first")
        generation = generation or existing["generation"]

    checkpoint: dict[str, Any] | None = None
    if kind == "checkpoint":
        checkpoint = {}
        if args.ref:
            checkpoint["refs"] = list(args.ref)
        if args.sha256:
            if not HEX_64_RE.fullmatch(args.sha256):
                raise LedgerError("--sha256 must be 64 hexadecimal characters")
            checkpoint["sha256"] = args.sha256.lower()
        if args.bytes is not None:
            if args.bytes < 0:
                raise LedgerError("--bytes cannot be negative")
            checkpoint["bytes"] = args.bytes
        if args.head:
            checkpoint["head"] = args.head
        if not checkpoint:
            raise LedgerError("checkpoint requires at least one --ref, --sha256, --bytes, or --head")

    return {
        "operation_id": operation_id,
        "kind": kind,
        "actor": args.actor,
        "occurred_at": canonical_time(now),
        "generation": generation,
        "expected_generation": expected_generation,
        "lease_minutes": getattr(args, "lease_minutes", None) or (existing["lease_minutes"] if existing else 90),
        "source_ref": getattr(args, "source_ref", "") or "",
        "summary": getattr(args, "summary", "") or "",
        "reason": getattr(args, "reason", "") or "",
        "checkpoint": checkpoint,
    }


def write_output(path: str | None, text: str) -> None:
    if path:
        atomic_write_text(Path(path), text)
    else:
        print(text)


def command_init(args: argparse.Namespace) -> int:
    connection = connect_database(Path(args.db))
    connection.close()
    print(f"initialized {args.db} (schema {SCHEMA_VERSION})")
    return 0


def command_ingest(args: argparse.Namespace) -> int:
    events = read_jsonl(args.input)
    connection = connect_database(Path(args.db))
    try:
        inserted, duplicates, affected = insert_events(connection, events)
    finally:
        connection.close()
    print(
        canonical_json(
            {
                "inserted": inserted,
                "duplicates": duplicates,
                "affected_operations": affected,
            }
        )
    )
    return 0


def command_record(args: argparse.Namespace, kind: str) -> int:
    connection = connect_database(Path(args.db))
    try:
        event = build_event_from_args(args, kind, connection)
        inserted, duplicates, affected = insert_events(connection, [event])
        row = get_operation(connection, args.operation)
        result = {
            "inserted": inserted,
            "duplicates": duplicates,
            "affected_operations": affected,
            "operation": dict(row),
        }
    finally:
        connection.close()
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


def _thresholds_from_args(args: argparse.Namespace) -> Thresholds:
    thresholds = Thresholds(
        watch_minutes=args.watch_minutes,
        recovery_minutes=args.recovery_minutes,
        abandoned_minutes=args.abandoned_minutes,
    )
    thresholds.validate()
    return thresholds


def command_scan(args: argparse.Namespace) -> int:
    thresholds = _thresholds_from_args(args)
    now = parse_time(args.now) if args.now else utc_now()
    connection = connect_database(Path(args.db))
    try:
        operations = list_operations(connection, now, thresholds)
        if args.classification:
            wanted = set(args.classification)
            operations = [item for item in operations if item["classification"] in wanted]
    finally:
        connection.close()
    if args.format == "json":
        text = json.dumps(
            {
                "generated_at": canonical_time(now),
                "thresholds": thresholds.__dict__,
                "operations": operations,
            },
            indent=2,
            sort_keys=True,
        )
    elif args.format == "csv":
        text = operations_to_csv(operations)
    else:
        text = format_table(operations)
    write_output(args.output, text)
    if args.exit_if_actionable and any(
        item["classification"] in {"recovery_candidate", "abandoned", "blocked"}
        or int(item.get("anomaly_count", 0)) > 0
        for item in operations
    ):
        return 3
    return 0


def command_audit(args: argparse.Namespace) -> int:
    connection = connect_database(Path(args.db))
    try:
        anomalies = list_anomalies(connection)
    finally:
        connection.close()
    if args.format == "json":
        text = json.dumps({"anomalies": anomalies}, indent=2, sort_keys=True)
    elif args.format == "csv":
        text = anomalies_to_csv(anomalies)
    else:
        text = format_anomalies_table(anomalies)
    write_output(args.output, text)
    return 4 if args.exit_nonzero and anomalies else 0


def command_resume(args: argparse.Namespace) -> int:
    thresholds = _thresholds_from_args(args)
    now = parse_time(args.now) if args.now else utc_now()
    connection = connect_database(Path(args.db))
    try:
        packet = resume_packet(connection, args.operation, now, thresholds)
    finally:
        connection.close()
    text = json.dumps(packet, indent=2, sort_keys=True) + "\n"
    write_output(args.output, text)
    return 0


def command_render(args: argparse.Namespace) -> int:
    thresholds = _thresholds_from_args(args)
    now = parse_time(args.now) if args.now else utc_now()
    connection = connect_database(Path(args.db))
    try:
        operations = list_operations(connection, now, thresholds)
    finally:
        connection.close()
    document = render_html(operations, canonical_time(now), thresholds)
    atomic_write_text(Path(args.output), document)
    print(f"wrote {args.output} ({len(document.encode('utf-8'))} bytes)")
    return 0


