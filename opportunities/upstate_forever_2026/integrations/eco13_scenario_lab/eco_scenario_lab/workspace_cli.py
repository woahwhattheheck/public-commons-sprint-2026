"""Current Workspace integration entrypoint: planning, adoption and completion."""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import sys

from .results import build_comparison, rank, render_report
from .store import ScenarioError, atomic_json, exclusive, read_json
from .workspace_driver import adopt_runs, binding_status, freeze_workspace, resume_workspace


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="eco-workspace-scenarios")
    commands = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (
        ("plan", "Freeze current native grid/profile/scenario selections"),
        ("adopt", "Reuse a matched set of completed original native runs"),
    ):
        item = commands.add_parser(name, help=help_text)
        item.add_argument("specification", type=Path)
        item.add_argument("workspace", type=Path)
        item.add_argument("--model-workspace", type=Path)
    item = commands.add_parser("run", help="Run/resume native selections and build the comparison report")
    item.add_argument("workspace", type=Path)
    item.add_argument("--model-workspace", type=Path)
    item.add_argument("--objectives", type=Path)
    item.add_argument("--budget-cents", type=int)
    item.add_argument("--tables-only", action="store_true",
                      help="Build native table reports without also creating reporting-mask difference rasters")
    item = commands.add_parser("status", help="Inspect the selected native run identities and states")
    item.add_argument("workspace", type=Path)
    item.add_argument("--model-workspace", type=Path)
    args = parser.parse_args(argv)
    if args.model_workspace is not None:
        args.model_workspace = args.model_workspace.resolve()
    try:
        if args.command in ("plan", "adopt"):
            function = freeze_workspace if args.command == "plan" else adopt_runs
            result = function(args.specification, args.workspace, model_workspace=args.model_workspace)
        elif args.command == "status":
            result = binding_status(args.workspace, model_workspace=args.model_workspace)
        else:
            if args.budget_cents is not None and args.objectives is None:
                raise ScenarioError("A budget screen needs explicit watershed/metric objectives")
            outcome = resume_workspace(args.workspace, model_workspace=args.model_workspace,
                                       compare_native=not args.tables_only)
            state = outcome["state"]
            active = [state["jobs"][key] for key in state.get("active_jobs", {}).values()]
            with exclusive(args.workspace):
                comparison = build_comparison(args.workspace)
                comparison["interpretation"] = (
                    "Paired complete model-domain watershed totals from the retained InVEST 3.20 NDR/SDR runs. "
                    "Exports are annual mass totals; each alternative uses its complete native selection. "
                    "The original Workspace comparison separately retains annual-mass raster changes within "
                    "the reporting mask. Parameter and forcing cases retain the same baseline land cover "
                    "and model-domain geometry."
                )
                atomic_json(args.workspace / "reports" / "comparisons.json", comparison)
                ranking = None
                ranking_status = {"state": "not_requested"}
                if args.objectives:
                    unpriced = [row["id"] for row in comparison["scenarios"] if row["cost_cents"] is None]
                    if unpriced:
                        ranking_status = {"state": "costs_required", "scenario_ids": unpriced}
                        comparison["interpretation"] += (
                            " Costs remain unpriced for " + ", ".join(unpriced) +
                            "; their scientific results are retained in this table."
                        )
                        atomic_json(args.workspace / "reports" / "comparisons.json", comparison)
                    else:
                        ranking = rank(comparison, read_json(args.objectives), args.budget_cents)
                        atomic_json(args.workspace / "reports" / "ranking.json", ranking)
                        ranking_status = {"state": "complete"}
                atomic_json(args.workspace / "reports" / "ranking-status.json", ranking_status)
                report = render_report(args.workspace, comparison, ranking)
            result = {"jobs": len(active),
                      "status_counts": dict(Counter(job["status"] for job in active)),
                      "paired_records": len(comparison["rows"]), "incomplete": comparison["incomplete"],
                      "report": str(report),
                      "native_bindings": str(args.workspace / "reports" / "workspace-bindings.json"),
                      "native_run_ids": sorted({v["run_id"] for v in outcome["workspace_bindings"]["native_runs"].values()}),
                      "ranking": ranking, "ranking_status": ranking_status}
            print(json.dumps(result, indent=2, allow_nan=False))
            return 2 if (comparison["incomplete"] or ranking_status["state"] == "costs_required" or
                         any(job["status"] != "complete" for job in active)) else 0
        print(json.dumps(result, indent=2, allow_nan=False))
        return 0
    except (ScenarioError, OSError, ValueError, KeyError, TypeError, ImportError) as exc:
        print(json.dumps({"error": type(exc).__name__, "message": str(exc)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
