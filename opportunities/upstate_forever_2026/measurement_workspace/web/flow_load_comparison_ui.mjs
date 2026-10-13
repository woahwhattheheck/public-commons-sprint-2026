/** Compare two immutable saved load results without changing the current load draft. */
const SCHEMA='upstate.flow-load-result-comparison/v1';
const ID=/^[a-f0-9]{64}$/;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const copy=v=>JSON.parse(JSON.stringify(v));
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString(undefined,{maximumSignificantDigits:10}):'—';
const show=v=>v===undefined?'Not supplied':v===null?'Null (explicit original value)':typeof v==='object'?JSON.stringify(v,null,2):String(v);
const opt=(v,label,selected)=>'<option value="'+esc(v)+'"'+(v===selected?' selected':'')+'>'+esc(label)+'</option>';
const pretty=v=>'<pre>'+esc(show(v))+'</pre>';
const table=(headers,rows,label)=>'<div class="mf-scroll" role="region" tabindex="0" aria-label="'+esc(label)+'"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const VIEWS=[['series','Series and support'],['periods','Period and annual windows'],['daily','Daily calculations'],['context','Original measurement context'],['contract_changes','Contract changes'],['source_changes','Source changes']];
const METRICS=[
 ['load_kg','Point mass','kg'],['load_lower_kg','Lower mass bound','kg'],['load_upper_kg','Upper mass bound','kg'],
 ['concentration_mg_l','Point concentration','mg/L'],['concentration_lower_mg_l','Lower concentration bound','mg/L'],['concentration_upper_mg_l','Upper concentration bound','mg/L'],
 ['discharge_m3_s','Daily mean discharge','m³/s'],['quantified_flow_volume_m3','Quantified-day discharge volume','m³'],
 ['flow_weighted_concentration_mg_l','Flow-weighted point concentration','mg/L'],
 ['flow_weighted_concentration_lower_mg_l','Flow-weighted lower concentration bound','mg/L'],
 ['flow_weighted_concentration_upper_mg_l','Flow-weighted upper concentration bound','mg/L'],
 ['quantified_days','Quantified days','days'],['expected_days','Expected days','days'],
 ['censored_days','Censored days','days'],['sampled_days','Sampled days','days'],['interpolated_days','Interpolated days','days']
];
export function loadComparisonSelection(value){
 if(value?.schema!==SCHEMA||!ID.test(value.id||'')||!ID.test(value.before_id||'')||!ID.test(value.after_id||'')||value.before_id===value.after_id)
  throw Error('Compare two different exact saved load results first.');
 return {before_id:value.before_id,after_id:value.after_id,expected_comparison_id:value.id};
}
export function validateLoadComparison(value,selected){
 loadComparisonSelection(value);
 if(value.before_id!==selected.before_id||value.after_id!==selected.after_id||value.before?.id!==selected.before_id||value.after?.id!==selected.after_id)
  throw Error('The comparison belongs to a different saved result pair.');
 for(const name of ['series','daily','periods','context','contract_changes','source_changes'])
  if(!Array.isArray(value[name]))throw Error('The complete comparison is missing '+name+'.');
 if(!value.counts||typeof value.counts!=='object')throw Error('The comparison has no complete original row counts.');
 return value;
}
export function validateLoadComparisonDownload(value,selected,kind){
 if(!value||value.before_id!==selected.before_id||value.after_id!==selected.after_id||value.comparison_id!==selected.expected_comparison_id)
  throw Error('The download differs from the displayed original result pair or comparison.');
 if(typeof value.name!=='string'||!value.name||/[\\/\u0000-\u001f]/.test(value.name)||!Number.isSafeInteger(value.bytes)||value.bytes<0||!ID.test(value.sha256||''))
  throw Error('The comparison download has an incomplete filename or byte identity.');
 const type=kind==='bundle'?'application/zip':kind==='report'?'text/html; charset=utf-8':kind==='csv'?'text/csv; charset=utf-8':null;
 if(!type||value.type!==type)throw Error('The comparison download has a different media type.');
 if(kind==='bundle'){
  if(!value.name.endsWith('.zip')||typeof value.base64!=='string'||value.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.base64))throw Error('The complete comparison archive is missing.');
 }else if(typeof value.content!=='string'||!value.name.endsWith(kind==='report'?'.html':'.csv'))throw Error('The original readable comparison file is missing.');
 return value;
}
async function downloadBytes(value,selection,kind){
 validateLoadComparisonDownload(value,selection,kind);
 let bytes;
 if(kind==='bundle'){
  const binary=atob(value.base64);if(btoa(binary)!==value.base64)throw Error('The comparison archive base64 is not canonical.');
  bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
 }else bytes=new TextEncoder().encode(value.content);
 if(bytes.length!==value.bytes)throw Error('The comparison download byte count differs.');
 if(!globalThis.crypto?.subtle)throw Error('Use the original secure or localhost application to verify this download.');
 const digest=Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(digest!==value.sha256)throw Error('The comparison download checksum differs.');
 return bytes;
}
function sourceCard(v,label){
 if(!v)return '';
 return '<section class="mf-contract-block"><h4>'+esc(label)+': '+esc(v.title||'Saved load result')+'</h4><p class="mf-mono">Result '+esc(v.id)+'<br>Original study '+esc(v.flow_study_id)+'<br>Contract SHA-256 '+esc(v.contract_sha256)+'</p>'+
  '<p>Period: '+esc(v.period?.start||'Not supplied')+' to '+esc(v.period?.end||'Not supplied')+' (end exclusive)<br>Method edition: '+esc(v.method_edition||'Not supplied')+'</p><details><summary>Original counts</summary>'+pretty(v.counts)+'</details></section>';
}
function originalCell(v,view){
 if(v==null)return '<em>No row on this side</em>';
 const meta=[];
 for(const [key,label] of [['station_id','Station'],['characteristic','Characteristic'],['sample_fraction','Fraction'],['method_context','Method context'],['method_id','Method'],['date','Date'],['label','Period'],['kind','Period kind'],['period_start','First included date'],['period_end','First excluded date'],['status','Status']])
  if(own(v,key))meta.push('<strong>'+esc(label)+':</strong> '+esc(show(v[key])));
 if(v.support)meta.push('<strong>Support:</strong> '+esc(v.support.admitted?'Admitted matched support':'Context only')+' · '+esc(v.support.gauge_relation||'Unassigned')+'<br>'+esc((v.support.issues||[]).join('; ')));
 for(const [key,label] of [['coverage_complete','Complete selected coverage'],['whole_calendar_year','Whole calendar year'],['native_eligible','Native annual eligibility'],['annualized','Annualized'],['source_sample_count','Original sample count'],['usable_sample_count','Usable sample count'],['censored_sample_count','Censored sample count']])
  if(own(v,key))meta.push('<strong>'+esc(label)+':</strong> '+esc(show(v[key])));
 if(v.series_context)meta.push('<details><summary>Original quantity, method and depth context</summary>'+pretty(v.series_context)+'</details>');
 const metrics=METRICS.filter(([key])=>own(v,key));
 if(metrics.length)meta.push('<dl>'+metrics.map(([key,label,unit])=>'<dt>'+esc(label)+' ('+esc(unit)+')</dt><dd>'+num(v[key])+'</dd>').join('')+'</dl>');
 if(view==='context'){
  const original=v.original||v;
  meta.push('<strong>Original value / unit:</strong> '+esc(show(original.value))+' '+esc(original.unit||'')+
   '<br><strong>Detection:</strong> '+esc(original.detection_condition||'No original condition')+
   '<br><strong>Original limit:</strong> '+esc(show(original.limit_value))+' '+esc(original.limit_unit||''));
 }
 return meta.join('<br>')+'<details><summary>Complete original row</summary>'+pretty(v)+'</details>';
}
function decisionCell(row){
 const c=row.comparison||{},reasons=Array.isArray(c.reasons)?c.reasons:[];
 return '<strong>'+esc(c.compatible?'Compatible comparison':'No numerical comparison')+'</strong>'+
  (reasons.length?'<ul>'+reasons.map(r=>'<li>'+esc(typeof r==='string'?r:show(r))+'</li>').join('')+'</ul>':'')+
  (c.changes&&Object.keys(c.changes).length?'<dl>'+Object.entries(c.changes).map(([key,value])=>{const metric=METRICS.find(m=>m[0]===key);return '<dt>'+esc(metric?metric[1]+' change ('+metric[2]+')':key+' change')+'</dt><dd>'+esc(typeof value==='number'?num(value):show(value))+'</dd>';}).join('')+'</dl>':'<p>No finite point change is supplied.</p>');
}
export function loadComparisonRowsHTML(rows,view){
 if(view==='contract_changes'||view==='source_changes')
  return table(['Original field','Before','After'],rows.map(r=>[esc(r.path),r.before_present?pretty(r.before):'<em>Absent from original</em>',r.after_present?pretty(r.after):'<em>Absent from original</em>']),view==='contract_changes'?'Original contract changes':'Original source changes');
 return table(['Series / row and status','Before: complete original quantity','After: complete original quantity','Comparability and recorded changes'],rows.map(r=>[
  '<span class="mf-tag">'+esc(r.status)+'</span><p class="mf-mono">'+esc(r.key)+'</p>',
  originalCell(r.before,view),originalCell(r.after,view),decisionCell(r)
 ]),'Paired original '+view+' rows');
}

/** Independent child lifecycle: all calculations and downloads use exact saved IDs. */
export function mountFlowLoadComparison(host,{api,catalogue=[],initialState=null,disabled=false}={}){
 if(!(host instanceof Element)||typeof api!=='function')throw TypeError('Use the current Measurements comparison host and API.');
 const controller=new AbortController(),signal=controller.signal;
 let dead=false,busy=false,blocked=Boolean(disabled),generation=0,beforeId='',afterId='',result=null,
  view='series',page=0,statusFilter='',textFilter='',rows=copy(catalogue);
 if(initialState){
  beforeId=String(initialState.beforeId||'');afterId=String(initialState.afterId||'');
  view=VIEWS.some(([k])=>k===initialState.view)?initialState.view:'series';page=Math.max(0,Number(initialState.page)||0);
  statusFilter=['','added','removed','changed','unchanged'].includes(initialState.statusFilter)?initialState.statusFilter:'';
  textFilter=String(initialState.textFilter||'');
  if(initialState.result){try{result=copy(validateLoadComparison(initialState.result,{before_id:beforeId,after_id:afterId}));}catch{/* Keep draft IDs, never accept a mismatched retained display. */}}
 }
 host.dataset.flowLoadComparison='true';
 host.innerHTML='<section class="mf-selection"><h4>Compare saved load results</h4><p>Choose the original before and after results. This review leaves the current contract draft and every saved result unchanged.</p><p class="mf-status" role="status" aria-live="polite"></p><div class="mf-load-comparison-select"></div><div class="mf-load-comparison-result"></div></section>';
 const status=host.querySelector('[role=status]'),selectionHost=host.querySelector('.mf-load-comparison-select'),resultHost=host.querySelector('.mf-load-comparison-result');
 function message(text,error=false){if(dead)return;status.textContent=text;status.dataset.error=String(error);}
 function controls(){
  if(dead)return;host.setAttribute('aria-busy',String(busy));
  for(const el of host.querySelectorAll('button,input,select'))el.disabled=busy||blocked||el.dataset.unavailable==='true';
 }
 function alive(token){return !dead&&generation===token;}
 async function task(fn){
  if(dead||busy||blocked)return;busy=true;const token=++generation;controls();
  try{await fn(token);}catch(error){if(alive(token)&&error.name!=='AbortError')message(error.message,true);}
  finally{if(alive(token)){busy=false;controls();}}
 }
 function renderChoices(){
  const options=id=>opt('','Choose an original saved result',id)+rows.map(r=>opt(r.id,(r.title||'Saved load result')+' · '+(r.created_at||'')+' · '+r.id.slice(0,12),id)).join('')+
   (id&&!rows.some(r=>r.id===id)?opt(id,'Retained selected result '+id,id):'');
  selectionHost.innerHTML='<div class="mf-grid"><label>Before result<select name="comparison-before">'+options(beforeId)+'</select></label><label>After result<select name="comparison-after">'+options(afterId)+'</select></label></div>'+
   '<div class="mf-actions"><button type="button" data-load-comparison-act="compare" data-unavailable="'+String(!ID.test(beforeId)||!ID.test(afterId)||beforeId===afterId)+'">Compare exact saved results</button><button type="button" data-load-comparison-act="swap" data-unavailable="'+String(!beforeId&&!afterId)+'">Swap before / after</button><button type="button" data-load-comparison-act="refresh">Refresh saved catalogue</button></div>'+
   (rows.length<2?'<p class="mf-notice">Save two distinct original load results to compare. Context-only results remain valid choices; this comparison cannot admit mass support.</p>':'');
  controls();
 }
 function invalidate(){generation++;busy=false;result=null;page=0;resultHost.replaceChildren();renderChoices();message('The selected pair changed. Compare these exact saved results before downloading.');}
 function countTable(){
  return table(['Original row family','Before','After','Added','Removed','Changed','Unchanged'],['series','daily','periods','context'].map(k=>{
   const v=result.counts[k]||{};return[esc(k),num(v.before),num(v.after),num(v.added),num(v.removed),num(v.changed),num(v.unchanged)];
  }),'Complete comparison row counts');
 }
 function renderResult(){
  if(dead)return;if(!result){resultHost.replaceChildren();return;}
  resultHost.innerHTML='<p class="mf-mono">Comparison '+esc(result.id)+'</p><div class="mf-grid">'+sourceCard(result.before,'Before')+sourceCard(result.after,'After')+'</div>'+
   '<p class="mf-notice">Changes describe these selected calculations. Simultaneous source and contract changes do not establish causation or treatment effectiveness. Period differences require the same actual quantified dates and scientific support. Censoring bounds remain separate on each side; a missing point estimate has no point change. Bounds are not confidence intervals. Full calendar coverage does not by itself establish eligibility for a native annual-load comparison.</p>'+countTable()+
   '<div class="mf-actions"><button type="button" data-load-comparison-act="report">Readable comparison HTML</button><button type="button" data-load-comparison-act="bundle">Complete comparison and both originals ZIP</button>'+
   '<button type="button" data-load-comparison-act="csv">Complete comparison CSV</button>'+'</div>'+
   '<p class="mf-muted">Exports include the complete unfiltered comparison. Use the ZIP to keep the report, full parent studies, original sources and sibling downloads together. Use one separate folder per comparison.</p>'+
   '<nav class="mf-tabs" aria-label="Saved load comparison views">'+VIEWS.map(([k,l])=>'<button type="button" data-load-comparison-act="view" data-view="'+k+'" aria-current="'+String(view===k)+'">'+esc(l)+(k.endsWith('_changes')?' ('+num(result[k].length)+')':'')+'</button>').join('')+'</nav><div class="mf-load-comparison-rows"></div>';
  renderRows();controls();
 }
 function renderRows(){
  if(!result)return;
  const target=resultHost.querySelector('.mf-load-comparison-rows'),diff=view.endsWith('_changes'),filter=textFilter.toLocaleLowerCase();
  const all=result[view],matching=all.filter(r=>(diff||!statusFilter||r.status===statusFilter)&&(!filter||JSON.stringify(r).toLocaleLowerCase().includes(filter)));
  const size=25;page=Math.min(page,Math.max(0,Math.ceil(matching.length/size)-1));
  const visible=matching.slice(page*size,(page+1)*size);
  target.innerHTML='<div class="mf-grid"><label>Find within complete original rows<input name="comparison-search" value="'+esc(textFilter)+'" type="search"></label>'+
   (diff?'<p>Absent and explicitly null fields remain distinct.</p>':'<label>Row status<select name="comparison-status">'+[['','All statuses'],['changed','Changed'],['added','Added'],['removed','Removed'],['unchanged','Unchanged']].map(([k,l])=>opt(k,l,statusFilter)).join('')+'</select></label>')+'</div>'+
   (visible.length?loadComparisonRowsHTML(visible,view):'<p class="mf-notice">'+(all.length?'No original rows match these display filters.':'No rows exist in this comparison family. Context-only studies can have no mass-calculation rows; absence is not zero.')+'</p>')+
   '<div class="mf-actions"><button type="button" data-load-comparison-act="previous" data-unavailable="'+String(page===0)+'">Previous rows</button><span>'+num(matching.length?page*size+1:0)+'–'+num(Math.min(matching.length,(page+1)*size))+' of '+num(matching.length)+' matching rows; '+num(all.length)+' original rows</span><button type="button" data-load-comparison-act="next" data-unavailable="'+String((page+1)*size>=matching.length)+'">Next rows</button></div>';
  controls();
 }
 function emitDownload(value,bytes){const url=URL.createObjectURL(new Blob([bytes],{type:value.type})),a=document.createElement('a');a.href=url;a.download=value.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
 host.addEventListener('input',event=>{
  event.stopPropagation();if(event.target.name!=='comparison-search')return;
  const el=event.target,start=el.selectionStart,end=el.selectionEnd;textFilter=el.value;page=0;renderRows();
  const next=host.querySelector('[name=comparison-search]');next.focus();if(start!==null)try{next.setSelectionRange(start,end);}catch{}
 },{signal});
 host.addEventListener('change',event=>{
  event.stopPropagation();if(busy||blocked)return;
  if(event.target.name==='comparison-before'){beforeId=event.target.value;invalidate();}
  if(event.target.name==='comparison-after'){afterId=event.target.value;invalidate();}
  if(event.target.name==='comparison-status'){statusFilter=event.target.value;page=0;renderRows();}
 },{signal});
 host.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();},{signal});
 host.addEventListener('click',event=>{
  event.stopPropagation();const button=event.target.closest('button[data-load-comparison-act]');if(!button||!host.contains(button))return;event.preventDefault();
  task(async token=>{
   const action=button.dataset.loadComparisonAct;
   if(action==='refresh'){
    message('Opening the original saved load catalogue…');const value=await api('/flow/load-catalogue');if(!alive(token))return;
    if(!Array.isArray(value.rows)||value.rows.some(r=>!ID.test(r.id||'')))throw Error('The original saved load catalogue is incomplete.');
    rows=copy(value.rows);renderChoices();message('Saved catalogue refreshed. The selected pair and load editor draft are unchanged.');return;
   }
   if(action==='swap'){const previous=beforeId;beforeId=afterId;afterId=previous;invalidate();return;}
   if(action==='compare'){
    if(!ID.test(beforeId)||!ID.test(afterId)||beforeId===afterId)throw Error('Choose two different exact saved load results.');
    const selected={before_id:beforeId,after_id:afterId};result=null;resultHost.replaceChildren();message('Reading both original load results and comparing scientific support…');
    const value=await api('/flow/load-comparison',{method:'POST',value:selected});if(!alive(token))return;
    result=copy(validateLoadComparison(value,selected));page=0;renderResult();message('Complete original comparison opened. Review support, coverage and changes before exporting.');return;
   }
   if(!result)throw Error('Compare the selected saved results first.');
   if(action==='view'){view=button.dataset.view;page=0;renderResult();return;}
   if(action==='previous'||action==='next'){page=Math.max(0,page+(action==='next'?1:-1));renderRows();return;}
   if(['report','bundle','csv'].includes(action)){
    const selected=loadComparisonSelection(result),input={...selected};
    message('Preparing the complete original '+action+' download…');
    const value=await api('/flow/load-comparison-'+action,{method:'POST',value:input});if(!alive(token))return;
    const bytes=await downloadBytes(value,selected,action);if(!alive(token))return;
    emitDownload(value,bytes);message('Downloaded '+value.name+' with its exact byte count and checksum. Open and inspect it as the recipient.');return;
   }
   throw Error('Unknown saved load comparison action.');
  });
 },{signal});
 renderChoices();renderResult();message(result?'Reopened the same retained result comparison.':'Choose two original saved load results; the contract editor remains independent.');
 return {
  snapshot(){return copy({beforeId,afterId,result,view,page,statusFilter,textFilter});},
  setDisabled(value){blocked=Boolean(value);controls();},
  setCatalogue(value){if(!Array.isArray(value))throw TypeError('Retain the saved load catalogue rows.');rows=copy(value);renderChoices();},
  destroy(){dead=true;generation++;controller.abort();host.replaceChildren();delete host.dataset.flowLoadComparison;}
 };
}
