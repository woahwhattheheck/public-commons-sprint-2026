import type { InvestorStatement } from "../../../app-lib/servicing/model.mjs"

const escapeHTML = (value: unknown): string => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;")
const decimal = (value: string | null | undefined, scale: number): string => {
  if (value === null || value === undefined) return "Unobserved"
  if (!/^-?\d+$/.test(value)) return value
  const sign = value.startsWith("-") ? "-" : ""
  const magnitude = (sign ? value.slice(1) : value).padStart(scale + 1, "0")
  const integer = (scale ? magnitude.slice(0, -scale) : magnitude).replace(/^0+(?=\d)/, "")
  const fraction = scale ? magnitude.slice(-scale).replace(/0+$/, "") : ""
  return sign + integer + (fraction ? "." + fraction : "")
}
const table = (headers: string[], rows: unknown[][]): string =>
  '<div class="scroll"><table><thead><tr>' + headers.map(value => "<th>" + escapeHTML(value) + "</th>").join("") +
  "</tr></thead><tbody>" + (rows.length ? rows.map(row => "<tr>" + row.map(value => "<td>" + escapeHTML(value) + "</td>").join("") + "</tr>").join("") :
    '<tr><td colspan="' + headers.length + '">No retained records in this selection.</td></tr>') + "</tbody></table></div>"

/** Standalone recipient document. The complete typed statement is embedded as escaped JSON text. */
export function statementHTML(statement: InvestorStatement): string {
  const complete = JSON.stringify(statement).replaceAll("<", "\\u003c")
  const totals = [
    ["Assets requested for deposit", statement.totals.depositRequested, "asset atoms"],
    ["Deposit assets refunded", statement.totals.depositRefunded, "asset atoms"],
    ["Shares claimed", statement.totals.sharesClaimed, "shares"],
    ["Shares requested for redemption", statement.totals.sharesRequestedForRedemption, "shares"],
    ["Redeem shares returned", statement.totals.sharesReturned, "shares"],
    ["Redemption assets paid", statement.totals.redemptionAssetsPaid, "asset atoms"],
    ["Wind-down assets paid", statement.totals.windDownAssetsPaid, "asset atoms"],
    ["Wind-down shares surrendered", statement.totals.windDownSharesSurrendered, "shares"],
  ]
  const selected = statement.selection
  const script = "document.getElementById('download-statement').addEventListener('click',()=>{const data=document.getElementById('statement-original').textContent;const url=URL.createObjectURL(new Blob([data+'\\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='strata-investor-statement.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);});document.getElementById('print-statement').addEventListener('click',()=>window.print());"
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Strata investor statement</title><style>' +
    '*{box-sizing:border-box}body{font:14px/1.5 system-ui,sans-serif;color:#222;background:#fff;max-width:1180px;margin:36px auto;padding:0 24px;overflow-wrap:anywhere}h1{font-size:28px;margin:0 0 8px}h2{font-size:19px;margin:28px 0 12px}h3{font-size:15px}p{margin:8px 0}header{border-bottom:2px solid #555;padding-bottom:20px}dl{display:grid;grid-template-columns:minmax(140px,23%) minmax(0,1fr);gap:6px 16px;margin:16px 0}dt{color:#606060}dd{margin:0;font-family:ui-monospace,monospace;font-size:12px}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.summary div{border:1px solid #bbb;padding:12px}.summary strong{display:block;font:19px ui-monospace,monospace;margin-top:8px}.summary span{font-size:12px;color:#555}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;min-width:760px;font-size:12px}th,td{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top;white-space:pre-wrap;min-width:90px;max-width:330px}th{background:#f1f1f1}button{font:inherit;border:1px solid #888;border-radius:3px;background:#fff;color:#222;padding:9px 13px;cursor:pointer}.actions{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}.note{border-left:3px solid #666;background:#f5f5f5;padding:12px 15px;margin:16px 0}.muted{color:#606060;font-size:12px}li{margin:6px 0}footer{border-top:1px solid #aaa;margin-top:30px;padding:18px 0;font-size:12px;color:#555}@media(max-width:650px){body{padding:0 16px;margin:20px auto}h1{font-size:23px}dl{grid-template-columns:1fr;gap:4px}dd{margin-bottom:7px}.summary{grid-template-columns:1fr}}@media print{body{max-width:none;margin:0;padding:0;font-size:10px}.actions{display:none}.scroll{overflow:visible}table{min-width:0;font-size:8px}th,td{min-width:0;max-width:none;padding:4px}thead{display:table-header-group}tr{break-inside:avoid}h2{break-after:avoid}.summary{grid-template-columns:repeat(2,1fr)}.summary strong{font-size:14px}.note{break-inside:avoid}a{color:inherit}}</style></head><body>' +
    '<header><h1>Investor statement</h1><p>Retained vault servicing history</p><dl><dt>Investor / controller</dt><dd>' + escapeHTML(selected.controller) +
    '</dd><dt>Vault contract</dt><dd>' + escapeHTML(statement.binding.contracts.async_vault) +
    '</dd><dt>Network</dt><dd>' + escapeHTML(statement.binding.network.id + " · " + statement.binding.network.passphrase) +
    '</dd><dt>Selected ledger range</dt><dd>' + escapeHTML(selected.fromLedger ?? "First retained ledger") + " – " + escapeHTML(selected.toLedger ?? "Last retained ledger") +
    '</dd><dt>Archive</dt><dd>' + escapeHTML(statement.archiveId) + '</dd><dt>Archive SHA-256</dt><dd>' + escapeHTML(statement.archiveSha256) +
    '</dd></dl></header><div class="actions"><button type="button" id="download-statement">Download complete statement JSON</button><button type="button" id="print-statement">Print statement</button></div>' +
    '<p class="note">This statement follows the selected retained history. Coverage and any missing ranges appear below. Request episodes carry their original events; cancellations and subsequent requests remain separate. Assets remain original indivisible units (atoms). Share quantities use the current share contract’s seven decimals; prices are asset-atoms per share-atom ratios with an 18-decimal WAD scale.</p>' +
    (statement.warnings.length ? '<h2>History notes</h2><ul>' + statement.warnings.map(warning => "<li>" + escapeHTML(warning) + "</li>").join("") + "</ul>" : "") +
    '<h2>Selected investor activity totals</h2><div class="summary">' + totals.map(([label, value, unit]) => "<div><span>" + escapeHTML(label) + "</span><strong>" + escapeHTML(decimal(value, unit === "shares" ? 7 : 0)) + '</strong><span>' + escapeHTML(unit) + "</span></div>").join("") + "</div>" +
    "<h2>Request episodes</h2>" + table(
      ["Episode / side", "Epoch / state", "Requested", "Asset atoms / shares", "Price (asset atoms / share atom)", "First / last ledger", "Request / conclusion time", "History notes"],
      statement.requests.map(row => [
        row.id + "\n" + row.side, row.epoch + "\n" + row.status,
        decimal(row.side === "deposit" ? row.amount : row.shares, row.side === "deposit" ? 0 : 7) + (row.side === "deposit" ? " asset atoms" : " shares"),
        decimal(row.assets, 0) + " asset atoms\n" + decimal(row.shares, 7) + " shares",
        decimal(row.sharePrice, 18), row.firstLedger + " / " + row.lastLedger,
        (row.requestedAt ?? "Unobserved") + "\n" + (row.concludedAt ?? "Unobserved"),
        [row.missingStart ? "Earlier request event missing" : "", ...row.notes].filter(Boolean).join("\n"),
      ])) +
    "<h2>Retained ledger coverage</h2>" + table(
      ["First ledger", "Last ledger", "Status", "Reason", "Original batches"],
      statement.coverage.map(row => [row.fromLedger, row.toLedger, row.status, row.reason ?? "Selected range completed", row.batchIds.join("\n")])) +
    "<h2>Original investor events</h2>" + table(
      ["Event", "Contract role", "Ledger / time", "Transaction", "Original source"],
      statement.events.map(row => [row.id + "\n" + row.name, row.role, row.ledger + "\n" + row.closedAt, row.txHash, row.sourceId])) +
    "<h2>Original contract selection</h2>" + table(["Contract", "Address"], Object.entries(statement.binding.contracts)) +
    '<p class="muted">RPC endpoint: ' + escapeHTML(statement.binding.network.rpcUrl) + '<br>Source commit: ' + escapeHTML(statement.binding.sourceCommit) +
    '<br>Collector starts at ledger ' + escapeHTML(statement.binding.startLedger) + '</p>' +
    '<footer>The complete selected statement, including original event topics, values and XDR, is embedded in this document and can be downloaded above. The separately retained original archive carries its complete RPC requests, responses, snapshots and coverage.</footer>' +
    '<script type="application/json" id="statement-original">' + complete + '</script><script>' + script + "</script></body></html>"
}
