from __future__ import annotations

from typing import Any

from .codec import canonical_json, digest_json
from .vision import verify_evidence_packet


class ProposalError(ValueError):
    pass


def _priority(area: int, mean_delta: float) -> str:
    if area >= 1000 or mean_delta >= 90:
        return "HIGH"
    if area >= 200 or mean_delta >= 45:
        return "MEDIUM"
    return "LOW"


def build_review_proposal(evidence: dict[str, Any]) -> dict[str, Any]:
    if not verify_evidence_packet(evidence):
        raise ProposalError("evidence packet failed verification")
    regions = evidence["regions"]
    proposals: list[dict[str, Any]] = []
    for region in regions:
        area = int(region["area_px"])
        mean_delta = float(region["mean_delta"])
        proposals.append({
            "region_id": region["region_id"],
            "priority": _priority(area, mean_delta),
            "proposal": "REVIEW_VISUAL_CHANGE",
            "evidence_crop_sha256": region["evidence_crop_sha256"],
            "measurements": {
                "area_px": area,
                "mean_delta": mean_delta,
                "max_delta": int(region["max_delta"]),
            },
        })
    packet: dict[str, Any] = {
        "schema": "proofline.review-proposal.v1",
        "evidence_receipt_sha256": evidence["receipt_sha256"],
        "state": "REVIEW_REQUIRED" if proposals else "NO_VISUAL_CHANGE_DETECTED",
        "proposals": proposals,
        "authority": {
            "approve_product": False,
            "reject_product": False,
            "production_mutation": False,
            "vendor_contact": False,
            "purchase_or_payment": False,
            "external_send": False,
        },
    }
    packet["receipt_sha256"] = digest_json(packet)
    return packet


def verify_review_proposal(proposal: dict[str, Any], evidence: dict[str, Any]) -> bool:
    if not verify_evidence_packet(evidence) or not isinstance(proposal, dict):
        return False
    try:
        expected = build_review_proposal(evidence)
        # Canonical bytes, rather than Python equality, preserve exact JSON types
        # (e.g. true must never alias integer 1) and reject all extra/missing fields.
        return canonical_json(proposal) == canonical_json(expected)
    except (ProposalError, TypeError, ValueError, UnicodeError):
        return False
