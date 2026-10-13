#!/usr/bin/env python3
"""Continue one saved native study through GIS export, receive and cold reopen."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
import time


def receive(application, workspace, state_directory, *, source_collection_id=None, timeout=600):
    application, workspace = Path(application).resolve(), Path(workspace).resolve()
    state_directory = Path(state_directory).resolve()
    state_directory.mkdir(parents=True, exist_ok=True)
    sys.path[:0] = [str(application / "operator"), str(application)]
    from server import Operator
    from gis_projects import GISProjects
    from model import gis_project as gis, gis_native_study
    from model.common import atomic_json, digest

    journal_path = state_directory / "native-study-gis-receiving.json"
    retained = json.loads(journal_path.read_text(encoding="utf-8")) if journal_path.is_file() else None
    operator = Operator(workspace, state_directory)
    try:
        key, ws = operator.primary, operator.ws(operator.primary)
        if retained:
            saved = retained["identity"]["source_collection_id"]
            if source_collection_id and source_collection_id != saved:
                raise ValueError("Use the retained original study or a separate receiving state.")
            source_collection_id = saved
        if source_collection_id is None:
            candidates = [row for row in gis_native_study.choices(ws) if row["local_project"]]
            if len(candidates) != 1:
                raise ValueError("Select one actual saved source with --source-collection-id.")
            source_collection_id = candidates[0]["source_collection_id"]
        chosen = {"source_collection_id": source_collection_id,
                  "source_id": "saved-native-ensemble-study"}
        original = gis_native_study.preview(ws, chosen)
        identity = {"project_id": ws.project["id"],
                    "source_collection_id": source_collection_id,
                    "source_id": original["source_id"], "source_sha256": original["source_sha256"],
                    "ensemble_id": original["ensemble_id"], "report_id": original["report_id"],
                    "receiver_version": gis_native_study.VERSION}
        if retained and retained["identity"] != identity:
            raise ValueError("The retained GIS receiving belongs to another original native-study edition.")
        receipt = retained or {"schema": "upstate.native-study-gis-receiving/v1",
                              "identity": identity, "phases": {}}
        if "payload" not in receipt:
            chosen["source_sha256"] = original["source_sha256"]
            if original["rendered_report"]:
                chosen["rendered_report"] = {
                    name: original["rendered_report"][name]
                    for name in ("source_operation_id", "files_sha256")}
            receipt["payload"] = {"title": original["source_title"] + " · editable GIS",
                                  "native_study": chosen,
                                  "notes": ["Original completed native-study results and reporting context."]}
            atomic_json(journal_path, receipt)

        def complete(phase, action, payload):
            request = {"workspace": key, "action": action, "payload": payload}
            prior = receipt["phases"].get(phase)
            if prior:
                if prior["request"] != request:
                    raise ValueError("The native GIS receiving phase changed its original request.")
                task = operator.task(prior["task_id"])
            else:
                task = operator.submit(key, action, payload,
                                       "eco264b-native-gis-" + digest(identity)[:16] + "-" + phase)
                if any(task.get(name) != value for name, value in request.items()):
                    raise ValueError("The native GIS queue returned a different original request.")
                receipt["phases"][phase] = {"request": request, "task_id": task["id"],
                                            "operation_id": task["operation_id"]}
                atomic_json(journal_path, receipt)
            if (any(task.get(name) != value for name, value in request.items())
                    or task["operation_id"] != receipt["phases"][phase]["operation_id"]):
                raise ValueError("The retained GIS task changed its accepted identity.")
            if task["state"] in {"failed", "interrupted", "cancelled"}:
                task = operator.resume(task["id"])
            deadline = time.monotonic() + timeout
            while task["state"] in {"queued", "running"}:
                if time.monotonic() >= deadline:
                    raise TimeoutError("The original GIS phase remains active: " + task["id"])
                time.sleep(.1)
                task = operator.task(task["id"])
            if task["state"] != "complete":
                raise RuntimeError(json.dumps(task, ensure_ascii=False))
            receipt["phases"][phase]["result_id"] = task["result"]["id"]
            atomic_json(journal_path, receipt)
            return task

        exported = complete("export", "gis.project.export", receipt["payload"])
        feature = GISProjects(operator)
        shown = feature.describe(key, "export", exported["result"]["id"])
        ticket = shown["archive_download"]
        stream, unused = operator.open_download(ticket["id"])
        try:
            upload = operator.receive_upload(stream, ticket["bytes"], ticket["filename"], "application/zip")
        finally:
            stream.close()
        if (upload["sha256"], upload["bytes"]) != (ticket["sha256"], ticket["bytes"]):
            raise AssertionError("The native GIS upload differs from its original complete download.")
        incoming = complete("receive", "gis.project.receive", {"upload_id": upload["id"]})
        opened = feature.describe(key, "received", incoming["result"]["id"])
        if opened["result"]["fingerprint"] != shown["result"]["fingerprint"]:
            raise AssertionError("Independent receiving changed the original GIS edition.")
        export_root = ws.root / "gis-exports" / shown["id"] / "project"
        incoming_root = ws.root / "gis-received" / opened["id"] / "project"
        outgoing = gis.load(export_root / "project.json")
        adopted = gis.load(incoming_root / "project.json")
        if outgoing != adopted:
            raise AssertionError("Independent receiving changed native layers, source context or metadata.")
        gis.verify(export_root)
        gis.verify(incoming_root)
        binding = outgoing["provenance"]["native_study"]
        if (binding["source_sha256"] != original["source_sha256"]
                or binding["selection"]["ensemble_id"] != original["ensemble_id"]
                or binding["selection"]["report_id"] != original["report_id"]):
            raise AssertionError("The received GIS edition lost its captured native-study selection.")
        complete_source = next(row for row in outgoing["attachments"]
                               if row["id"] == binding["context_attachment_id"])
        collection = ws._get("sources", source_collection_id)
        entry = next(row for row in collection["entries"] if row["id"] == original["source_id"])
        expected = [entry["body"], *entry.get("companions", [])]
        actual = complete_source["files"]
        if sorted((row["sha256"], row["bytes"]) for row in expected) != sorted(
                (row["sha256"], row["bytes"]) for row in actual):
            raise AssertionError("The editable handover lost an original native-study source companion.")
        for layer in outgoing["layers"]:
            source = layer.get("source", {}).get("native_study")
            if not source or source["source_sha256"] != original["source_sha256"]:
                raise AssertionError("A received native layer lost its frozen study lineage.")
        result = {"schema": "upstate.native-study-gis-receiving-result/v1",
                  "status": "native_course_complete", "identity": identity,
                  "workspace_key": key, "export_id": shown["id"], "receipt_id": opened["id"],
                  "run_count": original["run_count"], "comparison_count": original["comparison_count"],
                  "grid": original["grid"], "scope": original["scope"], "quantities": original["quantities"],
                  "layers": len(outgoing["layers"]), "attachments": len(outgoing["attachments"]),
                  "original_source_members": len(expected), "archive": {
                      "bytes": ticket["bytes"], "sha256": ticket["sha256"]},
                  "viewer": str(incoming_root / "OPEN_GIS.html"),
                  "qgis_project": str(incoming_root / "project.qgz"),
                  "actual_output_paths": {"export": str(export_root), "received": str(incoming_root)},
                  "phases": receipt["phases"]}
        atomic_json(state_directory / "native-study-gis-result.json", result)
    finally:
        operator.close()

    operator = Operator(workspace, state_directory)
    try:
        key, ws = operator.primary, operator.ws(operator.primary)
        feature = GISProjects(operator)
        reopened = feature.describe(key, "received", result["receipt_id"])
        if reopened["result"]["fingerprint"] != opened["result"]["fingerprint"]:
            raise AssertionError("Restart changed the original received GIS edition.")
        for phase in receipt["phases"].values():
            task = operator.task(phase["task_id"])
            if (task["state"] != "complete" or task["result"]["id"] != phase["result_id"]
                    or task["operation_id"] != phase["operation_id"]):
                raise AssertionError("Restart changed an original completed GIS operation.")
        fresh = feature.describe(key, "export", result["export_id"])["archive_download"]
        if (fresh["bytes"], fresh["sha256"]) != (ticket["bytes"], ticket["sha256"]):
            raise AssertionError("Restart changed the complete GIS download.")
        stream, unused = operator.open_download(fresh["id"])
        stream.close()
        result["restart_same_records_and_download"] = True
        result["workspace_key"] = key
        atomic_json(state_directory / "native-study-gis-result.json", result)
        return result
    finally:
        operator.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--state-directory", type=Path, required=True)
    parser.add_argument("--source-collection-id")
    parser.add_argument("--timeout", type=float, default=600)
    args = parser.parse_args()
    print(json.dumps(receive(args.application, args.workspace, args.state_directory,
                             source_collection_id=args.source_collection_id,
                             timeout=args.timeout), ensure_ascii=False, indent=2))
