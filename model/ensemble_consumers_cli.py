"""Use actual saved study runs with the original calibration and decision tools."""
from __future__ import annotations

import argparse
import json
import sys

from .common import read_json
from .workspace import Workspace
from . import ensemble_consumers as consumers, ensemble_references, ensemble_flow_support, ensemble_scientific_source, ensemble_study_source


def parser():
    top = argparse.ArgumentParser(description=__doc__)
    top.add_argument("--workspace", required=True)
    commands = top.add_subparsers(dest="command", required=True)

    commands.add_parser("annual-references", help="List imported original annual-load bindings and source periods")

    flow = commands.add_parser("flow-support", help="Replay original daily-flow support for one admitted annual import")
    flow.add_argument("--annual-import-id", required=True)
    flow.add_argument("--source-root", help="Complete retained original hydrology source directory")
    flow.add_argument("--node", help="Original Node.js interpreter")
    commands.add_parser("flow-support-sources", help="List registered exact-period support sources")

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
    reference = calibration.add_mutually_exclusive_group(required=True)
    reference.add_argument("--references",
                           help="Existing calibration JSON: original observation_id, catchments, groups, objective and periods")
    reference.add_argument("--annual-import-id", help="Completed original annual-reference import in this workspace")
    calibration.add_argument("--reference-options", help="Optional analysis choices JSON for the fixed original import binding")
    flow_choice = calibration.add_mutually_exclusive_group()
    flow_choice.add_argument("--flow-support-source", help="JSON retained source reference: collection_id, source_id")
    flow_choice.add_argument("--prepare-flow-support", action="store_true",
                             help="Replay and register original daily support before evaluation")
    calibration.add_argument("--flow-source-root", help="Complete original hydrology source directory for replay")
    calibration.add_argument("--prepare-only", action="store_true")
    calibration.add_argument("--standard-errors", type=float,
                             help="Use the existing published-standard-error sensitivity after completed calibration")

    resume = commands.add_parser("decision-resume", help="Reopen the same saved comparison/criteria handoff")
    resume.add_argument("--consumer-id", required=True)
    resume.add_argument("--summary-only", action="store_true")

    calibrate = commands.add_parser("calibration-resume", help="Continue the original calibration plan and source uncertainty")
    calibrate.add_argument("--consumer-id", required=True)
    calibrate.add_argument("--standard-errors", type=float)
    scientific = commands.add_parser("scientific-source",
        help="Register and render a saved calibration, its original references and exact flow support")
    scientific.add_argument("--consumer-id", required=True)
    scientific.add_argument("--source-only", action="store_true",
                            help="Register the complete typed source without rendering PDF/HTML")
    source_selection = commands.add_parser("scientific-selection",
        help="Append the prepared scientific source to an existing delivery selection")
    source_selection.add_argument("--consumer-id", required=True)
    source_selection.add_argument("--selection", help="Existing ordered delivery selection JSON")
    source_selection.add_argument("--output", help="Write the composed selection to this path")
    study_source = commands.add_parser("study-source",
        help="Publish the original native design contrasts, figures and complete numeric sources")
    study_source.add_argument("--ensemble-id", required=True)
    study_source.add_argument("--source-only", action="store_true")
    study_selection = commands.add_parser("study-selection",
        help="Append the retained native study source to an existing ordered scientific selection")
    study_selection.add_argument("--ensemble-id", required=True)
    study_selection.add_argument("--selection", help="Existing ordered report selection JSON")
    study_selection.add_argument("--output", help="Save this selected source order without overwriting another selection")
    return top


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        workspace = Workspace(args.workspace)
        if args.command == "study-source":
            result = ensemble_study_source.prepare(workspace, args.ensemble_id, render=not args.source_only)
        elif args.command == "study-selection":
            retained = ensemble_study_source.latest(workspace, args.ensemble_id, verify=True)
            if not retained or not retained.get("source"):
                raise ValueError("Prepare the saved native study source first")
            result = ensemble_scientific_source.delivery_selection(retained["source"],
                read_json(args.selection) if args.selection else None)
            if args.output:
                from pathlib import Path
                from .common import atomic_json
                atomic_json(Path(args.output), result, immutable=True)
        elif args.command == "scientific-source":
            result = ensemble_scientific_source.prepare(workspace, args.consumer_id,
                                                       render=not args.source_only)
        elif args.command == "scientific-selection":
            retained = ensemble_scientific_source.latest(workspace, args.consumer_id)
            if not retained or not retained.get("source"):
                raise ValueError("Prepare the saved scientific source first")
            result = ensemble_scientific_source.delivery_selection(retained["source"],
                read_json(args.selection) if args.selection else None)
            if args.output:
                from pathlib import Path
                from .common import atomic_json
                atomic_json(Path(args.output), result, immutable=True)
        elif args.command == "annual-references":
            result = ensemble_references.catalog(workspace, include_records=True)
        elif args.command == "flow-support":
            result = ensemble_flow_support.prepare(workspace, args.annual_import_id,
                                                   source_root=args.source_root, node=args.node)
        elif args.command == "flow-support-sources":
            result = ensemble_flow_support.catalog(workspace)
        elif args.command == "inspect":
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
                workspace, args.ensemble_id, read_json(args.references) if args.references else None,
                profile_ids=args.profile_id, pollutants=args.pollutant,
                reference_import_id=args.annual_import_id,
                reference_options=read_json(args.reference_options) if args.reference_options else None,
                flow_support_source=read_json(args.flow_support_source) if args.flow_support_source else None,
                prepare_flow_support=args.prepare_flow_support, flow_source_root=args.flow_source_root)
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
