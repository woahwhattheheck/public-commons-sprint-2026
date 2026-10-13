"""Authenticated work-recovery billing routes on the original Operations server."""
import base64
import re
from urllib.parse import unquote
from model import Problem
from operations_commercial_adapter import commercial_store

_CASE = re.compile(r"operation-[a-f0-9]{32}")
_CHARGE = re.compile(r"work-billing-[a-f0-9]{32}")


def handle(handler, parsed, operations, method):
    root = "/api/operations/"
    if not parsed.path.startswith(root):
        return False
    parts = [unquote(item) for item in parsed.path[len(root):].split("/")]
    if len(parts) < 2 or parts[1] != "work-billing":
        return False
    if not _CASE.fullmatch(parts[0]):
        raise Problem("Hourly Work billing case not found.", 404, "NOT_FOUND")
    commercial_store(operations)
    desk, case_id, rest = operations.work_billing, parts[0], parts[2:]
    if method == "GET":
        if not rest:
            result = desk.catalog(case_id)
        elif len(rest) == 2 and rest[0] == "authorities":
            result = desk.authority(case_id, rest[1])
        elif len(rest) == 1 and _CHARGE.fullmatch(rest[0]):
            result = desk.get(case_id, rest[0])
        elif len(rest) == 2 and _CHARGE.fullmatch(rest[0]) and rest[1] == "export.zip":
            result = desk.export_bundle(case_id, rest[0])
            handler.send(200, base64.b64decode(result["contentBase64"], validate=True), result["mediaType"], result["filename"])
            return True
        else:
            raise Problem("Hourly Work billing page not found.", 404, "NOT_FOUND")
    elif method == "POST":
        body = handler.json_body()
        if rest == ["authorities"]:
            result = desk.save_authority(case_id, body)
        elif len(rest) == 1 and rest[0] in ("preview", "prepare"):
            result = getattr(desk, rest[0])(case_id, body)
        elif len(rest) == 2 and _CHARGE.fullmatch(rest[0]):
            if rest[1] == "preview-issue":
                if body:
                    raise Problem("Invoice preview has no mutation fields.", 422, "WORK_BILLING_INPUT")
                result = desk.preview_issue(case_id, rest[0])
            elif rest[1] == "refresh":
                if body:
                    raise Problem("Refresh has no mutation fields.", 422, "WORK_BILLING_INPUT")
                result = desk.get(case_id, rest[0], True)
            elif rest[1] in ("apply", "cancel", "issue"):
                result = getattr(desk, rest[1])(case_id, rest[0], body)
            else:
                raise Problem("Hourly Work billing operation not found.", 404, "NOT_FOUND")
        else:
            raise Problem("Hourly Work billing operation not found.", 404, "NOT_FOUND")
    else:
        return False
    handler.send(200, result)
    return True
