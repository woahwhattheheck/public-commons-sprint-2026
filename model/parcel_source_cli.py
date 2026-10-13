"""Operate the original parcel-source workflow from a retained Workspace."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .common import atomic_json, digest, read_json
from .workspace import Workspace
from . import parcel_source_desk as desk


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace")
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("capture", help="Inspect an existing original parcel capture")
    p.add_argument("directory")
    p.add_argument("--output")
    p = commands.add_parser("prepare", help="Prepare and import the selected original county edition")
    p.add_argument("directory")
    p.add_argument("--selection", required=True, help="Saved capture preview JSON")
    p.add_argument("--title", required=True)
    p.add_argument("--operation-id")
    commands.add_parser("overview")
    p = commands.add_parser("edition")
    p.add_argument("edition_id")
    p = commands.add_parser("rows")
    p.add_argument("edition_id")
    p.add_argument("--table", default="parcels", choices=list(desk.TABLES))
    p.add_argument("--county", default="")
    p.add_argument("--query", default="")
    p.add_argument("--offset", type=int, default=0)
    p.add_argument("--limit", type=int, default=100)
    p = commands.add_parser("study-selection")
    p.add_argument("edition_id")
    p.add_argument("settings")
    p.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    if args.command == "capture":
        result = desk.preview(args.directory)
        if args.output:
            atomic_json(Path(args.output), result, immutable=True)
    else:
        if not args.workspace:
            parser.error("This operation needs --workspace for the existing original project")
        ws = Workspace(args.workspace)
        if args.command == "prepare":
            saved = read_json(args.selection)
            selection = saved.get("selection", saved)
            operation_id = args.operation_id or digest({
                "action": "parcel.source.prepare", "project_id": ws.project["id"],
                "selection": selection, "title": args.title,
            })
            result = desk.operate(ws, args.directory, selection, title=args.title, operation_id=operation_id)
        elif args.command == "overview":
            result = desk.overview(ws)
        elif args.command == "edition":
            result = desk.get(ws, args.edition_id)
        elif args.command == "rows":
            result = desk.rows(ws, args.edition_id, table=args.table, county=args.county,
                               query=args.query, offset=args.offset, limit=args.limit)
        else:
            result = desk.study_selection(ws, args.edition_id, read_json(args.settings))
            atomic_json(Path(args.output), result, immutable=True)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
