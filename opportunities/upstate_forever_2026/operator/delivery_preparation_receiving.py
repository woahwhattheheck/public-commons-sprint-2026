#!/usr/bin/env python3
"""Receive an actually completed preparation with its original editable Workspace.

This chapter uses the existing backup and restore implementation. It never creates
a model run or a delivery. Run it after the browser has retained a completed
preparation build, then open the returned application and Workspace with the
existing operator launcher to continue the paired browser receiving chapter.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import stat
import subprocess
import sys

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))
from model.common import atomic_json, digest, file_digest, held, now, read_json
from model.delivery_preparation import BUILD, DeliveryPreparations
from model.workspace import Workspace
from model import portable

SCHEMA = "upstate.delivery-preparation-receiving/v1"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def ordinary(path):
    require(not path.is_symlink() and stat.S_ISREG(path.lstat().st_mode),
            "Use the original ordinary receiving file: " + str(path))
    return path


def selected(workspace, preparation_id, revision, operation_id):
    service = DeliveryPreparations(workspace)
    opened = service.inspect(preparation_id, revision=revision)
    operation = service.operation(operation_id)
    require(operation.get("action") == BUILD and operation.get("status") == "COMPLETE",
            "Finish and receive the original preparation build before this handover")
    result = operation["result"]
    require(operation["request"] == {"preparation_id": preparation_id, "revision": revision}
            and result["preparation_id"] == preparation_id
            and result["revision"] == revision
            and result["revision_id"] == opened["preparation"]["revision_id"],
            "Choose the exact saved revision belonging to this original build")
    delivery = workspace.retained_item("deliveries", result["delivery_id"])
    require(delivery["selection"] == result["binding"]["selection"]
            and delivery.get("state") in ("complete", "received_snapshot"),
            "The original completed delivery must be present in this Workspace")
    # Explicit operation receipt verifies retained files. The history is allowed
    # to advance; it never changes the selected immutable revision or result.
    return opened, operation, delivery


def cold_command(application, workspace, command):
    entry = ordinary(application / "model" / "cli.py")
    completed = subprocess.run(
        [sys.executable, str(entry), "--workspace", str(workspace), *command],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        check=False, cwd=application,
    )
    if completed.returncode:
        raise RuntimeError("Received application " + command[0] + " failed: "
                           + completed.stderr.decode("utf-8", errors="replace"))
    try:
        return json.loads(completed.stdout)
    except (ValueError, UnicodeError) as error:
        raise ValueError("Received application did not return complete native JSON") from error


def inspect_received(receiver, request):
    application = Path(receiver["application"])
    workspace_path = Path(receiver["workspace"])
    opened = cold_command(application, workspace_path, [
        "delivery-preparation-inspect", request["preparation_id"],
        "--revision", str(request["revision"]),
    ])
    operation = cold_command(application, workspace_path, [
        "delivery-preparation-operation", request["operation_id"],
    ])
    require(opened["project_id"] == request["project_id"]
            and digest(opened["preparation"]) == request["preparation_sha256"],
            "Cold receiving changed the selected original preparation")
    require(operation.get("status") == "COMPLETE"
            and operation.get("action") == BUILD
            and operation["request"] == {
                "preparation_id": request["preparation_id"], "revision": request["revision"]}
            and digest(operation["result"]) == request["result_sha256"],
            "Cold receiving changed the original completed build result")
    result = operation["result"]
    received_workspace = Workspace(workspace_path)
    selected(received_workspace, request["preparation_id"], request["revision"],
             request["operation_id"])
    return {
        "project_id": request["project_id"],
        "preparation_id": request["preparation_id"],
        "revision": request["revision"],
        "revision_id": opened["preparation"]["revision_id"],
        "operation_id": request["operation_id"],
        "delivery_id": result["delivery_id"],
        "delivery_state": result["delivery_state"],
        "completion_scope": result["completion_scope"],
        "preparation_sha256": digest(opened["preparation"]),
        "result_sha256": digest(result),
        "history_head": opened["history"][-1],
        "files": result["delivery"]["files"],
    }


def receive(workspace_path, preparation_id, revision, operation_id, output):
    workspace = Workspace(workspace_path)
    output = Path(output).absolute()
    require(output == output.resolve(), "Choose an ordinary receiving output path")
    require(not output.is_relative_to(workspace.root)
            and not output.is_relative_to(APPLICATION),
            "Keep receiving output outside the source Workspace and application")
    output.mkdir(parents=True, exist_ok=True)
    intent_path = output / "intent.json"
    archive_path = output / "scientific-workspace.zip"
    archive_record = output / "archive.json"
    destination = output / "received"
    receipt_path = output / "receiving.json"

    with held(output / ".receiving.lock", blocking=False):
        opened, operation, delivery = selected(
            workspace, preparation_id, revision, operation_id)
        request = {
            "project_id": workspace.project["id"],
            "preparation_id": preparation_id,
            "revision": revision,
            "revision_id": opened["preparation"]["revision_id"],
            "operation_id": operation_id,
            "delivery_id": operation["result"]["delivery_id"],
            "preparation_sha256": digest(opened["preparation"]),
            "result_sha256": digest(operation["result"]),
        }
        if intent_path.exists():
            intent = read_json(ordinary(intent_path))
            require(intent.get("schema") == SCHEMA and intent.get("request") == request,
                    "This receiving directory belongs to a different original selection")
        else:
            require(not any(path.name != ".receiving.lock" for path in output.iterdir()),
                    "Choose a new receiving directory or the original retained intent")
            intent = {"schema": SCHEMA, "request": request,
                      "source_workspace": str(workspace.root),
                      "source_application": str(APPLICATION),
                      "source_history_head": opened["history"][-1],
                      "created_at": now()}
            atomic_json(intent_path, intent, immutable=True)

        if archive_record.exists():
            archive = read_json(ordinary(archive_record))
            require(archive.get("project_id") == request["project_id"]
                    and archive.get("path") == str(archive_path)
                    and ordinary(archive_path).stat().st_size == archive.get("bytes")
                    and file_digest(archive_path) == archive.get("sha256"),
                    "The retained receiving archive differs from its original result")
        else:
            if archive_path.exists():
                # A backup can be published before its caller receives the result.
                # Reuse that exact completed archive rather than taking a later one.
                manifest = portable.inspect_archive(ordinary(archive_path), verify=True)
                require(manifest["project"]["id"] == request["project_id"]
                        and manifest["selection"].get("include_intermediates") is True
                        and manifest["selection"].get("include_deliveries") is True,
                        "The retained archive belongs to another backup selection")
                archive = {
                    "schema": portable.FORMAT, "project_id": request["project_id"],
                    "path": str(archive_path), "bytes": archive_path.stat().st_size,
                    "sha256": file_digest(archive_path), "members": len(manifest["members"]),
                    "selection": manifest["selection"],
                }
            else:
                archive = workspace.backup(archive_path, include_intermediates=True)
            atomic_json(archive_record, archive, immutable=True)

        if destination.exists():
            receiver = portable.resume_restore(
                archive_path, destination, expected_archive_sha256=archive["sha256"])
        else:
            receiver = portable.restore(archive_path, destination)
        require(receiver["archive_sha256"] == archive["sha256"]
                and receiver["project"]["id"] == request["project_id"],
                "The original receiver returned a different archive or project")
        observed = inspect_received(receiver, request)

        if receipt_path.exists():
            receipt = read_json(ordinary(receipt_path))
            require(receipt.get("schema") == SCHEMA and receipt.get("request") == request
                    and receipt.get("archive") == archive
                    and receipt.get("receiver", {}).get("archive_sha256") == archive["sha256"]
                    and receipt.get("received", {}).get("preparation_sha256") == request["preparation_sha256"]
                    and receipt.get("received", {}).get("result_sha256") == request["result_sha256"],
                    "The first receiving completion differs from its original operation")
            # Later legitimate revisions are reported alongside the first receipt.
            # They are never substituted into or removed by that immutable result.
            return {"schema": SCHEMA, "receipt": receipt,
                    "current_received": observed, "reused_completed_output": True}
        receiver = {key: value for key, value in receiver.items()
                    if key != "reused_completed_output"}
        receipt = {"schema": SCHEMA, "request": request, "archive": archive,
                   "receiver": receiver, "received": observed, "completed_at": now()}
        atomic_json(receipt_path, receipt, immutable=True)
        return {"schema": SCHEMA, "receipt": receipt,
                "current_received": observed, "reused_completed_output": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--preparation-id", required=True)
    parser.add_argument("--revision", required=True, type=int)
    parser.add_argument("--operation-id", required=True,
                        help="The actual completed native build operation ID returned by the operator")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        result = receive(args.workspace, args.preparation_id, args.revision,
                         args.operation_id, args.output)
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
        return 0
    except (ValueError, OSError, KeyError, RuntimeError) as error:
        print(json.dumps({"state": "error", "type": type(error).__name__,
                          "message": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
