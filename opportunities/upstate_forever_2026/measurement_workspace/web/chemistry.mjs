/** Explicit measured-record binding into the original native Chemistry desk. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=v=>JSON.stringify(v,null,2);
const copy=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>JSON.stringify(v&&typeof v==='object'?(Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))]))):v);
const option=(v,t,current)=>'<option value="'+esc(v)+'"'+(v===current?' selected':'')+'>'+esc(t)+'</option>';
const text=(name,label,value='',attrs='')=>'<label>'+esc(label)+'<input name="'+esc(name)+'" value="'+esc(value)+'" '+attrs+'></label>';
const note=(name,label,value='',attrs='')=>'<label>'+esc(label)+'<textarea name="'+esc(name)+'" rows="2" '+attrs+'>'+esc(value)+'</textarea></label>';
const select=(name,label,items,value='')=>'<label>'+esc(label)+'<select name="'+esc(name)+'">'+items.map(([v,t])=>option(v,t,value)).join('')+'</select></label>';
const table=(rows,columns)=>'<div class="mb-scroll"><table><thead><tr>'+columns.map(([k,label])=>'<th>'+esc(label)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+columns.map(([k])=>'<td>'+esc(typeof row[k]==='object'?JSON.stringify(row[k]):row[k])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const titleOf=x=>x.title||x.label||x.name||x.id;
const recordId=x=>x.record_id||x.id||x.record?.id;
const operator=x=>x.species||((x.components||[]).map(c=>c.weight+' × '+c.species).join(' + '));
const interval=x=>x.qualifier==='interval'?(x.lower_closed?'[':'(')+x.lower_mg_l+', '+x.upper_mg_l+(x.upper_closed?']':')'):(x.qualifier==='below'?'≤ ':'')+(x.mg_l??x.value??'');
export function mountMeasuredChemistry(root,host,{memory=new Map()}={}){
 const workspace=host.getWorkspace(),controller=new AbortController(),storageKey='upstate-measured-chemistry:'+workspace;
 let dead=false,busy=false,epoch=0,catalog={cases:[],bindings:[],measurement_choices:[]},inspected=null,prepared=null,selectedRow=0;
 let saved=memory.get(workspace);
 if(!saved){try{saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}}
 let rawDraft=saved?.rawDraft||{},draft=saved?.draft||null,caseChoice=saved?.caseChoice||'',filters=saved?.filters||{},preparedId=saved?.preparedId||'';
 const active=()=>!dead&&host.getWorkspace()===workspace;
 const call=async(action,payload={})=>{
  if(!active())throw Error('Reopen this measured-data workspace before continuing.');
  return host.api('/api/measurements/chemistry',{method:'POST',body:{workspace,action,...payload}});
 };
 root.classList.add('mb');
 root.innerHTML='<style>.mb{margin:18px 0;padding:20px;border:1px solid #c8c8c8;background:#fff;color:#222;font:14px system-ui}.mb h2,.mb h3{margin:0 0 12px}.mb p{line-height:1.5}.mb label{display:grid;gap:5px;margin:8px 0}.mb input,.mb select,.mb textarea,.mb button{font:inherit;color:inherit;border:1px solid #999;background:#fff;padding:8px;max-width:100%;box-sizing:border-box}.mb button{cursor:pointer}.mb button:disabled{cursor:default;opacity:.6}.mb textarea{width:100%;font-family:ui-monospace,monospace}.mb fieldset{border:1px solid #ccc;margin:16px 0;padding:14px}.mb legend{font-weight:600}.mb .mb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.mb .mb-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0}.mb details{margin:12px 0;padding:12px;border:1px solid #ddd}.mb summary{cursor:pointer;font-weight:600}.mb .mb-scroll{overflow:auto;max-height:450px}.mb table{border-collapse:collapse;width:100%}.mb th,.mb td{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}.mb th{background:#f3f3f3}.mb .mb-check{display:flex;align-items:center;gap:8px}.mb .mb-check input{width:auto}.mb [role=status]{padding:10px;background:#f3f3f3;white-space:pre-wrap}.mb [data-error=true]{border-left:4px solid #555}.mb pre{max-height:420px;overflow:auto;white-space:pre-wrap;word-break:break-word}.mb small{display:block;color:#555}</style><details data-mb-panel><summary>Bind reviewed measurements to Reach chemistry</summary><p>Use the original measured records and an existing physical model. Choose the station, time, measurement operator and error scale explicitly; saved bindings retain accepted records, exclusions and original source history.</p><div role="status" aria-live="polite">Open this panel to read saved cases and bindings.</div><div data-mb-library></div><div data-mb-editor></div><div data-mb-result></div><div data-mb-task></div></details>';
 const panel=root.querySelector('[data-mb-panel]'),status=root.querySelector('[role=status]'),library=root.querySelector('[data-mb-library]'),editor=root.querySelector('[data-mb-editor]'),result=root.querySelector('[data-mb-result]');
 function message(value,error=false){if(!active())return;status.textContent=value;status.dataset.error=String(error);}
 function persist(){
  const value={draft,rawDraft,caseChoice,filters,preparedId};
  memory.set(workspace,value);
  try{sessionStorage.setItem(storageKey,JSON.stringify(value));}catch{}
 }
 function captured(){if(inspected&&editor.querySelector('form')){for(const name of ['request','interval_overrides','derived_total_nitrogen']){const input=editor.querySelector('[name="'+name+'"]');if(input)rawDraft[name]=input.value;}try{draft=collect(false);}catch{}}persist();}
 async function task(fn){
  if(busy||!active())return;
  busy=true;const controls=[...root.querySelectorAll('button,input,select,textarea')].map(n=>[n,n.disabled]);
  controls.forEach(([n])=>n.disabled=true);
  try{await fn();}catch(error){message(error.message||String(error),true);}
  finally{controls.forEach(([n,v])=>n.disabled=v);busy=false;}
 }
 function renderLibrary(){
  library.innerHTML='<h3>Case and source population</h3><form data-mb-inspect><div class="mb-grid">'+
   select('case_id','Saved physical model',[['','Choose a saved case'],...catalog.cases.map(c=>[c.id,titleOf(c)])],caseChoice)+
   text('stationId','Original station ID (optional)',filters.stationId)+text('from','From source date',filters.from,'type="date"')+
   text('to','Through source date',filters.to,'type="date"')+text('parameter','Normalized parameter (optional)',filters.parameter)+
   '</div><div class="mb-actions"><button>Inspect original records</button><button type="button" data-mb-action="catalog">Refresh saved library</button></div></form>'+
   '<label>Saved source-bound binding<select data-mb-saved>'+option('','Choose a saved binding','')+catalog.bindings.map(b=>option(b.id,titleOf(b),preparedId)).join('')+'</select></label>'+
   '<div class="mb-actions"><button type="button" data-mb-action="open-binding">Reopen selected binding</button></div>';
 }
 function initialDraft(value){
  const prior=draft?.case_id===value.case.id?draft:{};
  return {...prior,case_id:value.case.id,expected_revision:value.revision,filters:copy(value.filters||filters),
   title:prior.title||'',reviewer:prior.reviewer||'',reason:prior.reason||'',
   station_bindings:prior.station_bindings||[],measurement_mappings:prior.measurement_mappings||[],
   time_origin:prior.time_origin||'',day_overrides:prior.day_overrides||{},interval_overrides:prior.interval_overrides||{},
   roles:{default:'fit',holdout_from:'',...prior.roles,by_record:prior.roles?.by_record||{}},allow_censored:prior.allow_censored??true,
   request:prior.request||{mode:'calibrate',parameters:[]}};
 }
 const groupKey=g=>canonical([g.characteristic||'',g.method||'',g.fraction||'']);
 function drawEditor(){
  if(!inspected)return;
  const value=draft,project=inspected.case.project,records=inspected.records||[],groups=inspected.groups||[];
  const stations=[...new Set(records.map(r=>r.stationId).filter(Boolean))].sort(),species=project.species||[],reaches=project.reaches||[];
  const mapping=new Map((value.measurement_mappings||[]).map(g=>[groupKey(g),g]));
  editor.innerHTML='<h3>Binding definition</h3><p>'+esc(titleOf(inspected.case))+' · '+records.length+' original records · '+groups.length+' method/fraction groups · measured revision '+esc(inspected.revision)+'. Review a refreshed population before saving if measured records change.</p>'+
   '<form data-mb-prepare><fieldset><legend>Scientific review</legend><div class="mb-grid">'+text('title','Binding title',value.title,'required')+text('reviewer','Prepared / reviewed by',value.reviewer,'required')+'</div>'+note('binding_reason','Why these measurements support this physical model',value.reason,'required')+'</fieldset>'+
   '<fieldset><legend>Station to native reach</legend><p>Only entered assignments are used. Original station names or geographic proximity do not determine a reach.</p>'+stations.map((station,i)=>{
    const item=value.station_bindings.find(s=>s.station_id===station)||{};
    return '<details data-station-index="'+i+'"><summary>'+esc(station)+'</summary>'+select('reach','Native reach',[['','Leave unassigned'],...reaches.map(r=>[r.id,titleOf(r)])],item.reach_id||'')+note('reason','Assignment rationale',item.reason)+text('reference','Source reference',item.reference)+'</details>';
   }).join('')+'</fieldset>'+
   '<fieldset><legend>Measurement definitions</legend><p>Choose a measured quantity for each exact characteristic, method and fraction. Enter positive weights for the nonoverlapping modeled pools that represent it. All components must share the declared conserved basis. A total-N mapping must not count ammonia twice inside TKN.</p>'+groups.map((g,i)=>{
    const m=mapping.get(groupKey(g))||{},components=new Map((m.components||[]).map(c=>[c.species,c.weight]));
    return '<details data-group-index="'+i+'"><summary>'+esc(g.characteristic||'(no characteristic)')+' · '+esc(g.method||'method unspecified')+' · '+esc(g.fraction||'fraction unspecified')+' · '+g.count+' records</summary>'+
     '<p>Retained basis '+esc(g.basis||'unspecified')+'; units '+esc(g.unit||'unspecified')+'. Censoring: '+esc(JSON.stringify(g.censors||{}))+'. Current eligibility reasons: '+esc(JSON.stringify(g.exclusions||{}))+'.</p>'+
     '<label class="mb-check"><input name="include" type="checkbox" '+(m.measurement?'checked':'')+'>Include this measurement mapping</label>'+
     '<div class="mb-grid">'+select('measurement','Measured quantity',[['','Choose a quantity'],...(inspected.measurement_choices||catalog.measurement_choices).map(c=>[c.id,titleOf(c)])],m.measurement||'')+
     select('basis','Conserved mass basis',[['','Choose exact basis'],...[...new Set(species.map(s=>s.basis))].map(b=>[b,b])],m.basis||'')+'</div>'+
     '<div class="mb-grid">'+species.map(s=>text('weight:'+s.id,s.id+' ('+s.basis+') weight',components.get(s.id)??'','type="number" min="0" step="any"')).join('')+'</div>'+
     text('basis_reference','Source supporting this mass basis and fraction',m.basis_reference)+note('basis_reason','Why this operator represents the reported measurement',m.basis_reason)+
     text('sigma_mg_l','Observation error scale (mg of declared basis/L)',m.sigma_mg_l??'','type="number" min="0" step="any"')+note('uncertainty_reason','Error scale rationale',m.uncertainty_reason)+'</details>';
   }).join('')+'</fieldset>'+
   '<fieldset><legend>Time and fit / holdout</legend><div class="mb-grid">'+text('time_origin','Model day zero (ISO timestamp with timezone)',value.time_origin,'placeholder="2023-01-01T00:00:00-05:00" required')+
    select('default_role','Default role',[['fit','Fit'],['holdout','Holdout']],value.roles.default)+text('holdout_from','Hold out on or after source date',value.roles.holdout_from,'type="date"')+'</div>'+
    '<label class="mb-check"><input name="allow_censored" type="checkbox" '+(value.allow_censored?'checked':'')+'>Retain supported finite censored bounds</label>'+
    '<details><summary>Individual records, original rows and time overrides</summary><div data-mb-records></div></details>'+
    '<details><summary>Explicit finite interval and derived-total definitions</summary><p>Interval overrides are keyed by original record ID and require lower_mg_l, upper_mg_l, lower_closed, upper_closed and reason. They must preserve the original declared bounds; an absent upper bound cannot be invented. A reviewed left-censored concentration may use physical zero as its lower limit.</p><p>A derived total-nitrogen definition requires measurement total_nitrogen, basis N, basis_reference, basis_reason, components, sigma_mg_l and uncertainty_reason. The native producer pairs original TKN + NOx within the same actual activity and replaces those two fitting targets with their sum. Raw source records remain retained; ammonia is already inside TKN.</p>'+
    note('interval_overrides','Native interval overrides JSON',rawDraft.interval_overrides??pretty(value.interval_overrides||{}))+
    note('derived_total_nitrogen','Native derived total-nitrogen JSON (optional)',rawDraft.derived_total_nitrogen??(value.derived_total_nitrogen?pretty(value.derived_total_nitrogen):''))+'</details></fieldset>'+
   '<fieldset><legend>Native analysis request</legend><p>Choose parameter targets and bounds for this physical case. The binding supplies its retained observation array; it does not guess rate, load or prior values.</p>'+note('request','Complete native request JSON',rawDraft.request??pretty(value.request),'required rows="8"')+
    '<details><summary>Available physical parameter targets</summary>'+table([...(project.reactions||[]).map(r=>({id:r.id,kind:'reaction_rate_day',value:r.rate_day})),...(project.loads||[]).map(r=>({id:r.id,kind:'load_kg_day',value:r.kg_day}))],[['id','Original target'],['kind','Parameter kind'],['value','Retained value']])+
    '<p>Calibration parameter entries use id, kind, target, lower and upper. Select scientifically supported bounds. Monitoring and uncertainty retain their original native request requirements.</p></details></fieldset>'+
    '<div class="mb-actions"><button>Save reviewed binding and source-bound case</button><button type="button" data-mb-action="draft-export">Export working binding definition</button></div></form>';
  drawRecords();
 }
 function parseJSON(raw,label,fallback){
  if(!raw.trim())return fallback;
  try{return JSON.parse(raw);}catch{throw Error(label+' must be valid JSON.');}
 }
 function numeric(node,label,strict){
  if(strict&&node.validity.badInput)throw Error(label+' must be a finite number.');
  if(!node.value.trim())return null;
  const value=Number(node.value);
  if(strict&&(!Number.isFinite(value)||node.validity.badInput))throw Error(label+' must be finite.');
  return value;
 }
 function collect(strict){
  const form=editor.querySelector('form'),q=name=>form.elements.namedItem(name);
  const v={...copy(draft),case_id:inspected.case.id,expected_revision:inspected.revision,filters:copy(inspected.filters||filters)};
  for(const name of ['title','reviewer','time_origin'])v[name]=q(name).value.trim();
  v.reason=q('binding_reason').value.trim();
  v.station_bindings=[...form.querySelectorAll('[data-station-index]')].flatMap(box=>{
   const stations=[...new Set(inspected.records.map(r=>r.stationId).filter(Boolean))].sort(),get=name=>box.querySelector('[name="'+name+'"]').value.trim(),reach=get('reach');
   if(!reach)return[];
   const row={station_id:stations[Number(box.dataset.stationIndex)],reach_id:reach,reason:get('reason'),reference:get('reference')};
   if(strict&&(!row.reason||!row.reference))throw Error('Add assignment rationale and reference for '+row.station_id+'.');
   return[row];
  });
  v.measurement_mappings=[...form.querySelectorAll('[data-group-index]')].flatMap(box=>{
   if(!box.querySelector('[name=include]').checked)return[];
   const original=inspected.groups[Number(box.dataset.groupIndex)],get=name=>box.querySelector('[name="'+name+'"]').value.trim();
   const m={characteristic:original.characteristic||'',method:original.method||'',fraction:original.fraction||''};
   for(const name of ['measurement','basis','basis_reference','basis_reason','uncertainty_reason'])m[name]=get(name);
   m.sigma_mg_l=numeric(box.querySelector('[name=sigma_mg_l]'),'Observation error',strict);
   m.components=[...box.querySelectorAll('[name^="weight:"]')].flatMap(input=>{
    const weight=numeric(input,'Component weight',strict);if(weight===null)return[];
    if(strict&&weight<=0)throw Error('Component weights must be positive; leave unused pools blank.');
    const species=input.name.slice(7),known=inspected.case.project.species.find(s=>s.id===species);
    if(strict&&known.basis!==m.basis)throw Error('Component '+species+' does not share the declared basis.');
    return[{species,weight}];
   });
   if(strict&&(!m.components.length||!m.measurement||!m.basis||!m.basis_reference||!m.basis_reason||!m.uncertainty_reason||!(m.sigma_mg_l>0)))throw Error('Complete the measurement, components, basis evidence and positive error scale for '+m.characteristic+'.');
   return[m];
  });
  v.roles={...v.roles,default:q('default_role').value,holdout_from:q('holdout_from').value};
  if(!v.roles.holdout_from)delete v.roles.holdout_from;
  v.allow_censored=q('allow_censored').checked;
  const jsonField=(name,label,fallback)=>{try{return parseJSON(q(name).value,label,fallback);}catch(error){if(strict)throw error;return draft[name]??fallback;}};
  v.request=jsonField('request','Native request',{});
  v.interval_overrides=jsonField('interval_overrides','Interval overrides',{});
  const derived=jsonField('derived_total_nitrogen','Derived total definition',null);
  if(derived)v.derived_total_nitrogen=derived;else delete v.derived_total_nitrogen;
  if(strict){
   if(!v.title||!v.reviewer||!v.reason)throw Error('Complete the binding title, reviewer and scientific rationale.');
   if(!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(v.time_origin)||!Number.isFinite(Date.parse(v.time_origin)))throw Error('Model day zero needs an ISO timestamp with an explicit timezone.');
   if(!v.station_bindings.length||!v.measurement_mappings.length)throw Error('Select at least one station assignment and one explicit measurement mapping.');
   if(!v.request||typeof v.request!=='object'||Array.isArray(v.request))throw Error('The native request must be an object.');
   if(Object.hasOwn(v.request,'observations'))throw Error('Remove observations from the request; the reviewed measured binding supplies them.');
  }
  return v;
 }
 function drawRecords(){
  const target=editor.querySelector('[data-mb-records]');if(!target)return;
  const rows=inspected.records||[],start=selectedRow*20,page=rows.slice(start,start+20);
  target.innerHTML='<p>'+rows.length+' original records. Inspect source reviews in the Measurements tab; QC and selected source revisions are checked again by the native binding.</p>'+
   '<div class="mb-actions"><button type="button" data-mb-action="records-previous" '+(start===0?'disabled':'')+'>Previous</button><span>'+(rows.length?start+1:0)+'–'+Math.min(start+20,rows.length)+'</span><button type="button" data-mb-action="records-next" '+(start+20>=rows.length?'disabled':'')+'>Next</button></div>'+
   page.map(r=>{
    const override=draft.day_overrides?.[r.id]||{},role=draft.roles.by_record?.[r.id]||'';
    return '<details data-record-id="'+esc(r.id)+'"><summary>'+esc(r.stationId)+' · '+esc(r.sampledDate)+' · '+esc(r.characteristic)+' · '+esc(r.reportedValue??r.value)+' '+esc(r.reportedUnit||r.unit)+'</summary>'+
     '<p>Current eligibility: '+esc(r.eligible?.ok?'eligible':(r.eligible?.reasons||[]).join('; '))+'. Source review: '+esc(r.review?.state||'pending')+'.</p>'+
     '<dl><dt>Original sampling time</dt><dd>'+esc(r.sampledAt||r.sourceTime||r.sampledDate)+' · '+esc(r.timePrecision||'source precision unspecified')+' · '+esc(r.timeZone||'timezone unspecified')+'</dd><dt>Method / laboratory</dt><dd>'+esc(r.method||'unspecified')+' / '+esc(r.laboratory||'unspecified')+'</dd><dt>Reported fraction / basis</dt><dd>'+esc(r.fraction||'unspecified')+' / '+esc(r.basis||'unspecified')+'</dd><dt>Normalized source value and bounds</dt><dd>'+esc(r.value??'')+' '+esc(r.unit||'')+' · '+esc(r.censor||'')+' · lower '+esc(r.lower??'absent')+' / upper '+esc(r.upper??'absent')+'</dd></dl>'+
     '<div class="mb-grid">'+select('record_role','Individual role',[['','Use date/default rule'],['fit','Fit'],['holdout','Holdout']],role)+text('day','Explicit model day (optional)',override.day??'','type="number" min="0" step="any"')+'</div>'+
     note('day_reason','Reason for explicit day',override.reason||'')+
     '<button type="button" data-mb-action="record-apply">Keep record timing and role</button><details><summary>Complete original record and source history</summary><pre>'+esc(pretty(r))+'</pre></details></details>';
   }).join('');
 }
 async function inspectPopulation(){
  captured();const form=library.querySelector('form'),values=Object.fromEntries([...form.querySelectorAll('[name]')].map(input=>[input.name,input.value]));
  if(!values.case_id)throw Error('Choose the saved physical case.');
  if(caseChoice!==values.case_id){rawDraft={};draft=null;}
  caseChoice=values.case_id;filters=Object.fromEntries(Object.entries(values).filter(([k,v])=>k!=='case_id'&&v));
  const version=++epoch,value=await call('inspect',{case_id:caseChoice,filters});
  if(!active()||version!==epoch)return;
  inspected=value;draft=initialDraft(value);selectedRow=0;persist();drawEditor();
  message('Original records loaded. Complete and review each mapping before saving the source-bound binding.');
 }
 function paintPrepared(value){
  prepared=value;preparedId=value.binding_id||value.id;persist();
  const observations=value.native_payload?.request?.observations||[];
  result.innerHTML='<h3>Saved measured binding</h3><p>'+esc(value.title||value.selection?.title||preparedId)+' · '+esc(JSON.stringify(value.counts||{}))+'</p>'+
   '<div class="mb-actions"><button type="button" data-mb-action="open-case">Open source-bound Chemistry case</button><button type="button" data-mb-action="run">Run retained native request</button><button type="button" data-mb-action="binding-export">Export complete binding and request</button></div>'+
   '<p>The native request uses the saved child case and these reviewed observation definitions. Reopening or exporting does not calculate a new result.</p>'+
   '<details open><summary>Retained native observations ('+observations.length+')</summary>'+table(observations.map(o=>({...o,operator:operator(o),limits:interval(o)})),[['id','Observation'],['measurement','Measured quantity'],['operator','Modeled pools'],['basis','Basis'],['reach','Reach'],['day','Day'],['role','Role'],['limits','Value / limits'],['sigma_mg_l','Error scale']])+'</details>'+
   '<details><summary>Accepted original records</summary><pre>'+esc(pretty(value.accepted||[]))+'</pre></details>'+
   '<details><summary>Excluded original records and reasons</summary><pre>'+esc(pretty(value.excluded||[]))+'</pre></details>'+
   '<details><summary>Original source and complete retained binding</summary><pre>'+esc(pretty(value))+'</pre></details>';
 }
 function download(name,value,type='application/json'){
  const url=URL.createObjectURL(new Blob([typeof value==='string'?value:pretty(value)],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
 }
 const requestKey=()=>storageKey+':request:'+preparedId;
 async function runNative(){
  if(!prepared?.native_payload)throw Error('Reopen a saved measured binding first.');
  const payload=copy(prepared.native_payload),key=requestKey();let entry;
  try{entry=JSON.parse(localStorage.getItem(key)||'null');}catch(error){throw Error('The original request journal cannot be read: '+error.message);}
  if(entry&&(entry.request.workspace!==workspace||entry.request.action!=='chemistry.run'||!entry.request.operation_id||canonical(entry.request.payload)!==canonical(payload)))throw Error('The saved request journal differs from this retained binding.');
  if(!entry){
   entry={request:{workspace,action:'chemistry.run',payload,operation_id:'measured-chemistry-'+crypto.randomUUID()},prepared_at:new Date().toISOString()};
   try{localStorage.setItem(key,JSON.stringify(entry));}catch{throw Error('The browser cannot retain this operation before sending; enable storage or export the native request.');}
  }
  let task=entry.task_id?await host.api('/api/task?id='+encodeURIComponent(entry.task_id)):await host.api('/api/actions',{method:'POST',body:entry.request});
  if(task.workspace!==workspace||task.action!=='chemistry.run'||canonical(task.payload)!==canonical(payload))throw Error('The retained native task belongs to another request.');
  entry.task_id=task.id;entry.state=task.state;localStorage.setItem(key,JSON.stringify(entry));
  if(['failed','interrupted','cancelled'].includes(task.state)){
   task=await host.api('/api/task/resume',{method:'POST',body:{id:task.id}});
   entry.state=task.state;localStorage.setItem(key,JSON.stringify(entry));
  }
  if(active()){root.querySelector('[data-mb-task]').textContent='Native Chemistry request '+task.state+'.';await host.showTask(task.id);}
 }
 async function loadCatalog(){
  const version=++epoch,value=await call('catalog');if(!active()||version!==epoch)return;
  catalog=value;renderLibrary();message('Saved physical cases and measured bindings are ready.');
 }
 let loaded=false;
 panel.addEventListener('toggle',()=>{if(panel.open&&!loaded){loaded=true;task(async()=>{
  await loadCatalog();
  if(preparedId&&active()){const value=await call('get',{binding_id:preparedId});if(active())paintPrepared(value);}
 });}},{signal:controller.signal});
 root.addEventListener('submit',event=>{
  if(!event.target.matches('[data-mb-inspect],[data-mb-prepare]'))return;
  event.preventDefault();task(async()=>{
   if(event.target.matches('[data-mb-inspect]'))return inspectPopulation();
   draft=collect(true);persist();const submitted=copy(draft),version=epoch;
   const value=await call('prepare',{selection:submitted});
   if(!active()||version!==epoch)return;
   paintPrepared(value);await loadCatalog();message('Binding and source-bound Chemistry case saved. Review accepted records and exclusions, then run the retained native request when ready.');
  });
 },{signal:controller.signal});
 root.addEventListener('input',event=>{if(event.target.closest('[data-mb-prepare]'))captured();},{signal:controller.signal});
 root.addEventListener('change',event=>{if(event.target.closest('[data-mb-prepare]'))captured();},{signal:controller.signal});
 root.addEventListener('click',event=>{
  const button=event.target.closest('[data-mb-action]');if(!button||!root.contains(button))return;
  event.preventDefault();task(async()=>{
   const action=button.dataset.mbAction;
   if(action==='catalog'){captured();await loadCatalog();}
   if(action==='open-binding'){
    captured();const id=library.querySelector('[data-mb-saved]').value;if(!id)throw Error('Choose a saved binding.');
    const value=await call('get',{binding_id:id});if(active())paintPrepared(value);
   }
   if(action==='binding-export'){
    if(!preparedId)throw Error('Reopen a saved binding first.');
    const value=await call('export',{binding_id:preparedId});if(active())download(value.filename||'measured-chemistry-binding.json',value.document,value.content_type||'application/json');
   }
   if(action==='draft-export'){draft=collect(false);persist();download('working-measured-chemistry-selection.json',draft);}
   if(action==='open-case'){
    if(!prepared?.case_id)throw Error('Reopen a saved binding first.');
    captured();return host.openDesk('chemistry','dispatch',{dataset:{action:'chemistry-case-open',id:prepared.case_id,workspace}});
   }
   if(action==='run')return runNative();
   if(action==='records-next'||action==='records-previous'){captured();selectedRow+=action==='records-next'?1:-1;drawRecords();}
   if(action==='record-apply'){
    const box=button.closest('[data-record-id]'),id=box.dataset.recordId;
    draft=collect(false);const role=box.querySelector('[name=record_role]').value;
    if(role)draft.roles.by_record[id]=role;else delete draft.roles.by_record[id];
    const input=box.querySelector('[name=day]'),day=numeric(input,'Model day',true),reason=box.querySelector('[name=day_reason]').value.trim();
    if(day===null)delete draft.day_overrides[id];else{
     if(day<0||!reason)throw Error('An explicit nonnegative model day needs its rationale.');
     draft.day_overrides[id]={day,reason};
    }persist();message('Individual record timing and role retained in this working definition.');
   }
  });
 },{signal:controller.signal});
 return {update(){},destroy(){captured();dead=true;epoch++;controller.abort();root.replaceChildren();}};
}
