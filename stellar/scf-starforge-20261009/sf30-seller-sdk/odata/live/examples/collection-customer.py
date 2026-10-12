#!/usr/bin/env python3
"""Operate the original complete live OData customer collection and Analysis."""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import zipfile

SCF = Path("stellar/scf-starforge-20261009")
PREFIX = SCF / "sf30-seller-sdk/odata/live/examples"
NODE_HELPER_BLOB = "793fc1add5517728b16e6376e0cc827c5638d1e9"
CRITICAL = {
    "sf30-seller-sdk/odata/live/collection.mjs": "cff025465f887fdfffe6d4f501a42ea767a6a712",
    "sf30-seller-sdk/odata/live/collection-store.mjs": "59d9fa4904bc54bdfa692656047029d2a1e5a9a1",
    "sf30-seller-sdk/odata/live/client.mjs": "fa149d4adcc2698d699c492f572f5840978addf9",
    "sf30-seller-sdk/odata/live/contract.mjs": "89929902571fae19b638dffa0b47dcefd31ae0cf",
    "sf30-seller-sdk/odata/source.mjs": "9fbe8ad327deaa14b1912ff3fe2cf97336202efc",
    "sf30-seller-sdk/odata/schema.mjs": "e39cf9c829c9af7e7edff8775ee9a6d05c9dec3a",
    "sf30-seller-sdk/odata/state.mjs": "b9907fde2d99357495f25ed0fcb1e70d261295ab",
    "sf30-seller-sdk/odata/workspace.mjs": "8fb026cbe99e38f1473dd8555e147c557c1dd27a",
    "sf30-seller-sdk/odata/live-operations.mjs": "376238ba32a9a3d5764550b9ed216b9813197a8b",
    "sf30-seller-sdk/odata/server.mjs": "a8d6be60e79b3c1d817bc100e623e86db19a6bbf",
    "sf30-seller-sdk/odata/cli.mjs": "6aba7a945e65b1547c9ce2538fcfede25cf1275d",
    "sf30-seller-sdk/odata/public/app.mjs": "4f770ee7ac6fef5e101dd67f66aa33c92223c95c",
    "sf30-seller-sdk/odata/public/collection-view.mjs": "dfdb8b3f38f9fadfd44ef2ddb57d7d30ffb72432",
    "sf30-seller-sdk/odata/public/index.html": "d19216aef344e01e953b87b8e3aa88af2f604d85",
    "sf88-operator-buyer-cli/python/stellar_forge_buyer/analysis_workspace.py": "ae96dcbf1d6b6886d22148072a2cede1589b800a",
    "sf88-operator-buyer-cli/python/stellar_forge_buyer/response_documents.py": "65c8c9c8b347994e9d82e6834d56ace1ce19eaf6",
    "sf88-operator-buyer-cli/python/stellar_forge_buyer/response_tables.py": "0eeddd3c723eb2b7a6816fff46c8c71da81a8eb3",
    "sf88-operator-buyer-cli/python/stellar_forge_buyer/workspace_archive.py": "0c13c4355a56398905944c49186e39687f254250",
    "sf88-operator-buyer-cli/python/stellar_forge_buyer/workspace_archive_receive.py": "19a34f857eb9de8600aac24e003d073a081f8f45",
    "sf88-operator-buyer-cli/python/stellar_forge_buyer/sqlite_dataset.py": "9d03674168ae866775abd02d89877c9e687f7444",
    "sf88-operator-buyer-cli/python/stellar_forge_buyer/analysis_reports.py": "1352e505c52139e21962adeaa11f13090e9f81d5",
    "sf88-operator-buyer-cli/python/stellar_forge_buyer/analysis_workbooks.py": "07da37b07c5a3c5790f9181f0ee1933df02472bc",
    "sf88-operator-buyer-cli/python/stellar_forge_buyer/analysis_exports.py": "fff696d7d9ad3a97bf8d7c20de260bc47c786a57",
    "sf88-operator-buyer-cli/python/stellar_forge_buyer/storage.py": "3b3426436f036718a560b9b70049fd065cc8a0a1"
}
EXPECTED_RESPONSES = [
    (47571, "10065438cad897db2daf2a8d35ba5b89ddaf2ade7d7b17ae28a8732bd5034309"),
    (47561, "91022bac4f3f2b56cd89c4e18f6463a4394acda96aa31109f255f3b80ef1679b"),
    (47436, "bbb922c01aa1204cb437bc47cdb04b9427294d58c55896194ae7b4e910cb480f"),
    (47462, "5842451780ac1efe5a52db66ada610dae33b80bae30f0e2d490f3c1e70edc143"),
    (7841, "17b88c3513eb28e5f6f41cc517ae39fdb5726256bc757bce81e3121e0550eb70"),
]
SOURCE_BINDING = "d0504cda1d10b0af1e6539147daaff189cd6502897587a76374d0dc0171f60ec"
QUERY = "0b209a8f9bd385e382879e8c54d5c93c1a17cba66821ef42bf9602159ad672be"
SCHEMA = "stellar-forge.odata-collection-customer-operation.v1"


def need(condition, message):
    if not condition:
        raise RuntimeError(message)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def git_blob(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()


def identity(path):
    with Path(path).open("rb") as stream:
        info = os.fstat(stream.fileno())
        need(stat.S_ISREG(info.st_mode), "Select a regular retained file.")
        return {"bytes": info.st_size, "sha256": hashlib.file_digest(stream, "sha256").hexdigest()}


def private(path):
    path = Path(path).absolute()
    path.mkdir(parents=True, mode=0o700, exist_ok=True)
    info = path.lstat()
    need(path.resolve() == path and stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o077,
         "Select a private original operation directory: " + str(path))
    return path


def original_copy(source, destination):
    source, destination = Path(source), Path(destination)
    expected = identity(source)
    if destination.exists():
        need(identity(destination) == expected, "A retained customer output changed: " + str(destination))
        # Reconcile only this operation's same-inode publication aliases.
        final_info = destination.lstat()
        for alias in destination.parent.glob(".odata-customer-*"):
            alias_info = alias.lstat()
            if stat.S_ISREG(alias_info.st_mode) and (alias_info.st_dev, alias_info.st_ino) == (final_info.st_dev, final_info.st_ino):
                alias.unlink()
        directory = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        return expected
    private(destination.parent)
    fd, name = tempfile.mkstemp(prefix=".odata-customer-", dir=destination.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as target, source.open("rb") as stream:
            shutil.copyfileobj(stream, target, 1024 * 1024)
            target.flush()
            os.fsync(target.fileno())
        need(identity(temporary) == expected, "The original customer copy changed.")
        try:
            os.link(temporary, destination)
        except FileExistsError:
            need(identity(destination) == expected, "Another customer output differs.")
        directory = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)
    return expected


def options():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", required=True)
    parser.add_argument("--packet", required=True, help="Original five-response retained receiving packet directory")
    parser.add_argument("--output", required=True, help="One private retained customer operation")
    parser.add_argument("--node", default="node")
    parser.add_argument("--source-ref", required=True, help="Immutable public product commit selected by the operator")
    parser.add_argument("--resume", action="store_true", help="Reconcile and continue this exact existing operation")
    return parser.parse_args()


def main():
    args = options()
    checkout, packet = Path(args.checkout).resolve(), Path(args.packet).resolve()
    need(re.fullmatch(r"[a-f0-9]{40}", args.source_ref), "Select the immutable source commit.")
    sys.path.insert(0, str(checkout / SCF / "sf88-operator-buyer-cli/python"))
    from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace
    from stellar_forge_buyer.analysis_workbooks import WorkbookDelivery
    from stellar_forge_buyer.response_documents import document_path
    from stellar_forge_buyer.workspace_archive_receive import restore_archive
    from stellar_forge_buyer.storage import dump, parse, read, write

    out = private(args.output)
    lock_fd = os.open(out / "customer-operation.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(lock_fd)
        raise RuntimeError("This original customer operation is already running.") from None

    journal_path = out / "customer-operation.json"
    journal = None
    workspace = receiving = None

    def save():
        dump(journal_path, journal)

    def publish(name, value):
        path = out / name
        raw_value = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()
        if path.exists():
            need(path.read_bytes() == raw_value, "A selected operation output changed: " + name)
        else:
            write(path, raw_value, exclusive=True)
        return value

    def step_id(label, attempt=0):
        return sha((journal["selection_sha256"] + ":" + label + ":" + str(attempt)).encode())[:32]

    def progress(phase, **extra):
        print(json.dumps({"phase": phase, **extra}, ensure_ascii=False), flush=True)

    def run_job(ws, label, kind, request):
        steps = journal["steps"]
        spec = {"kind": kind, "request": request}
        entry = steps.get(label)
        if entry is None:
            entry = {**spec, "attempts": [{"id": step_id(label)}]}
            steps[label] = entry
            save()
        need(entry["kind"] == kind and entry["request"] == request, "The selected native job changed: " + label)
        attempt = entry["attempts"][-1]
        result = ws.start(kind, {"id": attempt["id"], **request})
        if result["status"] in {"FAILED", "INTERRUPTED", "CANCELLED"} and args.resume and not attempt.get("retried"):
            attempt.update(status=result["status"], error=result.get("error"), retried=True)
            attempt = {"id": step_id(label, len(entry["attempts"]))}
            entry["attempts"].append(attempt)
            save()
            result = ws.start(kind, {"id": attempt["id"], **request})
        deadline = time.monotonic() + 600
        announced = time.monotonic()
        while result["status"] == "RUNNING":
            need(time.monotonic() < deadline, "The selected native job is still running: " + attempt["id"])
            time.sleep(0.2)
            result = ws.job(attempt["id"])
            if time.monotonic() - announced > 20:
                progress(label, id=attempt["id"], status=result["status"])
                announced = time.monotonic()
        attempt.update(status=result["status"], error=result.get("error"))
        save()
        need(result["status"] == "COMPLETE", "Original native " + label + ": " + str(result.get("error")))
        progress(label, id=attempt["id"], status="COMPLETE")
        return result

    try:
        source_files = []
        for path, expected in {**CRITICAL, str(PREFIX.relative_to(SCF) / "collection-customer.mjs"): NODE_HELPER_BLOB}.items():
            source = checkout / SCF / path
            raw_value = source.read_bytes()
            observed = git_blob(raw_value)
            need(observed == expected, "The selected original source differs: " + path)
            source_files.append({"path": str(SCF / path), "git_blob": observed, "bytes": len(raw_value), "sha256": sha(raw_value)})
        packet_raw = (packet / "packet.json").read_bytes()
        response_files = []
        original = []
        for index, (size, checksum) in enumerate(EXPECTED_RESPONSES, 1):
            path = packet / "responses" / ("response-" + str(index) + ".json")
            need(identity(path) == {"bytes": size, "sha256": checksum}, "The original selected response changed.")
            original.extend(parse(path.read_bytes())["items"])
            response_files.append({"path": str(path), "bytes": size, "sha256": checksum})
        need(len(original) == 830, "Select all 830 original Northwind records.")
        selection = {"schema": SCHEMA, "packet_sha256": sha(packet_raw), "source_ref": args.source_ref,
                     "source_files": source_files, "responses": [{"bytes": v["bytes"], "sha256": v["sha256"]} for v in response_files],
                     "sourceBinding": SOURCE_BINDING, "queryFingerprint": QUERY}
        selection_sha = sha(canonical(selection).encode())
        if journal_path.exists():
            need(args.resume, "Use --resume for this original retained operation.")
            journal = parse(read(journal_path, 16 * 1024 * 1024))
            need(journal["schema"] == SCHEMA and journal["selection_sha256"] == selection_sha, "The retained operation selects another source.")
        else:
            journal = {"schema": SCHEMA, "selection": selection, "selection_sha256": selection_sha,
                       "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "state": "RUNNING", "steps": {}}
            save()
        if journal["state"] == "COMPLETE":
            result = parse(read(out / "customer-result.json", 16 * 1024 * 1024))
            need(identity(out / result["archive"]["name"]) == {k: result["archive"][k] for k in ("bytes", "sha256")},
                 "The completed customer archive changed.")
            progress("customer", status="COMPLETE", **result["archive"])
            return

        descriptor = {"schema": "stellar-forge.odata-collection-customer-input.v1",
                      "packetDirectory": str(packet), "outputDirectory": str(out),
                      "expectedRows": 830, "sourceBinding": SOURCE_BINDING, "queryFingerprint": QUERY,
                      "responseFiles": response_files, "collectionId": "northwind-orders-complete",
                      "title": "Northwind original live Orders collection", "analysisSource": "northwind_orders_live"}
        dump(out / "customer-input.json", descriptor)
        helper = checkout / PREFIX / "collection-customer.mjs"
        subprocess.run([args.node, str(helper), "prepare", str(out / "customer-input.json")],
                       check=True, pass_fds=(lock_fd,))
        prepared = parse(read(out / "collection-operation.json", 16 * 1024 * 1024))
        collection = prepared["collection"]
        publish("source-selection.json", selection)
        workspace = AnalysisWorkspace(out / "analysis-workspace", checkout=checkout, node=args.node)
        registered = workspace.responses.register("northwind_orders_live", "document",
            manifest=Path(collection["directory"]) / "analysis/source.json",
            format=collection["analysisFormat"], expected_revision=0)
        need(registered["revision"] == prepared["mapping"]["source_revision"], "Use the actual original registered source revision.")
        preview = run_job(workspace, "original-response-preview", "response-preview", prepared["mapping"])
        imported = run_job(workspace, "original-response-import", "response-import",
            {"preview_id": preview["id"], "preview_sha256": preview["result"]["preview_sha256"], "allow_incomplete": False})
        version = imported["result"]["version"]
        need(version["row_count"] == 830, "The native import changed the complete original row count.")
        active = workspace.database.current("northwind_live_orders")
        if active["version"] is None:
            workspace.database.activate("northwind_live_orders", version["version_id"], expected_revision=0)
        else:
            need(active["version"]["version_id"] == version["version_id"], "The selected live view belongs to another edition.")
        bindings = workspace.database.view_bindings()
        mapping = collection["mapping"]
        quote = lambda value: '"' + value.replace('"', '""') + '"'
        columns = [name for field in mapping for name in (field["name"], field["name"] + "_state")]
        sql = "SELECT " + ",".join(map(quote, columns)) + ' FROM "northwind_live_orders" ORDER BY ' + quote(version["row_order_column"])
        country_sql = ('SELECT "ShipCountry" AS "ship_country",COUNT(*) AS "orders",'
                       'SUM(CASE WHEN "OrderDate" IS NULL THEN 1 ELSE 0 END) AS "order_date_nulls",'
                       'SUM(CASE WHEN "Freight" IS NULL THEN 1 ELSE 0 END) AS "freight_nulls" '
                       'FROM "northwind_live_orders" GROUP BY "ShipCountry" ORDER BY "ShipCountry"')
        specs = [("northwind_original_orders", sql), ("northwind_country_summary", country_sql)]
        queries = []
        for name, statement in specs:
            request = {"sql": statement, "parameters_text": "[]", "max_rows": 2000}
            try:
                saved = workspace.saved_query(name, revision=1)
            except Exception as error:
                if getattr(error, "code", None) != "ANALYSIS_QUERY_NOT_FOUND":
                    raise
                saved = workspace.save_query(name, request, expected_revision=0)
            need(all(saved[key] == value for key, value in request.items()), "The original saved query changed.")
            queries.append(run_job(workspace, name, "query", {**request, "expected_views": bindings}))

        original_raw, _, _ = workspace.export_result(queries[0]["id"], "json")
        observed = parse(original_raw)
        expected_rows = []
        for row in original:
            expected_rows.append([cell for field in mapping for cell in
                                  (row[field["path"]], "null" if row[field["path"]] is None else "value")])
        need(observed["rows"] == expected_rows and observed["columns"] == columns and not observed["truncated"],
             "Native SQL changed an original value, null state, type or order.")
        country_raw, _, _ = workspace.export_result(queries[1]["id"], "json")
        countries = parse(country_raw)
        expected_country = {}
        for row in original:
            item = expected_country.setdefault(row["ShipCountry"], [0, 0, 0])
            item[0] += 1
            item[1] += row["OrderDate"] is None
            item[2] += row["Freight"] is None
        expected_country_rows = [[name, *counts] for name, counts in sorted(expected_country.items(), key=lambda item:(item[0] is not None, item[0] or ""))]
        need(countries["rows"] == expected_country_rows and not countries["truncated"], "The original country summary differs.")
        for label, job in zip(("Original_Orders", "Country_Summary"), queries):
            for format in ("json", "csv"):
                value, _, _ = workspace.export_result(job["id"], format)
                target = out / (label + "." + format)
                if target.exists():
                    need(target.read_bytes() == value, "The retained query output changed.")
                else:
                    write(target, value, exclusive=True)

        typed = run_job(workspace, "typed-original-query-export", "query-export",
            {"query_id": queries[0]["id"], "result_sha256": observed["result_sha256"],
             "label": "Original Northwind Orders with explicit value/null state",
             "formats": ["jsonl", "csv", "sqlite"], "max_rows": 2000, "max_output_bytes": 16 * 1024 * 1024,
             "spreadsheet_safe": True, "timeout": 300})
        report_name = "northwind_live_collection_report"
        report = workspace.reports.save(report_name, {
            "id": step_id("save-report"), "expected_revision": 0, "title": "Northwind live Orders: complete customer collection",
            "introduction": "The report selects the original five live response envelopes and all 830 delivered Orders. "
                "The query, declared keys, source count, acquisition window and exact original source files remain attached. "
                "Freight keeps its original Decimal text; no currency is inferred.",
            "sections": [
                {"title": "Original order records", "note": "All delivered fields, exact original order and explicit value/null state.",
                 "query_name": specs[0][0], "query_revision": 1},
                {"title": "Orders by destination country", "note": "Counts and null completeness computed from the same original 830 records.",
                 "query_name": specs[1][0], "query_revision": 1},
            ]})
        report_definition = workspace.reports.definition(report_name, revision=1)
        reported = run_job(workspace, "customer-report", "report",
            {"name": report_name, "revision": 1, "definition_sha256": report_definition["sha256"], "expected_views": bindings})
        report_result = workspace.reports.result(reported["id"])["report"]
        publication = workspace.reports.publish(reported["id"], {
            "id": step_id("publish-report"), "result_sha256": report_result["result_sha256"], "expected_revision": 0,
            "note": "Complete original page chain and source-linked values retained for independent customer receiving."})
        publications = workspace.reports.publications(name=report_name)["publications"]
        publication_sha = next(item["sha256"] for item in publications if item["publication"]["id"] == publication["id"])
        report_exports = []
        for format, suffix in (("html", "html"), ("json", "json"), ("csv", "zip")):
            exported = run_job(workspace, "published-report-" + format, "report-export",
                {"publication_id": publication["id"], "publication_sha256": publication_sha, "format": format})
            path, item = workspace.report_export_file(exported["id"])
            name = "OData_Customer_Report." + suffix
            report_exports.append({"name": name, **original_copy(path, out / name)})

        sheets = []
        for name, selected_source in (
            ("Original Orders", {"kind": "query-export", "id": typed["id"]}),
            ("Country Summary", {"kind": "report", "id": publication["id"], "section": 1}),
        ):
            source = workspace.workbooks.source(selected_source)
            sheets.append({"name": name, "source": {**selected_source, "sha256": source["sha256"]},
                "columns": [{"source": column, "header": column, "type": "native", "null": "text",
                             "null_text": "NULL", "precision": "preserve"} for column in source["columns"]]})
        workbook_name = "northwind_live_collection_workbook"
        definition = workspace.workbooks.save(workbook_name, {
            "id": step_id("save-workbook"), "expected_revision": 0, "title": "Northwind complete live collection",
            "notes": "Original supplier values and null states, followed by the same-source country report. "
                     "Exact Decimal text is retained; all originals are included with the workbook.",
            "sheets": sheets})
        worked = run_job(workspace, "customer-workbook", "workbook",
            {"name": workbook_name, "revision": definition["revision"], "definition_sha256": definition["definition_sha256"]})
        workbook_directory = workspace.database.directory / "analysis-workbooks" / worked["id"]
        delivery = WorkbookDelivery(workbook_directory, expected_manifest_sha256=worked["result"]["manifest_sha256"])
        workbook_manifest = delivery.inspect()
        with workspace.workbooks.download(worked["id"], "handoff.zip") as (stream, record):
            # The original reader validates its complete archive before receiving.
            workbook_archive = out / "OData_Collection_Workbook.zip"
            original_copy(workbook_directory / "handoff.zip", workbook_archive)
            need(identity(workbook_archive) == {key: record[key] for key in ("bytes", "sha256")}, "The saved workbook archive changed.")
        delivery.verify_archive(workbook_archive)
        original_copy(workbook_directory / "workbook.xlsx", out / "OData_Collection_Workbook.xlsx")
        workbook_receiving = out / "received-workbook"
        if workbook_receiving.exists():
            workbook_received = WorkbookDelivery(workbook_receiving, expected_manifest_sha256=worked["result"]["manifest_sha256"])
        else:
            workbook_received = WorkbookDelivery.receive(workbook_archive, workbook_receiving,
                expected_sha256=identity(workbook_archive)["sha256"])
        need(workbook_received.inspect() == workbook_manifest, "The independently received workbook changed.")

        review = workspace.archives.review()
        need(review["ready"], "The complete original workspace needs its retained files: " + canonical(review["missing"]))
        archived = run_job(workspace, "complete-analysis-workspace", "workspace-export", {"include_previous_backups": False})
        archive_result = archived["result"]
        archive_file = next(item for item in archive_result["files"] if item["name"] == "workspace.zip")
        source_archive = Path(archive_result["directory"]) / "workspace.zip"
        archive_path = out / "OData_Analysis_Workspace.zip"
        original_copy(source_archive, archive_path)
        source_state = workspace.state()
        workspace.close()
        workspace = None
        observed_restore = restore_archive(archive_path, out / "received-analysis-workspace",
            operation=step_id("receive-analysis-workspace"), expected_sha256=archive_file["sha256"])
        # The native receiver's per-call reused flag is an observation, while its
        # saved identity and first observed completed receipt belong to this run.
        restore_identity = {key: value for key, value in observed_restore.items() if key != "reused"}
        retained_restore = journal.get("analysis_restore")
        if retained_restore is None:
            retained_restore = {"identity": restore_identity, "receipt": observed_restore}
            journal["analysis_restore"] = retained_restore
        else:
            need(retained_restore["identity"] == restore_identity,
                 "The original received Analysis archive identity changed.")
        retained_restore["last_reused"] = observed_restore["reused"]
        save()
        restored = retained_restore["receipt"]
        receiving = AnalysisWorkspace(out / "received-analysis-workspace", checkout=checkout, node=args.node)
        need(receiving.state()["workspace_id"] == source_state["workspace_id"], "The received analysis workspace identity changed.")
        replay = run_job(receiving, "received-original-rows", "query",
            {"sql": sql, "parameters_text": "[]", "max_rows": 2000, "expected_views": receiving.database.view_bindings()})
        replay_raw, _, _ = receiving.export_result(replay["id"], "json")
        need(parse(replay_raw)["rows"] == expected_rows, "The received Analysis query changed original values.")
        restored_report = receiving.reports.result(reported["id"])["report"]
        need(restored_report["result_sha256"] == report_result["result_sha256"], "The received original report changed.")
        restored_workbook = WorkbookDelivery(receiving.database.directory / "analysis-workbooks" / worked["id"],
            expected_manifest_sha256=worked["result"]["manifest_sha256"])
        restored_workbook.inspect()
        source_manifest = document_path(receiving.database.directory, registered["document_id"])
        need(identity(source_manifest)["sha256"] == collection["analysis"]["sha256"], "The Analysis-held source manifest changed.")
        descriptor["analysisManifest"] = str(source_manifest)
        dump(out / "customer-input.json", descriptor)
        subprocess.run([args.node, str(helper), "restore", str(out / "customer-input.json")],
                       check=True, pass_fds=(lock_fd,))
        restored_collection = parse(read(out / "collection-analysis-restored.json", 16 * 1024 * 1024))
        receiving.close()
        receiving = None

        result = {"schema": "stellar-forge.odata-collection-customer-result.v1",
            "source_ref": args.source_ref, "sourceBinding": SOURCE_BINDING, "queryFingerprint": QUERY,
            "original_rows": 830, "original_pages": 5, "country_count": len(expected_country),
            "collection_sha256": collection["manifestSha256"], "analysis_source_sha256": collection["analysis"]["sha256"],
            "analysis_workspace_id": source_state["workspace_id"], "dataset_version_id": version["version_id"],
            "report_id": reported["id"], "report_publication": publication, "report_sha256": report_result["result_sha256"],
            "workbook_id": worked["id"], "workbook_manifest_sha256": worked["result"]["manifest_sha256"],
            "workspace_restore": restored, "collection_restore": restored_collection, "report_exports": report_exports,
            "source_rows_preserved": True, "null_states_preserved": True, "workbook_received": True}
        publish("worked-customer.json", result)
        start = (
            "# Northwind complete live collection\n\n"
            "Open OData_Customer_Report.html to read both sections of the worked report. "
            "Open OData_Collection_Workbook.xlsx for the 830 original Orders and the destination-country summary. "
            "OData_Collection_Workbook.zip retains the original typed inputs, report selection and workbook definitions.\n\n"
            "## Restore and open Analysis\n\n"
            "Use the matching original Stellar Forge source/runtime. Replace SOURCE with its absolute directory, "
            "DELIVERY with this extracted delivery directory, and RECEIVING with a new private directory. "
            "Set NODE to the selected Node 24 executable. These commands use the original workspace receiver and application.\n\n"
            "```sh\n"
            "umask 077\n"
            "mkdir -p \"$RECEIVING\"\n"
            "export PYTHONPATH=\"$SOURCE/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python${PYTHONPATH:+:$PYTHONPATH}\"\n"
            "python3 -B -m stellar_forge_buyer.workspace_archive_receive receive \\\n"
            "  \"$DELIVERY/OData_Analysis_Workspace.zip\" \"$RECEIVING/analysis\" \\\n"
            "  --sha256 " + archive_file["sha256"] + "\n"
            "python3 -B -m stellar_forge_buyer.analysis_workspace \\\n"
            "  --database \"$RECEIVING/analysis\" --checkout \"$SOURCE\" --node \"$NODE\" serve\n"
            "```\n\n"
            "Open the private launch file reported by the application to use its original browser interface. "
            "The restored workspace contains the source document, typed dataset, two saved SQL queries, "
            "published report, workbook and complete export history.\n\n"
            "## Restore and open the OData operator\n\n"
            "The original OData backup contains the live service, all selected response pages and the completed collection. "
            "Use Restore workspace in the original OData application, or receive the same file with its native CLI:\n\n"
            "```sh\n"
            "\"$NODE\" \"$SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/odata/cli.mjs\" \\\n"
            "  --workspace \"$RECEIVING/odata\" restore --input \"$DELIVERY/OData_Collection_Workspace.json\"\n"
            "\"$NODE\" \"$SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/odata/cli.mjs\" \\\n"
            "  --workspace \"$RECEIVING/odata\" serve --port 0\n"
            "```\n\n"
            "All 830 Orders come from the five original saved live response envelopes. The selected source query "
            "is limited to 830 rows. Freight retains its original Decimal text; the report does not assign a currency. "
            "Value and null states remain separate. Original_Orders.json and Country_Summary.json carry the native "
            "query values; the CSV files are companion exports.\n\n"
            "## Continue the retained operation\n\n"
            "The exact public product source selection is " + args.source_ref + ". The portable original runner is "
            "stellar/scf-starforge-20261009/sf30-seller-sdk/odata/live/examples/collection-customer.py. "
            "Its adjacent COLLECTION_CUSTOMER.md describes the source closure, input packet and full command. "
            "Reuse the same --checkout, --packet, --output, --node and --source-ref with --resume to continue its retained operation. "
            "customer-files.json names and hashes every selected deliverable; worked-customer.json retains the actual "
            "source, collection, Analysis, report, workbook and independent receiving identities.\n")
        if (out / "START.md").exists():
            need((out / "START.md").read_text() == start, "The retained customer opening instructions changed.")
        else:
            write(out / "START.md", start.encode(), exclusive=True)
        selected_names = ["START.md", "worked-customer.json", "source-selection.json", "Original_Orders.json",
            "Original_Orders.csv", "Country_Summary.json", "Country_Summary.csv",
            "OData_Customer_Report.html", "OData_Customer_Report.json", "OData_Customer_Report.zip",
            "OData_Collection_Workbook.xlsx", "OData_Collection_Workbook.zip",
            "OData_Analysis_Workspace.zip", "OData_Collection_Workspace.json"]
        files = [{"name": name, **identity(out / name)} for name in selected_names]
        manifest = publish("customer-files.json", {"schema": "stellar-forge.odata-customer-delivery.v1", "files": files})
        selected_names.append("customer-files.json")
        final = out / "OData_Complete_Customer_Edition.zip"
        candidate = out / ".OData_Complete_Customer_Edition.partial.zip"
        journal["package"] = {"candidate": candidate.name, "target": final.name, "files": manifest["files"]}
        save()

        def verify_package(path):
            with zipfile.ZipFile(path) as package:
                entries = package.infolist()
                need(len(entries) == len(selected_names) and {item.filename for item in entries} == set(selected_names),
                     "The customer archive member selection changed.")
                for name in selected_names:
                    with package.open(name) as stream:
                        expected = identity(out / name)
                        need(package.getinfo(name).file_size == expected["bytes"] and
                             hashlib.file_digest(stream, "sha256").hexdigest() == expected["sha256"],
                             "A customer archive member changed.")

        if not final.exists():
            if candidate.exists():
                try:
                    verify_package(candidate)
                except zipfile.BadZipFile:
                    # A complete but different archive is retained for review.
                    # Only our unfinished writer (missing/truncated end record)
                    # can retire this selected candidate under the same lease.
                    with candidate.open("rb") as stream:
                        stream.seek(max(0, os.fstat(stream.fileno()).st_size - 65557))
                        tail = stream.read()
                    marker = tail.rfind(b"PK\x05\x06")
                    unfinished = marker < 0 or len(tail) < marker + 22
                    if not unfinished:
                        comment_size = int.from_bytes(tail[marker + 20:marker + 22], "little")
                        unfinished = len(tail) < marker + 22 + comment_size
                    need(unfinished, "A structurally complete customer candidate is damaged; retain it for review.")
                    retired = identity(candidate)
                    journal["package"]["retired_partial"] = retired
                    save()
                    need(identity(candidate) == retired, "The unfinished customer candidate changed.")
                    candidate.unlink()
            if not candidate.exists():
                with zipfile.ZipFile(candidate, "x", zipfile.ZIP_DEFLATED, compresslevel=6) as package:
                    os.chmod(candidate, 0o600)
                    for name in selected_names:
                        package.write(out / name, name)
                with candidate.open("rb") as stream:
                    os.fsync(stream.fileno())
            verify_package(candidate)
            os.link(candidate, final)
            candidate.unlink()
            directory_fd = os.open(out, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        verify_package(final)
        if candidate.exists():
            final_info, candidate_info = final.lstat(), candidate.lstat()
            if (final_info.st_dev, final_info.st_ino) == (candidate_info.st_dev, candidate_info.st_ino):
                candidate.unlink()
                directory_fd = os.open(out, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        complete = {"schema": "stellar-forge.odata-customer-delivery-result.v1",
                    "archive": {"name": final.name, **identity(final)}, "files": files,
                    "rows": 830, "collection_sha256": collection["manifestSha256"],
                    "analysis_workspace_id": source_state["workspace_id"]}
        publish("customer-result.json", complete)
        journal["state"] = "COMPLETE"
        save()
        progress("customer", status="COMPLETE", **complete["archive"])
    except BaseException as error:
        if journal is not None:
            journal["state"] = "NEEDS_ATTENTION"
            journal["error"] = {"type": type(error).__name__, "message": str(error)}
            save()
        raise
    finally:
        if receiving is not None:
            receiving.close()
        if workspace is not None:
            workspace.close()
        os.close(lock_fd)


if __name__ == "__main__":
    main()
