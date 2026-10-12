#!/usr/bin/env python3
"""Operate the original Datasette -> NLD commissioning workflow.

Use --connect while its original Analysis operator is open. Direct commands open
only the selected existing Analysis workspace and use the same domain methods.
No command installs NLD, retrieves a publisher edition, or accesses a customer DB.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
CHECKOUT = HERE.parents[3]
PYTHON = HERE.parents[1] / "sf88-operator-buyer-cli" / "python"
for directory in (PYTHON, HERE):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))

from nld_contract import SCHEMA, NldError, need, load, identifier
from model import DatasetteAnalysis
from operator_client import DatasetteOperatorClient, DatasetteClientError
from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace

MUTATIONS = {"prepare", "run", "report", "pack", "restore"}
ACTION = {"prepare": "nld.prepare", "run": "nld.execute", "report": "nld.report",
          "pack": "nld.pack", "restore": "nld.restore"}

def emit(value, *, error=False):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False),
          file=sys.stderr if error else sys.stdout, flush=True)

def common(parser):
    parser.add_argument("--workspace", required=True, help="The original existing Analysis workspace")
    parser.add_argument("--operation-id", required=True, help="Its retained 32-hex Datasette operation ID")
    parser.add_argument("--connect", action="store_true", help="Use its already-open original operator")
    parser.add_argument("--checkout", default=str(CHECKOUT))
    parser.add_argument("--node", default="node")
    return parser

def mutation(parser):
    common(parser)
    parser.add_argument("--request-id", required=True, help="Retain this exact 32-hex request ID across lost responses")
    parser.add_argument("--resume", action="store_true", help="Continue this original failed/interrupted request")
    parser.add_argument("--no-wait", action="store_true", help="Return the accepted connected request immediately")
    parser.add_argument("--wait-seconds", type=float, default=3600)
    return parser

def parser():
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    status = common(commands.add_parser("status", help="Read actual projects, native UIDs and saved deliveries"))
    status.add_argument("--project-id")
    prepare = mutation(commands.add_parser("prepare", help="Compile and retain a complete reviewed source project"))
    prepare.add_argument("--project-id", required=True)
    prepare.add_argument("--edition-id", required=True)
    prepare.add_argument("--specification", required=True, help="Complete reviewed JSON source/key/mapping contract")
    run = mutation(commands.add_parser("run", help="Execute or recover one exact original native NLD UID"))
    run.add_argument("--project-id", required=True)
    run.add_argument("--definition-id", required=True)
    run.add_argument("--run-id", required=True, help="Exact 32-hex native UID; never replace it to retry")
    run.add_argument("--strategy", choices=["FULL", "DELTA", "BACKFILL", "BACKFILL_DELTA"], required=True)
    run.add_argument("--operator", required=True)
    run.add_argument("--note", required=True)
    run.add_argument("--python", help="Existing Python 3.12/3.13 executable with the pinned NLD + pyarrow")
    run.add_argument("--key", action="append", dest="keys", help="Exact retained content key; repeat explicitly")
    run.add_argument("--keys-file", help="JSON array of exact retained content keys")
    run.add_argument("--limit", type=int, help="Explicit native backfill selection limit")
    rows = common(commands.add_parser("rows", help="Page every retained source, review or actual target row"))
    rows.add_argument("--project-id", required=True)
    rows.add_argument("--definition-id")
    rows.add_argument("--run-id")
    rows.add_argument("--kind", choices=["source", "review", "target"], default="source")
    rows.add_argument("--offset", type=int, default=0)
    rows.add_argument("--limit", type=int, default=100)
    report = mutation(commands.add_parser("report", help="Reopen original native report/workbook production"))
    report.add_argument("--project-id", required=True)
    report.add_argument("--run-id", required=True)
    pack = mutation(commands.add_parser("pack", help="Retain the project and export the complete original workspace"))
    pack.add_argument("--project-id", required=True)
    pack.add_argument("--destination")
    restore = mutation(commands.add_parser("restore", help="Materialize the same retained project after original archive restore"))
    restore.add_argument("--project-id", required=True)
    restore.add_argument("--checkpoint-id")
    request = common(commands.add_parser("request", help="Read or continue an original operator request"))
    request.add_argument("--id", required=True)
    request.add_argument("--resume", action="store_true")
    request.add_argument("--wait-seconds", type=float, default=3600)
    request.add_argument("--no-wait", action="store_true")
    download = common(commands.add_parser("download", help="Receive one complete original report/workbook/archive"))
    download.add_argument("--name", required=True)
    download.add_argument("--destination", required=True)
    download.add_argument("--export-id")
    download.add_argument("--sha256", required=True)
    return root

def selected(args):
    if args.command == "prepare":
        return {"project_id": args.project_id, "edition_id": args.edition_id,
                "specification": load(args.specification)}
    if args.command == "run":
        need(not (args.keys is not None and args.keys_file is not None), "NLD_KEY_SOURCE_DUPLICATE")
        keys = load(args.keys_file) if args.keys_file else args.keys
        body = {"project_id": args.project_id, "definition_id": args.definition_id, "run_id": args.run_id,
                "strategy": args.strategy, "operator": args.operator, "note": args.note,
                "keys": keys, "limit": args.limit}
        if args.python:
            body["python"] = args.python
        return body
    if args.command == "rows":
        return {key: getattr(args, key) for key in
                ("project_id", "definition_id", "run_id", "kind", "offset", "limit")}
    if args.command == "report":
        return {"project_id": args.project_id, "run_id": args.run_id}
    if args.command == "pack":
        body = {"project_id": args.project_id, "export_id": args.request_id}
        if args.destination:
            body["destination"] = str(Path(args.destination).expanduser().absolute())
        return body
    if args.command == "restore":
        return {"project_id": args.project_id, "checkpoint_id": args.checkpoint_id}
    return {"project_id": args.project_id}

def connected(args):
    client = DatasetteOperatorClient.from_workspace(args.workspace)
    state = client.status()
    need(state["operation_id"] == args.operation_id, "NLD_ORIGINAL_OPERATOR_CHANGED")
    if args.command == "status":
        return client.nld_status(project_id=args.project_id)
    if args.command == "rows":
        return client.nld_rows(**selected(args))
    if args.command == "download":
        return client.download(args.name, args.destination, export_id=args.export_id,
                               expected_sha256=args.sha256)
    if args.command == "request":
        value = client.resume(args.id)["request"] if args.resume else client.request(args.id)
        return value if args.no_wait or value["status"] != "RUNNING" else client.wait(
            args.id, timeout=args.wait_seconds, progress=lambda v: emit(
                {"id": v["id"], "status": v["status"], "progress": v.get("progress")}, error=True))
    action, body = ACTION[args.command], selected(args)
    identifier(args.request_id)
    emit({"schema": SCHEMA, "operation_id": args.operation_id, "request_id": args.request_id,
          "action": action, "native_run_id": body.get("run_id")}, error=True)
    value = client.submit(action, body, request_id=args.request_id)["request"]
    if args.resume and value["status"] in ("FAILED", "INTERRUPTED"):
        value = client.resume(args.request_id)["request"]
    if args.no_wait or value["status"] != "RUNNING":
        return value
    return client.wait(args.request_id, timeout=args.wait_seconds, progress=lambda v: emit(
        {"id": v["id"], "status": v["status"], "progress": v.get("progress")}, error=True))

def main(argv=None):
    args = parser().parse_args(argv)
    try:
        identifier(args.operation_id)
        if args.command in ("download", "request"):
            need(args.connect, "NLD_ORIGINAL_CONNECTED_OPERATOR_REQUIRED")
        if args.connect:
            result = connected(args)
        else:
            need(not getattr(args, "no_wait", False), "NLD_NO_WAIT_REQUIRES_ORIGINAL_OPERATOR")
            body = selected(args)
            if args.command in MUTATIONS:
                identifier(args.request_id)
                body["resume"] = args.resume
            analysis = AnalysisWorkspace(args.workspace, checkout=args.checkout, node=args.node)
            try:
                model = DatasetteAnalysis(analysis, operation_id=args.operation_id)
                action = ACTION[args.command] if args.command in ACTION else "nld." + args.command
                result = model.dispatch(action, body)
            finally:
                analysis.close()
        emit(result)
        return 1 if result.get("status") in ("FAILED", "INTERRUPTED", "UNRESOLVED") else 0
    except BaseException as error:
        emit({"schema": SCHEMA, "error": getattr(error, "code", type(error).__name__),
              "message": str(error), "operation_id": args.operation_id,
              "request_id": getattr(args, "request_id", getattr(args, "id", None))}, error=True)
        return 130 if isinstance(error, KeyboardInterrupt) else 1

if __name__ == "__main__":
    raise SystemExit(main())
