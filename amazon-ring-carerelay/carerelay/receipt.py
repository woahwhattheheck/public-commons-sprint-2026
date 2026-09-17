from __future__ import annotations

import hashlib
from typing import Any

from .core import CareRelayError, canonical_json, strict_json_loads

RECEIPT_SCHEMA = "carerelay-receipt/v1"
_FALSE_AUTHORITY = {
    "ring_provider_execution_verified": False,
    "external_action_executed": False,
    "devpost_submitted": False,
    "award_verified": False,
    "payment_verified": False,
}


def _digest(payload: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(payload)).hexdigest()


def compile_receipt(state: dict[str, Any], *, source: str = "offline-simulator") -> dict[str, Any]:
    if not isinstance(state, dict) or state.get("schema") != "carerelay-state/v1":
        raise CareRelayError("invalid CareRelay state")
    if state.get("authority") != _FALSE_AUTHORITY:
        raise CareRelayError("state authority ceiling changed")
    if source not in {"offline-simulator", "provider-candidate"}:
        raise CareRelayError("unsupported receipt source")
    payload = {
        "schema": RECEIPT_SCHEMA,
        "source": source,
        "state_sha256": hashlib.sha256(canonical_json(state)).hexdigest(),
        "event_count": len(state.get("events", [])),
        "proposal_count": len(state.get("proposals", [])),
        "approval_count": len(state.get("approvals", [])),
        "authority": dict(_FALSE_AUTHORITY),
    }
    return {**payload, "receipt_sha256": _digest(payload)}


def verify_receipt(receipt: dict[str, Any] | str | bytes, state: dict[str, Any]) -> bool:
    if isinstance(receipt, (str, bytes)):
        receipt = strict_json_loads(receipt)
    if not isinstance(receipt, dict):
        return False
    try:
        allowed = {
            "schema", "source", "state_sha256", "event_count", "proposal_count",
            "approval_count", "authority", "receipt_sha256",
        }
        if set(receipt) != allowed:
            return False
        if receipt["schema"] != RECEIPT_SCHEMA:
            return False
        if receipt["source"] not in {"offline-simulator", "provider-candidate"}:
            return False
        if receipt["authority"] != _FALSE_AUTHORITY:
            return False
        if state.get("authority") != _FALSE_AUTHORITY:
            return False
        if receipt["state_sha256"] != hashlib.sha256(canonical_json(state)).hexdigest():
            return False
        if receipt["event_count"] != len(state.get("events", [])):
            return False
        if receipt["proposal_count"] != len(state.get("proposals", [])):
            return False
        if receipt["approval_count"] != len(state.get("approvals", [])):
            return False
        payload = {k: v for k, v in receipt.items() if k != "receipt_sha256"}
        return receipt["receipt_sha256"] == _digest(payload)
    except (CareRelayError, KeyError, TypeError, ValueError):
        return False
