"""Acquire first with the original buyer, then use its delivered data in SQLite."""
from __future__ import annotations

import argparse
import base64
from dataclasses import asdict
import json
from pathlib import Path

from stellar_forge_buyer import DatasetAcquisition
from stellar_forge_buyer.sqlite_dataset import DatasetDatabase


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    ingest = commands.add_parser("import", help="Retain an original finalized data room as one immutable SQL version")
    ingest.add_argument("--checkout", type=Path, required=True)
    ingest.add_argument("--session", type=Path, required=True)
    ingest.add_argument("--delivery", type=Path, required=True)
    ingest.add_argument("--columns", type=Path, help="JSON object mapping selected original field names to SQL names")
    status = commands.add_parser("status", help="Read retained versions or the current named view")
    status.add_argument("--view")
    status.add_argument("--before", type=int)
    activate = commands.add_parser("activate", help="Atomically select a retained version for a named SQL view")
    activate.add_argument("--view", required=True)
    activate.add_argument("--version", required=True)
    activate.add_argument("--expected-revision", type=int, required=True)
    query = commands.add_parser("query", help="Read the acquired data with SQL")
    query.add_argument("--sql", required=True)
    query.add_argument("--parameters", default="[]", help="JSON array or named-parameter object")
    query.add_argument("--max-rows", type=int, default=1000)
    query.add_argument("--max-bytes", type=int, default=16 * 1024 * 1024)
    query.add_argument("--timeout", type=float, default=10)
    backup = commands.add_parser("backup", help="Save a consistent database into a new private destination")
    backup.add_argument("--out", type=Path, required=True)
    for command in (ingest, status, activate, query, backup):
        command.add_argument("--database", type=Path, required=True)
    args = parser.parse_args()
    database = DatasetDatabase(args.database, create=args.command == "import")
    if args.command == "import":
        acquisition = DatasetAcquisition(checkout=args.checkout, session=args.session)
        delivery = acquisition.deliver(args.delivery)
        columns = json.loads(args.columns.read_text()) if args.columns else None
        result = database.import_delivery(delivery, columns=columns)
    elif args.command == "status":
        result = database.current(args.view) if args.view else database.versions(before=args.before)
    elif args.command == "activate":
        result = database.activate(args.view, args.version, expected_revision=args.expected_revision)
    elif args.command == "query":
        result = asdict(database.query(args.sql, json.loads(args.parameters), max_rows=args.max_rows,
                                       max_result_bytes=args.max_bytes, timeout=args.timeout))
    else:
        result = {"database": str(database.backup(args.out))}
    def binary(value):
        if isinstance(value, bytes):
            return {"encoding": "base64", "data": base64.b64encode(value).decode("ascii")}
        raise TypeError(type(value).__name__)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2, default=binary))


if __name__ == "__main__":
    main()
