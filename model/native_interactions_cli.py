"""Command-line conservation coalition workflow over retained native runs."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .common import atomic_json
from .native_interactions import (
    analyze_plan, apply_plan, get_plan, get_result, list_plans, preview, save_plan,
)
from .workspace import Workspace


def _selection(filename):
    if filename == "-":
        value = json.load(sys.stdin)
    else:
        with Path(filename).open("r", encoding="utf-8-sig") as stream:
            value = json.load(stream)
    if not isinstance(value, dict):
        raise ValueError("The selection must be a JSON object")
    return value


def _reuse_runs(filename):
    if filename is None:
        return None
    if filename == "-":
        value = json.load(sys.stdin)
    else:
        with Path(filename).open("r", encoding="utf-8-sig") as stream:
            value = json.load(stream)
    if not isinstance(value, list):
        raise ValueError("The retained reuse-run selection must be a JSON array of run IDs")
    return value


def _parser():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--workspace", type=Path, default=argparse.SUPPRESS,
                        help="Existing retained Upper Savannah workspace")
    common.add_argument("--output", type=Path, default=argparse.SUPPRESS,
                        help="Write exact JSON to this file instead of stdout")
    parser = argparse.ArgumentParser(
        description="Prepare and analyze native conservation action coalitions.",
        parents=[common])
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("preview", "plan"):
        command = commands.add_parser(name, parents=[common])
        command.add_argument(
            "--selection", required=True,
            help="Selection JSON file; use '-' to read the object from stdin")
    commands.add_parser("list", parents=[common])
    for name in ("show", "apply", "analyze"):
        command = commands.add_parser(name, parents=[common])
        command.add_argument("plan_id")
        if name == "apply":
            command.add_argument(
                "--run-models", action="store_true",
                help="Resume original native NDR/SDR runs and analyze their completed outputs")
            command.add_argument(
                "--workers", type=int, default=1,
                help="Explicit native process count; preparation and analysis remain serial")
            command.add_argument(
                "--reuse-runs", help="Optional JSON array of original native donor run IDs")
    command = commands.add_parser("result", parents=[common])
    command.add_argument("result_id")
    return parser


def main(argv=None):
    parser = _parser()
    args = parser.parse_args(argv)
    if not hasattr(args, "workspace"):
        parser.error("--workspace is required")
    try:
        workspace = Workspace(args.workspace)
        if args.command == "preview":
            value = preview(workspace, _selection(args.selection))
        elif args.command == "plan":
            value = save_plan(workspace, _selection(args.selection))
        elif args.command == "list":
            value = list_plans(workspace)
        elif args.command == "show":
            value = get_plan(workspace, args.plan_id)
        elif args.command == "apply":
            value = apply_plan(
                workspace, args.plan_id, run_models=args.run_models,
                workers=args.workers, reuse_source_run_ids=_reuse_runs(args.reuse_runs))
        elif args.command == "analyze":
            value = analyze_plan(workspace, args.plan_id)
        elif args.command == "result":
            value = get_result(workspace, args.result_id)
        else:
            raise ValueError("Unknown command")
        if hasattr(args, "output"):
            atomic_json(args.output, value)
        else:
            print(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False))
        return 1 if isinstance(value, dict) and value.get("state") == "failed" else 0
    except (ValueError, OSError, RuntimeError, KeyError) as exc:
        print(json.dumps({
            "error": type(exc).__name__, "message": str(exc),
            "command": args.command,
        }, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
