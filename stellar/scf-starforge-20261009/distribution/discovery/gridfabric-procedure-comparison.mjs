// MIT. Compare retained GridFabric outcomes; original engines calculate every measurement.
export const GRID_COMPARISON_SCHEMA='stellar-forge.gridfabric-procedure-comparison.v1';
const clone=v=>JSON.parse(JSON.stringify(v));
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const canonical=v=>Array.isArray(v)?v.map(canonical):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const key=(...v)=>JSON.stringify(v);
function need(ok,message){if(!ok)throw Object.assign(new Error(message),{code:'GRID_COMPARISON_INPUT'});}
function retained(result){
  need(result?.capture?.schema==='stellar-forge.gridfabric-procedure-capture.v1'&&result.input&&result.plan&&
    result.receipt?.schema==='stellar-forge.gridfabric-procedure-capture-receipt.v1'&&/^[a-f0-9]{64}$/.test(result.receipt.sha256||''),
    'Select two complete captures received by the original GridFabric reader.');
  need(result.input.instanceId===result.capture.instanceId&&same(result.input,result.capture.input)&&
    same(result.input.workspace,result.capture.workspace),'The retained input and capture bindings differ.');
  const receipt=clone(result.receipt);delete receipt.directory;
  return {receipt,input:clone(result.input),plan:clone(result.plan),capture:clone(result.capture),catalog:clone(result.catalog)};
}
function records(side,collection){
  const found=new Map();
  for(const item of side.capture.records){
    if(item.collection!==collection)continue;
    need(!found.has(item.id)||same(found.get(item.id),item.record),'A capture has conflicting original '+collection+' records.');
    found.set(item.id,item.record);
  }
  return found;
}
const sorted=values=>[...values].sort((a,b)=>a<b?-1:a>b?1:0);
function union(a,b){return sorted(new Set([...a.keys(),...b.keys()]));}
function changes(a,b){
  return union(a,b).map(id=>({id,presence:a.has(id)?b.has(id)?'both':'before_only':'after_only',
    changed:a.has(id)&&b.has(id)?!same(a.get(id),b.get(id)):true,before:a.get(id)??null,after:b.get(id)??null}));
}
function selectedReport(side,chosen){
  const reports=records(side,'reports');
  if(chosen===undefined||chosen===null||chosen===''){
    need(reports.size<=1,'This capture contains several reports. Select the exact report to compare.');
    chosen=reports.keys().next().value??null;
  }
  if(chosen===null)return null;
  need(reports.has(chosen),'The selected report is absent from this complete capture.');
  const report=reports.get(chosen),mapping=records(side,'mappings').get(report.mapping_id);
  need(mapping&&Array.isArray(mapping.entries),'The original selected report mapping is absent.');
  const rows=[...records(side,'report_rows').values()].filter(r=>r.report_id===chosen);
  need(rows.length===report.row_count,'The original selected report rows are incomplete.');
  const index=new Map();
  for(const row of rows){
    const id=key(row.report_specifier_id,row.r_id,row.dtStartTimet);
    need(!index.has(id),'The selected report repeats an interval identity.');index.set(id,row);
  }
  const sources=records(side,'sources'),selected=new Set(mapping.entries.flatMap(e=>e.source_ids));
  return {id:chosen,report:clone(report),mapping:clone(mapping),
    sources:[...selected].map(id=>{need(sources.has(id),'The complete mapped source is absent.');return clone(sources.get(id));}),
    rows:clone(rows),index};
}
function entry(report,row){
  if(!row||!report)return null;
  return report.mapping.entries.find(e=>e.r_id===row.r_id&&e.report_specifier_id===row.report_specifier_id)??null;
}
function semantics(report,row){
  const e=entry(report,row);if(!e)return null;
  const period=report.report.query.granularityInSeconds||e.period_seconds;
  return {device_id:e.device_id,channel:e.channel,kind:e.kind,unit:e.unit,aggregation:e.aggregation,
    time_basis:e.time_basis,period_seconds:['sample','status'].includes(e.aggregation)?null:period};
}
function decimalParts(value){
  need(typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value)&&value.length<=2048,'Keep the original finite decimal measurement.');
  const negative=value.startsWith('-'),[whole,fraction='']=value.replace(/^-/,'').split('.');
  return {n:BigInt(whole+fraction)*(negative?-1n:1n),scale:fraction.length};
}
/** Difference of two already-rounded native decimal results; no aggregation or unit conversion. */
export function gridDecimalDifference(before,after){
  const a=decimalParts(before),b=decimalParts(after),scale=Math.max(a.scale,b.scale);
  let n=b.n*10n**BigInt(scale-b.scale)-a.n*10n**BigInt(scale-a.scale);
  const sign=n<0n?'-':'';if(n<0n)n=-n;
  let text=n.toString().padStart(scale+1,'0');
  if(scale)text=text.slice(0,-scale)+'.'+text.slice(-scale);
  return sign+text;
}
function interval(beforeReport,afterReport,a,b,id){
  const before=semantics(beforeReport,a),after=semantics(afterReport,b),both=!!a&&!!b;
  const compatible=both&&same(before,after),ready=both&&a.status==='READY'&&b.status==='READY';
  const originalValue=r=>r?.status==='READY'?(r.calculation?.value_decimal??r.wire?.status??null):null;
  const av=originalValue(a),bv=originalValue(b);
  let difference=null,reason=null;
  if(!both)reason='This interval is selected in one report only; no deletion or zero is inferred.';
  else if(!compatible)reason='Device, channel, kind, unit, aggregation, period or time basis changed; quantities are not subtracted.';
  else if(!ready)reason='At least one original interval needs source; no missing value is treated as zero.';
  else if(before.kind==='status')reason='Original device status values are compared without a numeric difference.';
  else if(typeof av==='string'&&typeof bv==='string')difference=gridDecimalDifference(av,bv);
  else reason='The original ready row has no retained decimal result; no number is reconstructed.';
  const e=entry(beforeReport,a),f=entry(afterReport,b);
  return {id,reportSpecifierId:(b??a).report_specifier_id,rId:(b??a).r_id,timestamp:(b??a).dtStartTimet,
    presence:both?'both':a?'before_only':'after_only',before:a??null,after:b??null,beforeSemantics:before,afterSemantics:after,
    beforeValue:av,afterValue:bv,difference,differenceUnit:difference===null?null:before.unit,reason,
    outcome:!both?'selected_only':!compatible?'semantics_changed':a.status==='NEEDS_SOURCE'&&b.status==='READY'?'source_resolved':
      a.status==='READY'&&b.status==='NEEDS_SOURCE'?'source_needed':a.status===b.status?a.status:'status_changed',
    valueChanged:both&&ready?!same(av,bv):false,parametersChanged:both?!same(e,f):false,
    qualityChanged:both?!same(a.wire?.dataQuality??null,b.wire?.dataQuality??null):false,
    calculationChanged:both?!same(a.calculation??null,b.calculation??null):false,
    changed:!both||!same({status:a.status,wire:a.wire??null,calculation:a.calculation??null,issue:a.issue??null},
      {status:b.status,wire:b.wire??null,calculation:b.calculation??null,issue:b.issue??null})||!same(e,f)};
}
function reportView(report){
  if(!report)return null;const {index,...value}=report;return value;
}
function latest(plan){need(Array.isArray(plan.revisions)&&plan.revisions.length,'Keep the complete original plan history.');return plan.revisions.at(-1);}
const idMap=(rows,id)=>new Map(rows.map(row=>[row[id],row]));
function outcomeRows(before,after){
  const result=[];
  for(const collection of ['events','opt_decisions','device_actions','management_operations','distributions']){
    for(const row of changes(records(before,collection),records(after,collection)))result.push({collection,...row});
  }
  return result;
}
export function compareGridFabricCaptures(beforeResult,afterResult,{beforeReportId=null,afterReportId=null}={}){
  const before=retained(beforeResult),after=retained(afterResult);
  need(before.input.workspace.workspace_id===after.input.workspace.workspace_id&&before.input.instanceId===after.input.instanceId,
    'Compare two captures of the same original workspace and GridFabric instance.');
  const a=selectedReport(before,beforeReportId),b=selectedReport(after,afterReportId);
  const ai=a?.index??new Map(),bi=b?.index??new Map(),intervals=union(ai,bi).map(id=>interval(a,b,ai.get(id),bi.get(id),id));
  const pa=latest(before.plan),pb=latest(after.plan);
  const plan={samePlan:before.plan.id===after.plan.id,beforeId:before.plan.id,afterId:after.plan.id,
    beforeRevision:before.plan.revisions.length,afterRevision:after.plan.revisions.length,
    sharedPrefix:before.plan.id===after.plan.id?before.plan.revisions.slice(0,Math.min(before.plan.revisions.length,after.plan.revisions.length))
      .every((rev,i)=>same(rev,after.plan.revisions[i])):false,
    metadata:changes(new Map(Object.entries(pa).filter(([k])=>k!=='steps')),new Map(Object.entries(pb).filter(([k])=>k!=='steps'))),
    steps:changes(idMap(pa.steps,'id'),idMap(pb.steps,'id'))};
  const outcomes=outcomeRows(before,after),sourceChanges=changes(records(before,'sources'),records(after,'sources'));
  const files=side=>{const map=new Map();for(const f of side.capture.files){const prior=map.get(f.fileId);
    if(prior)need(prior.bytes===f.bytes&&prior.sha256===f.sha256,'A retained native file has conflicting identities.');
    else map.set(f.fileId,clone(f));}return map;};
  return {schema:GRID_COMPARISON_SCHEMA,selection:{beforeReportId:a?.id??null,afterReportId:b?.id??null},
    before,after,reports:{before:reportView(a),after:reportView(b)},intervals,outcomes,plan,sourceChanges,
    fileChanges:changes(files(before),files(after)),
    scope:{sameSource:before.input.workspace.source_sha256===after.input.workspace.source_sha256,
      sameDirectory:before.input.workspace.workspace_directory===after.input.workspace.workspace_directory,
      sameSelection:same(before.input.records,after.input.records)&&same(before.input.files,after.input.files),
      sameQuery:!!a&&!!b&&same(a.report.query,b.report.query),periods:{before:before.input.period,after:after.input.period},
      coverage:'Only retained selections and their complete dependent pages are compared. Selected-only records do not prove creation, deletion or zero activity.',
      measurement:'Quantities are the original engine results. Differences use after minus before only for matched rId/time and identical device, channel, unit, aggregation, time basis and period. No savings or causal claim is calculated.',
      delivery:'READY means a report response was prepared; it is not proof of VTN acceptance. ACKNOWLEDGED means an adapter returned HTTP success; consult its complete response and any original reconciliation.',
      portable:'This comparison retains full selected capture metadata, original records and plan histories. Original binary/raw response files remain in the two complete capture archives; receive those archives to verify and reopen this comparison.'},
    summary:{intervals:intervals.length,matched:intervals.filter(r=>r.presence==='both').length,
      changed:intervals.filter(r=>r.changed).length,sourceResolved:intervals.filter(r=>r.outcome==='source_resolved').length,
      sourceNeeded:intervals.filter(r=>r.outcome==='source_needed').length,
      incompatible:intervals.filter(r=>r.presence==='both'&&!same(r.beforeSemantics,r.afterSemantics)).length,
      selectedOnly:intervals.filter(r=>r.presence!=='both').length,
      outcomeChanges:outcomes.filter(r=>r.changed).length,planStepChanges:plan.steps.filter(r=>r.changed).length}};
}
/** Re-derive from the two original validated archives; a report alone does not authenticate original bytes. */
export function receiveGridFabricComparison(value,before,after){
  need(value?.schema===GRID_COMPARISON_SCHEMA&&object(value.selection),'Choose a complete GridFabric comparison JSON.');
  const expected=compareGridFabricCaptures(before,after,value.selection);
  need(same(value,expected),'The comparison differs from these exact original captures or selected reports.');
  return expected;
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatted=v=>esc(typeof v==='string'?v:JSON.stringify(v,null,2));
const details=(title,v)=>'<details><summary>'+esc(title)+'</summary><pre>'+formatted(v)+'</pre></details>';
export function renderGridFabricComparisonHTML(value){
  need(value?.schema===GRID_COMPARISON_SCHEMA,'Choose a complete derived comparison.');
  const a=value.reports.before,b=value.reports.after;
  const label=r=>r?r.report.status+' · '+r.report.row_count+' intervals · '+r.report.issue_count+' issues':'No selected report';
  const cells=(tag,values)=>values.map(v=>'<'+tag+'>'+esc(v)+'</'+tag+'>').join('');
  const rowValue=(v,s)=>v===null?'—':(typeof v==='string'?v:JSON.stringify(v))+(s?.unit?' '+s.unit:'');
  const rows=value.intervals.map(r=>'<tr>'+cells('td',[r.rId,r.timestamp,r.before?.status??'Not selected',rowValue(r.beforeValue,r.beforeSemantics),
    r.after?.status??'Not selected',rowValue(r.afterValue,r.afterSemantics),r.difference===null?'—':r.difference+' '+r.differenceUnit,
    r.reason??(r.valueChanged?'Quantity changed':'Quantity unchanged')])+ '</tr><tr><td colspan="8">'+details('Original calculation, quality, source rows and issues',r)+'</td></tr>').join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>GridFabric report and operating comparison</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#202124;background:#fff;margin:0}main{max-width:1280px;margin:auto;padding:28px}h1{font-size:28px}h2{margin-top:32px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bcc2c7;padding:8px;text-align:left;vertical-align:top}th{background:#eef0f2}.scroll{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{border:1px solid #cbd0d4;padding:10px;margin:10px 0}summary{cursor:pointer;font-weight:600}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}.note{border-left:4px solid #546473;padding:12px;background:#f0f3f5}a{color:#174e86}@media(max-width:700px){main{padding:15px}.pair{grid-template-columns:1fr}h1{font-size:23px}}@media print{details{break-inside:avoid}.scroll{overflow:visible}}</style></head><body><main>'+
    '<h1>GridFabric report and operating comparison</h1><p>Original retained outcomes · after minus before · '+esc(value.before.input.instanceId)+'</p>'+
    '<div class="pair"><section><h2>Before</h2><p>'+esc(value.before.input.title)+' · '+esc(value.before.input.period)+'</p><p>'+esc(label(a))+'</p>'+details('Original report and mapping',a)+'</section>'+
    '<section><h2>After</h2><p>'+esc(value.after.input.title)+' · '+esc(value.after.input.period)+'</p><p>'+esc(label(b))+'</p>'+details('Original report and mapping',b)+'</section></div>'+
    '<p class="note">'+esc(value.scope.measurement)+' '+esc(value.scope.coverage)+'</p>'+details('Selection, source and receipt context',{selection:value.selection,scope:value.scope,before:value.before.receipt,after:value.after.receipt})+
    '<h2>Measurement intervals</h2><p>'+value.summary.sourceResolved+' source gaps resolved; '+value.summary.sourceNeeded+' intervals now need source; '+value.summary.incompatible+' matched intervals have different measurement semantics.</p>'+
    '<div class="scroll"><table><thead><tr>'+cells('th',['rId','Original timestamp (seconds)','Before state','Before value','After state','After value','Difference','Interpretation'])+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<h2>Device and management outcomes</h2><p>'+esc(value.scope.delivery)+'</p>'+value.outcomes.map(r=>details(r.collection+' · '+r.id+' · '+(r.changed?'Changed':'Unchanged'),r)).join('')+
    '<h2>Customer procedure changes</h2>'+details('Complete latest-step and plan changes',value.plan)+
    '<h2>Sources and original files</h2><p>'+esc(value.scope.portable)+'</p>'+details('Complete source comparison',value.sourceChanges)+details('Complete native-file comparison',value.fileChanges)+
    details('Full before plan history',value.before.plan)+details('Full after plan history',value.after.plan)+
    '<p>This report performs no native dispatch, recalculation, tenant request or device action.</p></main></body></html>\n';
}
