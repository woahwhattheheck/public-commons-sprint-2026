#!/usr/bin/env python3
"""Operate retained regional library profiles through the original scientific Workspace."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    sub = parser.add_subparsers(dest="command", required=True)
    cat = sub.add_parser("catalog"); cat.add_argument("--baseline-profile")
    for name in ("preview", "prepare"):
        command = sub.add_parser(name); command.add_argument("--definition", type=Path, required=True)
    for name in ("inspect", "export"):
        command = sub.add_parser(name); command.add_argument("--id", required=True)
    run = sub.add_parser("experiment")
    run.add_argument("--selection-id", required=True); run.add_argument("--baseline-run", required=True)
    run.add_argument("--scenario", action="append", default=[])
    run.add_argument("--title", required=True); run.add_argument("--reason", required=True)
    run.add_argument("--execute-native", action="store_true")
    args = parser.parse_args(argv)
    app = args.application.resolve(strict=True)
    sys.path.insert(0, str(app))
    from model.workspace import Workspace
    from model import regional_biophysical as library
    from model.common import read_json
    try:
        workspace = Workspace(args.workspace)
        if args.command == "catalog": result = library.catalog(workspace, args.baseline_profile)
        elif args.command in ("preview", "prepare"):
            definition = read_json(args.definition)
            if definition.get("schema") == "upstate.regional-biophysical-working/v1":
                if definition["project_id"] != workspace.project["id"]:
                    raise ValueError("The working copy belongs to another original project")
                definition = definition["definition"]
            result = library.preview(workspace, definition)
            if args.command == "prepare":
                result = library.prepare(workspace, {"definition": definition,
                                                     "preview_sha256": result["preview_sha256"]})
        elif args.command == "inspect": result = library.inspect(workspace, args.id)
        elif args.command == "export":
            result = {key: {"path": str(path), "bytes": path.stat().st_size,
                           "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                      for key, path in library.export(workspace, args.id).items()}
        else:
            result = library.prepare_experiment(workspace, {
                "selection_id": args.selection_id, "baseline_run_id": args.baseline_run,
                "scenario_ids": args.scenario, "title": args.title, "reason": args.reason})
            if args.execute_native:
                from model import experiments
                experiments.execute(workspace, result["id"])
                result = experiments.read_summary(workspace, result["id"])
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (ValueError, KeyError, OSError, RuntimeError) as exc:
        print(json.dumps({"state": "failed", "type": type(exc).__name__, "message": str(exc)}), file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
