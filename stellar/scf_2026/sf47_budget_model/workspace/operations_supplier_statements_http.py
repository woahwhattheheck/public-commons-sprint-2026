"""Routes on the existing Grant Operations HTTP owner."""
from __future__ import annotations
import re
from model import Problem
ROOT = re.compile(r"^/api/operations/(operation-[a-f0-9]{32})/supplier-statements(?:/(.*))?$")

def handle(handler, parsed, ops, method):
    match = ROOT.fullmatch(parsed.path)
    if not match:
        return False
    case_id, selected = match.groups()
    if method == "GET":
        if not selected:
            handler.send(200, ops.list_supplier_statements(case_id))
        elif selected.endswith("/export.zip"):
            review_id = selected.removesuffix("/export.zip")
            handler.send(200, ops.export_supplier_statement(case_id, review_id), "application/zip",
                         filename="supplier-statement-" + review_id + ".zip")
        elif re.fullmatch(r"review-[a-f0-9]{32}", selected):
            handler.send(200, ops.supplier_statement(case_id, selected))
        else:
            raise Problem("Unknown supplier statement selection.", 404, "NOT_FOUND")
    elif method == "POST":
        body = handler.json_body()
        if selected == "seed":
            result = ops.seed_supplier_statement(case_id, body)
        elif selected == "preview":
            result = ops.preview_supplier_statement(case_id, body)
        elif selected == "source":
            result = ops.inspect_supplier_statement_source(case_id, body)
        elif selected == "request":
            result = ops.supplier_statement_request(case_id, body)
        else:
            raise Problem("Unknown supplier statement action.", 404, "NOT_FOUND")
        handler.send(200, result)
    else:
        raise Problem("This supplier statement route does not accept the method.", 405, "METHOD_NOT_ALLOWED")
    return True
