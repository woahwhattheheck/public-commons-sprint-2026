"""Frozen accountant delivery from an issued expense period."""
from __future__ import annotations

import base64
import csv
import hashlib
import html
import io
import json
import zipfile

FIELDS = ("source_name", "source_kind", "request_id", "recognition_date", "native_source_day", "native_date_basis", "native_reservation_day", "network", "asset",
          "center_code", "center_name", "project", "account_code", "amount", "settled_actual",
          "reserved_maximum", "quoted_amount", "receipt_ref", "proof_sha256", "request_digest", "coding_id",
          "source_capture", "memo")
OUTSTANDING = ("source_name", "request_id", "native_reservation_day", "network", "asset", "amount", "missing", "source_capture", "request_digest")
NATIVE_OUTCOMES = ("source_name", "request_id", "quote_day", "native_status", "payment_classification", "network", "asset",
                   "quoted_amount", "settled_actual", "receipt_ref", "observation_sha256", "payer", "recipient", "source_capture", "missing")
CSS = """
:root{color-scheme:light;font-family:system-ui,sans-serif;color:#202224;background:#f2f3f3}
*{box-sizing:border-box}body{margin:0;font-size:14px;line-height:1.55}
main{max-width:1320px;margin:auto;padding:32px 20px 60px}h1{font-size:30px;line-height:1.15;margin:8px 0 12px}
h2{font-size:20px;margin:0 0 12px}h3{font-size:15px;margin:16px 0 8px}.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.12em}
section,header{background:#fff;border:1px solid #cfd2d3;padding:22px;margin-bottom:18px}
.meta{display:flex;gap:24px;flex-wrap:wrap}.muted{color:#5d6265}.number{font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums;white-space:nowrap}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:12px;min-width:640px}
th,td{padding:10px 8px;border-bottom:1px solid #d6d8d9;text-align:left;vertical-align:top}th{font-size:11px;background:#f4f5f5;text-transform:uppercase}
code{font-size:11px;overflow-wrap:anywhere}.identity{max-width:320px;overflow-wrap:anywhere}
p{margin:7px 0 12px}dl{display:grid;grid-template-columns:160px 1fr;gap:6px 14px}dt{color:#5d6265}dd{margin:0;overflow-wrap:anywhere}
@media(max-width:600px){main{padding:12px 8px 30px}section,header{padding:14px}h1{font-size:25px}dl{grid-template-columns:1fr;gap:2px}dd{margin-bottom:8px}}
@media print{body{background:white}main{padding:0}section,header{border:0;padding:10px 0}.scroll{overflow:visible}table{min-width:0;font-size:9px}h2{break-after:avoid}}
"""


def esc(value):
    return html.escape("" if value is None else str(value), quote=True)


def csv_text(rows, fields):
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\r\n", quoting=csv.QUOTE_ALL)
    writer.writerow(fields)
    for row in rows:
        values = []
        for key in fields:
            value = "" if row.get(key) is None else str(row[key])
            if value.startswith(("\t", "\r", "\n")) or value.lstrip().startswith(("=", "+", "-", "@")):
                value = "'" + value
            values.append(value)
        writer.writerow(values)
    return out.getvalue()


def table(headers, rows):
    head = "".join("<th scope='col'>" + esc(h) + "</th>" for h in headers)
    body = "".join("<tr>" + "".join("<td>" + value + "</td>" for value in row) + "</tr>" for row in rows)
    return "<div class='scroll'><table><thead><tr>" + head + "</tr></thead><tbody>" + (body or
            "<tr><td colspan='" + str(len(headers)) + "'>No entries in this edition.</td></tr>") + "</tbody></table></div>"


def units(value, row, labels):
    if value is None:
        return "Not established"
    label = next((x for x in labels if x["network"] == row["network"] and x["asset"] == row["asset"]), None)
    if not label:
        return "<span class='number'>" + esc(value) + "</span> base units"
    precision = label["decimals"]
    padded = value.zfill(precision + 1)
    shown = padded if not precision else padded[:-precision] + "." + padded[-precision:]
    return "<span class='number'>" + esc(shown) + "</span> " + esc(label["symbol"]) + "<br><small>" + esc(value) + " base units</small>"


def render_issued(doc):
    labels = doc.get("labels", [])
    period, reviewer = doc["period"], doc["review"]
    totals = table(["Network / asset", "Allocated native amount", "Lines"],
                   [[esc(r["network"]) + "<br><code>" + esc(r["asset"]) + "</code>", units(r["amount"], r, labels), esc(r["lines"])] for r in doc["totals"]])
    allocations = table(["Request / source", "Recognition / original source dates", "Cost center / project", "Account", "Allocated amount", "Native receipt"],
        [[esc(r["request_id"]) + "<br><small>" + esc(r["source_name"]) + "</small>",
          esc(r["recognition_date"]) + "<br><small>" + esc(r.get("native_date_basis", "SF36 reservation day")) + ": " + esc(r.get("native_source_day") or r["native_reservation_day"]) + "</small>",
          esc(r["center_code"] + " · " + r["center_name"]) + "<br>" + esc(r["project"]),
          esc(r["account_code"]), units(r["amount"], r, labels),
          "<code>" + esc(r["receipt_ref"]) + "</code>"] for r in doc["allocations"]])
    decisions = table(["Native request / source", "Review issue", "Disposition", "Owner / reason"],
        [[esc(r.get("request_id") or "") + "<br><small>" + esc(r.get("source_name") or "") + "</small>",
          esc(r["description"]), esc((r.get("disposition") or {}).get("kind") or "Unresolved"),
          esc((r.get("disposition") or {}).get("operator") or "") + "<br>" + esc((r.get("disposition") or {}).get("reason") or "")]
         for r in doc["issues"]])
    outstanding = table(["Request / source", "Native reservation day", "Network / asset", "Outstanding maximum", "Capture status"],
        [[esc(r["request_id"]) + "<br><small>" + esc(r["source_name"]) + "</small>", esc(r["native_reservation_day"]),
          esc(r["network"]) + "<br><code>" + esc(r["asset"]) + "</code>", units(r["amount"], r, labels),
          "Absent from latest capture; original row retained" if r["missing"] else "Present in accepted capture"] for r in doc["outstanding_reservations"]])
    native_payments = table(["Quote / source", "Original buyer / payment state", "Quote day / terms", "Matched transfer", "Recorded result"],
        [[esc(r["request_id"]) + "<br><small>" + esc(r["source_name"]) + "</small>",
          esc(r["native_status"]) + "<br>" + esc(r["payment_classification"]) +
            ("<br><small>Absent from latest capture</small>" if r.get("missing") else ""),
          esc(r["quote_day"]) + "<br>" + units(r.get("quoted_amount"), r, labels),
          units(r.get("settled_actual"), r, labels) + "<br><code>" + esc(r.get("receipt_ref")) + "</code>",
          esc((r.get("result_file") or {}).get("status", "No complete-file record")) + "<br><code>" +
            esc((r.get("result_file") or {}).get("sha256") or (r.get("result_preview") or {}).get("bodySha256")) + "</code>"]
         for r in doc.get("native_payment_outcomes", [])])
    native_section = ("<section><h2>Original MCP payment outcomes</h2>" + native_payments +
        "<p class='muted'>These original quotes retain their quoted terms, buyer status, saved payment observation and recorded result metadata. Native spending reservations remain in their separate ledger source.</p></section>") if doc.get("native_payment_outcomes") else ""
    sources = table(["Source", "Accepted capture", "Captured at", "Projection"],
        [[esc(r["name"]), "<code>" + esc(r["current_capture"]) + "</code>", esc(r.get("capture_time")),
          "<code>" + esc(r.get("projection_sha256")) + "</code>"] for r in doc["source_captures"]])
    cost_centers = table(["Cost center", "Network / asset", "Native amount"],
        [[esc(r["center_code"] + " · " + r["center_name"]), esc(r["network"]) + "<br><code>" + esc(r["asset"]) + "</code>",
          units(r["amount"], r, labels)] for r in doc["by_cost_center"]])
    style_hash = base64.b64encode(hashlib.sha256(CSS.encode()).digest()).decode()
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-{style_hash}'; base-uri 'none'; form-action 'none'">
<title>{esc(period['name'])} · Buyer expense edition {doc['sequence']}</title><style>{CSS}</style></head>
<body><main><header><div class="eyebrow">Starforge / Buyer expense operations</div><h1>{esc(period['name'])}</h1>
<div class="meta"><span>{esc(period['from_day'])} — {esc(period['through_day'])}</span><span>Issued edition {doc['sequence']}</span><span>{esc(doc['created_at'])}</span></div>
<p class="muted">Amounts retain their original network, asset and exact base units. Recognition dates are assigned by the operator; original reservation and quote-creation dates keep their source meanings. Outstanding ledger authorizations are carried separately. Currency conversion is outside this edition.</p>
<dl><dt>Review owner</dt><dd>{esc(reviewer['reviewer'])} · {esc(reviewer['role'])}</dd><dt>Review conclusion</dt><dd>{esc(reviewer['notes'])}</dd>
<dt>Issued edition</dt><dd><code>{esc(doc['id'])}</code></dd><dt>Source and decision context</dt><dd><code>{esc(doc['context_sha256'])}</code></dd></dl></header>
<section><h2>Allocated expenses</h2>{totals}<h3>Cost-center totals</h3>{cost_centers}</section>
<section><h2>Allocation lines</h2>{allocations}</section>
<section><h2>Outstanding native reservations</h2>{outstanding}</section>
{native_section}
<section><h2>Exception decisions</h2>{decisions}</section>
<section><h2>Retained source captures</h2>{sources}<p class="muted">{esc(doc['basis'])}. The private JSON and source files retain the exact original rows and reviewer decisions.</p></section>
</main></body></html>
"""


def accountant_packet(doc):
    entries = {"issued.html": render_issued(doc).encode(),
               "period.json": (json.dumps(doc, ensure_ascii=True, indent=2) + "\n").encode(),
               "allocations.csv": csv_text(doc["allocations"], FIELDS).encode(),
               "outstanding-reservations.csv": csv_text(doc["outstanding_reservations"], OUTSTANDING).encode(),
               "native-mcp-payment-outcomes.csv": csv_text(doc.get("native_payment_outcomes", []), NATIVE_OUTCOMES).encode(),
               "exception-decisions.json": (json.dumps(doc["issues"], ensure_ascii=True, indent=2) + "\n").encode(),
               "README.txt": b"Open issued.html for the reviewed period. JSON retains exact base-unit strings and source rows. Import every amount and identifier column as text in spreadsheet software. The capture basis remains the original SF36 statement projection and any explicitly retained MCP quote/payment observations. Each source keeps its own dates and classifications. This packet performs no wallet or finality action and applies no currency conversion. Keep this operator/accountant export private.\n"}
    for source in doc["native_captures"]:
        entries["sources/" + source["id"] + ".json"] = (json.dumps(source, ensure_ascii=True, indent=2) + "\n").encode()
    entries["manifest.json"] = (json.dumps({"schema": "stellar-forge.buyer-expense-export.v1", "close_id": doc["id"],
        "files": [{"path": name, "bytes": len(value), "sha256": hashlib.sha256(value).hexdigest()} for name, value in sorted(entries.items())]}, indent=2) + "\n").encode()
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in sorted(entries.items()):
            info = zipfile.ZipInfo(name)
            info.create_system = 3
            info.external_attr = 0o100600 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content)
    return out.getvalue()
