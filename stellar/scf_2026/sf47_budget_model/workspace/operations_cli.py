"""Headless delivery operations through the original SF47 Workspace owner."""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import tempfile

from model import Problem, MAX_BUNDLE, canonical
from operations import Operations, MAX_SOURCE


def register(subparsers, common):
    root = subparsers.add_parser("operations", parents=[common],
        help="Retained delivery, work, invoices, cash, deployments and review")
    actions = root.add_subparsers(dest="operation", required=True)
    def command(name, description, case=False, output=False):
        target = actions.add_parser(name, help=description, description=description)
        if case:
            target.add_argument("--case", required=True, help="Original operations case ID")
        if output:
            target.add_argument("--output", help="New private JSON filename; omission prints JSON")
        return target
    def mutation(target, version=False):
        target.add_argument("--actor", required=True, help="Recording operator, retained in the original history")
        target.add_argument("--request-id", required=True, help="Stable ID; reuse exact inputs to resume")
        if version:
            target.add_argument("--expected-version", type=int, required=True)
        target.add_argument("--note", default="", help="Reason or review note")
    def selection(target):
        target.add_argument("--plan", required=True)
        target.add_argument("--selected-revision", type=int, required=True)
        target.add_argument("--expected-content-sha256", required=True)
        target.add_argument("--name", required=True)
        target.add_argument("--calendar-start", help="Explicit operational YYYY-MM-DD anchor; does not record an award")

    target = command("list", "List delivery operations cases", output=True)
    target.add_argument("--plan")
    target = command("create", "Pin a saved plan and open an operations or walkthrough case")
    selection(target); mutation(target)
    target.add_argument("--mode", choices=("OPERATIONS", "WALKTHROUGH"), required=True)
    for name in ("show", "report"):
        command(name, "Read the complete retained " + name, case=True, output=True)
    target = command("history", "Page the original operations event history", case=True, output=True)
    target.add_argument("--after", type=int, default=0)
    target.add_argument("--limit", type=int, default=100)
    target = command("command", "Apply an original action with an explicit reviewed version", case=True)
    mutation(target, version=True)
    target.add_argument("--action", required=True)
    target.add_argument("--data", required=True, help="JSON file containing the action data object")
    target = command("attach", "Attach exact original source bytes", case=True)
    mutation(target, version=True)
    target.add_argument("--file", required=True)
    target.add_argument("--kind", choices=("invoice", "work", "grant", "payment", "deployment", "purchase", "other"), default="other")
    target.add_argument("--media-type", default="application/octet-stream")
    target.add_argument("--source-url", default="")
    target.add_argument("--observed-at", required=True)
    target = command("source", "Export one exact retained source attachment", case=True)
    target.add_argument("--source", required=True)
    target.add_argument("--output", required=True)
    target = command("review", "Read one complete frozen review", case=True, output=True)
    target.add_argument("--review", required=True)
    target = command("export", "Export source, planner history, operations, reviews and CSV reports", case=True)
    target.add_argument("--expected-version", type=int, required=True)
    target.add_argument("--output", required=True)
    target = command("import", "Receive and reopen a complete operations bundle")
    target.add_argument("--file", required=True)
    target.add_argument("--name", required=True)
    mutation(target)
    target = command("intake", "Import a supplied original pre-award source packet without inferring receipts")
    selection(target); mutation(target)
    target.add_argument("--file", required=True)


def read_bytes(filename, maximum=MAX_BUNDLE):
    path = Path(filename).expanduser().resolve()
    with path.open("rb") as stream:
        raw = stream.read(maximum + 1)
    if len(raw) > maximum:
        raise Problem("Input exceeds its retained-source bound.", 413, "INPUT_TOO_LARGE")
    return raw


def publish(filename, raw):
    """Private exact output; an existing destination is never replaced."""
    destination = Path(filename).expanduser().absolute()
    if not destination.parent.is_dir():
        raise Problem("Output directory does not exist.", 422, "OUTPUT_DIRECTORY_MISSING")
    fd, temporary = tempfile.mkstemp(prefix="." + destination.name + ".", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        try:
            os.link(temporary, destination)
        except FileExistsError as exc:
            raise Problem("Output already exists; select a new filename.", 409, "OUTPUT_EXISTS") from exc
        descriptor = os.open(destination.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return {"path": str(destination), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def operate(workspace, args):
    ops, action = Operations(workspace), args.operation
    if action == "list":
        result = {"cases": ops.list(args.plan)}
    elif action in ("show", "report"):
        result = ops.read(args.case) if action == "show" else ops.report(args.case)
    elif action == "history":
        result = ops.history(args.case, args.after, args.limit)
    elif action == "review":
        result = ops.review(args.case, args.review)
    elif action in ("create", "intake"):
        body = {"planId": args.plan, "selectedRevision": args.selected_revision,
                "expectedContentSha256": args.expected_content_sha256, "name": args.name,
                "calendarStart": args.calendar_start, "actor": args.actor, "requestId": args.request_id}
        if action == "create":
            result = ops.create({**body, "mode": args.mode})
        else:
            from operations_intake import import_source_intake
            result = import_source_intake(ops, read_bytes(args.file, MAX_SOURCE), body)
    elif action in ("command", "attach"):
        if action == "attach":
            data = {"filename": Path(args.file).name, "contentBase64": base64.b64encode(read_bytes(args.file, MAX_SOURCE)).decode(),
                    "kind": args.kind, "mediaType": args.media_type, "sourceUrl": args.source_url, "observedAt": args.observed_at}
            verb = "source.add"
        else:
            try:
                data = json.loads(read_bytes(args.data))
            except (UnicodeError, ValueError) as exc:
                raise Problem("Action data must be a UTF-8 JSON object.", 422, "INVALID_JSON") from exc
            verb = args.action
        result = ops.command(args.case, {"expectedVersion": args.expected_version, "requestId": args.request_id,
                                       "actor": args.actor, "note": args.note, "action": verb, "data": data})
    elif action == "source":
        metadata, raw = ops.source(args.case, args.source)
        return {"source": metadata, "output": publish(args.output, raw)}
    elif action == "export":
        with workspace.mutex:
            current = ops.read(args.case)
            if current["program"]["version"] != args.expected_version:
                raise Problem("The operations case changed. Read it before exporting.", 409, "OPERATIONS_CONFLICT")
            raw = ops.export(args.case)
        return {"case": current["program"], "output": publish(args.output, raw)}
    elif action == "import":
        result = ops.import_bundle(read_bytes(args.file), args.name, args.request_id, args.actor)
    else:
        raise Problem("Unknown operations action.", 422, "UNKNOWN_COMMAND")
    if getattr(args, "output", None):
        return {"output": publish(args.output, (canonical(result) + "\n").encode())}
    return result
