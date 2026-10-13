"""Complete supplier statement commands on the original Operations owner.

The shared CLI owns workspace open/close and atomic output publication. Reentry
uses the complete retained command, original request ID and original transaction.
"""
from __future__ import annotations

import json

from model import Problem, canonical
from operations_supplier_statements import ACTION
from operations import MAX_SOURCE

COMMANDS = {"supplier-statements", "supplier-statements-seed", "supplier-statements-preview", "supplier-statements-save", "supplier-statements-show",
            "supplier-statements-export", "supplier-statements-request", "supplier-statements-resume"}


def operates(action):
    return action in COMMANDS


def register(command, mutation):
    command("supplier-statements", "List complete immutable delivery supplier statement editions", case=True, output=True)
    target = command("supplier-statements-seed", "Open a complete editable register from its current or selected edition",
                     case=True, output=True)
    target.add_argument("--expected-version", type=int, required=True)
    target.add_argument("--review", help="Original review ID; omission selects the current register")
    target.add_argument("--document-only", action="store_true")
    for action in ("supplier-statements-preview", "supplier-statements-save"):
        target = command(action, "Review the complete register" if action == "supplier-statements-preview" else
                         "Save one reviewed register through the original request journal", case=True, output=True)
        target.add_argument("--document", required=True, help="Complete UTF-8 supplier statement document JSON")
        if action == "supplier-statements-save":
            mutation(target, version=True, note_required=True)
            target.add_argument("--expected-preview-sha256", required=True)
        else:
            target.add_argument("--expected-version", type=int, required=True)
    target = command("supplier-statements-show", "Read one complete retained edition and current source comparison", case=True, output=True)
    target.add_argument("--review", required=True)
    target = command("supplier-statements-export", "Export the complete case, register, actions, sources and reading report", case=True)
    target.add_argument("--review", required=True)
    target.add_argument("--output", required=True, help="Create-only original case ZIP filename")
    for action in ("supplier-statements-request", "supplier-statements-resume"):
        target = command(action, "Read the exact original saved command receipt" if action == "supplier-statements-request" else
                         "Reconcile and resume the exact original retained command", case=True, output=True)
        target.add_argument("--command", required=True, help="Exact complete supplier-statement.save command JSON")


def document(filename, read_bytes, maximum=MAX_SOURCE):
    try:
        value = json.loads(read_bytes(filename, maximum))
    except (UnicodeError, ValueError) as exc:
        raise Problem("Use the complete UTF-8 supplier statement JSON object.", 422, "INVALID_SUPPLIER_STATEMENT") from exc
    if not isinstance(value, dict):
        raise Problem("Use the complete supplier statement JSON object.", 422, "INVALID_SUPPLIER_STATEMENT")
    return value


def operate(ops, args, read_bytes, publish):
    action = args.operation
    if action == "supplier-statements":
        result = ops.list_supplier_statements(args.case)
    elif action == "supplier-statements-seed":
        body = {"expectedVersion": args.expected_version}
        if args.review is not None:
            body["reviewId"] = args.review
        result = ops.seed_supplier_statement(args.case, body)
        if args.document_only:
            result = result["document"]
    elif action in ("supplier-statements-preview", "supplier-statements-save"):
        entered = document(args.document, read_bytes)
        if action == "supplier-statements-preview":
            result = ops.preview_supplier_statement(args.case, {"expectedVersion": args.expected_version, "document": entered})
        else:
            result = ops.command(args.case, {"action": ACTION, "expectedVersion": args.expected_version,
                "actor": args.actor, "note": args.note, "requestId": args.request_id,
                "data": {"document": entered, "expectedPreviewSha256": args.expected_preview_sha256}})
    elif action == "supplier-statements-show":
        result = ops.supplier_statement(args.case, args.review)
    elif action == "supplier-statements-export":
        return {"caseId": args.case, "reviewId": args.review,
                "output": publish(args.output, ops.export_supplier_statement(args.case, args.review))}
    elif action in ("supplier-statements-request", "supplier-statements-resume"):
        command = document(args.command, read_bytes, MAX_SOURCE)
        result = ops.supplier_statement_request(args.case, {"command": command})
        if action == "supplier-statements-resume":
            result = result["result"] if result["found"] else ops.command(args.case, command)
    else:
        raise Problem("Unknown supplier statement command.", 422, "UNKNOWN_COMMAND")
    if getattr(args, "output", None):
        return {"output": publish(args.output, (canonical(result) + "\n").encode("utf-8"))}
    return result
