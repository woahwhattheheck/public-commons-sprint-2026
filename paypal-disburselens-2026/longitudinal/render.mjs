// MIT. Private, static, readable merchant lifecycle review exports.
function safe(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
const money=value=>String(value??'');
function csvCell(value){
  let text=String(value??'');
  // CSV spreadsheet viewers sometimes interpret a leading formula marker.
  if(/^[\s]*[=+@-]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
export function renderCSV(report){
  const rows=[['item_id','sender_item_id','masked_receiver','currency','amount','before_status',
    'after_status','severity','text_model_review_score','flags','baseline_evidence_sha256','followup_evidence_sha256']];
  for(const row of report.rows){
    rows.push([row.itemId,row.senderItemId,row.receiverMasked,row.currency,row.amount,
      row.beforeStatus,row.afterStatus,row.severity,row.textReviewScore,
      row.flags.join(';'),report.originalEvidence.baseline,report.originalEvidence.followup]);
  }
  return rows.map(row=>row.map(csvCell).join(',')).join('\n')+'\n';
}
function countCell(number,label){
  return '<div class="stat"><strong>'+safe(number)+'</strong><span>'+safe(label)+'</span></div>';
}
function rowHTML(row){
  const flagHtml=row.flags.length?row.flags.map(flag=>'<code>'+safe(flag)+'</code>').join(' '):'No exceptions';
  return '<tr><td><strong>'+safe(row.itemId)+'</strong><small>'+safe(row.senderItemId)+
    '</small></td><td>'+safe(row.receiverMasked)+'</td><td>'+
    safe(row.currency)+' '+safe(money(row.amount))+'</td><td>'+
    safe(row.beforeStatus??'absent')+' → '+safe(row.afterStatus??'absent')+'</td><td>'+
    '<span class="status '+safe(row.severity)+'">'+safe(row.severity)+'</span></td><td>'+
    safe(row.textReviewScore===null?'not observed':row.textReviewScore)+'<small>Advisory pattern only</small></td><td>'+
    flagHtml+'</td></tr>';
}
export function renderHTML(report){
  const stats=countCell(report.counts.total,'Items compared')+
    countCell(report.counts.high,'High priority')+
    countCell(report.counts.review,'Needs review')+
    countCell(report.counts.stalled,'Stalled (observed)');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'+
   '<meta name="viewport" content="width=device-width,initial-scale=1">'+
   '<title>DisburseLens | Payout lifecycle operations</title>'+
   '<style>:root{color-scheme:light;font:14px/1.55 system-ui,Arial,sans-serif;color:#1e2933;background:#f4f5f6}'+
   'body{max-width:1360px;margin:auto;padding:36px}h1{font-size:24px;margin:0 0 8px}p{margin:8px 0}'+
   '.muted{color:#52606b}.kicker{text-transform:uppercase;letter-spacing:.12em;font-size:11px;font-weight:700;color:#4a5661}'+
   '.panel{background:white;border:1px solid #d1d5d9;border-radius:5px;padding:24px;margin:20px 0}'+
   '.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}'+
   '.stat{background:#f4f5f6;border:1px solid #e1e4e7;padding:12px}strong{font-weight:650}'+
   '.stat strong{font-size:23px;display:block}.stat span,small{display:block;font-size:11px;color:#58656f}'+
   '.scroll{overflow:auto}table{width:100%;border-collapse:collapse;min-width:920px}'+
   'th{text-align:left;background:#edf0f2;white-space:nowrap;font-size:11px;text-transform:uppercase;letter-spacing:.06em}'+
   'td,th{padding:10px 8px;border-bottom:1px solid #e1e4e7;vertical-align:top}'+
   'tbody tr:nth-child(even){background:#fafbfb}.status{display:inline-block;border:1px solid #8e959b;padding:2px 7px;border-radius:3px}'+
   '.status.high{font-weight:700;border-color:#444}.status.review{border-color:#777}code{font:11px/1.8 ui-monospace,monospace;border:1px solid #d9dddf;padding:1px 3px;margin:2px;white-space:nowrap;display:inline-block}'+
   '.hash{overflow-wrap:anywhere;font:12px ui-monospace,monospace}'+
   '@media(max-width:650px){body{padding:16px}.stats{grid-template-columns:repeat(2,1fr)}}'+
   '@media print{body{padding:0;background:white}.panel{break-inside:avoid}}'+
   '</style></head><body><p class="kicker">DisburseLens / Payout operations</p>'+
   '<h1>Source-bound payout lifecycle review</h1>'+
   '<p class="muted">Read-only PayPal Payouts v1 observation comparison. Human review required. No payout commands.</p>'+
   '<section class="panel"><p><strong>Batch:</strong> '+safe(report.batchId)+'</p>'+
   '<p><strong>Capture window:</strong> '+safe(report.baselineAt)+' → '+safe(report.followupAt)+
   ' ('+safe(report.elapsedHours)+' observed hours)</p><p><strong>Source:</strong> '+safe(report.source)+
   '</p><div class="stats">'+stats+'</div>'+
   '<p><strong>Batch-level exceptions:</strong> '+safe(report.batchFlags.join(', ')||'None')+'</p></section>'+
   '<section class="panel"><h2>Merchant follow-up desk</h2><div class="scroll"><table><thead><tr>'+
   '<th>Original item</th><th>Masked receiver</th><th>Amount</th><th>Payout status</th>'+
   '<th>Priority</th><th>Learned signal</th><th>Reasons</th></tr></thead><tbody>'+
   report.rows.map(rowHTML).join('')+'</tbody></table></div></section>'+
   '<section class="panel"><h2>Original-source lineage</h2>'+
   '<p class="hash">Before SHA-256: '+safe(report.originalEvidence.baseline)+'</p>'+
   '<p class="hash">After SHA-256: '+safe(report.originalEvidence.followup)+'</p>'+
   '<h3>Review boundaries</h3><ul>'+
   report.limitations.map(x=>'<li>'+safe(x)+'</li>').join('')+'</ul></section>'+
   '</body></html>\n';
}
