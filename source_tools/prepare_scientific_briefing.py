#!/usr/bin/env python3
"""Prepare a complete discussion package from an exact saved scientific report."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--edition-id", required=True, help="Original saved scientific report edition")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-id", help="Exact briefing preview ID required for --apply")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    if args.apply and not args.expected_id:
        parser.error("--apply requires the exact --expected-id returned by preview")
    application = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(application))
    from model.workspace import Workspace
    from model import scientific_briefing
    workspace = Workspace(args.workspace)
    result = scientific_briefing.preview(workspace, args.edition_id)
    if args.apply:
        record = scientific_briefing.create(workspace, args.edition_id, expected_id=args.expected_id)
        result = scientific_briefing.export(workspace, record["id"])
        directory = workspace.root / scientific_briefing.KIND / record["id"]
        result = {**result, "directory": str(directory),
                  "archive_path": str(directory / result["archive"]["path"])}
    encoded = json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x", encoding="utf-8") as stream:
            stream.write(encoded)
    print(encoded, end="")

if __name__ == "__main__":
    main()
