"""File-based metadata intake, resumable reviews and offline reports."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .core import CareRelayError
from .review_page import export_page_bundle, render_paged, render_review
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
    report.add_argument("--page", type=int, help="single replay-validated page (default: legacy full report)")
    report.add_argument("--page-size", type=int, default=100, help="proposal and quiet-event rows per page")
    report.add_argument("--status", choices=("all", "pending", "approved", "rejected"), default="all")
    report.add_argument("--classification", help="exact source-observed event classification")
    report.add_argument("--event-type", help="exact source-observed event type")
    report.add_argument("--summary", action="store_true", help="aggregate table, no event cards")
    report.add_argument("--all-pages", action="store_true",
                        help="--out names a NEW directory; export all linked static HTML pages")
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
                if args.all_pages and (args.page is not None or args.summary):
                    raise CareRelayError("--all-pages cannot combine with --page or --summary")
                selection = (args.status != "all" or args.classification is not None or
                             args.event_type is not None or args.page_size != 100)
                if args.all_pages:
                    export_page_bundle(result, args.out, size=args.page_size,
                                       status=args.status, classification=args.classification,
                                       kind=args.event_type)
                elif args.page is not None or args.summary or selection:
                    publish_new(args.out, render_paged(result, page=(args.page if args.page is not None else 1),
                                size=args.page_size, status=args.status,
                                classification=args.classification, kind=args.event_type,
                                summary=args.summary))
                else:
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
        if args.command == "report" and (
                args.page is not None or args.all_pages or args.summary or
                args.status != "all" or args.classification is not None or
                args.event_type is not None or args.page_size != 100):
            # A 5000-event paged HTML export must not still print thousands of
            # sensitive per-event rows on stdout. Keep exact full inspect semantics.
            summary["pending_total"] = len(summary.pop("pending"))
            summary["events_without_proposal_total"] = len(summary.pop("events_without_proposal"))
            summary["report_page"] = args.page if args.page is not None else (None if args.summary else 1)
            summary["report_all_pages"] = args.all_pages
            summary["report_status"] = args.status
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
