"""CLI for original work charge review, recovery and complete export."""
import base64
import json
from model import Problem, canonical
from operations_commercial_adapter import commercial_store


def register(command):
    for action in ("authority", "save-authority", "catalog", "show", "refresh", "preview", "prepare", "apply", "cancel", "preview-issue", "issue", "export"):
        parser = command("work-billing-" + action, "Review or continue original customer work recovery", case=True, output=True)
        if action == "authority":
            parser.add_argument("--authority", required=True)
        if action not in ("authority", "save-authority", "catalog", "preview", "prepare"):
            parser.add_argument("--charge", required=True)
        if action in ("save-authority", "preview", "prepare", "apply", "cancel", "issue"):
            parser.add_argument("--file", required=True, help="Complete original JSON request; no inferred commercial authorization")


def operate(operations, args, read_bytes, publish):
    if not args.operation.startswith("work-billing-"):
        return None
    commercial_store(operations)
    desk = operations.work_billing
    action = args.operation.removeprefix("work-billing-")
    body = {}
    if getattr(args, "file", None):
        try:
            body = json.loads(read_bytes(args.file))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Use the complete JSON operator request.", 422, "WORK_BILLING_INPUT") from exc
        if not isinstance(body, dict):
            raise Problem("Use the complete JSON operator request.", 422, "WORK_BILLING_INPUT")
    if action == "authority":
        result = desk.authority(args.case, args.authority)
    elif action == "save-authority":
        result = desk.save_authority(args.case, body)
    elif action == "catalog":
        result = desk.catalog(args.case)
    elif action in ("show", "refresh"):
        result = desk.get(args.case, args.charge, action == "refresh")
    elif action in ("preview", "prepare"):
        result = getattr(desk, action)(args.case, body)
    elif action == "preview-issue":
        result = desk.preview_issue(args.case, args.charge)
    elif action in ("apply", "cancel", "issue"):
        result = getattr(desk, action)(args.case, args.charge, body)
    elif action == "export":
        if not args.output:
            raise Problem("Choose --output for the complete work-billing ZIP.", 422, "OUTPUT_REQUIRED")
        exported = desk.export_bundle(args.case, args.charge)
        return {"chargeId": args.charge, "output": publish(args.output, base64.b64decode(exported["contentBase64"], validate=True))}
    else:
        raise Problem("Hourly Work billing command not found.", 404, "NOT_FOUND")
    return {"output": publish(args.output, canonical(result).encode())} if args.output else result
