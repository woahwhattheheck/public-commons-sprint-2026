"""Prepare or reopen an original land-cover ledger in Scientific Reports."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import landcover_report_source as report_source
from .workspace import Workspace


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare", help="Retain the selected original ledger as a report source")
    prepare.add_argument("--ledger-id", required=True)
    prepare.add_argument("--title")
    inspect = commands.add_parser("inspect", help="Verify and reopen an imported report-source receipt")
    inspect.add_argument("--id", required=True)
    listing = commands.add_parser("list", help="List completed report-source receipts")
    listing.add_argument("--ledger-id")
    args = parser.parse_args(argv)
    workspace = Workspace(args.workspace.resolve(), create=False)
    if args.command == "prepare":
        spec = {"ledger_id": args.ledger_id}
        if args.title is not None:
            spec["title"] = args.title
        value = report_source.prepare(workspace, spec)
    elif args.command == "inspect":
        value = report_source.get(workspace, args.id)
    else:
        value = report_source.list_sources(workspace, args.ledger_id)
    print(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
