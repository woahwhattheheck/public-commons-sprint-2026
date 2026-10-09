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
                  ("Zone", event["zone"] or "Not supplied"), ("Reviewer label", reviewer))
        definition = "".join(f"<dt>{label}</dt><dd>{escape(value)}</dd>" for label, value in fields)
        cards.append(f"<article><h2>{escape(proposal['action'].replace('_', ' ').capitalize())}</h2>"
                     f"<p class='status'>{escape(decision)}</p><p>{escape(proposal['rationale'])}</p>"
                     f"<dl>{definition}</dl></article>")
    if not cards:
        cards.append("<p>No proposals require review for these events.</p>")
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
Reviewer labels are not authenticated identities. Use the workbench review command to record an actual decision.</p>
<p>No video, credentials, scripts, trackers, external requests or interactive approval controls are included.</p></aside>
<main>{''.join(cards)}</main><footer><p>State SHA-256: <code>{digest}</code></p>
<p>Provider execution, external actions, contest submission, award and payment remain unverified.</p></footer></body></html>
"""
    return html.encode("utf-8")
