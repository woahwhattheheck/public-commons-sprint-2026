"""Routes for the original Operations work and invoice workbook."""
from __future__ import annotations
import re


def register_static(static):
    for name, media in (("operations_workbook.mjs", "text/javascript"),
                        ("operations_workbook.css", "text/css"),
                        ("WORK_INVOICE_WORKBOOK.md", "text/markdown")):
        static["/" + name] = (name, media + "; charset=utf-8")


def handle(handler, parsed, ops, method):
    match = re.fullmatch(r"/api/operations/(operation-[a-f0-9]{32})/(workbooks(?:/review-[a-f0-9]{32})?|workbook-preview|workbook-return-preview|workbook-apply)", parsed.path)
    if not match:
        return False
    case_id, action = match.groups()
    if method == "GET":
        if action == "workbooks":
            handler.send(200, {"workbooks": ops.list_workbooks(case_id)})
        elif action.startswith("workbooks/"):
            handler.send(200, ops.work_book(case_id, action.split("/")[1]))
        else:
            return False
    else:
        methods = {"workbook-preview": ops.preview_workbook,
                   "workbook-return-preview": ops.inspect_workbook_return,
                   "workbook-apply": ops.apply_workbook}
        if action not in methods:
            return False
        handler.send(200, methods[action](case_id, handler.json_body()))
    return True
