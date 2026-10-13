#!/usr/bin/env python3
"""Continue a completed original run revision through GIS, source adoption and reopen."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
import subprocess
import time


COLD_REOPEN = r"""
import hashlib,json,sys
from pathlib import Path
application=Path(sys.argv[1]).resolve(strict=True)
sys.path[:0]=[str(application/'operator'),str(application)]
from server import Operator
from gis_projects import GISProjects
from model import gis_revision_context as context, gis_project as gis
value=json.loads(sys.stdin.read())
operator=Operator(value['workspace'],value['state_directory'])
try:
    key=operator.primary
    ws=operator.ws(key)
    if ws.project['id']!=value['project_id']:
        raise ValueError('The copied application opened a different scientific project')
    captured=context._frozen(ws,ws.root/context.ROOT/value['context_id'],context.binding(value['binding']))
    if captured!=value['context']:
        raise ValueError('The copied application changed the original revision context')
    feature=GISProjects(operator)
    shown=feature.describe(key,'received',value['receipt_id'])
    if shown['result']['fingerprint']!=value['fingerprint']:
        raise ValueError('The copied application changed the received GIS edition')
    project=ws.root/'gis-received'/value['receipt_id']/'project'
    gis.verify(project)
    named,entry=ws.source_file(value['adopted_source_collection_id'],value['adopted_source_id'])
    if entry!=value['source_entry'] or gis.sha256(named)!=value['source_sha256']:
        raise ValueError('The copied application changed the adopted original source')
    ticket=feature.describe(key,'export',value['export_id'])['archive_download']
    stream,_=operator.open_download(ticket['id'])
    checksum=hashlib.sha256();count=0
    try:
        while True:
            block=stream.read(1024*1024)
            if not block:break
            checksum.update(block);count+=len(block)
    finally:stream.close()
    actual={'bytes':count,'sha256':checksum.hexdigest()}
    if actual!=value['archive']:
        raise ValueError('A copied-application GIS download differs from the original')
    print(json.dumps({'project_id':ws.project['id'],'workspace_key':key,
      'context_id':captured['id'],'archive':actual,'application':str(application),
      'workspace':str(ws.root),'viewer':str(project/'OPEN_GIS.html'),
      'qgis_project':str(project/'project.qgz'),'context_html':str(named)}))
finally:
    operator.close()
"""


def receive(application, workspace, state_directory, *, revision_id=None,
            execution_history_id=None, timeout=600):
    application, workspace = Path(application).resolve(), Path(workspace).resolve()
    state_directory = Path(state_directory).resolve()
    if state_directory == workspace or state_directory.is_relative_to(workspace):
        raise ValueError("Keep receiving state outside the original Workspace being backed up.")
    state_directory.mkdir(parents=True, exist_ok=True)
    sys.path[:0] = [str(application / "operator"), str(application)]
    from server import Operator
    from gis_projects import GISProjects
    from model import gis_project as gis, gis_workspace, gis_revision_context as context
    from model.common import atomic_json, digest

    journal_path = state_directory / "run-revision-gis-receiving.json"
    receipt = json.loads(journal_path.read_text(encoding="utf-8")) if journal_path.is_file() else None
    operator = Operator(workspace, state_directory)
    try:
        key, ws = operator.primary, operator.ws(operator.primary)
        feature = GISProjects(operator)
        if receipt:
            chosen = receipt["payload"]["run_revision"]
            if (receipt["identity"]["project_id"] != ws.project["id"]
                    or revision_id and revision_id != chosen["revision_id"]
                    or execution_history_id and execution_history_id != chosen.get("execution_history", {}).get("id")):
                raise ValueError("Use the retained revision/history or a separate receiving state.")
            identity = receipt["identity"]
        else:
            if not revision_id:
                raise ValueError("Choose a completed original --revision-id; this course does not create or run models.")
            original = feature.catalogue(key, run_revision_id=revision_id,
                                         execution_history_id=execution_history_id)["run_revision"]
            chosen = original["binding"]
            identity = {"project_id": ws.project["id"], "binding": chosen,
                        "receiver_version": context.VERSION}
            receipt = {"schema": "upstate.run-revision-gis-receiving/v1", "identity": identity, "phases": {},
                       "payload": {"title": original["title"] + " · reference and revision",
                                   "run_revision": chosen,
                                   "notes": ["Original completed reference/revised pair, input context and saved comparison."]}}
            atomic_json(journal_path, receipt)

        def complete(phase, action, payload):
            request = {"workspace": key, "action": action, "payload": payload}
            prior = receipt["phases"].get(phase)
            if prior:
                if prior["request"] != request:
                    raise ValueError("The retained receiving phase changed its original request.")
                task = operator.task(prior["task_id"])
            else:
                task = operator.submit(key, action, payload,
                    "eco264b-revision-gis-" + digest(identity)[:16] + "-" + phase)
                if any(task.get(name) != value for name, value in request.items()):
                    raise ValueError("The original queue returned another receiving request.")
                receipt["phases"][phase] = {"request": request, "task_id": task["id"],
                                            "operation_id": task["operation_id"]}
                atomic_json(journal_path, receipt)
            if (any(task.get(name) != value for name, value in request.items())
                    or task["operation_id"] != receipt["phases"][phase]["operation_id"]):
                raise ValueError("The original accepted task changed identity.")
            if task["state"] in {"failed", "interrupted", "cancelled"}:
                task = operator.resume(task["id"])
            deadline = time.monotonic() + timeout
            while task["state"] in {"queued", "running"}:
                if time.monotonic() >= deadline:
                    raise TimeoutError("Original receiving phase remains active: " + task["id"])
                time.sleep(.1)
                task = operator.task(task["id"])
            if task["state"] != "complete":
                raise RuntimeError(json.dumps(task, ensure_ascii=False))
            if "result" in receipt["phases"][phase] and receipt["phases"][phase]["result"] != task["result"]:
                raise ValueError("The completed receiving phase changed its retained result.")
            receipt["phases"][phase]["result"] = task["result"]
            atomic_json(journal_path, receipt)
            return task

        exported = complete("export", "gis.project.export", receipt["payload"])
        context_id = gis.fingerprint({"schema": context.SCHEMA, "version": context.VERSION,
                                      "project_id": ws.project["id"], "binding": context.binding(chosen)})
        captured = context._frozen(ws, ws.root / context.ROOT / context_id, context.binding(chosen))
        reference, revised = captured["selection"]["baseline_run_id"], captured["selection"]["scenario_run_ids"][0]
        shown = feature.describe(key, "export", exported["result"]["id"])
        ticket = shown["archive_download"]
        stream, _ = operator.open_download(ticket["id"])
        try:
            upload = operator.receive_upload(stream, ticket["bytes"], ticket["filename"], "application/zip")
        finally:
            stream.close()
        if (upload["sha256"], upload["bytes"]) != (ticket["sha256"], ticket["bytes"]):
            raise AssertionError("The original complete GIS download changed during upload.")
        incoming = complete("receive", "gis.project.receive", {"upload_id": upload["id"]})
        opened = feature.describe(key, "received", incoming["result"]["id"])
        if opened["result"]["fingerprint"] != shown["result"]["fingerprint"]:
            raise AssertionError("Receiving changed the original editable GIS edition.")
        export_root = ws.root / "gis-exports" / shown["id"] / "project"
        incoming_root = ws.root / "gis-received" / opened["id"] / "project"
        outgoing, received = gis.load(export_root / "project.json"), gis.load(incoming_root / "project.json")
        if outgoing != received:
            raise AssertionError("Receiving changed the complete GIS layer and source metadata.")
        gis.verify(export_root)
        gis.verify(incoming_root)
        if [row["id"] for row in outgoing["provenance"]["runs"]] != [reference, revised]:
            raise AssertionError("The received project changed the original reference/revised role order.")
        selector = captured["selection"]["sources"][0]
        source = gis_workspace.source_layer(ws, selector)
        matches = [row for row in outgoing["attachments"]
                   if row.get("source", {}).get("collection_id") == selector["source_collection_id"]
                   and row.get("source", {}).get("id") == selector["source_id"]]
        if len(matches) != 1:
            raise AssertionError("The original revision context did not travel as one complete registered source.")
        attachment = matches[0]
        expected = [source["file"], *source["companions"]]
        if [(row["source_path"], row["bytes"], row["sha256"]) for row in attachment["files"]] != [
                (row["path"], row["bytes"], row["sha256"]) for row in expected]:
            raise AssertionError("Revision JSON, input context or selected history companions changed.")
        if attachment["source"]["provenance"] != source["source"]["provenance"]:
            raise AssertionError("The received context changed its original revision binding.")
        adopted = complete("adopt", "gis.project.adopt-sources", {
            "receipt_id": opened["id"], "layer_ids": [], "attachment_ids": [attachment["id"]],
            "title": shown["title"] + " · received revision context",
            "reason": "Retain the exact received original revision and companions as an independently selectable source."})
        adopted_collection = ws._get("sources", adopted["result"]["source_collection_id"])
        adopted_entries = [entry for entry in adopted_collection["entries"]
                           if entry.get("received_gis", {}).get("source", {}).get("collection_id") == selector["source_collection_id"]
                           and entry.get("received_gis", {}).get("source", {}).get("id") == selector["source_id"]]
        if len(adopted_entries) != 1:
            raise AssertionError("The received source lost the original revision-source identity.")
        entry = adopted_entries[0]
        named, _ = ws.source_file(adopted_collection["id"], entry["id"])
        if gis.sha256(named) != source["file"]["sha256"]:
            raise AssertionError("Adoption changed the original readable revision context.")
        retained_members = [(row["sha256"], row["bytes"]) for row in [entry["body"], *entry.get("companions", [])]]
        if retained_members != [(row["sha256"], row["bytes"]) for row in expected]:
            raise AssertionError("Adoption lost an original revision/history member.")
        result = {"schema": "upstate.run-revision-gis-receiving-result/v1",
                  "status": "gis_received_and_adopted", "identity": identity, "workspace_key": key,
                  "reference_run_id": reference, "revised_run_id": revised,
                  "comparison_id": captured["selection"]["comparison_ids"][0],
                  "context_id": context_id, "source_collection_id": captured["source_collection_id"],
                  "export_id": shown["id"], "receipt_id": opened["id"],
                  "adopted_source_collection_id": adopted_collection["id"], "adopted_source_id": entry["id"],
                  "original_context_files": len(expected), "layers": len(outgoing["layers"]),
                  "archive": {"bytes": ticket["bytes"], "sha256": ticket["sha256"]},
                  "viewer": str(incoming_root / "OPEN_GIS.html"), "qgis_project": str(incoming_root / "project.qgz"),
                  "registered_context": str(named), "phases": receipt["phases"]}

        backup = complete("backup", "workspace.backup", {"include_intermediates": True})
        backup_tickets = operator.task_view(backup["id"]).get("_downloads", [])
        if len(backup_tickets) != 1:
            raise ValueError("The complete original Workspace backup lacks a unique download.")
        backup_ticket = backup_tickets[0]
        stream, _ = operator.open_download(backup_ticket["id"])
        try:
            backup_upload = operator.receive_upload(stream, backup_ticket["bytes"],
                                                     backup_ticket["filename"], "application/zip")
        finally:
            stream.close()
        if (backup_upload["sha256"], backup_upload["bytes"]) != (backup_ticket["sha256"], backup_ticket["bytes"]):
            raise AssertionError("The original Workspace backup changed during receiving.")
        restored = complete("restore", "workspace.restore", {"upload_id": backup_upload["id"]})
        restored_ws = operator.ws(restored["result"]["workspace_key"])
        if restored_ws.project != ws.project:
            raise AssertionError("Workspace restore changed the original scientific project.")
        restored_context = context._frozen(restored_ws, restored_ws.root / context.ROOT / context_id, context.binding(chosen))
        if restored_context != captured:
            raise AssertionError("Workspace restore changed the frozen revision context.")
        restored_application = Path(restored["result"]["application"]).resolve(strict=True)
        cold_input = {"workspace": str(restored_ws.root),
                      "state_directory": str(state_directory / "copied-application"),
                      "project_id": ws.project["id"], "context_id": context_id, "binding": chosen,
                      "context": captured, "export_id": shown["id"], "receipt_id": opened["id"],
                      "fingerprint": shown["result"]["fingerprint"],
                      "adopted_source_collection_id": adopted_collection["id"], "adopted_source_id": entry["id"],
                      "source_entry": entry, "source_sha256": source["file"]["sha256"],
                      "archive": {"bytes": ticket["bytes"], "sha256": ticket["sha256"]}}
        result["workspace_backup"] = {"bytes": backup_ticket["bytes"], "sha256": backup_ticket["sha256"]}
        result["restored"] = restored["result"]
        result["owner_direction"] = "CURRENT_OWNER_DIRECTION.md v2026-10-13.3"
        atomic_json(state_directory / "run-revision-gis-result.json", result)
    finally:
        operator.close()

    operator = Operator(workspace, state_directory)
    try:
        key, ws = operator.primary, operator.ws(operator.primary)
        feature = GISProjects(operator)
        reopened = feature.describe(key, "received", result["receipt_id"])
        if reopened["result"]["fingerprint"] != opened["result"]["fingerprint"]:
            raise AssertionError("Restart changed the retained GIS edition.")
        context._frozen(ws, ws.root / context.ROOT / result["context_id"], context.binding(chosen))
        for phase in receipt["phases"].values():
            task = operator.task(phase["task_id"])
            if (task["state"] != "complete" or task["operation_id"] != phase["operation_id"]
                    or task["result"] != phase["result"]):
                raise AssertionError("Restart changed the completed original operation.")
        fresh = feature.describe(key, "export", result["export_id"])["archive_download"]
        if (fresh["sha256"], fresh["bytes"]) != (ticket["sha256"], ticket["bytes"]):
            raise AssertionError("Restart changed the complete original download.")
        stream, _ = operator.open_download(fresh["id"])
        stream.close()
        named, reopened_entry = ws.source_file(result["adopted_source_collection_id"], result["adopted_source_id"])
        if reopened_entry != entry or gis.sha256(named) != source["file"]["sha256"]:
            raise AssertionError("Restart changed the adopted original context.")
        result["restart_same_records_sources_and_download"] = True
        atomic_json(state_directory / "run-revision-gis-result.json", result)
    finally:
        operator.close()

    completed = subprocess.run([sys.executable, "-c", COLD_REOPEN, str(restored_application)],
        input=json.dumps(cold_input), text=True, capture_output=True, cwd=restored_application, check=False)
    if completed.returncode:
        raise RuntimeError("Copied-application revision/GIS reopening failed:\\n" + completed.stderr)
    cold = json.loads(completed.stdout)
    if cold["archive"] != cold_input["archive"]:
        raise AssertionError("The copied application changed an original GIS archive.")
    result["copied_application"] = cold
    result["status"] = "native_course_complete"
    result["visual_review_targets"] = {"application": str(restored_application),
        "gis_html": cold["viewer"], "qgis_project": cold["qgis_project"],
        "revision_html": cold["context_html"], "complete_workspace": result["workspace_backup"],
        "original_context_companions": sorted(captured["files"])}
    atomic_json(state_directory / "run-revision-gis-result.json", result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--state-directory", type=Path, required=True)
    parser.add_argument("--revision-id")
    parser.add_argument("--execution-history-id")
    parser.add_argument("--timeout", type=float, default=600)
    args = parser.parse_args()
    print(json.dumps(receive(args.application, args.workspace, args.state_directory,
        revision_id=args.revision_id, execution_history_id=args.execution_history_id,
        timeout=args.timeout), ensure_ascii=False, indent=2))
