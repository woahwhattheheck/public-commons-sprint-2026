"""CLI for VisualLedger local demo/evaluation."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import stat
import sys

from .agent import canonical, compile_trace, verify_trace
from .synth import benchmark_cases, make_case
from .vision import MAX_IMAGE_BYTES, VisionError


def read_regular(path: str, maximum: int = MAX_IMAGE_BYTES) -> bytes:
    p = Path(path)
    st = p.lstat()
    if stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode) or st.st_size > maximum:
        raise VisionError("input must be a bounded regular non-symlink file")
    raw = p.read_bytes()
    if len(raw) != st.st_size:
        raise VisionError("input changed while reading")
    return raw


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="visualledger")
    sub = p.add_subparsers(dest="command", required=True)
    a = sub.add_parser("analyze")
    a.add_argument("image")
    a.add_argument("--evidence-id", required=True)
    a.add_argument("--out", required=True)
    a.add_argument("--allow-opencv4-dev", action="store_true")
    v = sub.add_parser("verify")
    v.add_argument("image")
    v.add_argument("trace")
    v.add_argument("--allow-opencv4-dev", action="store_true")
    e = sub.add_parser("evaluate")
    e.add_argument("--allow-opencv4-dev", action="store_true")
    return p


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "analyze":
            raw = read_regular(args.image)
            trace = compile_trace(raw, evidence_id=args.evidence_id, allow_opencv4_dev=args.allow_opencv4_dev)
            target = Path(args.out)
            with target.open("xb") as fh:
                fh.write(canonical(trace) + b"\n")
            print(trace["receipt_sha256"])
            return 0
        if args.command == "verify":
            raw = read_regular(args.image)
            trace = json.loads(read_regular(args.trace, 8 * 1024 * 1024).decode("utf-8"))
            verified = verify_trace(trace, raw, allow_opencv4_dev=args.allow_opencv4_dev)
            print(verified["receipt_sha256"])
            return 0
        results = []
        runtime = None
        for row in benchmark_cases():
            raw = make_case(row["kind"])
            trace = compile_trace(raw, evidence_id="BENCH-" + row["kind"], allow_opencv4_dev=args.allow_opencv4_dev)
            if runtime is None:
                runtime = {
                    "opencv_version": trace["perception"]["opencv_version"],
                    "competition_opencv5_runtime": trace["perception"]["competition_opencv5_runtime"],
                    "development_compatibility_used": trace["perception"]["development_compatibility_used"],
                }
            action = trace["decision"]["action"]
            results.append({"kind": row["kind"], "expected": row["expected_action"], "actual": action, "pass": action == row["expected_action"]})
        payload = {"schema": "visualledger-evaluation/v1", "runtime": runtime, "cases": results, "passed": sum(int(x["pass"]) for x in results), "total": len(results)}
        print(json.dumps(payload, sort_keys=True, separators=(",", ":")))
        return 0 if payload["passed"] == payload["total"] else 2
    except (VisionError, OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
