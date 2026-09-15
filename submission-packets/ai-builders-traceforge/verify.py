#!/usr/bin/env python3
"""Offline source-binding verifier for the TraceForge AI Builders submission packet."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

SCHEMA = "traceforge-ai-builders-submission/v1"
SHA1_RE = re.compile(r"^[0-9a-f]{40}$")


class VerificationError(RuntimeError):
    pass


def _git(repo: Path, *args: str) -> str:
    proc = subprocess.run(
        ["git", "-C", str(repo), *args],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode != 0:
        detail = proc.stderr.strip() or proc.stdout.strip() or f"git exited {proc.returncode}"
        raise VerificationError(detail)
    return proc.stdout.strip()


def _tree(repo: Path, ref: str, subtree: str) -> str:
    value = _git(repo, "rev-parse", f"{ref}:{subtree}")
    if not SHA1_RE.fullmatch(value):
        raise VerificationError(f"unexpected tree id for {ref}:{subtree}: {value!r}")
    obj_type = _git(repo, "cat-file", "-t", value)
    if obj_type != "tree":
        raise VerificationError(f"{ref}:{subtree} resolved to {obj_type!r}, expected tree")
    return value


def _load_packet(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise VerificationError(f"cannot load packet: {exc}") from exc
    if not isinstance(data, dict) or data.get("schema") != SCHEMA:
        raise VerificationError(f"packet schema must be {SCHEMA!r}")

    binding = data.get("source_binding")
    if not isinstance(binding, dict):
        raise VerificationError("source_binding must be an object")
    for key in ("subtree_path", "deployment_source_commit", "expected_subtree_sha"):
        if not isinstance(binding.get(key), str) or not binding[key]:
            raise VerificationError(f"source_binding.{key} must be a non-empty string")
    if not SHA1_RE.fullmatch(binding["deployment_source_commit"]):
        raise VerificationError("deployment_source_commit must be a 40-hex Git object id")
    if not SHA1_RE.fullmatch(binding["expected_subtree_sha"]):
        raise VerificationError("expected_subtree_sha must be a 40-hex Git object id")

    gates = data.get("human_gates")
    if not isinstance(gates, list) or not gates:
        raise VerificationError("human_gates must be a non-empty list")
    if any(not isinstance(g, dict) or g.get("status") != "PENDING_HUMAN" for g in gates):
        raise VerificationError("all submission/account gates must remain PENDING_HUMAN in the source packet")

    claims = data.get("claims")
    if not isinstance(claims, dict) or not claims:
        raise VerificationError("claims must be a non-empty object")
    if any(value is not False for value in claims.values()):
        raise VerificationError("source packet must not manufacture submission, eligibility, prize, or payment completion")
    return data


def verify(repo: Path, packet_path: Path, current_ref: str) -> dict[str, Any]:
    data = _load_packet(packet_path)
    binding = data["source_binding"]
    subtree = binding["subtree_path"]
    deployment_commit = binding["deployment_source_commit"]
    expected = binding["expected_subtree_sha"]

    deployment_tree = _tree(repo, deployment_commit, subtree)
    current_tree = _tree(repo, current_ref, subtree)
    checks = {
        "deployment_matches_pin": deployment_tree == expected,
        "current_matches_pin": current_tree == expected,
        "current_matches_deployment": current_tree == deployment_tree,
        "external_completion_claims_false": all(v is False for v in data["claims"].values()),
        "human_gates_pending": all(g["status"] == "PENDING_HUMAN" for g in data["human_gates"]),
    }
    return {
        "schema": "traceforge-submission-source-proof/v1",
        "ok": all(checks.values()),
        "current_ref": current_ref,
        "subtree_path": subtree,
        "deployment_source_commit": deployment_commit,
        "expected_subtree_sha": expected,
        "deployment_subtree_sha": deployment_tree,
        "current_subtree_sha": current_tree,
        "checks": checks,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--packet", type=Path, default=Path(__file__).with_name("packet.json"))
    parser.add_argument("--current-ref", default="HEAD")
    args = parser.parse_args()

    try:
        result = verify(args.repo_root.resolve(), args.packet.resolve(), args.current_ref)
    except VerificationError as exc:
        print(json.dumps({"schema": "traceforge-submission-source-proof/v1", "ok": False, "error": str(exc)}, sort_keys=True))
        return 2

    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
