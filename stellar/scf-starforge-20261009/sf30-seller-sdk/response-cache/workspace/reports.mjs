// MIT. Portable operating report from the original saved cache observations.
const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cell = value => '<td>' + escape(value) + '</td>';
const count = value => Number.isSafeInteger(value) ? value.toLocaleString('en-US') : '—';
const time = value => typeof value === 'string' ? value : '—';
function table(headers, rows) {
  return '<div class="table"><table><thead><tr>' + headers.map(v => '<th>' + escape(v) + '</th>').join('') +
    '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(cell).join('') + '</tr>').join('') + '</tbody></table></div>';
}
export function renderCacheReport(archive, { sourceId } = {}) {
  const sources = archive.sources.filter(row => sourceId === undefined || row.id === sourceId);
  const sections = sources.map(source => {
    const captures = archive.inspections.filter(row => row.sourceId === source.id);
    const changes = archive.changes.filter(row => row.sourceId === source.id);
    const latest = captures.at(-1);
    const rows = latest ? Object.entries(latest.inspection.routes).map(([id, route]) => {
      const stats = route.stats?.cache ?? route.stats ?? route, policy = route.policy ?? route.limits ?? {};
      return [id, count(policy.ttlMs), count(policy.maxEntries), count(stats.entries), count(stats.bytes),
        count(stats.requests), count(stats.sourceReads), count(stats.hits), count(stats.coalesced),
        count(stats.sourceErrors), count(stats.sourceTimeouts)];
    }) : [];
    return '<section><h2>' + escape(source.label) + '</h2><p>' + escape(source.id) + '</p>' +
      (latest ? '<p>Latest saved observation: ' + escape(latest.label) + ' · ' + escape(latest.capturedAt) +
        '</p><p class="small">Runtime ' + escape(latest.inspection.instanceId) + ' · Control revision ' +
        escape(latest.inspection.revision) + '</p>' : '<p>No operating observation has been saved.</p>') +
      table(['Route', 'Freshness ms', 'Entry limit', 'Entries', 'Bytes', 'Requests', 'Source reads', 'Hits',
        'Coalesced', 'Source errors', 'Timeouts'], rows) +
      '<h3>Reviewed operating changes</h3>' + table(['Created UTC', 'Route', 'Operation', 'Status', 'Attempts', 'Operator note'],
        changes.map(row => [time(row.createdAt), row.command.route, row.command.action, row.status, row.attempts, row.note])) +
      changes.map(row => '<details><summary>' + escape(row.id) + ' · ' + escape(row.status) +
        '</summary><pre>' + escape(JSON.stringify({ command: row.command, preview: row.preview,
          receipt: row.receipt, error: row.error, note: row.note }, null, 2)) + '</pre></details>').join('') +
      '<h3>Retained observations</h3>' + table(['Captured UTC', 'Label', 'Runtime', 'Revision', 'Routes'],
        captures.map(row => [row.capturedAt, row.label, row.inspection.instanceId, row.inspection.revision,
          Object.keys(row.inspection.routes).length])) + '</section>';
  }).join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Merchant cache operations</title><style>body{font:15px/1.55 system-ui,sans-serif;color:#202020;background:#fff;max-width:1280px;margin:40px auto;padding:0 24px}h1,h2,h3{line-height:1.2}h1{font-size:30px}h2{font-size:23px;margin-top:36px}h3{font-size:17px}header,section{border-bottom:1px solid #ccc;padding-bottom:24px}.small,footer{font-size:12px;color:#555}.table{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #ccc;padding:8px 10px;text-align:left;vertical-align:top}th{background:#f4f4f4;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}details{margin:12px 0}summary{cursor:pointer}footer{margin-top:24px}@media print{body{margin:0;max-width:none}details{break-inside:avoid}th{background:#fff}}</style></head><body>' +
    '<header><h1>Merchant cache operations</h1><p>Saved policies, original runtime observations and reviewed changes.</p>' +
    '<p class="small">Workspace ' + escape(archive.workspace.id) + ' · Revision ' + escape(archive.workspace.revision) +
    ' · Exported ' + escape(archive.exportedAt) + '</p></header>' + sections +
    '<footer>Counts describe the original saved counter window. A new process or credential generation begins a different window. Coalesced requests can perform individual source reads when the source declines sharing. The operating record retains those original counters and control results.</footer></body></html>';
}
