#!/usr/bin/env python3
"""Receive one original semantic dataset into the existing customer application.

Uses the native delivery, SQLite, saved-query, report, workbook and HTTP owners.
Original request IDs are reused if this same example is interrupted and reopened.
"""
from __future__ import annotations

import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import threading
import time
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import uuid
import zipfile

from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace, serve
from stellar_forge_buyer.analysis_workbooks import WorkbookDelivery
from stellar_forge_buyer.datasets import DatasetDelivery
from stellar_forge_buyer.query_export import QueryExport
from stellar_forge_buyer.sqlite_dataset import DatasetDatabase
from stellar_forge_buyer.storage import parse, private_directory, read


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def keep(path, raw):
    path = Path(path)
    private_directory(path.parent, create=True)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        require(read(path, max(len(raw), 1)) == raw, "Receiving file changed: " + path.name)
    else:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
    return {"path": str(path), "bytes": len(raw), "sha256": sha256(raw).hexdigest()}


def complete(workspace, kind, request):
    job = workspace.start(kind, request)
    deadline = time.monotonic() + 300
    while job["status"] == "RUNNING" and time.monotonic() < deadline:
        time.sleep(0.05)
        job = workspace.job(job["id"])
    require(job["status"] == "COMPLETE", kind + ": " + str(job.get("error") or job["status"]))
    return job


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    original = parser.add_mutually_exclusive_group(required=True)
    original.add_argument("--scan", help="Exact original finalized SF100 scan JSON")
    original.add_argument("--report", help="Exact original SF88 delivery report JSON")
    parser.add_argument("--database", required=True, help="Private customer database directory")
    parser.add_argument("--out", required=True, help="Private complete receiving directory")
    parser.add_argument("--view", default="semantic_observations")
    parser.add_argument("--columns", default="{}", help="Reviewed original-field to SQL-column JSON mapping")
    args = parser.parse_args()
    require(re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", args.view) is not None, "Invalid SQL view name")
    columns = json.loads(args.columns)
    require(isinstance(columns, dict), "Column mapping must be a JSON object")
    original_record = parse(read(Path(args.scan or args.report), 16 * 1024 * 1024))
    delivery = (DatasetDelivery.from_finalized_scan(original_record) if args.scan else
                DatasetDelivery(original_record, Path(original_record["directory"])))
    dictionary = delivery.read_semantics()
    require(dictionary is not None, "Select an original delivery with reviewed source meaning")
    out = private_directory(Path(args.out).absolute(), create=True)
    source_id = delivery.native["sourceBindingSha256"]

    def request_id(label):
        return uuid.uuid5(uuid.NAMESPACE_URL, "stellar-forge-semantic-analysis:" +
                         source_id + ":" + str(Path(args.database).absolute()) + ":" + label).hex

    workspace = AnalysisWorkspace(Path(args.database).absolute())
    server = worker = None
    result = {"schema": "stellar-forge.semantic-analysis-receiving.v1",
              "sourceBindingSha256": source_id, "sourceDirectory": str(delivery.directory),
              "dictionary": {"sha256": dictionary["sha256"],
                             "definitionSha256": dictionary["definitionSha256"],
                             "captureManifestSha256": dictionary["source"]["captureManifestSha256"]}}
    try:
        edition = workspace.database.import_delivery(delivery, columns=columns)
        version_id = edition["version_id"]
        require(workspace.database.semantics(version_id)["document"] == dictionary,
                "Imported source meaning changed")
        result["edition"] = {key: edition[key] for key in ("version_id", "row_count", "columns", "semantics")}
        result["dictionaryFile"] = keep(out / "semantics.json", workspace.database.semantics_bytes(version_id))
        current = workspace.database.current(args.view)
        view = workspace.database.activate(args.view, version_id, expected_revision=current["revision"])
        result["view"] = {key: view[key] for key in ("name", "revision")}
        views = workspace.database.view_bindings()
        sql = 'SELECT * FROM "' + args.view + '" ORDER BY "_sf_row_number"'
        count_sql = 'SELECT COUNT(*) AS observation_count FROM "' + args.view + '"'
        names = {item["name"]: item["revision"] for item in workspace.state()["queries"]}
        recipes = []
        for name, query in (("SemanticObservations", sql), ("SemanticObservationCount", count_sql)):
            if name in names:
                saved = workspace.saved_query(name, revision=names[name])
                require(saved["sql"] == query and saved["parameters_text"] == "[]",
                        "Existing saved query differs")
            else:
                saved = workspace.save_query(name, {"sql": query, "parameters_text": "[]",
                                                    "max_rows": max(1000, edition["row_count"] + 1)},
                                             expected_revision=0)
            recipes.append(saved)
        preview = complete(workspace, "query", {"id": request_id("query"), "sql": sql,
                           "parameters_text": "[]", "max_rows": max(1000, edition["row_count"] + 1),
                           "expected_views": views})
        require(preview["result"]["source_versions"][0]["semantic_dictionary"] == dictionary,
                "Query source meaning was not retained")
        query = complete(workspace, "query-export", {"id": request_id("query-export"),
                         "query_id": preview["id"], "result_sha256": preview["result"]["result_sha256"],
                         "label": "Reviewed source observations", "formats": ["jsonl", "csv", "sqlite"],
                         "max_rows": max(1, edition["row_count"]), "max_output_bytes": 32 * 1024 * 1024})
        query_output = QueryExport(query["result"]["directory"])
        query_manifest = query_output.inspect()
        require(query_manifest["binding"]["sourceVersions"][0]["semantic_dictionary"] == dictionary,
                "Complete query export lost source meaning")
        query_destination = out / "query-output"
        if (query_destination / "manifest.json").exists():
            received_query = QueryExport(query_destination)
            require(received_query.manifest == query_manifest, "Existing query receiving differs")
            received_query.inspect()
        else:
            query_output.copy_to(query_destination)
        result["query"] = {"jobId": query["id"], "manifestSha256": query["result"]["manifest_sha256"],
                           "directory": str(query_destination), "rows": query_manifest["rowCount"]}
        definition = workspace.reports.save("SemanticSourceReport", {
            "id": request_id("report-definition"), "expected_revision": 0,
            "title": "Reviewed source observations",
            "introduction": "Original retained observations, source identity, definitions and reviewed SQL aliases.",
            "sections": [
                {"title": "Observation count", "query_name": recipes[1]["name"],
                 "query_revision": recipes[1]["revision"], "note": "Count of the retained selected rows."},
                {"title": "Complete original observations", "query_name": recipes[0]["name"],
                 "query_revision": recipes[0]["revision"], "note": "All rows in original retained order."}]})
        pinned = workspace.reports.definition(definition["name"], revision=definition["revision"])
        report = complete(workspace, "report", {"id": request_id("report"), "name": definition["name"],
                          "revision": definition["revision"], "definition_sha256": pinned["sha256"],
                          "expected_views": views})
        require(report["result"]["sources"][0]["semantic_dictionary"] == dictionary,
                "Report lost original source meaning")
        publication = workspace.reports.publish(report["id"], {
            "id": request_id("report-publication"), "result_sha256": report["result"]["result_sha256"],
            "expected_revision": 0, "note": "Reviewed original source meaning and complete retained rows."})
        saved_publication = next(item for item in workspace.reports.publications(name=definition["name"])["publications"]
                                 if item["publication"]["id"] == publication["id"])
        result["report"] = {"jobId": report["id"], "publication": publication, "files": {}}
        for kind, extension in (("json", "json"), ("html", "html"), ("csv", "zip")):
            exported = complete(workspace, "report-export", {
                "id": request_id("report-export-" + kind), "publication_id": publication["id"],
                "publication_sha256": saved_publication["sha256"], "format": kind})
            raw = read(Path(exported["result"]["path"]), 128 * 1024 * 1024)
            result["report"]["files"][kind] = keep(out / ("report." + extension), raw)
        with zipfile.ZipFile(out / "report.zip") as archive:
            require(archive.read("sources/" + version_id + "-semantics.json") ==
                    workspace.database.semantics_bytes(version_id), "Report dictionary bytes changed")
        workbook = workspace.workbooks.save("SemanticSourceWorkbook", {
            "id": request_id("workbook-definition"), "expected_revision": 0,
            "title": "Reviewed source observations",
            "notes": "Source definitions remain in the complete retained query/report handoff.",
            "sheets": [
                {"name": "Observations", "source": {"kind": "query-export", "id": query["id"],
                                                   "sha256": query["result"]["manifest_sha256"]},
                 "columns": [{"source": name, "header": name, "type": "native", "precision": "preserve"}
                             for name in query_manifest["columns"]]},
                {"name": "Count", "source": {"kind": "report", "id": publication["id"],
                                            "sha256": saved_publication["sha256"], "section": 0},
                 "columns": [{"source": "observation_count", "header": "Observation count", "type": "native"}]}]})
        built = complete(workspace, "workbook", {"id": request_id("workbook"),
                         "name": workbook["name"], "revision": workbook["revision"],
                         "definition_sha256": workbook["definition_sha256"]})
        original_workbook = WorkbookDelivery(Path(built["result"]["directory"]))
        original_workbook.inspect()
        workbook_destination = out / "workbook"
        if (workbook_destination / "manifest.json").exists():
            received_workbook = WorkbookDelivery(workbook_destination)
            require(received_workbook.manifest == original_workbook.manifest,
                    "Existing workbook receiving differs")
            received_workbook.inspect()
        else:
            original_workbook.copy_to(workbook_destination)
        result["workbook"] = {"jobId": built["id"], "directory": str(workbook_destination),
                              "manifestSha256": built["result"]["manifest_sha256"],
                              "rows": built["result"]["row_count"]}
        server, control, launch = serve(workspace)
        worker = threading.Thread(target=server.serve_forever, daemon=False)
        worker.start()
        address = urlsplit(launch)
        origin = address.scheme + "://" + address.netloc

        def get(path):
            with urlopen(Request(origin + path, headers={"X-Analysis-Capability": address.fragment,
                                                        "Origin": origin}), timeout=15) as response:
                return response.read()

        require(parse(get("/api/semantics/" + version_id))["document"] == dictionary,
                "Original analysis HTTP dictionary changed")
        require(get("/api/semantics-file/" + version_id) ==
                workspace.database.semantics_bytes(version_id), "HTTP dictionary bytes changed")
        require(b'id="dictionary"' in get("/") and b"renderSemantics" in get("/app.js"),
                "Original analysis UI meaning controls missing")
        result["http"] = {"dictionarySha256": result["dictionaryFile"]["sha256"],
                          "originalApplication": True, "dictionaryDownload": True}
        backup_directory = out / "database-backup"
        backup_path = backup_directory / "datasets.sqlite3"
        if not backup_path.exists():
            backup_path = workspace.database.backup(backup_directory)
        result["databaseBackup"] = str(backup_path)
    finally:
        if server is not None:
            if worker is not None and worker.is_alive():
                server.shutdown()
            server.server_close()
        if worker is not None:
            worker.join()
        workspace.close()
    reopened = DatasetDatabase(out / "database-backup", create=False)
    require(reopened.semantics(version_id)["document"] == dictionary,
            "Reopened database lost source meaning")
    require(reopened.query(count_sql).rows[0][0] == edition["row_count"], "Reopened row count changed")
    result["reopened"] = {"versionId": version_id, "rows": edition["row_count"], "dictionary": True}
    keep(out / "receiving.json", (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode())
    print(json.dumps({"status": "COMPLETE", "rows": edition["row_count"],
                      "semanticSha256": dictionary["sha256"], "directory": str(out),
                      "workbook": result["workbook"]["directory"]}), flush=True)


if __name__ == "__main__":
    main()
