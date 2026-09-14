#!/usr/bin/env python3
"""End-to-end smoke verification for a hosted TraceForge deployment.

Uses only the Python standard library. The verifier exercises the public UI,
configuration/demo endpoints, deterministic analysis, and receipt verification.
It performs no remediation, outbound messaging, provider mutation, or live-model
request.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any
from urllib import error, request

DEFAULT_BASE_URL = "https://traceforge-ai-production.up.railway.app"
TIMEOUT_SECONDS = 15


def _request(base_url: str, method: str, path: str, payload: Any | None = None) -> tuple[int, str, bytes]:
    body = None
    headers = {"Accept": "application/json, text/html;q=0.9"}
    if payload is not None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = request.Request(
        f"{base_url.rstrip('/')}{path}",
        data=body,
        headers=headers,
        method=method,
    )
    try:
        with request.urlopen(req, timeout=TIMEOUT_SECONDS) as response:
            return response.status, response.headers.get_content_type(), response.read()
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} returned HTTP {exc.code}: {detail[:400]}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"{method} {path} failed: {exc.reason}") from exc


def _json(body: bytes, label: str) -> dict[str, Any]:
    try:
        value = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"{label} did not return valid JSON") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"{label} JSON must be an object")
    return value


def verify(base_url: str) -> dict[str, Any]:
    root_status, root_type, root_body = _request(base_url, "GET", "/")
    root_text = root_body.decode("utf-8", errors="replace")
    if root_status != 200 or "TraceForge" not in root_text:
        raise RuntimeError("hosted UI check failed")

    config_status, _, config_body = _request(base_url, "GET", "/api/config")
    config = _json(config_body, "/api/config")
    if config_status != 200 or "liveConfigured" not in config:
        raise RuntimeError("configuration endpoint check failed")

    demo_status, _, demo_body = _request(base_url, "GET", "/api/demo")
    demo = _json(demo_body, "/api/demo")
    if demo_status != 200 or not isinstance(demo.get("text"), str) or not demo["text"].strip():
        raise RuntimeError("demo endpoint check failed")

    incident = (
        "2026-09-14T00:00:00Z api timeout observed\n"
        "2026-09-14T00:00:01Z database healthy"
    )
    analyze_status, _, analyze_body = _request(
        base_url,
        "POST",
        "/api/analyze",
        {"text": incident, "mode": "demo"},
    )
    analysis = _json(analyze_body, "/api/analyze")
    counts = analysis.get("counts")
    receipt = analysis.get("receipt")
    if analyze_status != 200:
        raise RuntimeError("analysis endpoint check failed")
    if not isinstance(counts, dict) or counts.get("pass", 0) < 1 or counts.get("hold") != 0:
        raise RuntimeError(f"unexpected deterministic analysis counts: {counts!r}")
    if not isinstance(receipt, dict) or receipt.get("schema") != "traceforge-receipt/v1":
        raise RuntimeError("analysis receipt is missing or has an unexpected schema")

    verify_status, _, verify_body = _request(base_url, "POST", "/api/verify", analysis)
    verification = _json(verify_body, "/api/verify")
    if verify_status != 200 or verification.get("valid") is not True:
        raise RuntimeError(f"receipt verification failed: {verification!r}")

    return {
        "base_url": base_url.rstrip("/"),
        "ui": {"status": root_status, "content_type": root_type, "traceforge_marker": True},
        "config": {"status": config_status, "liveConfigured": config.get("liveConfigured")},
        "demo": {"status": demo_status, "text_bytes": len(demo["text"].encode("utf-8"))},
        "analyze": {
            "status": analyze_status,
            "pass": counts["pass"],
            "hold": counts["hold"],
            "run_id": receipt.get("run_id"),
        },
        "verify": {"status": verify_status, "valid": True},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test a hosted TraceForge deployment")
    parser.add_argument("base_url", nargs="?", default=DEFAULT_BASE_URL)
    args = parser.parse_args()
    try:
        result = verify(args.base_url)
    except RuntimeError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
