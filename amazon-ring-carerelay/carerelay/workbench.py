"""File-based metadata intake, resumable reviews and offline reports."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .core import CareRelayError
from .review_page import render_review
from .workspace import SOURCES, apply_reviews, import_events, load_workspace, publish_new, save_workspace


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    ingest = commands.add_parser("import", help="import JSONL events into a new immutable workspace")
    ingest.add_argument("events", type=Path)
    ingest.add_argument("--resume", type=Path)
    ingest.add_argument("--source", choices=SOURCES)
    ingest.add_argument("--out", required=True, type=Path)
    review = commands.add_parser("review", help="record explicit JSONL review decisions")
    review.add_argument("workspace", type=Path)
    review.add_argument("decisions", type=Path)
    review.add_argument("--out", required=True, type=Path)
    inspect = commands.add_parser("inspect", help="validate by replay and print the pending queue as JSON")
    inspect.add_argument("workspace", type=Path)
    report = commands.add_parser("report", help="export a script-free offline HTML review copy")
    report.add_argument("workspace", type=Path)
    report.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "import":
            previous = load_workspace(args.resume) if args.resume else None
            result = import_events(args.events, previous=previous, source=args.source)
            save_workspace(args.out, result)
        elif args.command == "review":
            result = apply_reviews(load_workspace(args.workspace), args.decisions)
            save_workspace(args.out, result)
        else:
            result = load_workspace(args.workspace)
            if args.command == "report":
                publish_new(args.out, render_review(result))
        state = result["state"]
        reviewed = {r["proposal_id"] for r in state["approvals"]}
        summary = {"state_sha256": result["receipt"]["state_sha256"],
                   "source": result["receipt"]["source"], "events": len(state["events"]),
                   "proposals": len(state["proposals"]), "reviews": len(state["approvals"]),
                   "pending": [{"proposal_id": p["proposal_id"], "action": p["action"],
                                "event_id": p["event_id"]} for p in state["proposals"]
                               if p["proposal_id"] not in reviewed],
                   "authority": state["authority"]}
        print(json.dumps(summary, sort_keys=True))
        return 0
    except CareRelayError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except OSError:
        print("ERROR: file operation failed; verify paths, permissions and hard-link support", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
