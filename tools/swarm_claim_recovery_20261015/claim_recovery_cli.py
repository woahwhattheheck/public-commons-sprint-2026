"""Argument parser and process boundary for the claim recovery ledger."""

from __future__ import annotations

import argparse
import sys
import textwrap
from typing import Sequence

from claim_recovery_commands import (
    command_audit,
    command_ingest,
    command_init,
    command_record,
    command_render,
    command_resume,
    command_scan,
)
from claim_recovery_core import LedgerError

def add_common_event_arguments(parser: argparse.ArgumentParser, *, reason: bool = False) -> None:
    parser.add_argument("--operation", required=True, help="stable operation id")
    parser.add_argument("--actor", required=True, help="current worker or seat id")
    parser.add_argument("--at", help="ISO-8601 event time; defaults to now")
    parser.add_argument("--source-ref", default="", help="durable source/thread reference")
    parser.add_argument("--summary", default="", help="concise state summary")
    parser.add_argument("--lease-minutes", type=int, default=90)
    if reason:
        parser.add_argument("--reason", required=True, help="provider-readback or release reason")
    else:
        parser.add_argument("--reason", default="")


def add_threshold_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--watch-minutes", type=int, default=30)
    parser.add_argument("--recovery-minutes", type=int, default=90)
    parser.add_argument("--abandoned-minutes", type=int, default=240)
    parser.add_argument("--now", help="ISO-8601 classification time; defaults to now")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Durable swarm claim, checkpoint, and recovery ledger",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent(
            """
            The scanner never auto-steals work. A stale classification means: read the
            current provider result and original coordination thread, then use guarded
            takeover with the expected generation only when the owner is actually gone.
            """
        ),
    )
    parser.add_argument(
        "--db",
        default="claim-recovery.sqlite3",
        help="SQLite ledger path (default: claim-recovery.sqlite3)",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    init_parser = subcommands.add_parser("init", help="initialize the ledger")
    init_parser.set_defaults(handler=command_init)

    ingest_parser = subcommands.add_parser("ingest", help="ingest JSONL events idempotently")
    ingest_parser.add_argument("--input", required=True, help="JSONL path or - for stdin")
    ingest_parser.set_defaults(handler=command_ingest)

    claim_parser = subcommands.add_parser("claim", help="claim or renew an operation")
    add_common_event_arguments(claim_parser)
    claim_parser.set_defaults(handler=lambda args: command_record(args, "claim"))

    takeover_parser = subcommands.add_parser(
        "takeover", help="explicit compare-and-swap takeover after provider readback"
    )
    add_common_event_arguments(takeover_parser, reason=True)
    takeover_parser.add_argument("--expected-generation", type=int, required=True)
    takeover_parser.set_defaults(handler=lambda args: command_record(args, "takeover"))

    heartbeat_parser = subcommands.add_parser("heartbeat", help="renew current ownership")
    add_common_event_arguments(heartbeat_parser)
    heartbeat_parser.add_argument("--generation", type=int)
    heartbeat_parser.set_defaults(handler=lambda args: command_record(args, "heartbeat"))

    checkpoint_parser = subcommands.add_parser(
        "checkpoint", help="record durable references for resumable work"
    )
    add_common_event_arguments(checkpoint_parser)
    checkpoint_parser.add_argument("--generation", type=int)
    checkpoint_parser.add_argument("--ref", action="append", default=[])
    checkpoint_parser.add_argument("--sha256")
    checkpoint_parser.add_argument("--bytes", type=int)
    checkpoint_parser.add_argument("--head", help="Git or provider head/reference")
    checkpoint_parser.set_defaults(handler=lambda args: command_record(args, "checkpoint"))

    block_parser = subcommands.add_parser("block", help="record a concrete blocker")
    add_common_event_arguments(block_parser, reason=True)
    block_parser.add_argument("--generation", type=int)
    block_parser.set_defaults(handler=lambda args: command_record(args, "block"))

    release_parser = subcommands.add_parser("release", help="release an operation")
    add_common_event_arguments(release_parser, reason=True)
    release_parser.add_argument("--generation", type=int)
    release_parser.set_defaults(handler=lambda args: command_record(args, "release"))

    complete_parser = subcommands.add_parser("complete", help="mark an operation complete")
    add_common_event_arguments(complete_parser)
    complete_parser.add_argument("--generation", type=int)
    complete_parser.set_defaults(handler=lambda args: command_record(args, "complete"))

    scan_parser = subcommands.add_parser("scan", help="classify current operations")
    add_threshold_arguments(scan_parser)
    scan_parser.add_argument(
        "--classification",
        action="append",
        choices=[
            "active",
            "watch",
            "recovery_candidate",
            "abandoned",
            "blocked",
            "released",
            "complete",
        ],
    )
    scan_parser.add_argument("--format", choices=["table", "json", "csv"], default="table")
    scan_parser.add_argument("--output")
    scan_parser.add_argument(
        "--exit-if-actionable",
        action="store_true",
        help="exit 3 when recovery, blocked, abandoned, or anomalous work exists",
    )
    scan_parser.set_defaults(handler=command_scan)

    audit_parser = subcommands.add_parser("audit", help="list rejected or conflicting events")
    audit_parser.add_argument("--format", choices=["table", "json", "csv"], default="table")
    audit_parser.add_argument("--output")
    audit_parser.add_argument("--exit-nonzero", action="store_true")
    audit_parser.set_defaults(handler=command_audit)

    resume_parser = subcommands.add_parser("resume", help="emit a complete recovery packet")
    add_threshold_arguments(resume_parser)
    resume_parser.add_argument("--operation", required=True)
    resume_parser.add_argument("--output")
    resume_parser.set_defaults(handler=command_resume)

    render_parser = subcommands.add_parser("render", help="render the industrial HTML desk")
    add_threshold_arguments(render_parser)
    render_parser.add_argument("--output", required=True)
    render_parser.set_defaults(handler=command_render)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.handler(args))
    except LedgerError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        return 130


