#!/usr/bin/env python3
"""Operate the retained Upper Savannah scientific workspace."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    __package__ = "model"
from .common import read_json
from .workspace import Workspace

def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workspace", type=Path, help="The original local scientific workspace")
    commands = p.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init", help="Create or reopen an original workspace")
    init.add_argument("--title", default="Upper Savannah scientific workspace")
    commands.add_parser("overview")
    commands.add_parser("runtime", help="Inspect the exact original NDR/SDR runtime")
    for name, help_text in (
        ("source-import", "Retain original source bytes from a local edition manifest"),
        ("profile-save", "Save a sourced biophysical and native-parameter profile"),
        ("scenario-save", "Save an explicit baseline or land-cover scenario"),
        ("grid-prepare", "Prepare the selected source alignment and source/reporting masks"),
        ("run-prepare", "Bind an immutable grid/profile/scenario selection"),
        ("delivery-build", "Build seven map families, report, GIS and native working handoff"),
        ("community-table-import", "Import an original registered community table"),
        ("community-plan-save", "Save an immutable community intervention plan"),
        ("community-report-build", "Build the complete saved community report"),
        ("planning-inventory-build", "Build a native planning inventory from retained original polygons and runs"),
        ("portfolio-preview", "Compare conservation parcels, priorities and resource constraints"),
        ("portfolio-save", "Retain a complete conservation portfolio and weight analysis"),
        ("portfolio-scenario", "Turn selected parcels into a native land-cover scenario"),
        ("portfolio-run-prepare", "Prepare the selected portfolio's original native model run"),
        ("portfolio-run", "Run the portfolio through its selected original native models"),
        ("portfolio-report", "Build the selected parcel portfolio's complete planning report"),
        ("portfolio-decision", "Compare the modeled portfolio and explicit costs in the economic decision desk"),
    ):
        command = commands.add_parser(name, help=help_text)
        command.add_argument("selection", type=Path)
    for name in ("run", "run-inspect"):
        command = commands.add_parser(name)
        command.add_argument("run_id")
    status = commands.add_parser("run-status",
        help="Read active phase, storage, log and retained outputs without starting a model")
    status.add_argument("run_id")
    status.add_argument("--verify", action="store_true", help="Verify retained stage and export hashes")
    status.add_argument("--log-bytes", type=int, default=16384, help="Tail 0 to 65536 native log bytes")
    regional = commands.add_parser("regional-delivery",
        help="Complete retained native models as maps, decision tables and an editable project")
    regional.add_argument("model_receiving", type=Path)
    regional.add_argument("--output", type=Path, required=True)
    regional.add_argument("--receive-directory", type=Path)
    compare = commands.add_parser("compare-runs")
    compare.add_argument("run_ids", nargs="+", help="Baseline first, then completed alternatives")
    observation = commands.add_parser("observations-import")
    observation.add_argument("csv", type=Path)
    observation.add_argument("metadata", type=Path)
    observation_compare = commands.add_parser("observations-compare")
    observation_compare.add_argument("run_id")
    observation_compare.add_argument("observation_id")
    observation_compare.add_argument("catchments", type=Path)
    backup = commands.add_parser("backup", help="Capture original sources, working files and application")
    backup.add_argument("destination", type=Path)
    backup.add_argument("--omit-native-intermediates", action="store_true")
    restore = commands.add_parser("restore", help="Reopen an original archive in a new directory")
    restore.add_argument("archive", type=Path)
    restore.add_argument("destination", type=Path)
    inspect = commands.add_parser("archive-inspect")
    inspect.add_argument("archive", type=Path)
    return p

def perform(args):
    if args.command == "runtime":
        from .native import runtime
        return runtime()[1]
    if args.command in ("restore", "archive-inspect"):
        from .portable import restore, inspect_archive
        if args.command == "restore":
            return restore(args.archive, args.destination)
        manifest = inspect_archive(args.archive, verify=True)
        return {"schema": manifest["schema"], "project": manifest["project"],
                "members": len(manifest["members"]), "selection": manifest["selection"], "bytes": "MATCH"}
    if args.command == "regional-delivery":
        from .regional_delivery import complete_delivery
        return complete_delivery(args.model_receiving, workspace_path=args.workspace,
                                 output=args.output, receive_directory=args.receive_directory)
    if not args.workspace:
        raise ValueError("--workspace is required for this operation")
    workspace = Workspace(args.workspace, create=args.command == "init",
                          title=getattr(args, "title", "Upper Savannah scientific workspace"))
    if args.command in ("init", "overview"):
        return workspace.overview()
    operations = {"profile-save": workspace.save_profile, "scenario-save": workspace.save_scenario,
                  "grid-prepare": workspace.prepare_grid, "run-prepare": workspace.prepare_run,
                  "delivery-build": workspace.build_delivery,
                  "community-table-import": workspace.import_community_table,
                  "community-plan-save": workspace.save_community_plan,
                  "community-report-build": workspace.build_community_report,
                  "planning-inventory-build": workspace.build_planning_inventory,
                  "portfolio-preview": workspace.preview_portfolio,
                  "portfolio-save": workspace.save_portfolio,
                  "portfolio-scenario": workspace.prepare_portfolio_scenario,
                  "portfolio-run-prepare": workspace.prepare_portfolio_run,
                  "portfolio-run": workspace.run_portfolio,
                  "portfolio-report": workspace.build_portfolio_report,
                  "portfolio-decision": workspace.build_portfolio_decision}
    if args.command in operations:
        return operations[args.command](read_json(args.selection))
    if args.command == "source-import":
        return workspace.import_sources(args.selection)
    if args.command == "run":
        return workspace.run(args.run_id)
    if args.command == "run-inspect":
        return workspace.inspect_run(args.run_id)
    if args.command == "run-status":
        from .native_execution import inspect_execution
        return inspect_execution(workspace, args.run_id, verify=args.verify, log_bytes=args.log_bytes)
    if args.command == "compare-runs":
        return workspace.compare_runs(args.run_ids)
    if args.command == "observations-import":
        return workspace.import_observations(args.csv, read_json(args.metadata))
    if args.command == "observations-compare":
        return workspace.compare_observations(args.run_id, args.observation_id, read_json(args.catchments))
    if args.command == "backup":
        return workspace.backup(args.destination, include_intermediates=not args.omit_native_intermediates)
    raise ValueError("Unknown workspace operation")

def main(argv=None):
    try:
        result = perform(parser().parse_args(argv))
        print(json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True, allow_nan=False))
        return 0
    except (ValueError, OSError, KeyError, ImportError, RuntimeError) as error:
        print(json.dumps({"state": "error", **getattr(error, "native_failure",
                          {"type": type(error).__name__, "message": str(error)})}, ensure_ascii=False),
              file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
