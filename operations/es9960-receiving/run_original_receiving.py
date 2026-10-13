"""Exercise complete project receiving through the installed original operator.

Run this once on the composed current application. All source bytes come from
the retained MRLC and Oconee publisher metadata inputs. The original native queue
creates, cancels, receives, reopens and resumes the source operations. No model is run.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import time
from urllib.parse import quote

INPUTS = {
    "complete": {
        "filename": "Annual_NLCD_LndCov_2025_CU_C1V2.xml",
        "sha256": "abf071bc22e9e346433d8686c0b6f9c3107d491a57ee8ce6d46d9e4a4d362030",
        "mime_type": "application/xml",
        "metadata": {
            "kind": "document", "role": "RASTER_SOURCE_METADATA",
            "title": "Annual NLCD Land Cover 2025 Collection 1 version 2 — original metadata",
            "uri": "https://www.mrlc.gov/downloads/sciweb1/shared/mrlc/metadata/Annual_NLCD_LndCov_2025_CU_C1V2.xml",
            "vintage": "2025 Collection 1 version 2",
        },
    },
    "unfinished": {
        "filename": "oconee-parcels-layer-body.json.gz",
        "sha256": "439a6c21e06b6690babbaade0d40597388cd416e485f5028547c29017a857304",
        "mime_type": "application/gzip",
        "metadata": {
            "kind": "document", "role": "OVERLAY_SOURCE_METADATA",
            "title": "Oconee County Parcels — original layer metadata",
            "uri": "https://arcserver2.oconeesc.com/arcgis/rest/services/PARCELDATA/MapServer/1",
            "vintage": "Retained publisher capture 2026-10-12",
        },
    },
}
TERMINAL = {"complete", "failed", "cancelled", "interrupted"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, type=Path)
    parser.add_argument("--inputs", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    application = args.application.resolve(strict=True)
    args.output.mkdir(parents=True, exist_ok=True)
    output = args.output.resolve()
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(application / "operator"))
    sys.path.insert(0, str(application))
    import server
    from model.common import atomic_json, read_json, file_digest
    from project_continuity import ACTIONS, INCREMENTAL_ACTIONS, ProjectContinuity
    from project_transfer import ACTIONS as TRANSFER_ACTIONS

    plan_path = output / "original-receiving-operation.json"
    if plan_path.exists():
        plan = read_json(plan_path)
        if plan["application"] != str(application):
            raise ValueError("Keep this operation on its original composed application")
    else:
        plan = {"schema": "upstate.native-project-continuity-exercise/v1",
                "application": str(application), "inputs": {}, "steps": {},
                "receiving": {}, "state": "running"}
        atomic_json(plan_path, plan, immutable=True)

    operators = []
    def emit(event, **fields):
        print(json.dumps({"event": event, **fields}, ensure_ascii=False), flush=True)

    def save():
        atomic_json(plan_path, plan)

    def open_operator(name):
        operator = server.Operator(
            output / name / "workspace", output / name / "operator", create=True,
            title="Upper Savannah — complete project receiving")
        operators.append(operator)
        registry = getattr(operator, "extensions", None)
        if registry is None:
            raise ValueError("Install the maintained ECSA extension host before this operation")
        accepted = set(server.ACTIONS) | set(registry.accepted_actions)
        if not ACTIONS.issubset(accepted) or not INCREMENTAL_ACTIONS.issubset(accepted):
            raise ValueError("Install both complete continuity and original incremental handover components")
        entry = registry._extensions.get("project-transfer")
        if entry is None or set(entry["actions"]) != set(TRANSFER_ACTIONS):
            raise ValueError("Use the matching complete registered transport descriptor and original provider")
        if set(TRANSFER_ACTIONS) & set(registry._builtin_actions):
            raise ValueError("The maintained transport descriptor must be the single action owner")
        if any(registry._actions.get(action) is not entry for action in TRANSFER_ACTIONS):
            raise ValueError("Every original transport action must dispatch through the same registered provider")
        if getattr(operator, "project_transfers", None) is not entry["provider"]:
            raise ValueError("Continuity and the maintained descriptor must share the original transport provider")
        if entry["provider"].operator is not operator:
            raise ValueError("The registered transport provider belongs to another operator")
        plan.setdefault("operators", {})[name] = {
            "registration_owner": entry["id"],
            "descriptor_version": entry["manifest"].get("version"),
            "actions": sorted(TRANSFER_ACTIONS),
            "shared_transport_provider": True,
        }
        save()
        return operator

    def reopen_operator(name, operator):
        workspace_keys = sorted(operator.workspaces)
        operator.close()
        operators.remove(operator)
        replacement = open_operator(name)
        if sorted(replacement.workspaces) != workspace_keys:
            raise ValueError("Reopening lost a retained original or receiving workspace")
        plan.setdefault("reopenings", {})[name] = {
            "workspace_keys": workspace_keys,
            "registered_transport_owner": "project-transfer",
            "shared_transport_provider": True,
        }
        save()
        emit("operator_reopened", name=name, workspace_keys=workspace_keys)
        return replacement

    def service(operator):
        return ProjectContinuity(operator, server.Fault, supported_actions=(
            set(server.ACTIONS) | set(operator.extensions.accepted_actions)))

    def wait_task(operator, task_id):
        observed = None
        while True:
            task = operator.task(task_id)
            if task["state"] != observed:
                emit("original_task", id=task_id, action=task["action"],
                     state=task["state"], error=task.get("error"))
                observed = task["state"]
            if task["state"] in TERMINAL:
                if task["state"] != "complete":
                    raise RuntimeError("Original task did not complete: " + json.dumps(task))
                return task
            time.sleep(0.1)

    def continue_task(operator, task_id):
        # Reopening the original operator retains these exact request IDs and
        # marks an interrupted active step. A repeated invocation continues that
        # saved step once; a new failure is surfaced by wait_task immediately.
        existing = operator.task(task_id)
        if existing["state"] in {"interrupted", "failed"}:
            operator.resume(task_id)
        return wait_task(operator, task_id)

    def action(operator, workspace, name, payload, step):
        operation_id = "ES_9960_CONTINUITY_" + step.upper()
        accepted = operator.submit(workspace, name, payload, operation_id)
        plan["steps"][step] = {"id": accepted["id"], "operation_id": operation_id,
                               "action": name, "workspace_key": workspace}
        save()
        task = continue_task(operator, accepted["id"])
        view = operator.task_view(task["id"])
        plan["steps"][step].update(
            state=task["state"], result=task["result"],
            downloads=view.get("_downloads", []))
        save()
        return task

    def upload(operator, path, mime="application/octet-stream"):
        with Path(path).open("rb") as stream:
            return operator.receive_upload(
                stream, Path(path).stat().st_size, quote(Path(path).name, safe=""), mime)

    def source_selection(sender, name):
        if name in plan["inputs"]:
            selection = plan["inputs"][name]
            sender.upload(selection["upload"]["id"])
            return selection
        source = INPUTS[name]
        path = args.inputs / source["filename"]
        if file_digest(path) != source["sha256"]:
            raise ValueError("Use the retained original publisher bytes: " + str(path))
        uploaded = upload(sender, path, source["mime_type"])
        preview = sender.preview_source(
            {"upload_id": uploaded["id"], "file_metadata": source["metadata"]})
        selection = {"upload": uploaded, "preview_id": preview["id"],
                     "source_sha256": source["sha256"], "source": source["metadata"]}
        plan["inputs"][name] = selection
        save()
        return selection

    def verify_received(receiver, received, transfer_id, route, original_complete, original_pending):
        workspace_key = received["workspace_key"]
        workspace = receiver.ws(workspace_key)
        if workspace.project != sender.ws(sender.primary).project:
            raise ValueError("Receiving changed the original project identity")
        restored = received["recovery"]
        completed = next(row for row in restored["tasks"]
                         if row["operation_id"] == original_complete["operation_id"])
        pending = next(row for row in restored["tasks"]
                       if row["operation_id"] == original_pending["operation_id"])
        if receiver.task(completed["id"])["result"]["id"] != original_complete["result"]["id"]:
            raise ValueError("Receiving changed the retained completed source collection")
        if completed["state"] != "complete":
            raise ValueError("Receiving did not retain completed source history")
        actual_pending = receiver.task(pending["id"])
        original_origin = actual_pending["transfer_origin"]
        if original_origin["task_id"] != original_pending["id"]:
            raise ValueError("Receiving lost the original unfinished task identity")
        if actual_pending["operation_id"] != original_pending["operation_id"]:
            raise ValueError("Receiving changed the original operation identity")
        if not actual_pending["attempts"] and actual_pending["state"] != "cancelled":
            raise ValueError("Receiving lost the original cancellation state")
        original_upload = plan["inputs"]["unfinished"]["upload"]
        restored_upload = receiver.upload(original_upload["id"])
        if {k: v for k, v in restored_upload.items() if k != "path"} != original_upload:
            raise ValueError("Receiving changed an original unfinished upload")
        native_object = Path(restored_upload["path"])
        before = native_object.stat()
        replay = service(receiver).recover(workspace_key, transfer_id)
        after = native_object.stat()
        if (before.st_ino, before.st_size, before.st_mtime_ns) != (
                after.st_ino, after.st_size, after.st_mtime_ns):
            raise ValueError("Recovery replay copied a previously verified immutable upload")

        resumed = action(receiver, workspace_key, "workspace.recovery.resume",
                         {"transfer_id": transfer_id, "task_ids": [pending["id"]]},
                         route + "_resume")
        for task_id in resumed["result"]["queued"]:
            continue_task(receiver, task_id)
        finished = receiver.task(pending["id"])
        completed_attempts = [attempt for attempt in finished["attempts"]
                              if attempt.get("state") == "complete"]
        if finished["state"] != "complete" or len(completed_attempts) != 1:
            raise ValueError("The receiving operator did not complete the original unfinished import once")
        expected_collections = {original_complete["result"]["id"], finished["result"]["id"]}
        if {row["id"] for row in workspace.sources()} != expected_collections:
            raise ValueError("Receiving or continuation changed the two original source collections")
        entry = workspace._get("sources", finished["result"]["id"])["entries"][0]
        retained, _ = workspace.source_file(finished["result"]["id"], entry["id"])
        if file_digest(retained) != INPUTS["unfinished"]["sha256"]:
            raise ValueError("The resumed import changed the publisher input")
        repeated = service(receiver).recover(workspace_key, transfer_id)
        if receiver.task(pending["id"])["state"] != "complete":
            raise ValueError("Recovery replay replaced receiving progress")

        received_application = Path(received["application"])
        required_native = sorted(p.relative_to(application).as_posix()
                                 for p in (application / "ecsa_runs").rglob("*")
                                 if p.is_file() and p.suffix != ".pyc" and "__pycache__" not in p.parts)
        if not required_native:
            raise ValueError("Use the current application with its original ecsa_runs package")
        for name in required_native:
            candidate = received_application / name
            if not candidate.is_file() or file_digest(candidate) != file_digest(application / name):
                raise ValueError("Complete receiving omitted native application source: " + name)
        state = receiver.state(workspace_key)
        if "project_continuity" not in state["data"]:
            raise ValueError("The maintained operator state does not expose Project continuity")
        result = {
            "workspace_key": workspace_key, "project_id": workspace.project["id"],
            "directory": received["directory"], "transfer_id": transfer_id,
            "completed_original_task_id": original_complete["id"],
            "completed_received_task_id": completed["id"],
            "unfinished_original_task_id": original_pending["id"],
            "resumed_received_task_id": pending["id"],
            "resumed_operation_id": finished["operation_id"],
            "resumed_source_collection_id": finished["result"]["id"],
            "original_upload_id": original_upload["id"],
            "original_upload_sha256": restored_upload["sha256"],
            "native_application_files_retained": required_native,
            "recovery": repeated["summary"],
            "retained_source_collections": len(workspace.sources()),
        }
        plan["receiving"][route] = result
        save()
        emit("original_receiving_complete", route=route, **result)

    try:
        sender = open_operator("sender")
        original_source = source_selection(sender, "complete")
        pending_source = source_selection(sender, "unfinished")
        original_complete = action(sender, sender.primary, "source.import",
                                   {"preview_id": original_source["preview_id"]}, "original_complete_source")
        with sender.lock:
            original_pending = sender.submit(
                sender.primary, "source.import", {"preview_id": pending_source["preview_id"]},
                "ES_9960_CONTINUITY_ORIGINAL_UNFINISHED_SOURCE")
            if original_pending["state"] == "queued":
                original_pending = sender.cancel(original_pending["id"])
        if original_pending["state"] != "cancelled":
            raise ValueError("Retain the original source import cancelled before execution")
        plan["original_pending"] = original_pending
        save()
        selected_tasks = [original_complete["id"], original_pending["id"]]

        archive_capture = action(sender, sender.primary, "workspace.snapshot",
                                 {"transport": "archive", "task_ids": selected_tasks},
                                 "archive_capture")
        if archive_capture["result"]["project_transfer"] != {
                "tasks": 2, "complete": 1, "unfinished": 1, "uploads": 1, "previews": 1}:
            raise ValueError("Complete snapshot did not retain the exact selected operating history")
        if len(plan["steps"]["archive_capture"]["downloads"]) < 2:
            raise ValueError("The original task view did not expose archive and operating guide downloads")
        archive_receiver = open_operator("archive-receiver")
        archive_upload = upload(archive_receiver, archive_capture["result"]["path"], "application/zip")
        archive_received = action(
            archive_receiver, archive_receiver.primary, "workspace.receive",
            {"upload_id": archive_upload["id"], "transfer_id": archive_capture["result"]["transfer_id"]},
            "archive_receive")
        archive_receiver = reopen_operator("archive-receiver", archive_receiver)
        verify_received(archive_receiver, archive_received["result"],
                        archive_capture["result"]["transfer_id"], "archive",
                        original_complete, original_pending)

        incremental_capture = action(
            sender, sender.primary, "workspace.snapshot",
            {"transport": "incremental", "task_ids": selected_tasks}, "incremental_capture")
        snapshot_id = incremental_capture["result"]["snapshot_id"]
        if len(plan["steps"]["incremental_capture"]["downloads"]) < 2:
            raise ValueError("The original task view did not expose transfer manifest and operating guide downloads")
        incremental_receiver = open_operator("incremental-receiver")
        manifest_upload = upload(incremental_receiver, incremental_capture["result"]["artifacts"][0]["path"],
                                 "application/json")
        accepted = action(incremental_receiver, incremental_receiver.primary, "project.transfer.accept",
                          {"upload_id": manifest_upload["id"]}, "incremental_manifest")
        if accepted["result"]["snapshot_id"] != snapshot_id:
            raise ValueError("Accepting the handover manifest changed its original identity")
        inspected = action(incremental_receiver, incremental_receiver.primary, "project.transfer.inspect",
                           {"snapshot_id": snapshot_id}, "incremental_missing_request")
        request_artifact = next(row for row in inspected["result"]["artifacts"]
                                if row["filename"] == "receiver.missing.json")
        request_upload = upload(sender, request_artifact["path"], "application/json")
        parts = action(sender, sender.primary, "project.transfer.parts",
                       {"snapshot_id": snapshot_id, "request_upload_id": request_upload["id"],
                        "payload_bytes": 4 * 1024**2}, "incremental_parts")
        for index, row in enumerate(parts["result"]["artifacts"]):
            if row["filename"].endswith(".transfer.json"):
                continue
            part_upload = upload(incremental_receiver, row["path"], "application/octet-stream")
            action(incremental_receiver, incremental_receiver.primary, "project.transfer.receive",
                   {"upload_id": part_upload["id"]}, "incremental_part_" + str(index))
        request = incremental_receiver.project_transfers.store(incremental_receiver.primary).needs(snapshot_id)
        if not request["complete"] or request["bytes_remaining"]:
            raise ValueError("The original handover still has missing source blocks")
        incremental_received = action(
            incremental_receiver, incremental_receiver.primary, "workspace.receive",
            {"snapshot_id": snapshot_id, "transfer_id": incremental_capture["result"]["transfer_id"]},
            "incremental_receive")
        incremental_receiver = reopen_operator("incremental-receiver", incremental_receiver)
        verify_received(incremental_receiver, incremental_received["result"],
                        incremental_capture["result"]["transfer_id"], "incremental",
                        original_complete, original_pending)
        replayed = action(incremental_receiver, incremental_receiver.primary, "project.transfer.receive",
                          {"upload_id": part_upload["id"]}, "incremental_part_replay")
        if not incremental_receiver.project_transfers.store(
                incremental_receiver.primary).needs(snapshot_id)["complete"]:
            raise ValueError("An exact part replay changed completed receiving")
        plan.update(state="complete", source_project_id=sender.ws(sender.primary).project["id"],
                    snapshot_id=snapshot_id)
        save()
        emit("complete", report=str(plan_path), receiving_routes=list(plan["receiving"]),
             source_project_id=plan["source_project_id"], snapshot_id=snapshot_id)
    except BaseException as error:
        plan.update(state="interrupted", error={"type": type(error).__name__, "message": str(error)})
        save()
        raise
    finally:
        for operator in reversed(operators):
            operator.close()


if __name__ == "__main__":
    main()
