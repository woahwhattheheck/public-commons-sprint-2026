// MIT. Full Paycashless reconciliation exports from one unchanged native edition.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=v=>JSON.stringify(v,null,2);
const shown=v=>v===null||v===undefined?'Not supplied':typeof v==='object'?pretty(v):String(v);
const GROUPS=['rows','invoices','invoicePayments','payments','payouts','accounts','settlements','events','allocations','exceptions','totals'];
const HEADINGS={rows:'All reconciliation findings',invoices:'Invoice balances',invoicePayments:'Instalments and original payment links',payments:'Payment collections',payouts:'Payouts and confirmation',accounts:'Dedicated accounts and requests',settlements:'Selected Stellar movements',events:'Callback data and original unsigned envelope labels',allocations:'Allocations and correction history',exceptions:'Exceptions requiring review',totals:'Totals by source, currency and role'};
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function cell(v){const s=v===null||v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v);return '"'+(/^[\t\r\n ]*[=+@]/.test(s)||/^[\t\r\n ]*-(?!\d+(?:\.\d+)?$)/.test(s)?"'":'')+s.replaceAll('"','""')+'"';}
function rows(data,key){return data[key];}
function fullCSV(data){
 const columns=['record_group','record_index','id','versionId','resourceId','sourceId','sourceScope','environment','kind','status','currency','inPeriod','amounts','invoiceId','intentId','subjectVersionId','settlementVersionId','allocationAmount','settlementAmount','relatedVersionIds','checks','full_original_record_json'];
 const lines=[columns.map(cell).join(',')],scope=Object.fromEntries(Object.entries(data).filter(([k])=>!GROUPS.includes(k)));
 function add(group,index,row){lines.push(columns.map((k,i)=>cell(i===0?group:i===1?index:k==='full_original_record_json'?row:row?.[k])).join(','));}
 add('scope',0,scope);for(const key of GROUPS)rows(data,key).forEach((r,i)=>add(key,i,r));return lines.join('\r\n')+'\r\n';
}
function table(values,cols){
 if(!values.length)return '<p class="empty">No records in this selected edition.</p>';
 return '<div class="table-scroll"><table><thead><tr>'+cols.map(([key,title])=>'<th>'+esc(title??key)+'</th>').join('')+'</tr></thead><tbody>'+
 values.map(row=>'<tr>'+cols.map(([key])=>'<td>'+esc(shown(row?.[key]))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
const COMMON=[['resourceId','Original identity'],['status','Original status'],['currency','Currency'],['amounts','Exact minor-unit amounts'],['reconciliationState','Reconciliation'],['evidenceState','Evidence'],['allocatedAmount','Allocated minor units'],['remainingAmount','Remaining minor units'],['inPeriod','Period selection']];
function displayRows(key,data){
 if(key==='totals')return table(data,[['sourceScope','Merchant/source'],['currency','Currency'],['unit','Unit'],['role','Role'],['values','Exact totals']]);
 if(key==='exceptions')return table(data,[['code','Finding'],['versionId','Original version'],['captureId','Capture'],['sourceId','Source'],['evidence','Observed evidence']]);
 if(key==='allocations')return table(data,[['subjectVersionId','Provider version'],['settlementVersionId','Stellar version'],['allocationAmount','Provider minor units'],['settlementAmount','Stellar units'],['status','Disposition']]);
 if(key==='settlements')return table(data,[['resourceId','Original movement'],['kind','Kind'],['currency','Asset'],['amounts','Original amounts'],['status','State']]);
 if(key==='events')return table(data,[['resourceId','Original identity'],['eventType','Envelope label · unsigned'],['verifiedData','Signed data verified'],['authenticatedFields','Authenticated fields'],['sourceId','Source'],['observedAt','Observed']]);
 return table(data,COMMON);
}
function fullHTML(data){
 const scope=Object.fromEntries(Object.entries(data).filter(([k])=>!GROUPS.includes(k)));
 const summary=[['Book',data.bookId],['Environment',data.environment],['Start, inclusive',data.period?.start],['End, exclusive',data.period?.end],['Display timezone',data.period?.timeZone],['Period membership',data.collectionBasis],['Settlement selection',data.settlementBasis]];
 let body='<header><p class="eyebrow">PAYCASHLESS / OPERATIONS</p><h1>Invoice, payment and settlement report</h1><dl>'+summary.map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(shown(v))+'</dd>').join('')+'</dl></header>';
 body+='<nav aria-label="Report sections">'+['totals','exceptions','invoices','invoicePayments','payments','payouts','allocations','settlements','accounts','events','rows'].map(k=>'<a href="#'+k+'">'+esc(HEADINGS[k])+' ('+data[k].length+')</a>').join('')+'</nav>';
 body+='<section><h2>Accounting basis</h2><p>Provider monetary values retain exact original minor units. NGN values are in kobo; USD values are in cents. Invoice balances, instalments, payment-intent collections and payouts remain distinct. The native edition supplies every total, relationship and finding below.</p><pre>'+esc(pretty(data.semantics))+'</pre><h3>Capture and selection coverage</h3><pre>'+esc(pretty(data.coverage))+'</pre></section>';
 for(const key of ['totals','exceptions','invoices','invoicePayments','payments','payouts','allocations','settlements','accounts','events','rows']){
  body+='<section id="'+key+'"><h2>'+esc(HEADINGS[key])+' <small>'+data[key].length+' records</small></h2>'+displayRows(key,data[key]);
  body+=data[key].map((row,i)=>'<details><summary>Complete record '+(i+1)+(row?.resourceId?' · '+esc(row.resourceId):row?.id?' · '+esc(row.id):'')+'</summary><pre>'+esc(pretty(row))+'</pre></details>').join('')+'</section>';
 }
 body+='<section><h2>Complete edition scope</h2><pre>'+esc(pretty(scope))+'</pre></section><section><h2>Complete unchanged reconciliation</h2><pre>'+esc(pretty(data))+'</pre></section>';
 const css=':root{font:14px/1.5 Arial,Helvetica,sans-serif;color:#202020;background:white}*{box-sizing:border-box}body{max-width:1400px;margin:32px auto;padding:0 24px}header{border-bottom:2px solid #222;padding-bottom:20px}.eyebrow{font-size:11px;letter-spacing:.1em}h1{font-size:28px;line-height:1.2}h2{font-size:21px;line-height:1.3;margin:26px 0 12px}h3{font-size:16px}small{font-size:12px;font-weight:400;color:#555}dl{display:grid;grid-template-columns:170px minmax(0,1fr);gap:6px 18px}dt{font-weight:bold}dd{margin:0;overflow-wrap:anywhere}nav{display:flex;flex-wrap:wrap;gap:8px 18px;padding:18px 0;border-bottom:1px solid #ccc}a{color:#222;text-decoration:underline}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccc;padding:9px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,Consolas,monospace;padding:14px;background:#f6f6f6;border:1px solid #ddd;max-height:600px;overflow:auto}details{border:1px solid #ccc;padding:10px;margin:8px 0}summary{cursor:pointer;font-size:12px;font-weight:bold}section{margin:26px 0}.empty{padding:14px;background:#f5f5f5}@media(max-width:600px){body{padding:0 12px;margin:20px auto}h1{font-size:24px}dl{grid-template-columns:110px minmax(0,1fr)}table{min-width:620px}nav{gap:8px 12px}}@media print{body{max-width:none;margin:0;padding:0;font-size:10px}nav{display:none}h1,h2,h3{break-after:avoid}.table-scroll{overflow:visible}table{min-width:0;font-size:9px;table-layout:fixed}th,td{padding:5px}pre{max-height:none;overflow:visible;font-size:8px}details>pre{display:block!important}section{break-before:auto}header{break-after:avoid}a{color:inherit}}';
 return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>Paycashless · Invoice, payment and settlement report</title><style>'+css+'</style></head><body>'+body+'</body></html>\n';
}
export function paycashlessReport(data){
 if(!data||data.schema!=='paycashless.payment-reconciliation.v1')throw Object.assign(new Error('Select a complete Paycashless reconciliation edition.'),{code:'RECONCILIATION_REQUIRED'});
 for(const key of GROUPS)if(!Array.isArray(data[key]))throw Object.assign(new Error('Complete reconciliation array required: '+key),{code:'REPORT_SELECTION_INCOMPLETE'});
 return {json:pretty(data)+'\n',csv:fullCSV(data),html:fullHTML(data)};
}
