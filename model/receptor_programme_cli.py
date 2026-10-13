"""Prepare a source-water paired experiment through the existing native programme."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .common import read_json
from .workspace import Workspace
from . import receptor_programmes


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace", help="Existing original scientific Workspace")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("preview", "create"):
        command = commands.add_parser(name)
        command.add_argument("selection", help="Source-water programme selection JSON")
        if name == "create":
            command.add_argument("--expected-preview-id")
    for name in ("inspect", "compare"):
        command = commands.add_parser(name)
        command.add_argument("source_water_programme_id")
    args = parser.parse_args(argv)
    try:
        workspace = Workspace(args.workspace)
        if args.command == "preview":
            result = receptor_programmes.preview(workspace, read_json(Path(args.selection)))
        elif args.command == "create":
            result = receptor_programmes.create(workspace, read_json(Path(args.selection)),
                                                expected_preview_id=args.expected_preview_id)
        elif args.command == "inspect":
            result = receptor_programmes.inspect(workspace, args.source_water_programme_id)
        else:
            result = receptor_programmes.compare(workspace, args.source_water_programme_id)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False))
        return 0
    except Exception as exc:
        print(json.dumps({"state": "failed", "type": type(exc).__name__, "message": str(exc)},
                         ensure_ascii=False, allow_nan=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
