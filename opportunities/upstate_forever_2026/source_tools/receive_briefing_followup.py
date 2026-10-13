#!/usr/bin/env python3
"""Receive exact client-briefing notes into a retained Implementation plan."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--plan-id", required=True)
    parser.add_argument("--revision", type=int, required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--delivery-id")
    group.add_argument("--report-model", type=Path)
    parser.add_argument("--briefing-index", type=Path)
    parser.add_argument("--notes", type=Path, required=True)
    parser.add_argument("--entry", action="append", dest="entries")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    application = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(application))
    from model.workspace import Workspace
    from model.implementation import ImplementationStore
    from model import briefing_implementation
    workspace = Workspace(args.workspace)
    document = ImplementationStore(workspace).get(args.plan_id, args.revision)
    if args.delivery_id:
        if args.briefing_index:
            parser.error("A saved delivery already supplies its original briefing index")
        paths = briefing_implementation.delivery_sources(workspace, args.delivery_id)
    else:
        if not args.briefing_index:
            parser.error("--report-model requires the complete original --briefing-index")
        paths = {"report": args.report_model, "index": args.briefing_index}
    result = briefing_implementation.preview(workspace, document, paths["report"], paths["index"],
                                             args.notes, selected_entry_ids=args.entries)
    if args.apply:
        result = briefing_implementation.receive(
            workspace, document, paths["report"], paths["index"], args.notes,
            selected_entry_ids=args.entries, expected_operation_id=result["operation_id"],
            actor="original-client-briefing-receiving")
    encoded = json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x", encoding="utf-8") as handle:
            handle.write(encoded)
    print(encoded, end="")

if __name__ == "__main__":
    main()
