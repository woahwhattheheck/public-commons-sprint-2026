from __future__ import annotations

from typing import Any

from .codec import digest_json
from .vision import verify_evidence_packet


class ProposalError(ValueError):
    pass


def build_review_proposal(evidence: dict[str, Any]) -> dict[str, Any]:
    if not verify_evidence_packet(evidence):
        raise ProposalError("evidence packet failed verification")
    regions = evidence["regions"]
    proposals: list[dict[str, Any]] = []
    for region in regions:
        area = int(region["area_px"])
        mean_delta = float(region["mean_delta"])
        if area >= 1000 or mean_delta >= 90:
            priority = "HIGH"
        elif area >= 200 or mean_delta >= 45:
            priority = "MEDIUM"
        else:
            priority = "LOW"
        proposals.append({
            "region_id": region["region_id"],
            "priority": priority,
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
    if not verify_evidence_packet(evidence):
        return False
    if not isinstance(proposal, dict) or proposal.get("schema") != "proofline.review-proposal.v1":
        return False
    receipt = proposal.get("receipt_sha256")
    if not isinstance(receipt, str):
        return False
    body = dict(proposal)
    body.pop("receipt_sha256", None)
    if digest_json(body) != receipt:
        return False
    if body.get("evidence_receipt_sha256") != evidence.get("receipt_sha256"):
        return False
    authority = body.get("authority")
    if not isinstance(authority, dict) or any(value is not False for value in authority.values()):
        return False
    valid_regions = {region["region_id"]: region for region in evidence["regions"]}
    proposals = body.get("proposals")
    if not isinstance(proposals, list):
        return False
    seen: set[str] = set()
    for item in proposals:
        if not isinstance(item, dict):
            return False
        region_id = item.get("region_id")
        if region_id in seen or region_id not in valid_regions:
            return False
        seen.add(region_id)
        source = valid_regions[region_id]
        if item.get("evidence_crop_sha256") != source.get("evidence_crop_sha256"):
            return False
        if item.get("proposal") != "REVIEW_VISUAL_CHANGE":
            return False
    expected_state = "REVIEW_REQUIRED" if proposals else "NO_VISUAL_CHANGE_DETECTED"
    return body.get("state") == expected_state
