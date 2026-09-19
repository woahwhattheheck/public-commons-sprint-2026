from __future__ import annotations

import argparse
from pathlib import Path

from .agent import load_corpus, load_json, run_loaded, validate_task
from .house import plan

VERB = "analyze"


def main() -> int:
    parser = argparse.ArgumentParser(description="Agenthon 2026 Track 4 grounded-finance candidate")
    parser.add_argument("verb", nargs="?", default=VERB, choices=[VERB])
    parser.add_argument("--task", required=True, type=Path)
    parser.add_argument("--corpus", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--offline", action="store_true", help="Disable House-route planning and use deterministic fallback only")
    args = parser.parse_args()
    # Freeze exactly one validated task/corpus generation. House planning and final
    # deterministic citations must consume the same in-memory evidence snapshot.
    task = validate_task(load_json(args.task))
    docs = load_corpus(args.corpus, task["cutoff_date"])
    model_candidates = None if args.offline else plan(task, docs)
    run_loaded(task, docs, args.out, model_candidates=model_candidates)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
