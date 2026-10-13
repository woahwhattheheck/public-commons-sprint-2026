// MIT. Complete collective-investment reconciliation report exports.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=v=>JSON.stringify(v,null,2),shown=v=>v===null||v===undefined?'Not supplied':typeof v==='object'?pretty(v):String(v);
const title=v=>v==='providerStatus'?'Original provider status':v==='status'?'Reconciliation state':String(v).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());
function cell(v){const s=v===null||v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v);return '"'+(/^[\t\r\n ]*[=+@]/.test(s)||/^[\t\r\n ]*-(?!\d+(?:\.\d+)?$)/.test(s)?"'":'')+s.replaceAll('"','""')+'"';}
function groups(data){return Object.keys(data).filter(key=>Array.isArray(data[key]));}
function fullCSV(data){
 const keys=groups(data),columns=['record_group','record_index','resourceId','kind','providerStatus','status','state','sourceScope','environment','proposalId','milestoneId','distributionWalletId','amount','amountUsdc','currency','asset','unit','reconciliationState','evidenceState','versionId','sourceId','code','full_original_record_json'];
 const lines=[columns.map(cell).join(',')];
 function add(group,index,row){lines.push(columns.map(k=>cell(k==='record_group'?group:k==='record_index'?index:k==='full_original_record_json'?row:row?.[k])).join(','));}
 add('scope',0,Object.fromEntries(Object.entries(data).filter(([key])=>!keys.includes(key))));
 for(const key of keys)data[key].forEach((row,index)=>add(key,index,row));
 return lines.join('\r\n')+'\r\n';
}
function table(values){
 if(!values.length)return '<p class="empty">No records in this selected edition.</p>';
 const present=new Set(values.filter(v=>v&&typeof v==='object').flatMap(Object.keys));
 const preferred=['resourceId','kind','providerStatus','status','state','sourceScope','amount','amountUsdc','currency','asset','role','values','reconciliationState','evidenceState','code','reason'];
 const keys=[...preferred.filter(k=>present.has(k)),...present].filter((v,i,a)=>a.indexOf(v)===i).slice(0,9);
 if(!keys.length)return '<pre>'+esc(pretty(values))+'</pre>';
 return '<div class="table-scroll"><table><thead><tr>'+keys.map(k=>'<th>'+esc(title(k))+'</th>').join('')+'</tr></thead><tbody>'+values.map(row=>'<tr>'+keys.map(k=>'<td>'+esc(shown(row?.[k]))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function fullHTML(data){
 const keys=groups(data),scope=Object.fromEntries(Object.entries(data).filter(([k])=>!keys.includes(k)));
 const summary=[['Programme',data.bookId??data.bookVersionId??data.book?.id],['Environment',data.environment??data.book?.environment],['Tenant',data.tenantId??data.book?.tenantId],['Start, inclusive',data.period?.start??data.book?.period?.start],['End, exclusive',data.period?.end??data.book?.period?.end],['Timezone',data.period?.timeZone??data.book?.period?.timeZone]];
 let body='<header><p class="eyebrow">COLLECTIVE INVESTMENT / OPERATIONS</p><h1>Programme, release and payout report</h1><dl>'+summary.map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(shown(v))+'</dd>').join('')+'</dl></header>';
 body+='<nav aria-label="Report sections">'+keys.map((key,i)=>'<a href="#register-'+i+'">'+esc(title(key))+' ('+data[key].length+')</a>').join('')+'</nav>';
 body+='<section><h2>Scope and accounting basis</h2><p>Each observation retains its original provider state and exact amount units. Programme contributions, treasury releases and SDP payments have distinct roles. The saved native reconciliation supplies the findings and totals below.</p><pre>'+esc(pretty(scope))+'</pre></section>';
 for(const[keyIndex,key]of keys.entries()){
 body+='<section id="register-'+keyIndex+'"><h2>'+esc(title(key))+' <small>'+data[key].length+' records</small></h2>'+table(data[key]);
 for(const[index,row]of data[key].entries())body+='<details><summary>Complete record '+(index+1)+(row?.resourceId?' · '+esc(row.resourceId):row?.id?' · '+esc(row.id):'')+'</summary><pre>'+esc(pretty(row))+'</pre></details>';
 body+='</section>';
 }
 body+='<section><h2>Complete unchanged reconciliation</h2><pre>'+esc(pretty(data))+'</pre></section>';
 const css=':root{font:14px/1.5 Arial,Helvetica,sans-serif;color:#222;background:#fff}*{box-sizing:border-box}body{max-width:1400px;margin:32px auto;padding:0 24px}header{border-bottom:2px solid #222;padding-bottom:20px}.eyebrow{font-size:11px;letter-spacing:.1em}h1{font-size:28px;line-height:1.2}h2{font-size:21px;line-height:1.3;margin:26px 0 12px}small{font-size:12px;font-weight:400;color:#555}dl{display:grid;grid-template-columns:170px minmax(0,1fr);gap:6px 18px}dt{font-weight:bold}dd{margin:0;overflow-wrap:anywhere}nav{display:flex;flex-wrap:wrap;gap:8px 18px;padding:18px 0;border-bottom:1px solid #ccc}a{color:#222}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccc;padding:9px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,Consolas,monospace;padding:14px;background:#f6f6f6;border:1px solid #ddd;max-height:600px;overflow:auto}details{border:1px solid #ccc;padding:10px;margin:8px 0}summary{cursor:pointer;font-size:12px;font-weight:bold}section{margin:26px 0}.empty{padding:14px;background:#f5f5f5}@media(max-width:600px){body{padding:0 12px;margin:20px auto}h1{font-size:24px}dl{grid-template-columns:110px minmax(0,1fr)}table{min-width:620px}}@media print{body{max-width:none;margin:0;padding:0;font-size:10px}nav{display:none}h1,h2{break-after:avoid}.table-scroll{overflow:visible}table{min-width:0;font-size:9px;table-layout:fixed}th,td{padding:5px}pre{max-height:none;overflow:visible;font-size:8px}details>pre{display:block!important}}';
 return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>Collective investment · Programme and payout report</title><style>'+css+'</style></head><body>'+body+'</body></html>\n';
}
export function ameroReport(data){
 if(!data||typeof data!=='object'||data.schema!=='amero.reconciliation.v1')throw Object.assign(new Error('Select a complete collective-investment reconciliation edition.'),{code:'RECONCILIATION_REQUIRED'});
 if(["communities","funds","contributions","tokens","proposals","votes","milestones","evidence","attestations","disbursementRequests","disbursements","sdpDisbursements","payments","receivers","wallets","assets","settlements","events","allocations","decisions","rejectedDecisions","totals","findings","sourceGaps","distributionWallets","balances","capabilities","organizations"].some(key=>!Array.isArray(data[key])))throw Object.assign(new Error('The original reconciliation has no retained registers.'),{code:'REPORT_SELECTION_INCOMPLETE'});
 return {json:pretty(data)+'\n',csv:fullCSV(data),html:fullHTML(data)};
}
