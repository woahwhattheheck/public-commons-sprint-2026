"""Run the complete original-source sampling programme and cold Study receiving.

Invoke inside the maintained application with explicit authored selection and
native design configuration files. This module creates no observations.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from model import monitoring_recommendations as recommendations
from model.common import atomic_json, read_json
from model.workspace import Workspace
from model import study_transfer, portable


def retain(path, value):
    atomic_json(path, value, immutable=True)


def original(path):
    body = Path(path).read_bytes()
    return {"filename": Path(path).name, "bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest(),
            "text": body.decode("utf-8")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--selection", required=True, type=Path)
    parser.add_argument("--successor-selection", type=Path)
    parser.add_argument("--design-configuration", required=True, type=Path)
    parser.add_argument("--operation-id", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    workspace = Workspace(args.workspace)
    output = args.output.resolve()
    if output == workspace.root.resolve() or output.is_relative_to(workspace.root.resolve()):
        raise ValueError("Choose an operation output outside the original Workspace")
    output.mkdir(parents=True, exist_ok=True)
    inputs = {"schema": "upstate.sampling-recommendation-course-input/v1",
              "operation_id": args.operation_id, "project": workspace.project,
              "selection": original(args.selection),
              "successor_selection": original(args.successor_selection) if args.successor_selection else None,
              "design_configuration": original(args.design_configuration)}
    retain(output / "original-course-inputs.json", inputs)
    selection = json.loads(inputs["selection"]["text"])
    configuration = json.loads(inputs["design_configuration"]["text"])
    full_context = recommendations.context(workspace, selection["context_id"])
    retain(output / "original-context-catalogue.json", full_context)
    preview = recommendations.preview(workspace, selection=selection)
    retain(output / "proposal-preview.json", preview)
    first = recommendations.prepare(workspace, selection=selection,
                                     operation_id=args.operation_id + "-proposal")
    # The identical operation is actual interrupted-response recovery, not a
    # second proposal or another calculation with a changed payload.
    repeat = recommendations.prepare(workspace, selection=selection,
                                      operation_id=args.operation_id + "-proposal")
    if repeat != first:
        raise ValueError("Exact proposal retry did not return the original immutable record")
    retain(output / "first-proposal.json", first)
    selected = first
    if inputs["successor_selection"]:
        successor = json.loads(inputs["successor_selection"]["text"])
        selected = recommendations.prepare(workspace, selection=successor,
            operation_id=args.operation_id + "-successor", parent_id=first["id"],
            expected_parent_digest=first["id"])
        retain(output / "successor-proposal.json", selected)
    design = recommendations.design(workspace, recommendation_id=selected["id"],
        configuration=configuration, operation_id=args.operation_id + "-design")
    if recommendations.inspect_design(workspace, design["id"]) != design:
        raise ValueError("Saved native design differs from its exact prepared result")
    retain(output / "native-design.json", design)
    # Keep the original completed report ZIP on retry; do not make new export
    # directories each time the same receiving course resumes.
    export_receipt_path = output / "report-export.json"
    if export_receipt_path.exists():
        exported = read_json(export_receipt_path)
        actual = Path(exported["path"])
        if (not actual.is_file() or actual.stat().st_size != exported["bytes"]
                or hashlib.sha256(actual.read_bytes()).hexdigest() != exported["sha256"]):
            raise ValueError("Retained report export differs from its original bytes")
    else:
        exported = recommendations.export_recommendations(workspace,
            recommendation_id=selected["id"], export_root=output / "reports")
        retain(export_receipt_path, exported)
    selection_transfer = {"title": selected["title"],
        "roots": [{"kind": "monitoring_recommendations", "id": selected["id"]},
                  {"kind": "monitoring_recommendation_designs", "id": design["id"]}],
        "include_related_results": True}
    retain(output / "study-selection.json", selection_transfer)
    archive = output / "sampling-programme-editable-study.zip"
    fresh_transfer = study_transfer.export_study(workspace, archive, selection_transfer)
    receipt_path = output / "study-export.json"
    if receipt_path.exists():
        transfer = read_json(receipt_path)
        stable_fields = ("id", "project_id", "path", "bytes", "sha256", "members", "study")
        if any(transfer.get(k) != fresh_transfer.get(k) for k in stable_fields):
            raise ValueError("Retained Study export differs from the same original selection")
    else:
        transfer = {k: v for k, v in fresh_transfer.items() if k != "reused_completed_output"}
        retain(receipt_path, transfer)
    received_root = output / "received-study"
    archive_sha256 = hashlib.sha256(archive.read_bytes()).hexdigest()
    if received_root.exists():
        restored = portable.resume_restore(archive, received_root,
            expected_archive_sha256=archive_sha256)
    else:
        restored = portable.restore(archive, received_root)
    # The maintained receiver publishes application/ and workspace/ together.
    # Its completion record permits later operator edits without re-restoring.
    received = Workspace(Path(restored["workspace"]))
    received_proposal = recommendations.inspect(received, selected["id"])
    received_design = recommendations.inspect_design(received, design["id"])
    if received_proposal != selected or received_design != design:
        raise ValueError("Cold receiving differs from the complete original proposal/design")
    # Operation indexes are derived, not Study source. Prove exact recovery
    # from the exported immutable operation identity in the fresh Workspace.
    raw = selected["request_payload"]
    received_retry = recommendations.prepare(received, selection=raw["selection"],
        operation_id=selected["operation_id"], parent_id=raw["parent_id"],
        expected_parent_digest=raw["expected_parent_digest"])
    if received_retry != selected:
        raise ValueError("Received operation recovery created a different proposal")
    result = {"schema": "upstate.sampling-recommendation-course/v1",
        "operation_id": args.operation_id, "project_id": workspace.project["id"],
        "context_id": selected["context_id"], "proposal_id": selected["id"],
        "proposal_revision": selected["revision"], "proposal_history": [
            r["id"] for r in recommendations.history(received, selected["id"])],
        "design_id": design["id"], "plan_id": design["plan_id"],
        "native_status": design["status"], "native_cost": design["native_cost"],
        "proposal_budget": selected["budget"], "target_calendar": design["target_calendar"],
        "report": exported, "study": transfer,
        "received_workspace": str(received.root),
        "reopened_original_records_equal": True,
        "received_operation_recovery_equal": True,
        "browser_course": "Operate this populated original application and all outgoing files at desktop and390px; record actual images separately."}
    retain(output / "sampling-course-result.json", result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
