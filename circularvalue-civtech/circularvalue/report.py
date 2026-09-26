"""Self-contained human review view of a freshly compiled case."""

from __future__ import annotations

from html import escape
from typing import Any, Iterable

from .core import compile_case


def _text(value: Any) -> str:
    return escape(str(value), quote=True)


def _table(headers: Iterable[str], rows: Iterable[Iterable[Any]]) -> str:
    headings = "".join(f'<th scope="col">{_text(value)}</th>' for value in headers)
    body = "".join(
        "<tr>" + "".join(f"<td>{_text(value)}</td>" for value in row) + "</tr>"
        for row in rows
    )
    return f'<div class="table-scroll"><table><thead><tr>{headings}</tr></thead><tbody>{body}</tbody></table></div>'


def render_case_html(raw_case: dict[str, Any]) -> str:
    """Compile the source case and render its existing values without recomputing them."""
    packet = compile_case(raw_case)
    assumptions = packet["assumptions"]
    quality = packet["quality"]
    parts = [
        '<!doctype html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        f'<title>CircularValue — {_text(packet["caseId"])}</title>',
        """<style>
        :root { color-scheme: light; font-family: system-ui, sans-serif; color: #172b38; background: #eef2f4; }
        body { max-width: 1120px; margin: 0 auto; padding: 2rem 1rem; line-height: 1.5; }
        main { background: white; padding: clamp(1rem, 3vw, 2.5rem); border-radius: 12px; }
        h1 { font-size: clamp(1.5rem, 4vw, 2.3rem); margin: .25rem 0; overflow-wrap: anywhere; }
        h2 { margin-top: 2rem; font-size: 1.25rem; }
        .eyebrow { color: #365a67; font-weight: 700; letter-spacing: .06em; }
        .state { border-left: 5px solid #9b5d00; background: #fff6e6; padding: 1rem; overflow-wrap: anywhere; }
        .table-scroll { overflow-x: auto; }
        table { border-collapse: collapse; width: 100%; margin: .75rem 0; font-size: .9rem; }
        th, td { border-bottom: 1px solid #cdd7dd; padding: .65rem; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
        th { background: #edf3f5; }
        code { overflow-wrap: anywhere; }
        dt { font-weight: 700; } dd { margin: .25rem 0 1rem; overflow-wrap: anywhere; }
        @media print { body { background: white; padding: 0; max-width: none; } main { padding: 0; } .table-scroll { overflow: visible; } tr { break-inside: avoid; } h2 { break-after: avoid; } }
        </style></head><body><main>""",
        '<p class="eyebrow">CIRCULARVALUE · CASE REVIEW</p>',
        f'<h1>{_text(packet["caseId"])}</h1>',
        f'<p>Evaluated on {_text(packet["evaluatedOn"])} · Currency {_text(packet["currency"])}</p>',
        f'<p class="state"><strong>{_text(packet["decisionSupportState"])}</strong><br>',
        'Decision support from entered evidence and assumptions. Values are not realized savings or an investment recommendation.</p>',
        '<h2>Value range</h2><p>All monetary amounts below are integer minor units as supplied in the case. No currency scale or conversion is inferred.</p>',
        _table(["Measure", "Low", "Central", "High"], [
            [label, values["lowMinor"], values["centralMinor"], values["highMinor"]]
            for label, values in [("Annual lever value before recurring costs", packet["annualValue"]), ("Net present value", packet["npv"])]
        ]),
    ]
    payback = packet["simplePaybackMonthsCentral"]
    parts.append(
        '<p>Central simple payback (rounded to the nearest month): '
        + ("not reached under the entered annual net value" if payback is None else f"{payback} months")
        + ".</p>"
    )
    parts.extend([
        '<h2>Assumptions</h2>',
        _table(["Assumption", "Entered value"], [
            ["Horizon (years)", assumptions["horizonYears"]],
            ["Discount rate (basis points)", assumptions["discountRateBps"]],
            ["Maximum evidence age (days)", assumptions["maxEvidenceAgeDays"]],
            ["One-off cost (minor units)", assumptions["oneOffCostMinor"]],
            ["Annual recurring cost (minor units)", assumptions["annualRecurringCostMinor"]],
        ]),
        '<h2>Evidence quality and uncertainty</h2>',
        _table(["Review flag", "Identifiers"], [
            ["Stale evidence", ", ".join(quality["staleEvidenceIds"]) or "None"],
            ["Hypothesis levers", ", ".join(quality["hypothesisLeverIds"]) or "None"],
            ["Modeled levers", ", ".join(quality["modeledLeverIds"]) or "None"],
        ]),
        '<h2>Value levers</h2>',
        _table(["Identifier / label", "Category", "Confidence", "Low", "Central", "High", "Evidence"], [
            [f'{row["id"]}: {row["label"]}', row["category"], row["confidence"], row["lowMinor"], row["centralMinor"], row["highMinor"], ", ".join(row["evidenceIds"])]
            for row in packet["levers"]
        ]),
        '<h2>Category totals</h2>',
        _table(["Category", "Low", "Central", "High", "Levers"], [
            [category, row["lowMinor"], row["centralMinor"], row["highMinor"], ", ".join(row["leverIds"])]
            for category, row in packet["categoryTotals"].items()
        ]),
        '<h2>Largest uncertainty ranges</h2><p>Ranked by the high-minus-low annual value spread; this ranking is not a probability or causal attribution.</p>',
        _table(["Lever", "Annual spread (minor units)", "Confidence"], [
            [row["leverId"], row["spreadMinor"], row["confidence"]] for row in packet["sensitivity"]
        ]),
        '<h2>Retained evidence references</h2><p>Locators and hashes are supplied references. This report does not fetch or independently authenticate the referenced documents.</p>',
        _table(["Identifier", "Source type", "Observed on", "Locator", "SHA-256", "Note"], [
            [row["id"], row["sourceType"], row["observedOn"], row["locator"], row["sha256"], row["note"]]
            for row in packet["evidence"]
        ]),
        '<h2>Source and calculation identity</h2><dl>',
        f'<dt>Source case SHA-256</dt><dd><code>{_text(packet["sourceCaseSha256"])}</code></dd>',
        f'<dt>Compiled packet SHA-256</dt><dd><code>{_text(packet["packetSha256"])}</code></dd>',
        f'<dt>Calculation generation</dt><dd>{_text(packet["generation"])}</dd></dl>',
        '<p>The identifiers describe the source case and compiled JSON packet, not the HTML file. Keep the source case and verified packet with this review copy.</p>',
        '<h2>Authority limits</h2><p>This report supplies no investment recommendation, environmental certification, accounting conclusion, external action, or funds movement authorization.</p>',
        '</main></body></html>\n',
    ])
    return "".join(parts)
