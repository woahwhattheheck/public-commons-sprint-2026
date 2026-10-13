"""Headless commercial billing commands; requests use the same retained workflow as HTTP."""
from __future__ import annotations

import base64
import json

from model import Problem, canonical
from operations_commercial_adapter import commercial_store, CommercialConnectionAdapter


def register(command):
    target = command("commercial-connections", "List configured customer accounting connections", output=True)
    target = command("commercial-connect", "Connect the original running receivables server", output=True)
    target.add_argument("--file", required=True, help="JSON with id, label, baseUrl, actor and requestId")
    target = command("commercial-customers", "List customers in a configured accounting workspace", output=True)
    target.add_argument("--endpoint", required=True)
    for name, help_text in (
        ("commercial-schedule", "Read the exact commercial milestones from a saved installation edition"),
        ("commercial-prepare", "Save a reviewed customer, milestone dates and billing triggers"),
    ):
        target = command(name, help_text, case=True, output=True)
        target.add_argument("--file", required=True, help="Complete JSON request")
    target = command("commercial-list", "List retained billing selections", case=True, output=True)
    for name, help_text in (
        ("commercial-show", "Reopen a retained commercial billing selection"),
        ("commercial-refresh", "Refresh original invoice and payment status"),
        ("commercial-export", "Export the original commercial sources and customer account"),
    ):
        target = command(name, help_text, case=True, output=True)
        target.add_argument("--billing", required=True)
    for name, help_text in (
        ("commercial-draft", "Create or reopen the original native milestone invoice draft"),
        ("commercial-preview", "Preview the original invoice and current commercial authorization"),
        ("commercial-issue", "Issue the exact reviewed invoice"),
    ):
        target = command(name, help_text, case=True, output=True)
        target.add_argument("--billing", required=True)
        target.add_argument("--milestone", required=True)
        target.add_argument("--file", required=True, help="JSON operator request; issue includes expectedIssuePreviewSha256")

    for action in ("list", "preview", "prepare"):
        target = command("commercial-change-" + action, "Read or prepare a source-backed milestone change", case=True, output=True)
        target.add_argument("--billing", required=True)
        target.add_argument("--milestone", required=True)
        if action != "list":
            target.add_argument("--file", required=True, help="Complete customer authorization and reviewed request")
    for action in ("show", "refresh", "apply", "cancel", "preview-issue", "issue", "export"):
        target = command("commercial-change-" + action, "Continue the original milestone correction", case=True, output=True)
        target.add_argument("--change", required=True)
        if action in ("apply", "cancel", "issue"):
            target.add_argument("--file", required=True, help="Original operator and review identities")


def operate(operations, args, read_bytes, publish):
    action = args.operation
    if not action.startswith("commercial-"):
        return None
    body = {}
    if getattr(args, "file", None):
        try:
            body = json.loads(read_bytes(args.file))
        except (UnicodeError, ValueError) as exc:
            raise Problem("The request file must contain a JSON object.", 422, "COMMERCIAL_INPUT_INVALID") from exc
        if not isinstance(body, dict):
            raise Problem("The request file must contain a JSON object.", 422, "COMMERCIAL_INPUT_INVALID")
    adapter = CommercialConnectionAdapter(operations.workspace)
    billing = commercial_store(operations)
    if action.startswith("commercial-change-"):
        changes = operations.commercial_changes
        selected = action.removeprefix("commercial-change-")
        if selected in ("list", "preview", "prepare"):
            result = (changes.list(args.case, args.billing, args.milestone) if selected == "list" else
                      getattr(changes, selected)(args.case, args.billing, args.milestone, body))
        elif selected in ("show", "refresh"):
            result = changes.get(args.case, args.change, selected == "refresh")
        elif selected == "preview-issue":
            result = changes.preview_issue(args.case, args.change)
        elif selected in ("apply", "cancel", "issue"):
            result = getattr(changes, selected)(args.case, args.change, body)
        elif selected == "export":
            if not args.output:
                raise Problem("Choose --output for the complete customer change.", 422, "OUTPUT_REQUIRED")
            result = changes.export_bundle(args.case, args.change)
            return {"changeId": args.change, "output": publish(args.output, base64.b64decode(result["contentBase64"], validate=True))}
        else:
            raise Problem("Milestone-change command not found.", 404, "NOT_FOUND")
    elif action == "commercial-connections":
        result = adapter.endpoints()
    elif action == "commercial-connect":
        result = adapter.configure(body)
    elif action == "commercial-customers":
        result = adapter("customers", {"endpointId": args.endpoint})
    elif action == "commercial-list":
        result = billing.list(args.case)
    elif action in ("commercial-schedule", "commercial-prepare"):
        result = getattr(billing, action.removeprefix("commercial-"))(args.case, body)
    elif action == "commercial-show":
        result = billing.get(args.case, args.billing)
    elif action == "commercial-refresh":
        result = billing.refresh(args.case, args.billing)
    elif action == "commercial-export":
        if not args.output:
            raise Problem("Choose --output for the customer billing archive.", 422, "OUTPUT_REQUIRED")
        exported = billing.export_bundle(args.case, args.billing)
        raw = base64.b64decode(exported["contentBase64"], validate=True)
        return {"billingId": args.billing, "output": publish(args.output, raw)}
    elif action in ("commercial-draft", "commercial-preview", "commercial-issue"):
        operation = billing.preview_issue if action == "commercial-preview" else getattr(billing, action.removeprefix("commercial-"))
        result = operation(args.case, args.billing, args.milestone, body)
    else:
        raise Problem("Commercial billing command not found.", 404, "NOT_FOUND")
    return {"output": publish(args.output, canonical(result).encode("utf-8"))} if args.output else result
