"""Offline, script-free and escaped proposal review report."""
from __future__ import annotations

from html import escape
from typing import Any

from .workspace import restore


def render_review(workspace: dict[str, Any]) -> bytes:
    relay, source = restore(workspace)
    state = relay.snapshot()
    events = {row["event_id"]: row for row in state["events"]}
    reviews = {row["proposal_id"]: row for row in state["approvals"]}
    cards = []
    for proposal in state["proposals"]:
        event = events[proposal["event_id"]]
        review = reviews.get(proposal["proposal_id"])
        decision = "Pending review" if review is None else review["decision"].capitalize()
        reviewer = "Not recorded" if review is None else review["approver"]
        fields = (("Proposal ID", proposal["proposal_id"]), ("Event ID", event["event_id"]),
                  ("Device", event["device_id"]), ("Occurred at", event["occurred_at"]),
                  ("Event type", event["event_type"].replace("_", " ")),
                  ("Classification", event["classification"]),
                  ("Device health", event["device_health"] or "Not reported"),
                  ("Zone", event["zone"] or "Not supplied"), ("Reviewer label", reviewer))
        definition = "".join(f"<dt>{label}</dt><dd>{escape(value)}</dd>" for label, value in fields)
        cards.append(f"<article><h2>{escape(proposal['action'].replace('_', ' ').capitalize())}</h2>"
                     f"<p class='status'>{escape(decision)}</p><p>{escape(proposal['rationale'])}</p>"
                     f"<dl>{definition}</dl></article>")
    if not cards:
        cards.append("<p>No proposals require review for these events.</p>")
    proposed_events = {row["event_id"] for row in state["proposals"]}
    quiet_events = [row for row in state["events"] if row["event_id"] not in proposed_events]
    timeline = []
    for event in quiet_events:
        fields = (("Event ID", event["event_id"]), ("Device", event["device_id"]),
                  ("Occurred at", event["occurred_at"]),
                  ("Event type", event["event_type"].replace("_", " ")),
                  ("Classification", event["classification"]),
                  ("Device health", event["device_health"] or "Not reported"),
                  ("Zone", event["zone"] or "Not supplied"))
        definition = "".join(f"<dt>{label}</dt><dd>{escape(value)}</dd>" for label, value in fields)
        timeline.append(f"<article><h3>{escape(event['event_type'].replace('_', ' ').capitalize())}</h3>"
                        f"<p>No proposal generated</p><dl>{definition}</dl></article>")
    activity = ("<section aria-labelledby='activity-title'><h2 id='activity-title'>Events without a proposal</h2>"
                "<p>These events were retained, but the current policy generated no proposal. "
                "An unknown classification is not evidence of a person or an absence of activity. "
                "No review decision or external action is implied.</p>" + "".join(timeline) + "</section>") if timeline else ""
    pending = len(state["proposals"]) - len(state["approvals"])
    digest = workspace["receipt"]["state_sha256"]
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>CareRelay — event review</title><style>
body{{font:1rem/1.6 system-ui,sans-serif;max-width:58rem;margin:2rem auto;padding:0 1rem;color:#172330;background:#f4f7fa}}
h1{{line-height:1.2}} h2{{font-size:1.3rem}} article,.notice{{background:white;border:1px solid #bcc8d4;padding:1.2rem;margin:1rem 0;border-radius:.4rem}}
.status{{font-weight:700}} dl{{display:grid;grid-template-columns:10rem 1fr;gap:.3rem}} dt{{font-weight:650}} dd{{margin:0;overflow-wrap:anywhere}}
code{{overflow-wrap:anywhere}} @media(max-width:36rem){{dl{{display:block}}dd{{margin-bottom:.5rem}}}}
@media print{{body{{background:white}}article{{break-inside:avoid}}}}
</style></head><body><header><h1>CareRelay event review</h1>
<p>{len(state['events'])} events · {len(state['proposals'])} proposals · {pending} pending</p></header>
<aside class="notice"><strong>Review copy — no actions are executed.</strong>
<p>Source label: <strong>{escape(source)}</strong>. This label is an operator declaration, not proof of a Ring session.
Event classifications and health values are source-observed labels, not independent verification. Reviewer labels are not authenticated identities. Use the workbench review command to record an actual decision.</p>
<p>No video, credentials, scripts, trackers, external requests or interactive approval controls are included.</p></aside>
<main>{''.join(cards)}{activity}</main><footer><p>State SHA-256: <code>{digest}</code></p>
<p>Provider execution, external actions, contest submission, award and payment remain unverified.</p></footer></body></html>
"""
    return html.encode("utf-8")


# Keep render_review above byte-for-byte compatible with earlier report callers.
# The opt-in pages below restore the genuine, immutable workspace once per export;
# no simulation policy, approval state or provider authority changes.
from collections import Counter
import os
from pathlib import Path
import re

from .core import CareRelayError


def _page_options(page, size, status, classification, kind):
    if type(page) is not int or page < 1 or type(size) is not int or not 1 <= size <= 1000:
        raise CareRelayError("page must be positive and size must be 1..1000")
    if status not in {"all", "pending", "approved", "rejected"}:
        raise CareRelayError("unsupported review status")
    for value in (classification, kind):
        if value is not None and (type(value) is not str or
                                  re.fullmatch(r"[a-z][a-z0-9_]{0,63}", value) is None):
            raise CareRelayError("invalid classification or event type")


def _page_data(state, *, size, status, classification, kind):
    events = {event["event_id"]: event for event in state["events"]}
    reviewed = {row["proposal_id"]: row for row in state["approvals"]}
    proposed = {p["event_id"] for p in state["proposals"]}

    def matches(event):
        return ((classification is None or event["classification"] == classification) and
                (kind is None or event["event_type"] == kind))

    proposals = []
    for proposal in state["proposals"]:
        event = events[proposal["event_id"]]
        review = reviewed.get(proposal["proposal_id"])
        outcome = "pending" if review is None else review["decision"]
        if (status == "all" or outcome == status) and matches(event):
            proposals.append((proposal, event, review))
    quiet = ([event for event in state["events"]
              if event["event_id"] not in proposed and matches(event)]
             if status == "all" else [])
    total_pages = max(1, (max(len(proposals), len(quiet)) + size - 1) // size)
    return proposals, quiet, total_pages


def _card(proposal, event, review):
    decision = "Pending review" if review is None else review["decision"].capitalize()
    reviewer = "Not recorded" if review is None else review["approver"]
    fields = (("Proposal ID", proposal["proposal_id"]), ("Event ID", event["event_id"]),
              ("Device", event["device_id"]), ("Occurred at", event["occurred_at"]),
              ("Event type", event["event_type"].replace("_", " ")),
              ("Classification", event["classification"]),
              ("Device health", event["device_health"] or "Not reported"),
              ("Zone", event["zone"] or "Not supplied"), ("Reviewer label", reviewer))
    definition = "".join(f"<dt>{label}</dt><dd>{escape(value)}</dd>" for label, value in fields)
    return (f"<article><h2>{escape(proposal['action'].replace('_', ' ').capitalize())}</h2>"
            f"<p class='status'>{escape(decision)}</p><p>{escape(proposal['rationale'])}</p>"
            f"<dl>{definition}</dl></article>")


def _quiet_card(event):
    fields = (("Event ID", event["event_id"]), ("Device", event["device_id"]),
              ("Occurred at", event["occurred_at"]),
              ("Event type", event["event_type"].replace("_", " ")),
              ("Classification", event["classification"]),
              ("Device health", event["device_health"] or "Not reported"),
              ("Zone", event["zone"] or "Not supplied"))
    definition = "".join(f"<dt>{label}</dt><dd>{escape(value)}</dd>" for label, value in fields)
    return (f"<article><h3>{escape(event['event_type'].replace('_', ' ').capitalize())}</h3>"
            f"<p>No proposal generated</p><dl>{definition}</dl></article>")


def _summary_table(title, counts):
    rows = "".join(f"<tr><th scope='row'>{escape(str(label))}</th><td>{amount}</td></tr>"
                   for label, amount in sorted(counts.items()))
    return f"<section><h2>{escape(title)}</h2><table><thead><tr><th>Group</th><th>Count</th></tr></thead><tbody>{rows}</tbody></table></section>"


def _preamble(source, digest, state, title, explanation):
    pending = len(state["proposals"]) - len(state["approvals"])
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>CareRelay — {escape(title)}</title><style>
body{{font:1rem/1.6 system-ui,sans-serif;max-width:58rem;margin:2rem auto;padding:0 1rem;color:#172330;background:#f4f7fa}}
h1{{line-height:1.2}}h2{{font-size:1.3rem}} article,.notice,section.stats{{background:white;border:1px solid #bcc8d4;padding:1.2rem;margin:1rem 0;border-radius:.4rem}}
.status{{font-weight:700}}dl{{display:grid;grid-template-columns:10rem 1fr;gap:.3rem}}dt{{font-weight:650}}dd{{margin:0;overflow-wrap:anywhere}}
code{{overflow-wrap:anywhere}}a{{margin-right:.8rem}}table{{border-collapse:collapse}}td,th{{padding:.25rem 1rem;border:1px solid #bcc8d4;text-align:left}}
@media(max-width:36rem){{dl{{display:block}}dd{{margin-bottom:.5rem}}}}
@media print{{body{{background:white}}article{{break-inside:avoid}}}}
</style></head><body><header><h1>CareRelay — {escape(title)}</h1>
<p>{len(state['events'])} events · {len(state['proposals'])} proposals · {pending} pending</p>
<p>{escape(explanation)}</p></header>
<aside class="notice"><strong>Read-only review copy — no actions are executed.</strong>
<p>Source label: <strong>{escape(source)}</strong>; this is an operator declaration, not Ring authentication.
Reviewer, classification and device-health labels are unverified source metadata.
Use the workbench review command for an explicit decision. No scripts, forms or external requests.</p></aside>
"""


def _footer(digest):
    return (f"<footer><p>State SHA-256: <code>{escape(digest)}</code></p>"
            "<p>Provider execution, external actions, contest submission, award and payment remain unverified."
            "</p></footer></body></html>\n")


def _render_page_from_state(state, source, digest, *, page, size, status, classification,
                            kind, linked=False):
    proposals, quiet, total_pages = _page_data(
        state, size=size, status=status, classification=classification, kind=kind)
    if page > total_pages:
        raise CareRelayError("page exceeds matching result count")
    offset = (page - 1) * size
    visible = proposals[offset:offset + size]
    visible_quiet = quiet[offset:offset + size]
    explanation = (f"Page {page} of {total_pages} · {len(proposals)} matching proposals · "
                   f"{len(quiet)} matching events without proposals · "
                   f"showing {len(visible)} proposals and {len(visible_quiet)} other events.")
    head = _preamble(source, digest, state, "paged event review", explanation)
    if linked:
        anchors = [("First", 1), ("Previous", page - 1), ("Next", page + 1),
                   ("Last", total_pages)]
        nav = "".join(f'<a href="page-{n:04d}.html">{label}</a>'
                      for label, n in anchors if 1 <= n <= total_pages and n != page)
        head += f'<nav aria-label="Report pages">{nav}<span>Page {page} of {total_pages}</span></nav>'
    else:
        head += "<p>To open another page, export it with --page NUMBER or create a complete --all-pages bundle.</p>"
    cards = "".join(_card(*row) for row in visible)
    if not cards:
        cards = "<p>No proposals match this view.</p>"
    activity = ""
    if visible_quiet:
        activity = ("<section aria-labelledby='activity-title'><h2 id='activity-title'>Events without a proposal</h2>"
                    "<p>These observations produced no proposed action; unknown classifications do not imply absence of activity.</p>"
                    + "".join(_quiet_card(row) for row in visible_quiet) + "</section>")
    return (head + "<main>" + cards + activity + "</main>" + _footer(digest)).encode("utf-8")


def _summary_from_state(state, source, digest, *, size=100, status="all",
                        classification=None, kind=None):
    """Use the same validated selection as the review pages, not global totals."""
    selected, quiet, _ = _page_data(
        state, size=size, status=status, classification=classification, kind=kind)
    statuses = Counter("pending" if review is None else review["decision"]
                       for _, _, review in selected)
    classes = Counter(event["classification"] for _, event, _ in selected)
    kinds = Counter(event["event_type"] for _, event, _ in selected)
    summary = (_summary_table("Proposal decisions", statuses) +
               _summary_table("Proposal event classifications", classes) +
               _summary_table("Proposal event types", kinds) +
               f"<p>{len(selected)} matching proposals · {len(quiet)} matching events "
               "without proposals.</p>")
    selection = ("status=" + status +
                 (f", classification={classification}" if classification is not None else "") +
                 (f", event type={kind}" if kind is not None else ""))
    head = _preamble(source, digest, state, "workspace summary",
                     f"Selected rows: {selection}. Whole-workspace totals above remain unchanged. "
                     "Aggregate counts from replay-validated source, not provider verification.")
    return (head + "<main>" + summary + "</main>" + _footer(digest)).encode("utf-8")


def render_paged(workspace, *, page=1, size=100, status="all", classification=None,
                 kind=None, summary=False):
    """One bounded standalone HTML page or compact aggregate summary; never mutate state."""
    _page_options(page, size, status, classification, kind)
    relay, source = restore(workspace)
    state = relay.snapshot()
    digest = workspace["receipt"]["state_sha256"]
    if summary:
        return _summary_from_state(state, source, digest, size=size, status=status,
                                   classification=classification, kind=kind)
    return _render_page_from_state(state, source, digest, page=page, size=size, status=status,
                                   classification=classification, kind=kind)


def export_page_bundle(workspace, directory: Path, *, size=100, status="all",
                       classification=None, kind=None) -> int:
    """Create an entirely new offline folder with *working* static next/prev links.

    Genuine workspace replay occurs once for all pages; no fake ?page= URLs, server,
    auto-review, or network. Destination must not exist.
    """
    _page_options(1, size, status, classification, kind)
    relay, source = restore(workspace)
    state = relay.snapshot()
    digest = workspace["receipt"]["state_sha256"]
    _, _, total_pages = _page_data(state, size=size, status=status,
                                    classification=classification, kind=kind)
    directory.mkdir(mode=0o700, parents=False, exist_ok=False)
    # Reuse the existing no-clobber fsync+hardlink publisher for every page.
    from .workspace import publish_new
    for page in range(1, total_pages + 1):
        rendered = _render_page_from_state(state, source, digest, page=page, size=size,
                                           status=status, classification=classification,
                                           kind=kind, linked=True)
        publish_new(directory / f"page-{page:04d}.html", rendered)
    publish_new(directory / "summary.html", _summary_from_state(
        state, source, digest, size=size, status=status,
        classification=classification, kind=kind))
    return total_pages
