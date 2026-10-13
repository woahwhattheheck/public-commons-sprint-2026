#!/usr/bin/env python3
"""Use the original Workspace for retained spatial forcing studies and native runs."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))

from model.common import atomic_json, read_json
from model.workspace import Workspace
from model import climate_forcing


def selection(args):
    if args.selection:
        return read_json(Path(args.selection))
    required = ("baseline_run", "title", "purpose", "case_id", "case_label")
    missing = [name for name in required if not getattr(args, name, None)]
    if missing:
        raise ValueError("Use --selection or supply " + ", ".join("--" + name.replace("_", "-") for name in missing))
    overrides = {}
    for role, prefix in (("PRECIPITATION", "precipitation"), ("R_FACTOR", "erosivity")):
        fields = {key: getattr(args, prefix + "_" + key) for key in
                  ("collection", "source", "period", "basis", "interpretation")}
        if any(value is not None for value in fields.values()):
            if not all(value for value in fields.values()):
                raise ValueError("Retain the complete --" + prefix + " source and period interpretation")
            overrides[role] = {
                "source_collection_id": fields["collection"], "source_id": fields["source"],
                "period_label": fields["period"], "temporal_basis": fields["basis"],
                "interpretation": fields["interpretation"]}
    if not overrides:
        raise ValueError("Select an actual retained precipitation/runoff or erosivity edition")
    return {"title": args.title, "purpose": args.purpose,
            "baseline_run_id": args.baseline_run,
            "cases": [{"id": args.case_id, "label": args.case_label, "overrides": overrides}],
            "reporting_areas": [], "difference_maps": not args.no_maps}


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--workspace", required=True, help="Existing original scientific Workspace; never created by this tool")
    result.add_argument("--output", help="Write the complete returned native record to this JSON file")
    commands = result.add_subparsers(dest="command", required=True)
    commands.add_parser("catalog", help="List retained completed baselines, typed forcing sources and studies")
    for name in ("preview", "prepare", "course"):
        child = commands.add_parser(name, help={
            "preview": "Read immutable source selections without creating source views or native runs",
            "prepare": "Prepare exact forcing grids and original native run records",
            "course": "Prepare, explicitly execute alternatives, save the native comparison and verify reopening"}[name])
        child.add_argument("--selection", help="Complete saved selection JSON, including multiple cases/reporting polygons")
        child.add_argument("--expected-id", help="Require this exact previously reviewed preview identity")
        child.add_argument("--baseline-run")
        child.add_argument("--title")
        child.add_argument("--purpose")
        child.add_argument("--case-id")
        child.add_argument("--case-label")
        child.add_argument("--no-maps", action="store_true", help="Retain native numerical report without copying full output/difference TIFFs")
        for prefix in ("precipitation", "erosivity"):
            for field in ("collection", "source", "period", "basis", "interpretation"):
                child.add_argument("--" + prefix + "-" + field)
        if name == "course":
            child.add_argument("--execute-alternatives", action="store_true",
                               help="Explicitly execute only this study's prepared alternatives through Workspace.run")
    for name in ("show", "run", "report", "reopen"):
        child = commands.add_parser(name)
        child.add_argument("--study", required=True)
        if name == "run":
            child.add_argument("--case", required=True, help="One prepared alternative case ID; baseline execution is prohibited")
        if name == "reopen":
            child.add_argument("--report-id", help="Exact saved report; otherwise original latest report")
            child.add_argument("--expected-project", help="Require original project UUID after copying/restoring the Workspace")
    commands.add_parser("verify", help="Verify all retained forcing studies, reports, downloads and original source records")
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    workspace = Workspace(Path(args.workspace), create=False)
    if args.command == "catalog":
        value = climate_forcing.catalog(workspace)
    elif args.command in ("preview", "prepare", "course"):
        chosen = selection(args)
        shown = climate_forcing.preview(workspace, chosen)
        if args.expected_id is not None and shown["id"] != args.expected_id:
            raise ValueError("The selected original preview differs from --expected-id")
        if args.command == "preview":
            value = shown
        else:
            if args.command == "course" and not args.execute_alternatives:
                raise ValueError("Use prepare first, or explicitly choose course --execute-alternatives")
            value = climate_forcing.prepare(workspace, chosen, expected_id=shown["id"])
            if args.command == "course":
                for case in value["cases"]:
                    if not case["baseline"]:
                        climate_forcing.run_case(workspace, value["id"], case["id"])
                report = climate_forcing.report(workspace, value["id"])
                # A fresh original Workspace object validates the actual retained
                # source/report. Recipient cold-process use is the separate reopen command.
                reopened = Workspace(workspace.root, create=False)
                verified = climate_forcing.get_report(reopened, value["id"], report["id"])
                value = {"schema": "upstate.climate-forcing-course/v1",
                         "workspace_id": workspace.project["id"],
                         "study": climate_forcing.get(reopened, value["id"]),
                         "report": verified,
                         "reopening": "Fresh Workspace instance; use reopen in the copied application for a separate process"}
    elif args.command == "show":
        value = climate_forcing.get(workspace, args.study)
    elif args.command == "run":
        value = climate_forcing.run_case(workspace, args.study, args.case)
    elif args.command == "report":
        value = climate_forcing.report(workspace, args.study)
    elif args.command == "reopen":
        if args.expected_project is not None and workspace.project["id"] != args.expected_project:
            raise ValueError("The reopened Workspace has a different original project identity")
        value = {"schema": "upstate.climate-forcing-reopen/v1",
                 "workspace_id": workspace.project["id"],
                 "study": climate_forcing.verify(workspace, args.study),
                 "report": climate_forcing.get_report(workspace, args.study, args.report_id)}
    else:
        value = climate_forcing.verify_all(workspace)
    if args.output:
        atomic_json(Path(args.output), value)
    print(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
