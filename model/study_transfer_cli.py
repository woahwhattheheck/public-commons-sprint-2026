"""Select, inspect and transfer retained scientific studies.

TokenJunkieLabs. Archives reopen with the existing model.cli restore command.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from .workspace import Workspace
from . import study_transfer


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    catalog = commands.add_parser("catalog", help="List saved analyses, programmes and native runs")
    catalog.add_argument("--workspace", required=True)
    catalog.add_argument("--kind", choices=study_transfer.ROOT_KINDS)
    catalog.add_argument("--query", default="")
    catalog.add_argument("--offset", type=int, default=0)
    catalog.add_argument("--limit", type=int, default=200)
    for name in ("preview", "export"):
        command = commands.add_parser(name)
        command.add_argument("--workspace", required=True)
        command.add_argument("--selection", required=True, help="Original study selection JSON")
        if name == "export":
            command.add_argument("--destination", required=True, help="New archive filename")
    inspect = commands.add_parser("inspect", help="Read and verify an existing selected-study archive")
    inspect.add_argument("--archive", required=True)
    args = parser.parse_args(argv)
    if args.command == "inspect":
        result = study_transfer.inspect_transfer_archive(args.archive, verify=True)
        result = {"study": result["study"], "project": result["manifest"]["project"],
                  "members": len(result["manifest"]["members"])}
    else:
        workspace = Workspace(args.workspace)
        if args.command == "catalog":
            result = study_transfer.catalog(workspace, kind=args.kind, query=args.query,
                                            offset=args.offset, limit=args.limit)
        else:
            selection = json.loads(Path(args.selection).read_text(encoding="utf-8"))
            if args.command == "preview":
                result = study_transfer.preview(workspace, selection)
            else:
                result = study_transfer.export_study(workspace, args.destination, selection)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
