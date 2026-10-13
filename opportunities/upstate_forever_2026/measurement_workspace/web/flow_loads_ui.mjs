/** Optional load integration over a saved original daily-flow study. */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=x=>JSON.parse(JSON.stringify(x));
const num=x=>x==null?'—':Number(x).toLocaleString(undefined,{maximumSignificantDigits:9});
const option=(v,t,s='')=>'<option value="'+esc(v)+'"'+(v===s?' selected':'')+'>'+esc(t)+'</option>';
const ORIGINAL_CONTRACT="{\n  \"schema\": \"upstate.observed-loads-contract/v1\",\n  \"period\": {\n    \"start\": \"2020-01-01\",\n    \"end\": \"2026-10-13\"\n  },\n  \"maximum_interpolation_gap_days\": 45,\n  \"daily_concentration_basis\": \"date_assigned_grab_with_daily_mean_flow\",\n  \"accepted_concentration_qualifiers\": [\n    \"\"\n  ],\n  \"accepted_concentration_statuses\": [\n    \"Final\"\n  ],\n  \"accepted_censoring_conditions\": [\n    \"Present Below Quantification Limit\",\n    \"Not Detected\"\n  ],\n  \"accepted_flow_approval_statuses\": [\n    \"Approved\"\n  ],\n  \"accepted_flow_qualifiers\": [\n    \"\"\n  ],\n  \"accepted_flow_validity\": [\n    \"\"\n  ],\n  \"event_sampling_policy\": \"retain_only\",\n  \"source_references\": [\n    \"https://www.waterqualitydata.us/\",\n    \"https://waterdata.usgs.gov/monitoring-location/02186702/\"\n  ],\n  \"support\": [\n    {\n      \"station_id\": \"21SC60WQ_WQX-SV-233\",\n      \"gauge_id\": \"USGS-02186702\",\n      \"gauge_relation\": \"downstream_same_reach\",\n      \"accepted\": false,\n      \"location_match\": false,\n      \"catchment_match\": false,\n      \"catchment_id\": \"\",\n      \"evidence\": [\n        \"original/eighteenmile-sv233-hydrolocation.json\",\n        \"original/eighteenmile-gauge-network-location.json\",\n        \"original/eighteenmile-upstream-wqp.json\"\n      ],\n      \"reason\": \"Original network relationship does not establish coincident concentration and discharge support.\"\n    },\n    {\n      \"station_id\": \"21SC60WQ_WQX-SV-245\",\n      \"gauge_id\": \"USGS-02186702\",\n      \"gauge_relation\": \"indexed_upstream_reach\",\n      \"accepted\": false,\n      \"location_match\": false,\n      \"catchment_match\": false,\n      \"catchment_id\": \"\",\n      \"evidence\": [\n        \"original/eighteenmile-sv245-hydrolocation.json\",\n        \"original/eighteenmile-gauge-network-location.json\",\n        \"original/eighteenmile-upstream-wqp.json\"\n      ],\n      \"reason\": \"Original network relationship does not establish coincident concentration and discharge support.\"\n    },\n    {\n      \"station_id\": \"21SC60WQ_WQX-SV-375\",\n      \"gauge_id\": \"USGS-02186702\",\n      \"gauge_relation\": \"indexed_upstream_reach\",\n      \"accepted\": false,\n      \"location_match\": false,\n      \"catchment_match\": false,\n      \"catchment_id\": \"\",\n      \"evidence\": [\n        \"original/eighteenmile-sv375-hydrolocation.json\",\n        \"original/eighteenmile-gauge-network-location.json\",\n        \"original/eighteenmile-upstream-wqp.json\"\n      ],\n      \"reason\": \"Original network relationship does not establish coincident concentration and discharge support.\"\n    },\n    {\n      \"station_id\": \"21SC60WQ_WQX-SV-376\",\n      \"gauge_id\": \"USGS-02186702\",\n      \"gauge_relation\": \"indexed_upstream_reach\",\n      \"accepted\": false,\n      \"location_match\": false,\n      \"catchment_match\": false,\n      \"catchment_id\": \"\",\n      \"evidence\": [\n        \"original/eighteenmile-sv376-hydrolocation.json\",\n        \"original/eighteenmile-gauge-network-location.json\",\n        \"original/eighteenmile-upstream-wqp.json\"\n      ],\n      \"reason\": \"Original network relationship does not establish coincident concentration and discharge support.\"\n    }\n  ],\n  \"native_comparison_mappings\": [],\n  \"seasons\": []\n}\n";
const CONTRACT_PATH='source/observed-load-integration-20261013/flow-study-load-contract.json';
function parse(text){const v=JSON.parse(text);if(v?.schema!=='upstate.observed-loads-contract/v1')throw Error('Choose a complete observed-loads contract.');return v;}
async function fileText(file){if(!file?.size)throw Error('Choose the original contract JSON.');if(file.size>16*1024*1024)throw Error('The contract exceeds the 16 MiB input limit.');return new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}
function download(name,value,type='application/json'){
 const text=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function saveBundle(value){
 if(!value||typeof value.base64!=='string'||!Number.isSafeInteger(value.bytes)||value.bytes<0||!/^[a-f0-9]{64}$/.test(value.sha256))throw Error('The retained bundle descriptor is incomplete.');
 const binary=atob(value.base64),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
 if(bytes.length!==value.bytes)throw Error('The retained bundle size differs from its descriptor.');
 if(globalThis.crypto?.subtle){const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');if(digest!==value.sha256)throw Error('The retained bundle checksum differs from its descriptor.');}
 const url=URL.createObjectURL(new Blob([bytes],{type:value.type||'application/zip'})),a=document.createElement('a');a.href=url;a.download=value.name||'flow-bundle.zip';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function table(headers,rows,label){return '<div class="mf-scroll" tabindex="0" role="region" aria-label="'+esc(label)+'"><table><thead><tr>'+headers.map(v=>'<th scope="col">'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function facts(values){return '<dl class="mf-facts">'+values.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(num(v))+'</dd></div>').join('')+'</dl>';}
export function mountFlowLoads(host,{api,request,studies=[],selectedStudy=null,initialState=null}={}){
 if(!(host instanceof Element)||typeof api!=='function'||typeof request!=='function')throw TypeError('Use the existing daily-flow API and host.');
 const controller=new AbortController(),signal=controller.signal;
 let dead=false,busy=false,catalogue=[],studyId=selectedStudy||'',contractText='',result=null,resultId='',previewInput=null,current=false,view='series',seriesKey='',page=0;
 if(initialState)({studyId,contractText,result,resultId,previewInput,current,view,seriesKey,page}=clone(initialState));
 host.classList.add('mf-loads');
 host.innerHTML='<section class="mf-card"><h3>Concentration and discharge loads</h3><p>Use a saved flow study and an explicit support/interpolation contract. Original methods, fractions, censoring and station relationships remain separate.</p><p class="mf-status" role="status" aria-live="polite">Opening saved load results…</p><div class="mf-load-body"></div></section>';
 const status=host.querySelector('[role=status]'),body=host.querySelector('.mf-load-body');
 function message(s,error=false){if(dead)return;status.textContent=s;status.dataset.error=String(error);}
 function controls(){host.setAttribute('aria-busy',String(busy));for(const el of host.querySelectorAll('button,input,textarea,select'))el.disabled=busy||el.dataset.unavailable==='true';}
 async function task(fn){if(dead||busy)return;busy=true;controls();try{await fn();}catch(e){if(!dead&&e.name!=='AbortError')message(e.message,true);}finally{busy=false;if(!dead)controls();}}
 function capture(){const id=host.querySelector('[name=load-study]'),editor=host.querySelector('[name=load-contract]');if(id)studyId=id.value;if(editor)contractText=editor.value;}
 function dirty(){capture();current=false;const save=host.querySelector('[data-load-act=save]');if(save){save.dataset.unavailable='true';save.disabled=true;}message('The selected study or contract changed. Preview this exact combination before saving.');}
 async function catalogueRefresh(){const response=await api('/flow/load-catalogue');if(!dead)catalogue=response.rows;}
 function editorHTML(){
  const choices=option('','Choose a saved flow study',studyId)+studies.map(s=>option(s.id,s.title+' · '+s.start+' – '+s.end,studyId)).join('');
  const missing=studyId&&!studies.some(s=>s.id===studyId)?option(studyId,'Retained parent '+studyId,studyId):'';
  return '<label>Original saved flow study<select name="load-study">'+choices+missing+'</select></label><div class="mf-actions"><button type="button" data-load-act="use-open" data-unavailable="'+String(!selectedStudy)+'">Use the open saved study</button><button type="button" data-load-act="original-contract">Load original context-only contract</button></div>'+
   '<p class="mf-muted">The retained example is '+esc(CONTRACT_PATH)+'. It explicitly declines matched support for the existing Eighteenmile concentration stations. Loading it does not change that evidence.</p>'+
   '<form data-load-form="contract"><label>Upload an explicit contract<input type="file" name="contract-file" accept=".json,application/json" required></label><button type="submit">Load contract file</button></form>'+
   '<label>Complete support and interpolation contract<textarea name="load-contract" rows="12" spellcheck="false" placeholder="Load the original contract, upload a complete one, or paste its JSON.">'+esc(contractText)+'</textarea></label>'+
   '<p class="mf-notice">The load contract end date is <strong>exclusive</strong>; the parent flow-study end date is inclusive. Keep the contract within the selected parent calendar. A new contract cannot promote downstream/regional flow to coincident catchment support.</p>'+
   '<div class="mf-actions"><button type="button" data-load-act="preview">Preview loads from this study</button><button type="button" data-load-act="draft-contract">Download draft contract</button></div>';
 }
 function savedHTML(){
  return '<details><summary>Saved load results ('+num(catalogue.length)+')</summary><div class="mf-actions"><button type="button" data-load-act="refresh">Refresh saved results</button></div>'+
   (catalogue.length?table(['Result / created','Original parent study','Series / context only','Open'],catalogue.map(r=>[
    '<strong>'+esc(r.title||'Saved load result')+'</strong><small>'+esc(r.created_at)+'</small>','<span class="mf-mono">'+esc(r.flow_study_id)+'</span>',num(r.counts?.series)+' / '+num(r.counts?.context_only_series),'<button type="button" data-load-act="open" data-id="'+esc(r.id)+'">Open result</button>'
   ]),'Saved original load results'):'<p class="mf-muted">No load calculation has been saved. Context-only results can be saved with the same original evidence.</p>')+'</details>';
 }
 function render(){if(dead)return;body.innerHTML=savedHTML()+editorHTML()+'<div class="mf-load-result"></div>';renderResult();controls();}
 function renderResult(){
  const target=host.querySelector('.mf-load-result');if(!result){target.innerHTML='';return;}
  const calc=result.integration,counts=calc.counts,annual=result.observationExports.annual_count;
  target.innerHTML='<hr><div class="mf-heading"><h4>'+ (resultId?'Saved load result':'Load preview')+'</h4><span class="mf-tag">'+(resultId?'Retained':'Not yet saved')+'</span></div>'+
   '<p class="mf-mono">Parent study '+esc(result.flow_study_id)+'<br>Contract SHA-256 '+esc(result.contract_sha256)+(resultId?'<br>Result '+esc(resultId):'')+'</p>'+
   facts([['Original samples',counts.source_samples],['Original flow rows',counts.source_flows],['Method/fraction series',counts.series],['Matched-support series',counts.support_admitted_series],['Context-only series',counts.context_only_series],['Admissible annual rows',annual]])+
   (counts.support_admitted_series===0?'<p class="mf-notice"><strong>These observations remain context only.</strong> No series has accepted coincident concentration and catchment-discharge support. There are no annual loads to compare with native exports. The original samples, station relationships and exclusion reasons remain available below.</p>':'<p class="mf-notice">Mass covers only quantified days. Missing periods are not annualized. Finite censoring bounds are not point estimates or confidence intervals. Flow-weighted concentrations use the same quantified-day mass and discharge volume; missing days enter neither term, and zero volume has no defined mean. Annual rows require complete calendar-year coverage and an explicit compatible species/fraction mapping.</p>')+
   '<div class="mf-actions"><button type="button" data-load-act="save" data-unavailable="'+String(!current||Boolean(resultId))+'">'+(resultId?'Result saved':'Save this preview')+'</button><button type="button" data-load-act="json">Complete load result JSON</button><button type="button" data-load-act="result-contract">Selected result contract</button><button type="button" data-load-act="parent">Parent study with full originals</button></div>'+
   '<div class="mf-actions">'+[['bundle','Complete original ZIP'],['report.html','Readable report HTML'],['periods.csv','Period masses CSV'],['daily.csv','Daily loads CSV'],['context.csv','Original context CSV'],['annual.csv','Admissible annual CSV']].map(([file,title])=>'<button type="button" data-load-act="download" data-file="'+file+'" data-unavailable="'+String(!resultId)+'">'+title+'</button>').join('')+'</div>'+
   (!resultId?'<p class="mf-muted">Save this exact result to download its server-rendered report and complete CSVs.</p>':'')+
   '<p class="mf-muted">For offline report links, keep the individual named files together or use the complete ZIP. Put each saved result in its own folder.</p><nav class="mf-tabs" aria-label="Load result views">'+[['series','Series and support'],['periods','Period masses and bounds'],['daily','Daily calculations'],['sources','Original sample context']].map(([id,title])=>'<button type="button" data-load-act="view" data-view="'+id+'" aria-current="'+String(view===id)+'">'+title+'</button>').join('')+'</nav><div class="mf-load-view"></div>';
  renderView();controls();
 }
 function quantityContext(series){const c=series.series_context;if(!c)return '';return '<small>Chemical basis: '+esc(c.chemical_basis||'Unspecified')+' · Normalized unit: '+esc(c.normalized_unit||'Unspecified')+' · Original speciation: '+esc(Array.isArray(c.source_speciation)?c.source_speciation.join('; '):c.source_speciation||'Unspecified')+'</small>';}
 function seriesSelection(){return '<label class="mf-row-filter">Original method/fraction series<select name="load-series">'+option('','All original series',seriesKey)+result.integration.series.map(s=>option(s.series_key,s.station_id+' · '+s.characteristic+' / '+s.sample_fraction+' / '+s.method_id,seriesKey)).join('')+'</select></label>';}
 function renderView(){
  if(!result)return;const target=host.querySelector('.mf-load-view'),calc=result.integration,chosen=calc.series.filter(s=>!seriesKey||s.series_key===seriesKey);
  if(view==='series'){
   target.innerHTML=table(['Original station / characteristic','Fraction / method','Samples: original / usable / censored','Gauge relationship','Support and status','Quantified / expected days','Point mass (kg)','Lower / upper mass (kg)','Quantified volume (m³)','Flow-weighted concentration: point / lower / upper (mg/L)'],calc.series.map(s=>{
    const p=s.periods[0];return[esc(s.station_id)+'<small>'+esc(s.characteristic)+'</small>'+quantityContext(s),esc(s.sample_fraction)+'<small>'+esc(s.method_context)+' / '+esc(s.method_id)+'</small>',[s.source_sample_count,s.usable_sample_count,s.censored_sample_count].map(num).join(' / '),esc(s.support.gauge_relation||'Unassigned'),esc(s.support.issues.join('; ')||s.status),p?num(p.quantified_days)+' / '+num(p.expected_days):'No matched support',num(p?.load_kg),num(p?.load_lower_kg)+' / '+num(p?.load_upper_kg),num(p?.quantified_flow_volume_m3),[p?.flow_weighted_concentration_mg_l,p?.flow_weighted_concentration_lower_mg_l,p?.flow_weighted_concentration_upper_mg_l].map(num).join(' / ')];
   }),'Original series, support and retained mass bounds')+
   '<details><summary>Original uncertainty and temporal approximation</summary><pre>'+esc(JSON.stringify({method:calc.method,uncertainty:calc.uncertainty,source_binding:result.source_binding},null,2))+'</pre></details>';return;
  }
  let rows=[];
  if(view==='periods')rows=chosen.flatMap(s=>[...s.periods.map(r=>({...r,series:s,kind:'Selected or seasonal period'})),...s.annual.map(r=>({...r,series:s,kind:'Calendar-year window'}))]);
  if(view==='daily')rows=chosen.flatMap(s=>s.daily.map(r=>({...r,series:s})));
  if(view==='sources')rows=calc.source_samples.filter(s=>!seriesKey||s.series_key===seriesKey);
  const size=50;page=Math.min(page,Math.max(0,Math.ceil(rows.length/size)-1));const visible=rows.slice(page*size,(page+1)*size);
  let html=seriesSelection();
  if(!rows.length)html+='<p class="mf-notice">'+(view==='sources'?'No source samples match this selection.':'No quantified calculation rows exist for this series selection. Inspect the original support and exclusion reasons in Series and support; no missing load is represented as zero.')+'</p>';
  if(view==='periods'&&rows.length)html+=table(['Series / period','Dates (end exclusive)','Quantified / expected','Coverage complete / full calendar year','Point mass (kg)','Lower / upper mass (kg)','Censored / sampled / interpolated days','Quantified volume (m³)','Flow-weighted concentration: point / lower / upper (mg/L)','Inspect'],visible.map((r,i)=>[
   esc(r.series.station_id)+'<small>'+esc(r.series.characteristic)+' / '+esc(r.series.sample_fraction)+' / '+esc(r.series.method_id)+'</small>'+quantityContext(r.series)+esc(r.kind)+' · '+esc(r.label),esc(r.period_start)+' – '+esc(r.period_end),num(r.quantified_days)+' / '+num(r.expected_days),(r.coverage_complete?'Yes':'No')+' / '+(r.whole_calendar_year===undefined?'Not a calendar-year row':r.whole_calendar_year?'Yes':'No'),num(r.load_kg),num(r.load_lower_kg)+' / '+num(r.load_upper_kg),[r.censored_days,r.sampled_days,r.interpolated_days].map(num).join(' / '),num(r.quantified_flow_volume_m3),[r.flow_weighted_concentration_mg_l,r.flow_weighted_concentration_lower_mg_l,r.flow_weighted_concentration_upper_mg_l].map(num).join(' / ')+'<small>'+esc(r.flow_weighted_concentration_basis)+'</small>','<button type="button" data-load-act="row" data-index="'+i+'">Original row</button>'
  ]),'Period mass and censoring bounds');
  if(view==='daily'&&rows.length)html+=table(['Series / date','Concentration (mg/L)','Lower / upper (mg/L)','Daily Q (m³/s)','Point load (kg/day)','Lower / upper (kg/day)','Basis / exclusions','Inspect'],visible.map((r,i)=>[
   esc(r.series.station_id)+'<small>'+esc(r.series.characteristic)+' / '+esc(r.series.sample_fraction)+' / '+esc(r.series.method_id)+'</small>'+quantityContext(r.series)+esc(r.date),num(r.concentration_mg_l),num(r.concentration_lower_mg_l)+' / '+num(r.concentration_upper_mg_l),num(r.discharge_m3_s),num(r.load_kg),num(r.load_lower_kg)+' / '+num(r.load_upper_kg),esc(r.concentration_basis||'Unquantified')+'<small>'+esc(r.issues.join('; '))+'</small>','<button type="button" data-load-act="row" data-index="'+i+'">Original row</button>'
  ]),'Daily concentration/discharge calculations');
  if(view==='sources'&&rows.length)html+=table(['Original station / date','Characteristic / fraction','Original value / unit','Detection / limit','Method','Usable / reasons','Inspect'],visible.map((r,i)=>[
   esc(r.station_id)+'<small>'+esc(r.date)+'</small>',esc(r.characteristic)+'<small>'+esc(r.sample_fraction)+'</small>',esc(r.original.value)+' '+esc(r.original.unit),esc(r.original.detection_condition||'None reported')+'<small>'+esc(r.original.limit_value)+' '+esc(r.original.limit_unit)+'</small>',esc(r.method_context)+' / '+esc(r.method_id),esc(r.usable?'Accepted by concentration contract':'Not quantified')+'<small>'+esc(r.issues.join('; '))+'</small>','<button type="button" data-load-act="row" data-index="'+i+'">Original source</button>'
  ]),'Complete original concentration context');
  target.innerHTML=html+'<div class="mf-actions"><button type="button" data-load-act="previous" data-unavailable="'+String(!page)+'">Previous rows</button><span>'+num(rows.length?Math.min(rows.length,page*size+1):0)+'–'+num(Math.min(rows.length,(page+1)*size))+' of '+num(rows.length)+'</span><button type="button" data-load-act="next" data-unavailable="'+String((page+1)*size>=rows.length)+'">Next rows</button></div><div class="mf-load-detail"></div>';target._rows=visible;controls();
 }
 host.addEventListener('input',event=>{event.stopPropagation();if(event.target.name==='load-contract')dirty();},{signal});
 host.addEventListener('change',event=>{event.stopPropagation();if(event.target.name==='load-study')dirty();if(event.target.name==='load-series'){seriesKey=event.target.value;page=0;renderView();}},{signal});
 host.addEventListener('submit',event=>{
  const form=event.target.closest('[data-load-form]');if(!form)return;event.preventDefault();event.stopPropagation();const data=new FormData(form);
  task(async()=>{const original=await fileText(data.get('contract-file'));parse(original);capture();contractText=original;current=false;render();message('Complete original contract loaded. Review its source support and exclusive period before previewing.');});
 },{signal});
 host.addEventListener('click',event=>{
  const b=event.target.closest('button[data-load-act]');if(!b||!host.contains(b))return;event.preventDefault();event.stopPropagation();
  task(async()=>{
   const act=b.dataset.loadAct;
   if(act==='original-contract'){capture();contractText=ORIGINAL_CONTRACT;current=false;render();message('Original extended Eighteenmile contract loaded unchanged. It records regional context only; check its period against your selected parent.');}
   if(act==='use-open'){if(!selectedStudy)throw Error('Open and save a flow study first.');capture();studyId=selectedStudy;current=false;render();message('Open saved study selected. The contract has not been changed.');}
   if(act==='draft-contract'){capture();parse(contractText);download('flow-load-contract-draft.json',contractText);}
   if(act==='refresh'){capture();await catalogueRefresh();render();message('Saved load results refreshed; the draft remains intact.');}
   if(act==='preview'){
    capture();if(!studyId)throw Error('Select an original saved flow study.');
    const input={study_id:studyId,contract:parse(contractText)};message('Reproducing original source binding and calculating coverage…');
    const value=await api('/flow/load-preview',{method:'POST',value:input});if(dead)return;
    result=value;resultId='';previewInput=clone(input);current=true;view='series';seriesKey='';page=0;renderResult();
    message('Preview complete: '+num(value.integration.counts.context_only_series)+' context-only series, '+num(value.observationExports.annual_count)+' admissible annual rows. Review support, coverage and censoring before saving.');
   }
   if(act==='save'){
    if(!result||!previewInput||!current||resultId)throw Error('Preview the current original study and contract first.');
    const response=await api('/flow/load-save',{method:'POST',value:{...previewInput,expected_id:result.id}});if(dead)return;result=response.result;resultId=response.id;await catalogueRefresh();render();message(response.duplicate?'This exact load result is already retained.':'Saved original load result and immutable parent binding.');
   }
   if(act==='open'){
    const value=await api('/flow/load-results/'+encodeURIComponent(b.dataset.id));if(dead)return;result=value;resultId=b.dataset.id;studyId=value.flow_study_id;contractText=JSON.stringify(value.integration.contract,null,2);previewInput={study_id:studyId,contract:clone(value.integration.contract)};current=true;view='series';seriesKey='';page=0;render();message('Opened the retained load result with its exact original contract and parent study.');
   }
   if(act==='json')download('flow-loads.json',result);
   if(act==='result-contract')download('contract.json',result.integration.contract);
   if(act==='parent'){const value=await api('/flow/studies/'+encodeURIComponent(result.flow_study_id));if(dead)return;download('flow-study.json',value);}
   if(act==='download'){
    if(!resultId)throw Error('Save the exact load preview first.');
    if(b.dataset.file==='bundle'){const value=await api('/flow/load-results/'+encodeURIComponent(resultId)+'/bundle');if(dead)return;await saveBundle(value);return;}
    const response=await request('/flow/load-results/'+encodeURIComponent(resultId)+'/'+b.dataset.file,'GET'),text=await response.text();
    if(!response.ok)throw Error(text);if(dead)return;download(({'report.html':'load-report.html','periods.csv':'period-loads.csv','daily.csv':'daily-loads.csv','context.csv':'concentration-context.csv','annual.csv':'annual-loads.csv'})[b.dataset.file],text,b.dataset.file.endsWith('.html')?'text/html;charset=utf-8':'text/csv;charset=utf-8');
   }
   if(act==='view'){view=b.dataset.view;seriesKey='';page=0;renderResult();}
   if(act==='previous'){page=Math.max(0,page-1);renderView();}
   if(act==='next'){page++;renderView();}
   if(act==='row'){const target=host.querySelector('.mf-load-view'),r=target._rows?.[Number(b.dataset.index)];const {series,...row}=r||{};target.querySelector('.mf-load-detail').innerHTML='<details open><summary>Complete original calculation/source row</summary><pre>'+esc(JSON.stringify(row,null,2))+'</pre></details>';}
  });
 },{signal});
 task(async()=>{await catalogueRefresh();if(dead)return;render();message('Choose a saved parent study and a complete explicit contract. Context-only results remain usable original records.');});
 return {snapshot(){capture();return clone({studyId,contractText,result,resultId,previewInput,current,view,seriesKey,page});},destroy(){dead=true;controller.abort();host.replaceChildren();host.classList.remove('mf-loads');}};
}
