"""Readable, self-contained report for original saved Economic comparisons."""
from __future__ import annotations

from html import escape
import json

from .economic_comparison import SCHEMA

STYLE = """
:root{color-scheme:light;font-family:Arial,Helvetica,sans-serif;color:#222;background:#eee}
*{box-sizing:border-box}body{margin:0;font-size:14px;line-height:1.5}main{max-width:1400px;margin:0 auto;background:white;padding:32px}
h1{font-size:28px;line-height:1.2;margin:0 0 14px}h2{font-size:21px;margin:28px 0 12px}h3{font-size:17px;margin:20px 0 8px}
p{margin:9px 0}a{color:#222;text-decoration:underline;overflow-wrap:anywhere}.meta{color:#555;font-size:12px;overflow-wrap:anywhere}
.note{padding:12px;background:#f3f3f3;border-left:3px solid #777}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.panel{padding:16px;border:1px solid #bbb;min-width:0}.stats{display:flex;gap:16px;flex-wrap:wrap;padding:12px 0}
.stat{border:1px solid #bbb;padding:10px 14px}.stat strong{display:block;font-size:22px}.scroll{overflow-x:auto;border:1px solid #bbb}
table{border-collapse:collapse;width:100%;min-width:600px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ddd;padding:9px;overflow-wrap:anywhere}
th{background:#f1f1f1;font-weight:600}tbody tr:last-child td{border-bottom:0}.num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
details{border:1px solid #bbb;padding:10px;margin:12px 0}summary{font-weight:600;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#f5f5f5;padding:12px;max-height:520px;overflow:auto}
.small{font-size:12px}.links{display:flex;gap:16px;flex-wrap:wrap;margin:16px 0}section{margin-top:24px}
@media(max-width:720px){main{padding:16px}h1{font-size:23px}.grid{grid-template-columns:1fr}.stats{gap:8px}.stat{flex:1 1 120px}}
@media print{:root{background:white}main{padding:0;max-width:none}.scroll{overflow:visible}table{min-width:0;font-size:10px}thead{display:table-header-group}
h1,h2,h3{break-after:avoid}tr,.panel{break-inside:avoid}.links{display:none}details:not([open]){display:none}pre{max-height:none}.grid{grid-template-columns:1fr 1fr}}
@page{size:A4 landscape;margin:14mm}
"""


def text(value):
    if value is None:
        return "Unstated"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, float):
        return format(value, ".12g")
    return str(value)


def e(value):
    return escape(text(value), quote=True)


def original(value):
    return '<pre>' + escape(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)) + '</pre>'


def table(headers, rows):
    return ('<div class="scroll"><table><thead><tr>'
            + ''.join('<th scope="col">' + escape(item) + '</th>' for item in headers)
            + '</tr></thead><tbody>'
            + ''.join('<tr>' + ''.join('<td>' + item + '</td>' for item in row) + '</tr>' for row in rows)
            + '</tbody></table></div>')


def _decision(row):
    value = (row or {}).get("decision")
    if value is None:
        return "Scenario absent"
    return ('Budget: ' + e(value.get("budget_status")) + '<br>Targets: '
            + e(value.get("target_status")) + '<br>Eligible: ' + e(value.get("eligible"))
            + '<br>Pareto: ' + e(value.get("pareto"))
            + ('<p class="small">' + '<br>'.join(e(item) for item in value.get("reasons", [])) + '</p>'
               if value.get("reasons") else ''))


def _amount(row, name):
    cost = (row or {}).get("cost")
    if not isinstance(cost, dict):
        return "No retained cost"
    suffix = "/year" if name in {"annual_operating", "annualized"} else ""
    return e(cost.get(name)) + " " + e(cost.get("currency")) + suffix


def _source(value):
    if not isinstance(value, dict):
        return "No retained cost source"
    source = value.get("source") or {}
    scope = value.get("scope") or {}
    return ("Source: " + e(source.get("title")) + "<br>Reference: " + e(source.get("uri"))
            + "<br>As of: " + e(source.get("as_of")) + "<br>Footprint: " + e(scope.get("kind"))
            + ("<br>Basis: " + e(scope["note"]) if scope.get("note") else ""))


def _edition(value, side):
    return ('<article class="panel"><h3>' + side + ': ' + e(value["title"]) + '</h3>'
            + '<p>Zone: ' + e(value.get("zone_title") or value.get("zone_id")) + '</p>'
            + '<p class="meta">Edition ' + e(value["id"]) + '<br>Created ' + e(value["created_at"])
            + '<br>Native report ' + e(value["producer_report_id"])
            + '<br>Original source SHA256 ' + e(value["report_sha256"]) + '</p></article>')


def _changes(rows):
    if not rows:
        return '<p>No changed fields.</p>'
    return table(["Original field", "Change", "First", "Second"], [
        [e(row["path"]), e(row["kind"]),
         original(row["first"]) if row["first_present"] else "Field absent",
         original(row["second"]) if row["second_present"] else "Field absent"] for row in rows])


def render_comparison(value):
    if value.get("schema") != SCHEMA:
        raise ValueError("Choose the original Economic comparison.")
    sections = [
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>' + e(value["title"]) + '</title><style>' + STYLE + '</style></head><body><main>',
        '<header><p class="meta">Saved Economic editions · original scenario review</p><h1>'
        + e(value["title"]) + '</h1><p>Read the first and second saved decisions in the selected order. '
        'Every displayed delta is second minus first.</p></header>',
        '<nav class="links" aria-label="Complete comparison files">'
        '<a href="comparison.json" download>Complete comparison JSON</a>'
        '<a href="scenarios.csv" download>All scenario changes CSV</a>'
        '<a href="first-economic-package.zip" download>First complete Economic package</a>'
        '<a href="second-economic-package.zip" download>Second complete Economic package</a></nav>',
        '<div class="grid">' + _edition(value["first"], "First")
        + _edition(value["second"], "Second") + '</div>',
    ]
    summary = value["summary"]
    sections.append('<div class="stats">' + ''.join(
        '<div class="stat"><strong>' + e(summary[key]) + '</strong>' + label + '</div>'
        for key, label in (("matched_count", "Matched scenarios"), ("added_count", "Added"),
                           ("removed_count", "Removed"), ("cost_changed_count", "Cost inputs changed"),
                           ("decision_changed_count", "Decisions changed"))) + '</div>')
    compatible = value["comparability"]["physical"]
    sections.append('<section><h2>Original physical source</h2><p class="note">'
                    + ("Both editions retain the same original physical comparison, quantities and support."
                       if compatible else "These editions retain different physical source context. Review both original columns and the differences below.")
                    + '</p>')
    sections.append(table(["Source check", "Same original value"], [
        [e(item["label"]), e(item["equal"])] for item in value["comparability"]["checks"]]))
    sections.append('<details><summary>Complete original source checks and values</summary>'
                    + original(value["comparability"]) + '</details></section>')
    sections.append('<section><h2>Budget, targets and selection criteria</h2><div class="grid">'
                    '<div class="panel"><h3>First criteria</h3>' + original(value["criteria"]["first"])
                    + '</div><div class="panel"><h3>Second criteria</h3>' + original(value["criteria"]["second"])
                    + '</div></div>' + _changes(value["criteria"]["changes"]) + '</section>')
    sections.append('<section><h2>Scenario affordability and eligibility</h2>')
    sections.append(table(["Scenario", "Change", "First saved decision", "Second saved decision"], [
        [e(row["label"]) + '<div class="meta">' + e(row["run_id"]) + '</div>',
         e(row["status"]), _decision(row["first"]), _decision(row["second"])]
        for row in value["scenarios"]]))
    sections.append('</section><section><h2>Original costs and financial assumptions</h2>'
                    '<p>Amounts remain separate for every whole scenario. Financial deltas require matching currency and declared footprint; '
                    'annualized and present-value deltas also require the same horizon and real discount rate.</p>')
    for row in value["scenarios"]:
        cc = row["cost_comparison"]
        sections.append('<article><h3>' + e(row["label"]) + '</h3>')
        sections.append(table(["Original quantity", "First", "Second", "Second minus first"], [
            [label, _amount(row["first"], name), _amount(row["second"], name),
             e(delta["delta_decimal"]) if delta["comparable"] else '<span class="small">' + e(delta["reason"]) + '</span>']
            for name, label in (("capital", "Upfront capital"), ("annual_operating", "Annual operating cost"),
                                ("annualized", "Annualized cost"), ("present_value", "Present value"))
            for delta in [cc["deltas"][name]]]))
        left, right = (row["first"] or {}).get("cost") or {}, (row["second"] or {}).get("cost") or {}
        sections.append(table(["Financial basis", "First", "Second"], [
            ["Horizon, years", e(left.get("horizon_years")), e(right.get("horizon_years"))],
            ["Real discount rate", e(left.get("discount_rate")), e(right.get("discount_rate"))],
            ["Original source", _source(cc["first_input"]), _source(cc["second_input"])]]))
        sections.append('<details><summary>Complete original scenario, physical support and changed fields</summary>'
                        + original(row) + '</details></article>')
    sections.append('</section><section><h2>Original frontier and complete input changes</h2>'
                    '<details><summary>Original first and second frontiers</summary>'
                    + original(value["frontier"]) + '</details>'
                    '<details><summary>Every changed original selection field</summary>'
                    + _changes(value["selection_changes"]) + '</details></section>')
    sections.append('<section><h2>How to read this comparison</h2><ul>'
                    + ''.join('<li>' + e(item) + '</li>' for item in value["interpretation"])
                    + '</ul><p class="meta">The complete package retains this report, all original comparison data, '
                    'both original saved edition records and complete Economic packages, and the authored comparison source.</p></section>'
                    '</main></body></html>')
    return ''.join(sections)
