// MIT. The existing private workspace exposes the complete comparison as read-only source/result tools.
import {readFile} from 'node:fs/promises';
import {analyseDocumentComparison,createDocumentComparisonDelivery,inspectDocumentComparisonDelivery} from './document-comparison.mjs';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const show=v=>v===null?'Not observed':v.present===false?'Absent':typeof v.value==='object'?JSON.stringify(v.value):String(v.value??'');
const cell=(v,header=false)=>'<'+(header?'th':'td')+'>'+esc(v)+'</'+(header?'th':'td')+'>';
const tr=(values,header=false)=>'<tr>'+values.map(v=>cell(v,header)).join('')+'</tr>';
const csv=v=>{let s=String(v??'');if(/^[=+@\t\r-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
function render(report,review){
 const decisions=new Map((review?.decisions??[]).map(x=>[x.key,x]));
 const rows=report.rows.map(r=>tr([r.key,r.label,r.status,r.content.status,decisions.get(r.key)?.decision??'UNREVIEWED',decisions.get(r.key)?.note??''])).join('');
 const details=report.rows.map(r=>'<section><h2>'+esc(r.label)+'</h2><p>'+esc(r.key)+' · '+esc(r.status)+'</p><dl><dt>Source</dt><dd>'+esc(JSON.stringify(r.source))+'</dd><dt>Target</dt><dd>'+esc(JSON.stringify(r.target))+'</dd></dl><table><thead>'+tr(['Field','Source','Target','Observation'],true)+'</thead><tbody>'+tr(['Complete content',r.content.source?JSON.stringify(r.content.source):'Not observed',r.content.target?JSON.stringify(r.content.target):'Not observed',r.content.status])+r.fields.map(f=>tr([f.label,show(f.source),show(f.target),f.status+(f.error?' · '+f.error:'')])).join('')+'</tbody></table></section>').join('');
 return'<!doctype html>\n<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(report.label)+'</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#161616;margin:0 auto;padding:28px;max-width:1100px}h1{font-size:1.7rem}h2{font-size:1.2rem}p,dd{overflow-wrap:anywhere}section{margin-top:32px;border-top:1px solid #bbb;padding-top:16px}table{border-collapse:collapse;width:100%;font-size:.9rem;display:block;overflow:auto}th,td{border:1px solid #bbb;padding:8px 10px;text-align:left;vertical-align:top;overflow-wrap:anywhere;min-width:100px}th{background:#eee}dt{font-weight:650}dd{margin:0 0 8px}code{word-break:break-all}.count{font-size:1.1rem}@media(max-width:600px){body{padding:16px}th,td{padding:7px;min-width:90px}}@media print{body{max-width:none;padding:0}table{display:table;font-size:9pt}section{break-inside:avoid}}</style><main><h1>'+esc(report.label)+'</h1><p>'+esc(report.scopeNote)+'</p><p class="count">'+report.counts.selected+' selected · '+report.counts.matched+' matching · '+report.counts.reviewRequired+' need review · '+report.counts.notObserved+' not observed</p><p>Source SHA-256: <code>'+esc(report.source.sha256)+'</code></p><p>'+(review?'Reviewer '+esc(review.reviewer)+' · '+esc(review.reviewedAt):'Manual review has not been recorded.')+'</p><table><thead>'+tr(['Pair','Document','Observation','Content','Disposition','Note'],true)+'</thead><tbody>'+rows+'</tbody></table>'+details+'<section><h2>Method and retained sources</h2>'+Object.entries(report.method).map(([k,v])=>'<p><strong>'+esc(k)+':</strong> '+esc(v)+'</p>').join('')+'<p>Reopen the accompanying complete comparison delivery in the original Document comparison tool. It retains every selected capture, property mapping, source byte identity, report and optional disposition.</p></section></main></html>\n';
}
function rowsCSV(report){
 const rows=[['pair','label','status','source_repository','source_node','source_version','target_repository','target_node','target_version','content_status','source_bytes','source_sha256','target_bytes','target_sha256']];
 for(const r of report.rows)rows.push([r.key,r.label,r.status,r.source.repositoryBaseUrl,r.source.nodeId,r.source.versionId,r.target.repositoryBaseUrl,r.target.nodeId,r.target.versionId,r.content.status,r.content.source?.bytes,r.content.source?.sha256,r.content.target?.bytes,r.content.target?.sha256]);
 return rows.map(row=>row.map(csv).join(',')).join('\r\n')+'\r\n';
}
function fieldsCSV(report){
 const rows=[['pair','field','type','source_path','target_path','required','status','source_value','target_value','error']];
 for(const r of report.rows)for(const f of r.fields)rows.push([r.key,f.key,f.type,f.sourcePath,f.targetPath,f.required,f.status,show(f.source),show(f.target),f.error]);
 return rows.map(row=>row.map(csv).join(',')).join('\r\n')+'\r\n';
}
export async function serveDocumentComparison({method,input}){
 if(method==='example')return{sourceText:await readFile(new URL('./examples/documents/comparison-source.json',import.meta.url),'utf8')};
 if(method==='preview')return{report:analyseDocumentComparison(input?.sourceText)};
 if(method==='delivery'){
  const r=createDocumentComparisonDelivery({sourceText:input?.sourceText,reviewText:input?.reviewText??null});
  return{report:r.report,deliveryText:r.text,bytes:r.bytes,sha256:r.sha256,html:render(r.report,r.review),pairsCSV:rowsCSV(r.report),fieldsCSV:fieldsCSV(r.report)};
 }
 if(method==='receive'){
  const r=inspectDocumentComparisonDelivery(input?.deliveryText);
  return{...r,html:render(r.report,r.review),pairsCSV:rowsCSV(r.report),fieldsCSV:fieldsCSV(r.report)};
 }
 throw Object.assign(new Error('Select comparison example, preview, delivery or receive.'),{code:'FLOWABLE_DOCUMENT_COMPARISON_METHOD_REQUIRED'});
}
