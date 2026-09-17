from __future__ import annotations

import hashlib
from typing import Any

from .core import PermitRouteError, canonical_json, strict_json_loads

RECEIPT_SCHEMA = "permitroute-assurance-receipt/v1"
FALSE_AUTHORITY = {
    "customer_data_used": False,
    "nydot_acceptance_verified": False,
    "prime_bid_verified": False,
    "contract_awarded": False,
    "invoice_issued": False,
    "payment_received": False,
}

def compile_receipt(
    *,
    batch_diff: dict[str, Any],
    replay: dict[str, Any],
    source: str = "synthetic-demo",
) -> dict[str, Any]:
    if batch_diff.get("schema") != "permitroute-batch-diff/v1":
        raise PermitRouteError("invalid batch diff")
    if replay.get("schema") != "permitroute-replay/v1":
        raise PermitRouteError("invalid replay")
    if source not in {"synthetic-demo", "authorized-project-candidate"}:
        raise PermitRouteError("unsupported evidence source")
    payload = {
        "schema": RECEIPT_SCHEMA,
        "source": source,
        "batch_diff_sha256": hashlib.sha256(canonical_json(batch_diff)).hexdigest(),
        "replay_sha256": hashlib.sha256(canonical_json(replay)).hexdigest(),
        "legacy_count": batch_diff.get("legacy_count"),
        "target_count": batch_diff.get("target_count"),
        "equivalent_count": batch_diff.get("equivalent_count"),
        "different_count": batch_diff.get("different_count"),
        "legacy_only_count": batch_diff.get("legacy_only_count"),
        "target_only_count": batch_diff.get("target_only_count"),
        "replay_event_count": len(replay.get("events", [])),
        "authority": dict(FALSE_AUTHORITY),
    }
    return {
        **payload,
        "receipt_sha256": hashlib.sha256(canonical_json(payload)).hexdigest(),
    }

def verify_receipt(
    receipt: dict[str, Any] | str | bytes,
    *,
    batch_diff: dict[str, Any],
    replay: dict[str, Any],
) -> bool:
    if isinstance(receipt, (str, bytes)):
        try:
            receipt = strict_json_loads(receipt)
        except PermitRouteError:
            return False
    if not isinstance(receipt, dict):
        return False
    allowed = {
        "schema", "source", "batch_diff_sha256", "replay_sha256",
        "legacy_count", "target_count", "equivalent_count", "different_count",
        "legacy_only_count", "target_only_count", "replay_event_count",
        "authority", "receipt_sha256",
    }
    try:
        if set(receipt) != allowed:
            return False
        if receipt["schema"] != RECEIPT_SCHEMA:
            return False
        if receipt["source"] not in {"synthetic-demo", "authorized-project-candidate"}:
            return False
        if receipt["authority"] != FALSE_AUTHORITY:
            return False
        if receipt["batch_diff_sha256"] != hashlib.sha256(canonical_json(batch_diff)).hexdigest():
            return False
        if receipt["replay_sha256"] != hashlib.sha256(canonical_json(replay)).hexdigest():
            return False
        counters = {
            "legacy_count": batch_diff.get("legacy_count"),
            "target_count": batch_diff.get("target_count"),
            "equivalent_count": batch_diff.get("equivalent_count"),
            "different_count": batch_diff.get("different_count"),
            "legacy_only_count": batch_diff.get("legacy_only_count"),
            "target_only_count": batch_diff.get("target_only_count"),
            "replay_event_count": len(replay.get("events", [])),
        }
        if any(receipt[k] != v for k, v in counters.items()):
            return False
        payload = {k: v for k, v in receipt.items() if k != "receipt_sha256"}
        return receipt["receipt_sha256"] == hashlib.sha256(canonical_json(payload)).hexdigest()
    except (KeyError, TypeError, ValueError, PermitRouteError):
        return False
