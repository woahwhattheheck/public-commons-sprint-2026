"""Command-line access to persisted scientific diagnostics.

Analyze writes a portable diagnostics_bundle.zip.  Its verified descriptor is
returned in artifacts.analysis_zip; inspect and list only read retained files.

Examples:
  python -m model.diagnostics_cli analyze --workspace /data/upstate --selection selection.json
  python -m model.diagnostics_cli inspect --workspace /data/upstate --id CONTENT_ID
  python -m model.diagnostics_cli list --workspace /data/upstate
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .workspace import Workspace
from . import experiment_diagnostics


def main(argv=None):
    parser = argparse.ArgumentParser(description="Original-run scientific diagnostics")
    commands = parser.add_subparsers(dest="command", required=True)
    analyze = commands.add_parser("analyze", help="Analyze exact original run IDs")
    analyze.add_argument("--workspace", required=True, type=Path)
    analyze.add_argument("--selection", required=True, type=Path)
    inspect = commands.add_parser("inspect", help="Read a persisted diagnostic snapshot")
    inspect.add_argument("--workspace", required=True, type=Path)
    inspect.add_argument("--id", required=True)
    listing = commands.add_parser("list", help="List persisted diagnostic snapshots")
    listing.add_argument("--workspace", required=True, type=Path)
    arguments = parser.parse_args(argv)
    try:
        ws = Workspace(arguments.workspace)
        if arguments.command == "analyze":
            with arguments.selection.open(encoding="utf-8") as handle:
                selection = json.load(handle)
            result = experiment_diagnostics.analyze(ws, selection)
        elif arguments.command == "inspect":
            result = experiment_diagnostics.inspect(ws, arguments.id)
        else:
            result = experiment_diagnostics.listing(ws)
        sys.stdout.write(json.dumps(result, sort_keys=True, allow_nan=False) + "\n")
        return 0
    except Exception as exc:
        error = {"error": {"type": type(exc).__name__, "message": str(exc)},
                 "command": arguments.command}
        sys.stderr.write(json.dumps(error, sort_keys=True, allow_nan=False) + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
