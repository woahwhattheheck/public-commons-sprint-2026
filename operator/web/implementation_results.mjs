/** Review original plan observations at field/laboratory scale, native or offline. */
import {clone,esc,csvPlan,civil} from './implementation_core.mjs';
const PAGE_SIZES=[25,50,100,200];
const text=value=>value===null||value===undefined?'':String(value);
const button=(action,label,extra='')=>'<button type="button" data-impl="'+action+'" '+extra+'>'+esc(label)+'</button>';
const label=(name,body)=>'<label class="iw-field"><span>'+esc(name)+'</span>'+body+'</label>';
const keyValue=value=>JSON.stringify(text(value));
const compare=(a,b)=>text(a).localeCompare(text(b),undefined,{numeric:true,sensitivity:'base'});
export function normalizeResultsView(value={}){
 const out={query:'',site_id:'',parameter:'',result_type:'',qa_status:'',source_id:'',unit:'',date_from:'',date_to:'',sort:'original',page:0,page_size:50};
 for(const key of ['query','site_id','parameter','result_type','qa_status','source_id','unit'])if(typeof value?.[key]==='string')out[key]=value[key];
 for(const key of ['date_from','date_to'])if(typeof value?.[key]==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value[key])){try{civil(value[key]);out[key]=value[key];}catch{}}
 if(['original','parameter','site','collection_newest','collection_oldest'].includes(value?.sort))out.sort=value.sort;
 if(PAGE_SIZES.includes(Number(value?.page_size)))out.page_size=Number(value.page_size);
 if(Number.isSafeInteger(value?.page)&&value.page>=0)out.page=value.page;
 return out;
}
function contexts(plan){
 const activities=new Map(plan.activities.map(x=>[x.id,x])),visits=new Map(plan.visits.map(x=>[x.id,x])),sites=new Map(plan.sites.map(x=>[x.id,x])),links=new Map(plan.source_links.map(x=>[x.id,x])),tasks=new Map(plan.tasks.map(x=>[x.id,x])),monitoring=new Map(plan.monitoring_plans.map(x=>[x.id,x]));
 return plan.observations.map((observation,index)=>{
  const activity=activities.get(observation.activity_id)||{},visit=visits.get(activity.visit_id)||{},site=sites.get(activity.site_id||visit.site_id)||{};
  const source=links.get(observation.lab_source?.source_link_id)||null;
  return {observation,activity,visit,site,task:tasks.get(activity.implementation_task_id)||{},monitoring_plan:monitoring.get(visit.monitoring_plan_id)||{},source,index,source_id:observation.lab_source?.source_link_id||'',
    local_date:text(activity.collected_at).slice(0,10)};
 });
}
function choices(rows,get,label=get){
 const map=new Map();for(const row of rows){const value=text(get(row));if(!map.has(value))map.set(value,{value,label:text(label(row))||'Not recorded',count:0});map.get(value).count++;}
 return [...map.values()].sort((a,b)=>compare(a.label,b.label)||compare(a.value,b.value));
}
function chosen(filter,value){return filter===''||filter===keyValue(value);}
export function reviewResults(plan,value={}){
 const view=normalizeResultsView(value),all=contexts(plan),tokens=view.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 const matches=all.filter(row=>{
  const o=row.observation,a=row.activity;
  if(view.site_id&&row.site.id!==view.site_id)return false;
  if(!chosen(view.parameter,o.parameter)||!chosen(view.result_type,o.result_type)||!chosen(view.qa_status,o.qa_status)||!chosen(view.source_id,row.source_id)||!chosen(view.unit,o.unit))return false;
  if(view.date_from&&(!row.local_date||row.local_date<view.date_from))return false;
  if(view.date_to&&(!row.local_date||row.local_date>view.date_to))return false;
  if(tokens.length){
   const searchable=[o.id,o.activity_id,o.parameter,o.original_text,o.value,o.unit,o.basis,o.fraction,o.qualifier,o.method,o.qa_status,o.notes,
    a.sample_id,a.id,a.method,a.custody_ref,a.collected_at,row.site.id,row.site.label,row.visit.id,row.source?.label,o.lab_source?.record].map(text).join('\n').toLocaleLowerCase();
   if(!tokens.every(token=>searchable.includes(token)))return false;
  }
  return true;
 });
 if(view.sort!=='original')matches.sort((a,b)=>{
  let c=0;
  if(view.sort==='parameter')c=compare(a.observation.parameter,b.observation.parameter)||compare(a.observation.unit,b.observation.unit);
  if(view.sort==='site')c=compare(a.site.label||a.site.id,b.site.label||b.site.id);
  if(view.sort.startsWith('collection_')){
   const aa=Date.parse(a.activity.collected_at),bb=Date.parse(b.activity.collected_at),af=Number.isFinite(aa),bf=Number.isFinite(bb);
   if(!af||!bf)c=af?-1:bf?1:0;else c=(aa-bb)*(view.sort==='collection_newest'?-1:1);
  }
  return c||a.index-b.index;
 });
 const page_count=Math.max(1,Math.ceil(matches.length/view.page_size));view.page=Math.min(view.page,page_count-1);
 const counts={numeric:0,censored:0,text:0,missing:0,without_collection_time:0};
 for(const row of matches){if(Object.hasOwn(counts,row.observation.result_type))counts[row.observation.result_type]++;if(!row.activity.collected_at)counts.without_collection_time++;}
 return {view,total:all.length,matching_count:matches.length,matching:matches,page_count,
  page_rows:matches.slice(view.page*view.page_size,(view.page+1)*view.page_size),counts,
  choices:{sites:choices(all,r=>r.site.id,r=>r.site.label||r.site.id),parameters:choices(all,r=>r.observation.parameter),
   types:choices(all,r=>r.observation.result_type),qa:choices(all,r=>r.observation.qa_status),units:choices(all,r=>r.observation.unit),
   sources:choices(all,r=>r.source_id,r=>r.source?.label||(r.source_id?'Unavailable source '+r.source_id:'Field entry / no laboratory source'))}};
}
function select(name,rows,current,all,plain=false){
 const encoded=v=>plain?v:keyValue(v);
 let body='<option value="">'+esc(all)+'</option>';
 if(current&&!rows.some(x=>encoded(x.value)===current))body+='<option value="'+esc(current)+'" selected>Retained filter — no current records</option>';
 for(const row of rows){const value=encoded(row.value);if(plain&&!value)continue;body+='<option value="'+esc(value)+'" '+(value===current?'selected':'')+'>'+esc(row.label)+' ('+row.count+')</option>';}
 return '<select data-result-filter="'+name+'">'+body+'</select>';
}
export function renderResults(w){
 const r=reviewResults(w.plan,w.resultView),v=r.view;w.resultView=v;
 const filters='<div class="iw-two">'+label('Search original IDs, result text, sample, method or notes','<input type="search" data-result-filter="query" value="'+esc(v.query)+'" placeholder="Search all matching records">')+
 label('Site',select('site_id',r.choices.sites,v.site_id,'All sites',true))+
 label('Parameter',select('parameter',r.choices.parameters,v.parameter,'All parameters'))+
 label('Result type',select('result_type',r.choices.types,v.result_type,'All result types'))+
 label('QA status',select('qa_status',r.choices.qa,v.qa_status,'All QA statuses'))+
 label('Original source',select('source_id',r.choices.sources,v.source_id,'All original sources'))+
 label('Unit',select('unit',r.choices.units,v.unit,'All original units'))+
 label('Order','<select data-result-filter="sort">'+[['original','Original plan order'],['parameter','Parameter and unit'],['site','Site'],['collection_newest','Newest collection first'],['collection_oldest','Oldest collection first']].map(([id,name])=>'<option value="'+id+'" '+(id===v.sort?'selected':'')+'>'+name+'</option>').join('')+'</select>')+'</div>'+
 '<details '+(v.date_from||v.date_to?'open':'')+'><summary>Original collection dates</summary><p>These filters use the source timestamp’s original local calendar date. Records without a collection timestamp are excluded while a date range is selected.</p><div class="iw-two">'+
 label('From','<input type="date" data-result-filter="date_from" value="'+esc(v.date_from)+'">')+
 label('Through','<input type="date" data-result-filter="date_to" value="'+esc(v.date_to)+'">')+'</div></details>';
 const start=r.matching_count?v.page*v.page_size+1:0,end=Math.min((v.page+1)*v.page_size,r.matching_count);
 const pageControls='<div class="iw-actions">'+button('results-prev','Previous page',v.page===0?'disabled':'')+
 '<span>Page '+(v.page+1)+' of '+r.page_count+'</span>'+button('results-next','Next page',v.page+1>=r.page_count?'disabled':'')+
 label('Rows per page','<select data-result-filter="page_size">'+PAGE_SIZES.map(n=>'<option value="'+n+'" '+(n===v.page_size?'selected':'')+'>'+n+'</option>').join('')+'</select>')+'</div>';
 const rows=r.page_rows.map(row=>{const o=row.observation;return [
  esc(row.site.label||row.site.id||'Not recorded'),esc(row.activity.sample_id||row.activity.id||o.activity_id),
  esc(row.activity.collected_at||'Not recorded'),esc(o.parameter),esc(o.original_text),esc(o.value??''),
  esc([o.unit,o.basis,o.fraction].filter(Boolean).join(' · ')),esc(o.result_type),esc(o.qa_status||'Not recorded'),
  esc(row.source?.label||(row.source_id?'Unavailable source':'Field entry'))+(o.lab_source?.record?'<br>Record '+esc(o.lab_source.record):''),
  w.editButton('observations',o.id)+button('results-inspect','Inspect original record','data-id="'+esc(o.id)+'"')
 ];});
 return '<section aria-label="Original field and laboratory results"><div class="iw-section-head"><h3>Original observations</h3><div class="iw-actions">'+w.addButton('observations')+
 button('results-csv','Export all matching CSV',r.matching_count?'':'disabled')+
 button('results-json','Export matching records and sources',r.matching_count?'':'disabled')+
 button('results-clear','Clear result filters')+'</div></div>'+
 '<p>Review the current plan’s original field and laboratory records. Each edit retains its original result ID; source records and prior native revisions stay available. Filters affect this view and its matching exports.</p>'+filters+
 (v.date_from&&v.date_to&&v.date_from>v.date_to?'<p class="iw-error">The start date follows the end date. Correct the date range or clear the filters.</p>':'')+
 '<p role="status"><b>'+r.matching_count+' matching of '+r.total+' results</b> · showing '+start+'–'+end+
 ' · '+r.counts.numeric+' numeric · '+r.counts.censored+' censored · '+r.counts.text+' text · '+r.counts.missing+' missing · '+r.counts.without_collection_time+' without collection time.</p>'+
 pageControls+w.table(['Site','Sample / activity','Actual collection time','Parameter','Original result','Numeric value','Unit / basis / fraction','Type','QA','Original source',''],rows,'No records match these filters. Clear result filters to review the full plan.')+pageControls+'</section>';
}
function relatedSourceIDs(row,importRecord){
 const ids=new Set([row.source_id,importRecord?.audit_source_link_id,row.site.source_ref].filter(v=>typeof v==='string'&&v));
 for(const item of [row.observation,row.activity,row.visit,row.site,row.task,row.monitoring_plan]){
  for(const id of [item?.original_source?.source_link_id,item?.source_ref])if(typeof id==='string'&&id)ids.add(id);
  if(Array.isArray(item?.evidence_refs))for(const id of item.evidence_refs)if(typeof id==='string')ids.add(id);
 }
 for(const answer of Object.values(row.activity.form_response?.answers||{})){
  if(Array.isArray(answer?.references))for(const id of answer.references)if(typeof id==='string')ids.add(id);
 }
 return ids;
}
export function inspectResult(plan,id){
 const selected=contexts(plan).find(r=>r.observation.id===id);if(!selected)throw Error('The original result is no longer in this plan. Reopen its retained revision if needed.');
 const operation=selected.observation.lab_source?.operation_id;
 const importRecord=(plan.field12_lab_imports||[]).find(r=>r.operation_id===operation);
 const ids=relatedSourceIDs(selected,importRecord);
 return {schema:'upstate.implementation-result-source/v1',plan:{id:plan.id,revision:plan.revision,title:plan.title},
  observation:clone(selected.observation),activity:clone(selected.activity),visit:clone(selected.visit),site:clone(selected.site),task:clone(selected.task),monitoring_plan:clone(selected.monitoring_plan),
  laboratory_import:importRecord?clone(importRecord):null,source_links:clone(plan.source_links.filter(x=>ids.has(x.id)))};
}
export function resultInspectionHtml(w,id){
 const record=inspectResult(w.plan,id),o=record.observation,lab=o.lab_source;
 const properties=value=>w.table(['Original field','Value'],Object.entries(value).map(([k,v])=>[esc(k),'<pre class="iw-json">'+esc(typeof v==='object'&&v!==null?JSON.stringify(v,null,2):v??'')+'</pre>']));
 const original=lab?.original_row?'<h4>Original laboratory CSV record '+esc(lab.record)+'</h4><p>Original physical lines '+esc(lab.line_start)+'–'+esc(lab.line_end)+'. CSV SHA-256 '+esc(lab.csv_sha256)+'.</p>'+
 w.table(['Original column','Original cell'],(lab.original_headers||Object.keys(lab.original_row)).map(name=>[esc(name),'<pre class="iw-json">'+esc(lab.original_row[name]??'')+'</pre>']))+
 (lab.extra_cells?.length?'<details><summary>Original extra cells</summary><pre class="iw-json">'+esc(JSON.stringify(lab.extra_cells,null,2))+'</pre></details>':'')+
 '<details><summary>Original field mapping and import identity</summary>'+properties(Object.fromEntries(Object.entries(lab).filter(([k])=>!['original_row','original_headers','extra_cells'].includes(k))))+'</details>':'<p>This result has no laboratory CSV row binding. Its original activity, field form and source references are retained below.</p>';
 const evidenceActions=typeof w.evidence?.original==='function'?record.source_links.filter(link=>link.kind==='local_file').map(link=>'<div class="iw-actions"><span>'+esc(link.label||link.id)+'</span><button type="button" data-iw-evidence="preview" data-id="'+esc(link.id)+'">Preview original file</button><button type="button" data-iw-evidence="download" data-id="'+esc(link.id)+'">Download original file</button></div>').join(''):'';
 const downloads=(w.downloads||[]).filter(ticket=>record.source_links.some(link=>link.sha256===ticket.sha256&&link.size_bytes===ticket.bytes));
 return '<h3>Result '+esc(o.id)+'</h3><p>'+esc(w.dirty?'Current browser draft':'Current plan revision '+w.plan.revision)+'. Current edited values and the original source cells are shown separately.</p>'+
 '<h4>Current observation</h4>'+properties(Object.fromEntries(Object.entries(o).filter(([k])=>k!=='lab_source')))+original+
 '<h4>Sample and field relationships</h4>'+properties({site:record.site,visit:record.visit,activity:record.activity,task:record.task,monitoring_plan:record.monitoring_plan})+
 '<h4>Retained source files</h4>'+properties({source_links:record.source_links,laboratory_import:record.laboratory_import})+
 evidenceActions+(downloads.length&&!evidenceActions?'<p>'+w.nativeDownloads(downloads)+'</p>':'')+
 '<div class="iw-actions">'+button('results-inspect-json','Export this original record','data-id="'+esc(id)+'"')+button('close-dialog','Close')+'</div>';
}
export function matchingResultsCsv(plan,view){
 const r=reviewResults(plan,view);
 return csvPlan({...plan,observations:r.matching.map(row=>row.observation)},'observations');
}
export function matchingResultsDocument(plan,view,documentState){
 const r=reviewResults(plan,view),ids=new Set(r.matching.map(row=>row.observation.id));
 const activityIDs=new Set(r.matching.map(row=>row.observation.activity_id)),visitIDs=new Set(r.matching.map(row=>row.activity.visit_id)),siteIDs=new Set(r.matching.map(row=>row.site.id));
 const operationIDs=new Set(r.matching.map(row=>row.observation.lab_source?.operation_id).filter(Boolean));
 const imports=(plan.field12_lab_imports||[]).filter(row=>operationIDs.has(row.operation_id));
 const importMap=new Map(imports.map(row=>[row.operation_id,row]));
 const linkIDs=new Set(r.matching.flatMap(row=>[...relatedSourceIDs(row,importMap.get(row.observation.lab_source?.operation_id))]));
 const taskIDs=new Set(r.matching.map(row=>row.task.id).filter(Boolean)),monitoringIDs=new Set(r.matching.map(row=>row.monitoring_plan.id).filter(Boolean));
 return {schema:'upstate.implementation-result-selection/v1',
  plan:{id:plan.id,revision:plan.revision,title:plan.title,document_state:documentState},
  filters:clone(r.view),total_results:r.total,matching_results:r.matching_count,counts:r.counts,
  observations:clone(plan.observations.filter(row=>ids.has(row.id))),
  activities:clone(plan.activities.filter(row=>activityIDs.has(row.id))),
  visits:clone(plan.visits.filter(row=>visitIDs.has(row.id))),
  sites:clone(plan.sites.filter(row=>siteIDs.has(row.id))),
  tasks:clone(plan.tasks.filter(row=>taskIDs.has(row.id))),
  monitoring_plans:clone(plan.monitoring_plans.filter(row=>monitoringIDs.has(row.id))),
  source_links:clone(plan.source_links.filter(row=>linkIDs.has(row.id))),laboratory_imports:clone(imports)};
}
