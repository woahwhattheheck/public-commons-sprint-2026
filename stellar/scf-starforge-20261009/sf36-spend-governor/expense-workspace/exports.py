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
                   "quoted_amount", "settled_actual", "receipt_ref", "observation_sha256", "payer", "recipient",
                   "result_file_status", "result_file_sha256", "result_file_bytes", "result_preview_sha256", "result_preview_bytes",
                   "source_capture", "missing")
CREDIT_FIELDS = ("credit_id", "item_id", "source_name", "source_capture", "packet_id", "manifest_sha256",
    "adjustment_id", "refund_id", "order_reference", "source_kind", "source_reference", "present_in_latest_receipt", "network", "asset", "original_transaction", "transaction",
    "transfer_identity", "observation_sha256", "native_return", "recognition_date", "native_transfer_at",
    "center_code", "center_name", "project", "account_code", "amount", "memo", "coding_id", "line", "data_context")
CREDIT_OUTCOMES = ("credit_id", "item_id", "source_name", "source_capture", "packet_id", "manifest_sha256",
    "site_url", "order_reference", "source_kind", "source_reference", "present_in_latest_receipt", "latest_source_status", "latest_source_eligibility", "adjustment_id", "refund_id", "merchant_status", "store_amount", "currency",
    "store_credit_applied", "native_return", "network", "asset", "transfer_at", "observed_at",
    "transaction", "original_transaction", "transfer_identity", "observation_sha256", "coding_id", "data_context")
ADJUSTMENT_OUTCOMES = ("source_name", "source_id", "source_capture", "packet_id", "source_sha256",
    "manifest_sha256", "source_reference", "event_id", "network", "asset_digest", "payment_status",
    "adjustment_id", "kind", "status", "amount", "effective_at", "recorded_at", "operator", "reason",
    "reference", "native_verified", "eligible_return", "eligibility", "transaction", "transfer_at", "observed_at", "data_context")
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
    sign = "-" if str(value).startswith("-") else ""
    padded = str(value).removeprefix("-").zfill(precision + 1)
    shown = sign + (padded if not precision else padded[:-precision] + "." + padded[-precision:])
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
    native_section = ("<section><h2>Original native purchase outcomes</h2>" + native_payments +
        "<p class='muted'>These original sources retain the purchase or quote identity, native payment observation and available result metadata. Store currency mappings and native spending reservations remain separate.</p></section>") if doc.get("native_payment_outcomes") else ""
    sources = table(["Source", "Accepted capture", "Captured at", "Projection"],
        [[esc(r["name"]), "<code>" + esc(r["current_capture"]) + "</code>", esc(r.get("capture_time")),
          "<code>" + esc(r.get("projection_sha256")) + "</code>"] for r in doc["source_captures"]])
    cost_centers = table(["Cost center", "Network / asset", "Native amount"],
        [[esc(r["center_code"] + " · " + r["center_name"]), esc(r["network"]) + "<br><code>" + esc(r["asset"]) + "</code>",
          units(r["amount"], r, labels)] for r in doc["by_cost_center"]])
    credit_section = ""
    if doc.get("merchant_credit_outcomes") or doc.get("credit_allocations"):
        native_returns = table(["Original reference / return", "Original native return", "Source status / store amount", "Native operation / packet"],
            [[esc(r.get("order_reference") or r.get("source_reference") or r["adjustment_id"]) + " / " + esc(r.get("refund_id") or r["adjustment_id"]) + "<br><small>" + esc(r.get("site_url") or r.get("source_kind")) + "</small>",
              units(r["native_return"], r, labels) + "<br><code>" + esc(r["transaction"]) + "</code><br>" + esc(r["transfer_at"]),
              esc((str(r["store_amount"]) + " " + str(r["currency"])) if r.get("store_amount") is not None and r.get("currency") else "Store-currency amount not supplied") + "<br>" + esc(r["merchant_status"]),
              esc(r["data_context"]) + "<br><code>" + esc(r["manifest_sha256"]) + "</code>" +
                ("<br><small>Absent from latest accepted receipt; original verified return retained</small>" if r.get("present_in_latest_receipt") is False else "")]
             for r in doc.get("merchant_credit_outcomes", [])])
        return_lines = table(["Recognition", "Cost center / project", "Account", "Returned native amount", "Original refund"],
            [[esc(r["recognition_date"]), esc(r["center_code"] + " · " + r["center_name"]) + "<br>" + esc(r["project"]),
              esc(r["account_code"]), units(r["amount"], r, labels), "<code>" + esc(r["adjustment_id"]) + "</code>"]
             for r in doc.get("credit_allocations", [])])
        net = table(["Network / asset", "Net native expense", "Lines"],
            [[esc(r["network"]) + "<br><code>" + esc(r["asset"]) + "</code>", units(r["amount"], r, labels), esc(r["lines"])]
             for r in doc.get("net_totals", [])])
        credit_section = ("<section><h2>Buyer credits and returns</h2><p>Store-currency credit and native returned units retain their independent original mappings. Returns reduce the original expense allocation.</p>" +
                          native_returns + "<h3>Return allocation lines</h3>" + return_lines + "<h3>Net native expense</h3>" + net + "</section>")
    adjustment_section = ""
    if doc.get("merchant_adjustment_outcomes"):
        original_decisions = table(["Original reference / adjustment", "Native decision", "Original native amount", "Dates / review", "Original export"],
            [[esc(r["source_reference"]) + "<br><code>" + esc(r.get("adjustment_id") or r["event_id"]) + "</code>",
              esc(r["kind"] + " / " + r["status"]) + "<br>" + esc(r.get("eligibility") or r["payment_status"]),
              ("<span class='number'>" + esc(r["amount"]) + "</span> base units" if r.get("amount") is not None else "No adjustment amount") +
                "<br>" + esc(r["network"]) + "<br><small>Asset digest</small><br><code>" + esc(r["asset_digest"]) + "</code>",
              esc(r.get("effective_at")) + "<br>" + esc(r.get("operator")) + "<br>" + esc(r.get("reason")),
              esc(r["source_name"]) + "<br><code>" + esc(r["source_sha256"]) + "</code>"]
             for r in doc["merchant_adjustment_outcomes"]])
        adjustment_section = ("<section><h2>Original merchant adjustment decisions</h2><p>These are the accepted source decisions retained with this edition. Pending requests, cancellations and withdrawn decisions remain visible; they are not returned transfers. Verified returns appear separately with their original purchase binding and accounting allocation.</p>" + original_decisions + "</section>")
    style_hash = base64.b64encode(hashlib.sha256(CSS.encode()).digest()).decode()
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-{style_hash}'; base-uri 'none'; form-action 'none'">
<title>{esc(period['name'])} · Buyer expense edition {doc['sequence']}</title><style>{CSS}</style></head>
<body><main><header><div class="eyebrow">Starforge / Buyer expense operations</div><h1>{esc(period['name'])}</h1>
<div class="meta"><span>{esc(period['from_day'])} — {esc(period['through_day'])}</span><span>Issued edition {doc['sequence']}</span><span>{esc(doc['created_at'])}</span></div>
<p class="muted">Amounts retain their original network, asset and exact base units. Recognition dates are assigned by the operator; original reservation and quote-creation dates keep their source meanings. Outstanding ledger authorizations are carried separately. Currency conversion is outside this edition.</p>
<dl><dt>Operation context</dt><dd>{esc(doc.get("data_context", "operational"))}</dd><dt>Review owner</dt><dd>{esc(reviewer['reviewer'])} · {esc(reviewer['role'])}</dd><dt>Review conclusion</dt><dd>{esc(reviewer['notes'])}</dd>
<dt>Issued edition</dt><dd><code>{esc(doc['id'])}</code></dd><dt>Source and decision context</dt><dd><code>{esc(doc['context_sha256'])}</code></dd></dl></header>
<section><h2>Allocated expenses</h2>{totals}<h3>Cost-center totals</h3>{cost_centers}</section>
<section><h2>Allocation lines</h2>{allocations}</section>
<section><h2>Outstanding native reservations</h2>{outstanding}</section>
{native_section}
{credit_section}
{adjustment_section}
<section><h2>Exception decisions</h2>{decisions}</section>
<section><h2>Retained source captures</h2>{sources}<p class="muted">{esc(doc['basis'])}. The private JSON and source files retain the exact original rows and reviewer decisions.</p></section>
</main></body></html>
"""


def accountant_packet(doc, bookkeeping=None):
    entries = {"issued.html": render_issued(doc).encode(),
               "period.json": (json.dumps(doc, ensure_ascii=True, indent=2) + "\n").encode(),
               "allocations.csv": csv_text(doc["allocations"], FIELDS).encode(),
               "outstanding-reservations.csv": csv_text(doc["outstanding_reservations"], OUTSTANDING).encode(),
               "credit-allocations.csv": csv_text(doc.get("credit_allocations", []), CREDIT_FIELDS).encode(),
               "original-merchant-credits.csv": csv_text(doc.get("merchant_credit_outcomes", []), CREDIT_OUTCOMES).encode(),
               "original-merchant-adjustments.csv": csv_text(doc.get("merchant_adjustment_outcomes", []), ADJUSTMENT_OUTCOMES).encode(),
               "net-native-expense.csv": csv_text(doc.get("net_totals", doc["totals"]), ("network", "asset", "amount", "lines")).encode(),
               "native-mcp-payment-outcomes.csv": csv_text(doc.get("native_payment_outcomes", []), NATIVE_OUTCOMES).encode(),
               "exception-decisions.json": (json.dumps(doc["issues"], ensure_ascii=True, indent=2) + "\n").encode(),
               "README.txt": b"Open issued.html for the reviewed period. JSON retains exact base-unit strings and source rows. Import every amount and identifier column as text in spreadsheet software. The capture basis remains the original SF36 statement projection and any explicitly retained MCP quote/payment observations. Each source keeps its own dates and classifications. This packet performs no wallet or finality action and applies no currency conversion. Keep this operator/accountant export private.\n"}
    for source in doc["native_captures"]:
        entries["sources/" + source["id"] + ".json"] = (json.dumps(source, ensure_ascii=True, indent=2) + "\n").encode()
    for packet in doc.get("refund_packets", []):
        prefix = "refund-packets/" + packet["id"] + "/"
        native = packet["native"]
        manifest_name = "buyer-selection.json" if native.get("manifest_kind") == "BUYER_INTAKE_SELECTION" else "manifest.json"
        entries[prefix + manifest_name] = base64.b64decode(native["manifest_base64"], validate=True)
        for member in native["files"]:
            entries[prefix + member["name"]] = base64.b64decode(member["base64"], validate=True)
    if bookkeeping is not None:
        current = [row for row in bookkeeping["returns"] if row["current"]]
        flattened = [dict(line, accepted_return_id=row["id"], handoff_id=row["handoff_id"],
                          source_close_id=row["close_id"], accepted_at=row["created_at"])
                     for row in current for line in row["native"]["rows"]]
        entries["bookkeeping/issued-buyer-source.json"] = bookkeeping["source"]
        entries["bookkeeping/history.json"] = (json.dumps({k:v for k,v in bookkeeping.items() if k not in ("source", "originals")}, ensure_ascii=True, indent=2)+"\n").encode()
        fields = ("accepted_return_id", "handoff_id", "source_close_id", "sourceLineId", "rowId", "kind",
                  "sourceRowSha256", "externalStatus", "externalBookRef", "externalAccountCode", "externalNote", "updatedBy", "updatedAt", "accepted_at")
        entries["bookkeeping/current-references.csv"] = csv_text(flattened, fields).encode()
        for ident, raw in bookkeeping["originals"].items():
            entries["bookkeeping/original-returns/"+ident+".json"] = raw
        rows = table(["Kind / original line", "Native allocation", "Original coding", "External status", "Book / account", "Returned note"],
            [[esc(row["kind"])+"<br><code>"+esc(row["sourceLineId"])+"</code>",
              units(row["original"]["amount"], row["original"], doc.get("labels", [])),
              esc(" · ".join(filter(None, [row["original"]["center_code"],row["original"]["project"],row["original"]["account_code"]]))),
              esc(row["externalStatus"]),esc(row["externalBookRef"])+"<br>"+esc(row["externalAccountCode"]),esc(row["externalNote"])]
             for row in flattened])
        page = ("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Returned buyer bookkeeping</title><style>"+CSS+"</style><main><header><h1>Returned buyer bookkeeping</h1><p>Current accountant references at native workspace revision "+esc(bookkeeping["revision"])+". The original financial period remains issued edition "+esc(doc["sequence"])+". Every earlier accountant return and original packet is retained separately.</p><dl><dt>Issued close</dt><dd>"+esc(doc["id"])+"</dd><dt>Original source SHA256</dt><dd>"+esc(hashlib.sha256(bookkeeping["source"]).hexdigest())+"</dd></dl></header><section><h2>Current returned references</h2>"+rows+"</section></main></html>")
        entries["bookkeeping/review.html"] = page.encode()
    entries["manifest.json"] = (json.dumps({"schema": "stellar-forge.buyer-expense-export.v1", "close_id": doc["id"],
        "data_context": doc.get("data_context", "operational"),
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
