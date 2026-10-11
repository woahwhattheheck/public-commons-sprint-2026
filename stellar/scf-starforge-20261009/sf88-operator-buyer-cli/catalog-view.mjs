// SPDX-License-Identifier: MIT
// Inert local views. Provider strings are text, never HTML, script or URL links.
const escape = value => String(value ?? '').replace(/[&<>"']/g,
  c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const short = value => escape(String(value ?? '').slice(0, 2048));
const shell = (title, body) => `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escape(title)}</title><style>
:root{font-family:system-ui,sans-serif;color:#1c1c1c;background:#f7f7f7}body{margin:0 auto;padding:24px;max-width:1160px}
h1{font-size:24px;margin-bottom:8px}h2{font-size:18px}p{line-height:1.5;overflow-wrap:anywhere}a{color:inherit}table{border-collapse:collapse;width:100%;background:white}
th,td{text-align:left;vertical-align:top;border:1px solid #ccc;padding:10px;overflow-wrap:anywhere}th{background:#eee}
code,pre{font-family:ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.scroll{overflow:auto}.scroll table{min-width:560px}
small{color:#555}details{margin:8px 0}summary{cursor:pointer}article{background:white;border:1px solid #ccc;margin:16px 0;padding:16px}
@media(max-width:600px){body{padding:12px}th,td{padding:7px}h1{font-size:21px}}
</style><main>${body}</main></html>\n`;
export function catalogPageView(page, file) {
  const rows = page.originalListings.map((row, index) => {
    const url = typeof row?.resource === 'string' ? row.resource : row?.resource?.url;
    const offers = Array.isArray(row?.accepts) ? row.accepts : [];
    return `<article><h2>Row ${index} · ${short(row?.extensions?.bazaar?.info?.input?.method ?? 'method unspecified')}</h2>
<p><code>${short(url)}</code></p><p>${short(row?.description)}</p><div class="scroll"><table>
<thead><tr><th>Accept index</th><th>Scheme / network</th><th>Atomic amount / asset</th><th>Recipient</th></tr></thead><tbody>
${offers.map((offer, i) => `<tr><td>${i}</td><td>${short(offer?.scheme)}<br>${short(offer?.network)}</td>
<td><code>${short(offer?.amount)}</code><br>${short(offer?.asset)}</td><td><code>${short(offer?.payTo)}</code></td></tr>`).join('')}
</tbody></table></div><details><summary>Original listing JSON</summary><pre>${escape(JSON.stringify(row, null, 2))}</pre></details></article>`;
  }).join('');
  return shell('Saved catalog page', `<a href="index.html">All captured pages</a><h1>Saved catalog page</h1>
<p>${short(page.source)}</p><p><a href="${file}">Original parsed page JSON</a> · offset ${page.pagination.offset} · ${page.originalListings.length} rows</p>
<p>These are advertised offers, not purchases or guaranteed current terms. Row and accept indexes below belong to this page only.</p>
${rows}<h2>Prepare with the existing buyer</h2><pre>node cli.mjs --prepare --discovery /absolute/capture/${file} --row ROW --accept ACCEPT --intent-id YOUR-STABLE-ID --url YOUR-CONCRETE-HTTPS-RESOURCE --method METHOD --out /absolute/new-review.json
node cli.mjs --review --config /absolute/new-review.json</pre>
<p>Choose and substitute the indexes, concrete resource, method and stable intent deliberately. Preparation is offline; no signer is loaded.</p>`);
}
export function catalogIndexView(state) {
  return shell('Catalog acquisition', `<h1>Catalog acquisition</h1><p><strong>${escape(state.status)}</strong> · ${state.pages.length} pages · ${state.rows} observed rows</p>
<p>${short(state.request.origin)}</p><p>Each saved page preserves the original SF31 parsed listings and pagination. This is a sequence of observations, not an atomic provider snapshot. No payment or seller-resource request is made.</p>
${state.error ? `<p>Last acquisition error: <code>${escape(state.error)}</code>. Completed pages remain available. Rerun the same configuration to resume the next page.</p>` : ''}
<div class="scroll"><table><thead><tr><th>Page</th><th>Offset</th><th>Rows</th><th>Captured UTC</th><th>Files</th></tr></thead><tbody>
${state.pages.map((page, i) => `<tr><td>${i + 1}</td><td>${page.offset}</td><td>${page.rows}</td><td>${escape(page.capturedAt)}</td>
<td><a href="${page.file.replace('.json', '.html')}">Browse offers</a> · <a href="${page.file}">JSON</a></td></tr>`).join('')}
</tbody></table></div><p><a href="manifest.json">Acquisition manifest</a> · hashes refer to locally serialized parsed-page files, not raw HTTP bytes.</p>
<p>Next offset: ${state.nextOffset}. Provider-reported total: ${state.total ?? 'not read'}.</p>`);
}
