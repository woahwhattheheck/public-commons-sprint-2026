"""Operate paired watershed sensitivity studies through the original Workspace."""
from __future__ import annotations

import argparse
import json
import sys

from .ensembles import Ensembles, parameter_catalog
from .workspace import Workspace


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", help="Existing complete watershed Workspace directory")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("catalog", help="Print native parameter meanings, units and original source references")
    for name in ("preview", "prepare"):
        sub = commands.add_parser(name)
        sub.add_argument("design", help="Source-bound ensemble design JSON")
    commands.add_parser("list")
    for name in ("inspect", "run", "report"):
        sub = commands.add_parser(name)
        sub.add_argument("ensemble_id")
        if name == "run":
            sub.add_argument("--stop-on-error", action="store_true",
                             help="Return at the first native failure; completed stages remain reusable")
        if name == "report":
            sub.add_argument("--refresh", action="store_true",
                             help="Compute missing paired summaries from completed native outputs")
    args = parser.parse_args(argv)
    if args.command == "catalog":
        result = parameter_catalog()
    else:
        if not args.workspace:
            parser.error("--workspace is required for this operation")
        ensemble = Ensembles(Workspace(args.workspace))
        if args.command in ("preview", "prepare"):
            with open(args.design, encoding="utf-8") as stream:
                design = json.load(stream)
            result = getattr(ensemble, args.command)(design)
        elif args.command == "list":
            result = ensemble.list()
        elif args.command == "inspect":
            result = ensemble.inspect(args.ensemble_id)
        elif args.command == "run":
            result = ensemble.run(args.ensemble_id, continue_on_error=not args.stop_on_error)
        else:
            result = ensemble.report_data(args.ensemble_id, refresh=args.refresh)
    json.dump(result, sys.stdout, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False)
    sys.stdout.write("\n")
    if args.command == "run" and result["state"] != "complete":
        return 2
    if args.command == "report" and result.get("errors"):
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
