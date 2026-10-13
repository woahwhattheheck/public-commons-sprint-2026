"""Receive the complete recurring World Bank customer journey using two real handovers."""
from __future__ import annotations

import argparse
from copy import deepcopy
import csv
import io
import json
import re
from pathlib import Path
import sys
import zipfile

from .analysis_workspace import AnalysisWorkspace
from .analysis_workbooks import WorkbookDelivery
from .workspace_archive_receive import restore_archive
from .errors import BuyerError, StateError
from .storage import private_directory
from .worldbank_analysis import WorldBankAnalysis, encoded, sha, regular, write, require, typed_rows, sql_identifier
from .worldbank_recurring import WorldBankRecurring


def receive(baseline, candidate, core, directory, operation_id, *, resume=False):
    root = private_directory(Path(directory).expanduser().absolute(), create=True)
    customer = root / "customer"
    original_raw, next_raw = regular(baseline), regular(candidate)
    intent = {"operation_id": operation_id, "baseline_sha256": sha(original_raw),
              "candidate_sha256": sha(next_raw), "customer": str(customer)}
    write(root / "recurring-receiving-intent.json", encoded(intent), exact=True)
    finished = root / "recurring-receiving.json"
    if finished.exists():
        received = json.loads(regular(finished))
        require(received["intent"] == intent, "Continue the original two-handover receiving.")
        for item in received["delivery"]["files"]:
            body = regular(Path(received["delivery_directory"]) / item["filename"], 1024 * 1024 * 1024)
            require(len(body) == item["bytes"] and sha(body) == item["sha256"],
                    "A completed recurring delivery file changed.")
        return received
    first_id = sha((operation_id + ":first").encode())[:32]
    next_id = sha((operation_id + ":next").encode())[:32]
    emit = lambda value: print(json.dumps(value, ensure_ascii=False), flush=True)
    first = WorldBankAnalysis(customer, operation_id=first_id, progress=emit)
    prepared = first.prepare(baseline, core, prefix="monitor", resume=resume)
    view = prepared["view"]["name"]
    report_name, workbook_name = view + "_report", view + "_workbook"
    query_name = view + "_customer"
    country = prepared["source"]["selection"]["countries"][0]
    fields = {
        "sql": "SELECT country_iso3,indicator_id,period,value FROM " + sql_identifier(view) +
               " WHERE country_iso3=? ORDER BY indicator_id,period",
        "parameters_text": json.dumps([country], separators=(",", ":")), "max_rows": 100000}
    snapshots = root / "customer-edits.json"
    workspace = AnalysisWorkspace(customer)
    try:
        if snapshots.exists():
            edits = json.loads(regular(snapshots))
        else:
            try:
                query = workspace.saved_query(query_name)
                require(all(query[key] == value for key, value in fields.items()),
                        "The original customer query contains a different edit.")
            except StateError as error:
                if (getattr(error, "code", None) or str(error)) != "ANALYSIS_QUERY_NOT_FOUND":
                    raise
                query = workspace.save_query(query_name, fields, expected_revision=0)
            original_report = workspace.reports.definition(report_name, revision=1)
            selected = original_report["definition"]
            report = workspace.reports.save(report_name, {
                "id": first.identifier("receiving-customer-report"),
                "expected_revision": 1, "title": "Customer economic monitoring",
                "introduction": selected["introduction"] + "\nCustomer focus retained for recurring delivery.",
                "sections": [{key: section[key] for key in
                              ("title", "note", "query_name", "query_revision", "parameters_text")}
                             for section in selected["sections"]] +
                            [{"title": "Customer focus", "note": "Customer-selected country and column layout.",
                              "query_name": query_name, "query_revision": query["revision"], "parameters_text": None}]})
            definition = workspace.reports.definition(report_name, revision=report["revision"])
            report_job = first.job(workspace, "RECEIVING_CUSTOMER_REPORT", "report", {
                "name": report_name, "revision": report["revision"],
                "definition_sha256": definition["sha256"],
                "expected_views": workspace.database.view_bindings()}, resume=resume)
            publication = workspace.reports.publish(report_job["id"], {
                "id": first.identifier("receiving-customer-publication"),
                "result_sha256": report_job["result"]["result_sha256"],
                "expected_revision": 1, "note": "Customer-edited monitoring report before recurring source refresh."})
            base = workspace.workbooks.definition(workbook_name, revision=1)
            proposal = deepcopy(base["definition"])
            proposal["title"] = "Customer monitoring workbook"
            proposal["notes"] += "\nCustomer worksheet names and headers must remain in later editions."
            proposal["sheets"][0]["name"] = "Customer observations"
            proposal["sheets"][0]["columns"][0]["header"] = "Source reference"
            focus = workspace.workbooks.source({"kind": "report", "id": publication["id"],
                                              "section": len(report["sections"]) - 1})
            proposal["sheets"].append({
                "name": "Customer focus", "source": focus,
                "columns": [{"source": column, "source_index": index, "header": column,
                             "type": "text", "null": "text", "null_text": "NULL", "precision": "preserve"}
                            for index, column in enumerate(focus["columns"])]})
            saved = workspace.workbooks.save(workbook_name, {
                **proposal, "id": first.identifier("receiving-customer-workbook"), "expected_revision": 1})
            first.job(workspace, "RECEIVING_CUSTOMER_WORKBOOK", "workbook", {
                "name": workbook_name, "revision": saved["revision"],
                "definition_sha256": saved["definition_sha256"]}, resume=resume)
            edits = {
                "workspace_id": workspace.identity, "query": query,
                "report": definition, "workbook": workspace.workbooks.definition(workbook_name, revision=saved["revision"]),
                "view": view, "report_name": report_name, "workbook_name": workbook_name}
            write(snapshots, encoded(edits), exact=True)
    finally:
        workspace.close()

    recurring = WorldBankRecurring(customer, operation_id=next_id, progress=emit)
    reviewed = recurring.review(candidate, core, view=view, report=report_name,
                                workbook=workbook_name, prefix="monitor", resume=resume)
    delivered = recurring.refresh(reviewed["review_sha256"],
                                  note="Reviewed the complete next World Bank handover and retained customer edits.",
                                  resume=resume)
    require(delivered["status"] == "COMPLETE", "Finish the original recurring workbook mapping choices.")
    with zipfile.ZipFile(io.BytesIO(next_raw)) as archive:
        columns, rows = typed_rows(archive.read("dataset.csv"), json.loads(archive.read("dataset.json")))
    workspace = AnalysisWorkspace(customer)
    try:
        require(workspace.identity == edits["workspace_id"], "Customer workspace identity changed.")
        current_query = workspace.saved_query(query_name)
        stable_query = ("name", "revision", "sql", "parameters_text", "max_rows", "saved_at")
        later_fields = {**fields, "sql": fields["sql"] + " DESC"}
        later_intent = root / "later-customer-edit-intent.json"
        intended = {"query": query_name, "base_revision": edits["query"]["revision"], "fields": later_fields}
        continued_later_edit = (later_intent.exists() and json.loads(regular(later_intent)) == intended and
                                current_query["revision"] == edits["query"]["revision"] + 1 and
                                all(current_query[key] == value for key, value in later_fields.items()))
        require(continued_later_edit or all(current_query[key] == edits["query"][key] for key in stable_query),
                "Recurring delivery changed the saved customer query.")
        report = workspace.reports.definition(report_name)
        require(report["sha256"] == edits["report"]["sha256"] and
                report["head_revision"] == edits["report"]["head_revision"],
                "Recurring delivery changed the customer report definition.")
        workbook = workspace.workbooks.definition(workbook_name)
        old, new = edits["workbook"]["definition"], workbook["definition"]
        require(new["revision"] == old["revision"] + 1 and new["title"] == old["title"] and
                new["notes"] == old["notes"] and len(new["sheets"]) == len(old["sheets"]),
                "Recurring delivery changed the customer's workbook layout.")
        for before, after in zip(old["sheets"], new["sheets"]):
            require(before["name"] == after["name"] and before["columns"] == after["columns"],
                    "Recurring delivery changed customer worksheet names, headers or projection.")
            require(workspace.workbooks.source(before["source"]) == before["source"],
                    "An earlier complete customer source was lost.")
        require(new["refresh_origin"]["base_revision"] == old["revision"],
                "The original workbook refresh history is missing.")
        original_columns = ",".join(
            ("CASE " + sql_identifier(column) + " WHEN 1 THEN 'true' WHEN 0 THEN 'false' END AS " +
             sql_identifier(column)) if column == "aggregate" else sql_identifier(column)
            for column in columns)
        source_sql = "SELECT " + original_columns + " FROM " + sql_identifier(view)
        result = workspace.database.query(
            source_sql,
            max_rows=max(1000, len(rows) + 1), expected_views=workspace.database.view_bindings())
        expected = [{key: ("true" if value else "false") if type(value) is bool else value
                     for key, value in row.items()} for row in rows]
        actual = [dict(zip(result.columns, row)) for row in result.rows]
        canonical = lambda values: sorted(json.dumps(row, ensure_ascii=False, sort_keys=True,
                                                     separators=(",", ":")) for row in values)
        require(not result.truncated and canonical(actual) == canonical(expected),
                "The complete refreshed source values differ from the original reviewed CSV.")
        write(later_intent, encoded(intended), exact=True)
        later = current_query if continued_later_edit else workspace.save_query(
            query_name, later_fields, expected_revision=current_query["revision"])
        after = {"query": later, "report_sha256": report["sha256"],
                 "workbook_revision": new["revision"], "sheets": [sheet["name"] for sheet in new["sheets"]],
                 "source_rows": len(actual), "source_values_exact": True}
    finally:
        workspace.close()

    # Completed re-entry must retain a subsequent real customer edit.
    repeated = recurring.refresh(reviewed["review_sha256"],
                                  note="Reviewed the complete next World Bank handover and retained customer edits.",
                                  resume=True)
    require(repeated == delivered, "Completed recurring delivery did not reopen its original result.")
    workspace = AnalysisWorkspace(customer)
    try:
        current = workspace.saved_query(query_name)
        require(all(current[key] == after["query"][key] for key in stable_query),
                "Completed recurring delivery replaced a subsequent customer edit.")
    finally:
        workspace.close()
    delivery = recurring.directory / "delivery"
    for item in delivered["files"]:
        body = regular(delivery / item["filename"], 1024 * 1024 * 1024)
        require(len(body) == item["bytes"] and sha(body) == item["sha256"],
                "A complete recurring customer file changed.")
    package = delivery / "WorldBank_Workbook_Handover.zip"
    expected_zip = next(item["sha256"] for item in delivered["files"] if item["filename"] == package.name)
    destination = root / "received-workbook"
    received_workbook = (WorkbookDelivery(destination, expected_manifest_sha256=delivered["workbook"]["manifest_sha256"])
                         if destination.exists() else
                         WorkbookDelivery.receive(package, destination, expected_sha256=expected_zip))
    received_workbook.verify_archive(package)
    with zipfile.ZipFile(package) as archive:
        require("history/definition-" + str(edits["workbook"]["definition"]["revision"]) + ".json" in archive.namelist(),
                "The delivered workbook lacks its original predecessor definition.")
    # Receive the actual full delivered Analysis archive in a separate installation.
    archive_path = delivery / "WorldBank_Analysis_Workspace.zip"
    archive_sha = next(item["sha256"] for item in delivered["files"] if item["filename"] == archive_path.name)
    portable = root / "received-analysis"
    portable_id = sha((operation_id + ":portable").encode())[:32]
    restored = restore_archive(archive_path, portable, operation=portable_id, expected_sha256=archive_sha)
    received = AnalysisWorkspace(portable)
    try:
        require(received.identity == edits["workspace_id"], "Portable customer workspace identity changed.")
        portable_query = received.saved_query(query_name)
        require(all(portable_query[key] == edits["query"][key] for key in stable_query),
                "Portable receiving lost the original delivered customer query.")
        portable_report = received.reports.definition(report_name)
        require(portable_report["sha256"] == edits["report"]["sha256"] and
                portable_report["head_revision"] == edits["report"]["head_revision"],
                "Portable receiving changed the original customer report definition.")
        portable_workbook = received.workbooks.definition(workbook_name)
        require(portable_workbook["definition"] == new,
                "Portable receiving changed customer worksheet names, headers or source history.")
        for sheet in old["sheets"] + new["sheets"]:
            require(received.workbooks.source(sheet["source"]) == sheet["source"],
                    "An earlier or current original worksheet source cannot reopen after portable receiving.")
        publication = received.workbooks.source({"kind": "report", "id": delivered["report"]["id"], "section": 0})
        require(publication["sha256"] == delivered["report"]["sha256"],
                "Portable receiving changed the published customer report.")
        restored_rows = received.database.query(
            source_sql, max_rows=max(1000, len(rows) + 1),
            expected_views=received.database.view_bindings())
        require(not restored_rows.truncated and
                canonical([dict(zip(restored_rows.columns, row)) for row in restored_rows.rows]) == canonical(expected),
                "The complete portable source differs from the approved incoming handover.")
    finally:
        received.close()
    restored_again = restore_archive(archive_path, portable, operation=portable_id, expected_sha256=archive_sha)
    require(restored_again.get("reused") is True, "The original portable receiving operation did not reopen.")

    record = {
        "schema": "stellar-forge.worldbank-recurring-receiving.v1", "status": "COMPLETE",
        "intent": intent, "workspace_id": edits["workspace_id"], "initial_operation": first_id,
        "recurring_operation": next_id, "review_sha256": reviewed["review_sha256"],
        "comparison_counts": reviewed["comparison"]["counts"], "customer": after,
        "completed_reentry_preserved_customer_edit": True,
        "portable_workspace": {"operation_id": portable_id, "directory": str(portable),
                               "workspace_id": edits["workspace_id"], "source_values_exact": True,
                               "customer_definitions_preserved": True, "original_receive_reused": True},
        "workbook_manifest_sha256": received_workbook.inspect()["manifest_sha256"],
        "delivery": delivered, "delivery_directory": str(delivery)}
    write(finished, encoded(record), exact=True)
    emit({"phase": "RECURRING_CUSTOMER_COMPLETE", "result": str(finished),
          "rows": len(rows), "worksheets": after["sheets"]})
    return record


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-handover", required=True)
    parser.add_argument("--candidate-handover", required=True)
    parser.add_argument("--worldbank-core", required=True)
    parser.add_argument("--workspace", required=True, help="Original private receiving directory")
    parser.add_argument("--operation-id", required=True)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--programme-browser", action="store_true",
                        help="Continue this same course through the live programme browser and own-archive reopen")
    parser.add_argument("--node")
    parser.add_argument("--playwright-module")
    parser.add_argument("--chromium")
    parser.add_argument("--process-family")
    parser.add_argument("--source-commit")
    args = parser.parse_args(argv)
    try:
        require(re.fullmatch(r"[a-f0-9]{32}", args.operation_id) is not None,
                "Use a stable lowercase hexadecimal receiving operation ID.")
        result = receive(args.baseline_handover, args.candidate_handover, args.worldbank_core,
                         args.workspace, args.operation_id, resume=args.resume)
        if args.programme_browser:
            require(all((args.node, args.playwright_module, args.chromium,
                         args.process_family, args.source_commit)),
                    "Select the existing Node, Playwright, Chromium, process-family source and actual source commit.")
            from .worldbank_programmes_receive import receive_programmes
            extension = receive_programmes(result, args.candidate_handover, args.worldbank_core,
                args.workspace, args.operation_id, node=args.node, playwright=args.playwright_module,
                chromium=args.chromium, process_family=args.process_family,
                source_commit=args.source_commit, resume=args.resume)
            result = {**result, "programme": extension}
        print(json.dumps(result, ensure_ascii=False, allow_nan=False), flush=True)
        return 0
    except KeyboardInterrupt:
        return 130
    except (BuyerError, OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
