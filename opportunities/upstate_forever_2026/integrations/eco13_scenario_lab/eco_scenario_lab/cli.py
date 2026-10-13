"""Customer and integration CLI; machine-readable outputs and meaningful exit codes."""
from __future__ import annotations
import argparse
from collections import Counter
import json
from pathlib import Path
import sys
from .engine import freeze, revise, run_workspace, verify_plan
from .results import build_comparison, inspect_table, rank, render_report
from .store import (ScenarioError, acquire, atomic_json, exclusive,
                    export_workspace, read_json, receive_workspace)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="eco-scenarios")
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("acquire", help="Receive explicit public source files")
    p.add_argument("manifest", type=Path); p.add_argument("destination", type=Path)
    p = commands.add_parser("plan", help="Freeze inputs and prepare all parcel scenarios")
    p.add_argument("specification", type=Path); p.add_argument("workspace", type=Path)
    p = commands.add_parser("run", help="Execute or resume the original native models")
    p.add_argument("workspace", type=Path); p.add_argument("--python")
    p = commands.add_parser("status", help="Show complete, failed and pending jobs")
    p.add_argument("workspace", type=Path)
    p = commands.add_parser("inspect", help="Inspect a native result table before binding fields")
    p.add_argument("table", type=Path); p.add_argument("--layer")
    p = commands.add_parser("compare", help="Create complete JSON, CSV and grayscale HTML reports")
    p.add_argument("workspace", type=Path)
    p.add_argument("--objectives", type=Path, help="JSON array of explicit watershed_id/metric pairs")
    p.add_argument("--budget-cents", type=int)
    p = commands.add_parser("export", help="Export all original inputs, jobs, reports and outputs")
    p.add_argument("workspace", type=Path); p.add_argument("archive", type=Path)
    p = commands.add_parser("receive", help="Verify and receive an independently editable workspace")
    p.add_argument("archive", type=Path); p.add_argument("workspace", type=Path)
    p = commands.add_parser("revise", help="Create an independent plan revision from retained inputs")
    p.add_argument("workspace", type=Path); p.add_argument("changes", type=Path)
    p.add_argument("destination", type=Path)
    args = parser.parse_args(argv)
    exit_code = 0
    try:
        if args.command == "acquire":
            result = acquire(args.manifest, args.destination)
        elif args.command == "plan":
            result = freeze(args.specification, args.workspace)
        elif args.command == "run":
            state = run_workspace(args.workspace, python=args.python)
            active = [state["jobs"][i] for i in state["active_jobs"].values()]
            result = {"jobs": len(active), "status_counts": dict(Counter(j["status"] for j in active))}
            exit_code = 2 if any(j["status"] != "complete" for j in active) else 0
        elif args.command == "status":
            with exclusive(args.workspace):
                plan, state = verify_plan(args.workspace)
                planned = (len(plan["scenarios"])+1)*len(plan["cases"])*len(plan["models"])
                active = [state["jobs"][i] for i in state.get("active_jobs", {}).values()]
                result = {"project_id": plan["project_id"], "setup_id": plan["setup_id"],
                          "plan_sha256": plan["plan_sha256"], "planned_native_runs": planned,
                          "pending": planned-len(active), "preflight": state.get("preflight"),
                          "status_counts": dict(Counter(j["status"] for j in active)),
                          "jobs": active}
        elif args.command == "inspect":
            result = inspect_table(args.table, args.layer)
        elif args.command == "compare":
            with exclusive(args.workspace):
                verify_plan(args.workspace)
                comparison = build_comparison(args.workspace)
                ranking = None
                if args.objectives:
                    ranking = rank(comparison, read_json(args.objectives), args.budget_cents)
                    atomic_json(args.workspace / "reports" / "ranking.json", ranking)
                elif args.budget_cents is not None:
                    raise ScenarioError("A budget screen needs explicit objectives")
                report = render_report(args.workspace, comparison, ranking)
                result = {"report": str(report), "paired_records": len(comparison["rows"]),
                          "incomplete": comparison["incomplete"], "ranking": ranking}
                exit_code = 2 if comparison["incomplete"] else 0
        elif args.command == "export":
            result = export_workspace(args.workspace, args.archive)
        elif args.command == "receive":
            result = receive_workspace(args.archive, args.workspace)
        elif args.command == "revise":
            result = revise(args.workspace, args.destination, args.changes)
        else:
            raise ScenarioError("Unknown operation")
        print(json.dumps(result, indent=2, allow_nan=False))
    except (ScenarioError, OSError, KeyError, json.JSONDecodeError) as exc:
        print(json.dumps({"error": type(exc).__name__, "message": str(exc)}), file=sys.stderr)
        return 1
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
