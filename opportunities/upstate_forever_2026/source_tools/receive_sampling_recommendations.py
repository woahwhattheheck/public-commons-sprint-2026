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



def _report_members(workspace, recommendation_id):
    return recommendations.export_members(workspace, recommendation_id)


def _member_inventory(files):
    return [{"path": name, "bytes": member["bytes"], "sha256": member["sha256"]}
            for name, member in sorted(files.items())]


def _evidence_roster(history):
    rows = []
    for proposal in history:
        for target in proposal["targets"]:
            evidence = target.get("model_evidence")
            if evidence is None:
                continue
            native, source = evidence["native"], evidence["source"]
            rows.append({"recommendation_id": proposal["id"], "target_id": target["target_id"],
                "selection": evidence["selection"], "source": source,
                "native_family": native["family"], "native_id": native["id"],
                "native_project_id": native["project_id"],
                "run_ids": native["run_ids"], "selected_quantity": native["selected_quantity"],
                "support": native["support"], "target_binding": evidence["target_binding"],
                "relation": evidence["relation"]})
    return rows


def _required_nodes(project_id, roster):
    nodes = set()
    for row in roster:
        source = row["source"]
        nodes.add(("sources", source["collection_id"]))
        if row["native_project_id"] == project_id:
            kinds = {"control_outcomes": "multivariate-control-outcomes",
                     "terrain_response": "terrain-conditioning-report-sources",
                     "conservation_portfolio": "conservation-report-sources"}
            if row["native_family"] not in kinds:
                raise ValueError("Choose a supported retained Sampling native evidence family")
            kind = kinds[row["native_family"]]
            nodes.add((kind, row["native_id"]))
            for run_id in row["run_ids"]:
                nodes.add(("runs", run_id))
    return [{"kind": kind, "id": key} for kind, key in sorted(nodes)]


def _extract_report(archive_path, destination, files):
    """Open every exact packet member and retain ordinary reviewable files."""
    import os
    import shutil
    import tempfile
    import zipfile
    from model.monitoring_packet import _member_name, _verify_existing
    from model.common import file_digest
    archive_path, destination = Path(archive_path), Path(destination)
    _verify_existing(archive_path, files)
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    with zipfile.ZipFile(archive_path) as archive:
        for name, member in sorted(files.items()):
            _member_name(name)
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.parent.resolve().is_relative_to(root) or target.is_symlink():
                raise ValueError("The report member left its retained receiving directory")
            if target.exists():
                if target.stat().st_size != member["bytes"] or file_digest(target) != member["sha256"]:
                    raise ValueError("Preserve the existing reviewed report file: " + name)
                continue
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".receiving-", delete=False) as outgoing:
                    temporary = Path(outgoing.name)
                    with archive.open(name) as incoming:
                        shutil.copyfileobj(incoming, outgoing, length=1024 * 1024)
                    outgoing.flush()
                    os.fsync(outgoing.fileno())
                if temporary.stat().st_size != member["bytes"] or file_digest(temporary) != member["sha256"]:
                    raise ValueError("The extracted original report member differs: " + name)
                os.replace(temporary, target)
                temporary = None
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
    return str(destination / "sampling-review.html")


def _verify_evidence_received(workspace, expected):
    """Execute from the received application, following original saved records."""
    if workspace.project != expected["project"]:
        raise ValueError("The received evidence belongs to another original project")
    proposal = recommendations.inspect(workspace, expected["proposal"]["id"])
    design = recommendations.inspect_design(workspace, expected["design"]["id"])
    history = recommendations.history(workspace, proposal["id"])
    if (proposal != expected["proposal"] or design != expected["design"]
            or history != expected["history"]):
        raise ValueError("The received proposal, native plan or complete original history differs")
    roster = _evidence_roster(history)
    if roster != expected["native_evidence"]:
        raise ValueError("The received source, quantity, support or target binding changed")
    # This also validates raw CAS and every selected local native dependency
    # through the unchanged original proposal and producer inspection methods.
    inventory = _member_inventory(_report_members(workspace, proposal["id"]))
    if inventory != expected["report_members"]:
        raise ValueError("Cold receiving changed the original report, CSV, source or companion bytes")
    from model import study_transfer as original_studies
    original_studies.verify_received_studies(workspace)
    return {"schema": "upstate.sampling-native-evidence-cold-receiving/v1",
        "project_id": workspace.project["id"], "proposal_id": proposal["id"],
        "design_id": design["id"], "plan_id": design["plan_id"],
        "history_ids": [r["id"] for r in history], "native_evidence": roster,
        "report_member_count": len(inventory),
        "proposal_history_equal": True, "native_records_equal": True,
        "report_member_bytes_equal": True, "rendered_inspection": False}


def _evidence_cold_main():
    parser = argparse.ArgumentParser(description="Reopen original Sampling evidence from the received application")
    parser.add_argument("--verify-evidence-received", action="store_true")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--expected", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = _verify_evidence_received(Workspace(args.workspace), read_json(args.expected))
    result["application"] = str(Path(__file__).resolve().parents[1])
    retain(args.output, result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


def _receive_evidence(workspace, parent, configuration, args):
    """Continue the same original course with an explicitly authored child.

    The first course's sealed proposal, report and Study archive remain intact.
    A later explicit child may remove evidence while retaining its full ancestry.
    """
    import subprocess
    from model.common import file_digest, held
    from model.monitoring_packet import _verify_existing
    output = args.output.resolve() / "native-evidence"
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".course.lock", blocking=False):
        inputs = {"schema": "upstate.sampling-native-evidence-course-input/v1",
            "operation_id": args.operation_id, "project": workspace.project,
            "parent_id": parent["id"], "selection": original(args.evidence_selection),
            "successor_selection": original(args.evidence_successor_selection) if args.evidence_successor_selection else None,
            "design_configuration": original(args.evidence_design_configuration) if args.evidence_design_configuration else None,
            "original_design_configuration": configuration}
        retain(output / "original-evidence-inputs.json", inputs)
        selection = json.loads(inputs["selection"]["text"])
        if not any("model_evidence" in row for row in selection.get("targets", [])):
            raise ValueError("The authored evidence phase needs at least one explicit native source/quantity")
        preview = recommendations.preview(workspace, selection=selection)
        retain(output / "proposal-preview.json", preview)
        child = recommendations.prepare(workspace, selection=selection,
            operation_id=args.operation_id + "-native-evidence-proposal",
            parent_id=parent["id"], expected_parent_digest=parent["id"])
        repeated = recommendations.prepare(workspace, selection=selection,
            operation_id=args.operation_id + "-native-evidence-proposal",
            parent_id=parent["id"], expected_parent_digest=parent["id"])
        if child != repeated:
            raise ValueError("The evidence child retry changed the original immutable request")
        retain(output / "evidence-proposal.json", child)
        selected = child
        if inputs["successor_selection"]:
            successor = json.loads(inputs["successor_selection"]["text"])
            selected = recommendations.prepare(workspace, selection=successor,
                operation_id=args.operation_id + "-native-evidence-successor",
                parent_id=child["id"], expected_parent_digest=child["id"])
            if recommendations.prepare(workspace, selection=successor,
                    operation_id=args.operation_id + "-native-evidence-successor",
                    parent_id=child["id"], expected_parent_digest=child["id"]) != selected:
                raise ValueError("The evidence successor retry changed its original request")
            retain(output / "evidence-successor.json", selected)
        config = (json.loads(inputs["design_configuration"]["text"])
                  if inputs["design_configuration"] else configuration)
        design = recommendations.design(workspace, recommendation_id=selected["id"],
            configuration=config, operation_id=args.operation_id + "-native-evidence-design")
        if recommendations.inspect_design(workspace, design["id"]) != design:
            raise ValueError("The evidence proposal's original Monitoring design changed")
        retain(output / "native-design.json", design)
        history = recommendations.history(workspace, selected["id"])
        roster = _evidence_roster(history)
        if not roster:
            raise ValueError("The retained full proposal history lost its native evidence")
        files = _report_members(workspace, selected["id"])
        export_path = output / "report-export.json"
        if export_path.exists():
            exported = read_json(export_path)
            if exported.get("recommendation_id") != selected["id"]:
                raise ValueError("This saved report belongs to another selected proposal")
        else:
            exported = recommendations.export_recommendations(workspace,
                recommendation_id=selected["id"], export_root=output / "reports")
            retain(export_path, exported)
        actual = _verify_existing(Path(exported["path"]), files)
        if actual["bytes"] != exported["bytes"] or actual["sha256"] != exported["sha256"]:
            raise ValueError("The complete native-evidence report packet changed")
        report_html = _extract_report(exported["path"], output / "report-files", files)
        expected = {"schema": "upstate.sampling-native-evidence-receiving-expectation/v1",
            "project": workspace.project, "proposal": selected, "design": design,
            "history": history, "native_evidence": roster,
            "report_members": _member_inventory(files)}
        expected_path = output / "receiving-expectation.json"
        retain(expected_path, expected)
        selection_transfer = {"title": selected["title"],
            "roots": [{"kind": "monitoring_recommendations", "id": selected["id"]},
                      {"kind": "monitoring_recommendation_designs", "id": design["id"]}],
            "include_related_results": True}
        retain(output / "study-selection.json", selection_transfer)
        archive = output / "sampling-native-evidence-editable-study.zip"
        transfer = study_transfer.export_study(workspace, archive, selection_transfer)
        transfer = {k: v for k, v in transfer.items() if k != "reused_completed_output"}
        retain(output / "study-export.json", transfer)
        included = {(r["kind"], r["id"]) for r in transfer["study"]["identity"]["nodes"]}
        required = _required_nodes(workspace.project["id"], roster)
        if any((r["kind"], r["id"]) not in included for r in required):
            raise ValueError("The selected Study lost an exact native evidence source or local case")
        received_root = output / "received-study"
        archive_sha256 = file_digest(archive)
        restored = (portable.resume_restore(archive, received_root,
            expected_archive_sha256=archive_sha256) if received_root.exists()
            else portable.restore(archive, received_root))
        received = Workspace(restored["workspace"])
        reopened = _verify_evidence_received(received, expected)
        # The original operation-index recovery follows immutable records, and
        # does not create another proposal or native solver result.
        raw = selected["request_payload"]
        if recommendations.prepare(received, selection=raw["selection"],
                operation_id=selected["operation_id"], parent_id=raw["parent_id"],
                expected_parent_digest=raw["expected_parent_digest"]) != selected:
            raise ValueError("Cold evidence receiving changed its retained operation identity")
        application = Path(restored["application"])
        receiver = application / "source_tools" / Path(__file__).name
        if not receiver.is_file():
            raise ValueError("The complete received application needs its original Sampling receiver")
        cold_path = output / "contained-application-reopen.json"
        process = subprocess.run([sys.executable, str(receiver), "--verify-evidence-received",
            "--workspace", str(received.root), "--expected", str(expected_path),
            "--output", str(cold_path)], cwd=application, text=True, capture_output=True)
        (output / "contained-application-stdout.txt").write_text(process.stdout, encoding="utf-8")
        (output / "contained-application-stderr.txt").write_text(process.stderr, encoding="utf-8")
        if process.returncode:
            raise RuntimeError("The original contained Sampling receiver failed: " + process.stderr[-12000:])
        cold = read_json(cold_path)
        if {k: v for k, v in cold.items() if k != "application"} != reopened:
            raise ValueError("The contained application reopened different original evidence")
        result = {"schema": "upstate.sampling-native-evidence-course/v1",
            "operation_id": args.operation_id, "project_id": workspace.project["id"],
            "parent_id": parent["id"], "first_evidence_proposal_id": child["id"],
            "proposal_id": selected["id"], "design_id": design["id"], "plan_id": design["plan_id"],
            "history_ids": [r["id"] for r in history], "native_evidence": roster,
            "required_native_nodes": required, "report": exported, "report_html": report_html,
            "report_member_count": len(files), "study": transfer,
            "received_application": str(application), "received_workspace": str(received.root),
            "contained_reopen": str(cold_path), "operation_recovery_equal": True,
            "rendered_inspection": False,
            "browser_course": "Open the exact populated Sampling desk at desktop and390px, operate evidence choice, quantity and applicability, preview/save/reopen/revision/export/native calendar/Study. Open and LOOK at every original outgoing report, map, CSV/JSON and extracted archive member; record actual visual results separately."}
        retain(output / "sampling-native-evidence-result.json", result)
        return result


def main():
    if "--verify-native-observation-received" in sys.argv[1:]:
        from source_tools.sampling_native_observation_receiving import cold_main
        return cold_main()
    if "--verify-evidence-received" in sys.argv[1:]:
        return _evidence_cold_main()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--selection", required=True, type=Path)
    parser.add_argument("--successor-selection", type=Path)
    parser.add_argument("--design-configuration", required=True, type=Path)
    parser.add_argument("--operation-id", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--native-observation-course", type=Path,
        help="Authored continuation using complete original native observation records")
    parser.add_argument("--native-observation-input", type=Path,
        help="Original observation ZIP or explicit extracted-source JSON for normal native import")
    parser.add_argument("--evidence-selection", type=Path,
        help="Explicit authored native-evidence child selection for the same original course")
    parser.add_argument("--evidence-successor-selection", type=Path)
    parser.add_argument("--evidence-design-configuration", type=Path)
    args = parser.parse_args()
    if not args.evidence_selection and (args.evidence_successor_selection or args.evidence_design_configuration):
        parser.error("Evidence successor/configuration requires --evidence-selection")
    if args.native_observation_input and not args.native_observation_course:
        parser.error("--native-observation-input requires --native-observation-course")
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
    continuations = {}
    if args.evidence_selection:
        continuations["native_evidence"] = _receive_evidence(workspace, selected, configuration, args)
    if args.native_observation_course:
        from source_tools.sampling_native_observation_receiving import receive
        continuations["native_observations"] = receive(workspace, result, args)
    print(json.dumps({"original_course": result, **continuations} if continuations else result,
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
