#!/usr/bin/env python3
"""Retain fixed-scale scenario priorities from completed Upper Savannah runs."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    __package__ = "model"

from .common import read_json
from .scenario_analysis import analyze
from .workspace import Workspace


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("selection", type=Path, help="Saved analysis selection JSON")
    parser.add_argument("--full", action="store_true", help="Print every quantitative row as well as retained file references")
    args = parser.parse_args(argv)
    try:
        workspace = Workspace(args.workspace)
        result = analyze(workspace, read_json(args.selection))
        if not args.full:
            result = {key: result[key] for key in (
                "schema", "id", "title", "state", "baseline_run_id", "run_ids",
                "grid_id", "region_count", "normalization", "files", "analysis_artifact", "reused")}
        print(json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True, allow_nan=False))
        return 0
    except (ValueError, TypeError, OSError, KeyError, ImportError, RuntimeError) as error:
        print(json.dumps({"state": "error", "type": type(error).__name__, "message": str(error)},
                         ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
