"""Run and export source-bound watershed studies through the original Workspace."""
from __future__ import annotations

import argparse
import json
import sys

from .ensembles import Ensembles, parameter_catalog
from .workspace import Workspace


def _print(value, stream=sys.stdout):
    json.dump(value, stream, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False)
    stream.write("\n")
    stream.flush()


def _study_arguments(parser):
    parser.add_argument("study_id", help="An actual study ID from catalog or context")
    parser.add_argument("--grid-id", required=True, help="Retained prepared grid ID")
    parser.add_argument("--baseline-scenario-id", required=True, help="Retained baseline scenario ID")
    parser.add_argument("--base-profile-id", dest="base_profile_ids", action="append", required=True,
                        help="Retained source-backed profile ID; repeat to compare more profiles")
    parser.add_argument("--alternative-scenario-id", dest="alternative_scenario_ids",
                        action="append", default=[],
                        help="Retained land-cover alternative ID; omit for parameter-only sensitivity")
    parser.add_argument("--title", help="Study title; defaults to the selected catalogue title")
    parser.add_argument("--reason", help="Study question; defaults to the sourced catalogue question")


def _execution_arguments(parser):
    parser.add_argument("--stop-on-error", action="store_true",
                        help="Stop the native run loop at its first failure, then export completed results")
    parser.add_argument("--with-raster-products", action="store_true",
                        help="Also build and export original paired raster products for every saved alternative")


def _study_values(args):
    return {name: getattr(args, name) for name in (
        "grid_id", "baseline_scenario_id", "base_profile_ids",
        "alternative_scenario_ids", "title", "reason")}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", help="Existing complete watershed Workspace directory")
    parser.add_argument("--quiet-progress", action="store_true",
                        help="Suppress progress notices on stderr; stdout remains one final JSON result")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("catalog", help="Print native parameter meanings, units and original source references")
    commands.add_parser("context", help="Print actual saved grids, scenarios, profiles, native runs and studies")
    for name in ("preview", "prepare"):
        sub = commands.add_parser(name)
        sub.add_argument("design", help="Source-bound ensemble design JSON")
    sub = commands.add_parser("study-design", help="Print a validated design JSON from a sourced catalogue study")
    _study_arguments(sub)
    sub = commands.add_parser("run-study", help="Prepare, execute and export a sourced study using saved selections")
    _study_arguments(sub)
    _execution_arguments(sub)
    commands.add_parser("list")
    for name in ("inspect", "run", "report", "continue", "export", "cohort"):
        sub = commands.add_parser(name)
        sub.add_argument("ensemble_id")
        if name == "run":
            sub.add_argument("--stop-on-error", action="store_true",
                             help="Return at the first native failure; completed stages remain reusable")
        if name == "report":
            sub.add_argument("--refresh", action="store_true",
                             help="Compute missing paired summaries from completed native outputs")
        if name == "continue":
            _execution_arguments(sub)
        if name == "export":
            sub.add_argument("--with-raster-products", action="store_true",
                             help="Build/export paired rasters from completed original runs")
        if name == "cohort":
            sub.add_argument("--scenario-id", required=True,
                             help="Retained alternative belonging to this saved ensemble")
    sub = commands.add_parser("scenario-catalog",
                              help="List original scenarios and profiles for a direct comparison")
    sub.add_argument("ensemble_id")
    sub = commands.add_parser("scenario-report",
                              help="Prepare a direct report from completed same-profile native runs")
    sub.add_argument("ensemble_id")
    sub.add_argument("--reference-scenario-id", required=True,
                     help="Original saved scenario supplying the paired reference")
    sub.add_argument("--alternative-scenario-id", dest="alternative_scenario_ids",
                     action="append", required=True,
                     help="Original alternative to compare with the reference; repeat as needed")
    sub.add_argument("--coefficient-evidence",
                     help="Optional JSON with original evidence_ids and range_ids")
    sub.add_argument("--without-render", action="store_true",
                     help="Retain the original scientific source without rendering PDF/HTML")
    sub = commands.add_parser("scenario-report-inspect",
                              help="Verify and reopen one exact retained direct-report source edition")
    sub.add_argument("ensemble_id")
    sub.add_argument("source_operation_id",
                     help="Exact source operation ID returned by scenario-report")
    args = parser.parse_args(argv)

    def progress(value):
        if not args.quiet_progress:
            sys.stderr.write(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                        allow_nan=False) + "\n")
            sys.stderr.flush()

    if args.command != "catalog" and not args.workspace:
        parser.error("--workspace is required for this operation")

    try:
        if args.command == "catalog":
            result = parameter_catalog()
        else:
            workspace = Workspace(args.workspace)
            ensemble = Ensembles(workspace)
            if args.command in ("preview", "prepare"):
                with open(args.design, encoding="utf-8") as stream:
                    design = json.load(stream)
                result = getattr(ensemble, args.command)(design)
            elif args.command == "list":
                result = ensemble.list()
            elif args.command == "inspect":
                result = ensemble.inspect(args.ensemble_id)
            elif args.command == "run":
                result = ensemble.run(args.ensemble_id, continue_on_error=not args.stop_on_error)
            elif args.command == "report":
                result = ensemble.report_data(args.ensemble_id, refresh=args.refresh)
            elif args.command == "scenario-catalog":
                from .ensemble_scenario_contrasts import catalog
                result = catalog(workspace, args.ensemble_id)
            elif args.command == "scenario-report":
                from .ensemble_study_source import prepare
                evidence = None
                if args.coefficient_evidence:
                    with open(args.coefficient_evidence, encoding="utf-8-sig") as stream:
                        evidence = json.load(stream)
                    if not isinstance(evidence, dict):
                        raise ValueError("Coefficient evidence must be an original selection object")
                result = prepare(workspace, args.ensemble_id,
                                 scenario_reference={
                                     "reference_scenario_id": args.reference_scenario_id,
                                     "alternative_scenario_ids": args.alternative_scenario_ids},
                                 coefficient_evidence=evidence,
                                 render=not args.without_render)
            elif args.command == "scenario-report-inspect":
                from .ensemble_study_source import latest
                result = latest(workspace, args.ensemble_id, verify=True,
                                scenario_contrast=True,
                                source_operation_id=args.source_operation_id)
                if not result or not result.get("selection", {}).get("scenario_reference"):
                    raise ValueError("Choose an exact saved direct scenario report source")
            elif args.command == "context":
                from .ensemble_operations import workspace_context
                result = workspace_context(workspace)
            elif args.command in ("study-design", "run-study"):
                from .ensemble_operations import study_design, run_study
                if args.command == "study-design":
                    selected = study_design(workspace, args.study_id, **_study_values(args))
                    result = selected["spec"]
                    preview = selected["preview"]
                    progress({"phase": "design", "study_id": args.study_id,
                              **{name: preview[name] for name in (
                                  "grid_id", "member_count", "run_count", "landcover_pair_count",
                                  "parameter_pair_count", "selected_models", "expected_artifacts")}})
                else:
                    result = run_study(workspace, args.study_id, **_study_values(args),
                                       continue_on_error=not args.stop_on_error,
                                       with_raster_products=args.with_raster_products,
                                       on_progress=progress)
            elif args.command == "cohort":
                from .paired_ensemble.designs import design_cohort
                result = design_cohort(workspace, args.ensemble_id, args.scenario_id)
            else:
                from .ensemble_operations import operation
                result = operation(workspace, args.ensemble_id,
                                   run_native=args.command == "continue",
                                   continue_on_error=not getattr(args, "stop_on_error", False),
                                   with_raster_products=args.with_raster_products,
                                   resume_raster_products=args.command == "continue",
                                   on_progress=progress)
    except KeyboardInterrupt:
        _print({"schema": "upstate.ensemble-command-error/v1", "command": args.command,
                "state": "interrupted", "message": "Interrupted; reopen the retained ensemble and native progress."})
        return 130
    except Exception as exc:
        _print({"schema": "upstate.ensemble-command-error/v1", "command": args.command,
                "state": "failed", "type": type(exc).__name__, "message": str(exc)})
        return 2

    _print(result)
    if args.command in ("run", "run-study", "continue", "export") and result["state"] != "complete":
        return 2
    if args.command == "report" and result.get("errors"):
        return 2
    if args.command == "scenario-report":
        expected_state = "source_ready" if args.without_render else "complete"
        if result.get("state") not in {expected_state, "complete"} or result.get("native_state") != "complete":
            return 2
    if args.command == "cohort" and not result["ready"]:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
