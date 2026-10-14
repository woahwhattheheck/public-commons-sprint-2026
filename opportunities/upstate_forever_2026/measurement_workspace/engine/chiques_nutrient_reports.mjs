/** Complete, offline-readable source inspection; no scientific calculation is performed. */
import {InputError,csv} from './parse.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function checked(report){if(report?.schema!=='upstate.chiques-nutrient-source-review/v1'||!Array.isArray(report.tables)||report.tables.length!==2)throw new InputError('Choose the complete nutrient source review');return report;}
export function chiquesSourceCSV(report){
 return csv(checked(report).tables.flatMap(t=>t.rows.flatMap(r=>r.values.map(v=>({table:t.kind,sourceFile:r.sourceFile,sourceSha256:r.sourceSha256,line:r.line,sampleAt:r.sampleAt,sensorAt:r.sensorAt,sensorMinusSampleSeconds:r.deltaSeconds,...v,fullOriginalRow:r.raw})))),['table','sourceFile','sourceSha256','line','sampleAt','sensorAt','sensorMinusSampleSeconds','column','characteristic','unit','role','clock','sourceValue','value','transformColumn','transform','publishedTransform','expectedTransform','status','fullOriginalRow']);
}
export function chiquesSourceHTML(input){
 const r=checked(input),c=r.corrections;
 const table=(headers,rows)=>'<div class="scroll"><table><thead><tr>'+headers.map(v=>'<th>'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chiques nutrient calibration sources</title><style>body{font:15px/1.55 system-ui,sans-serif;color:#252525;background:#fff;max-width:1200px;margin:30px auto;padding:0 20px}h1{font-size:28px;line-height:1.2}h2{margin-top:32px}a{color:#222}table{border-collapse:collapse;min-width:760px;width:100%}th,td{padding:9px;border:1px solid #ccc;text-align:left;vertical-align:top}th{background:#eee}.scroll{overflow:auto;max-width:100%}code,pre{overflow-wrap:anywhere;white-space:pre-wrap}details{border:1px solid #ccc;padding:10px;margin:10px 0}summary{cursor:pointer;font-weight:600}.identity{font-size:12px}.notice{padding:12px;background:#f3f3f3;border-left:3px solid #777}li{margin:6px 0}@media(max-width:600px){body{margin:16px auto;padding:0 12px}h1{font-size:24px}}</style></head><body>'+
 '<h1>Chiques nutrient calibration sources</h1><p>'+esc(r.metadata.support)+'</p><p class="notice">Original sources and source diagnostics. Scientific review is pending in the original Measurements workspace; no model is fitted, nitrate correction reapplied or load calculated.</p>'+
 '<p>Keep this complete collection together. <a href="nutrient-source-review.json">Full source review JSON</a> · <a href="nutrient-source-diagnostics.csv">All original source values and diagnostics CSV</a></p>'+
 '<p class="identity">Source selection <code>'+esc(r.sourceIdentity)+'</code><br>Review <code>'+esc(r.sha256)+'</code></p>'+
 '<h2>Original source conventions</h2><ul>'+['time','fractions','corrections','transforms','sampling'].map(k=>'<li>'+esc(r.metadata[k])+'</li>').join('')+'</ul>'+
 '<h2>Source coverage</h2>'+table(['Original publisher file','Bytes / MD5','This collection'],r.publisherInventory.map(f=>[
  f.retained?'<a href="originals/'+encodeURIComponent(f.name)+'">'+esc(f.name)+'</a>':esc(f.name),
  esc(f.bytes)+'<br><code>'+esc(f.md5)+'</code>',
  f.retained?'Retained exact original<br><code>'+esc(f.sha256)+'</code>':'Not selected — original publisher entry retained'
 ]))+
 '<h2>Nitrate-correction evidence</h2><p>'+esc(c.status)+' · '+esc(c.name)+'. Workbook cells have not been interpreted by this adapter. The published NOx calibration cells remain unchanged. Use the original workbook in its normal spreadsheet viewer before making any correction decision.</p>'+
 '<h2>Complete source tables</h2>'+r.tables.map(t=>'<section><h3>'+esc(t.kind.toUpperCase())+' — '+esc(t.sourceFile)+'</h3><p>'+t.summary.originalRows+' original rows · '+t.summary.projectedRows+' individual original cells · '+t.summary.missingValues+' empty measured cells retained.</p>'+
 '<details><summary>Projection and diagnostic counts</summary><pre>'+esc(JSON.stringify(t.summary,null,2))+'</pre></details>'+
 table(['Original row','Sample / sensor UTC','Exact source values','Original transformed values','Full original row'],t.rows.map(row=>[
  String(row.line),esc(row.sampleAt)+'<br>'+esc(row.sensorAt)+'<br>'+row.deltaSeconds+' seconds sensor−sample',
  row.values.map(v=>esc(v.column)+': '+(v.sourceValue===''?'[empty]':esc(v.sourceValue))+' '+esc(v.unit)+'<br><small>'+esc(v.clock)+'</small>').join('<hr>'),
  row.values.map(v=>esc(v.transformColumn)+': '+(v.publishedTransform===''?'[empty]':esc(v.publishedTransform))+'<br>'+esc(v.status)).join('<hr>'),
  '<details><summary>Open all original fields</summary><pre>'+esc(JSON.stringify(row.raw,null,2))+'</pre></details>'
 ]))+'</section>').join('')+
 '<h2>Receiving and subsequent scientific work</h2><p>The source collection carries the original table bytes, original documentation and an explicitly attributed long-table projection. Receive it with the maintained Measurements collection workflow. Each projected record points to its exact original filename, SHA256, physical row and column. Existing source review, mapping, source reconciliation and editable workspace export retain their original meanings.</p><p>NOx remains nitrate plus nitrite. The current calibration exporter may exclude parameters or records lacking the required reach/source review. Such exclusions are retained; source intake does not change downstream eligibility.</p><p class="notice">'+esc(r.assessment.sourceFamilyIndependence)+'</p><p>TokenJunkieLabs · Complete original-source receiving for the existing Ecosystem Sciences workbench.</p></body></html>';
}
