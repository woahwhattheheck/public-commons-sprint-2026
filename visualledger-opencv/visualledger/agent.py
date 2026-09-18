"""Evidence-bound perception -> decision -> action routing for VisualLedger."""
from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

from .vision import VisionError, VisionPolicy, analyze_image

TRACE_SCHEMA = "visualledger-agent-trace/v1"


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii")


def _decision(vision: dict[str, Any]) -> tuple[str, list[str]]:
    policy = vision["policy"]
    reasons: list[str] = []
    nearest = vision["nearest_prior"]
    if nearest is not None and nearest["hamming"] <= policy["duplicate_hamming_max"]:
        return "QUARANTINE_DUPLICATE_REVIEW", ["VISUAL_DUPLICATE_OR_NEAR_DUPLICATE"]

    count = vision["document_candidate_count"]

    if vision["laplacian_variance_milli"] < policy["min_laplacian_variance_milli"]:
        reasons.append("BLUR_BELOW_POLICY")
    if vision["contrast_milli"] < policy["min_contrast_milli"]:
        reasons.append("CONTRAST_BELOW_POLICY")
    if vision["glare_ppm"] > policy["max_glare_ppm"]:
        reasons.append("GLARE_ABOVE_POLICY")
    if vision["edge_ppm"] < policy["min_edge_ppm"]:
        reasons.append("EDGE_DENSITY_BELOW_POLICY")
    if reasons:
        return "REQUEST_RECAPTURE", reasons

    if count != 1:
        reasons.append("AMBIGUOUS_DOCUMENT_GEOMETRY" if count > 1 else "DOCUMENT_BOUNDARY_NOT_CONFIDENT")
        return "REQUEST_HUMAN_CROP", reasons

    if vision["text_line_count"] < policy["min_text_line_count"]:
        return "REQUEST_HUMAN_CROP", ["TEXT_STRUCTURE_TOO_SPARSE"]
    return "REQUEST_FIELD_EXTRACTION", ["VISION_INTAKE_PASSED"]


def compile_trace(
    raw: bytes,
    *,
    evidence_id: str,
    prior_fingerprints: list[dict[str, str]] | tuple[dict[str, str], ...] = (),
    policy: VisionPolicy | None = None,
    allow_opencv4_dev: bool = False,
    cv2_module: Any | None = None,
) -> dict[str, Any]:
    if type(evidence_id) is not str or not evidence_id or len(evidence_id) > 96:
        raise VisionError("invalid evidence_id")
    vision = analyze_image(
        raw,
        prior_fingerprints=prior_fingerprints,
        policy=policy,
        allow_opencv4_dev=allow_opencv4_dev,
        cv2_module=cv2_module,
    )
    action, reasons = _decision(vision)
    trace: dict[str, Any] = {
        "schema": TRACE_SCHEMA,
        "evidence_id": evidence_id,
        "perception": vision,
        "decision": {
            "action": action,
            "reasons": reasons,
            "human_review_required": True,
            "visual_evidence_changed_next_action": True,
        },
        "authority": {
            "approve_expense": False,
            "reject_expense": False,
            "approve_invoice": False,
            "post_accounting_entry": False,
            "pay_or_move_funds": False,
            "contact_external_party": False,
            "external_send": False,
            "tax_or_legal_conclusion": False,
            "revenue_recognition": False,
        },
        "truth": {
            "aws_deployed": False,
            "competition_submitted": False,
            "prize_awarded": False,
            "customer_production_use": False,
        },
    }
    trace["receipt_sha256"] = hashlib.sha256(canonical(trace)).hexdigest()
    return trace


def verify_trace(
    trace: dict[str, Any],
    raw: bytes,
    *,
    prior_fingerprints: list[dict[str, str]] | tuple[dict[str, str], ...] = (),
    allow_opencv4_dev: bool = False,
    cv2_module: Any | None = None,
) -> dict[str, Any]:
    if type(trace) is not dict or trace.get("schema") != TRACE_SCHEMA:
        raise VisionError("invalid trace schema")
    receipt = trace.get("receipt_sha256")
    if type(receipt) is not str or len(receipt) != 64:
        raise VisionError("invalid trace receipt")
    body = dict(trace)
    body.pop("receipt_sha256", None)
    if not hmac.compare_digest(hashlib.sha256(canonical(body)).hexdigest(), receipt):
        raise VisionError("trace receipt mismatch")
    expected = compile_trace(
        raw,
        evidence_id=trace.get("evidence_id"),
        prior_fingerprints=prior_fingerprints,
        policy=VisionPolicy(**trace["perception"]["policy"]),
        allow_opencv4_dev=allow_opencv4_dev,
        cv2_module=cv2_module,
    )
    if not hmac.compare_digest(canonical(expected), canonical(trace)):
        raise VisionError("semantic trace mismatch")
    return expected
