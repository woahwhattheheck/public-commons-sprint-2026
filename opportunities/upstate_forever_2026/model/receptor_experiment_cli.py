"""Build source-water comparisons for all completed profiles in an experiment."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .common import read_json
from . import receptor_experiments
from .workspace import Workspace


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace", help="Existing scientific workspace containing native experiments")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("plan", "build"):
        command = commands.add_parser(name)
        command.add_argument("selection", help="JSON file containing experiment_id and receptor_spec")
        command.add_argument("--page-size", type=int, default=100)
    command = commands.add_parser("inspect")
    command.add_argument("comparison_id")
    command.add_argument("--full", action="store_true", help="Print every retained quantity and profile group")
    args = parser.parse_args(argv)
    try:
        workspace = Workspace(args.workspace)
        if args.command == "plan":
            result = receptor_experiments.plan(
                workspace, read_json(Path(args.selection)), page_size=args.page_size)
            output = {
                "id": result["id"], "experiment_id": result["selection"]["experiment_id"],
                "grid_id": result["grid_id"], "selected_cases": len(result["chosen_cases"]),
                "pending_cases": len(result["pending_cases"]),
                "groups": [{name: group[name] for name in
                            ("id", "profile_id", "profile_title", "baseline_run_id")}
                           | {"alternative_run_ids": [row["run_id"] for row in group["cases"]]}
                           for group in result["groups"]],
            }
        else:
            if args.command == "build":
                result = receptor_experiments.build(
                    workspace, read_json(Path(args.selection)), page_size=args.page_size)
            else:
                result = receptor_experiments.inspect(workspace, args.comparison_id)
            output = result if getattr(args, "full", False) else {
                name: result[name] for name in
                ("id", "experiment_id", "title", "state", "counts", "files")}
            output["directory"] = str(workspace.root / "receptor-experiments" / result["id"])
            output["profile_products"] = [{
                "profile_id": group["profile_id"], "profile_title": group["profile_title"],
                "baseline_run_id": group["baseline_run_id"], "state": group["state"],
                **({"inventory_id": group["inventory_id"]} if group["state"] == "complete"
                   else {"error": group["error"]})} for group in result["groups"]]
        print(json.dumps(output, sort_keys=True, ensure_ascii=False, allow_nan=False))
        return 0 if args.command != "build" or result["state"] == "complete" else 2
    except Exception as exc:
        print(json.dumps({"state": "failed", "type": type(exc).__name__, "message": str(exc)},
                         ensure_ascii=False, allow_nan=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
