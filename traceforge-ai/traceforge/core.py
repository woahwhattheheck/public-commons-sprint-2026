from __future__ import annotations

import copy
from typing import Any

from . import core_legacy as _legacy
from .core_legacy import *  # noqa: F401,F403

_SUMMARY_REVIEW_REASON = (
    "Model-generated summary is not evidence-verified; only individual CLAIM PASS findings "
    "have passed citation, support, and skeptic gates."
)


def _summary_review_valid(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"status", "reason"}
        and value.get("status") == "REVIEW_ONLY"
        and value.get("reason") == _SUMMARY_REVIEW_REASON
    )


def analyze(text: str, model: ModelClient) -> dict[str, Any]:
    result = _legacy.analyze(text, model)
    result["summary_review"] = {
        "status": "REVIEW_ONLY",
        "reason": _SUMMARY_REVIEW_REASON,
    }
    core = {key: value for key, value in result.items() if key != "receipt"}
    digest = _legacy.sha256_json(core)
    result["receipt"] = {
        "schema": "traceforge-receipt/v1",
        "evidence_sha256": result["evidence"]["sha256"],
        "analysis_sha256": digest,
        "model": result["model"],
        "run_id": digest[:16],
    }
    return result


def verify_receipt(result: Any) -> bool:
    if not isinstance(result, dict) or not _summary_review_valid(result.get("summary_review")):
        return False
    receipt = result.get("receipt")
    if not isinstance(receipt, dict):
        return False
    try:
        legacy_result = copy.deepcopy(result)
        del legacy_result["summary_review"]
        legacy_core = {key: value for key, value in legacy_result.items() if key != "receipt"}
        legacy_digest = _legacy.sha256_json(legacy_core)
        legacy_result["receipt"] = {
            "schema": "traceforge-receipt/v1",
            "evidence_sha256": legacy_result["evidence"]["sha256"],
            "analysis_sha256": legacy_digest,
            "model": legacy_result["model"],
            "run_id": legacy_digest[:16],
        }
        if not _legacy.verify_receipt(legacy_result):
            return False

        core = {key: value for key, value in result.items() if key != "receipt"}
        digest = _legacy.sha256_json(core)
    except (KeyError, TypeError, ValueError, OverflowError, RecursionError):
        return False
    return (
        set(receipt) == {"schema", "evidence_sha256", "analysis_sha256", "model", "run_id"}
        and receipt.get("schema") == "traceforge-receipt/v1"
        and receipt.get("analysis_sha256") == digest
        and receipt.get("evidence_sha256") == result["evidence"]["sha256"]
        and receipt.get("model") == result["model"]
        and receipt.get("run_id") == digest[:16]
    )
