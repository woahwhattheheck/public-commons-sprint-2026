#!/usr/bin/env python3
"""Open and retain raw Climate Management working revisions through the original Workspace."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))

from model.common import atomic_json, identifier, read_json
from model.workspace import Workspace
from model import climate_management, climate_management_working
from model import climate_management_working_comparison as design_comparisons


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--workspace", required=True, help="Existing original Workspace, never created here")
    result.add_argument("--output", help="Write the complete returned native JSON record")
    commands = result.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="List original named series and current heads")
    commands.add_parser("verify", help="Verify every original revision and complete source binding")
    for name in ("open", "export", "preview"):
        child = commands.add_parser(name)
        child.add_argument("--revision", required=True)
        if name == "preview":
            child.add_argument("--selection-output", help="Save the reviewed scientific selection with its exact working origin")
    child = commands.add_parser("save", help="Retain unfinished controls without preparing or running a scientific case")
    child.add_argument("--request", required=True, help="Complete immutable queued-save payload from a recovery or retained task")
    commands.add_parser("compare-list", help="List exact saved design comparisons and all original revisions")
    commands.add_parser("compare-verify", help="Verify every saved-design handover and its original histories")
    compare = commands.add_parser("compare-preview", help="Compare raw saved fields without scientific acceptance or a model run")
    compare.add_argument("--before", required=True)
    compare.add_argument("--after", required=True)
    compare.add_argument("--title", required=True)
    compare = commands.add_parser("compare-build", help="Retain the exact reviewed readable handover")
    compare.add_argument("--request", required=True, help="JSON containing original selection and expected_id")
    compare = commands.add_parser("compare-open")
    compare.add_argument("--comparison", required=True)
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    workspace = Workspace(Path(args.workspace), create=False)
    if args.command == "compare-list":
        value = design_comparisons.catalogue(workspace)
    elif args.command == "compare-verify":
        value = design_comparisons.verify_all(workspace)
    elif args.command == "compare-preview":
        value = design_comparisons.preview(workspace, {"before_revision_id": identifier(args.before),
                                                       "after_revision_id": identifier(args.after), "title": args.title})
    elif args.command == "compare-build":
        payload = read_json(Path(args.request))
        if not isinstance(payload, dict) or set(payload) != {"selection", "expected_id"}:
            raise ValueError("Retain the exact reviewed comparison selection and preview identity")
        value = design_comparisons.build(workspace, payload["selection"], identifier(payload["expected_id"]))
    elif args.command == "compare-open":
        value = design_comparisons.get_report(workspace, identifier(args.comparison), verify=True)
    elif args.command == "list":
        value = {"project_id": workspace.project["id"], "items": climate_management_working.list_series(workspace)}
    elif args.command == "verify":
        value = climate_management_working.verify_all(workspace)
    elif args.command == "save":
        payload = read_json(Path(args.request))
        if payload.get("schema") == climate_management_working.RECOVERY:
            request = payload.get("request")
            if not request or request.get("action") != "climate-management.working.save":
                raise ValueError("Choose a recovery retaining the original named-save request")
            payload = request["payload"]
        value = climate_management_working.save(workspace, payload)
    elif args.command == "open":
        value = climate_management_working.inspect(workspace, identifier(args.revision))
    elif args.command == "export":
        value = climate_management_working.export_files(workspace, identifier(args.revision))
    else:
        package = climate_management_working.export_package(workspace, identifier(args.revision))
        selection = climate_management_working.selection_from_draft(package["records"][-1]["draft"])
        selection["working_origin"] = {"revision_id": package["revision_id"]}
        value = climate_management.preview(workspace, selection)
        if args.selection_output:
            atomic_json(Path(args.selection_output), selection, immutable=True)
    if args.output:
        atomic_json(Path(args.output), value, immutable=True)
    print(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
