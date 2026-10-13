"""Preview and retain source context for a completed original native analysis."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from model.workspace import Workspace
from model import analysis_source_context as native


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--selection", help="JSON with analysis_id, title and explicit region/binding/gauge links")
    mode.add_argument("--verify-workspace", action="store_true", help="Verify retained contexts and dependencies after receiving")
    parser.add_argument("--retain", action="store_true", help="Retain the exact previewed contextual report")
    parser.add_argument("--output", help="Write the complete result to this JSON file")
    args = parser.parse_args()
    workspace = Workspace(Path(args.workspace))
    if args.verify_workspace:
        if args.retain:
            parser.error("--retain belongs to a selected original context report")
        result = native.verify_workspace(workspace)
    else:
        selection = json.loads(Path(args.selection).read_text())
        result = native.preview(workspace, selection)
        if args.retain:
            result = native.create(workspace, selection, expected_signature=result["source_signature"])
    text = json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + "\n"
    if args.output:
        from model.common import atomic_bytes
        atomic_bytes(Path(args.output), text.encode())
    else:
        print(text, end="")


if __name__ == "__main__":
    main()
