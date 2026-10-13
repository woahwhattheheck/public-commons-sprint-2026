/** Complete comparison products over two retained original Flow studies. */
import {readFlowStudy,previewFlowStudy} from './flow_workspace.mjs';
import {reconcileFlowEditions} from './flow_editions.mjs';
import {flowStudyFiles} from './flow_bundles.mjs';
import {deflatedZipMembers} from './collection_zip.mjs';
import {hash,stable} from './normalise.mjs';
import {InputError,csv} from './parse.mjs';

export const FLOW_COMPARISON_PRODUCT='upstate.complete-flow-comparison/v1';
const json=value=>JSON.stringify(value,null,2)+'\n';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>value===null||value===undefined?'—':Number(value).toLocaleString('en-US',{maximumSignificantDigits:9});
function selection(value){
 if(!value||typeof value!=='object')throw new InputError('Choose the two original saved Flow studies.');
 for(const field of ['before_id','after_id'])if(typeof value[field]!=='string'||!/^[a-f0-9]{64}$/.test(value[field]))throw new InputError('Choose the complete original '+field+'.');
 if(value.before_id===value.after_id)throw new InputError('Choose two different original Flow studies.');
 if(value.expected_comparison_id!==undefined&&!/^[a-f0-9]{64}$/.test(value.expected_comparison_id))throw new InputError('Retain the complete original comparison identity.');
 return {before_id:value.before_id,after_id:value.after_id,...(value.expected_comparison_id?{expected_comparison_id:value.expected_comparison_id}:{})};
}
function validParent(study){
 if(study?.schema!=='upstate.daily-flow-study/v1'||study?.edition?.schema!=='upstate.daily-flow-edition/v1'||study.id!==hash(stable(study.input))||study.edition.id!==study.id)throw new InputError('Retain the complete original Flow study and its original source identity.',409);
}
/** The comparison shape is the existing /flow/compare response, without a new scientific method. */
export function flowComparisonFromStudies(before,after,expectedId){
 validParent(before);validParent(after);selection({before_id:before.id,after_id:after.id,...(expectedId?{expected_comparison_id:expectedId}:{})});
 const comparison={schema:'upstate.daily-flow-study-comparison/v1',before_id:before.id,after_id:after.id,
  comparison:reconcileFlowEditions(before.edition,after.edition),
  periods_before:before.periods,periods_after:after.periods,
  sample_context_before:before.sample_context,sample_context_after:after.sample_context};
 const id=hash(stable(comparison));
 if(expectedId&&expectedId!==id)throw new InputError('The comparison method or retained originals differ from this selected product. Keep its original complete output and inspect the new comparison.',409);
 return {schema:FLOW_COMPARISON_PRODUCT,id,before,after,comparison,
  selection:{before_id:before.id,after_id:after.id,expected_comparison_id:id}};
}
export function readFlowComparison(workspace,input){
 const chosen=selection(input);
 return workspace.readConsistent(()=>flowComparisonFromStudies(readFlowStudy(workspace,chosen.before_id),readFlowStudy(workspace,chosen.after_id),chosen.expected_comparison_id));
}
/** Cold-file reconstruction checks every derived parent against the original source bodies. */
export function reopenFlowComparison(before,after,expectedId){
 const standalone={readConsistent:fn=>fn(),source:()=>{throw new InputError('Use complete retained source bodies for an independent comparison.');},iterate:()=>{throw new InputError('Use complete retained source bodies for an independent comparison.');}};
 for(const study of [before,after]){
  validParent(study);
  if(stable(previewFlowStudy(standalone,study.input))!==stable(study))throw new InputError('The original Flow study differs from its complete source reconstruction.',409);
 }
 return flowComparisonFromStudies(before,after,expectedId);
}
function flowFields(row){
 const f=row?.flow;
 return {availability:row?.status??'',discharge_m3_s:f?.discharge_m3_s??null,
  approval_status:f?.approval_status??'',qualifier:f?.qualifier??'',source_value:f?.source_value??'',
  source_unit:f?.source_unit??'',time_series_id:f?.time_series_id??'',source_id:f?.source_id??'',
  source_sha256:f?.source_sha256??'',source_pointer:f?.source_pointer??'',source_uri:f?.source_uri??'',
  source_time:f?.source_time??'',source_time_zone:f?.source_time_zone??'',
  method:f?.method??null,candidates:row?.candidates??[]};
}
export function flowComparisonCSV(product){
 const rows=product.comparison.comparison.rows.map(row=>{
  const before=flowFields(row.before),after=flowFields(row.after),value={monitoring_location_id:row.monitoring_location_id,date:row.date,changes:row.changes,
   before_selected:!!row.before,after_selected:!!row.after,delta_discharge_m3_s:row.delta_discharge_m3_s};
  for(const [key,v] of Object.entries(before))value['before_'+key]=v;
  for(const [key,v] of Object.entries(after))value['after_'+key]=v;
  return value;
 });
 const fields=['monitoring_location_id','date','changes','before_selected','after_selected','delta_discharge_m3_s',
  ...['before','after'].flatMap(side=>Object.keys(flowFields(null)).map(key=>side+'_'+key))];
 return csv(rows,fields);
}
const styles=':root{color-scheme:light}*{box-sizing:border-box}body{margin:0;color:#222;background:#fff;font:15px/1.5 system-ui,sans-serif}main{max-width:1240px;margin:auto;padding:28px}h1{font-size:28px;line-height:1.2}h2{font-size:21px;margin-top:32px}h3{font-size:17px}.muted,small{color:#555}.links{display:flex;gap:16px;flex-wrap:wrap}a{color:inherit;text-underline-offset:3px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.card{border:1px solid #bbb;padding:14px}.card strong{display:block;font-size:24px}.note{padding:14px;border-left:3px solid #555;background:#f3f3f3}.scroll{max-width:100%;overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}th{background:#f3f3f3}td.numeric{text-align:right;font-variant-numeric:tabular-nums}.rows{min-width:1040px}.sources{min-width:660px}code,a,dd,td,li{overflow-wrap:anywhere}dl{display:grid;grid-template-columns:minmax(110px,160px) 1fr;gap:8px 14px}dd{margin:0}details{margin-top:18px}summary{cursor:pointer;font-weight:600}caption{text-align:left;padding:8px 0}small{display:block}@media(max-width:600px){main{padding:16px}h1{font-size:24px}dl{display:block}dt{margin-top:10px;font-weight:600}.cards{grid-template-columns:1fr 1fr}.card{padding:10px}.card strong{font-size:21px}}@media print{main{padding:8mm;max-width:none}.scroll{overflow:visible}.rows,.sources{min-width:0}table{font-size:9px}tr{break-inside:avoid}h2{break-after:avoid}}';
function table(headers,body,cls=''){
 return '<div class="scroll" tabindex="0" role="region" aria-label="'+esc(headers.join(', '))+'"><table class="'+cls+'"><thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></div>';
}
function summaryTable(before,after){
 let rows='';
 for(const [label,study] of [['Earlier selection',before],['Later selection',after]])for(const row of study.edition.summary){
  rows+='<tr><td>'+esc(label)+'<small>'+esc(row.monitoring_location_id)+'</small></td><td>'+esc(study.edition.start)+' through '+esc(study.edition.end)+'</td><td>'+number(row.quantified_days)+' / '+number(row.expected_days)+'</td><td class="numeric">'+number(row.known_volume_m3)+'</td><td class="numeric">'+number(row.mean_discharge_m3_s)+'</td><td>'+number(row.approved_days)+' / '+number(row.provisional_days)+'</td><td>'+number(row.missing_days)+' / '+number(row.ambiguous_days)+' / '+number(row.unquantified_days)+'</td></tr>';
 }
 return table(['Original selection / station','Selected calendar','Numeric / selected days','Known volume (m³)','Mean on numeric days (m³/s)','Approved / provisional days','Missing / ambiguous / unquantified days'],rows,'rows');
}
function changesTable(rows){
 return table(['Station / reporting date','Changes','Earlier availability / Q (m³/s)','Later availability / Q (m³/s)','Later − earlier Q (m³/s)','Approval: earlier → later','Qualifier: earlier → later','Original source identities'],rows.map(row=>{
  const a=flowFields(row.before),b=flowFields(row.after);
  return '<tr><td>'+esc(row.monitoring_location_id)+'<small>'+esc(row.date)+'</small></td><td>'+esc(row.changes.length?row.changes.join('; '):'No compared value/status change')+'</td><td>'+esc(row.before?a.availability:'Outside selection')+'<small>'+number(a.discharge_m3_s)+'</small></td><td>'+esc(row.after?b.availability:'Outside selection')+'<small>'+number(b.discharge_m3_s)+'</small></td><td class="numeric">'+number(row.delta_discharge_m3_s)+'</td><td>'+esc(a.approval_status||'—')+' → '+esc(b.approval_status||'—')+'</td><td>'+esc(a.qualifier||'(blank)')+' → '+esc(b.qualifier||'(blank)')+'</td><td>'+esc(a.source_id||'—')+'<small>'+esc(a.source_pointer)+'</small>'+esc(b.source_id||'—')+'<small>'+esc(b.source_pointer)+'</small></td></tr>';
 }).join(''),'rows');
}
export function renderFlowComparison(product){
 const {before,after,comparison}=product,rows=comparison.comparison.rows,changed=rows.filter(r=>r.changes.length),shared=rows.filter(r=>r.before&&r.after),
  sharedChanged=shared.filter(r=>r.changes.length),bothNumeric=shared.filter(r=>r.delta_discharge_m3_s!==null),
  earlierOnly=rows.filter(r=>r.before&&!r.after).length,laterOnly=rows.filter(r=>r.after&&!r.before).length;
 const link=(name,url)=>'<a href="'+url+'">'+esc(name)+'</a>';
 let body='<p class="muted">TJLabs · Upper Savannah · Measurements</p><h1>Original discharge edition comparison</h1><p>'+esc(before.input.title)+' → '+esc(after.input.title)+'</p><nav class="links" aria-label="Complete comparison downloads">'+[
  link('Complete comparison JSON','comparison.json'),link('Every station-day CSV','comparison.csv'),link('Original selection','comparison-selection.json'),
  link('Earlier original report','before/report.html'),link('Later original report','after/report.html')].join('')+'</nav>';
 body+='<h2>What changed within the selected calendars</h2><div class="cards">'+[
  ['Shared station-days',shared.length],['Shared days with compared changes',sharedChanged.length],['Shared days with two numeric values',bothNumeric.length],
  ['Only in earlier selection',earlierOnly],['Only in later selection',laterOnly],['All station-days',rows.length]
 ].map(([label,value])=>'<div class="card"><span>'+esc(label)+'</span><strong>'+number(value)+'</strong></div>').join('')+'</div>';
 body+='<p class="note">Earlier and later describe the selected source editions. A day outside one selected calendar is a coverage difference, not a measured flow change. Discharge differences are calculated only where both original days have numeric values. Missing and ambiguous days remain explicit. This comparison retains both selections and does not choose a replacement or infer a trend.</p>';
 body+='<h2>Each original selected window</h2>'+summaryTable(before,after)+'<p>Known volume and mean describe each listed window. Compare equal station/calendar support when interpreting them; a longer selected period is not evidence of increased discharge. The original period files retain month, calendar-year and water-year coverage separately.</p>';
 body+='<h2>Recorded difference types</h2>'+table(['Original comparison field','Station-days'],Object.entries(comparison.comparison.counts).map(([key,value])=>'<tr><td>'+esc(key)+'</td><td class="numeric">'+number(value)+'</td></tr>').join('')||'<tr><td colspan="2">No compared field differs on the selected station-days.</td></tr>')+'<p>A station-day can have several difference types. These counts are overlapping categories.</p>';
 body+='<h2>Changed or differently selected station-days ('+number(changed.length)+')</h2>'+(changed.length?changesTable(changed):'<p>No compared field or selected station-day differs.</p>');
 const unchanged=rows.filter(r=>!r.changes.length);
 body+='<details><summary>All unchanged compared station-days ('+number(unchanged.length)+')</summary>'+(unchanged.length?changesTable(unchanged):'<p>No unchanged shared station-days.</p>')+'</details>';
 body+='<h2>Sampling context retained with each selection</h2>'+table(['Selection','Original result rows','Station-date pairs','Pairs with numeric daily flow','Explicitly matched-catchment samples'],[['Earlier selection',before],['Later selection',after]].map(([label,study])=>{const c=study.sample_context.counts;return '<tr><td>'+esc(label)+'</td><td>'+number(c.samples)+'</td><td>'+number(c.distinct_station_dates)+'</td><td>'+number(c.matched_numeric_dates)+'</td><td>'+number(c.spatially_matched_samples)+'</td></tr>';}).join(''))+'<p>These are the original sample contexts, including repeated activities, source clocks, method/fraction distinctions and spatial evidence. Daily mean discharge is a reporting-day context, not an instantaneous sample-time measurement. No concentration or mass calculation is added here.</p>';
 body+='<h2>Complete originals and independent reopening</h2><p>Keep the entire ZIP together. Each before/ and after/ directory contains its full study, source responses, editable input, readable report and three CSV exports. Receive both flow-study.json files through Measurements → Daily flow, then select the same earlier and later IDs in Compare original editions. The included selection fixes the complete comparison identity.</p><dl><dt>Earlier study</dt><dd><code>'+esc(before.id)+'</code></dd><dt>Later study</dt><dd><code>'+esc(after.id)+'</code></dd><dt>Comparison</dt><dd><code>'+esc(product.id)+'</code></dd></dl>';
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Original discharge edition comparison</title><style>'+styles+'</style><main>'+body+'</main></html>\n';
}
export function flowComparisonFiles(product){
 const files={'report.html':renderFlowComparison(product),'comparison.json':json(product.comparison),
  'comparison.csv':flowComparisonCSV(product),'comparison-selection.json':json(product.selection),
  'README.txt':'TJLabs · Complete original Flow comparison\n\nOpen report.html and keep the full directory together. comparison.csv contains every station-day, including unchanged days and both original source references. before/ and after/ each retain every original source body and their complete independent Flow product.\n\nIn the current application, receive before/flow-study.json and after/flow-study.json through Measurements → Daily flow, then compare the two original IDs. The comparison-selection.json binds both parents and the exact comparison ID. For a source-native rebuild and full original-source verification:\nnode source_tools/flow_comparisons.mjs --before before/flow-study.json --after after/flow-study.json --selection comparison-selection.json --output A_NEW_DIRECTORY\n\nThe same selected product is available from the original SQLite workspace:\nnode measurement_workspace/engine/cli.mjs flow-comparison-bundle --workspace ORIGINAL_MEASUREMENTS --file comparison-selection.json --output A_NEW_FILE.zip\n\nThe selected windows can differ. Volume summaries describe their own windows; days outside one window are not observed flow changes. Provisional/estimated status, source methods, ambiguous days and original sampling/catchment context remain explicit. A newer comparison method may have a different identity; retain this whole original product before preparing a following edition.\n'};
 for(const [side,study] of [['before',product.before],['after',product.after]])for(const [name,content] of Object.entries(flowStudyFiles(study)))files[side+'/'+name]=content;
 return files;
}
export function flowComparisonBundle(product){
 const files=flowComparisonFiles(product),members=Object.entries(files).map(([name,text])=>({name,data:text}));
 const manifest={schema:FLOW_COMPARISON_PRODUCT,id:product.id,selection:product.selection,
  files:members.map(({name,data})=>({path:name,bytes:Buffer.byteLength(data),sha256:hash(data)}))};
 members.push({name:'manifest.json',data:Buffer.from(json(manifest))});
 const bytes=deflatedZipMembers(members);
 return {name:'flow-comparison-'+product.id.slice(0,16)+'.zip',type:'application/zip',bytes:bytes.length,sha256:hash(bytes),base64:bytes.toString('base64'),comparison_id:product.id,before_id:product.before.id,after_id:product.after.id};
}
export function flowComparisonReport(product){
 return {name:'flow-comparison-'+product.id.slice(0,16)+'.html',type:'text/html; charset=utf-8',
  content:renderFlowComparison(product),comparison_id:product.id,before_id:product.before.id,after_id:product.after.id};
}
export function flowComparisonOperation(workspace,method,parts,input={}){
 if(method!=='POST'||parts.length!==1||!['comparison-report','comparison-bundle','comparison-csv'].includes(parts[0]))throw new InputError('Choose a complete original Flow comparison product.',404);
 const product=readFlowComparison(workspace,input);
 if(parts[0]==='comparison-report')return flowComparisonReport(product);
 if(parts[0]==='comparison-bundle')return flowComparisonBundle(product);
 return {name:'flow-comparison-'+product.id.slice(0,16)+'.csv',type:'text/csv; charset=utf-8',content:flowComparisonCSV(product),comparison_id:product.id,before_id:product.before.id,after_id:product.after.id};
}
