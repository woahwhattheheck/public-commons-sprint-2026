#!/usr/bin/env python3
"""Operate resumable native scientific programmes in an existing Workspace."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    __package__ = "model"

from .common import read_json
from .compute_programme import ComputeProgrammes
from .workspace import Workspace


def parser():
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--workspace", type=Path, required=True,
                       help="The existing scientific Workspace containing real prepared selections")
    commands = value.add_subparsers(dest="command", required=True)
    commands.add_parser("catalog", help="List programmes and available original grids/profiles/scenarios")
    preview = commands.add_parser("preview", help="Resolve named runs without executing native models")
    preview.add_argument("selection", type=Path)
    create = commands.add_parser("create", help="Persist or reopen one immutable named-run programme")
    create.add_argument("selection", type=Path)
    create.add_argument("--source-reference",
                        help="The exact installed application revision; otherwise captured file hashes identify it")
    for name in ("status", "pause", "report", "read-report"):
        command = commands.add_parser(name)
        command.add_argument("programme_id")
    for name in ("execute", "resume"):
        command = commands.add_parser(name)
        command.add_argument("programme_id")
        command.add_argument("--runs", nargs="+", help="Selected named runs; their baseline dependency is included")
    for name in ("delivery-preview", "delivery"):
        command = commands.add_parser(name)
        command.add_argument("programme_id")
        command.add_argument("selection", type=Path)
        if name == "delivery":
            command.add_argument("--handoff", type=Path,
                                 help="Also save the original native-model-receiving/v1 handoff here")
    return value


def perform(args):
    programmes = ComputeProgrammes(Workspace(args.workspace))
    if args.command == "catalog":
        return programmes.catalog()
    if args.command == "preview":
        return programmes.preview(read_json(args.selection))
    if args.command == "create":
        return programmes.create(read_json(args.selection), source_reference=args.source_reference)
    if args.command == "status":
        return programmes.status(args.programme_id)
    if args.command == "pause":
        return programmes.pause(args.programme_id)
    if args.command == "execute":
        return programmes.execute(args.programme_id, only_runs=args.runs)
    if args.command == "resume":
        return programmes.resume(args.programme_id, only_runs=args.runs)
    if args.command == "report":
        return programmes.report(args.programme_id)
    if args.command == "read-report":
        return programmes.read_report(args.programme_id)
    if args.command == "delivery-preview":
        return programmes.delivery_preview(args.programme_id, read_json(args.selection))
    if args.command == "delivery":
        return programmes.prepare_delivery(args.programme_id, read_json(args.selection),
                                           handoff_path=args.handoff)
    raise ValueError("Unknown programme operation")


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        result = perform(args)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False), flush=True)
        if args.command in ("execute", "resume") and result["state"] != "complete":
            return 2
        return 0
    except (ValueError, OSError, KeyError, ImportError, RuntimeError) as exc:
        result = {"state": "busy" if isinstance(exc, BlockingIOError) else "failed",
                  "type": type(exc).__name__, "message": str(exc)}
        if getattr(args, "programme_id", None):
            result["programme_id"] = args.programme_id
        print(json.dumps(result, ensure_ascii=False, sort_keys=True), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
