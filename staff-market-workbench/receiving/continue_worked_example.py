"""Continue one retained FSU published-example workspace through receiving.

This operator walkthrough consumes an already accepted original analysis. It
records a clearly labeled receiving exercise, its original correction context,
and the native handoff/edition/backup outcomes in that same Workspace.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone
from decimal import Decimal

APP = Path(os.environ.get("FSU_MARKET_WORKBENCH_APP", str(Path(__file__).resolve().parents[1]))).resolve()
sys.path.insert(0, str(APP))
from core import Workspace, restore
from receiving import engine


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + "\n").encode("utf-8")


def atomic(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".adc6-part")
    with temporary.open("wb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def run(args):
    workspace = Workspace(args.workspace)
    baseline = workspace.document("analysis", args.analysis)
    if baseline["result_sha256"] != args.expected_result_sha256:
        raise ValueError("The selected analysis does not match the original published result.")
    if not baseline.get("reviews") or baseline["reviews"][-1]["outcome"] != "accepted":
        raise ValueError("The original analysis requires its recorded accepted review.")
    expected = {"p25": Decimal("35200"), "p50": Decimal("37950"), "p75": Decimal("43950")}
    if any(Decimal(baseline["consensus"][key]) != value for key, value in expected.items()):
        raise ValueError("The retained analysis differs from the two-survey published illustration.")
    if baseline.get("target_date") is not None:
        raise ValueError("This published illustration has no supplied common effective date.")
    original_baseline = encoded(baseline)
    baseline_job_id = baseline["job"]["id"]
    directory = workspace.root / "receiving" / "adc6-published-example"
    ledger_path = directory / "continuation.json"
    if ledger_path.exists():
        ledger = json.loads(ledger_path.read_text("utf-8"))
        if ledger["workspace_id"] != workspace.state()["workspace"]["id"] or ledger["baseline_analysis_id"] != args.analysis:
            raise ValueError("The existing continuation belongs to a different original case.")
    else:
        ledger = {
            "schema": "fsu.published-example.receiving-continuation.v1",
            "workspace_id": workspace.state()["workspace"]["id"],
            "baseline_analysis_id": args.analysis,
            "baseline_result_sha256": args.expected_result_sha256,
            "started_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "actor": args.actor,
            "purpose": "Internal operator exercise on the original published guideline example.",
            "requests": {}, "outcomes": {}
        }
        atomic(ledger_path, encoded(ledger))

    def call(name, action, payload):
        requests = ledger["requests"]
        if name not in requests:
            requests[name] = {
                "action": action,
                "body": {
                    **payload,
                    "operation_id": "adc6-receiving-" + args.analysis + "-" + name,
                    "expected_revision": workspace.state()["workspace"]["revision"]
                }
            }
            atomic(ledger_path, encoded(ledger))
        saved = requests[name]
        if saved["action"] != action:
            raise ValueError("The retained operation has a different action: " + name)
        try:
            outcome = workspace.mutate(action, saved["body"])
        except Exception as exc:
            if getattr(exc, "code", None) != "STALE_REVISION":
                raise
            saved["body"]["expected_revision"] = workspace.state()["workspace"]["revision"]
            atomic(ledger_path, encoded(ledger))
            outcome = workspace.mutate(action, saved["body"])
        result = outcome["result"]
        ledger["outcomes"][name] = {
            "revision": outcome["revision"], "operation_revision": outcome.get("operation_revision"),
            "id": result.get("id") if isinstance(result, dict) else None,
            "sha256": (result.get("sha256") or result.get("result_sha256")) if isinstance(result, dict) else None
        }
        atomic(ledger_path, encoded(ledger))
        return result

    def rx(name, action, payload):
        return call(name, "receiving." + action, payload)

    def snapshot_for(analysis_id):
        state = workspace.extension_read("receiving")
        options = [item for item in state["snapshots"] if analysis_id in item["analysisIds"]]
        if len(options) != 1:
            raise ValueError("The accepted original analysis is not in one receiving snapshot.")
        return workspace.extension_read("receiving", "document", "snapshot", options[0]["id"])

    initial_snapshot = snapshot_for(args.analysis)
    row = next(item for item in initial_snapshot["rows"] if item["id"] == args.analysis)
    label_pointer = "/data/job/record/title"
    if not engine.resolve_pointer(row, label_pointer)[0]:
        raise ValueError("The original job record title is absent from the actual analysis.")
    profile = {
        "id": "adc6-published-comparison", "label": "Published-source receiving exercise",
        "recipient": "Internal compensation workbench review",
        "format": "csv", "lineEnding": "CRLF", "bom": True,
        "sourceNote": (
            "Configured operator-example columns for the FSU Staff Pay Administration Guidelines "
            "printed page 22 comparison. Source effective dates are unstated; monetary values retain "
            "the unrounded equal-weight consensus. This profile is the internal receiving exercise."
        ),
        "columns": [
            {"header": "Analysis identity", "pointer": "/data/id", "required": True, "editable": False},
            {"header": "Original job identity", "pointer": "/jobId", "required": True, "editable": False},
            {"header": "Job title", "pointer": label_pointer, "required": True, "editable": False},
            {"header": "Currency", "pointer": "/data/currency", "required": True, "editable": False},
            {"header": "Annual lower quartile", "pointer": "/data/consensus/p25", "required": True, "editable": False},
            {"header": "Annual median", "pointer": "/data/consensus/p50", "required": True, "editable": False},
            {"header": "Annual upper quartile", "pointer": "/data/consensus/p75", "required": True, "editable": False},
            {"header": "Delivery label", "pointer": "/data/title", "required": True, "editable": True}
        ]
    }
    preview = rx("baseline-preview", "previewHandoff", {
        "snapshot": {"id": initial_snapshot["id"]}, "profile": profile,
        "selectedRowIds": [args.analysis]
    })
    if preview["summary"]["errors"]:
        raise ValueError("Resolve the receiving profile: " + json.dumps(preview["issues"]))
    handoff = rx("baseline-handoff", "createHandoff", {
        "preview": {"snapshot": {"id": preview["snapshot"]["id"]}, "profile": preview["profile"],
                    "rows": [{"id": item["id"]} for item in preview["rows"]]},
        "expectedPreviewHash": preview["previewHash"], "actor": ledger["actor"],
        "at": ledger["started_at"]
    })
    artifacts = []
    export_by_name = {}

    def keep(name, content, mime="application/json"):
        data = content if isinstance(content, bytes) else content.encode("utf-8")
        path = directory / name
        atomic(path, data)
        item = {"path": str(path), "filename": name, "bytes": len(data), "sha256": sha(data), "mime": mime}
        artifacts.append(item)
        export_by_name[name] = data
        return data

    def export_handoff(prefix, value):
        reference = {"id": value["id"], "sha256": value["sha256"]}
        results = {}
        for format in ("csv", "tsv", "json"):
            export = rx(prefix + "-export-" + format, "exportHandoff",
                        {"handoff": reference, "format": format})
            content = export["content"].encode("utf-8")
            if len(content) != export["bytes"] or sha(content) != export["sha256"]:
                raise ValueError("The complete receiving export changed in transport.")
            keep(prefix + "-handoff." + format, content, export["mime"])
            results[format] = content
        return results

    first_exports = export_handoff("baseline", handoff)
    returned_rows = list(csv.reader(io.StringIO(first_exports["csv"].decode("utf-8-sig"), newline="")))
    headers = returned_rows[0]
    median_index = headers.index("Annual median")
    headers[median_index] = "Returned annual median"
    returned_rows[1][median_index] = "38000"
    returned_rows[1][headers.index("return_action")] = "request-pricing-review"
    returned_rows[1][headers.index("return_note")] = (
        "Operator exercise: the printed table rounds the median consensus to 38.0 thousand. "
        "Check the original 37,950 exact consensus before replacing a locked receiving amount."
    )
    buffer = io.StringIO(newline="")
    csv.writer(buffer, lineterminator="\r\n").writerows(returned_rows)
    returned_content = "\ufeff" + buffer.getvalue()
    keep("returned-rounding-question.csv", returned_content, "text/csv;charset=utf-8")
    original_headers = list(csv.reader(io.StringIO(first_exports["csv"].decode("utf-8-sig"), newline="")))[0]
    column_mapping = {header: ("Returned annual median" if header == "Annual median" else header) for header in original_headers}
    returned_preview = rx("return-preview", "previewReturn", {
        "handoff": {"id": handoff["id"], "sha256": handoff["sha256"]},
        "content": returned_content, "format": "csv", "columnMapping": column_mapping
    })
    entry = returned_preview["entries"][0]
    if len(returned_preview["entries"]) != 1 or entry["rowId"] != args.analysis or entry["status"] != "changed":
        raise ValueError("The returned original row did not retain its exact identity.")
    if not any(change["header"] == "Annual median" and change["editable"] is False for change in entry["changes"]):
        raise ValueError("The locked source amount did not require original pricing review.")
    review = rx("return-review", "reviewReturn", {
        "preview": {"handoffId": returned_preview["handoffId"], "source": returned_preview["source"]},
        "expectedPreviewHash": returned_preview["previewHash"], "actor": ledger["actor"],
        "at": ledger["started_at"],
        "decisions": [{"key": entry["key"], "action": "request-pricing-review",
                       "reason": "Resolve the returned rounded display amount in the original pricing analysis; keep its exact source amount."}]
    })
    if review["entries"][0]["original"]["source"]["data"]["id"] != args.analysis:
        raise ValueError("The saved correction lost its original analysis navigation identity.")

    selected_ids = [line["selection"]["id"] for line in baseline["lines"]]
    corrected = call("reviewed-source-analysis", "analysis", {
        "job_id": baseline_job_id, "selection_ids": selected_ids,
        "receiving_origin": {"kind": "return-review", "id": review["id"], "entryKey": entry["key"], "edition": "original"},
        "title": "FSU published illustration: exact consensus after receiving review",
        "target_date": baseline.get("target_date"), "source_mode": baseline.get("source_mode", "current"),
        "basis_note": baseline["basis_note"] + (
            " Receiving operator exercise " + review["id"] + ": retain the exact annual median "
            "37,950; the printed 38.0-thousand figure is a display rounding of that original comparison."
        )
    })
    if corrected["errors"] or any(Decimal(corrected["consensus"][key]) != value for key, value in expected.items()):
        raise ValueError("The original pricing recalculation changed the published comparison.")
    corrected_review = call("reviewed-source-acceptance", "review", {
        "analysis_id": corrected["id"], "result_sha256": corrected["result_sha256"],
        "reviewer": ledger["actor"], "outcome": "accepted",
        "notes": "Published-source operator exercise: reviewed the returned rounding question against the same original two surveys. Exact annual consensus remains 35200 / 37950 / 43950; unstated dates and zero scope adjustment remain unchanged."
    })
    current_snapshot = snapshot_for(corrected["id"])
    current_preview = rx("current-preview", "previewHandoff", {
        "snapshot": {"id": current_snapshot["id"]}, "profile": profile,
        "selectedRowIds": [corrected["id"]]
    })
    current = rx("current-handoff", "createHandoff", {
        "preview": {"snapshot": {"id": current_preview["snapshot"]["id"]},
                    "profile": current_preview["profile"], "rows": [{"id": item["id"]} for item in current_preview["rows"]]},
        "expectedPreviewHash": current_preview["previewHash"], "actor": ledger["actor"],
        "at": ledger["started_at"]
    })
    export_handoff("current", current)
    comparison = rx("edition-comparison", "compareHandoffs", {
        "previous": {"id": handoff["id"], "sha256": handoff["sha256"]},
        "current": {"id": current["id"], "sha256": current["sha256"]}
    })
    if len(comparison["entries"]) != 1 or comparison["entries"][0]["jobId"] != baseline_job_id:
        raise ValueError("The receiving editions were not paired by their original job identity.")
    compared = comparison["entries"][0]
    if compared["previousRowId"] != args.analysis or compared["currentRowId"] != corrected["id"]:
        raise ValueError("The edition comparison did not retain both original analysis IDs.")
    annual = rx("edition-review", "reviewAnnualChange", {
        "comparison": {"previous": comparison["previous"], "current": comparison["current"],
                       "matching": comparison["matching"]},
        "expectedPreviewHash": comparison["previewHash"], "actor": ledger["actor"], "at": ledger["started_at"],
        "decisions": [{"key": compared["key"], "action": "accept-update",
                       "reason": "Accept the distinct reviewed receiving edition that resolves the rounding question. Both editions retain the undated source basis and exact consensus."}]
    })

    for name, record in (("return-review", review), ("annual-review", annual)):
        export = rx(name + "-export", "exportRecord", {"kind": record["kind"], "id": record["id"]})
        content = export["content"].encode("utf-8")
        if sha(content) != export["sha256"] or len(content) != export["bytes"]:
            raise ValueError("The complete saved record export changed in transport.")
        keep(name + ".json", content, export["mime"])
    returned_download = workspace.extension_read("receiving", "download", "returned-source", review["id"])
    if returned_download["data"] != returned_content.encode("utf-8"):
        raise ValueError("The original returned file bytes did not survive the saved review.")
    records = [(handoff["kind"], handoff["id"]), (current["kind"], current["id"]),
               (review["kind"], review["id"]), (annual["kind"], annual["id"])]
    for kind, identity in records:
        saved = workspace.extension_read("receiving", "document", kind, identity)
        if saved["id"] != identity:
            raise ValueError("The saved receiving history did not reopen its original record.")
    if encoded(workspace.document("analysis", args.analysis)) != original_baseline:
        raise ValueError("The received baseline analysis or its accepted review changed.")

    report_source = APP / "receiving" / "report.mjs"
    report_inputs = [
        {"input": str(directory / "baseline-handoff.json"), "output": str(directory / "baseline-report.html")},
        {"input": str(directory / "current-handoff.json"), "output": str(directory / "current-report.html")},
        {"input": str(directory / "return-review.json"), "output": str(directory / "return-report.html")},
        {"input": str(directory / "annual-review.json"), "output": str(directory / "edition-report.html")}
    ]
    program = (
        "import fs from 'node:fs';import {pathToFileURL} from 'node:url';"
        "const {receivingReport}=await import(pathToFileURL(process.argv[1]));"
        "for(const file of JSON.parse(fs.readFileSync(0,'utf8'))){"
        "const record=JSON.parse(fs.readFileSync(file.input,'utf8'));"
        "fs.writeFileSync(file.output,receivingReport(record));}"
    )
    subprocess.run([args.node, "--input-type=module", "-e", program, str(report_source)],
                   input=json.dumps(report_inputs), text=True, check=True, cwd=str(APP))
    for item in report_inputs:
        path = Path(item["output"])
        content = path.read_bytes()
        artifacts.append({"path": str(path), "filename": path.name, "bytes": len(content),
                          "sha256": sha(content), "mime": "text/html;charset=utf-8"})

    prepared = call("whole-workspace-backup", "prepare_backup", {})
    package = workspace.backup(prepared["id"])
    restored_path = Path(args.restore).resolve()
    restored_result = restore(package, restored_path)
    reopened = Workspace(restored_path)
    if encoded(reopened.document("analysis", args.analysis)) != original_baseline:
        raise ValueError("Native restore did not preserve the accepted original pricing analysis.")
    for kind, identity in records:
        before = workspace.extension_read("receiving", "download", kind, identity)["data"]
        after = reopened.extension_read("receiving", "download", kind, identity)["data"]
        if before != after:
            raise ValueError("Native restore changed the saved receiving record: " + identity)
    for label, value in (("baseline", handoff), ("current", current)):
        for format in ("csv", "tsv", "json"):
            data = reopened.extension_read("receiving", "download", "handoff-" + format, value["id"])["data"]
            if data != export_by_name[label + "-handoff." + format]:
                raise ValueError("Native restore changed a complete receiving handback.")
    if reopened.extension_read("receiving", "download", "returned-source", review["id"])["data"] != returned_content.encode("utf-8"):
        raise ValueError("Native restore changed the retained original return file.")
    repeat_restore = restore(package, restored_path)
    if repeat_restore.get("replayed") is not True:
        raise ValueError("Reopening the same completed restore did not preserve its receiving workspace.")
    package_bytes = Path(package).read_bytes()
    outcome = {
        "schema": ledger["schema"], "stage": "native receiving, report and restore complete",
        "workspace_id": ledger["workspace_id"], "workspace": str(workspace.root),
        "baseline_analysis_id": args.analysis, "baseline_result_sha256": args.expected_result_sha256,
        "baseline_handoff_id": handoff["id"], "return_review_id": review["id"],
        "corrected_analysis_id": corrected["id"], "corrected_analysis_sha256": corrected["result_sha256"],
        "corrected_review": corrected_review, "current_handoff_id": current["id"],
        "annual_review_id": annual["id"], "original_job_id": baseline_job_id,
        "comparison": comparison["summary"], "source_basis": "Undated published illustration; exact source amounts retained.",
        "revision": workspace.state()["workspace"]["revision"], "artifacts": artifacts,
        "backup": {"id": prepared["id"], "path": str(package), "bytes": len(package_bytes), "sha256": sha(package_bytes)},
        "restored": {"directory": str(restored_path), "workspace_id": reopened.state()["workspace"]["id"],
                     "revision": reopened.state()["workspace"]["revision"], "replayed": repeat_restore["replayed"]},
        "source_files": [{"path": str(APP / name), "sha256": sha((APP / name).read_bytes())}
                         for name in ["core.py", "server.py", "receiving/engine.py", "receiving/host.py",
                                      "receiving/browser.mjs", "receiving/report.mjs", "web/receiving-bridge.mjs"]]
    }
    atomic(directory / "NATIVE-RESULT.json", encoded(outcome))
    print(json.dumps(outcome, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--analysis", required=True)
    parser.add_argument("--expected-result-sha256", required=True)
    parser.add_argument("--restore", required=True)
    parser.add_argument("--actor", default="ADC6 published-source operator exercise")
    parser.add_argument("--node", default="node")
    run(parser.parse_args())
