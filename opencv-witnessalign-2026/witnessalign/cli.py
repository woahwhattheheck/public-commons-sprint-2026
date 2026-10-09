"""Local human-review CLI; no camera, upload, credential or provider access."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .engine import analyze, EvidenceError


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Compare a golden reference with a candidate photo")
    p.add_argument("reference", type=Path)
    p.add_argument("candidate", type=Path)
    p.add_argument("--output", type=Path, default=Path("out"))
    a = p.parse_args(argv)
    try:
        outcome, overlay = analyze(a.reference.read_bytes(), a.candidate.read_bytes())
        a.output.mkdir(parents=True, exist_ok=True)
        (a.output / "audit.json").write_text(json.dumps(outcome, indent=2) + "\n")
        if overlay is not None:
            (a.output / "review-overlay.png").write_bytes(overlay)
        print(json.dumps({"decision": outcome["decision"], "candidate_regions": len(outcome["candidate_regions"]),
                          "output": str(a.output)}))
        return 0
    except (EvidenceError, OSError) as exc:
        p.exit(2, f"ERROR: {exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())
