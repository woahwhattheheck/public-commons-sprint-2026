#!/usr/bin/env python3
"""Operate Datasette customer editions in the original Stellar Forge Analysis workspace."""
from __future__ import annotations

import argparse
import json
import re
import signal
from pathlib import Path
import sys
import uuid
import webbrowser

HERE = Path(__file__).resolve().parent
CHECKOUT = HERE.parents[3]
PYTHON = HERE.parents[1] / "sf88-operator-buyer-cli" / "python"
if str(PYTHON) not in sys.path:
    sys.path.insert(0, str(PYTHON))
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace
from stellar_forge_buyer.errors import BuyerError
from stellar_forge_buyer.workspace_archive_receive import restore_archive
from model import DatasetteAnalysis
from operator_client import DatasetteOperatorClient, DatasetteClientError
from operator_server import create_operator

SCHEMA = "stellar-forge.datasette-operator.v1"


def emit(value, *, stream=sys.stdout):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False), file=stream, flush=True)


def progress(value):
    emit(value, stream=sys.stderr)


def common(parser, *, connect=False):
    parser.add_argument("--workspace", required=True, help="Original private Analysis database directory")
    parser.add_argument("--operation-id", required=True, help="Stable 32-character lowercase hexadecimal Datasette operation ID")
    parser.add_argument("--checkout", default=str(CHECKOUT), help="Matching original Stellar Forge checkout or installed source")
    parser.add_argument("--node", default="node")
    if connect:
        parser.add_argument("--connect", action="store_true", help="Use the already-open operator and its original capability")
        parser.add_argument("--request-id", help="Stable HTTP request ID for response recovery")
        parser.add_argument("--no-wait", action="store_true", help="Return the original request ID while it continues")
        parser.add_argument("--wait-seconds", type=float, default=3600)
    return parser


def parser():
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    start = common(commands.add_parser("serve", help="Open the industrial operator and original Analysis UI"))
    start.add_argument("--port", type=int, default=0)
    start.add_argument("--open", action="store_true", help="Open the local browser")
    common(commands.add_parser("status", help="Read the retained Datasette operation"), connect=True)
    prepare = common(commands.add_parser("prepare", help="Receive source, import data and prepare original Analysis outputs"), connect=True)
    prepare.add_argument("--handover", required=True, help="Original handover JSON with its retained source selection")
    prepare.add_argument("--prefix", default="datasette")
    prepare.add_argument("--resume", action="store_true")
    rows = common(commands.add_parser("rows", help="Read an original imported data page"), connect=True)
    rows.add_argument("--edition-id")
    rows.add_argument("--offset", type=int, default=0)
    rows.add_argument("--limit", type=int, default=100)
    compare = common(commands.add_parser("compare", help="Compare two original retained editions"), connect=True)
    compare.add_argument("--before", required=True)
    compare.add_argument("--after", required=True)
    compare.add_argument("--key", action="append", dest="keys")
    export = common(commands.add_parser("export", help="Prepare complete native reports, workbooks and workspace delivery"), connect=True)
    export.add_argument("--destination")
    call = common(commands.add_parser("call", help="Submit an exact original domain JSON request"), connect=True)
    call.add_argument("--action", required=True, choices=["status", "prepare", "rows", "compare", "export", "nld.status", "nld.rows",
                                                    "nld.prepare", "nld.execute", "nld.report", "nld.pack", "nld.restore",
                                                    "bdnb.schema", "bdnb.status", "bdnb.get", "bdnb.rows",
                                                    "bdnb.import", "bdnb.select", "bdnb.compare", "bdnb.review",
                                                    "bdnb.publish", "bdnb.pack"])
    call.add_argument("--request", required=True)
    request = common(commands.add_parser("request", help="Read or resume one existing HTTP action"), connect=True)
    request.add_argument("--id", required=True)
    request.add_argument("--resume", action="store_true")
    download = common(commands.add_parser("download", help="Receive a complete original file from the running operator"), connect=True)
    download.add_argument("--name", required=True)
    download.add_argument("--destination", required=True)
    download.add_argument("--edition-id")
    download.add_argument("--export-id", help="Original complete workspace export generation ID")
    download.add_argument("--sha256")
    receive = commands.add_parser("receive", help="Restore through the original complete-workspace archive receiver")
    receive.add_argument("--archive", required=True)
    receive.add_argument("--sha256", required=True)
    receive.add_argument("--workspace", required=True)
    receive.add_argument("--operation-id", required=True, help="Stable original archive receiving operation ID")
    return root


def selection(args):
    if args.command == "call":
        with Path(args.request).open("rb") as source:
            raw = source.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError("Use a retained handover path for a large source selection.")
        body = json.loads(raw)
        if not isinstance(body, dict):
            raise ValueError("The original action request must be a JSON object.")
        return args.action, body
    if args.command == "prepare":
        return "prepare", {"handover": str(Path(args.handover).expanduser().absolute()),
                           "prefix": args.prefix, "resume": args.resume}
    if args.command == "rows":
        return "rows", {"offset": args.offset, "limit": args.limit,
                        **({"edition_id": args.edition_id} if args.edition_id else {})}
    if args.command == "compare":
        return "compare", {"before": args.before, "after": args.after,
                           **({"keys": args.keys} if args.keys else {})}
    if args.command == "export":
        body = {"destination": str(Path(args.destination).expanduser().absolute())} if args.destination else {}
        if args.request_id:
            body["export_id"] = args.request_id
        return "export", body
    return "status", {}


def connected(args):
    client = DatasetteOperatorClient.from_workspace(args.workspace)
    original = client.status()
    if original["operation_id"] != args.operation_id:
        raise DatasetteClientError("DATASETTE_OPERATION_CHANGED",
                                   "Select the same original operation as the running operator.")
    if args.command == "download":
        return client.download(args.name, args.destination, edition_id=args.edition_id,
                               export_id=args.export_id, expected_sha256=args.sha256)
    if args.command == "request":
        value = client.resume(args.id)["request"] if args.resume else client.request(args.id)
        if args.no_wait or value["status"] != "RUNNING":
            return value
        return client.wait(args.id, timeout=args.wait_seconds, progress=progress)
    action, body = selection(args)
    if action == "status":
        return original
    if action == "rows":
        return client.rows(**body)
    if action in {"bdnb.schema", "bdnb.status", "bdnb.get", "bdnb.rows"}:
        return client.bdnb_read(action, body)
    if action == "nld.status":
        return client.nld_status(**body)
    if action == "nld.rows":
        return client.nld_rows(**body)
    if action == "bdnb.pack":
        request_id = body.get("pack_id")
        if not isinstance(request_id, str) or not re.fullmatch(r"[a-f0-9]{32}", request_id):
            raise DatasetteClientError("BDNB_PACK_ID_REQUIRED", "Supply the original pack_id in the full pack body.")
        if args.request_id is not None and args.request_id != request_id:
            raise DatasetteClientError("BDNB_PACK_REQUEST_ID_CHANGED", "--request-id must equal the selected pack_id.")
    else:
        request_id = args.request_id or uuid.uuid4().hex
    emit({"schema": SCHEMA, "operation_id": args.operation_id,
          "request_id": request_id, "action": action}, stream=sys.stderr)
    value = client.submit(action, body, request_id=request_id)["request"]
    if args.no_wait or value["status"] != "RUNNING":
        return value
    return client.wait(request_id, timeout=args.wait_seconds, progress=progress)


def _interrupt(signum, frame):
    raise KeyboardInterrupt


def main(argv=None):
    args = parser().parse_args(argv)
    previous_handler = None
    try:
        if args.command == "serve":
            previous_handler = signal.signal(signal.SIGTERM, _interrupt)
        if args.command == "receive":
            value = restore_archive(Path(args.archive).expanduser().absolute(),
                                    Path(args.workspace).expanduser().absolute(),
                                    operation=args.operation_id, expected_sha256=args.sha256)
        elif args.command in {"request", "download"} or getattr(args, "connect", False):
            value = connected(args)
        else:
            workspace = AnalysisWorkspace(args.workspace, checkout=args.checkout, node=args.node)
            try:
                if args.command == "serve":
                    server, control, url, controller = create_operator(
                        workspace, operation_id=args.operation_id, port=args.port)
                    try:
                        emit({"schema": SCHEMA, "status": "LISTENING", "url": url,
                              "workspace_id": workspace.identity,
                              "operation_id": args.operation_id, "private_launch": str(control)})
                        if args.open:
                            webbrowser.open(url)
                        server.serve_forever(poll_interval=0.2)
                    except KeyboardInterrupt:
                        pass
                    finally:
                        server.server_close()
                        controller.close()
                        control.unlink(missing_ok=True)
                        server.datasette_analysis_control.unlink(missing_ok=True)
                    return 0
                model = DatasetteAnalysis(workspace, operation_id=args.operation_id, progress=progress)
                action, body = selection(args)
                value = model.dispatch(action, body)
            finally:
                workspace.close()
        emit(value)
        return 1 if isinstance(value, dict) and value.get("status") in {"FAILED", "INTERRUPTED"} else 0
    except KeyboardInterrupt:
        return 130
    except (BuyerError, DatasetteClientError, OSError, ValueError, KeyError, TypeError) as error:
        record = {"schema": SCHEMA, "error": str(getattr(error, "code", None) or type(error).__name__),
                  "message": str(error)}
        if getattr(error, "request_id", None):
            record["request_id"] = error.request_id
        emit(record, stream=sys.stderr)
        return 1
    finally:
        if previous_handler is not None:
            signal.signal(signal.SIGTERM, previous_handler)


if __name__ == "__main__":
    raise SystemExit(main())
