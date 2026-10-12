// MIT. Offline operator view of an original SF88 object session. No execution controls.
const labels = {READY:'Ready', COMPLETE:'Complete', RECONCILIATION_REQUIRED:'Review interrupted attempt',
  RUNNING:'Running', INTERRUPTED:'Interrupted', QUEUED:'Queued', SAVED:'Saved',
  PENDING:'Pending', VERIFIED:'Verified', CANCELLED:'Cancelled',
  ATTEMPT_RECORDED:'Attempt recorded', RUNNING_OR_INTERRUPTED:'Running or interrupted'};
const text = value => ['string','number','boolean','bigint'].includes(typeof value) ? String(value) : '';
const esc = value => text(value).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shell = value => "'" + text(value).replace(/'/g, "'\\''") + "'";
const bytes = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('en-US') + ' bytes' : '—';
const item = (label, value) => `<div class="field"><dt>${esc(label)}</dt><dd>${esc(value || '—')}</dd></div>`;
const title = report => report.selection?.filename || report.sessionId || 'Object download';

/** Render saved source and current local delivery state without loading a signer,
 * reading keys or contacting a seller. All dynamic content is escaped. */
export function renderObjectReport(report) {
  const chunks = Array.isArray(report.chunks) ? report.chunks : [];
  const completed = report.completeChunks ?? report.completedChunks ?? 0;
  const downloaded = report.downloadedBytes ?? 0;
  const total = report.bytes ?? 0;
  const whole = report.deliveryMode === 'whole';
  const percentage = total > 0 ? Math.min(100, Math.floor(downloaded * 100 / total)) :
    report.status === 'COMPLETE' ? 100 : 0;
  const command = verb => 'node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-cli.mjs ' +
    verb + ' --session ' + shell(report.directory);
  const payload = JSON.stringify(report).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const assembly = report.assembly;
  const source = [item('Delivery', whole ? 'Whole file · one GET · HTTP 200' : 'Byte chunks · HTTP 206'),
    item('Seller route', report.sourceUrl), item('Snapshot', report.expectedSnapshot),
    item('Content type', report.expectedContentType), item('Object bytes', bytes(total)),
    ...(whole ? [] : [item('Requested chunk size', bytes(report.chunkBytes))]),
    item('Expected complete SHA-256', report.expectedSha256 || 'Not supplied by the selected descriptor'),
    item('Merchant object', report.selection?.objectId), item('Description SHA-256', report.selection?.descriptionSha256)].join('');
  const session = [item('Session', report.directory), item('Stable session ID', report.sessionId),
    item('Original buyer inbox', report.queueRoot), item('Network', report.network ?? report.terms?.network),
    item('Asset', report.asset ?? report.terms?.asset),
    item('Maximum units per request', report.maxAtomic ?? report.limits?.maxAtomic),
    item('Whole-download limit, atomic units', report.maxTotalAtomic ?? report.limits?.maxTotalAtomic),
    item('Allocated request caps, atomic units', report.capAllocatedAtomic ?? '0')].join('');
  const assemblyHTML = assembly ? `<section><h2>Recorded assembly</h2><dl>${
    item('Destination', assembly.destination) + item('Bytes', bytes(assembly.bytes)) +
    item('SHA-256', assembly.sha256)}</dl><p class="note">${assembly.fileRevalidated === true
      ? 'The complete output was verified when this assembly finished.'
      : 'This saved receipt records the completed output. Refreshing the session checks its retained chunks; it does not reopen the external destination.'}</p></section>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-object-report-v1'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>${esc(title(report))} · Object download</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f3f3f3;color:#171717;font:14px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:34px 28px 60px}header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;border-bottom:2px solid #222;padding-bottom:22px}
h1{margin:4px 0 9px;font-size:28px;line-height:1.25;font-weight:650;overflow-wrap:anywhere}h2{font-size:17px;line-height:1.3;margin:0 0 18px}.eyebrow{font:12px ui-monospace,monospace;letter-spacing:.07em;text-transform:uppercase;color:#555}p{margin:8px 0}.subtle{color:#5e5e5e}.status{border:1px solid #666;border-radius:3px;padding:5px 10px;white-space:nowrap;font-weight:600}
.metrics{display:grid;grid-template-columns:2fr 1fr 1fr;border:1px solid #bcbcbc;background:white;margin-top:24px}.metric{padding:18px 20px;border-right:1px solid #ccc}.metric:last-child{border-right:0}.metric strong{display:block;font-size:23px;font-weight:600;font-variant-numeric:tabular-nums}.metric span{color:#555;font-size:12px}.progress{height:5px;background:#ddd;margin-top:12px}.progress div{height:100%;background:#383838}
section{border:1px solid #c6c6c6;background:#fff;padding:22px;margin-top:20px}dl{display:grid;grid-template-columns:1fr 1fr;gap:16px 30px;margin:0}dt{font-size:12px;color:#666;margin-bottom:4px}dd{margin:0;font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0 16px}.toolbar label{font-size:12px;font-weight:600}.toolbar input,.toolbar select{font:inherit;border:1px solid #aaa;border-radius:2px;padding:7px 9px;background:#fff;min-height:36px}.toolbar input{flex:1;min-width:180px}button{font:inherit;font-size:12px;font-weight:600;background:#f6f6f6;border:1px solid #888;border-radius:2px;padding:8px 12px;cursor:pointer}button:hover{background:#e4e4e4}button:disabled{opacity:.4;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid #222;outline-offset:3px}
.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px}th{font-weight:600;text-align:left;background:#eee;border-bottom:1px solid #aaa;white-space:nowrap}th,td{padding:10px 11px;vertical-align:top}td{border-bottom:1px solid #ddd}td.mono{font:11px/1.6 ui-monospace,monospace;overflow-wrap:anywhere;min-width:130px}.number{font-variant-numeric:tabular-nums;white-space:nowrap}.row-detail{padding-top:3px;color:#606060}.page{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:16px}.page-controls{display:flex;gap:8px}pre{font:12px/1.7 ui-monospace,monospace;background:#f2f2f2;border:1px solid #ccc;padding:13px 14px;white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 16px}.commands{display:grid;grid-template-columns:1fr 1fr;gap:0 22px}.commands h3{font-size:12px;margin:8px 0 0}.note{font-size:12px;color:#555}.empty{text-align:center;color:#666;padding:28px}details{margin-top:16px}summary{cursor:pointer;font-size:12px;font-weight:600}.footer{font-size:12px;color:#666;margin-top:20px}
@media(max-width:700px){main{padding:20px 14px 36px}header{display:block}header .status{display:inline-block;margin-top:10px}h1{font-size:23px}.metrics{grid-template-columns:1fr}.metric{border-right:0;border-bottom:1px solid #ccc;padding:13px 16px}.metric:last-child{border-bottom:0}dl,.commands{grid-template-columns:1fr}section{padding:17px}.page{align-items:flex-start;flex-direction:column}}
@media print{body{background:white}main{max-width:none;padding:0}button,.toolbar,.page-controls{display:none}section,.metrics{break-inside:avoid}.table-scroll{overflow:visible}header{margin-top:0}}
</style></head><body><main>
<header><div><div class="eyebrow">Starforge / Buyer operations</div><h1>${esc(title(report))}</h1>
<p class="subtle">Pinned object download through the original buyer.</p></div><span class="status">${esc(labels[report.status] || report.status || 'Unknown')}</span></header>
<div class="metrics"><div class="metric"><strong>${esc(bytes(downloaded))}</strong><span>Verified locally of ${esc(bytes(total))}</span><div class="progress" aria-label="${percentage}% of bytes verified"><div style="width:${percentage}%"></div></div></div>
<div class="metric"><strong>${esc(completed)} / ${esc(report.chunkCount ?? chunks.length)}</strong><span>Complete responses</span></div>
<div class="metric"><strong>${percentage}%</strong><span>Download progress</span></div></div>
${assemblyHTML}
<section><h2>Selected object</h2><dl>${source}</dl></section>
<section><h2>Download queue</h2><p class="note">Each request keeps its original intent, attempt and saved response. Completed responses are reused when the download continues.</p>
<div class="toolbar"><label for="query">Find</label><input id="query" type="search" placeholder="Intent, offset, state or response hash" autocomplete="off"><label for="state">State</label><select id="state"><option value="">All states</option></select><button id="export" type="button">Export state JSON</button></div>
<div class="table-scroll"><table><thead><tr><th>Request</th><th>Delivered bytes</th><th>State</th><th>Original intent</th><th>Saved response</th></tr></thead><tbody id="rows"></tbody></table></div>
<div class="page"><span id="page-label" class="note" aria-live="polite"></span><div class="page-controls"><button id="previous" type="button">Previous</button><button id="next" type="button">Next</button></div></div>
<noscript><p>This view uses local JavaScript to display and filter the saved request records. Use the status command below for the complete JSON record.</p></noscript></section>
<section><h2>Operator commands</h2><p class="note">Run these commands in the trusted terminal. Run obtains the original per-request approval and uses the configured ledger. Recover and assemble only inspect or process saved local files.</p>
<div class="commands"><div><h3>Refresh current state</h3><pre>${esc(command('status'))}</pre></div><div><h3>Continue download</h3><pre>${esc(command('run'))}${report.workspace ? ' --workspace ' + esc(shell(report.workspace)) : ''}</pre></div>
<div><h3>Recover interrupted state</h3><pre>${esc(command('recover'))}</pre></div><div><h3>Save the complete file</h3><pre>${esc(command('assemble'))} --out '/absolute/new-file.bin'</pre></div></div>
${report.stoppedChunk ? `<details open><summary>Attempt to inspect</summary><pre>${esc(JSON.stringify(report.stoppedChunk,null,2))}</pre></details>` : ''}
<p class="note">An uncertain attempted request is retained for reconciliation; this workflow does not send it again. A newly assembled file must use a new destination.</p></section>
<section><h2>Original operator session</h2><dl>${session}</dl><p class="note">Allocated caps describe the maximum authorized units for attempted requests. Original ledger reservations and chain observations retain their own accounting meanings.</p></section>
<p class="footer">Offline report. It uses only the saved state embedded in this file; reload current state with the status or report command.</p>
</main><script id="object-state" type="application/json">${payload}</script>
<script nonce="object-report-v1">
(() => {
  'use strict';
  const report = JSON.parse(document.getElementById('object-state').textContent);
  const chunks = Array.isArray(report.chunks) ? report.chunks : [];
  const byId = id => document.getElementById(id);
  const safe = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const words = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const stateOf = chunk => chunk.state || chunk.status || 'PENDING';
  const size = value => Number.isSafeInteger(value) ? value.toLocaleString('en-US') : '—';
  for (const state of [...new Set(chunks.map(stateOf))].sort()) {
    const option = document.createElement('option'); option.value = state; option.textContent = state; byId('state').appendChild(option);
  }
  let page = 0; const pageSize = 50;
  function render() {
    const query = byId('query').value.toLowerCase().trim(), chosen = byId('state').value;
    const rows = chunks.filter(chunk => (!chosen || stateOf(chunk) === chosen) &&
      (!query || [chunk.index,chunk.offset,chunk.intentId,chunk.sha256,stateOf(chunk)].some(value => words(value).toLowerCase().includes(query))));
    page = Math.max(0, Math.min(page, Math.ceil(rows.length / pageSize) - 1));
    const selected = rows.slice(page * pageSize, (page + 1) * pageSize);
    byId('rows').innerHTML = selected.length ? selected.map(chunk => {
      const end = Number.isSafeInteger(chunk.offset) && Number.isSafeInteger(chunk.length) ? chunk.offset + chunk.length - 1 : null;
      const outcome = chunk.originalOutcome?.status || chunk.nativeBuyerStatus || '';
      return '<tr><td class="number">'+safe(chunk.index)+'</td><td class="number">'+(report.deliveryMode === 'whole' ? 'Whole file' : size(chunk.offset)+'–'+size(end))+'<div class="row-detail">'+size(chunk.length)+' bytes</div></td><td>'+safe(stateOf(chunk))+'<div class="row-detail">'+safe(chunk.code || outcome)+'</div></td><td class="mono">'+safe(chunk.intentId)+'</td><td class="mono">'+safe(chunk.sha256 || 'Not saved')+'<div class="row-detail">'+safe(chunk.contentType || '')+'</div></td></tr>';
    }).join('') : '<tr><td colspan="5" class="empty">No matching requests</td></tr>';
    byId('page-label').textContent = rows.length ? (page * pageSize + 1)+'–'+Math.min((page + 1) * pageSize,rows.length)+' of '+rows.length+' requests' : '0 matching requests';
    byId('previous').disabled = page === 0; byId('next').disabled = (page + 1) * pageSize >= rows.length;
  }
  byId('query').addEventListener('input', () => {page = 0; render();});
  byId('state').addEventListener('change', () => {page = 0; render();});
  byId('previous').addEventListener('click', () => {page--; render();});
  byId('next').addEventListener('click', () => {page++; render();});
  byId('export').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report,null,2)+'\\n'],{type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = 'object-download-state.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  });
  render();
})();
</script></body></html>`;
}
