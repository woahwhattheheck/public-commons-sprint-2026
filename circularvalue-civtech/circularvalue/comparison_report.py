"""Offline, escaped HTML comparison, compiled from source rather than supplied totals."""
from __future__ import annotations

from html import escape
from typing import Any
from .comparison import compare_cases
from .core import canonical_json


def _text(value: Any) -> str:
    return escape(str(value), quote=True)


def _table(headers: list[str], rows: list[list]) -> str:
    heading = "".join(f'<th scope="col">{_text(value)}</th>' for value in headers)
    body = "".join("<tr>" + "".join(
        f'<td class="number">{_text(value)}</td>' if type(value) is int
        else f"<td>{_text(value)}</td>" for value in row
    ) + "</tr>" for row in rows)
    return (f'<div class="scroll" role="region" tabindex="0" aria-label="{_text(headers[0])}">'
            f'<table><thead><tr>{heading}</tr></thead><tbody>{body}</tbody></table></div>')


def render_comparison_html(baseline: dict, option: dict) -> str:
    comparison = compare_cases(baseline, option)
    before, after = comparison["baseline"], comparison["option"]
    parts = [
        '<!doctype html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<title>CircularValue — option comparison</title>',
        '''<style>
        :root { font-family: system-ui, sans-serif; color-scheme: light; color: #172b38; background: #edf2f4; }
        body { margin: 0 auto; padding: 1rem; max-width: 1180px; line-height: 1.5; }
        main { background: white; padding: clamp(1rem, 3vw, 2.5rem); border-radius: 12px; }
        h1 { font-size: clamp(1.6rem, 4vw, 2.4rem); margin: .2rem 0; }
        h2 { margin-top: 2rem; } h3 { margin-bottom: .25rem; }
        .notice { border-left: 4px solid #9b5d00; background: #fff6e6; padding: 1rem; }
        .eyebrow { font-weight: 700; letter-spacing: .06em; }
        .scroll { overflow-x: auto; } .scroll:focus-visible { outline: 2px solid #365a67; }
        table { border-collapse: collapse; width: 100%; font-size: .9rem; }
        th, td { text-align: left; vertical-align: top; padding: .6rem; border-bottom: 1px solid #cdd7dd; overflow-wrap: anywhere; }
        th { background: #edf3f5; } .number { white-space: nowrap; font-variant-numeric: tabular-nums; }
        code, p, dd { overflow-wrap: anywhere; } pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: .8rem; }
        dt { font-weight: 700; } dd { margin: .2rem 0 1rem; }
        @media screen and (max-width: 700px) { table { min-width: 42rem; } }
        @media print { :root { background: white; } main { padding: 0; } body { max-width: none; padding: 0; }
          .scroll { overflow: visible; } th, td { padding: .35rem; } table { font-size: .75rem; }
          tr { break-inside: avoid; } h2, h3 { break-after: avoid; } }
        </style></head><body><main>''',
        '<p class="eyebrow">CIRCULARVALUE · OPTION COMPARISON</p><h1>What changes with this option?</h1>',
        f'<p><strong>Baseline:</strong> {_text(before["caseId"])}<br><strong>Option:</strong> {_text(after["caseId"])}</p>',
        '<p class="notice"><strong>Needs expert review.</strong> Entered evidence and assumptions, not realized savings, a forecast probability, or an investment recommendation. No action or funds movement is authorized.</p>',
        '<h2>Common valuation basis</h2>',
        _table(["Basis", "Both cases"], [[key, value] for key, value in comparison["basis"].items()]),
        '<p>Amounts are integer minor units in the supplied currency. No currency conversion or decimal scale is inferred. Scroll tables horizontally on narrow screens; keyboard users can focus each table.</p>',
        '<h2>Value comparison</h2>',
    ]
    rows = []
    for label, key in (("Annual lever value before recurring costs", "annualValue"), ("Net present value after costs", "npv")):
        for side, packet in (("Baseline", before), ("Option", after)):
            value = packet[key]
            rows.append([label, side, value["lowMinor"], value["centralMinor"], value["highMinor"]])
        delta = comparison[key + "Delta"]
        rows.append([label, "Option minus baseline envelope", delta["lowMinor"], delta["centralMinor"], delta["highMinor"]])
    parts.extend([
        _table(["Measure", "Case / difference", "Low", "Central", "High"], rows),
        '<p><strong>Difference rule:</strong> lower = option low − baseline high; central = option central − baseline central; upper = option high − baseline low. This conservative endpoint envelope assumes no known coupling between the two ranges. It is not a confidence interval, probability, paired-scenario estimate, or a guarantee. Even identical input ranges retain an envelope when evaluated as separate uncertain outcomes.</p>',
        f'<p><strong>Numerical NPV relationship:</strong> {_text(comparison["npvRangeRelation"])}</p>',
        '<h2>Quality remains attached to each case</h2>',
        _table(["Case", "Existing decision-support state", "Stale evidence", "Hypothesis levers", "Modeled levers"], [
            [label, packet["decisionSupportState"], *( ", ".join(packet["quality"][key]) or "None" for key in ("staleEvidenceIds", "hypothesisLeverIds", "modeledLeverIds"))]
            for label, packet in (("Baseline", before), ("Option", after))
        ]),
        '<p>A higher numerical value does not remove stale-evidence, modeled-value, or hypothesis flags.</p>',
        '<h2>Changed assumptions</h2>',
        _table(["Assumption", "Baseline", "Option"], [[row["id"], row["before"], row["after"]] for row in comparison["assumptionChanges"]]) if comparison["assumptionChanges"] else '<p>No assumption fields changed.</p>',
        '<h2>Category annual-value differences</h2><p>Before recurring costs; each row uses the same conservative envelope, not matched low/low subtraction.</p>',
        _table(["Category", "Low difference", "Central difference", "High difference"], [
            [key, row["lowMinor"], row["centralMinor"], row["highMinor"]] for key, row in comparison["categoryAnnualValueDeltas"].items()
        ]),
    ])
    for title, key in (("Evidence changes", "evidenceChanges"), ("Value-lever changes", "leverChanges")):
        parts.append(f"<h2>{title}</h2>")
        if not comparison[key]:
            parts.append("<p>None.</p>")
        for row in comparison[key]:
            parts.append(f'<h3>{_text(row["id"])} — {_text(row["change"])}</h3>')
            if row.get("changedEvidenceIds"):
                parts.append(f'<p>Changed supporting evidence: {_text(", ".join(row["changedEvidenceIds"]))}</p>')
            for label, side in (("Baseline", "before"), ("Option", "after")):
                parts.append(f'<p><strong>{label}</strong></p><pre>{_text(canonical_json(row[side]))}</pre>')
    parts.append('<h2>Source identity</h2><p>Evidence locators are retained references, not fetched or independently authenticated. These hashes identify the source cases, compiled packets and comparison JSON, not this HTML file. Keep both source cases and verify the JSON comparison separately.</p><dl>')
    for side, packet in (("Baseline", before), ("Option", after)):
        for label, key in (("source case", "sourceCaseSha256"), ("compiled packet", "packetSha256")):
            parts.append(f'<dt>{side} {label} SHA-256</dt><dd><code>{_text(packet[key])}</code></dd>')
    parts.append(f'<dt>Comparison JSON SHA-256</dt><dd><code>{_text(comparison["comparisonSha256"])}</code></dd>')
    parts.append('</dl></main></body></html>\n')
    return "".join(parts)
