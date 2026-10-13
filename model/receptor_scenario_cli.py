"""Prepare original watershed areas or save an explicit land-cover scenario."""
from __future__ import annotations
import argparse
import json
from pathlib import Path

from .common import read_json
from .receptor_scenarios import build, save_scenario
from .workspace import Workspace


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace", type=Path)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare", help="Retain original polygons and analysis source-area handoff")
    prepare.add_argument("--network", required=True)
    prepare.add_argument("--area", action="append", dest="areas")
    prepare.add_argument("--title")
    scenario = commands.add_parser("scenario", help="Save exact ordered land-cover choices")
    scenario.add_argument("--preparation", required=True)
    scenario.add_argument("--selection", type=Path, required=True)
    args = parser.parse_args()
    workspace = Workspace(args.workspace)
    if args.command == "prepare":
        selected = {"network_result_id": args.network}
        if args.areas is not None:
            selected["receptor_ids"] = args.areas
        if args.title is not None:
            selected["title"] = args.title
        result = build(workspace, selected)
    else:
        result = save_scenario(workspace, args.preparation, read_json(args.selection))
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
