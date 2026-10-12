#!/usr/bin/env python3
"""MIT. Operate the original OpenAlex OAI feed with the original reviewed receiving console."""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import shutil
import sys
import threading
import zipfile

OAI_SOURCE = Path(__file__).resolve().parents[1]
STARFORGE = OAI_SOURCE.parents[1]
FEED_SOURCE = STARFORGE / "sf88-operator-buyer-cli/research/oai"
sys.path.insert(0, str(OAI_SOURCE))
sys.path.insert(0, str(FEED_SOURCE))
from workspace import Workspace
from harvest import InputError
import oai_feed as feed

SAMPLE_NAME = "OpenAlex_CIIM_Source_Example_20261012.zip"
SAMPLE_SHA256 = "948c5c85a3ec88cf26ab9bae2ebcda284ea429dfa3c8240ac2565e30b278f77b"
SCHEMA = "stellar-forge.oai-pmh-ciim-worked-case.v1"
OPS = {
    "Identify": "ciim-openalex-identify", "ListMetadataFormats": "ciim-openalex-formats",
    "ListSets": "ciim-openalex-sets", "baseline": "ciim-openalex-baseline",
    "frozen": "ciim-openalex-inflight", "withdrawal": "ciim-openalex-withdrawal",
    "restored": "ciim-openalex-restored",
}
SELECTION = {"metadataPrefix": "oai_dc", "set": "openalex"}

def read_json(path):
    return json.loads(Path(path).read_bytes())

def emit(event, **values):
    print(json.dumps({"event": event, **values}, ensure_ascii=False), flush=True)

def file_sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as source:
        while chunk := source.read(65536):
            h.update(chunk)
    return h.hexdigest()

def acquire_sample(case, selected):
    destination = case / "source-example.zip"
    if not destination.exists():
        if selected:
            source = Path(selected).read_bytes()
        else:
            original = FEED_SOURCE / "example" / SAMPLE_NAME
            source = original.read_bytes() if original.exists() else base64.b64decode(
                original.with_name(SAMPLE_NAME + ".b64.txt").read_text(), validate=False)
        if hashlib.sha256(source).hexdigest() != SAMPLE_SHA256:
            raise InputError("Use the unchanged published OpenAlex source example")
        with destination.open("xb") as out:
            os.chmod(destination, 0o600);out.write(source);out.flush();os.fsync(out.fileno())
    if file_sha(destination) != SAMPLE_SHA256:
        raise InputError("The retained original source example changed")
    prepared = feed.prepare(destination, "source-export")
    if len(prepared["records"]) != 169:
        raise InputError("The original source cohort changed")
    return prepared

def harvest(ws, repository_id, name, arguments, baseline=None, run=True):
    op = ws.start(repository_id, "ListRecords", arguments, OPS[name], baseline)
    if run:
        op = ws.run(op["id"])
        if op["status"] != "COMPLETE":
            raise InputError(op.get("lastError") or "Continue the saved harvest operation")
    return op

def reviewed(ws, operation_id, note):
    preview = ws.preview(operation_id)
    if not preview["ready"]:
        choices = {}
        offset = 0
        while True:
            page = ws.changes(preview["id"], "conflict", offset, 100)
            for row in page["items"]:
                incoming = []
                for candidate in row["conflicts"]:
                    record = ws.observation(candidate["id"])
                    request = ws._get("oai_requests", record["requestId"])
                    if request["operationId"] == operation_id:
                        incoming.append(candidate)
                if len(incoming) != 1:
                    raise InputError("Inspect the conflicting original observations in Edition review")
                choices[row["identifier"]] = {
                    "observationId": incoming[0]["id"],
                    "note": "Selected the current recorded source-feed revision for this explicit operator lifecycle action.",
                }
            if page["next"] is None:
                break
            offset = page["next"]
        preview = ws.preview(operation_id, choices)
    return ws.review(preview["id"], preview["id"], "ADC6", note)

def build(ws, edition):
    plan = ws.metadata_mapping(edition["id"], "ciim_openalex_records")
    mapping = ws.save_mapping(plan)
    return ws.build(edition["id"], mapping["id"])

def semantic_members(ws, edition):
    return [(r[0], r[1]) for r in ws.db.execute(
        "SELECT e.identifier,o.semantic_hash FROM oai_edition_records e "
        "JOIN oai_observations o ON o.id=e.observation_id WHERE e.edition_id=? ORDER BY e.identifier",
        (edition["id"],))]

def retained_export(ws, build_id, target):
    if target.exists():
        manifest = read_json(target / "capture/capture.json")
        if manifest["build"]["id"] != build_id or manifest["state"] != "COMPLETE":
            raise InputError("The existing receiving export belongs to another build")
        for entry in manifest["files"]:
            member = target / "capture" / entry["file"]
            if member.stat().st_size != entry["bytes"] or file_sha(member) != entry["sha256"]:
                raise InputError("An existing receiving export member changed")
        return {"directory": str(target), "source": str(target / "source.json"),
                "manifestSha256": file_sha(target / "capture/capture.json"),
                "rows": manifest["build"]["rowCount"], "reused": True}
    return ws.export_source(build_id, target)

def verify_native_rows(ws, dataset, prepared):
    rows, cursor, seen, pages = [], None, set(), 0
    while True:
        query = {"limit": "47"}
        if cursor:
            query["cursor"] = cursor
        response = ws.query(dataset["id"], query)["response"]
        if response["status"] != 200:
            raise InputError("The original dataset query failed")
        body = response["body"]
        if body["dataset"]["snapshot"] != dataset["datasetSnapshot"]:
            raise InputError("The native dataset changed during receiving")
        rows.extend(row if isinstance(row, dict) else dict(zip(body["fields"], row)) for row in body["rows"])
        pages += 1
        cursor = body["page"]["nextCursor"]
        if cursor is None:
            break
        if cursor in seen:
            raise InputError("The original native query repeated a cursor")
        seen.add(cursor)
    expected = {r["identifier"]: r for r in prepared["records"]}
    if [r["identifier"] for r in rows] != sorted(expected):
        raise InputError("The native dataset does not contain the complete original cohort")
    for row in rows:
        original = expected[row["identifier"]]
        for field, values in original["dc"].items():
            if json.loads(row["dc_" + field]) != values:
                raise InputError("A repeated original Dublin Core field changed")
        source = original["source"]
        checks = {"source_edition_id": "editionId", "source_query_sha256": "querySha256",
                  "source_manifest_sha256": "manifestSha256", "source_page": "page",
                  "source_page_sha256": "pageSha256", "source_request_sha256": "requestSha256",
                  "source_record_sha256": "recordSha256", "source_url": "url",
                  "source_retrieved_at": "retrievedAt", "metadata_license": "metadataLicense"}
        if any(row[k] != source.get(v) for k, v in checks.items()):
            raise InputError("Original source provenance changed during XML projection")
    return {"rows": len(rows), "columns": len(rows[0]), "pages": pages,
            "datasetSnapshot": dataset["datasetSnapshot"]}

def completed_case(ws, repository, prepared, case):
    repository_id = ws.add_repository(repository.config["baseURL"], "CIIM scholarly source feed", 0)["id"]
    for verb in ("Identify", "ListMetadataFormats", "ListSets"):
        op = ws.start(repository_id, verb, {}, OPS[verb])
        op = ws.run(op["id"])
        if op["status"] != "COMPLETE":
            raise InputError("Complete the original repository discovery")
    baseline_op = harvest(ws, repository_id, "baseline", SELECTION)
    baseline = reviewed(ws, baseline_op["id"], "Received all 169 original OpenAlex records, repeated Dublin Core values and complete source provenance.")
    baseline_build = build(ws, baseline)
    if baseline["activeRecords"] != 169 or baseline["deletedRecords"] != 0:
        raise InputError("The original baseline population changed")
    emit("baseline_received", edition=baseline["id"], rows=169, sourcePages=baseline_op["pageCount"])
    frozen = harvest(ws, repository_id, "frozen", SELECTION, run=False)
    status = repository.status()
    if status["revision"] == 1:
        if frozen["pageCount"] == 0:
            frozen = ws.fetch_next(frozen["id"])
        if frozen["pageCount"] != 1 or not frozen.get("token", {}).get("value"):
            raise InputError("Retain the first original continuation before the source withdrawal")
        identifier = prepared["records"][0]["identifier"]
        repository.withdraw(identifier, "CIIM receiving walkthrough: explicit source withdrawal", 1)
    status = repository.status()
    withdrawal = next(r for r in status["history"] if r["kind"] == "OPERATOR_WITHDRAWAL")
    identifier = withdrawal["binding"]["identifier"]
    frozen = ws.run(frozen["id"])
    frozen_edition = reviewed(ws, frozen["id"], "Resumed the original retained publication while the source feed has an explicit later withdrawal.")
    if semantic_members(ws, frozen_edition) != semantic_members(ws, baseline):
        raise InputError("The resumed original source selection changed")
    removed_op = harvest(ws, repository_id, "withdrawal", {**SELECTION, "from": withdrawal["created_at"]}, baseline["id"])
    removed = reviewed(ws, removed_op["id"], "Received the original explicit source withdrawal; retained absent baseline members and selected current same-second source revisions where needed.")
    if removed["activeRecords"] != 168 or removed["deletedRecords"] != 1:
        raise InputError("The explicit source withdrawal did not produce the expected retained edition")
    removed_build = build(ws, removed)
    removed_export = retained_export(ws, removed_build["id"], case / "withdrawal-source")
    replay = repository.publish(prepared, repository.current_revision())
    if identifier not in replay["keptWithdrawn"] and repository.current_revision() == 2:
        raise InputError("Ordinary source replay did not retain the explicit withdrawal")
    if repository.current_revision() == 2:
        repository.publish(prepared, 2, [identifier])
    status = repository.status()
    restoration = next(r for r in status["history"] if identifier in r["summary"].get("explicitRestorations", []))
    restored_op = harvest(ws, repository_id, "restored", {**SELECTION, "from": restoration["created_at"]}, removed["id"])
    restored = reviewed(ws, restored_op["id"], "Received the source operator's explicit restoration, preserving original identifiers, repeated metadata and resource rights.")
    if restored["activeRecords"] != 169 or restored["deletedRecords"] != 0:
        raise InputError("The explicit source restoration did not restore the original cohort")
    final_build = build(ws, restored)
    native = verify_native_rows(ws, final_build, prepared)
    final_export = retained_export(ws, final_build["id"], case / "publisher-source")
    backup_path = case / "receiving-workspace.zip"
    backup = ws.backup(backup_path) if not backup_path.exists() else {"path": str(backup_path), "sha256": file_sha(backup_path), "reused": True}
    feed_backup_path = case / "feed-backup.sqlite3"
    feed_backup = repository.backup(feed_backup_path) if not feed_backup_path.exists() else {"path": str(feed_backup_path), "sha256": file_sha(feed_backup_path), "reused": True}
    return {"schema": SCHEMA, "status": "COMPLETE", "sourceArchiveSha256": SAMPLE_SHA256,
            "sourceRepository": repository.config, "withdrawnIdentifier": identifier,
            "baseline": {"editionId": baseline["id"], "buildId": baseline_build["id"], "rows": 169},
            "frozen": {"editionId": frozen_edition["id"], "rows": 169, "sameRecordSemantics": True},
            "withdrawal": {"editionId": removed["id"], "rows": 168, "deleted": 1, "export": removed_export},
            "restoration": {"editionId": restored["id"], "buildId": final_build["id"], **native, "export": final_export},
            "feedRevision": status["revision"], "workspaceBackup": backup, "feedBackup": feed_backup}


def restore_saved_workspaces(case, result):
    """Reopen the original delivered workspaces from their complete saved backups."""
    if result.get("schema") != SCHEMA or result.get("status") != "COMPLETE":
        raise InputError("Continue the original retained receiving case")
    receiver = case / "receiving"
    feed_root = case / "feed"
    if not (feed_root / "feed.sqlite3").exists():
        source = case / "feed-backup.sqlite3"
        expected = result["feedBackup"]
        if source.stat().st_size != expected["bytes"] or file_sha(source) != expected["sha256"]:
            raise InputError("The complete original feed backup changed")
        feed_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        target = feed_root / "feed.sqlite3"
        with target.open("xb") as out, source.open("rb") as original:
            os.chmod(target, 0o600)
            shutil.copyfileobj(original, out, 65536)
            out.flush();os.fsync(out.fileno())
        restored = feed.Repository(feed_root)
        with restored.connect() as db:
            if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise InputError("The restored source feed failed its native database check")
        if restored.current_revision() != result["feedRevision"]:
            raise InputError("The saved feed revision changed")
    if not receiver.exists():
        source = case / "receiving-workspace.zip"
        expected = result["workspaceBackup"]
        if source.stat().st_size != expected["bytes"] or file_sha(source) != expected["sha256"]:
            raise InputError("The complete original receiving backup changed")
        Workspace.restore(source, receiver)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", required=True, help="Private retained source and receiving case directory")
    parser.add_argument("--archive", help="The exact published OpenAlex source example")
    parser.add_argument("--admin-email", default="operator@example.org")
    parser.add_argument("--source-port", type=int, default=8471)
    parser.add_argument("--console-port", type=int, default=0)
    parser.add_argument("--serve", action="store_true", help="Open the same feed and receiving console after the complete walkthrough")
    parser.add_argument("--open-only", action="store_true", help="Open an already completed case without applying lifecycle actions")
    args = parser.parse_args()
    case = Path(args.case).absolute();case.mkdir(mode=0o700, parents=True, exist_ok=True)
    prepared = acquire_sample(case, args.archive)
    result_path = case / "receiving-case.json"
    if args.open_only or result_path.exists():
        result = read_json(result_path)
        restore_saved_workspaces(case, result)
    config = {"repositoryName": "Scholarly metadata source", "baseURL": "http://127.0.0.1:" + str(args.source_port) + "/oai",
              "adminEmail": args.admin_email, "pageSize": 50, "setSpec": "openalex", "setName": "OpenAlex works"}
    repository = feed.Repository.initialize(case / "feed", config)
    if repository.current_revision() == 0:
        repository.publish(prepared, 0)
    service = feed.make_server(repository, "127.0.0.1", args.source_port)
    worker = threading.Thread(target=lambda: service.serve_forever(poll_interval=0.1), daemon=True)
    worker.start()
    try:
        if args.open_only or result_path.exists():
            result = read_json(result_path)
            if result.get("schema") != SCHEMA or result.get("status") != "COMPLETE":
                raise InputError("Continue the original retained receiving case")
        else:
            if repository.current_revision() > 3:
                raise InputError("The source feed contains additional operator revisions")
            ws = Workspace(case / "receiving", create=not (case / "receiving/workspace.json").exists())
            try:
                result = completed_case(ws, repository, prepared, case)
            finally:
                ws.close()
            feed.atomic_json(result_path, result)
        emit("complete_receiving_case", **result)
        if args.serve:
            emit("source_feed_open", url=repository.config["baseURL"], revision=repository.current_revision())
            from server import serve
            serve(case / "receiving", args.console_port)
    finally:
        service.shutdown();service.server_close();worker.join(timeout=5)

if __name__ == "__main__":
    try:
        main()
    except (InputError, feed.FeedError, OSError, ValueError, KeyError, sqlite3.Error, zipfile.BadZipFile) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise SystemExit(2)
