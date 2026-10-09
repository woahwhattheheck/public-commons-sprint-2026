"""Static, read-only multi-page CareRelay review bundles from a replay-verified workspace.

Every navigation link targets a file exported with the bundle. No JavaScript,
server, Ring endpoint, approval mutation, or untrusted query execution is used.
"""
from __future__ import annotations

from collections import Counter
from html import escape
from pathlib import Path
from typing import Any
from urllib.parse import quote

from .core import CareRelayError
from .workspace import restore

PAGE_SIZES = (25, 50, 100, 500, 1000)
REVIEW_STATES = ("all", "pending", "approved", "rejected")


def page_names(filename: str, count: int) -> list[str]:
    """The first page is the requested path; later pages are its siblings."""
    path = Path(filename)
    if count < 1 or path.name != filename:
        raise CareRelayError("invalid report bundle filename or page count")
    return [filename] + [f"{path.stem}-p{n:03d}{path.suffix}" for n in range(2, count + 1)]


def _html(value: Any) -> str:
    return escape(str(value), quote=True)


def _fields(values: tuple[tuple[str, Any], ...]) -> str:
    return "<dl>" + "".join(f"<dt>{_html(key)}</dt><dd>{_html(value)}</dd>"
                            for key, value in values) + "</dl>"


def _proposal_card(proposal: dict, event: dict, review: dict | None) -> str:
    decision = "Pending review" if review is None else review["decision"].capitalize()
    reviewer = "Not recorded" if review is None else review["approver"]
    fields = (("Proposal ID", proposal["proposal_id"]), ("Event ID", event["event_id"]),
              ("Device", event["device_id"]), ("Occurred at", event["occurred_at"]),
              ("Event type", event["event_type"].replace("_", " ")),
              ("Classification", event["classification"]),
              ("Device health", event["device_health"] or "Not reported"),
              ("Zone", event["zone"] or "Not supplied"), ("Reviewer label", reviewer))
    return (f"<article><h3>{_html(proposal['action'].replace('_', ' ').capitalize())}</h3>"
            f"<p class='status'>{_html(decision)}</p><p>{_html(proposal['rationale'])}</p>"
            + _fields(fields) + "</article>")


def _quiet_card(event: dict) -> str:
    fields = (("Event ID", event["event_id"]), ("Device", event["device_id"]),
              ("Occurred at", event["occurred_at"]),
              ("Event type", event["event_type"].replace("_", " ")),
              ("Classification", event["classification"]),
              ("Device health", event["device_health"] or "Not reported"),
              ("Zone", event["zone"] or "Not supplied"))
    return (f"<article><h3>{_html(event['event_type'].replace('_', ' ').capitalize())}</h3>"
            "<p>No proposal generated</p>" + _fields(fields) + "</article>")


def _navigation(names: list[str], index: int) -> str:
    if len(names) == 1:
        return "<p>Page 1 of 1</p>"
    parts = [f"<span>Page {index + 1} of {len(names)}</span>"]
    targets = (("First", 0), ("Previous", index - 1),
               ("Next", index + 1), ("Last", len(names) - 1))
    for label, target in targets:
        if target < 0 or target >= len(names) or target == index:
            continue
        href = quote(names[target], safe="-_.~")
        parts.append(f"<a href='{_html(href)}'>{label}</a>")
    return "<nav aria-label='Report pages'>" + " · ".join(parts) + "</nav>"


def _shell(*, state: dict, workspace: dict, source: str, heading: str,
           matched_proposals: int, matched_quiet: int, filters: str,
           body: str, navigation: str = "") -> bytes:
    pending = len(state["proposals"]) - len(state["approvals"])
    digest = workspace["receipt"]["state_sha256"]
    document = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>CareRelay — {_html(heading)}</title><style>
body{{font:1rem/1.6 system-ui,sans-serif;max-width:58rem;margin:2rem auto;padding:0 1rem;color:#172330;background:#f4f7fa}}
article,.notice,section.summary{{background:white;border:1px solid #bcc8d4;padding:1.2rem;margin:1rem 0;border-radius:.4rem}}
h1{{line-height:1.2}}h2{{font-size:1.3rem}}.status{{font-weight:700}}
dl{{display:grid;grid-template-columns:10rem 1fr;gap:.3rem}}dt{{font-weight:650}}dd{{margin:0;overflow-wrap:anywhere}}
nav{{margin:1rem 0}}nav a{{margin-right:.7rem}}code{{overflow-wrap:anywhere}}
@media(max-width:36rem){{dl{{display:block}}dd{{margin-bottom:.5rem}}}}
@media print{{body{{background:white}}article{{break-inside:avoid}}}}
</style></head><body><header><h1>CareRelay {_html(heading)}</h1>
<p>{len(state['events'])} events · {len(state['proposals'])} proposals · {pending} pending (whole workspace)</p>
<p>{matched_proposals} matching proposals · {matched_quiet} matching quiet events; {_html(filters)}</p></header>
<aside class="notice"><strong>Review copy — no actions are executed.</strong>
<p>Source label: <strong>{_html(source)}</strong>. This is an operator declaration, not proof of a Ring session.
Classification and health values are source-observed labels, not independent verification. Reviewer labels are not authenticated identities.
Use the workbench review command to record an actual decision.</p>
<p>No video, credentials, scripts, trackers, external requests or interactive approval controls are included.</p></aside>
{navigation}<main>{body}</main>{navigation}
<footer><p>State SHA-256: <code>{_html(digest)}</code></p>
<p>Provider execution, external actions, contest submission, award and payment remain unverified.</p></footer></body></html>
"""
    return document.encode("utf-8")


def build_report_pages(workspace: dict[str, Any], *, filename: str,
                       size: int = 100, status: str = "all",
                       classification: str | None = None, kind: str | None = None,
                       summary: bool = False) -> list[bytes]:
    """Validate once, select exact source rows, then export linked static pages.

    The two sections use the SAME page number. The number of pages is the
    larger of proposal and quiet-event page counts, so no quiet events vanish
    after the final proposal page. Status filters apply to proposals; the
    quiet timeline appears only for status=all. Counts are unpaginated.
    """
    if size not in PAGE_SIZES:
        raise CareRelayError("page size must be one of 25, 50, 100, 500, 1000")
    if status not in REVIEW_STATES:
        raise CareRelayError("invalid proposal status filter")
    for value in (classification, kind):
        if value is not None and (not value or len(value) > 64):
            raise CareRelayError("invalid event filter")
    relay, source = restore(workspace)
    state = relay.snapshot()
    events = {e["event_id"]: e for e in state["events"]}
    reviews = {r["proposal_id"]: r for r in state["approvals"]}

    def event_matches(event: dict) -> bool:
        return ((classification is None or event["classification"] == classification)
                and (kind is None or event["event_type"] == kind))

    matched: list[tuple[dict, dict, dict | None]] = []
    proposed_ids = set()
    for proposal in state["proposals"]:
        event = events[proposal["event_id"]]
        proposed_ids.add(event["event_id"])
        review = reviews.get(proposal["proposal_id"])
        decision = "pending" if review is None else review["decision"]
        if event_matches(event) and (status == "all" or status == decision):
            matched.append((proposal, event, review))
    quiet = ([e for e in state["events"]
              if e["event_id"] not in proposed_ids and event_matches(e)]
             if status == "all" else [])
    filters = "status=" + status
    if classification is not None:
        filters += " · classification=" + classification
    if kind is not None:
        filters += " · event type=" + kind

    if summary:
        statuses = Counter("pending" if review is None else review["decision"]
                           for _, _, review in matched)
        classes = Counter(event["classification"] for _, event, _ in matched)
        kinds = Counter(event["event_type"] for _, event, _ in matched)
        body = ["<section class='summary'><h2>Selected review summary</h2>",
                _fields((("Pending proposals", statuses["pending"]),
                         ("Approved proposals", statuses["approved"]),
                         ("Rejected proposals", statuses["rejected"]),
                         ("Quiet events", len(quiet))))]
        for title, counts in (("Classification", classes), ("Event type", kinds)):
            body.append(f"<h3>{_html(title)}</h3>")
            body.append(_fields(tuple(sorted(counts.items()))) if counts else "<p>No matches.</p>")
        body.append("</section>")
        return [_shell(state=state, workspace=workspace, source=source,
                       heading="review summary", matched_proposals=len(matched),
                       matched_quiet=len(quiet), filters=filters,
                       body="".join(body))]

    count = max(1, (len(matched) + size - 1) // size,
                (len(quiet) + size - 1) // size)
    names = page_names(filename, count)
    results = []
    for index in range(count):
        lower, upper = index * size, (index + 1) * size
        proposals_html = "".join(_proposal_card(*row) for row in matched[lower:upper])
        quiet_html = "".join(_quiet_card(event) for event in quiet[lower:upper])
        if not proposals_html:
            proposals_html = "<p>No matching proposals on this page.</p>"
        if not quiet_html:
            quiet_html = "<p>No matching quiet events on this page.</p>"
        body = ("<section aria-labelledby='proposals-title'><h2 id='proposals-title'>Human review proposals</h2>"
                + proposals_html + "</section>"
                "<section aria-labelledby='activity-title'><h2 id='activity-title'>Events without a proposal</h2>"
                "<p>These events are retained without any proposed action. Unknown classification is not evidence of a person.</p>"
                + quiet_html + "</section>")
        results.append(_shell(state=state, workspace=workspace, source=source,
                              heading="event review", matched_proposals=len(matched),
                              matched_quiet=len(quiet), filters=filters, body=body,
                              navigation=_navigation(names, index)))
    return results
