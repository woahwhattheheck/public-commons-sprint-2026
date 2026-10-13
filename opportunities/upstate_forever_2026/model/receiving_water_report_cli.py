"""Native receiving entrypoint for saved receiving-water scientific report sources."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from model.common import atomic_json, read_json
from model.workspace import Workspace
from model import receiving_water_report_source as reports


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path,
                        help="Existing original scientific Workspace")
    parser.add_argument("--output", type=Path, help="Optional result JSON outside the Workspace")
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare", help="Retain one saved source plan or completed analysis")
    group = prepare.add_mutually_exclusive_group(required=True)
    group.add_argument("--selection", type=Path, help="Complete selection JSON")
    group.add_argument("--plan-id")
    group.add_argument("--analysis-id")
    prepare.add_argument("--title")
    prepare.add_argument("--delivery-id", help="Append this source to an existing saved delivery selection")
    inspect = commands.add_parser("inspect", help="Verify a complete retained report source")
    inspect.add_argument("id")
    inspect.add_argument("--delivery-id")
    commands.add_parser("catalog", help="List retained receiving-water report sources")
    args = parser.parse_args(argv)
    workspace = Workspace(args.workspace)
    if args.output and args.output.resolve().is_relative_to(workspace.root):
        raise ValueError("Place the receiving result outside the scientific Workspace")
    if args.command == "prepare":
        extras = {key: getattr(args, key) for key in
                  ("plan_id", "analysis_id", "title", "delivery_id")
                  if getattr(args, key) is not None}
        if args.selection:
            if extras:
                raise ValueError("Use either complete selection JSON or individual selection flags")
            selection = read_json(args.selection)
        else:
            selection = extras
        def progress(value):
            print(json.dumps(value, ensure_ascii=False), file=sys.stderr, flush=True)
        result = reports.prepare(workspace, selection, progress=progress)
        verified = reports.inspect(workspace, result["id"], verify=True)
        result["receiving_verification"] = {"id": verified["id"], "state": verified["state"],
                                          "record_sha256": verified["record_sha256"]}
    elif args.command == "inspect":
        result = reports.inspect(workspace, args.id, verify=True)
        result["delivery_selection"] = reports.delivery_selection(
            workspace, result["source"], args.delivery_id)
    else:
        result = {"reports": reports.catalog(workspace)}
    if args.output:
        atomic_json(args.output, result)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"stage": "receiving-water-report-source", "error_type": type(exc).__name__,
                          "message": str(exc)}, ensure_ascii=False), file=sys.stderr, flush=True)
        raise
