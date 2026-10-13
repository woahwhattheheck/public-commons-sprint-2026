"""Operate original issuer correspondence, terms, native planning and complete receiving.

Usage:
  python3 receive-issuer-award-terms.py OUTPUT_DIRECTORY
      --message ORIGINAL.eml --guidance CURRENT_RULES.txt
      --guidance-url https://... --submission-deadline YYYY-MM-DD

All issuer observations come from the supplied original message. The operator
explicitly records INTEREST_ACKNOWLEDGED and retains empty unissued award terms.
"""
from __future__ import annotations

import argparse
import base64
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import zipfile

HERE = Path(__file__).resolve().parent
WORKSPACE_SOURCE = HERE.parent.parent
sys.path.insert(0, str(WORKSPACE_SOURCE))
from model import Workspace, canonical, digest, Problem
from operations import Operations


def put(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = value if isinstance(value, bytes) else (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()
    with open(path, "xb") as target:
        os.chmod(path, 0o600)
        target.write(raw)
    return {"path": str(path), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def need(condition, message):
    if not condition:
        raise RuntimeError(message)


def source(raw, filename, media, observed, url=""):
    return {"filename": filename, "mediaType": media, "kind": "grant", "sourceUrl": url,
            "observedAt": observed, "contentBase64": base64.b64encode(raw).decode("ascii")}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory")
    parser.add_argument("--message", required=True)
    parser.add_argument("--guidance", required=True)
    parser.add_argument("--guidance-url", required=True)
    parser.add_argument("--submission-deadline", required=True)
    parser.add_argument("--scenario", default=str(WORKSPACE_SOURCE.parent / "sf10_current_candidate.json"))
    parser.add_argument("--actor", default="Grant Operations receiving operator")
    args = parser.parse_args(argv)
    root = Path(args.directory).resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    observed = datetime.now(timezone.utc).isoformat()
    original_raw = Path(args.message).read_bytes()
    guidance_raw = Path(args.guidance).read_bytes()
    scenario_raw = Path(args.scenario).read_bytes()
    input_root = root / "original-inputs"
    original_file = put(input_root / Path(args.message).name, original_raw)
    guidance_file = put(input_root / Path(args.guidance).name, guidance_raw)
    put(input_root / "original-scenario.json", scenario_raw)
    case_root = root / "authoring"
    workspace = Workspace(case_root, Path(args.scenario).resolve())
    operations = Operations(workspace)
    artifacts = []
    try:
        scenario = json.loads(scenario_raw)
        plan = workspace.create("SCF Open Track delivery proposal", scenario, {},
            "Retain the complete current proposal and original Decimal model.", "issuer-case-original-plan",
            source_name=Path(args.scenario).name, source_bytes=scenario_raw)
        created = operations.create({"planId": plan["id"], "selectedRevision": plan["revision"],
            "expectedContentSha256": plan["contentSha256"], "name": "SCF issuer correspondence and delivery plan",
            "mode": "OPERATIONS", "calendarStart": None, "actor": args.actor, "requestId": "issuer-case-original-operations"})
        case_id, version = created["id"], created["version"]
        message_input = {key: value for key, value in source(original_raw, Path(args.message).name,
            "message/rfc822", observed).items() if key != "kind"}
        inspected = operations.inspect_issuer_correspondence(case_id, {"expectedVersion": version, "input": message_input})
        available = [row["path"] for row in inspected["candidates"] if row.get("available")]
        need("original" in available, "The complete original acknowledgement must be retained.")
        message_body = {"expectedVersion": version, "actor": args.actor,
            "note": "Receive the complete original SCF interest acknowledgement and every available original attachment.",
            "requestId": "issuer-case-original-message", "input": message_input, "selectedPaths": available,
            "expectedInspectionSha256": inspected["inspectionSha256"]}
        received_message = operations.receive_issuer_correspondence(case_id, message_body)
        need(operations.receive_issuer_correspondence(case_id, message_body) == received_message,
             "Original message replay must return the same case result.")
        version = received_message["version"]
        message = operations.issuer_correspondence(case_id, received_message["correspondence"]["sourceId"])
        metadata = message["edition"]["inspection"]["metadata"]
        need(metadata.get("messageId") and metadata.get("dateUtc"), "Use the original acknowledged message identity and dated source.")
        inputs = operations.seed_award_terms(case_id, {"expectedVersion": version})["inputs"]
        document = inputs["document"]
        document.update({"title": "SCF Open Track — original issuer correspondence", "proposalTrack": "OPEN",
                         "issuerTrack": None, "stage": "INTEREST_ACKNOWLEDGED",
                         "sourceIds": received_message["selection"]["sourceIds"],
                         "note": "The original interest acknowledgement is retained. Continue the current Open Track proposal."})
        document["issuer"] = {"name": metadata.get("from", ""), "reference": metadata["messageId"],
            "messageId": metadata["messageId"], "issuedOn": metadata["dateUtc"][:10], "subject": metadata.get("subject", "")}
        first_preview = operations.preview_award_terms(case_id, {"expectedVersion": version, "inputs": inputs})
        first_save = operations.command(case_id, {"expectedVersion": version, "actor": args.actor,
            "note": "Record the original acknowledgement as its observed application stage.", "requestId": "issuer-case-terms-r1",
            "action": "award-terms.save", "data": {"inputs": inputs, "expectedPreviewSha256": first_preview["previewSha256"]}})
        version = first_save["version"]
        terms_id = first_save["awardTerms"]["id"]
        first = operations.award_terms(case_id, terms_id, 1)
        need(first["edition"]["document"]["award"] is None and first["edition"]["document"]["issuerTrack"] is None,
             "Unissued award terms and an unstated issuer track remain empty.")
        guidance_receipt = operations.command(case_id, {"expectedVersion": version, "actor": args.actor,
            "note": "Retain the original current published award guidance selected for this proposal.",
            "requestId": "issuer-case-current-guidance", "action": "source.add",
            "data": source(guidance_raw, Path(args.guidance).name, "text/plain", observed, args.guidance_url)})
        version = guidance_receipt["version"]
        second_inputs = {"id": terms_id, "expectedRevision": 1, "document": deepcopy(first["edition"]["document"])}
        second_inputs["document"]["guidanceSourceIds"] = [guidance_receipt["recordId"]]
        second_inputs["document"]["round"] = {"label": "SCF Build Award — selected published schedule",
            "deadlineOn": args.submission_deadline, "deadlineBasis": "PUBLIC_SCHEDULE", "formUrl": ""}
        second_inputs["document"]["fieldSources"] = [
            {"field": "Observed application stage", "sourceIds": received_message["selection"]["sourceIds"],
             "excerpt": "", "note": "Original interest acknowledgement selected by the receiving operator."},
            {"field": "Full-submission deadline", "sourceIds": [guidance_receipt["recordId"]],
             "excerpt": "", "note": "Selected date from the retained current public schedule: " + args.submission_deadline},
        ]
        second_preview = operations.preview_award_terms(case_id, {"expectedVersion": version, "inputs": second_inputs})
        second_save = operations.command(case_id, {"expectedVersion": version, "actor": args.actor,
            "note": "Join the selected public schedule while retaining the original interest observation and empty award terms.",
            "requestId": "issuer-case-terms-r2", "action": "award-terms.save",
            "data": {"inputs": second_inputs, "expectedPreviewSha256": second_preview["previewSha256"]}})
        version = second_save["version"]
        selected = operations.award_terms(case_id, terms_id, 2)
        plan_inputs = operations.seed_award_terms_plan(case_id, {"expectedVersion": version,
            "termsId": terms_id, "termsRevision": 2})["inputs"]
        plan_inputs["reason"] = "Retain the source-linked Open Track proposal programme and the selected submission schedule."
        plan_inputs["planning"]["notes"] = (plan_inputs["planning"].get("notes", "") +
            "\nOriginal interest acknowledgement received " + metadata["dateUtc"][:10] +
            ". Continue the Open Track proposal; selected full-submission deadline " + args.submission_deadline + ".").strip()
        planned = operations.preview_award_terms_plan(case_id, {"expectedVersion": version, "inputs": plan_inputs})
        need(planned["nativeSaveRequired"] and planned["amendmentRequired"], "The retained planning note must use a new original native revision.")
        need(planned["amendment"]["compatibility"]["compatible"], "The native case must accept the selected planning inputs.")
        commissioning_body = {"expectedVersion": version, "actor": args.actor, "requestId": "issuer-case-complete-commissioning",
            "note": "Save the reviewed proposal plan and its complete original issuer receiving association.",
            "inputs": plan_inputs, "expectedPreviewSha256": planned["previewSha256"],
            "reviewStatement": "Reviewed the complete original proposal, current schedule, native budget and source comparison. Retain all work packages and current financial assumptions.",
            "acknowledgeBaselineChange": True}
        commissioned = operations.commission_award_terms(case_id, commissioning_body)
        need(operations.commission_award_terms(case_id, commissioning_body) == commissioned,
             "The same complete commissioning request must reopen its committed result.")
        version = commissioned["version"]
        current = operations.read(case_id)
        selected = operations.award_terms(case_id, terms_id, 2)
        need(current["program"]["planRevision"] == commissioned["planRevision"], "The same case must select the saved native plan.")
        need(current["records"]["cash"] == [] and current["program"]["calendarStart"] is None,
             "Original correspondence receiving preserves the actual recorded financial state.")
        need(current["records"]["awards"][0]["stage"] == "INTEREST_ACKNOWLEDGED" and current["records"]["awards"][0]["amountUsd"] is None,
             "The original native issuer event must retain the acknowledged stage.")
        need(selected["edition"]["document"]["award"] is None and len(selected["history"]) == 2 and len(selected["commissioning"]) == 1,
             "The exact selected terms editions and original commissioning remain complete.")
        archive = operations.export_award_terms(case_id, terms_id, 2, version)
        artifacts.append(put(root / "SCF_Issuer_Terms_Complete_Case.zip", archive))
        artifacts.append(put(root / "original-planning.zip", workspace.export(plan["id"])))
        for name, value in [
            ("original-message-inspection.json", inspected), ("original-message-receipt.json", received_message),
            ("terms-edition-1.json", first), ("terms-edition-2.json", selected),
            ("native-planning-inputs.json", plan_inputs), ("native-planning-preview.json", planned),
            ("native-commissioning.json", commissioned), ("original-case.json", current),
        ]:
            artifacts.append(put(root / name, value))
        authored_selection = {"caseId": case_id, "planId": plan["id"], "version": version,
                              "termsId": terms_id, "termsRevision": 2, "planRevision": commissioned["planRevision"]}
    finally:
        workspace.close()
    # The original standalone CLI owns this same SQLite workspace after its
    # former owner closes; no alternate lock or storage path is substituted.
    cli = [sys.executable, str(WORKSPACE_SOURCE / "cli.py"), "operations", "--workspace", str(case_root)]
    for args_tail, filename in [
        (["award-terms-show", "--case", case_id, "--terms", terms_id, "--revision", "2"], "cli-selected-terms.json"),
        (["award-terms", "--case", case_id], "cli-whole-issuer-index.json"),
        (["issuer-correspondence-show", "--case", case_id, "--source", received_message["correspondence"]["sourceId"]], "cli-original-correspondence.json"),
    ]:
        run = subprocess.run(cli + args_tail, check=True, capture_output=True, text=True)
        value = json.loads(run.stdout)
        artifacts.append(put(root / filename, value))
    receiving = Workspace(root / "receiving", Path(args.scenario).resolve())
    receiving_ops = Operations(receiving)
    try:
        received = receiving_ops.import_bundle(archive, "Received SCF issuer and delivery programme", "issuer-case-complete-receiving", args.actor)
        reopened = receiving_ops.read(received["id"])
        retained = receiving_ops.award_terms(received["id"], terms_id, 2)
        need(received.get("selectedAwardTerms", {}).get("id") == terms_id, "The selected issuer edition must reopen in the original receiving case.")
        need(retained["edition"] == selected["edition"] and retained["commissioning"] == selected["commissioning"],
             "Complete original terms and native commissioning must reopen exactly.")
        received_raw = receiving_ops.source(received["id"], received_message["selection"]["sourceIds"][0])[1]
        need(received_raw == original_raw, "The complete original issuer message must reopen byte for byte.")
        reexport = receiving_ops.export_award_terms(received["id"], terms_id, 2, received["version"])
        artifacts.append(put(root / "received-case.zip", reexport))
        artifacts.append(put(root / "received-case.json", reopened))
        artifacts.append(put(root / "receiving-result.json", received))
        # Native handover validation uses the original historical plan resolver,
        # including the new native amendment and every earlier issuer edition.
        receiving_ops.import_bundle(reexport, "Second received issuer programme", "issuer-case-second-receiving", args.actor)
    finally:
        receiving.close()
    with zipfile.ZipFile(io.BytesIO(archive)) as complete:
        members = complete.namelist()
    result = {"schema": "stellar-forge.issuer-award-terms-operating-case.v1", "completedAt": datetime.now(timezone.utc).isoformat(),
        "status": "COMPLETE", "originalMessage": {"filename": original_file["path"].split("/")[-1],
            "bytes": len(original_raw), "sha256": hashlib.sha256(original_raw).hexdigest(),
            "messageId": metadata["messageId"], "dateUtc": metadata["dateUtc"]},
        "guidance": {"bytes": len(guidance_raw), "sha256": hashlib.sha256(guidance_raw).hexdigest(), "url": args.guidance_url},
        "selection": authored_selection, "receiving": received,
        "termsEditions": 2, "nativeAmendmentEditions": 3, "commissioningRecords": 1,
        "recordedStage": "INTEREST_ACKNOWLEDGED", "proposalTrack": "OPEN", "issuerTrack": None, "awardTerms": None,
        "workPackages": len(current["plan"]["scenario"]["future_costs"]),
        "awardRequestUsd": current["plan"]["scenario"]["award_request_usd"],
        "projectDays": current["plan"]["scenario"]["project_end_day"],
        "wholeCaseFiles": len(members), "originalMessageReopened": True, "wholeCaseReopenedTwice": True,
        "cliSelections": 3, "browser": {"status": "READY", "caseId": case_id, "planId": plan["id"]},
        "artifacts": artifacts}
    put(root / "ISSUER_TERMS_RECEIVING.json", result)
    print(json.dumps(result, ensure_ascii=False))
    return result


if __name__ == "__main__":
    main()
