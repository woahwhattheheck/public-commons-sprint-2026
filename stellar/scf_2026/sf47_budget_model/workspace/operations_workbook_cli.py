"""Complete work/invoice preparation through the original CLI."""
from __future__ import annotations
import base64
import json
from pathlib import Path
from model import canonical, Problem


def register(command, mutation):
    command("workbooks", "List all retained work/invoice workbook editions", case=True, output=True)
    target = command("workbook-show", "Open one complete saved workbook edition", case=True, output=True)
    target.add_argument("--book", required=True)
    for verb in ("prepare", "save", "return"):
        target = command("workbook-" + verb, "Save a complete native workbook preparation or returned edition", case=True, output=True)
        mutation(target, version=True, note_required=True)
        target.add_argument("--input", required=True, help="Complete action data JSON")
    target = command("workbook-preview", "Compare full workbook input with the current native case", case=True, output=True)
    target.add_argument("--input", required=True)
    target.add_argument("--expected-version", required=True, type=int)
    target = command("workbook-return-preview", "Read original XLSX cells and compare its saved edition", case=True, output=True)
    target.add_argument("--book", required=True)
    target.add_argument("--xlsx", required=True)
    target.add_argument("--last-work-row", type=int, required=True)
    target.add_argument("--last-invoice-row", type=int, required=True)
    target.add_argument("--hidden-rows", choices=("include", "exclude"), default="include")
    target.add_argument("--decisions", help="Complete returned-field conflict decisions JSON")
    target = command("workbook-apply", "Apply one reviewed saved workbook through original native commands", case=True, output=True)
    mutation(target, version=True, note_required=True)
    target.add_argument("--book", required=True)
    target.add_argument("--expected-preview-sha256", required=True)


def operates(action):
    return action == "workbooks" or action.startswith("workbook-")


def operate(ops, args, read_bytes, publish):
    action = args.operation
    def read_json(path):
        try:
            value = json.loads(read_bytes(path))
        except (ValueError, UnicodeError) as exc:
            raise Problem("Use complete UTF-8 workbook input JSON.", 422, "WORKBOOK_INPUT") from exc
        if not isinstance(value, dict):
            raise Problem("Use a complete workbook object.", 422, "WORKBOOK_INPUT")
        return value
    if action == "workbooks":
        result = {"workbooks": ops.list_workbooks(args.case)}
    elif action == "workbook-show":
        result = ops.work_book(args.case, args.book)
    elif action == "workbook-preview":
        result = ops.preview_workbook(args.case, {**read_json(args.input), "expectedVersion": args.expected_version})
    elif action == "workbook-return-preview":
        raw = read_bytes(args.xlsx, 8 * 1024 * 1024)
        result = ops.inspect_workbook_return(args.case, {"bookId": args.book,
            "source": {"filename": Path(args.xlsx).name, "dataBase64": base64.b64encode(raw).decode()},
            "selections": {"WORK": {"lastRow": args.last_work_row, "hiddenRows": args.hidden_rows},
                          "INVOICES": {"lastRow": args.last_invoice_row, "hiddenRows": args.hidden_rows}},
            "decisions": read_json(args.decisions) if args.decisions else {}})
    elif action == "workbook-apply":
        result = ops.apply_workbook(args.case, {"bookId": args.book, "expectedVersion": args.expected_version,
            "expectedPreviewSha256": args.expected_preview_sha256, "actor": args.actor,
            "note": args.note, "requestId": args.request_id})
    else:
        result = ops.command(args.case, {"action": action.replace("workbook-", "workbook."),
            "data": read_json(args.input), "expectedVersion": args.expected_version,
            "actor": args.actor, "note": args.note, "requestId": args.request_id})
    raw = (canonical(result) + "\n").encode()
    if args.output:
        publish(args.output, raw)
    else:
        print(raw.decode(), end="")
    return 0
