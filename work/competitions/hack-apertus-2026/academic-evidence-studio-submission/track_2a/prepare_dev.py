#!/usr/bin/env python3
"""Convert organizer MNLIoverSwissVotingBooklets v1.1 JSONL to Task B cases."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument("--cases", required=True, type=Path)
    parser.add_argument("--gold", required=True, type=Path)
    args = parser.parse_args()

    raw = args.dataset.read_bytes()
    cases: list[dict] = []
    gold: list[dict] = []
    for index, line in enumerate(raw.decode("utf-8").splitlines()):
        if not line.strip():
            continue
        row = json.loads(line)
        case_id = f"ost-v1.1-{index:04d}"
        cases.append({
            "id": case_id,
            "reference": {"text": row["reference_string"], "language": row["reference_language"]},
            "vote": row["vote"],
            "claim": {"text": row["claim"], "language": row["claim_language"]},
        })
        gold.append({
            "id": case_id,
            "label": int(row["entailment_label"]),
            "reference_language": row["reference_language"],
            "claim_language": row["claim_language"],
            "booklet_url": row.get("booklet_url"),
        })
    write_jsonl(args.cases, cases)
    write_jsonl(args.gold, gold)
    print(json.dumps({
        "dataset_sha256": hashlib.sha256(raw).hexdigest(),
        "rows": len(cases),
        "cases": str(args.cases),
        "gold": str(args.gold),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
