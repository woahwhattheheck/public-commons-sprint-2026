"""Original saved multivariate-control design lifecycle."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .workspace import Workspace
from . import multivariate_control as controls
from .common import read_json


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("catalog", "preview", "prepare", "inspect", "adopt", "execute"))
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--selection", type=Path)
    parser.add_argument("--id")
    args = parser.parse_args(argv)
    if args.operation in ("preview", "prepare"):
        if not args.selection or args.id:
            parser.error("Preview/prepare require --selection and no --id")
    elif args.operation != "catalog":
        if not args.id or args.selection:
            parser.error("Inspect/adopt/execute require --id and no --selection")
    elif args.id or args.selection:
        parser.error("Catalog takes only the original --workspace")
    ws = Workspace(args.workspace)
    if args.operation == "catalog":
        value = controls.catalog(ws)
    elif args.operation == "preview":
        value = controls.preview(ws, read_json(args.selection))
    elif args.operation == "prepare":
        value = controls.prepare(ws, read_json(args.selection),
            progress=lambda row: print(json.dumps(row, allow_nan=False), file=sys.stderr, flush=True))
    else:
        value = getattr(controls, args.operation)(ws, args.id)
    print(json.dumps(value, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
