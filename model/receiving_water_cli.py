#!/usr/bin/env python3
"""Prepare, compare and export retained Upper Savannah receiving waters."""
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
from . import receiving_waters, receiving_water_delivery


def parser():
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument("--workspace", type=Path, required=True)
    operations = command.add_subparsers(dest="operation", required=True)
    for name, help_text in (
        ("prepare", "Create a source-only receptor plan"),
        ("profile", "Use the shared utility-focus receptor profile"),
        ("analyze", "Analyze completed original baseline and land-cover runs"),
        ("build", "Resolve a plan, analyze runs and export a complete receiving-water delivery"),
    ):
        selected = operations.add_parser(name, help=help_text)
        selected.add_argument("selection", type=Path)
        if name == "profile":
            selected.add_argument("--grid-id")
        if name == "build":
            selected.add_argument("--output-dir", type=Path)
    for name in ("plan", "analysis", "layers"):
        operations.add_parser(name).add_argument("id")
    listing = operations.add_parser("list")
    listing.add_argument("kind", choices=("plans", "analyses", "all"), default="all", nargs="?")
    export = operations.add_parser("export")
    export.add_argument("analysis_id")
    export.add_argument("output_dir", type=Path)
    return command


def main(argv=None):
    args = parser().parse_args(argv)
    workspace = Workspace(args.workspace)
    progress = lambda value: print(json.dumps(value, sort_keys=True), file=sys.stderr, flush=True)
    if args.operation == "prepare":
        result = receiving_waters.prepare(workspace, read_json(args.selection))
    elif args.operation == "profile":
        result = receiving_waters.prepare_receptor_spec(
            workspace, read_json(args.selection), grid_id=args.grid_id,
        )
    elif args.operation == "analyze":
        result = receiving_waters.analyze(workspace, read_json(args.selection), progress=progress)
    elif args.operation == "build":
        selection = read_json(args.selection)
        result = receiving_water_delivery.selected_analysis(workspace, selection, progress=progress)
        if result is None:
            raise ValueError("The build selection requires its receiving_waters source plan or analysis")
        if args.output_dir:
            result = receiving_water_delivery.export(workspace, result["id"], args.output_dir)
    elif args.operation == "plan":
        result = receiving_waters.inspect_plan(workspace, args.id)
    elif args.operation == "analysis":
        result = receiving_waters.inspect(workspace, args.id)
    elif args.operation == "layers":
        result = receiving_waters.delivery_layers(workspace, args.id)
    elif args.operation == "export":
        result = receiving_water_delivery.export(workspace, args.analysis_id, args.output_dir)
    else:
        result = {}
        if args.kind in ("plans", "all"):
            result["plans"] = receiving_waters.list_plans(workspace)
        if args.kind in ("analyses", "all"):
            result["analyses"] = receiving_waters.list_analyses(workspace)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
