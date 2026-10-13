#!/usr/bin/env python3
"""Use the utility/community workspace with original local source selections."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    __package__ = "model"

from .common import read_json
from .workspace import Workspace
from . import communities


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("overview")
    for name in ("table-import", "plan-save", "report-build"):
        commands.add_parser(name).add_argument("selection", type=Path)
    for name in ("table", "plan", "report"):
        commands.add_parser(name).add_argument("id")
    revise = commands.add_parser(
        "plan-revise-csv", help="Receive an edited interventions.csv as the next saved plan revision")
    revise.add_argument("plan_id", help="Saved plan whose table, communities and scientific context are retained")
    revise.add_argument("csv_file", type=Path, help="Edited original interventions.csv in UTF-8")
    revise.add_argument("--title", help="Revised plan title; defaults to the original title")
    revise.add_argument("--purpose", help="Revised purpose; defaults to the original purpose")
    attach = commands.add_parser(
        "plan-attach-watershed", help="Save the next plan revision with its completed regional watershed context")
    attach.add_argument("plan_id")
    attach.add_argument("report_id", help="Saved watershed-<20 hex> report from the existing regional registry")
    attach.add_argument("--title", help="Revised plan title; defaults to the original title")
    args = parser.parse_args(argv)
    try:
        workspace = Workspace(args.workspace)
        if args.command == "overview":
            result = communities.overview(workspace)
        elif args.command == "plan-attach-watershed":
            previous = communities.get_plan(workspace, args.plan_id)
            context = {name: previous["context"].get(name) for name in (
                "source_collection_ids", "grid_id", "baseline_run_id", "scenario_run_ids", "delivery_id")}
            context["watershed_context_id"] = args.report_id
            selected = {
                "table_id": previous["table_id"], "previous_plan_id": previous["id"],
                "title": args.title if args.title is not None else previous["title"],
                "purpose": previous["purpose"], "selection": previous["selection"],
                "context": context, "notes": previous["notes"],
                "interventions": previous["interventions"],
            }
            if previous.get("intervention_import") is not None:
                selected["intervention_import"] = previous["intervention_import"]
            result = communities.save_plan(workspace, selected)
        elif args.command == "plan-revise-csv":
            previous = communities.get_plan(workspace, args.plan_id)
            original = args.csv_file.read_bytes()
            imported = {
                "schema": "upstate.intervention-csv-import/v1",
                "selection": previous["selection"],
                "source": {"filename": args.csv_file.name, "media_type": "text/csv; charset=utf-8",
                           "bytes": len(original), "sha256": hashlib.sha256(original).hexdigest(),
                           "text": original.decode("utf-8")},
            }
            context = {name: previous["context"].get(name) for name in (
                "source_collection_ids", "grid_id", "baseline_run_id", "scenario_run_ids", "delivery_id",
                "watershed_context_id")}
            result = communities.save_plan(workspace, {
                "table_id": previous["table_id"], "previous_plan_id": previous["id"],
                "title": args.title if args.title is not None else previous["title"],
                "purpose": args.purpose if args.purpose is not None else previous["purpose"],
                "selection": previous["selection"], "context": context,
                "notes": previous["notes"], "intervention_import": imported,
            })
        elif args.command in {"table", "plan", "report"}:
            kind = {"table": communities.TABLE_KIND, "plan": communities.PLAN_KIND,
                    "report": communities.REPORT_KIND}[args.command]
            result = workspace._get(kind, args.id)
        else:
            action = {"table-import": "community.table.import", "plan-save": "community.plan.save",
                      "report-build": "community.report.build"}[args.command]
            result = communities.invoke(workspace, action, read_json(args.selection))
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"error": {"type": type(error).__name__, "message": str(error)}},
                         ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
