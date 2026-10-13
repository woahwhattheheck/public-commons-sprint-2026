"""Operate one complete original work/invoice workbook and cold receiving course.

Use the real checked-in SF47 planner and original Operations owner. Output is a
private WALKTHROUGH workspace with durable original requests and all artifacts.
"""
from __future__ import annotations
import argparse
import base64
from copy import deepcopy
from datetime import date
import hashlib
import json
import os
from pathlib import Path
import subprocess
import uuid

from model import Workspace, canonical
from operations import Operations
import operations_workbook as workbook

HERE = Path(__file__).resolve().parent


def write_new(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + ".prepared-" + uuid.uuid4().hex)
    try:
        with temporary.open("xb") as stream:
            os.chmod(temporary, 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.read_bytes() != raw:
                raise RuntimeError("Preserve the existing original receiving artifact: " + str(path))
    finally:
        temporary.unlink(missing_ok=True)


def json_file(path, value):
    write_new(path, (canonical(value) + "\n").encode())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--source", default=str(HERE.parent / "sf10_current_candidate.json"))
    parser.add_argument("--node", default="node")
    parser.add_argument("--date", default=date.today().isoformat())
    args = parser.parse_args()
    output = Path(args.output).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    original = {"schema": "stellar-forge.sf47-workbook-receiving.v1", "source": str(Path(args.source).resolve()),
                "date": args.date}
    settings_file = output / "receiving-input.json"
    if settings_file.exists():
        original = json.loads(settings_file.read_text())
    else:
        json_file(settings_file, original)
    ws = Workspace(output / "author", original["source"])
    try:
        ops = Operations(ws)
        def request(label, make_body, invoke):
            path = output / "requests" / (label + ".json")
            if path.exists():
                body = json.loads(path.read_text())
            else:
                body = make_body()
                body["requestId"] = "workbook-course-" + hashlib.sha256(label.encode()).hexdigest()[:32]
                json_file(path, body)
            result = invoke(body)
            json_file(output / "receipts" / (label + ".json"), result)
            return result
        plan = ws.read(ws.list()[0]["id"])
        case = request("create", lambda: {"planId": plan["id"], "selectedRevision": plan["revision"],
            "expectedContentSha256": plan["contentSha256"], "actor": "Workbook receiving operator",
            "name": "Internal work and invoice workbook receiving", "mode": "WALKTHROUGH",
            "calendarStart": original["date"]}, ops.create)
        case_id = case["id"]
        def command(label, action, data):
            return request(label, lambda: {"expectedVersion": ops.read(case_id)["program"]["version"],
                "actor": "Workbook receiving operator", "note": "Internal complete workbook course: " + label,
                "action": action, "data": data}, lambda body: ops.command(case_id, body))
        contributor = command("contributor", "contributor.save", {"name": "Workbook receiving contributor",
                                                                "kind": "ROLE"})["recordId"]
        cost = plan["scenario"]["future_costs"][0]["id"]
        day = original["date"]
        work_data = {"contributorId": contributor, "costId": cost, "description": "Original workbook receiving work",
                     "startDate": day, "endDate": day, "hours": "2.5", "fundingBasis": "INTERNAL"}
        work_id = command("work", "work.save", work_data)["recordId"]
        invoice_data = {"contributorId": contributor, "number": "00017", "issuedDate": day, "dueDate": day,
            "currency": "USD", "lines": [{"id": "line-01", "costId": cost, "description": "Original receiving invoice",
                                        "amountUsd": "120.00", "workIds": [work_id]}]}
        invoice_id = command("invoice", "invoice.save", invoice_data)["recordId"]
        book_id = command("prepare", "workbook.prepare", {"name": "Original contributor return",
                                                          "contributorIds": [contributor]})["recordId"]
        book = ops.work_book(case_id, book_id)
        export_context = {**book["snapshot"], "program": {**book["snapshot"]["program"]},
                          "sources": book["snapshot"]["sources"]}
        returned = deepcopy(book)
        returned["workbook"]["rows"]["WORK"][0].update(hours="3.5", description="Reviewed returned workbook work")
        returned["workbook"]["rows"]["INVOICES"][0]["amountUsd"] = "125.45"
        returned["workbook"]["rows"]["WORK"].append({"rowId": "new-receiving-work", "contributor": contributor,
            "costId": cost, "description": "Additional original receiving work", "startDate": day, "endDate": day,
            "hours": "1.25", "fundingBasis": "INTERNAL"})
        returned["workbook"]["rows"]["INVOICES"].append({"rowId": "new-receiving-invoice", "invoiceId": "",
            "contributor": contributor, "number": "00018", "issuedDate": day, "dueDate": day, "lineId": "line-001",
            "description": "New receiving invoice", "amountUsd": "20.10", "currency": "USD",
            "costId": cost, "workIds": work_id})
        json_file(output / "export-input.json", {"saved": book, "current": export_context})
        json_file(output / "return-input.json", {"saved": returned, "current": export_context})
        writer = (
            "import{readFile,writeFile,open,link,unlink}from'node:fs/promises';\n"
            "import{webcrypto}from'node:crypto';globalThis.crypto??=webcrypto;\n"
            "const{createOperationsWorkbookArchive}=await import(" + json.dumps((HERE / "source-workbook-export.mjs").as_uri()) + ");\n"
            "const input=JSON.parse(await readFile(process.argv[2],'utf8'));\n"
            "const output=await createOperationsWorkbookArchive(input.saved,input.current);\n"
            "const temp=process.argv[3]+\x27.prepared-\x27+process.pid;\n"
            "try{await writeFile(temp,output.workbook.data,{mode:0o600,flag:\x27wx\x27});const f=await open(temp,\x27r\x27);try{await f.sync();}finally{await f.close();}await link(temp,process.argv[3]);}finally{await unlink(temp).catch(()=>{});}\n")
        write_new(output / "write-original-workbook.mjs", writer.encode())
        for stem in ("export", "return"):
            path = output / (stem + ".xlsx")
            if not path.exists():
                subprocess.run([args.node, str(output / "write-original-workbook.mjs"),
                    str(output / (stem + "-input.json")), str(path)], check=True)
        command("concurrent-work", "work.save", {**work_data, "id": work_id, "hours": "2.75"})
        receive_data = {"bookId": book_id, "source": {"filename": "return.xlsx",
            "dataBase64": base64.b64encode((output / "return.xlsx").read_bytes()).decode()},
            "selections": {"WORK": {"lastRow": 3, "hiddenRows": "include"},
                           "INVOICES": {"lastRow": 3, "hiddenRows": "include"}}, "decisions": {}}
        returned_id = command("returned", "workbook.return", {"bookId": book_id, "return": receive_data})["recordId"]
        saved_return = ops.work_book(case_id, returned_id)
        conflict_file = output / "original-current-returned.json"
        if not conflict_file.exists():
            comparison = ops.preview_workbook(case_id, {"bookId": returned_id,
                "expectedVersion": ops.read(case_id)["program"]["version"]})
            if len(comparison["comparison"]["conflicts"]) != 1:
                raise RuntimeError("The original concurrent hours change must be visible.")
            json_file(conflict_file, comparison)
        choices = {"case/WORK/" + work_id + "/hours": {"choice": "RETURNED",
            "reason": "Internal course operator selected the complete returned work after comparing 2.5, 2.75 and 3.5 hours."}}
        ready_id = command("resolved", "workbook.save", {"bookId": returned_id,
            "rows": saved_return["workbook"]["rows"], "decisions": choices, "intakeDecisions": {}})["recordId"]
        preview_file = output / "reviewed-native-preview.json"
        if preview_file.exists():
            preview = json.loads(preview_file.read_text())
        else:
            preview = ops.preview_workbook(case_id, {"bookId": ready_id,
                "expectedVersion": ops.read(case_id)["program"]["version"]})
            if not preview["ready"]:
                raise RuntimeError("Resolve the native receiving preview: " + canonical(preview["issues"]))
            json_file(preview_file, preview)
        application = request("apply", lambda: {"bookId": ready_id, "expectedVersion": preview["caseVersion"],
            "expectedPreviewSha256": preview["previewSha256"], "actor": "Workbook receiving operator",
            "note": "Apply the complete reviewed internal workbook return"}, lambda body: ops.apply_workbook(case_id, body))
        apply_body = json.loads((output / "requests/apply.json").read_text())
        if ops.apply_workbook(case_id, apply_body) != application:
            raise RuntimeError("The exact original request did not replay its accepted result.")
        native = ops.read(case_id)
        if next(r for r in native["records"]["work"] if r["id"] == work_id)["hours"] != "3.5":
            raise RuntimeError("The original work record did not retain its reviewed hours.")
        if next(r for r in native["records"]["invoices"] if r["id"] == invoice_id)["totalUsd"] != "125.45":
            raise RuntimeError("The original invoice did not recalculate its reviewed amount.")
        if len(native["records"]["work"]) != 2 or len(native["records"]["invoices"]) != 2:
            raise RuntimeError("The complete new-row Work Intake did not reach the original records.")
        browser_book = command("browser-prepared", "workbook.prepare", {"name": "Receiving browser work and invoice preparation", "contributorIds": [contributor]})["recordId"]
        empty_book = command("browser-empty", "workbook.prepare", {"name": "Receiving empty workbook", "contributorIds": []})["recordId"]
        native = ops.read(case_id)
        raw = ops.export(case_id)
        # Native exports include export time. Keep the first complete accepted
        # archive as the receiving input across a resumed course.
        bundle_path = output / "complete-case.zip"
        if bundle_path.exists():
            raw = bundle_path.read_bytes()
        else:
            write_new(bundle_path, raw)
        json_file(output / "author-case.json", native)
        receipt = {"schema": original["schema"], "caseId": case_id, "appliedBookId": application["recordId"],
                   "workId": work_id, "invoiceId": invoice_id, "preparedBookId": browser_book, "emptyBookId": empty_book,
                   "archiveBytes": len(raw), "archiveSha256": hashlib.sha256(raw).hexdigest(),
                   "originalPlanContentSha256": plan["contentSha256"]}
        for generation in (1, 2):
            receiver = Workspace(output / ("receiver-" + str(generation)), original["source"])
            try:
                received_ops = Operations(receiver)
                accepted = received_ops.import_bundle(raw, "Workbook cold receiving " + str(generation),
                    "workbook-cold-" + str(generation), "Independent receiving operator")
                reopened = received_ops.read(accepted["id"])
                received_book = received_ops.work_book(accepted["id"], application["recordId"])
                if reopened["records"] != native["records"] or received_book != ops.work_book(case_id, application["recordId"]):
                    raise RuntimeError("The complete original records or workbook history changed on receiving.")
                json_file(output / ("cold-receipt-" + str(generation) + ".json"), accepted)
                next_path = output / ("cold-case-" + str(generation) + ".zip")
                if next_path.exists():
                    raw = next_path.read_bytes()
                else:
                    raw = received_ops.export(accepted["id"])
                    write_new(next_path, raw)
            finally:
                receiver.close()
        json_file(output / "native-receiving.json", receipt)
        print(canonical(receipt))
    finally:
        ws.close()


if __name__ == "__main__":
    main()
