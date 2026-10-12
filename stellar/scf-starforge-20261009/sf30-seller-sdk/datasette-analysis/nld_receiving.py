#!/usr/bin/env python3
"""One complete retained Datasette -> NLD -> Analysis customer receiving operation.

The caller selects the existing, stopped original Analysis workspace and complete
source edition. NLD writes only this adapter's local SQLite reference target.
The original HTTP operator, report/workbook engines and archive receiver perform
all workspace work. This programme never fetches a publisher or installs NLD.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import platform
import stat
import sys
import tempfile

HERE = Path(__file__).resolve().parent
CHECKOUT = HERE.parents[3]
PYTHON = HERE.parents[1] / "sf88-operator-buyer-cli" / "python"
for path in (PYTHON, HERE):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from nld_contract import SCHEMA, need, NldError, identifier, identity, encoded, sha, read, load, publish, file_identity, check_file, sync
from receiving import operator, request, download, identify, write_record
from stellar_forge_buyer.workspace_archive_receive import restore_archive

PROGRAMME = SCHEMA + "/native-receiving"
SOURCE_FILES = ["nld_contract.py", "nld_task.py", "nld_worker.py", "nld_adapter.py",
                "nld_cli.py", "nld_receiving.py", "nld_operator.mjs", "model.py",
                "operator_server.py", "operator_client.py", "operator_client.pyi",
                "operator.html", "operator.mjs", "operator.css", "cli.py",
                "source.py", "recipes.py", "receiving.py"]

def emit(value):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False), flush=True)

def private(path):
    path = Path(path).expanduser().absolute()
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    need(path.resolve() == path and path.is_dir(), "NLD_RECEIVING_CANONICAL_DIRECTORY")
    return path

@contextmanager
def programme_lock(directory):
    import fcntl
    fd = os.open(directory / ".programme.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        raise NldError("NLD_ORIGINAL_PROGRAMME_ACTIVE", "Continue its existing process.") from None
    try:
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)

def selected_project(client, project_id):
    state = client.nld_status(project_id=project_id)
    need(state["schema"] == SCHEMA and len(state["projects"]) == 1, "NLD_RECEIVING_PROJECT_REQUIRED")
    project = state["projects"][0]
    need(project["id"] == project_id, "NLD_RECEIVING_PROJECT_CHANGED")
    return project

def selected_run(client, project_id, run_id):
    project = selected_project(client, project_id)
    run = next((r for r in project["runs"] if r["id"] == run_id), None)
    need(run is not None and run["status"] == "COMPLETE", "NLD_RECEIVING_NATIVE_RUN_INCOMPLETE")
    need(run["completed"]["native_uid"] == run_id, "NLD_RECEIVING_NATIVE_UID_CHANGED")
    return project, run

def all_rows(client, project_id, *, definition_id=None, run_id=None, kind="source"):
    result, offset, total, columns = [], 0, None, None
    while True:
        page = client.nld_rows(project_id=project_id, definition_id=definition_id,
                              run_id=run_id, kind=kind, offset=offset, limit=500)
        need(page.get("schema") == SCHEMA + "/rows" and page["project_id"] == project_id
             and page["kind"] == kind and page["offset"] == offset, "NLD_RECEIVING_ROW_PAGE_CHANGED")
        if definition_id is not None:
            need(page["definition_id"] == definition_id, "NLD_RECEIVING_ROW_DEFINITION_CHANGED")
        if run_id is not None:
            need(page["run_id"] == run_id, "NLD_RECEIVING_ROW_RUN_CHANGED")
        if total is None:
            total, columns = page["total"], page["columns"]
            need(type(total) is int and total >= 0, "NLD_RECEIVING_ROW_COUNT_INVALID")
        need(page["total"] == total and page["columns"] == columns, "NLD_RECEIVING_ROW_SCHEMA_CHANGED")
        result.extend(page["rows"])
        next_offset = page["next_offset"]
        if next_offset is None:
            need(len(result) == total, "NLD_RECEIVING_ROWS_INCOMPLETE")
            return {"columns": columns, "rows": result, "row_count": total,
                    "rows_sha256": identity(result)}
        need(next_offset == offset + len(page["rows"]) and next_offset > offset and next_offset < total,
             "NLD_RECEIVING_ROW_CONTINUATION_CHANGED")
        offset = next_offset

def frozen_report(client, project_id, run_id, directory):
    project, run = selected_run(client, project_id, run_id)
    report = next((r for r in project["reports"] if r["run_id"] == run_id and r["status"] == "COMPLETE"), None)
    need(report is not None, "NLD_RECEIVING_REPORT_INCOMPLETE")
    products = [download(client, descriptor, directory, edition_id=report["edition_id"])
                for descriptor in report["files"]]
    need({f["kind"] for f in report["files"]} == {"workbook", "report"}
         and len(products) == 5, "NLD_RECEIVING_COMPLETE_REPORT_FILES")
    return {"native": run, "report": report, "files": products}

def workspace_delivery(client, project_id, programme_id, phase, directory, *, resume, timeout):
    result = request(client, "nld.pack", {"project_id": project_id},
                     operation_id=programme_id, phase=phase, resume=resume, timeout=timeout)
    delivery = result["result"]
    need(delivery["project_id"] == project_id and delivery["schema"] == SCHEMA + "/delivery",
         "NLD_RECEIVING_DELIVERY_CHANGED")
    original = delivery["original_workspace_export"]
    files = [download(client, descriptor, directory) for descriptor in original["files"]]
    archive = next((f for f in files if f["name"] == "workspace"), None)
    need(archive is not None, "NLD_RECEIVING_WHOLE_WORKSPACE_REQUIRED")
    return {"request_id": result["id"], "delivery": delivery, "files": files, "archive": archive}

def equivalent_files(before, after):
    select = lambda files: [{k: r[k] for k in ("name", "filename", "bytes", "sha256")} for r in files]
    return select(before) == select(after)

def validate_saved_output(receipt):
    for collection in ("first_products", "received_products", "revision_two_products"):
        if receipt.get(collection):
            for item in receipt[collection]["files"]:
                actual = file_identity(item["path"])
                need(all(actual[k] == item[k] for k in ("bytes", "sha256")), "NLD_RECEIVING_SAVED_OUTPUT_CHANGED")
    for collection in ("first_delivery", "second_delivery"):
        if receipt.get(collection):
            for item in receipt[collection]["files"]:
                actual = file_identity(item["path"])
                need(all(actual[k] == item[k] for k in ("bytes", "sha256")), "NLD_RECEIVING_SAVED_ARCHIVE_CHANGED")
    for item in receipt.get("retained_results", []):
        actual = file_identity(item["path"])
        need(all(actual[k] == item[k] for k in ("bytes", "sha256")), "NLD_RECEIVING_SAVED_RESULT_CHANGED")

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, help="Existing stopped original Analysis workspace")
    parser.add_argument("--workspace-id", required=True, help="Its actual saved Analysis UUID")
    parser.add_argument("--operation-id", required=True, help="Original Datasette Analysis operation, 32 hex")
    parser.add_argument("--edition-id", required=True, help="Actual complete imported source edition, 64 hex")
    parser.add_argument("--programme-id", required=True, help="Retain the same 32-hex programme identity")
    parser.add_argument("--specification", required=True, help="Complete reviewed specification JSON")
    parser.add_argument("--nld-python", required=True, help="Existing pinned NLD Python 3.12/3.13 environment")
    parser.add_argument("--destination", required=True)
    parser.add_argument("--operator", required=True)
    parser.add_argument("--note", required=True)
    parser.add_argument("--expected-rows", type=int, required=True)
    parser.add_argument("--backfill-count", type=int, default=3)
    parser.add_argument("--checkout", default=str(CHECKOUT))
    parser.add_argument("--node", default="node")
    parser.add_argument("--wait-seconds", type=float, default=3600)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)
    identifier(args.operation_id); identifier(args.programme_id); identifier(args.edition_id, full=True)
    identifier(args.workspace_id)
    need(args.operator.strip() and args.note.strip(), "NLD_RECEIVING_OPERATOR_REQUIRED")
    need(type(args.expected_rows) is int and args.expected_rows > 0
         and 0 < args.backfill_count <= args.expected_rows, "NLD_RECEIVING_EXPLICIT_ROW_SCOPE")
    workspace = Path(args.workspace).expanduser().absolute()
    checkout = Path(args.checkout).expanduser().absolute()
    need(workspace.is_dir() and workspace.resolve() == workspace, "NLD_EXISTING_ANALYSIS_WORKSPACE_REQUIRED")
    destination = private(args.destination)
    need(not destination.is_relative_to(workspace) and not workspace.is_relative_to(destination),
         "NLD_RECEIVING_SEPARATE_DELIVERY_DIRECTORY")
    spec_raw = read(args.specification)
    spec = load(args.specification)
    files = [{"path": p, **file_identity(HERE / p)} for p in SOURCE_FILES]
    # The repository ref is not guessed; the exact entered source bytes and
    # selected runtime are retained independently of any publication claim.
    intent = {"schema": PROGRAMME, "programme_id": args.programme_id,
              "workspace": str(workspace), "workspace_id": args.workspace_id,
              "operation_id": args.operation_id, "edition_id": args.edition_id,
              "source_files": files, "specification": {"bytes": len(spec_raw), "sha256": sha(spec_raw)},
              "nld_python": args.nld_python, "operator": args.operator, "note": args.note,
              "expected_rows": args.expected_rows, "backfill_count": args.backfill_count,
              "checkout": str(checkout), "node": args.node, "destination": str(destination)}
    project_id = identify(args.programme_id, "REVIEWED_NLD_PROJECT")
    full_id = identify(args.programme_id, "NLD_FULL")
    delta_id = identify(args.programme_id, "NLD_DELTA")
    backfill_id = identify(args.programme_id, "NLD_RECEIVED_BACKFILL")
    receipt_path = destination / "nld-receiving.json"
    with programme_lock(destination):
        if receipt_path.exists():
            receipt = load(receipt_path)
            need(receipt.get("intent") == intent, "NLD_ORIGINAL_RECEIVING_INPUT_CHANGED")
            validate_saved_output(receipt)
            if receipt.get("status") == "COMPLETE":
                emit({"schema": PROGRAMME, "status": "COMPLETE", "reused": True,
                      "programme_id": args.programme_id, "receipt": str(receipt_path),
                      "workspace_id": args.workspace_id, "source_requests": 0,
                      "native_replays": 0, "final_workspace": receipt["final_workspace"]})
                return 0
            need(args.resume, "NLD_ORIGINAL_RECEIVING_RESUME_REQUIRED")
        else:
            receipt = {"schema": PROGRAMME, "intent": intent, "status": "PREPARED", "project_id": project_id,
                       "retained_results": [], "source_requests": 0}
            write_record(receipt_path, receipt)
        def save(phase, **values):
            receipt.update(status=phase, **values)
            write_record(receipt_path, receipt)
            emit({"schema": PROGRAMME, "phase": phase, "programme_id": args.programme_id,
                  "project_id": project_id, "receipt": str(receipt_path)})
        def retain(filename, value):
            path = destination / filename
            descriptor = publish(path, encoded(value))
            item = {**descriptor, "path": str(path)}
            prior = next((r for r in receipt["retained_results"] if r["path"] == item["path"]), None)
            need(prior is None or prior == item, "NLD_RECEIVING_RESULT_CHANGED")
            if prior is None:
                receipt["retained_results"].append(item)
            return item
        def perform(client, action, body, phase):
            return request(client, action, body, operation_id=args.programme_id,
                           phase=phase, resume=args.resume, timeout=args.wait_seconds)["result"]
        try:
            if "first_delivery" not in receipt:
                with operator(workspace, checkout=checkout, node=args.node, operation_id=args.operation_id) as (client, workspace_id):
                    need(workspace_id == args.workspace_id, "NLD_EXISTING_WORKSPACE_ID_CHANGED")
                    status = client.status()
                    edition = next((e for e in status["state"]["editions"] if e["edition_id"] == args.edition_id), None)
                    need(edition is not None and edition["status"] == "COMPLETE"
                         and edition["row_count"] == args.expected_rows, "NLD_ORIGINAL_COMPLETE_EDITION_REQUIRED")
                    save("ORIGINAL_SELECTED", original_edition=edition,
                         entered_runtime={"python": platform.python_version(), "executable": sys.executable})
                    prepared = perform(client, "nld.prepare", {"project_id": project_id,
                        "edition_id": args.edition_id, "specification": spec}, "PREPARE")
                    definition_id = prepared["definition"]["id"]
                    need(prepared["definition"]["row_count"] == args.expected_rows, "NLD_SOURCE_ROW_COUNT_CHANGED")
                    source = all_rows(client, project_id, definition_id=definition_id)
                    need(source["row_count"] == args.expected_rows, "NLD_COMPLETE_PROJECTION_REQUIRED")
                    retain("source-projection-rows.json", source)
                    save("PREPARED", definition_id=definition_id, original_rows_sha256=source["rows_sha256"])
                    run_base = {"project_id": project_id, "definition_id": definition_id,
                                "operator": args.operator, "python": args.nld_python, "keys": None, "limit": None}
                    full = perform(client, "nld.execute", {**run_base, "run_id": full_id, "strategy": "FULL",
                        "note": args.note + " — full retained selected source."}, "FULL")
                    coverage = full["run"]["completed"]["coverage"]
                    need(coverage["selected_processing_keys"] == args.expected_rows
                         and coverage["matching_rows"] == args.expected_rows
                         and coverage["missing_rows"] == coverage["different_rows"] == 0,
                         "NLD_FULL_NATIVE_COVERAGE_INCOMPLETE")
                    before = all_rows(client, project_id, run_id=full_id, kind="target")
                    need(sorted(before["rows"], key=lambda r: r["_sf_business_key"]) ==
                         sorted(source["rows"], key=lambda r: r["_sf_business_key"]),
                         "NLD_FULL_ORIGINAL_ROW_READBACK_CHANGED")
                    retain("full-native-target-rows.json", before)
                    first_products = frozen_report(client, project_id, full_id, private(destination / "original-products"))
                    save("FULL_COMPLETE", first_products=first_products, full_native_uid=full_id,
                         full_target_sha256=before["rows_sha256"])
                    delta = perform(client, "nld.execute", {**run_base, "run_id": delta_id, "strategy": "DELTA",
                        "note": args.note + " — same immutable content edition, explicit delta continuation."}, "DELTA")
                    need(delta["run"]["completed"]["coverage"]["selected_processing_keys"] == 0,
                         "NLD_UNCHANGED_DELTA_SELECTION_CHANGED")
                    after = all_rows(client, project_id, run_id=delta_id, kind="target")
                    need(after == before, "NLD_EMPTY_DELTA_TARGET_CHANGED")
                    retain("unchanged-delta-target-rows.json", after)
                    save("DELTA_COMPLETE", delta_native_uid=delta_id, unchanged_delta_target_sha256=after["rows_sha256"])
                    delivery = workspace_delivery(client, project_id, args.programme_id, "FIRST_DELIVERY",
                        private(destination / "original-delivery"), resume=args.resume, timeout=args.wait_seconds)
                    save("EXPORTED", first_delivery=delivery)
            first = receipt["first_delivery"]
            first_workspace = destination / "received-analysis"
            receiving = restore_archive(first["archive"]["path"], first_workspace,
                operation=identify(args.programme_id, "FIRST_ARCHIVE_RECEIVE"),
                expected_sha256=first["archive"]["sha256"])
            need(receiving["state"] == "complete" and receiving["workspace_id"] == args.workspace_id,
                 "NLD_ORIGINAL_ARCHIVE_RESTORE_CHANGED")
            save("RECEIVED", first_receiving=receiving)
            if "second_delivery" not in receipt:
                with operator(first_workspace, checkout=checkout, node=args.node,
                              operation_id=args.operation_id) as (client, workspace_id):
                    need(workspace_id == args.workspace_id, "NLD_RECEIVED_WORKSPACE_ID_CHANGED")
                    perform(client, "nld.restore", {"project_id": project_id}, "RESTORE_PROJECT")
                    p, full_run = selected_run(client, project_id, full_id)
                    need(full_run["completed"] == receipt["first_products"]["native"]["completed"],
                         "NLD_REOPENED_NATIVE_RECEIPT_CHANGED")
                    source = all_rows(client, project_id, definition_id=receipt["definition_id"])
                    need(source["rows_sha256"] == receipt["original_rows_sha256"], "NLD_REOPENED_SOURCE_CHANGED")
                    received_products = frozen_report(client, project_id, full_id, private(destination / "received-products"))
                    need(equivalent_files(receipt["first_products"]["files"], received_products["files"]),
                         "NLD_REOPENED_ORIGINAL_PRODUCTS_CHANGED")
                    save("REOPENED", received_products=received_products, received_workspace=str(first_workspace))
                    keys = [r["_sf_source_key"] for r in source["rows"][:args.backfill_count]]
                    body = {"project_id": project_id, "definition_id": receipt["definition_id"],
                            "run_id": backfill_id, "strategy": "BACKFILL", "keys": keys, "limit": None,
                            "operator": args.operator, "python": args.nld_python,
                            "note": args.note + " — explicit first " + str(len(keys)) +
                                    " retained content keys on the received editable project."}
                    backfill = perform(client, "nld.execute", body, "RECEIVED_BACKFILL")
                    need(backfill["run"]["completed"]["coverage"]["selected_processing_keys"] == len(keys),
                         "NLD_EXPLICIT_BACKFILL_SELECTION_CHANGED")
                    target = all_rows(client, project_id, run_id=backfill_id, kind="target")
                    need(target["rows_sha256"] == receipt["full_target_sha256"],
                         "NLD_RECEIVED_BACKFILL_TARGET_CHANGED")
                    # The exact original operator request must return its existing
                    # completion without invoking a second native lifecycle.
                    replay_id = identify(args.programme_id, "HTTP:RECEIVED_BACKFILL")
                    replay = client.submit("nld.execute", body, request_id=replay_id)
                    need(replay["reused"] is True and replay["request"]["status"] == "COMPLETE"
                         and replay["request"]["result"]["run"]["completed"] == backfill["run"]["completed"],
                         "NLD_ORIGINAL_RECEIVED_REQUEST_REPLAY_CHANGED")
                    products = frozen_report(client, project_id, backfill_id, private(destination / "revision-two-products"))
                    retain("revision-two-native-target-rows.json", target)
                    save("REVISION_TWO_COMPLETE", revision_two_products=products,
                         backfill_native_uid=backfill_id, backfill_keys=keys, exact_request_replay=True)
                    delivery = workspace_delivery(client, project_id, args.programme_id, "SECOND_DELIVERY",
                        private(destination / "revision-two-delivery"), resume=args.resume, timeout=args.wait_seconds)
                    need(delivery["archive"]["sha256"] != first["archive"]["sha256"],
                         "NLD_REVISION_TWO_ARCHIVE_NOT_CHANGED")
                    save("REVISION_TWO_EXPORTED", second_delivery=delivery)
            second = receipt["second_delivery"]
            final_workspace = destination / "revision-two-received-analysis"
            second_receiving = restore_archive(second["archive"]["path"], final_workspace,
                operation=identify(args.programme_id, "SECOND_ARCHIVE_RECEIVE"),
                expected_sha256=second["archive"]["sha256"])
            need(second_receiving["state"] == "complete" and second_receiving["workspace_id"] == args.workspace_id,
                 "NLD_SECOND_ARCHIVE_RESTORE_CHANGED")
            with operator(final_workspace, checkout=checkout, node=args.node,
                          operation_id=args.operation_id) as (client, workspace_id):
                need(workspace_id == args.workspace_id, "NLD_FINAL_WORKSPACE_ID_CHANGED")
                perform(client, "nld.restore", {"project_id": project_id}, "RESTORE_REVISION_TWO_PROJECT")
                p, run = selected_run(client, project_id, backfill_id)
                need(run["completed"] == receipt["revision_two_products"]["native"]["completed"],
                     "NLD_REVISION_TWO_NATIVE_HISTORY_NOT_RETAINED")
                need(all(any(r["id"] == original_id and r["status"] == "COMPLETE" for r in p["runs"])
                         for original_id in (full_id, delta_id, backfill_id)), "NLD_COMPLETE_NATIVE_HISTORY_REQUIRED")
                rows = all_rows(client, project_id, run_id=backfill_id, kind="target")
                need(rows["rows_sha256"] == receipt["full_target_sha256"], "NLD_FINAL_TARGET_CHANGED")
                report = next((r for r in p["reports"] if r["run_id"] == backfill_id), None)
                need(report == receipt["revision_two_products"]["report"], "NLD_FINAL_SAVED_REPORT_CHANGED")
                save("COMPLETE", final_workspace=str(final_workspace), second_receiving=second_receiving,
                     checks={"whole_original_source": True, "original_native_flow": True,
                             "empty_delta_no_native_target_write": True,
                             "exact_original_request_reused": True,
                             "complete_project_state_and_target_restored": True,
                             "original_report_and_workbook_downloads_match": True,
                             "explicit_received_backfill_retained": True,
                             "second_archive_reopens_editable_history": True})
            validate_saved_output(receipt)
            emit({"schema": PROGRAMME, "status": "COMPLETE", "programme_id": args.programme_id,
                  "workspace_id": args.workspace_id, "project_id": project_id,
                  "native_uids": [full_id, delta_id, backfill_id], "source_rows": args.expected_rows,
                  "source_requests": 0, "receipt": str(receipt_path),
                  "archive": second["archive"], "final_workspace": str(final_workspace)})
            return 0
        except BaseException as error:
            save("INTERRUPTED" if isinstance(error, KeyboardInterrupt) else "FAILED",
                 error={"code": getattr(error, "code", type(error).__name__), "message": str(error)})
            raise

if __name__ == "__main__":
    raise SystemExit(main())
