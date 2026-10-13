"""Use actual saved study runs with the original calibration and decision tools."""
from __future__ import annotations

import argparse
import json
import sys

from .common import read_json
from .workspace import Workspace
from . import ensemble_consumers as consumers


def parser():
    top = argparse.ArgumentParser(description=__doc__)
    top.add_argument("--workspace", required=True)
    commands = top.add_subparsers(dest="command", required=True)

    catalog = commands.add_parser("inspect", help="Read actual saved run states and usable scientific cohorts")
    catalog.add_argument("--ensemble-id", required=True)
    catalog.add_argument("--profile-id", action="append")
    catalog.add_argument("--scenario-id", action="append")

    decision = commands.add_parser("decision", help="Prepare and export the existing decision desk from completed study members")
    decision.add_argument("--ensemble-id", required=True)
    decision.add_argument("--profile-id", action="append")
    decision.add_argument("--scenario-id", action="append")
    decision.add_argument("--reference-profile-id")
    decision.add_argument("--pollutant", action="append", choices=consumers.MODELED_OUTPUTS)
    decision.add_argument("--criteria", help="Original title, sourced costs, targets, budget and decision notes JSON")
    decision.add_argument("--prepare-only", action="store_true")
    decision.add_argument("--summary-only", action="store_true",
                          help="Export retained comparison sums; original decision producer leaves shortlist unsupported")

    calibration = commands.add_parser("calibration", help="Evaluate completed baseline candidates against selected original observations")
    calibration.add_argument("--ensemble-id", required=True)
    calibration.add_argument("--profile-id", action="append")
    calibration.add_argument("--pollutant", action="append", choices=consumers.MODELED_OUTPUTS)
    calibration.add_argument("--references", required=True,
                             help="Existing calibration JSON: original observation_id, catchments, groups, objective and periods")
    calibration.add_argument("--prepare-only", action="store_true")
    calibration.add_argument("--standard-errors", type=float,
                             help="Use the existing published-standard-error sensitivity after completed calibration")

    resume = commands.add_parser("decision-resume", help="Reopen the same saved comparison/criteria handoff")
    resume.add_argument("--consumer-id", required=True)
    resume.add_argument("--summary-only", action="store_true")

    calibrate = commands.add_parser("calibration-resume", help="Continue the original calibration plan and source uncertainty")
    calibrate.add_argument("--consumer-id", required=True)
    calibrate.add_argument("--standard-errors", type=float)
    return top


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        workspace = Workspace(args.workspace)
        if args.command == "inspect":
            result = consumers.inspect(workspace, args.ensemble_id,
                                       profile_ids=args.profile_id, scenario_ids=args.scenario_id)
        elif args.command == "decision":
            plan = consumers.prepare_decision(
                workspace, args.ensemble_id, profile_ids=args.profile_id,
                scenario_ids=args.scenario_id, reference_profile_id=args.reference_profile_id,
                pollutants=args.pollutant, criteria=read_json(args.criteria) if args.criteria else None)
            result = {"plan": plan}
            if not args.prepare_only:
                result["result"] = consumers.build_decision(workspace, plan["id"], summary_only=args.summary_only)
        elif args.command == "calibration":
            plan = consumers.prepare_calibration(
                workspace, args.ensemble_id, read_json(args.references),
                profile_ids=args.profile_id, pollutants=args.pollutant)
            result = {"plan": plan}
            if not args.prepare_only:
                result["result"] = consumers.run_calibration(
                    workspace, plan["id"], standard_errors=args.standard_errors)
        elif args.command == "decision-resume":
            result = consumers.build_decision(workspace, args.consumer_id, summary_only=args.summary_only)
        else:
            result = consumers.run_calibration(workspace, args.consumer_id,
                                               standard_errors=args.standard_errors)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)},
                         ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
