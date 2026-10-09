#!/usr/bin/env python3
"""Opt-in ChipTrace v1 report-to-source verification (offline; no re-analysis).

The original chiptrace.py verify checks only a report's self-contained receipt.
This tool additionally requires explicitly provided baseline and candidate
paths, then checks their raw bytes against the SHA-256 digests already recorded
in that report. It does not authenticate authorship or experimental validity.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

_SHA256 = re.compile(r"[0-9a-f]{64}$")
_BLOCK_SIZE = 1024 * 1024
_MAX_REPORT_BYTES = 32 * 1024 * 1024


class VerificationError(ValueError):
    """Input is unsuitable for source-bound receipt verification."""


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise VerificationError(f"duplicate JSON key: {key!r}")
        out[key] = value
    return out


def _reject_nonfinite(token: str) -> Any:
    raise VerificationError(f"non-finite JSON number: {token}")


def _load_report(path: Path) -> dict[str, Any]:
    with path.open("rb") as stream:
        raw = stream.read(_MAX_REPORT_BYTES + 1)
    if len(raw) > _MAX_REPORT_BYTES:
        raise VerificationError("report exceeds 32 MiB limit")
    report = json.loads(raw.decode("utf-8"), object_pairs_hook=_reject_duplicate_keys,
                        parse_constant=_reject_nonfinite)
    if not isinstance(report, dict):
        raise VerificationError("report must be a JSON object")
    return report


def _canonical_digest(report_without_receipt: dict[str, Any]) -> str:
    # Matches ChipTrace canonical_bytes, not pretty-printed JSON file bytes.
    canonical = json.dumps(report_without_receipt, sort_keys=True, separators=(",", ":"),
                           ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def _file_digest(path: Path) -> str:
    # Stream sources; do not load large research CSV files into memory.
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(_BLOCK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_sources(report_path: Path, baseline_path: Path, run_path: Path) -> dict[str, Any]:
    """Compare a receipt and both independently selected raw files.

    Fail closed on invalid/unrecognized receipts before reading any sources;
    report filenames are untrusted metadata and are NEVER used as paths.
    """
    report = _load_report(report_path)
    if report.get("schema") != "chiptrace.report.v1":
        raise VerificationError("not a ChipTrace v1 report")
    receipt = report.get("receipt_sha256")
    if not isinstance(receipt, str) or _SHA256.fullmatch(receipt) is None:
        raise VerificationError("report has no valid SHA-256 receipt")
    body = dict(report)
    del body["receipt_sha256"]
    if _canonical_digest(body) != receipt:
        raise VerificationError("report's canonical receipt does not match")

    inputs = report.get("inputs")
    if not isinstance(inputs, dict):
        raise VerificationError("report input digest map is missing")
    expected = {}
    for key in ("baseline_sha256", "run_sha256"):
        value = inputs.get(key)
        if not isinstance(value, str) or _SHA256.fullmatch(value) is None:
            raise VerificationError(f"report input digest is missing/invalid: {key}")
        expected[key] = value

    baseline_match = _file_digest(baseline_path) == expected["baseline_sha256"]
    run_match = _file_digest(run_path) == expected["run_sha256"]
    return {
        "status": "PASS" if baseline_match and run_match else "FAIL",
        "report_receipt_valid": True,
        "baseline_bytes_match": baseline_match,
        "run_bytes_match": run_match,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path, help="existing ChipTrace JSON report")
    parser.add_argument("--baseline", required=True, type=Path, help="baseline CSV to verify")
    parser.add_argument("--run", required=True, type=Path, help="candidate CSV to verify")
    args = parser.parse_args(argv)
    try:
        result = verify_sources(args.report, args.baseline, args.run)
    except (OSError, UnicodeError, ValueError, TypeError, OverflowError) as exc:
        # Do not surface full absolute file paths or input values in stdout.
        result = {"status": "FAIL", "reason": type(exc).__name__,
                  "report_receipt_valid": None}
    print(json.dumps(result, sort_keys=True))
    return 0 if result["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
