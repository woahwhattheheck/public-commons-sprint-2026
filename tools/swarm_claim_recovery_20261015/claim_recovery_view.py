"""Self-contained industrial HTML operator desk."""

from __future__ import annotations

import html
from typing import Any, Mapping, Sequence

from claim_recovery_core import Thresholds

def render_html(
    operations: Sequence[Mapping[str, Any]], generated_at: str, thresholds: Thresholds
) -> str:
    counts: dict[str, int] = {}
    for item in operations:
        counts[item["classification"]] = counts.get(item["classification"], 0) + 1

    count_order = [
        "active",
        "watch",
        "recovery_candidate",
        "abandoned",
        "blocked",
        "complete",
        "released",
    ]
    cards = "".join(
        f'<section class="metric"><strong>{counts.get(name, 0)}</strong><span>{html.escape(name.replace("_", " "))}</span></section>'
        for name in count_order
    )
    anomaly_total = sum(int(item.get("anomaly_count", 0)) for item in operations)
    cards += (
        f'<section class="metric"><strong>{anomaly_total}</strong>'
        '<span>event anomalies</span></section>'
    )

    rows: list[str] = []
    for item in operations:
        source = item["source_ref"] or ""
        if source.startswith(("https://", "http://")):
            source_html = (
                f'<a href="{html.escape(source, quote=True)}" rel="noreferrer">source</a>'
            )
        elif source:
            source_html = f"<code>{html.escape(source)}</code>"
        else:
            source_html = "—"
        checkpoint = "ready" if item["recovery_ready"] else "none"
        summary = html.escape(item["summary"] or "")
        rows.append(
            "<tr "
            f'data-search="{html.escape((item["operation_id"] + " " + str(item["owner"] or "") + " " + item["classification"] + " " + (item["summary"] or "")).lower(), quote=True)}">'
            f'<td><span class="state">{html.escape(item["classification"])}</span></td>'
            f'<td class="num">{int(item["age_minutes"])}</td>'
            f'<td class="num">{int(item["generation"])}</td>'
            f'<td class="num">{int(item.get("anomaly_count", 0))}</td>'
            f'<td>{html.escape(str(item["owner"] or "—"))}</td>'
            f'<td><strong>{html.escape(item["operation_id"])}</strong><small>{summary}</small></td>'
            f'<td>{checkpoint}</td>'
            f'<td><time>{html.escape(item["last_seen_at"] or "—")}</time></td>'
            f'<td>{source_html}</td>'
            f'<td>{html.escape(item["next_action"])}</td>'
            "</tr>"
        )

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Swarm Claim Recovery Desk</title>
<style>
:root {{ color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: #f4f4f2; color: #171717; }}
main {{ max-width: 1500px; margin: 0 auto; padding: 28px; }}
header {{ display: flex; justify-content: space-between; gap: 24px; align-items: end; border-bottom: 2px solid #171717; padding-bottom: 18px; }}
h1 {{ font-size: clamp(1.5rem, 2vw, 2.2rem); margin: 0; letter-spacing: -0.025em; }}
header p {{ margin: 6px 0 0; color: #505050; max-width: 74ch; }}
.meta {{ font: 0.82rem ui-monospace, SFMono-Regular, Menlo, monospace; text-align: right; white-space: nowrap; }}
.metrics {{ display: grid; grid-template-columns: repeat(8, minmax(105px, 1fr)); border: 1px solid #b7b7b2; border-bottom: 0; margin-top: 24px; background: #fff; }}
.metric {{ min-height: 84px; padding: 14px; border-right: 1px solid #d2d2cd; }}
.metric:last-child {{ border-right: 0; }}
.metric strong {{ display: block; font-size: 1.65rem; line-height: 1; }}
.metric span {{ display: block; margin-top: 9px; color: #555; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; }}
.controls {{ display: flex; gap: 12px; align-items: center; padding: 14px; border: 1px solid #b7b7b2; background: #fff; }}
label {{ font-weight: 650; }}
input {{ width: min(520px, 100%); border: 1px solid #777; border-radius: 2px; padding: 9px 10px; background: #fff; color: #171717; font: inherit; }}
.table-wrap {{ overflow-x: auto; border: 1px solid #b7b7b2; border-top: 0; background: #fff; }}
table {{ width: 100%; min-width: 1180px; border-collapse: collapse; font-size: 0.88rem; }}
th {{ position: sticky; top: 0; z-index: 1; padding: 11px 10px; text-align: left; background: #e6e6e2; border-bottom: 1px solid #777; font-size: 0.75rem; letter-spacing: 0.055em; text-transform: uppercase; }}
td {{ padding: 11px 10px; vertical-align: top; border-bottom: 1px solid #deded9; }}
tr:last-child td {{ border-bottom: 0; }}
tr:hover td {{ background: #f7f7f4; }}
td strong {{ display: block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.84rem; }}
td small {{ display: block; margin-top: 4px; color: #555; max-width: 58ch; line-height: 1.35; }}
.state {{ display: inline-block; border: 1px solid #555; padding: 3px 6px; font: 0.72rem ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; white-space: nowrap; }}
.num {{ text-align: right; font-variant-numeric: tabular-nums; }}
time, code {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.79rem; }}
a {{ color: inherit; text-decoration-thickness: 1px; text-underline-offset: 3px; }}
footer {{ margin-top: 18px; color: #555; font-size: 0.82rem; line-height: 1.5; }}
@media (max-width: 900px) {{
  main {{ padding: 16px; }}
  header {{ align-items: start; flex-direction: column; }}
  .meta {{ text-align: left; white-space: normal; }}
  .metrics {{ grid-template-columns: repeat(2, minmax(120px, 1fr)); }}
  .metric:nth-child(2n) {{ border-right: 0; }}
  .metric {{ border-bottom: 1px solid #d2d2cd; }}
  .controls {{ align-items: stretch; flex-direction: column; }}
}}
</style>
</head>
<body>
<main>
<header>
  <div>
    <h1>Swarm Claim Recovery Desk</h1>
    <p>Durable coordination metadata. A recovery classification is a prompt to read the provider result and original thread, never permission to blindly duplicate work.</p>
  </div>
  <div class="meta">generated {html.escape(generated_at)}<br>watch {thresholds.watch_minutes}m · recover {thresholds.recovery_minutes}m · abandoned {thresholds.abandoned_minutes}m</div>
</header>
<section class="metrics" aria-label="Operation totals">{cards}</section>
<section class="controls">
  <label for="filter">Filter operations</label>
  <input id="filter" type="search" autocomplete="off" placeholder="operation, owner, state, summary">
</section>
<div class="table-wrap">
<table>
<thead><tr><th>Class</th><th>Age min</th><th>Gen</th><th>Anom</th><th>Owner</th><th>Operation</th><th>Checkpoint</th><th>Last seen UTC</th><th>Source</th><th>Next action</th></tr></thead>
<tbody id="rows">{''.join(rows)}</tbody>
</table>
</div>
<footer>Only durable references and hashes belong here. Use <code>resume</code> to create a handoff packet and <code>takeover --expected-generation N</code> only after current-provider readback confirms inactivity.</footer>
</main>
<script>
const filter = document.getElementById('filter');
const rows = Array.from(document.querySelectorAll('#rows tr'));
filter.addEventListener('input', () => {{
  const query = filter.value.trim().toLowerCase();
  for (const row of rows) row.hidden = query && !row.dataset.search.includes(query);
}});
</script>
</body>
</html>
"""


