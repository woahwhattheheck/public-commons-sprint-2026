/** Daily discharge studies in the existing Measurements workspace.
 * Uses the original API and immutable studies; no independent data store.
 */
const INPUT='upstate.daily-flow-study-input/v1';
const STUDY='upstate.daily-flow-study/v1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>JSON.parse(JSON.stringify(value));
const number=value=>value==null?'—':Number(value).toLocaleString(undefined,{maximumSignificantDigits:9});
const option=(value,text,selected='')=>'<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(text)+'</option>';
const display=value=>value==null?'—':typeof value==='object'?JSON.stringify(value):String(value);
const fresh=()=>({schema:INPUT,title:'',start:'',end:'',sources:[],series_by_station:{},samples:[],relations:[],notes:''});
const readFile=async file=>{if(!file)throw Error('Choose a complete original file.');if(file.size>128*1024*1024)throw Error('This file exceeds the 128 MiB process limit.');return new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());};
function documentObject(text){const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Choose a JSON object.');return value;}
function saveFile(name,value,type='application/json'){
 const text=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';
 const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement('a');
 link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function table(headers,rows,label){
 return '<div class="mf-scroll" tabindex="0" role="region" aria-label="'+esc(label)+'"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+
 rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function facts(values){return '<dl class="mf-facts">'+values.map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(number(value))+'</dd></div>').join('')+'</dl>';}
function summaryTable(rows){
 return table(['Station','Selected dates','Quantified / expected days','Known volume (m³)','Mean on quantified days (m³/s)','Approved / provisional / qualified','Missing / ambiguous / unquantified','Selected window complete'],rows.map(r=>[
  esc(r.monitoring_location_id),esc(r.start)+' – '+esc(r.end),number(r.quantified_days)+' / '+number(r.expected_days),
  number(r.known_volume_m3),number(r.mean_discharge_m3_s),[r.approved_days,r.provisional_days,r.qualified_days].map(number).join(' / '),
  [r.missing_days,r.ambiguous_days,r.unquantified_days].map(number).join(' / '),r.complete_numeric_period?'Yes':'No'
 ]),'Station discharge and coverage');
}
export function mountFlowEditions(host,{api,request,onSaved=()=>{},initialState=null}={}){
 if(!(host instanceof Element)||typeof api!=='function'||typeof request!=='function')throw TypeError('Mount daily flow in the existing Measurements API.');
 const controller=new AbortController(),signal=controller.signal;
 const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('./flow_editions.css',import.meta.url).href;document.head.append(style);
 let dead=false,busy=false,catalogue={imports:[],studies:[]},draft=fresh(),inspection=null,study=null,comparison=null,
     saved=false,previewCurrent=false,view='summary',page=0,filter='',rowsPerPage=50,comparisonOnly=true;
 if(initialState){({draft,inspection,study,comparison,saved,previewCurrent,view,page,filter,comparisonOnly}=copy(initialState));}
 host.classList.add('mf');
 host.innerHTML='<section class="mf-heading"><div><h2>Daily flow studies</h2><p>Inspect original gauge responses, choose a reporting window, and retain a complete reproducible study.</p></div><button type="button" data-act="new">New study</button></section><p class="mf-status" role="status" aria-live="polite">Opening flow catalogue…</p><div class="mf-body"></div>';
 const body=host.querySelector('.mf-body'),status=host.querySelector('.mf-status');
 function message(text,error=false){if(dead)return;status.textContent=text;status.dataset.error=String(error);}
 function controlState(){host.setAttribute('aria-busy',String(busy));for(const el of host.querySelectorAll('button,input,select,textarea'))el.disabled=busy||el.dataset.unavailable==='true';}
 async function task(fn){if(dead||busy)return;busy=true;controlState();try{await fn();}catch(error){if(!dead&&error.name!=='AbortError')message(error.message,true);}finally{busy=false;if(!dead)controlState();}}
 const find=name=>host.querySelector('[name="'+name+'"]');
 function dirty(){previewCurrent=false;const save=host.querySelector('[data-act="save"]');if(save){save.dataset.unavailable='true';save.disabled=true;}message('Draft changed. Preview it before saving a new immutable study.');}
 function capture(){
  if(!find('title'))return;
  draft.title=find('title').value.trim();draft.start=find('start').value;draft.end=find('end').value;draft.notes=find('notes').value;
  draft.import_ids=[...host.querySelectorAll('[data-import]:checked')].map(el=>el.dataset.import);
  if(!draft.import_ids.length)delete draft.import_ids;
  if(inspection){
   const chosen={};for(const el of host.querySelectorAll('[data-series]:checked')){const row=inspection.series[Number(el.dataset.series)];(chosen[row.monitoring_location_id]??=[]).push(row.time_series_id);}
   draft.series_by_station=chosen;
  }
 }
 function importsHTML(){
  const items=catalogue.imports.map(r=>'<label class="mf-check"><input type="checkbox" data-import="'+esc(r.id)+'"'+((draft.import_ids||[]).includes(r.id)?' checked':'')+'><span><strong>'+esc(r.label||r.id)+'</strong><small>'+esc(r.created_at||'')+' · '+esc(r.id)+'</small></span></label>').join('');
  return items||'<p class="mf-muted">No retained discharge imports yet. Use Receive sources or add original responses below.</p>';
 }
 function sourceHTML(){return (draft.sources||[]).map((r,i)=>'<article class="mf-source"><div><strong>'+esc(r.id||'Original response '+(i+1))+'</strong><small>'+esc(r.format||'Automatic original format')+'</small><span class="mf-mono">'+esc(r.uri)+'</span></div><div class="mf-actions"><button type="button" data-act="source-original" data-index="'+i+'">Original JSON</button><button type="button" data-act="remove-source" data-index="'+i+'">Remove from draft</button></div></article>').join('');}
 function seriesHTML(){
  if(!inspection)return '<p class="mf-muted">Inspect the source selection to list original station and time-series IDs.</p>';
  if(!inspection.series.length)return '<p class="mf-notice">These responses contain no daily mean discharge series. Review the excluded-source details.</p>';
  return table(['Select','Station / original series','Original dates','Rows','Original units'],inspection.series.map((r,i)=>[
   '<input type="checkbox" data-series="'+i+'" aria-label="'+esc('Select '+r.monitoring_location_id+' '+r.time_series_id)+'"'+((draft.series_by_station?.[r.monitoring_location_id]||[]).includes(r.time_series_id)?' checked':'')+'>',
   '<strong>'+esc(r.monitoring_location_id)+'</strong><small class="mf-mono">'+esc(r.time_series_id)+'</small>',esc(r.start)+' – '+esc(r.end),number(r.rows),esc(r.units.join(', '))
  ]),'Explicit station-series selection')+'<details><summary>'+number(inspection.excluded.length)+' excluded source records</summary><pre>'+esc(JSON.stringify(inspection.excluded,null,2))+'</pre></details>';
 }
 function builderHTML(){
  return '<section class="mf-card"><h3>Prepare a study</h3><div class="mf-grid"><label>Study title<input name="title" maxlength="300" value="'+esc(draft.title)+'" placeholder="Gauge, dates and source edition"></label><div class="mf-grid"><label>Start date, inclusive<input name="start" type="date" value="'+esc(draft.start)+'"></label><label>End date, inclusive<input name="end" type="date" value="'+esc(draft.end)+'"></label></div></div>'+
  '<details class="mf-selection" open><summary>1. Original discharge sources</summary><h4>Retained imports</h4>'+importsHTML()+
  '<h4>Responses retained in this draft</h4>'+sourceHTML()+'<form data-form="source"><div class="mf-grid"><label>Complete original JSON file<input name="source-file" type="file" accept=".json,.geojson,application/json" required></label><label>Original source URI<input name="source-uri" type="url" placeholder="https://…"></label><label>Original format<select name="source-format">'+option('','Detect NWIS or OGC')+option('usgs-ogc-daily','USGS OGC daily')+option('nwis-waterml-json','NWIS WaterML JSON')+'</select></label></div><p class="mf-muted">A NWIS response may retain its own query URL. Otherwise enter the exact original retrieval URI. Retain every pagination page separately.</p><button type="submit">Add original response</button></form>'+
  '<div class="mf-actions"><button type="button" data-act="inspect">Inspect selected sources</button></div></details>'+
  '<details class="mf-selection" open><summary>2. Explicit station and series selection</summary><p class="mf-muted">Select the original series to include. More than one distinct response for the same station and date remains ambiguous; the app does not choose an edition silently.</p>'+seriesHTML()+'</details>'+
  '<label>Study notes<textarea name="notes" rows="2">'+esc(draft.notes||'')+'</textarea></label>'+
  '<details><summary>Sampling context and complete editable input</summary><p>Optional <code>samples</code>, <code>sample_sources</code>, <code>chemistry</code>, and <code>relations</code> remain in the complete input. A gauge relation needs station_id, gauge_id, gauge_relation and its original source. A shared date alone does not establish catchment support.</p><p class="mf-muted">'+number(draft.samples?.length||0)+' explicit samples · '+number(draft.relations?.length||0)+' gauge relations'+(draft.chemistry?' · retained chemistry selection':'')+'</p>'+
  '<div class="mf-actions"><button type="button" data-act="show-input">Load draft into editor</button><button type="button" data-act="download-input">Download input JSON</button></div><label>Complete input JSON<textarea name="input-json" rows="12" spellcheck="false" placeholder="Load the current draft or paste a complete input document."></textarea></label><div class="mf-actions"><button type="button" data-act="apply-input">Apply input JSON</button></div><form data-form="input"><label>Open an editable input file<input name="input-file" type="file" accept=".json,application/json" required></label><button type="submit">Load input file</button></form></details>'+
  '<div class="mf-actions"><button type="button" data-act="preview">Preview complete study</button></div></section>';
 }
 function catalogueHTML(){
  return '<section class="mf-card"><div class="mf-heading"><h3>Saved studies</h3><button type="button" data-act="catalogue">Refresh list</button></div>'+
  (catalogue.studies.length?table(['Title / dates','Stations','Saved','Open'],catalogue.studies.map(r=>[
   '<strong>'+esc(r.title)+'</strong><small>'+esc(r.start)+' – '+esc(r.end)+'</small>',number(r.summary.length),esc(r.created_at),'<button type="button" data-act="open" data-id="'+esc(r.id)+'">Open study</button>'
  ]),'Saved immutable flow studies'):'<p class="mf-muted">No flow study has been saved. Prepare and preview a study, or receive its full original JSON.</p>')+
  '<form data-form="receive"><label>Receive a complete saved study<input type="file" name="study-file" accept=".json,application/json" required></label><p class="mf-muted">The server reproduces every result from the retained originals before saving. Input-only JSON belongs in the input editor.</p><button type="submit">Verify and receive study</button></form></section>';
 }
 function comparisonHTML(){
  const choices=selected=>option('','Choose a saved study',selected)+catalogue.studies.map(s=>option(s.id,s.title+' · '+s.start+' – '+s.end,selected)).join('');
  return '<section class="mf-card"><h3>Compare original editions</h3><p>Select the earlier and later source editions explicitly. Differences never replace either saved study.</p><form data-form="compare"><div class="mf-grid"><label>Earlier edition<select name="before" required>'+choices(comparison?.before_id||'')+'</select></label><label>Later edition<select name="after" required>'+choices(comparison?.after_id||'')+'</select></label></div><button type="submit">Compare studies</button></form><div class="mf-comparison-result"></div></section>';
 }
 function render(){
  if(dead)return;body.innerHTML=catalogueHTML()+builderHTML()+'<section class="mf-results"></section>'+comparisonHTML();
  renderResults();renderComparison();controlState();
 }
 function renderResults(){
  const target=host.querySelector('.mf-results');if(!study){target.innerHTML='';return;}
  const s=study.edition.summary,totals=key=>s.reduce((n,r)=>n+(r[key]||0),0);
  target.innerHTML='<section class="mf-card"><div class="mf-heading"><div><h3>'+esc(study.input.title)+'</h3><p>'+esc(study.input.start)+' – '+esc(study.input.end)+' · '+(saved?'Saved original study':'Preview')+'</p></div><span class="mf-tag">'+(saved?'Retained':'Not yet saved')+'</span></div>'+
   '<p class="mf-mono">Study '+esc(study.id)+'</p>'+facts([['Station-days',totals('expected_days')],['Quantified',totals('quantified_days')],['Approved',totals('approved_days')],['Provisional',totals('provisional_days')],['Qualified',totals('qualified_days')],['Signed negative',totals('signed_negative_days')]])+
   '<p class="mf-notice">Known volume uses only quantified daily mean discharge × 86,400 seconds. Missing or ambiguous days are not filled. Signed original discharge remains signed. A complete selected window is not necessarily a complete calendar period.</p>'+
   '<div class="mf-actions"><button type="button" data-act="save" data-unavailable="'+String(!previewCurrent||saved)+'">'+(saved?'Study saved':'Save this preview')+'</button><button type="button" data-act="download-study">Full study JSON</button><button type="button" data-act="edit-study">Use this original input</button><button type="button" data-act="download-result-input">Study input JSON</button></div>'+
   '<div class="mf-actions">'+['daily','periods','samples'].map(kind=>'<button type="button" data-act="csv" data-kind="'+kind+'" data-unavailable="'+String(!saved)+'">'+esc(kind[0].toUpperCase()+kind.slice(1))+' CSV</button>').join('')+'</div>'+
   (!saved?'<p class="mf-muted">Save this exact preview to enable its server-generated CSV downloads.</p>':'')+
   '<nav class="mf-tabs" aria-label="Flow result views">'+[['summary','Coverage'],['daily','Daily discharge'],['periods','Calendar periods'],['samples','Sample-day context'],['sources','Original sources']].map(([id,title])=>'<button type="button" data-act="view" data-view="'+id+'" aria-current="'+String(view===id)+'">'+title+'</button>').join('')+'</nav><div class="mf-result-view"></div></section>';
  renderResultView();controlState();
 }
 function pager(count){return '<div class="mf-actions"><button type="button" data-act="page-back" data-unavailable="'+String(page===0)+'">Previous rows</button><span>'+number(count?Math.min(page*rowsPerPage+1,count):0)+'–'+number(Math.min((page+1)*rowsPerPage,count))+' of '+number(count)+'</span><button type="button" data-act="page-next" data-unavailable="'+String((page+1)*rowsPerPage>=count)+'">Next rows</button></div>';}
 function renderResultView(){
  if(!study)return;const target=host.querySelector('.mf-result-view');
  if(view==='summary'){
   target.innerHTML=summaryTable(study.edition.summary)+'<h4>Missing and ambiguous intervals</h4>'+study.edition.summary.map(r=>'<details><summary>'+esc(r.monitoring_location_id)+'</summary><pre>'+esc(JSON.stringify({missing:r.missing_intervals,ambiguous:r.ambiguous_intervals,unquantified:r.unquantified_intervals},null,2))+'</pre></details>').join('')+
    '<details><summary>Original interpretation and method</summary><pre>'+esc(JSON.stringify({interpretation:study.interpretation,method:study.edition.method},null,2))+'</pre></details>';return;
  }
  if(view==='sources'){
   target.innerHTML='<p>These are the complete response texts used by this study. Their original URLs and hashes remain in the downloadable full JSON.</p>'+study.input.sources.map((r,i)=>'<article class="mf-source"><div><strong>'+esc(r.id)+'</strong><span class="mf-mono">'+esc(r.uri)+'</span><small>'+esc(r.format)+' · SHA-256 '+esc(r.sha256)+'</small></div><button type="button" data-act="study-source" data-index="'+i+'">Download original response</button></article>').join('')+
    '<details><summary>Excluded source rows and out-of-window values</summary><pre>'+esc(JSON.stringify({excluded:study.edition.excluded,outside_selected_period:study.edition.outside_selected_period},null,2))+'</pre></details>';return;
  }
  const stationIds=[...new Set(study.edition.rows.map(r=>r.monitoring_location_id))];
  let rows=view==='daily'?study.edition.rows:view==='periods'?study.periods:study.sample_context.rows;
  if(filter)rows=rows.filter(r=>(r.monitoring_location_id||r.gauge_id)===filter);
  page=Math.min(page,Math.max(0,Math.ceil(rows.length/rowsPerPage)-1));const visible=rows.slice(page*rowsPerPage,(page+1)*rowsPerPage);
  let html='<label class="mf-row-filter">Gauge filter<select name="result-station">'+option('','All selected gauges',filter)+stationIds.map(s=>option(s,s,filter)).join('')+'</select></label>';
  if(view==='daily')html+=table(['Station / date','Status','Discharge (m³/s)','Original value / unit','Approval / qualifier','Original series','Inspect'],visible.map((r,i)=>[
   esc(r.monitoring_location_id)+'<small>'+esc(r.date)+'</small>',esc(r.status),number(r.flow?.discharge_m3_s),esc(r.flow?display(r.flow.source_value)+' '+display(r.flow.source_unit):'—'),esc(r.flow?[r.flow.approval_status||'Not reported',r.flow.qualifier||'None'].join(' / '):'—'),'<span class="mf-mono">'+esc(r.flow?.time_series_id||'—')+'</span>','<button type="button" data-act="inspect-row" data-row="'+i+'">Source details</button>'
  ]),'Original daily discharge rows');
  if(view==='periods')html+='<p>Calendar, month and October–September water-year periods retain their full expected boundaries. “Complete calendar period” requires all calendar days, not just the selected subset.</p>'+table(['Station','Period','Selected dates / full dates','Quantified / selected days','Full calendar days','Complete calendar period','Known volume (m³)','Mean (m³/s)','Approved / provisional / qualified'],visible.map(r=>[
   esc(r.monitoring_location_id),esc(r.period_kind)+' '+esc(r.period),esc(r.start)+' – '+esc(r.end)+'<small>'+esc(r.calendar_start)+' – '+esc(r.calendar_end)+'</small>',number(r.quantified_days)+' / '+number(r.expected_days),number(r.calendar_days),r.complete_calendar_period?'Yes':'No',number(r.known_volume_m3),number(r.mean_discharge_m3_s),[r.approved_days,r.provisional_days,r.qualified_days].map(number).join(' / ')
  ]),'Complete calendar versus selected flow periods');
  if(view==='samples')html+=facts(Object.entries(study.sample_context.counts).map(([k,v])=>[k.replaceAll('_',' '),v]))+'<p class="mf-notice">A sampling-date match supplies daily flow context, not instantaneous discharge or an annual chemical load. Spatial support is retained separately from the date match.</p>'+table(['Sample / station / date','Gauge / relationship','Daily status','Discharge (m³/s)','Explicit matched catchment support','Relationship evidence','Inspect'],visible.map((r,i)=>[
   esc(r.sample_id)+'<small>'+esc(r.station_id)+' · '+esc(r.date)+'</small>',esc(r.gauge_id||'Unassigned')+'<small>'+esc(r.gauge_relation)+'</small>',esc(r.flow_status),number(r.flow?.discharge_m3_s),r.annual_mass_spatial_support?'Recorded':'Not recorded',esc(r.relationship_source||'—'),'<button type="button" data-act="inspect-row" data-row="'+i+'">Original sample</button>'
  ]),'Original sample dates and gauge support');
  target.innerHTML=html+pager(rows.length)+'<div class="mf-row-detail"></div>';target._visibleRows=visible;controlState();
 }
 function renderComparison(){
  const target=host.querySelector('.mf-comparison-result');if(!target||!comparison)return;
  const all=comparison.comparison.rows,rows=comparisonOnly?all.filter(r=>r.changes.length):all;
  const preview=rows.slice(0,100);
  target.innerHTML=facts(Object.entries(comparison.comparison.counts))+'<p>'+number(all.filter(r=>!r.changes.length).length)+' unchanged station-days retained; '+number(all.filter(r=>r.changes.length).length)+' changed or differently selected station-days. No automatic adoption.</p>'+
   '<label class="mf-check"><input type="checkbox" name="changed-only"'+(comparisonOnly?' checked':'')+'>Show changed rows only</label>'+
   table(['Station / date','Changes','Earlier Q (m³/s)','Later Q (m³/s)','Later − earlier Q (m³/s)','Earlier approval / qualifier','Later approval / qualifier'],preview.map(r=>[
    esc(r.monitoring_location_id)+'<small>'+esc(r.date)+'</small>',esc(r.changes.join(', ')||'Unchanged'),number(r.before?.flow?.discharge_m3_s),number(r.after?.flow?.discharge_m3_s),number(r.delta_discharge_m3_s),
    esc([r.before?.flow?.approval_status||'—',r.before?.flow?.qualifier||'—'].join(' / ')),esc([r.after?.flow?.approval_status||'—',r.after?.flow?.qualifier||'—'].join(' / '))
   ]),'Original edition changes')+'<p class="mf-muted">Showing '+number(preview.length)+' of '+number(rows.length)+' selected rows. Download the complete comparison for every original row, both period summaries, and both sample contexts.</p>'+
   '<div class="mf-actions"><button type="button" data-act="download-comparison">Complete comparison JSON</button></div><details><summary>Both period summaries and sample context</summary><pre>'+esc(JSON.stringify({periods_before:comparison.periods_before,periods_after:comparison.periods_after,sample_context_before:comparison.sample_context_before.counts,sample_context_after:comparison.sample_context_after.counts},null,2))+'</pre></details>';
 }
 async function reloadCatalogue(){const value=await api('/flow/catalogue');if(!dead)catalogue=value;}
 async function inspectDraft(){const value=await api('/flow/inspect',{method:'POST',value:draft});if(dead)return;inspection=value;if(!draft.start&&value.series.length)draft.start=value.series.map(r=>r.start).sort()[0];if(!draft.end&&value.series.length)draft.end=value.series.map(r=>r.end).sort().at(-1);}
 async function loadStudy(value,isSaved){
  if(value?.schema!==STUDY)throw Error('Choose a complete daily-flow study.');
  study=value;draft=copy(value.input);saved=isSaved;previewCurrent=true;inspection=null;view='summary';page=0;filter='';
  await inspectDraft();if(dead)return;render();
 }
 async function applyInput(value){
  if(value.schema!==INPUT)throw Error('Choose a daily-flow input, or use Receive study for a complete saved study.');
  if(!value.series_by_station||typeof value.series_by_station!=='object'||Array.isArray(value.series_by_station))throw Error('Retain the station-to-series selection object.');
  draft=copy(value);inspection=null;previewCurrent=false;await inspectDraft();if(!dead)render();
 }
 host.addEventListener('input',event=>{if(event.target.closest('.mf-body')&&!['input-json','result-station','changed-only','before','after'].includes(event.target.name)&&!event.target.closest('[data-form]'))dirty();},{signal});
 host.addEventListener('change',event=>{
  if(event.target.name==='result-station'){filter=event.target.value;page=0;renderResultView();}
  if(event.target.name==='changed-only'){comparisonOnly=event.target.checked;renderComparison();}
 },{signal});
 host.addEventListener('submit',event=>{
  const form=event.target.closest('[data-form]');if(!form)return;event.preventDefault();event.stopPropagation();
  const data=new FormData(form),kind=form.dataset.form;
  task(async()=>{
   if(kind==='source'){
    capture();const file=data.get('source-file'),text=await readFile(file);documentObject(text);
    const source={id:'response-'+Date.now()+'-'+(draft.sources?.length||0),text,uri:String(data.get('source-uri')||'').trim(),format:data.get('source-format')||undefined};
    // Retain explicit original text; the server derives/verifies its SHA and original URI.
    draft.sources=[...(draft.sources||[]),source];inspection=null;previewCurrent=false;render();message('Original response added to the draft. Inspect the selected sources next.');
   }
   if(kind==='input'){await applyInput(documentObject(await readFile(data.get('input-file'))));message('Complete input loaded. Review its original sources and explicit series, then preview.');}
   if(kind==='receive'){
    const value=documentObject(await readFile(data.get('study-file')));
    const result=await api('/flow/receive',{method:'POST',value});if(dead)return;
    await reloadCatalogue();await loadStudy(result.study,true);onSaved(result);message(result.duplicate?'This exact study is already retained.':'Original study reproduced and saved with all source responses.');
   }
   if(kind==='compare'){
    const before_id=data.get('before'),after_id=data.get('after');
    if(before_id===after_id)throw Error('Choose two different saved editions.');
    const value=await api('/flow/compare',{method:'POST',value:{before_id,after_id}});if(dead)return;comparison=value;renderComparison();message('Compared both original editions. Neither saved study was changed.');
   }
  });
 },{signal});
 host.addEventListener('click',event=>{
  const button=event.target.closest('button[data-act]');if(!button||!host.contains(button))return;event.preventDefault();event.stopPropagation();
  task(async()=>{
   const action=button.dataset.act;
   if(action==='new'){draft=fresh();inspection=null;study=null;saved=false;previewCurrent=false;page=0;filter='';render();message('New study draft. Select its original sources and exact series.');}
   if(action==='catalogue'){capture();await reloadCatalogue();render();message('Saved study catalogue refreshed. The draft is retained.');}
   if(action==='inspect'){capture();await inspectDraft();if(dead)return;previewCurrent=false;render();message('Original sources inspected. Select station series explicitly.');}
   if(action==='remove-source'){capture();draft.sources.splice(Number(button.dataset.index),1);inspection=null;previewCurrent=false;render();message('Source removed from this draft only.');}
   if(action==='source-original'){capture();const row=draft.sources[Number(button.dataset.index)];saveFile('original-response.json',row.text);}
   if(action==='study-source'){const row=study.input.sources[Number(button.dataset.index)];saveFile('original-response-'+button.dataset.index+'.json',row.text);}
   if(action==='show-input'){capture();find('input-json').value=JSON.stringify(draft,null,2);}
   if(action==='apply-input'){await applyInput(documentObject(find('input-json').value));message('Complete input applied. Preview before saving.');}
   if(action==='download-input'){capture();saveFile('daily-flow-input.json',draft);}
   if(action==='preview'){capture();message('Reading original sources and calculating daily coverage…');const result=await api('/flow/preview',{method:'POST',value:draft});if(dead)return;study=result;saved=false;previewCurrent=true;view='summary';page=0;filter='';renderResults();message('Preview complete. Review coverage, provisional values and original sources before saving.');}
   if(action==='save'){
    if(!study||!previewCurrent||saved)throw Error('Preview the current draft before saving.');
    const result=await api('/flow/save',{method:'POST',value:{...study.input,expected_id:study.id}});if(dead)return;saved=true;study=result.study;await reloadCatalogue();render();onSaved(result);message(result.duplicate?'This exact study was already saved.':'Study saved with its complete original source bodies.');
   }
   if(action==='open'){const value=await api('/flow/studies/'+encodeURIComponent(button.dataset.id));if(dead)return;await loadStudy(value,true);message('Opened original saved study. All source responses and inputs are available.');}
   if(action==='edit-study'){draft=copy(study.input);inspection=null;previewCurrent=false;await inspectDraft();if(dead)return;render();message('Original input loaded as a draft. Editing creates a new study; the saved edition remains unchanged.');}
   if(action==='download-study')saveFile('daily-flow-study-'+study.id+'.json',study);
   if(action==='download-result-input')saveFile('daily-flow-study-input-'+study.id+'.json',study.input);
   if(action==='download-comparison')saveFile('daily-flow-comparison.json',comparison);
   if(action==='csv'){
    if(!saved)throw Error('Save this preview before downloading the server CSV.');
    const response=await request('/flow/studies/'+encodeURIComponent(study.id)+'/'+button.dataset.kind+'.csv','GET'),text=await response.text();
    if(!response.ok)throw Error(text);if(dead)return;saveFile('flow-'+button.dataset.kind+'-'+study.id+'.csv',text,'text/csv;charset=utf-8');
   }
   if(action==='view'){view=button.dataset.view;page=0;filter='';renderResults();}
   if(action==='page-back'){page=Math.max(0,page-1);renderResultView();}
   if(action==='page-next'){page++;renderResultView();}
   if(action==='inspect-row'){const target=host.querySelector('.mf-result-view'),row=target._visibleRows?.[Number(button.dataset.row)];target.querySelector('.mf-row-detail').innerHTML='<details open><summary>Complete original row and source references</summary><pre>'+esc(JSON.stringify(row,null,2))+'</pre></details>';}
  });
 },{signal});
 task(async()=>{await reloadCatalogue();if(dead)return;render();message('Choose a saved study or prepare a new study from complete original discharge responses.');});
 return {snapshot(){capture();return copy({draft,inspection,study,comparison,saved,previewCurrent,view,page,filter,comparisonOnly});},refresh:()=>task(async()=>{capture();await reloadCatalogue();render();message('Flow catalogue refreshed; original draft retained.');}),destroy(){dead=true;controller.abort();style.remove();host.replaceChildren();host.classList.remove('mf');}};
}
