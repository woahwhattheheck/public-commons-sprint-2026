"""Operate the original persistent conservation study and portfolio workflow."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    __package__ = "model"

from . import conservation
from .common import atomic_json, read_json
from .workspace import Workspace


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workspace", required=True, type=Path)
    commands = p.add_subparsers(dest="command", required=True)
    commands.add_parser("overview")
    prepare = commands.add_parser("prepare", help="Retain a complete original study selection")
    prepare.add_argument("selection", type=Path)
    build = commands.add_parser("build", help="Compute or resume a retained study or complete selection")
    build.add_argument("selection_or_id")
    inspect = commands.add_parser("inspect", help="Read the actual current study and all candidate rows")
    inspect.add_argument("study_id")
    inspect.add_argument("--without-candidates", action="store_true")
    selection = commands.add_parser("selection", help="Export the editable selection for a successor study")
    selection.add_argument("study_id")
    selection.add_argument("--output", required=True, type=Path)
    plan = commands.add_parser("plan-save", help="Save a manual or ranked spatial portfolio")
    plan.add_argument("selection", type=Path)
    plan_read = commands.add_parser("plan-inspect")
    plan_read.add_argument("plan_id")
    export = commands.add_parser("export", help="Create the complete offline HTML, CSV, JSON and GeoPackage packet")
    export.add_argument("study_id")
    export.add_argument("--plan-id")
    return p


def perform(args):
    workspace = Workspace(args.workspace)
    if args.command == "overview":
        return conservation.overview(workspace)
    if args.command == "prepare":
        return conservation.prepare(workspace, read_json(args.selection))
    if args.command == "build":
        value = args.selection_or_id
        if not re.fullmatch(r"[0-9a-f]{64}", value):
            value = read_json(Path(value))
        return conservation.build(workspace, value)
    if args.command == "inspect":
        return conservation.inspect(workspace, args.study_id, include_candidates=not args.without_candidates)
    if args.command == "selection":
        value = conservation.inspect(workspace, args.study_id, include_candidates=False)["selection"]["spec"]
        if args.output.exists():
            raise ValueError("Choose a new selection filename")
        atomic_json(args.output, value, immutable=True)
        return {"study_id": args.study_id, "path": str(args.output.resolve()), "selection": value}
    if args.command == "plan-save":
        return conservation.save_plan(workspace, read_json(args.selection))
    if args.command == "plan-inspect":
        return conservation.get_plan(workspace, args.plan_id)
    if args.command == "export":
        return conservation.export_packet(workspace, args.study_id, args.plan_id)
    raise ValueError("Unknown conservation operation")


def main(argv=None):
    try:
        print(json.dumps(perform(parser().parse_args(argv)), indent=2, sort_keys=True,
                         ensure_ascii=False, allow_nan=False))
        return 0
    except (ValueError, OSError, KeyError, TypeError, ImportError, RuntimeError) as error:
        print(json.dumps({"state": "error", "type": type(error).__name__, "message": str(error)},
                         ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
