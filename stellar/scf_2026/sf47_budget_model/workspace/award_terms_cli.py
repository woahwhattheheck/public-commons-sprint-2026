"""Complete issuer source, terms, native plan commissioning and handover commands."""
from __future__ import annotations

import base64
import json
from pathlib import Path

from model import Problem, canonical
from operations import MAX_SOURCE


def register(command, mutation):
    command("award-terms", "List original issuer messages, terms editions and commissioned plans", case=True, output=True)
    target = command("award-terms-seed", "Start explicit terms inputs from the current native case", case=True, output=True)
    target.add_argument("--expected-version", type=int, required=True)
    for name, description in (
        ("award-terms-show", "Read the complete original terms edition and all receiving history"),
        ("award-terms-plan-seed", "Prepare complete native planning inputs for a selected issuer edition"),
        ("award-terms-export", "Export the original issuer selection, case, native plan history and attachments"),
    ):
        target = command(name, description, case=True, output=name != "award-terms-export")
        target.add_argument("--terms", required=True)
        target.add_argument("--revision", type=int, required=name == "award-terms-export")
        if name == "award-terms-show":
            target.add_argument("--inputs-only", action="store_true")
        else:
            target.add_argument("--expected-version", type=int, required=True)
        if name == "award-terms-export":
            target.add_argument("--output", required=True)
    for name, description in (
        ("award-terms-preview", "Compare all explicitly selected issuer terms with the saved proposal"),
        ("award-terms-save", "Save a reviewed issuer edition and the original native issuer event"),
        ("award-terms-plan-preview", "Calculate the complete proposed plan through the original native writer"),
        ("award-terms-commission", "Save and review the original plan, apply its native amendment and retain the terms binding"),
    ):
        target = command(name, description, case=True, output=True)
        target.add_argument("--inputs", required=True, help="Complete terms or planning inputs JSON")
        if name in ("award-terms-save", "award-terms-commission"):
            mutation(target, version=True, note_required=True)
            target.add_argument("--expected-preview-sha256", required=True)
        else:
            target.add_argument("--expected-version", type=int, required=True)
        if name == "award-terms-commission":
            target.add_argument("--review-statement", required=True)
            target.add_argument("--apply-reviewed-plan", action="store_true", required=True)
    for name in ("issuer-correspondence-inspect", "issuer-correspondence-receive"):
        target = command(name, "Inspect or retain an original issuer message and explicitly selected attachments", case=True, output=True)
        target.add_argument("--input", required=True, help="Complete original EML or plain-text filename")
        target.add_argument("--media-type", default="message/rfc822")
        target.add_argument("--observed-at", required=True, help="Explicit ISO source observation time with timezone")
        target.add_argument("--source-url", default="")
        if name.endswith("-receive"):
            mutation(target, version=True, note_required=True)
            target.add_argument("--select", action="append", required=True, help="Original parser path; include original and selected MIME paths")
            target.add_argument("--expected-inspection-sha256", required=True)
        else:
            target.add_argument("--expected-version", type=int, required=True)
    target = command("issuer-correspondence-show", "Read the complete original message, inspection and native source selection", case=True, output=True)
    target.add_argument("--source", required=True, help="Saved correspondence index source ID")


def operates(name):
    return name == "award-terms" or name.startswith("award-terms-") or name.startswith("issuer-correspondence-")


def operate(operations, args, read_bytes, publish):
    action = args.operation
    if action == "award-terms":
        result = operations.list_award_terms(args.case)
    elif action == "award-terms-seed":
        result = operations.seed_award_terms(args.case, {"expectedVersion": args.expected_version})["inputs"]
    elif action == "award-terms-show":
        result = operations.award_terms(args.case, args.terms, args.revision)
        if args.inputs_only:
            result = {"id": result["edition"]["id"], "expectedRevision": result["history"][0]["revision"],
                      "document": result["edition"]["document"]}
    elif action == "award-terms-plan-seed":
        result = operations.seed_award_terms_plan(args.case, {"expectedVersion": args.expected_version,
            "termsId": args.terms, "termsRevision": args.revision})["inputs"]
    elif action in ("award-terms-preview", "award-terms-save", "award-terms-plan-preview", "award-terms-commission"):
        try:
            inputs = json.loads(read_bytes(args.inputs, MAX_SOURCE))
        except (UnicodeError, ValueError) as exc:
            raise Problem("Use the complete UTF-8 issuer or native planning inputs.", 422, "INVALID_AWARD_TERMS") from exc
        if action == "award-terms-preview":
            result = operations.preview_award_terms(args.case, {"expectedVersion": args.expected_version, "inputs": inputs})
        elif action == "award-terms-plan-preview":
            result = operations.preview_award_terms_plan(args.case, {"expectedVersion": args.expected_version, "inputs": inputs})
        elif action == "award-terms-save":
            result = operations.command(args.case, {"action": "award-terms.save",
                "expectedVersion": args.expected_version, "actor": args.actor, "note": args.note, "requestId": args.request_id,
                "data": {"inputs": inputs, "expectedPreviewSha256": args.expected_preview_sha256}})
        else:
            result = operations.commission_award_terms(args.case, {
                "expectedVersion": args.expected_version, "actor": args.actor, "note": args.note, "requestId": args.request_id,
                "inputs": inputs, "expectedPreviewSha256": args.expected_preview_sha256,
                "reviewStatement": args.review_statement, "acknowledgeBaselineChange": args.apply_reviewed_plan})
    elif action == "award-terms-export":
        return {"caseId": args.case, "output": publish(args.output,
            operations.export_award_terms(args.case, args.terms, args.revision, args.expected_version))}
    elif action == "issuer-correspondence-show":
        result = operations.issuer_correspondence(args.case, args.source)
    else:
        raw = read_bytes(args.input, MAX_SOURCE)
        source = {"filename": Path(args.input).name, "mediaType": args.media_type,
                  "observedAt": args.observed_at, "sourceUrl": args.source_url,
                  "contentBase64": base64.b64encode(raw).decode("ascii")}
        if action == "issuer-correspondence-inspect":
            result = operations.inspect_issuer_correspondence(args.case,
                {"expectedVersion": args.expected_version, "input": source})
        else:
            result = operations.receive_issuer_correspondence(args.case, {
                "expectedVersion": args.expected_version, "actor": args.actor, "note": args.note, "requestId": args.request_id,
                "input": source, "selectedPaths": args.select,
                "expectedInspectionSha256": args.expected_inspection_sha256})
    if getattr(args, "output", None):
        return {"output": publish(args.output, (canonical(result) + "\n").encode())}
    return result
