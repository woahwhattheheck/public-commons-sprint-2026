#!/usr/bin/env python3
"""Use the utility/community workspace with original local source selections."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    __package__ = "model"

from .common import read_json
from .workspace import Workspace
from . import communities


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("overview")
    for name in ("table-import", "plan-save", "report-build"):
        commands.add_parser(name).add_argument("selection", type=Path)
    for name in ("table", "plan", "report"):
        commands.add_parser(name).add_argument("id")
    args = parser.parse_args(argv)
    try:
        workspace = Workspace(args.workspace)
        if args.command == "overview":
            result = communities.overview(workspace)
        elif args.command in {"table", "plan", "report"}:
            kind = {"table": communities.TABLE_KIND, "plan": communities.PLAN_KIND,
                    "report": communities.REPORT_KIND}[args.command]
            result = workspace._get(kind, args.id)
        else:
            action = {"table-import": "community.table.import", "plan-save": "community.plan.save",
                      "report-build": "community.report.build"}[args.command]
            result = communities.invoke(workspace, action, read_json(args.selection))
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"error": {"type": type(error).__name__, "message": str(error)}},
                         ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
