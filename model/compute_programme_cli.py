#!/usr/bin/env python3
"""Operate resumable native scientific programmes in an existing Workspace.

Full-model selections can name completed NDR and SDR stages using each run row's
source_runs object. Catalog lists those original source IDs. Create, resume,
report and delivery retain the same target run and its original stage lineage.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    __package__ = "model"

from .common import read_json
from .compute_programme import ComputeProgrammes, _error
from .workspace import Workspace


def parser():
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--workspace", type=Path, required=True,
                       help="The existing scientific Workspace containing real prepared selections")
    commands = value.add_subparsers(dest="command", required=True)
    catalog = commands.add_parser("catalog", help="List programmes, original selections and completed native source stages")
    catalog.add_argument("--without-completed-sources", action="store_true",
                         help="Skip completed native source discovery for a lightweight catalogue")
    preview = commands.add_parser("preview", help="Resolve named runs and completed source stages without native execution")
    preview.add_argument("selection", type=Path)
    create = commands.add_parser("create", help="Persist or reopen one immutable named-run programme")
    create.add_argument("selection", type=Path)
    create.add_argument("--source-reference",
                        help="The exact installed application revision; otherwise captured file hashes identify it")
    for name in ("interaction-preview", "interaction-create"):
        command = commands.add_parser(name, help="Adopt an original conservation coalition study")
        command.add_argument("plan_id")
    attach = commands.add_parser("attach-interaction", help="Attach an exact completed common-support result")
    attach.add_argument("programme_id")
    attach.add_argument("result_id")
    sync = commands.add_parser("sync-interaction", help="Analyze already completed programme coalitions and retain attribution")
    sync.add_argument("programme_id")
    for name in ("status", "pause", "report", "read-report", "ensemble-candidates", "pair-completion-preview"):
        command = commands.add_parser(name)
        command.add_argument("programme_id")
    ensemble = commands.add_parser("ensemble-selection", help="Export one current same-profile pair cohort for the paired map service")
    ensemble.add_argument("programme_id")
    ensemble.add_argument("candidate_id")
    completion = commands.add_parser("pair-completion",
        help="Prepare a derived programme that completes actual missing same-profile native pairs")
    completion.add_argument("programme_id", help="The original programme whose pair requirements are retained")
    completion.add_argument("--expected-preview-id", help="Require the exact pair-completion preview previously inspected")
    completion.add_argument("--run", action="store_true", help="Continue the prepared programme immediately")
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


def _synchronize_completed(programmes, result):
    source = result.get("selection", {}).get("source_reference", "")
    if result.get("state") != "complete" or not isinstance(source, str):
        return result
    if source.startswith("upstate.native-interactions:"):
        from .programme_interactions import sync_completed
        synchronized = sync_completed(programmes.workspace, result)
        return {**result, "interaction_sync": synchronized, "files": synchronized["files"]} if synchronized else result
    if source.startswith(("upstate.experiment:", "upstate.programme-pair-completion:")):
        from .programme_experiments import sync_completed
        synchronized = sync_completed(programmes.workspace, result)
        return {**result, "experiment_sync": synchronized} if synchronized is not None else result
    return result


def perform(args):
    programmes = ComputeProgrammes(Workspace(args.workspace))
    if args.command in ("interaction-preview", "interaction-create", "attach-interaction", "sync-interaction"):
        from . import programme_interactions
        if args.command == "interaction-preview":
            return programme_interactions.preview(programmes.workspace, args.plan_id)
        if args.command == "interaction-create":
            return programme_interactions.create(programmes.workspace, args.plan_id)
        if args.command == "attach-interaction":
            return programme_interactions.attach(programmes.workspace, args.programme_id, args.result_id)
        result = programme_interactions.sync_completed(programmes.workspace, programmes.status(args.programme_id))
        if result is None:
            raise ValueError("Choose an adopted conservation interaction programme")
        return result
    if args.command == "catalog":
        from .programme_interactions import catalog as interaction_catalog
        return {**programmes.catalog(include_completed_sources=not args.without_completed_sources),
                **interaction_catalog(programmes.workspace)}
    if args.command == "preview":
        return programmes.preview(read_json(args.selection))
    if args.command == "create":
        return programmes.create(read_json(args.selection), source_reference=args.source_reference)
    if args.command == "status":
        return programmes.status(args.programme_id)
    if args.command == "ensemble-candidates":
        result = programmes.status(args.programme_id)
        return {name: result[name] for name in ("programme_id", "ensemble_candidates",
                "ensemble_candidate_issues", "ensemble_pairing")}
    if args.command == "ensemble-selection":
        return programmes.ensemble_candidate(args.programme_id, args.candidate_id)["selection"]
    if args.command == "pair-completion-preview":
        return programmes.pair_completion_preview(args.programme_id)
    if args.command == "pair-completion":
        result = programmes.create_pair_completion(args.programme_id,
            expected_preview_id=args.expected_preview_id)
        if not args.run:
            return result
        try:
            return _synchronize_completed(programmes, programmes.resume(result["programme_id"]))
        except Exception as exc:
            exc.programme_id = result["programme_id"]
            raise
    if args.command == "pause":
        return programmes.pause(args.programme_id)
    if args.command == "execute":
        result = programmes.execute(args.programme_id, only_runs=args.runs)
        return _synchronize_completed(programmes, result)
    if args.command == "resume":
        result = programmes.resume(args.programme_id, only_runs=args.runs)
        return _synchronize_completed(programmes, result)
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
        if (args.command in ("execute", "resume")
                or (args.command == "pair-completion" and args.run)) and result["state"] != "complete":
            return 2
        return 0
    except (ValueError, OSError, KeyError, ImportError, RuntimeError) as exc:
        result = {"state": "busy" if isinstance(exc, BlockingIOError) else "failed", **_error(exc)}
        programme_id = getattr(exc, "programme_id", None) or getattr(args, "programme_id", None)
        if programme_id:
            result["programme_id"] = programme_id
        print(json.dumps(result, ensure_ascii=False, sort_keys=True), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
