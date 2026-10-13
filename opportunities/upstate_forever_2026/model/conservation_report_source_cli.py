"""Prepare or reopen an original Conservation portfolio in Scientific Reports."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import conservation_report_source as report_source
from .workspace import Workspace


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare", help="Retain the selected original portfolio as a report source")
    prepare.add_argument("--plan-id", required=True)
    prepare.add_argument("--title")
    prepare.add_argument("--no-maps", action="store_true", help="Retain a source-only edition without geographic figures")
    inspect = commands.add_parser("inspect", help="Verify and reopen an imported report-source receipt")
    inspect.add_argument("--id", required=True)
    listing = commands.add_parser("list", help="List completed report-source receipts")
    listing.add_argument("--plan-id")
    args = parser.parse_args(argv)
    workspace = Workspace(args.workspace.resolve(), create=False)
    if args.command == "prepare":
        spec = {"plan_id": args.plan_id, "include_maps": not args.no_maps}
        if args.title is not None:
            spec["title"] = args.title
        value = report_source.prepare(workspace, spec)
    elif args.command == "inspect":
        value = report_source.get(workspace, args.id)
    else:
        value = report_source.list_sources(workspace, args.plan_id)
    print(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
