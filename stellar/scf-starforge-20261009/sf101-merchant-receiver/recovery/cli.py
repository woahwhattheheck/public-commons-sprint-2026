#!/usr/bin/env python3
"""CLI for the original SF101 merchant database and paid-file snapshot."""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys

from merchant_snapshot import create_snapshot, inspect_snapshot, restore_snapshot


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Snapshot, inspect, and restore the same SF101 orders, access, usage, and paid files."
    )
    commands = parser.add_subparsers(dest="command", required=True)
    snapshot = commands.add_parser("snapshot", help="Capture the merchant database and every original paid file.")
    snapshot.add_argument("--state", required=True)
    snapshot.add_argument("--out", required=True)
    inspect = commands.add_parser("inspect", help="Inspect an existing snapshot before restoration or reuse.")
    inspect.add_argument("--snapshot", required=True)
    restore = commands.add_parser("restore", help="Restore into a new private merchant state directory.")
    restore.add_argument("--snapshot", required=True)
    restore.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    os.umask(0o077)
    try:
        if args.command == "snapshot":
            result = create_snapshot(args.state, args.out)
        elif args.command == "inspect":
            result = inspect_snapshot(args.snapshot)
        else:
            result = restore_snapshot(args.snapshot, args.out)
    except (ValueError, OSError, sqlite3.Error) as error:
        print("SF101_RECOVERY_ERROR " + str(error), file=sys.stderr)
        return 2
    try:
        sys.stdout.write(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()
    except BrokenPipeError:
        # The durable operation has already returned. A closed output consumer
        # does not cancel or repeat it.
        try:
            discard = os.open(os.devnull, os.O_WRONLY)
            os.dup2(discard, sys.stdout.fileno())
            os.close(discard)
        except OSError:
            pass
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
