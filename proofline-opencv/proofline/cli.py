from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from .agent import build_review_proposal, verify_review_proposal
from .codec import canonical_json, loads_strict
from .vision import inspect_pair, verify_evidence_packet


def _read(path: str, max_bytes: int = 24 * 1024 * 1024) -> bytes:
    p = Path(path)
    if not p.is_file():
        raise ValueError(f"not a regular file: {path}")
    raw = p.read_bytes()
    if len(raw) > max_bytes:
        raise ValueError(f"file exceeds byte limit: {path}")
    return raw


def _write_new(path: str, raw: bytes) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("xb") as handle:
        handle.write(raw)
        handle.flush()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="proofline")
    sub = parser.add_subparsers(dest="command", required=True)
    inspect_cmd = sub.add_parser("inspect")
    inspect_cmd.add_argument("--reference", required=True)
    inspect_cmd.add_argument("--inspection", required=True)
    inspect_cmd.add_argument("--output", required=True)
    inspect_cmd.add_argument("--allow-opencv4-dev", action="store_true")
    propose = sub.add_parser("propose")
    propose.add_argument("--evidence", required=True)
    propose.add_argument("--output", required=True)
    verify = sub.add_parser("verify")
    verify.add_argument("--evidence", required=True)
    verify.add_argument("--proposal")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "inspect":
            packet = inspect_pair(
                _read(args.reference),
                _read(args.inspection),
                allow_opencv4_dev=bool(args.allow_opencv4_dev),
            )
            _write_new(args.output, canonical_json(packet) + b"\n")
            print(packet["receipt_sha256"])
            return 0
        if args.command == "propose":
            evidence = loads_strict(_read(args.evidence, 2_000_000))
            if not isinstance(evidence, dict):
                raise ValueError("evidence must be an object")
            proposal = build_review_proposal(evidence)
            _write_new(args.output, canonical_json(proposal) + b"\n")
            print(proposal["receipt_sha256"])
            return 0
        evidence = loads_strict(_read(args.evidence, 2_000_000))
        if not isinstance(evidence, dict) or not verify_evidence_packet(evidence):
            print("INVALID_EVIDENCE")
            return 1
        if args.proposal:
            proposal = loads_strict(_read(args.proposal, 2_000_000))
            if not isinstance(proposal, dict) or not verify_review_proposal(proposal, evidence):
                print("INVALID_PROPOSAL")
                return 1
        print("VERIFIED")
        return 0
    except Exception as exc:
        print(json.dumps({"status": "ERROR", "type": type(exc).__name__, "message": str(exc)}, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
