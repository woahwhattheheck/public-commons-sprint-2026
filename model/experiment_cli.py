"""Prepare, run, resume and export source-bound native experiments.

Run from the product root:
    python -B -m model.experiment_cli --workspace /owned/project preview selection.json
    python -B -m model.experiment_cli --workspace /owned/project prepare selection.json
    python -B -m model.experiment_cli --workspace /owned/project run EXPERIMENT_ID
    python -B -m model.experiment_cli --workspace /owned/project sync EXPERIMENT_ID
    python -B -m model.experiment_cli --workspace /owned/project programme EXPERIMENT_ID
    python -B -m model.experiment_cli --workspace /owned/project inspect EXPERIMENT_ID
    python -B -m model.experiment_cli --workspace /owned/project summary EXPERIMENT_ID
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .workspace import Workspace
from . import experiments


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list")
    axes = commands.add_parser("axes")
    axes.add_argument("--models", nargs="+", choices=("ndr", "sdr"))
    for name in ("preview", "prepare", "execute"):
        child = commands.add_parser(name)
        child.add_argument("selection", type=Path)
    for name in ("run", "sync", "programme", "summary"):
        child = commands.add_parser(name)
        child.add_argument("experiment_id")
    child = commands.add_parser("inspect")
    child.add_argument("experiment_id")
    child.add_argument("--offset", type=int, default=0)
    child.add_argument("--limit", type=int, default=100)
    args = parser.parse_args(argv)
    try:
        workspace = Workspace(args.workspace)
        if args.command == "axes":
            result = experiments.supported_axes(args.models)
        elif args.command == "list":
            result = experiments.list_experiments(workspace)
        elif args.command in ("preview", "prepare", "execute"):
            selection = json.loads(args.selection.read_text(encoding="utf-8-sig"))
            if args.command == "preview":
                result = experiments.preview(workspace, selection)
            else:
                result = experiments.prepare(workspace, selection)
                if args.command == "execute":
                    result = experiments.execute(workspace, result["id"])
        elif args.command in ("run", "sync"):
            result = experiments.execute(workspace, args.experiment_id,
                                         completed_only=args.command == "sync")
        elif args.command == "programme":
            from .programme_experiments import create
            result = create(workspace, args.experiment_id)
        elif args.command == "inspect":
            result = experiments.inspect(workspace, args.experiment_id,
                                         offset=args.offset, limit=args.limit)
        else:
            result = experiments.summarize(workspace, args.experiment_id)
        print(json.dumps(result, sort_keys=True, ensure_ascii=False, allow_nan=False))
        return 0
    except Exception as exc:
        print(json.dumps({"state": "failed", "type": type(exc).__name__,
                          "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
