"""Operate the complete Upper Savannah scenario decision companion."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys

if __package__:
    from . import decision_analysis as decisions
else:
    import decision_analysis as decisions


def parser():
    top = argparse.ArgumentParser(description=__doc__)
    commands = top.add_subparsers(dest="command", required=True)
    inspect = commands.add_parser("inspect", help="List actual completed comparison choices")
    inspect.add_argument("--workspace", required=True)

    selection = commands.add_parser("selection", help="Prepare a source-bound selection from an existing comparison")
    selection.add_argument("--workspace", required=True)
    selection.add_argument("--comparison-id", required=True)
    selection.add_argument("--title", default="Upper Savannah scenario decisions")
    selection.add_argument("--output", required=True)
    selection.add_argument("--pollutant", action="append", choices=decisions.METRICS,
                           help="Select an actual common output; repeat for more than one pollutant")
    selection.add_argument("--sensitivity-comparison-id", action="append", default=[],
                           help="Retain an existing same-grid/baseline comparison from another profile")

    build = commands.add_parser("build", help="Analyze existing native rasters and export the complete decision desk")
    build.add_argument("--workspace", required=True)
    build.add_argument("--selection", required=True)
    build.add_argument("--output", required=True)
    build.add_argument("--template")
    build.add_argument("--summary-only", action="store_true",
                       help="Export original recorded sums without computing common-cell percentages or a supported shortlist")

    packet = commands.add_parser("packet", help="Analyze an actual compatible physical-results packet")
    packet.add_argument("--input", required=True)
    packet.add_argument("--selection", required=True)
    packet.add_argument("--output", required=True)
    packet.add_argument("--template")

    native_inspect = commands.add_parser("scenario-inspect", help="List zones and scenarios in an original native scenario report")
    native_inspect.add_argument("--report", required=True)

    native_selection = commands.add_parser("scenario-selection", help="Prepare exact decision inputs for one original native reporting zone")
    native_selection.add_argument("--report", required=True)
    native_selection.add_argument("--zone-id", required=True)
    native_selection.add_argument("--title")
    native_selection.add_argument("--output", required=True)
    native_selection.add_argument("--pollutant", action="append", choices=decisions.METRICS,
                                  help="Narrow the original reporting zone to these actual outputs")

    native_report = commands.add_parser("scenario-report", help="Use actual native zone masses for the complete economic decision desk")
    native_report.add_argument("--report", required=True)
    native_report.add_argument("--zone-id", required=True)
    native_report.add_argument("--selection", required=True)
    native_report.add_argument("--output", required=True)
    native_report.add_argument("--template")

    export = commands.add_parser("export", help="Reopen an existing complete report with the decision desk")
    export.add_argument("--report", required=True)
    export.add_argument("--output", required=True)
    export.add_argument("--template")
    return top


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command == "inspect":
            result = decisions.inspect_workspace(args.workspace)
        elif args.command == "scenario-inspect":
            result = decisions.inspect_scenario_report(args.report)
        elif args.command == "scenario-selection":
            packet = decisions.scenario_report_packet(args.report, args.zone_id)
            group, source = packet["comparisons"][0], packet["physical_source"]
            value = {"schema": decisions.SELECTION_SCHEMA,
                     "title": args.title or source["title"] + ": " + source["zone"]["title"],
                     "comparison_id": group["id"], "costs": [], "targets": {},
                     "sensitivity_comparison_ids": [], "notes": [],
                     "top_parcels_per_pollutant": 10}
            if args.pollutant is not None:
                value["pollutants"] = list(decisions._pollutants(args.pollutant))
                decisions._scoped_packet(packet, value)
            path = Path(args.output).resolve()
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("x", encoding="utf-8") as stream:
                json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
                stream.write("\n")
            result = {"selection": str(path), "producer_report_id": source["id"],
                      "reporting_zone": source["zone"], "comparison_id": group["id"],
                      "alternatives": [{k: item[k] for k in ("run_id", "scenario_id", "label")}
                                       for item in group["alternatives"]],
                      "unavailable_alternatives": packet["unavailable_alternatives"],
                      "cost_fields": ["run_id", "currency", "capital", "annual_operating",
                                      "horizon_years", "discount_rate",
                                      "source.title", "source.uri", "source.as_of"]}
        elif args.command == "selection":
            choices = decisions.inspect_workspace(args.workspace)
            match = next((item for item in choices["comparisons"]
                          if item["comparison_id"] == args.comparison_id), None)
            if not match:
                raise decisions.DecisionError("Select an existing comparison from inspect")
            value = {"schema": decisions.SELECTION_SCHEMA, "title": args.title,
                     "comparison_id": match["comparison_id"], "costs": [],
                     "targets": {}, "sensitivity_comparison_ids": args.sensitivity_comparison_id,
                     "top_parcels_per_pollutant": 10, "notes": []}
            if args.pollutant is not None:
                value["pollutants"] = list(decisions._pollutants(args.pollutant))
            # The metadata/summary path resolves actual common scope before any
            # exclusive selection file is published; no native runs are queued.
            packet = decisions.workspace_packet(args.workspace, value, summary_only=True)
            value["pollutants"] = packet["pollutant_selection"]["selected"]
            decisions._validate_packet(packet, value)
            path = Path(args.output).resolve()
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("x", encoding="utf-8") as stream:
                json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
                stream.write("\n")
            result = {"selection": str(path), "comparison": match,
                      "cost_fields": ["run_id", "currency", "capital", "annual_operating",
                                      "horizon_years", "discount_rate",
                                      "source.title", "source.uri", "source.as_of"]}
        elif args.command == "build":
            result = decisions.build(args.workspace, decisions.read_json(args.selection), args.output,
                                     template=args.template, summary_only=args.summary_only)
        elif args.command == "scenario-report":
            packet = decisions.scenario_report_packet(args.report, args.zone_id)
            report = decisions.analyze_packet(packet, decisions.read_json(args.selection))
            result = decisions.export_report(report, args.output, template=args.template,
                                             input_packet=packet)
        elif args.command == "packet":
            packet = decisions.read_json(args.input)
            report = decisions.analyze_packet(packet, decisions.read_json(args.selection))
            result = decisions.export_report(report, args.output, template=args.template,
                                             input_packet=packet)
        else:
            result = decisions.export_report(decisions.read_json(args.report), args.output,
                                             template=args.template)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (decisions.DecisionError, OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)},
                         ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
