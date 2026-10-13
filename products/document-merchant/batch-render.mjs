// MIT. Complete readable batch delivery over the original native source records.
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cell = value => {
  const source = String(value ?? '');
  return '"' + (/^[=+\-@\t\r]/.test(source) ? "'" + source : source).replace(/"/g,'""') + '"';
};
export function renderDocumentBatchCsv(snapshot) {
  const columns = ['document_id','label','parent_task_reference','format','state','received',
    'request_id','request_reference','checkout_id','checkout_intent','job_entry_id','job_id',
    'settlement_id','settlement_at','network','asset','recipient','payment_flow','document_maximum_atomic',
    'source_filename','source_bytes','source_sha256','pdf_bytes','pdf_sha256','pdf_resource_id',
    'result_package_sha256','error'];
  const rows = snapshot.rows.map(row=>{
    const pdf = row.outputs?.files.find(file=>file.slot === 'pdf');
    return [row.id,row.label,row.taskReference,row.format,row.state,row.received,
      row.requestId,row.reference,row.checkoutId,row.checkoutIntent,row.jobEntryId,row.jobId,
      row.nativeSettlement?.id,row.nativeSettlement?.at,row.payment.network,row.payment.asset,
      row.payment.payTo,row.payment.extra?.paymentFlow ?? row.payment.paymentFlow ?? 'authorization',row.payment.amount,row.source.filename,row.source.bytes,row.source.sha256,
      pdf?.bytes,pdf?.sha256,pdf?.resourceId,row.outputs?.package.sha256,row.error].map(cell).join(',');
  });
  return [columns.map(cell).join(','),...rows].join('\r\n')+'\r\n';
}
export function renderDocumentBatchHtml(snapshot) {
  const totals = snapshot.totals.map(total=>'<tr><td>'+escape(total.network)+'</td><td><code>'+
    escape(total.asset)+'</code></td><td><code>'+escape(total.payTo)+'</code></td><td>'+escape(total.paymentFlow)+'</td><td>'+
    total.documents+'</td><td class="number">'+escape(total.maximumAtomic)+'</td></tr>').join('');
  const tasks = snapshot.parentTasks.map(task=>'<tr><td>'+escape(task.reference)+'</td><td>'+
    task.documents+'</td><td>'+task.receivedDocuments+'</td><td>'+
    (task.completeDocumentSet ? 'All requested documents received' : 'Document receiving continues')+
    '</td></tr>').join('');
  const rows = snapshot.rows.map(row=>{
    const pdf = row.outputs?.files.find(file=>file.slot === 'pdf');
    return '<tr><td><strong>'+escape(row.label)+'</strong><br><small>'+escape(row.id)+
      '<br>'+escape(row.taskReference)+'</small></td><td>'+escape(row.format.toUpperCase())+
      '<br><small>'+escape(row.source.filename)+' · '+row.source.bytes+' bytes</small></td><td>'+
      escape(row.state)+(row.error ? '<br><code>'+escape(row.error)+'</code>' : '')+
      '</td><td>'+escape(row.payment.amount)+'<br><small>'+escape(row.payment.asset)+'</small></td><td>'+
      (pdf ? escape(pdf.bytes)+' bytes<br><code>'+escape(pdf.sha256)+'</code>' : 'Awaiting complete PDF')+
      '</td><td><code>'+escape(row.reference)+'</code><br><small>Checkout '+escape(row.checkoutId ?? 'not prepared')+
      '<br>Job '+escape(row.jobId ?? 'not accepted')+'</small></td></tr>';
  }).join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+escape(snapshot.name)+'</title><style>'+
    'body{max-width:1440px;margin:32px auto;padding:0 24px;background:#fff;color:#202020;font:14px/1.55 system-ui,sans-serif}'+
    'h1{font-size:27px;line-height:1.2;margin:0 0 10px}h2{font-size:19px;margin-top:32px}p{max-width:960px}'+
    'header{border-bottom:2px solid #333;padding-bottom:20px}table{width:100%;border-collapse:collapse;margin:16px 0 28px}'+
    'th,td{border:1px solid #bbb;padding:9px 11px;vertical-align:top;text-align:left;overflow-wrap:anywhere}th{background:#eee}'+
    'code,small{font-size:11px}code{white-space:normal;word-break:break-all}.number{text-align:right;font-variant-numeric:tabular-nums}'+
    '.facts{display:flex;gap:28px;flex-wrap:wrap;margin-top:20px}.facts strong{font-size:24px;display:block}'+
    '.muted{color:#555}@media print{body{margin:0;padding:0;font-size:10px}tr{break-inside:avoid}header{margin-bottom:18px}}'+
    '</style></head><body><header><p class="muted">DOCUMENT MERCHANT · CUSTOMER BATCH</p><h1>'+escape(snapshot.name)+
    '</h1><p>'+escape(snapshot.merchantOrigin)+'<br>Observed '+escape(snapshot.observedAt)+'</p>'+
    '<div class="facts"><div><strong>'+snapshot.documents+'</strong>requested documents</div><div><strong>'+
    snapshot.receivedDocuments+'</strong>complete document outputs received</div><div><strong>'+
    snapshot.parentTasks.length+'</strong>original parent task references</div></div></header>'+
    '<h2>Reviewed native payment maximums</h2><p>These totals retain each document’s original merchant price in its own asset. '+
    'Actual checkout, settlement and receiving remain linked to the original customer request.</p>'+
    '<table><thead><tr><th>Network</th><th>Asset</th><th>Recipient</th><th>Payment flow</th><th>Documents</th><th>Maximum atomic units</th></tr></thead><tbody>'+
    totals+'</tbody></table><h2>Requested work and complete PDFs</h2>'+
    '<table><thead><tr><th>Document and customer task</th><th>Original source</th><th>Current state</th><th>Document maximum</th>'+
    '<th>Complete PDF</th><th>Original request and receiving</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    '<h2>Parent task document sets</h2><p>An invoice and greeting card can share one task reference. '+
    'The complete set below shows receiving of those requested documents; customer acceptance remains in the original customer workflow.</p>'+
    '<table><thead><tr><th>Task reference</th><th>Documents</th><th>Received</th><th>Document set</th></tr></thead><tbody>'+
    tasks+'</tbody></table><h2>Continue the same delivery</h2><p>Open the original customer workspace to inspect its Request, Checkout, Jobs and Resource library. '+
    'Use the retained batch plan to continue existing operations. The completed Collection carries each result package and all four named files: PDF, editable source, request and renderer details.</p>'+
    '<p>batch-results.csv maps every document to its original request, payment and complete file identities. '+
    'batch-results.json retains the full batch observation and original output paths. documents.tar is the original portable Resource library Collection when included.</p>'+
    '<p class="muted">Batch '+escape(snapshot.id)+' · source '+escape(snapshot.inputSha256)+'</p></body></html>\n';
}
