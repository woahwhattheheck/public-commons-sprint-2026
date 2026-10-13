"""Review, retain and verify original point-source tables already registered in a workspace."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from model.common import atomic_json
from model.workspace import Workspace
from . import retained_point_sources as native


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument("--catalog", action="store_true")
    actions.add_argument("--selection", help="JSON containing the four exact source collection/source IDs")
    actions.add_argument("--verify-workspace", action="store_true")
    parser.add_argument("--retain", action="store_true",
                        help="Retain the reviewed source selection through the same native operation as the operator")
    parser.add_argument("--expected-signature",
                        help="Optional signature from an earlier review; fail if the actual source differs")
    parser.add_argument("--output", help="Write the complete result as JSON")
    args = parser.parse_args()
    if (args.retain or args.expected_signature) and not args.selection:
        parser.error("--retain and --expected-signature require --selection")
    workspace = Workspace(args.workspace)
    if args.catalog:
        result = native.catalog(workspace)
    elif args.verify_workspace:
        result = native.verify_workspace(workspace)
    else:
        selection = json.loads(Path(args.selection).read_text(encoding="utf-8-sig"))
        review = native.preview(workspace, selection)
        signature = review["source_signature"]
        if args.expected_signature and args.expected_signature != signature:
            raise ValueError("The selected original source differs from the earlier review")
        if args.retain:
            result = {"preview": review, "binding": native.bind(
                workspace, selection, expected_signature=signature)}
        else:
            result = review
    if args.output:
        atomic_json(Path(args.output), result)
    else:
        print(json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
