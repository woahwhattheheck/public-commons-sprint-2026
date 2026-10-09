"""AWS Lambda HTTPS API adapter; all processing runs in the Lambda container.

Receives exactly two bounded base64 PNG/JPEG fields, not URLs, S3 keys or arbitrary
paths. Cloud installation is optional and has NOT been performed by this source.
"""
from __future__ import annotations

import base64
import binascii
import json
from typing import Any

from .engine import EvidenceError, analyze

MAX_BODY_CHARS = 9_000_000
MAX_ENCODED_IMAGE_CHARS = 5_500_000


def _reply(status: int, body: dict[str, Any]) -> dict[str, Any]:
    return {"statusCode": status,
            "headers": {"Content-Type": "application/json", "Cache-Control": "no-store",
                        "X-Content-Type-Options": "nosniff"},
            "body": json.dumps(body, separators=(",", ":"), allow_nan=False)}


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    try:
        if event.get("requestContext", {}).get("http", {}).get("method") != "POST":
            return _reply(405, {"error": "POST required"})
        raw = event.get("body", "")
        if not isinstance(raw, str) or len(raw) > MAX_BODY_CHARS:
            return _reply(413, {"error": "request body too large"})
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw, validate=True).decode("utf-8")
        obj = json.loads(raw)
        if not isinstance(obj, dict) or set(obj) != {"reference_b64", "candidate_b64"}:
            return _reply(400, {"error": "expected reference_b64 and candidate_b64 only"})
        pictures = []
        for name in ("reference_b64", "candidate_b64"):
            s = obj[name]
            if not isinstance(s, str) or not 0 < len(s) <= MAX_ENCODED_IMAGE_CHARS:
                return _reply(413, {"error": f"invalid size for {name}"})
            pictures.append(base64.b64decode(s, validate=True))
        result, overlay = analyze(*pictures)
        # JSON stays bounded and useful when the encoded overlay exceeds the response budget.
        if overlay is not None and len(overlay) <= 1_500_000:
            result["annotated_preview_b64"] = base64.b64encode(overlay).decode("ascii")
        else:
            result["annotated_preview_omitted"] = overlay is not None
        return _reply(200, result)
    except (EvidenceError, ValueError, UnicodeError, binascii.Error, TypeError) as exc:
        return _reply(400, {"error": "image or request validation failed", "details": str(exc)[:120]})
