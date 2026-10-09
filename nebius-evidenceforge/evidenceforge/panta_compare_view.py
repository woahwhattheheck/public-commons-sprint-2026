"""Standalone, escaped judge view for digest-linked read-only Panta page changes."""
from __future__ import annotations

import html
from typing import Any


def _h(value: Any) -> str:
    return html.escape(str(value), quote=True)


def render_comparison_page(report: dict) -> str:
    """Display one internally validated comparison without claiming live provenance."""
    body = []
    for market in report["changedMarkets"]:
        lines = []
        for field, values in market["fields"].items():
            delta = (f' (delta {_h(values["delta"])})'
                     if values.get("delta") is not None else "")
            lines.append(
                f'<li><strong>{_h(field)}:</strong> '
                f'{_h(values["before"])} → {_h(values["after"])}{delta}</li>'
            )
        body.append(
            f'<article class="card"><h3>{_h(market["marketId"])}</h3>'
            f'<ul>{"".join(lines)}</ul></article>'
        )
    if not body:
        body = ['<p>No recorded field changes for markets present in both pages.</p>']
    appeared = ", ".join(_h(m) for m in report["appearedInAfterPage"]) or "None"
    absent = ", ".join(_h(m) for m in report["absentFromAfterPage"]) or "None"
    partial = ("Yes — cursor present on at least one page"
               if report["paginationMayHideMarkets"] else
               "No cursor on either captured page")
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EvidenceForge × Panta · Capture comparison</title>
<style>
:root{{font-family:system-ui,sans-serif;background:#0c1521;color:#f1f7ff}}
body{{max-width:950px;margin:2rem auto;padding:0 1rem;line-height:1.5}}
.card{{border:1px solid #405875;background:#17273a;padding:1rem 1.25rem;
border-radius:10px;margin:1rem 0}}
a{{color:#9ad1ff}} .muted{{color:#b5c7d9}}code{{word-break:break-all}}
h1{{font-size:clamp(1.6rem,4vw,2.5rem)}}ul{{padding-left:1.5rem}}
.warning{{border-left:5px solid #e8ba74}}
</style></head><body>
<p><a href="/">EvidenceForge</a> / <a href="/panta">Single capture</a> / Compare</p>
<h1>Market capture changes</h1>
<div class="card warning"><strong>Operator-ordered offline capture comparison.</strong>
This view authenticates neither API response provenance nor capture timestamps.
No quotes, trade decisions, market listings/delistings, wallets, payments or prizes
are verified. The data may be synthetic.</div>
<div class="card"><h2>Evidence receipts</h2>
<p>Before snapshot: <code>{_h(report["beforeSnapshotSha256"])}</code></p>
<p>After snapshot: <code>{_h(report["afterSnapshotSha256"])}</code></p>
<p>Comparison digest: <code>{_h(report["comparisonSha256"])}</code></p>
<p class="muted">Source: {_h(report["source"])}. Pagination: {_h(partial)}.</p>
<p><a href="/api/panta-compare">Inspect complete comparison JSON</a></p></div>
<div class="card"><h2>Page membership, not market creation/delisting</h2>
<p>Markets present in both pages: {_h(report["matchedMarkets"])}</p>
<p>Appeared in after CAPTURED PAGE: {appeared}</p>
<p>Absent from after CAPTURED PAGE: {absent}</p>
</div>
<h2>Changes among matched markets ({_h(len(report["changedMarkets"]))})</h2>
{"".join(body)}
</body></html>'''
