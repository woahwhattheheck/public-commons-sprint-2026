#!/usr/bin/env python3
"""Offline, source-file-verified IV&V acceptance gate. No network, buyer access, or PII."""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import sys

SCHEMA = "tj-ivv-evidence/v1"
IDENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$")
HASH = re.compile(r"^[0-9a-f]{64}$")
OUTCOMES = {"pass", "fail", "blocked", "not-run"}


def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON field: {key}")
        result[key] = value
    return result


def instant(text):
    if not isinstance(text, str):
        raise ValueError("timestamp must be an offset-aware ISO8601 string")
    try:
        ts = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("invalid ISO8601 timestamp") from exc
    if ts.tzinfo is None or ts.utcoffset() is None:
        raise ValueError("timestamp timezone is required")
    return ts.astimezone(timezone.utc)


def valid_id(value):
    return isinstance(value, str) and bool(IDENT.fullmatch(value))


def audit(document: dict, manifest_path: Path, as_of: str | None = None) -> dict:
    """Return a deterministic, fail-closed report. Only local immutable artifact hashes are trusted."""
    if not isinstance(document, dict) or document.get("schema") != SCHEMA:
        raise ValueError(f"manifest schema must equal {SCHEMA}")
    as_of_time = instant(as_of or document.get("review_as_of"))
    revision = document.get("baseline")
    implementer = document.get("implementer_org")
    if not valid_id(revision) or not isinstance(implementer, str) or not implementer.strip():
        raise ValueError("baseline id and implementer_org required")
    requirements = document.get("requirements")
    observations = document.get("observations")
    if not isinstance(requirements, list) or not requirements or not isinstance(observations, list):
        raise ValueError("nonempty requirements and observations array required")

    issues = []
    errors = defaultdict(list)
    required = {}
    for req in requirements:
        if not isinstance(req, dict) or not valid_id(req.get("id")):
            raise ValueError("requirement id must be canonical")
        rid = req["id"]
        if rid in required:
            raise ValueError(f"duplicate requirement id: {rid}")
        tests = req.get("required_tests")
        if not isinstance(tests, list) or not tests or any(not valid_id(t) for t in tests) or len(tests) != len(set(tests)):
            raise ValueError(f"{rid}: nonempty unique required_tests list required")
        if not isinstance(req.get("critical"), bool):
            raise ValueError(f"{rid}: critical must be boolean")
        required[rid] = {"critical": req["critical"], "tests": set(tests)}
    seen = set()
    coverage = defaultdict(list)
    root = manifest_path.resolve().parent
    for obs in observations:
        if not isinstance(obs, dict) or not valid_id(obs.get("id")) or obs["id"] in seen:
            raise ValueError("observation ids must be unique and canonical")
        oid = obs["id"]
        seen.add(oid)
        rid, test_id = obs.get("requirement_id"), obs.get("test_id")
        local = []
        if rid not in required:
            local.append("ORPHAN_REQUIREMENT")
        elif test_id not in required[rid]["tests"]:
            local.append("UNADVERTISED_TEST")
        if obs.get("baseline") != revision:
            local.append("BASELINE_DRIFT")
        outcome = obs.get("outcome")
        if outcome not in OUTCOMES:
            local.append("INVALID_OUTCOME")
        reviewer = obs.get("reviewer_org")
        if not isinstance(reviewer, str) or not reviewer.strip():
            local.append("MISSING_REVIEWER")
        elif reviewer.strip().casefold() == implementer.strip().casefold():
            local.append("REVIEWER_NOT_INDEPENDENT")
        try:
            observed = instant(obs.get("observed_at"))
            if observed > as_of_time:
                local.append("FUTURE_OBSERVATION")
        except ValueError:
            observed = datetime.min.replace(tzinfo=timezone.utc)
            local.append("BAD_OBSERVED_AT")
        file_ref = obs.get("artifact_path")
        digest = obs.get("sha256")
        if not isinstance(file_ref, str) or not file_ref or Path(file_ref).is_absolute():
            local.append("INVALID_ARTIFACT_PATH")
        else:
            source = (root / file_ref).resolve()
            if not source.is_relative_to(root):
                local.append("ARTIFACT_ESCAPE")
            elif not source.is_file():
                local.append("ARTIFACT_MISSING")
            elif not isinstance(digest, str) or not HASH.fullmatch(digest):
                local.append("INVALID_SHA256")
            elif sha256(source.read_bytes()).hexdigest() != digest:
                local.append("ARTIFACT_HASH_MISMATCH")
        for problem in local:
            issues.append({"observation": oid, "requirement": rid, "code": problem})
            if rid in required:
                errors[rid].append(problem)
        if rid in required and test_id in required[rid]["tests"] and not local:
            coverage[(rid, test_id)].append((observed, oid, outcome))
    report_rows = []
    for rid, spec in sorted(required.items()):
        test_status = {}
        for test_id in sorted(spec["tests"]):
            events = sorted(coverage[(rid, test_id)], key=lambda row: (row[0], row[1]))
            if not events:
                status = "MISSING"
            else:
                latest = events[-1]
                tied = [e for e in events if e[0] == latest[0]]
                status = "CONFLICT" if len({e[2] for e in tied}) > 1 else latest[2].upper()
            test_status[test_id] = status
        status = "PASS" if not errors[rid] and all(v == "PASS" for v in test_status.values()) else "FAIL"
        report_rows.append({"id": rid, "critical": spec["critical"], "status": status, "tests": test_status,
                            "evidence_errors": sorted(set(errors[rid]))})
    issues.sort(key=lambda x: (str(x["requirement"]), x["observation"], x["code"]))
    passed = sum(r["status"] == "PASS" for r in report_rows)
    return {"schema": "tj-ivv-audit/v1", "baseline": revision, "as_of": as_of_time.isoformat(),
            "pass": passed == len(report_rows) and not issues, "requirements_total": len(report_rows),
            "requirements_passed": passed, "observations_total": len(observations),
            "independent_verification_only": True, "payment_or_buyer_compliance_proven": False,
            "requirements": report_rows, "issues": issues}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--as-of", help="Override manifest review_as_of with offset-aware ISO8601 time")
    parser.add_argument("--report", type=Path, help="Optional JSON report file")
    args = parser.parse_args(argv)
    try:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"), object_pairs_hook=strict_object)
        report = audit(manifest, args.manifest, args.as_of)
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
        print(json.dumps({"pass": False, "error": str(exc)}, sort_keys=True), file=sys.stderr)
        return 1
    text = json.dumps(report, indent=2, sort_keys=True) + "\n"
    print(text, end="")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(text, encoding="utf-8")
    return 0 if report["pass"] else 2


if __name__ == "__main__":
    sys.exit(main())
