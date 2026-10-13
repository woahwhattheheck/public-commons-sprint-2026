"""Compose prepared source grids and continue the maintained native assembly."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
from .common import atomic_json
from .completed_run_join import join_runs, preview
from .workspace import Workspace


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("preview", "join"))
    parser.add_argument("--workspace", required=True, type=Path,
                        help="existing scientific workspace containing the selected source stages")
    parser.add_argument("--ndr-run", required=True, help="run containing the completed NDR stage")
    parser.add_argument("--sdr-run", required=True, help="run containing the completed SDR stage")
    parser.add_argument("--profile", help="retained full target profile, required if source profiles differ")
    parser.add_argument("--scenario", help="retained target scenario; defaults to the NDR scenario")
    parser.add_argument("--prepare-only", action="store_true",
                        help="retain adopted stages for the existing run queue to finish")
    parser.add_argument("--output", type=Path, help="also save the returned JSON record")
    args = parser.parse_args(argv)
    try:
        workspace = Workspace(args.workspace)
        options = {"profile_id": args.profile, "scenario_id": args.scenario}
        pair = [args.ndr_run, args.sdr_run]
        if args.action == "preview":
            result = preview(workspace, pair, **options)
        else:
            result = join_runs(workspace, pair, execute=not args.prepare_only, **options)
        if args.output is not None:
            atomic_json(args.output, result)
        json.dump(result, sys.stdout, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)
        sys.stdout.write("\n")
        return 0
    except (OSError, ValueError, KeyError, TypeError, ImportError, RuntimeError) as exc:
        json.dump({"schema": "upstate.completed-run-join-error/v1",
                   "action": args.action, "error": type(exc).__name__, "message": str(exc)},
                  sys.stderr, ensure_ascii=False, sort_keys=True)
        sys.stderr.write("\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
