// MIT. Complete portable incident publication from the original captured records.
import { canonical, sha256, fail } from '../common.mjs';
import { operationsSummary, operationsTables, incidentSummary, validateOperationsExport, OPERATIONS_MAX_BYTES } from './domain.mjs';

export const OPERATIONS_FILES = Object.freeze([
  { path: 'grpc-operations.json', contentType: 'application/json', maximum: OPERATIONS_MAX_BYTES },
  { path: 'calls.csv', contentType: 'text/csv; charset=utf-8', maximum: 64 * 1024 * 1024 },
  { path: 'health.csv', contentType: 'text/csv; charset=utf-8', maximum: 64 * 1024 * 1024 },
  { path: 'actions.csv', contentType: 'text/csv; charset=utf-8', maximum: 16 * 1024 * 1024 },
  { path: 'report.html', contentType: 'text/html; charset=utf-8', maximum: 32 * 1024 * 1024 },
]);
export const OPERATIONS_EXPORT_MAX_BYTES = 304 * 1024 * 1024;
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
function csv(rows, columns) {
  const cell = value => {
    let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return columns.map(cell).join(',') + '\r\n' + rows.map(row => columns.map(name => cell(row[name])).join(',')).join('\r\n') + (rows.length ? '\r\n' : '');
}
function table(rows, columns) {
  return '<div class="scroll"><table><thead><tr>' + columns.map(([name]) => '<th>' + escape(name) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(row => '<tr>' + columns.map(([, pick]) => '<td>' + escape(pick(row)) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
}
export function operationsReportHtml(bundle) {
  const { capture, history } = bundle, current = history.at(-1), edit = current.edit;
  const summary = operationsSummary(capture), tables = operationsTables(capture);
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'">' +
    '<title>' + escape(edit.title) + '</title><style>' +
    'body{max-width:1150px;margin:36px auto;padding:0 20px;color:#202124;background:#fff;font:15px/1.55 system-ui,sans-serif}' +
    'h1,h2,h3{line-height:1.25}h2{margin-top:32px;border-top:1px solid #c4c7c9;padding-top:20px}' +
    'p,td{overflow-wrap:anywhere}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}' +
    '.facts>div{border:1px solid #c4c7c9;padding:12px}.facts strong{display:block}.prose{white-space:pre-wrap}.scroll{overflow:auto}' +
    'table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;vertical-align:top;border:1px solid #c4c7c9;padding:8px}' +
    'th{background:#f2f3f4}code{font-size:12px;word-break:break-all}.muted{color:#53565a}@media print{body{max-width:none;font-size:11px}.scroll{overflow:visible}tr{break-inside:avoid}}' +
    '</style><body><header><p class="muted">gRPC operations · reviewed incident</p><h1>' + escape(edit.title) + '</h1>' +
    '<p>' + escape(edit.severity.toUpperCase() + ' · ' + edit.state + ' · revision ' + current.version) + '</p></header>' +
    '<div class="facts">' + [['Original calls',summary.attempts],['Completed records',summary.outcomes.COMPLETED],
      ['Outcome unconfirmed',summary.outcomes.OUTCOME_UNCONFIRMED],['Not started',summary.outcomes.NOT_STARTED],
      ['Attempted',summary.outcomes.ATTEMPTED],['Health observations',summary.healthObservations]]
      .map(([key,value])=>'<div><strong>'+escape(key)+'</strong>'+escape(value)+'</div>').join('') + '</div>' +
    '<h2>Incident review</h2><h3>Summary</h3><p class="prose">' + escape(edit.summary) + '</p><h3>Impact</h3><p class="prose">' + escape(edit.impact) +
    '</p><h3>Findings</h3><p class="prose">' + escape(edit.findings) + '</p><p><strong>Review:</strong> ' + escape(edit.review.state + ' · ' + edit.review.reviewer) +
    '</p><p class="prose">' + escape(edit.review.note) + '</p><h2>Corrective actions</h2>' +
    table(edit.actions, [['Action',r=>r.title],['Owner',r=>r.owner],['State',r=>r.state],['Due',r=>r.dueAt],['Notes',r=>r.note]]) +
    '<h2>Recorded outcome cohorts</h2><p>' + escape(summary.meaning) + '</p>' +
    table(tables.revisions, [['Revision / title',r=>r.revision+'\n'+r.title],['Target',r=>r.target],['Calls',r=>r.attempts],
      ['Completed',r=>r.outcomes.COMPLETED],['Unconfirmed',r=>r.outcomes.OUTCOME_UNCONFIRMED],['Not started',r=>r.outcomes.NOT_STARTED],
      ['Attempted',r=>r.outcomes.ATTEMPTED],['Elapsed samples',r=>r.recordedElapsed.samples],['Median ms',r=>r.recordedElapsed.p50Ms],['p95 ms',r=>r.recordedElapsed.p95Ms]]) +
    '<h2>Methods</h2>' + table(tables.methods, [['Method',r=>r.method],['Calls',r=>r.attempts],['Completed',r=>r.outcomes.COMPLETED],
      ['Unconfirmed',r=>r.outcomes.OUTCOME_UNCONFIRMED],['Recorded elapsed samples',r=>r.recordedElapsed.samples],['Median ms',r=>r.recordedElapsed.p50Ms]]) +
    '<h2>Linked original records</h2>' + table(edit.links, [['Kind',r=>r.kind],['Original ID',r=>r.id],['Health sequence',r=>r.sequence]]) +
    '<h2>Review history</h2>' + table(history, [['Revision',r=>r.version],['Saved at',r=>r.createdAt],['State',r=>r.edit.state],
      ['Reviewer',r=>r.edit.review.reviewer],['Review',r=>r.edit.review.state],['Original operation',r=>r.operationId]]) +
    '<h2>Capture and receiving</h2><p>Capture interval: ' + escape(capture.startedAt + ' — ' + capture.capturedAt) +
    '</p><p>Selected start window: ' + escape((capture.selection.from ?? 'earliest retained call') + ' — ' + (capture.selection.to ?? 'capture time')) +
    '</p><p>Methods: ' + escape(capture.selection.methods.join(', ') || 'all retained methods') + '</p><p>Revisions: ' +
    escape(capture.selection.revisions.join(', ') || 'all retained revisions') + '</p><p>Complete call and health tables are in calls.csv and health.csv. ' +
    'grpc-operations.json carries every selected original call record, source revision, frozen health prefix and incident revision. A native response stream retains its original prefix descriptor and SHA256; its original stream file remains a separately addressable native customer export.</p>' +
    '<p>Capture <code>' + escape(capture.captureSha256) + '</code><br>Incident <code>' + escape(current.sha256) +
    '</code><br>Full export <code>' + escape(bundle.exportSha256) + '</code></p></body></html>\n';
}
export function createOperationsFiles(bundle) {
  validateOperationsExport(bundle);
  const tables = operationsTables(bundle.capture);
  const contents = [
    JSON.stringify(bundle) + '\n',
    csv(tables.calls, ['id','revision','method','service','phase','startedAt','finishedAt','recordedElapsedMs','error','grpcCode','inputSha256','responseSha256','plannedRequestMessages','requestBytes','responseFormat','responseMessages','responseStreamBytes','target']),
    csv(tables.health, ['id','revision','sequence','observedAt','kind','type','service','reportedStatus','grpcCode','eventSha256']),
    csv(bundle.history.at(-1).edit.actions, ['id','title','owner','state','dueAt','note']),
    operationsReportHtml(bundle),
  ];
  return OPERATIONS_FILES.map((descriptor, i) => {
    const bytes = Buffer.from(contents[i]);
    if (bytes.length > descriptor.maximum) fail('GRPC_OPERATIONS_PUBLICATION_TOO_LARGE', 413);
    return { ...descriptor, bytes, sha256: sha256(bytes) };
  });
}
export function operationsExportDescriptor(bundle, files) {
  const incident = bundle.history.at(-1);
  return { schema: 'stellar-forge.grpc-operations-files.v1', exportSha256: bundle.exportSha256,
    captureId: bundle.capture.id, captureSha256: bundle.capture.captureSha256, case: incidentSummary(incident),
    files: files.map(file => ({ path: file.path, filename: file.path, bytes: file.bytes.length, sha256: file.sha256, contentType: file.contentType })) };
}
