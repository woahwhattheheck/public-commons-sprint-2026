"""File-based metadata intake, resumable reviews and offline reports."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .core import CareRelayError
from .review_page import render_review
from .paged_review import build_report_pages, page_names, PAGE_SIZES, REVIEW_STATES
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
    report.add_argument("--pages", action="store_true", help="export linked, static HTML pages")
    report.add_argument("--summary", action="store_true", help="export only source-derived totals")
    report.add_argument("--size", type=int, choices=PAGE_SIZES, default=100)
    report.add_argument("--status", choices=REVIEW_STATES, default="all")
    report.add_argument("--classification", help="exact event classification")
    report.add_argument("--kind", help="exact event type")
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
                if args.pages and args.summary:
                    raise CareRelayError("--pages and --summary are alternatives")
                filtered = (args.status != "all" or args.classification is not None
                            or args.kind is not None)
                if args.pages or args.summary:
                    pages = build_report_pages(
                        result, filename=args.out.name, size=args.size,
                        status=args.status, classification=args.classification,
                        kind=args.kind, summary=args.summary)
                    paths = [args.out.with_name(name)
                             for name in page_names(args.out.name, len(pages))]
                    if any(path.exists() for path in paths):
                        raise CareRelayError("a report bundle path already exists; choose a new version")
                    # All HTML bytes are computed before any immutable file is published.
                    for path, payload in zip(paths, pages):
                        publish_new(path, payload)
                else:
                    if filtered or args.size != 100:
                        raise CareRelayError("filters and custom size require --pages or --summary")
                    publish_new(args.out, render_review(result))
        state = result["state"]
        reviewed = {r["proposal_id"] for r in state["approvals"]}
        proposed_events = {p["event_id"] for p in state["proposals"]}
        summary = {"state_sha256": result["receipt"]["state_sha256"],
                   "source": result["receipt"]["source"], "events": len(state["events"]),
                   "proposals": len(state["proposals"]), "reviews": len(state["approvals"]),
                   "pending": [{"proposal_id": p["proposal_id"], "action": p["action"],
                                "event_id": p["event_id"]} for p in state["proposals"]
                               if p["proposal_id"] not in reviewed],
                   "events_without_proposal": [
                       {key: e[key] for key in ("event_id", "device_id", "occurred_at", "event_type", "classification")}
                       for e in state["events"] if e["event_id"] not in proposed_events],
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
