/** Paired review of complete retained concentration/discharge calculations. */
import {readFlowLoadResult} from './flow_results.mjs';
import {readFlowStudy,previewFlowStudy} from './flow_workspace.mjs';
import {runFlowStudyLoads} from './flow_loads.mjs';
import {flowLoadFiles} from './flow_bundles.mjs';
import {zipMembers} from './collection_zip.mjs';
import {hash,stable} from './normalise.mjs';
import {InputError,csv} from './parse.mjs';

export const FLOW_LOAD_COMPARISON='upstate.flow-load-result-comparison/v1';
const clone=value=>JSON.parse(JSON.stringify(value));
const json=value=>JSON.stringify(value,null,2)+'\n';
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const equal=(a,b)=>stable(a)===stable(b);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=value=>value===null||value===undefined?'—':Number(value).toLocaleString('en-US',{maximumSignificantDigits:10});
function fail(message){throw new InputError(message,409);}
function selection(input){
 if(!input||typeof input!=='object')throw new InputError('Choose two original saved load results.');
 for(const field of ['before_id','after_id'])if(typeof input[field]!=='string'||!/^[a-f0-9]{64}$/.test(input[field]))throw new InputError('Choose the complete original '+field+'.');
 if(input.before_id===input.after_id)throw new InputError('Choose two different saved load results.');
 if(input.expected_comparison_id!==undefined&&(typeof input.expected_comparison_id!=='string'||!/^[a-f0-9]{64}$/.test(input.expected_comparison_id)))throw new InputError('Retain the complete original comparison identity.');
 return {before_id:input.before_id,after_id:input.after_id,...(input.expected_comparison_id?{expected_comparison_id:input.expected_comparison_id}:{})};
}
function validate(result,parent){
 if(result?.schema!=='upstate.flow-study-loads/v1'||!result.integration||!Array.isArray(result.integration.series))fail('Retain the complete original load calculation.');
 const {id,title,...calculation}=result;
 if(!/^[a-f0-9]{64}$/.test(id||'')||hash(stable(calculation))!==id)fail('The original load calculation differs from its identity.');
 if(parent?.schema!=='upstate.daily-flow-study/v1'||parent.id!==hash(stable(parent.input))||parent.edition?.id!==parent.id||result.flow_study_id!==parent.id||result.flow_edition_id!==parent.edition.id)fail('The original load result and complete parent study differ.');
 if(result.contract_sha256!==hash(stable(result.integration.contract)))fail('The original load contract differs.');
}
function changes(before,after,path=''){
 if(equal(before,after))return [];
 if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after)){
  return [...new Set([...Object.keys(before),...Object.keys(after)])].sort().flatMap(key=>{
   const p=path+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'),bp=own(before,key),ap=own(after,key);
   return bp&&ap?changes(before[key],after[key],p):[{path:p,before_present:bp,after_present:ap,before:bp?clone(before[key]):null,after:ap?clone(after[key]):null}];
  });
 }
 return [{path:path||'/',before_present:true,after_present:true,before:clone(before),after:clone(after)}];
}
function indexed(rows,key,label){
 const map=new Map();for(const row of rows){const k=key(row);if(map.has(k))fail('The original '+label+' repeats an exact comparison key; retain and review the complete result.');map.set(k,row);}return map;
}
function paired(before,after,key,label,review){
 const a=indexed(before,key,label),b=indexed(after,key,label);
 return [...new Set([...a.keys(),...b.keys()])].sort().map(k=>{
  const x=a.get(k)||null,y=b.get(k)||null;
  return {key:k,before:x,after:y,status:!x?'added':!y?'removed':equal(x,y)?'unchanged':'changed',comparison:review(x,y,k)};
 });
}
function count(rows){return {before:rows.filter(r=>r.before).length,after:rows.filter(r=>r.after).length,...Object.fromEntries(['added','removed','changed','unchanged'].map(k=>[k,rows.filter(r=>r.status===k).length]))};}
function seriesSummary(s){
 const {daily,periods,annual,...summary}=s;
 return {...summary,daily_rows:daily.length,quantified_days:daily.filter(d=>finite(d.load_lower_kg)).length,period_rows:periods.length,calendar_rows:annual.length};
}
function quantityReasons(before,after,b,a){
 const reasons=[];
 if(!b||!a){reasons.push(!b?'Series is absent from the earlier result.':'Series is absent from the later result.');return reasons;}
 if(b.series_key!==a.series_key)reasons.push('Original station, quantity, fraction or analytical method differs.');
 if(before.integration.schema!==after.integration.schema||before.integration.method!==after.integration.method||!equal(before.integration.mass_conversion,after.integration.mass_conversion))reasons.push('Original integration method edition or mass conversion differs.');
 if(before.integration.contract.daily_concentration_basis!==after.integration.contract.daily_concentration_basis)reasons.push('Original concentration/discharge temporal approximation differs.');
 if(b.support?.admitted!==true||a.support?.admitted!==true)reasons.push('Both original series require accepted matching concentration and discharge support.');
 if(!equal(b.support,a.support))reasons.push('Original station, gauge, catchment or support assertion differs.');
 return reasons;
}
function review(reasons,b,a,fields=[]){
 if(!b||!a)reasons=[...reasons,!b?'Original row exists only in the later result.':'Original row exists only in the earlier result.'];
 const compatible=reasons.length===0;
 return {compatible,reasons:[...new Set(reasons)],changes:compatible?Object.fromEntries(fields.filter(k=>finite(b[k])&&finite(a[k])).map(k=>[k,a[k]-b[k]])):{}};
}
function summary(result){return {id:result.id,title:result.title,flow_study_id:result.flow_study_id,contract_sha256:result.contract_sha256,period:clone(result.integration.contract.period),method_edition:result.integration.schema,counts:clone(result.integration.counts)};}
function periodRows(result){
 const rows=result.integration.series.flatMap(s=>[
  ...s.periods.map((r,index)=>({...r,kind:index===0?'selected_period':'season',series_key:s.series_key})),
  ...s.annual.map(r=>({...r,kind:'calendar_year',series_key:s.series_key}))
 ]);
 // Original contracts may repeat a season label/interval. Retain each original
 // occurrence instead of rejecting or collapsing those complete saved rows.
 const occurrences=new Map();
 return rows.map(r=>{const key=JSON.stringify([r.series_key,r.kind,r.label,r.period_start,r.period_end,r.period_end_exclusive]),n=occurrences.get(key)||0;occurrences.set(key,n+1);return {...r,period_occurrence:n};});
}
function quantifiedDates(series,period){return series.daily.filter(r=>r.date>=period.period_start&&r.date<period.period_end&&finite(r.load_lower_kg)).map(r=>r.date).sort();}
export function flowLoadComparisonFromResults(before,beforeStudy,after,afterStudy,expectedId){
 validate(before,beforeStudy);validate(after,afterStudy);selection({before_id:before.id,after_id:after.id,...(expectedId?{expected_comparison_id:expectedId}:{})});
 const bs=indexed(before.integration.series,r=>r.series_key,'earlier series'),as=indexed(after.integration.series,r=>r.series_key,'later series');
 const reasons=key=>quantityReasons(before,after,bs.get(key),as.get(key));
 const series=paired(before.integration.series.map(seriesSummary),after.integration.series.map(seriesSummary),r=>r.series_key,'series',(b,a,key)=>review(reasons(key),b,a));
 const daily=paired(before.integration.series.flatMap(s=>s.daily),after.integration.series.flatMap(s=>s.daily),r=>JSON.stringify([r.series_key,r.date]),'daily row',(b,a)=>{
  const q=b||a,why=reasons(q.series_key);
  if(b&&a&&(b.date!==a.date||b.gauge_id!==a.gauge_id))why.push('Original reporting date or discharge gauge differs.');
  if(b&&a&&(!finite(b.load_lower_kg)||!finite(a.load_lower_kg)))why.push('Both original days require quantified mass support.');
  return review(why,b,a,['load_kg','concentration_mg_l','discharge_m3_s']);
 });
 const periods=paired(periodRows(before),periodRows(after),r=>JSON.stringify([r.series_key,r.kind,r.label,r.period_start,r.period_end,r.period_end_exclusive,r.period_occurrence]),'period row',(b,a)=>{
  const q=b||a,why=reasons(q.series_key);
  if(b&&a){
   if(b.period_end_exclusive!==true||a.period_end_exclusive!==true||b.quantity_basis!=='mass_over_quantified_days'||a.quantity_basis!=='mass_over_quantified_days'||b.annualized!==false||a.annualized!==false)why.push('Original interval or mass-over-quantified-days basis differs.');
   if(b.whole_calendar_year!==a.whole_calendar_year)why.push('Original full calendar-year support differs.');
   if(!equal(quantifiedDates(bs.get(q.series_key),b),quantifiedDates(as.get(q.series_key),a)))why.push('The actual quantified dates differ; equal day counts alone do not establish equal coverage.');
   if(!finite(b.load_lower_kg)||!finite(a.load_lower_kg))why.push('Both original periods require quantified mass support.');
  }
  return review(why,b,a,['load_kg','quantified_flow_volume_m3','flow_weighted_concentration_mg_l']);
 });
 const context=paired(before.integration.source_samples,after.integration.source_samples,r=>r.id,'original sample',(b,a)=>({compatible:false,reasons:['Original sample and interpretation context are retained on both sides.'],changes:{}}));
 const comparison={schema:FLOW_LOAD_COMPARISON,before_id:before.id,after_id:after.id,before:summary(before),after:summary(after),
  interpretation:{difference_direction:'later minus earlier',series_matching:'Exact original station, quantity, fraction, method and chemical-basis series key; no automatic equivalence.',
   quantified_period_support:'Point differences require identical original quantified dates, accepted equal spatial support and the original physical quantity/method.',
   censoring:'Each original lower/upper censor bound is retained. Point differences use finite point estimates on both sides only.',
   source_and_contract_changes:'Displayed separately. A joint change is a difference between complete calculations; it does not attribute an effect to a single assumption.',
   annual_rows:'Calendar-period rows retain their original partial/full coverage; native annual admissibility stays in each original annual-loads.csv.'},
  contract_changes:changes(before.integration.contract,after.integration.contract),
  source_changes:changes(before.source_binding,after.source_binding),
  series,daily,periods,context};
 comparison.counts={series:count(series),daily:count(daily),periods:count(periods),context:count(context),contract_changes:comparison.contract_changes.length,source_changes:comparison.source_changes.length};
 const id=hash(stable(comparison));if(expectedId&&expectedId!==id)fail('The retained comparison or source method differs. Keep the original complete product and inspect the new comparison.');
 return {schema:'upstate.complete-flow-load-comparison/v1',id,before,beforeStudy,after,afterStudy,comparison:{...comparison,id},selection:{before_id:before.id,after_id:after.id,expected_comparison_id:id}};
}
export function readFlowLoadComparison(workspace,input){
 const chosen=selection(input);
 return workspace.readConsistent(()=>{const b=readFlowLoadResult(workspace,chosen.before_id),a=readFlowLoadResult(workspace,chosen.after_id);return flowLoadComparisonFromResults(b,readFlowStudy(workspace,b.flow_study_id),a,readFlowStudy(workspace,a.flow_study_id),chosen.expected_comparison_id);});
}
export function reopenFlowLoadComparison(before,beforeStudy,after,afterStudy,expectedId){
 const standalone={readConsistent:fn=>fn(),source:()=>{throw new InputError('Retain complete original source bodies.');},iterate:()=>{throw new InputError('Retain complete original source bodies.');}};
 const rebuilt=new Map();
 for(const [result,parent] of [[before,beforeStudy],[after,afterStudy]]){
  validate(result,parent);
  if(!rebuilt.has(parent.id)){if(!equal(previewFlowStudy(standalone,parent.input),parent))fail('The parent study differs from its complete original source reconstruction.');rebuilt.set(parent.id,parent);}
  else if(!equal(rebuilt.get(parent.id),parent))fail('The second retained copy of the same original parent differs.');
  const calculation=runFlowStudyLoads(parent,result.integration.contract),expected={...calculation,id:hash(stable(calculation)),title:parent.input.title};
  if(!equal(expected,result))fail('The retained load result differs from its original source and method reconstruction.');
 }
 return flowLoadComparisonFromResults(before,beforeStudy,after,afterStudy,expectedId);
}
export function flowLoadComparisonCSV(product){
 const out=[];for(const kind of ['contract_changes','source_changes'])for(const r of product.comparison[kind])out.push({kind,key:r.path,status:'changed',before_present:r.before_present,after_present:r.after_present,before:r.before,after:r.after,point_changes:{}});
 for(const kind of ['series','daily','periods','context'])for(const r of product.comparison[kind])out.push({kind,key:r.key,status:r.status,before_present:r.before!==null,after_present:r.after!==null,compatible:r.comparison.compatible,reasons:r.comparison.reasons,before:r.before,after:r.after,point_changes:r.comparison.changes});
 return csv(out,['kind','key','status','before_present','after_present','compatible','reasons','before','after','point_changes']);
}
function table(headers,rows,label){return '<div class="scroll" role="region" tabindex="0" aria-label="'+esc(label)+'"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';}
function td(values){return '<tr>'+values.map(v=>'<td>'+v+'</td>').join('')+'</tr>';}
function mass(r){return !r?'—':finite(r.load_kg)?num(r.load_kg)+' kg':finite(r.load_lower_kg)&&finite(r.load_upper_kg)?'['+num(r.load_lower_kg)+', '+num(r.load_upper_kg)+'] kg':'Unquantified';}
function detail(value){return '<details><summary>Original fields</summary><pre>'+esc(json(value))+'</pre></details>';}
function rowText(kind,r){
 if(!r)return 'Absent';
 if(kind==='series')return esc(r.station_id)+'<br>'+esc(r.characteristic)+' / '+esc(r.sample_fraction)+' / '+esc(r.method_id)+'<br>'+esc(r.status)+' · '+num(r.usable_sample_count)+' usable of '+num(r.source_sample_count)+' samples<br>'+esc(r.series_context?.chemical_basis||'')+detail(r);
 if(kind==='daily')return esc(r.date)+'<br>'+mass(r)+'<br>Concentration '+num(r.concentration_mg_l)+' mg/L · daily mean discharge '+num(r.discharge_m3_s)+' m³/s<br>'+esc(r.concentration_basis||'')+'<br>'+esc((r.issues||[]).join('; '))+detail(r);
 if(kind==='periods')return esc(r.kind)+' · '+esc(r.label)+'<br>'+esc(r.period_start)+' to '+esc(r.period_end)+' (end exclusive)<br>'+mass(r)+'<br>'+num(r.quantified_days)+' / '+num(r.expected_days)+' days · '+num(r.quantified_flow_volume_m3)+' m³<br>Flow-weighted concentration '+num(r.flow_weighted_concentration_mg_l)+' mg/L'+detail(r);
 const o=r.original||{};
 return esc(r.station_id)+' · '+esc(r.date)+'<br>'+esc(r.characteristic)+' / '+esc(r.sample_fraction)+' / '+esc(r.method_id)+'<br>Original '+esc(o.value??'')+' '+esc(o.unit??'')+'<br>'+esc(o.detection_condition||'')+(o.limit_value!==undefined?' · limit '+esc(o.limit_value)+' '+esc(o.limit_unit||''):'')+'<br>'+esc(r.usable?'Usable concentration':'Retained context')+' · '+esc((r.issues||[]).join('; '))+detail(r);
}
export function renderFlowLoadComparison(product){
 const c=product.comparison;
 const head='<div class="pair">'+[['Earlier',c.before,'before'],['Later',c.after,'after']].map(([label,s,dir])=>'<section><h2>'+label+' result</h2><p>'+esc(s.title)+'</p><p class="id">'+esc(s.id)+'</p><p>'+esc(s.period.start)+' to '+esc(s.period.end)+' (end exclusive)</p><p>'+num(s.counts.source_samples)+' original samples · '+num(s.counts.support_admitted_series)+' spatially admitted series · '+num(s.counts.quantified_days)+' quantified series-days</p><p><a href="'+dir+'/report.html">Complete original report</a> · <a href="'+dir+'/flow-loads.json">Calculation</a> · <a href="'+dir+'/flow-study.json">Full original parent</a> · <a href="'+dir+'/contract.json">Contract</a></p></section>').join('')+'</div>';
 const counts=table(['Original category','Earlier','Later','Added','Removed','Changed','Unchanged'],['series','daily','periods','context'].map(k=>td([esc(k),...['before','after','added','removed','changed','unchanged'].map(f=>num(c.counts[k][f]))])),'Complete comparison counts');
 const differences=['contract_changes','source_changes'].map(kind=>'<h2>'+esc(kind==='contract_changes'?'Scientific contract changes':'Original source and support changes')+'</h2>'+(c[kind].length?table(['Field','Earlier','Later'],c[kind].map(r=>td(['<span class="id">'+esc(r.path)+'</span>',r.before_present?'<pre>'+esc(json(r.before))+'</pre>':'Absent',r.after_present?'<pre>'+esc(json(r.after))+'</pre>':'Absent'])),kind):'<p>Unchanged.</p>')).join('');
 const sections=['series','periods','daily','context'].map(kind=>'<h2>'+esc({series:'Original series and support',periods:'Selected, seasonal and calendar periods',daily:'Every original daily calculation',context:'Every original sample and interpretation'}[kind])+'</h2>'+(c[kind].length?table(['Original identity / status','Earlier','Later','Comparison'],c[kind].map(r=>td(['<span class="id">'+esc(r.key)+'</span><br>'+esc(r.status),rowText(kind,r.before),rowText(kind,r.after),(r.comparison.compatible?'Compatible original quantity/support.':'')+'<p>'+esc(r.comparison.reasons.join(' '))+'</p>'+(Object.keys(r.comparison.changes).length?'<pre>'+esc(json(r.comparison.changes))+'</pre>':'')])),kind):'<p>No original rows in either selected result.</p>')).join('');
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Original concentration and discharge comparison</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#222;background:#fff;max-width:1180px;margin:2rem auto;padding:0 1rem}h1,h2,h3{line-height:1.2}a{color:inherit;text-decoration:underline}.id{font-family:ui-monospace,monospace;overflow-wrap:anywhere}.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.pair section{border:1px solid #bbb;padding:1rem;min-width:0}.scroll{overflow:auto;max-width:100%;margin:1rem 0;border:1px solid #bbb}table{border-collapse:collapse;width:100%;min-width:740px}th,td{padding:.6rem;text-align:left;vertical-align:top;border-bottom:1px solid #ddd;max-width:420px;overflow-wrap:anywhere}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;font-size:.82rem}.notice{background:#f3f3f3;border-left:4px solid #777;padding:1rem}details{margin:.5rem 0}footer{margin-top:2rem;border-top:1px solid #bbb;padding-top:1rem;overflow-wrap:anywhere}@media(max-width:600px){body{margin:1rem auto}.pair{grid-template-columns:1fr}}</style></head><body><header><p>TJLabs · Upper Savannah · Original scientific calculations</p><h1>Concentration and discharge comparison</h1><p class="id">'+esc(c.id)+'</p></header>'+head+'<div class="notice">'+Object.values(c.interpretation).map(v=>'<p>'+esc(v)+'</p>').join('')+'</div><p><a href="load-comparison.json">Complete comparison JSON</a> · <a href="load-comparison.csv">Complete comparison CSV</a> · <a href="load-comparison-selection.json">Original selection</a> · <a href="README.txt">Reopen instructions</a></p>'+counts+differences+sections+'<footer>Original saved results, contracts, source records, quantified-day support and censoring bounds remain in the two complete sibling folders. Keep the entire product together for offline links.</footer></body></html>\n';
}
export function flowLoadComparisonFiles(product){
 const files={'report.html':renderFlowLoadComparison(product),'load-comparison.json':json(product.comparison),'load-comparison.csv':flowLoadComparisonCSV(product),'load-comparison-selection.json':json(product.selection),
  'README.txt':'TJLabs · Complete original concentration/discharge comparison\n\nOpen report.html and keep all files together. before/ and after/ retain both complete original saved calculations, source parents, contracts and original CSVs. Comparisons keep each original physical quantity, support, period and censor bound. Point differences require equal quantified support; changed assumptions and source inputs are displayed separately.\n\nFrom the complete application source, independently rebuild with:\nnode source_tools/flow_load_comparisons.mjs --before before/flow-loads.json --before-study before/flow-study.json --after after/flow-loads.json --after-study after/flow-study.json --selection load-comparison-selection.json --output A_NEW_DIRECTORY\n\nExisting Measurements can receive each original flow-study.json and preview/save its unchanged contract.json. The original full Measurements portable workspace reopens its existing stored result identities.\n'};
 for(const [prefix,result,parent] of [['before',product.before,product.beforeStudy],['after',product.after,product.afterStudy]])for(const [name,body] of Object.entries(flowLoadFiles(result,parent)))files[prefix+'/'+name]=body;
 return files;
}
export function flowLoadComparisonBundle(product){
 const members=Object.entries(flowLoadComparisonFiles(product)).map(([name,data])=>({name,data:Buffer.from(data)}));
 const manifest={schema:'upstate.complete-flow-load-comparison-files/v1',id:product.id,selection:product.selection,files:members.map(m=>({path:m.name,bytes:m.data.length,sha256:hash(m.data)}))};
 members.push({name:'manifest.json',data:Buffer.from(json(manifest))});const body=zipMembers(members);
 return {name:'load-comparison-'+product.id.slice(0,16)+'.zip',type:'application/zip',bytes:body.length,sha256:hash(body),base64:body.toString('base64'),comparison_id:product.id,before_id:product.before.id,after_id:product.after.id};
}
export function flowLoadComparisonOperation(workspace,method,parts,input={}){
 if(method!=='POST'||parts.length!==1||!['load-comparison','load-comparison-report','load-comparison-csv','load-comparison-bundle'].includes(parts[0]))throw new InputError('Saved load comparison operation not found',404);
 const product=readFlowLoadComparison(workspace,input),op=parts[0];
 if(op==='load-comparison')return product.comparison;
 if(op==='load-comparison-bundle')return flowLoadComparisonBundle(product);
 const content=op.endsWith('-csv')?flowLoadComparisonCSV(product):renderFlowLoadComparison(product),body=Buffer.from(content);
 return {name:'load-comparison-'+product.id.slice(0,16)+(op.endsWith('-csv')?'.csv':'.html'),type:op.endsWith('-csv')?'text/csv; charset=utf-8':'text/html; charset=utf-8',content,bytes:body.length,sha256:hash(body),comparison_id:product.id,before_id:product.before.id,after_id:product.after.id};
}
