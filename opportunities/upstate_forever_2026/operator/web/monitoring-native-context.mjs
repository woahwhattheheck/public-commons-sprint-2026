import {reviewOriginalStationMappings} from './monitoring-observed.mjs';
/* Original native observation records, explicit interpretation, existing Monitoring queue. */
const ID=/^[a-f0-9]{64}$/;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>JSON.parse(JSON.stringify(value));
const text=value=>value===null||value===undefined?'Unspecified':typeof value==='object'?JSON.stringify(value):String(value);
const labels={activity:'Activity identifier',fraction:'Sample fraction',depth:'Sample depth',depth_unit:'Depth unit',method_authority:'Method authority',value_type:'Result value type',weight_basis:'Weight basis',time_basis:'Time basis',temperature_basis:'Temperature basis',particle_size_basis:'Particle size basis',project:'Project identifier',time:'Time',timezone:'Time zone',reporting_limit:'Reporting limit',reporting_limit_unit:'Reporting-limit unit',comment:'Original comment'};
const defaults={columns:{},below_qualifiers:['<','<='],above_qualifiers:['>','>='],numeric_qualifiers:[''],nonnegative:false,use_limit_unit_when_missing:false};
export function attachNativeObservedContext(node,host,workspaceKey){
  const panel=document.createElement('section');
  panel.className='native-observed-panel';panel.setAttribute('aria-label','Saved observation intake');
  panel.innerHTML='<link rel="stylesheet" href="/web/monitoring-native-context.css"><header><div><h3>Use saved observations</h3><p>Bring an original observation file into this monitoring network. Review its station identifiers, methods, units and qualifiers before saving a sampling context.</p></div><button type="button" data-native-refresh>Refresh files</button></header><p data-native-status role="status" aria-live="polite"></p><p data-native-network></p><div data-native-form></div><div class="native-actions"><button type="button" data-native-preview>Preview observations and cohorts</button><button type="button" data-native-save disabled>Save observational context</button><button type="button" data-native-resume hidden>Resume original save</button></div><div data-native-result></div><div data-native-saved></div>';
  node.shadowRoot.querySelector('.output').append(panel);
  const q=s=>panel.querySelector(s), storageKey='eco-native-observation-context:'+workspaceKey;
  let catalog=[],issues=[],sourceId='',interpretation=copy(defaults),stationMapping={},mappingField='',title='';
  let preview=null,saved=null,pending=null,busy=false,saving=false,mounted=false,epoch=0,request=0,lastScope='',error='',storageError='',notice='',rowPage=0;
  const rowSize=25;
  const scope=()=>JSON.stringify([node.network?.id||null,node.plan?.id||null,node.campaign?.revision?.id||null]);
  const current=version=>mounted&&epoch===version&&node.isConnected&&host.getState()?.workspace_key===workspaceKey;
  const selected=()=>catalog.find(row=>row.observation_id===sourceId);
  const snapshot=()=>({sourceId,interpretation:copy(interpretation),stationMapping:copy(stationMapping),mappingField,title});
  function keepPending(value){
    const encoded=value===null?null:JSON.stringify(value);
    if(encoded===null){sessionStorage.removeItem(storageKey);if(sessionStorage.getItem(storageKey)!==null)throw Error('The saved request could not be cleared. Reopen it before another save.');}
    else {sessionStorage.setItem(storageKey,encoded);if(sessionStorage.getItem(storageKey)!==encoded)throw Error('The original save request could not be retained. No new save was sent.');}
  }
  function readPending(){
    const raw=sessionStorage.getItem(storageKey);if(!raw)return null;
    const value=JSON.parse(raw);
    if(value?.workspace_key!==workspaceKey||!ID.test(value?.expected_preview_id||'')||!ID.test(value?.selection?.observation_id||'')||!ID.test(value?.selection?.network_id||''))throw Error('The retained observation request is malformed. Keep it for recovery; a replacement will not be submitted.');
    return value;
  }
  function sourceStations(row){return {stations:(row?.stations||[]).map(value=>({station_id:typeof value==='string'?value:value.station_id}))};}
  function tokens(){
    return [...new Set([...(selected()?.qualifiers||[]),...interpretation.below_qualifiers,...interpretation.above_qualifiers,...interpretation.numeric_qualifiers])].sort();
  }
  function tokenKind(token){
    if(interpretation.below_qualifiers.includes(token))return 'below';
    if(interpretation.above_qualifiers.includes(token))return 'above';
    if(interpretation.numeric_qualifiers.includes(token))return 'numeric';
    return '';
  }
  function invalidate(){preview=null;rowPage=0;notice='';error='';request++;}
  function choose(id){
    sourceId=id;const row=selected();interpretation=copy(row?.interpretation||defaults);stationMapping={};mappingField='';
    title=row?'Observed context — '+row.title:'';saved=null;invalidate();render();
  }
  function option(value,label,chosen){return '<option value="'+esc(value)+'"'+(value===chosen?' selected':'')+'>'+esc(label)+'</option>';}
  function table(headers,rows){
    return '<div class="native-table-wrap"><table><thead><tr>'+headers.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+esc(text(x))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  }
  function reviewedMappings(){
    return reviewOriginalStationMappings(node.network,sourceStations(selected()),mappingField,stationMapping);
  }
  function renderForm(){
    const row=selected(),disclosures=new Map([...q('[data-native-form]').querySelectorAll('[data-native-disclosure]')].map(el=>[el.dataset.nativeDisclosure,el.open]));
    let out='<label>Original saved observation file<select data-native-source>'+option('','Choose a retained observation file',sourceId)+catalog.map(r=>option(r.observation_id,r.title+' · '+r.rows+' original rows',sourceId)).join('')+'</select></label>';
    if(sourceId&&!row)out+='<p class="native-error">This retained observation file is not in the current catalogue. Refresh the files or resume its original pending save.</p>';
    if(!row){q('[data-native-form]').innerHTML=out;return;}
    const columns=Array.isArray(row.columns)?row.columns:[];
    out+='<dl class="native-facts"><div><dt>Original identity</dt><dd><code>'+esc(row.observation_id)+'</code></dd></div><div><dt>Retained rows</dt><dd>'+esc(row.rows)+'</dd></div><div><dt>Source reference</dt><dd>'+esc(row.source_uri||'No reference declared')+'</dd></div></dl>';
    out+='<details data-native-disclosure="mapping"><summary>Original import mapping</summary><p>The original station, constituent, value, unit, date, qualifier and method mappings stay as imported. Optional fields below retain additional source distinctions.</p>'+table(['Native field','Original CSV column'],Object.entries(row.original_mapping||{}))+'</details>';
    out+='<label>Context title<input data-native-title value="'+esc(title)+'" maxlength="300"></label>';
    let match;
    try{match=reviewedMappings();}catch(e){out+='<p class="native-error">'+esc(e.message)+'</p>';}
    out+='<details open data-native-disclosure="stations"><summary>Stations and catchment assignment</summary><p>Choose the exact retained network station for each source identifier. Unmapped source stations stay explicitly unmatched. An identifier match uses the existing network catchment; it does not establish a modeled load for that station.</p>';
    if(match){
      out+='<div class="native-row"><label>Original network identifier field<select data-native-field>'+option('','Choose a field to review',mappingField)+match.fields.map(r=>option(r.name,r.name+' · '+r.matches+' exact identifiers',mappingField)).join('')+'</select></label><button type="button" data-native-map '+(!Object.keys(match.additions).length?'disabled':'')+'>Apply '+Object.keys(match.additions).length+' reviewed matches</button></div>';
      out+='<p>'+match.automatic+' exact native IDs · '+match.existing+' explicit mappings · '+match.ambiguous+' ambiguous · '+match.conflicts+' conflicts · '+match.unmatched+' without a field match.</p>';
      if(match.errors.length)out+='<p class="native-error">'+esc(match.errors.join(' '))+'</p>';
    }
    const natives=node.network?.stations||[];
    out+='<div class="native-stations">'+sourceStations(row).stations.map(station=>{
      const id=station.station_id,automatic=natives.some(s=>s.id===id);
      return '<label><span class="native-identifier">'+esc(id)+'</span><select data-native-station="'+esc(id)+'">'+option('',automatic?'Exact native ID (automatic)':'Choose the original network station',stationMapping[id]||'')+natives.map(s=>option(s.id,(s.title||s.name||s.id)+' · '+s.id,stationMapping[id]||'')).join('')+'</select></label>';
    }).join('')+'</div></details>';
    out+='<details data-native-disclosure="columns"><summary>Optional source columns</summary><p>Keep source fractions, depths, method authorities, units and project labels distinct. Use the original import setting, map an exact retained column, or explicitly leave the field unspecified. No value is inferred.</p><div class="native-columns">'+(row.optional_columns||Object.keys(labels)).map(name=>'<label>'+esc(labels[name]||name)+'<select data-native-column="'+esc(name)+'">'+option('__original__','Use original import setting',Object.hasOwn(interpretation.columns,name)?interpretation.columns[name]:'__original__')+option('','Leave unspecified (disable mapping)',Object.hasOwn(interpretation.columns,name)?interpretation.columns[name]:'__original__')+columns.map(c=>option(c,c,interpretation.columns[name])).join('')+'</select></label>').join('')+'</div></details>';
    out+='<details open data-native-disclosure="qualifiers"><summary>Qualifier interpretation</summary><p>Assign each exact source token explicitly. Blank qualifiers are a separate choice. Below-limit and above-limit results keep their censoring direction and original text; these settings do not replace them with a guessed numeric value.</p><div class="native-qualifiers">'+tokens().map(token=>'<label><code>'+esc(token===''?'(blank)':token)+'</code><select data-native-token="'+esc(token)+'">'+option('','Leave unclassified',tokenKind(token))+option('numeric','Numeric result',tokenKind(token))+option('below','Below limit',tokenKind(token))+option('above','Above limit',tokenKind(token))+'</select></label>').join('')+'</div><label class="native-check"><input type="checkbox" data-native-nonnegative '+(interpretation.nonnegative?'checked':'')+'> Apply a nonnegative bound on the observed quantity</label><label class="native-check"><input type="checkbox" data-native-limit-unit '+(interpretation.use_limit_unit_when_missing?'checked':'')+'> Use the original reporting-limit unit only when the result unit is missing</label></details>';
    out+='<p class="native-note">This intake has no selected daily-flow series. Observed values, dates and method-specific cohorts remain usable. Flow coverage, high-flow episodes, concentration-to-load conversion and annual modeled mass comparisons are unavailable.</p>';
    q('[data-native-form]').innerHTML=out;
    for(const el of q('[data-native-form]').querySelectorAll('[data-native-disclosure]'))if(disclosures.has(el.dataset.nativeDisclosure))el.open=disclosures.get(el.dataset.nativeDisclosure);
  }
  function field(cohort,name){const f=cohort.fields?.[name];return f?.present?text(f.value):'Unspecified';}
  function renderPreview(){
    const box=q('[data-native-result]');if(!preview){box.replaceChildren();return;}
    const context=preview.context||{},cohorts=preview.cohorts||[],observations=context.observations||[];
    let html='<h4>Review this exact context</h4><p>Original file <code>'+esc(preview.selection.observation_id)+'</code> · network <code>'+esc(context.network_id)+'</code></p>';
    const counts=preview.summary||{};
    html+=table(['Observation coverage','Retained count'],[['Original file rows',preview.source.row_count??selected()?.rows],['Usable source rows',counts.included_source_rows],['Excluded source rows',counts.excluded_source_rows],['Matched network stations',counts.matched_stations],['Exact analytical cohorts',cohorts.length]].filter(row=>row[1]!==undefined));
    if(context.station_matches?.length)html+='<h4>Station matches</h4>'+table(['Source station','Network station','Match'],context.station_matches.map(r=>[r.source_station_id,r.network_station_id,r.match]));
    html+='<h4>Method-specific cohorts</h4><p>Different fractions, depths, methods, units and source attributes remain separate. Sampling uses these exact cohort identities after saving.</p>';
    html+=table(['Constituent','Method','Unit','Fraction','Depth','Records','Stations'],cohorts.map(c=>[field(c,'characteristic'),field(c,'method'),field(c,'unit'),field(c,'fraction'),field(c,'depth_value'),c.observation_count,(c.station_ids||[]).join('; ')]));
    const start=rowPage*rowSize, rows=observations.slice(start,start+rowSize);
    html+='<details data-native-records><summary>Original observation records ('+observations.length+')</summary><p>Showing '+(observations.length?start+1:0)+'–'+Math.min(start+rowSize,observations.length)+' of '+observations.length+'. Original values and qualifiers are preserved.</p><div class="native-actions"><button type="button" data-native-prev '+(rowPage===0?'disabled':'')+'>Previous records</button><button type="button" data-native-next '+(start+rowSize>=observations.length?'disabled':'')+'>Next records</button></div>'+table(['Station','Date','Constituent','Method','Unit','Original value','Qualifier / status'],rows.map(r=>[r.station_id,r.date||r.sample_date,r.characteristic,r.method,r.unit,r.result_text??r.value_text??r.value,r.status??r.qualifier]));
    html+='<details><summary>Complete fields for these records</summary><pre>'+esc(JSON.stringify(rows,null,2))+'</pre></details></details>';
    const exclusions=context.excluded_observations||[];
    if(exclusions.length)html+='<details><summary>Excluded original rows ('+exclusions.length+')</summary><p>These rows remain in the original file and saved context. Their reasons are shown without assigning a numeric value.</p>'+table(['Original row','Station','Original value','Unit','Reasons'],exclusions.map(r=>[r.original_record_id,r.station_id,r.result_text,r.original_unit,(r.reasons||[]).join('; ')]))+'</details>';
    const warnings=[...(Array.isArray(context.interpretation)?context.interpretation:[]),...(Array.isArray(preview.issues)?preview.issues:[])];
    if(warnings.length)html+='<details><summary>Source interpretation and exclusions</summary><ul>'+warnings.map(v=>'<li>'+esc(text(v))+'</li>').join('')+'</ul></details>';
    html+='<p class="native-note">Flow-dependent support is unavailable. The preview does not create a saved context or change the original observation file.</p>';
    box.innerHTML=html;
  }
  function render(){
    if(!mounted)return;
    const working=busy||node.busy;
    q('[data-native-status]').textContent=error||storageError||notice;q('[data-native-status]').className=error?'native-error':'';
    q('[data-native-network]').textContent=node.network?'Network: '+(node.network.title||node.network.id)+(node.plan?' · saved design '+(node.plan.title||node.plan.id):' · no saved design selected'):'Open a saved monitoring network to review its station assignments.';
    renderForm();renderPreview();
    q('[data-native-preview]').disabled=working||!!pending||!selected()||!node.network;
    q('[data-native-save]').disabled=working||!!storageError||!!pending||!preview;
    q('[data-native-resume]').hidden=!pending;q('[data-native-resume]').disabled=working||!!storageError;
    q('[data-native-refresh]').disabled=working;
    for(const el of q('[data-native-form]').querySelectorAll('input,select,button'))el.disabled=working||!!pending||el.disabled;
    q('[data-native-saved]').innerHTML=saved?'<h4>Saved observational context</h4><p>'+esc(saved.title||title)+' · <code>'+esc(saved.id)+'</code></p><div class="native-actions"><button type="button" data-native-open>Open full context</button><button type="button" data-native-sampling>Open Sampling priorities</button></div><p>Set the historical observation window, target rationale, future calendar and costs in Sampling priorities. No target or model evidence is selected automatically.</p>':'';
    if(pending)q('[data-native-status]').textContent=(error?error+' ':'')+'The original save request is retained for network '+pending.selection.network_id+'. Resume it without changing its source or interpretation.';
    if(!error&&issues.length)q('[data-native-status]').textContent+=' '+issues.map(text).join(' ');
  }
  function selection(){
    const row=selected();if(!row||!ID.test(row.observation_id))throw Error('Choose the original saved observation record.');
    if(!ID.test(node.network?.id||''))throw Error('Choose the original monitoring network.');
    const check=reviewedMappings();if(check.errors.length)throw Error(check.errors.join(' '));
    
    // Unmatched source stations remain explicit in the original context; no station is invented.
    const campaign=node.campaign&&node.plan&&node.campaign.plan?.id===node.plan.id?node.campaign:null;
    return {observation_id:row.observation_id,network_id:node.network.id,plan_id:campaign?null:node.plan?.id||null,campaign_id:campaign?.revision?.campaign_id||null,station_mapping:copy(stationMapping),title:title.trim()||'Observed monitoring support',interpretation:{...copy(interpretation),below_qualifiers:[...interpretation.below_qualifiers].sort(),above_qualifiers:[...interpretation.above_qualifiers].sort(),numeric_qualifiers:[...interpretation.numeric_qualifiers].sort()}};
  }
  function sameSelection(a,b){const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;return JSON.stringify(ordered(a))===JSON.stringify(ordered(b));}
  function assertPreview(value,expected){
    if(!ID.test(value?.id||'')||value.context?.network_id!==expected.network_id||value.source?.observation_id!==expected.observation_id||!sameSelection(value.selection,expected))throw Error('The preview does not match the selected original file, network and interpretation.');
    if(value.context.flow_scope?.mode!=='unavailable')throw Error('This original-file intake unexpectedly changed its flow scope.');
  }
  async function refresh(){
    const version=epoch,ticket=++request;busy=true;error='';notice='Reading saved observation files…';render();
    try{
      const value=await node.api('context.native.catalog',{});
      if(!current(version)||ticket!==request)return;
      if(!Array.isArray(value?.observations))throw Error('The original observation catalogue is unavailable.');
      const unique=new Set();
      for(const row of value.observations){if(!ID.test(row.observation_id||'')||unique.has(row.observation_id))throw Error('The observation catalogue has an invalid or repeated identity.');unique.add(row.observation_id);}
      catalog=value.observations;issues=Array.isArray(value.issues)?value.issues:[];
      notice=catalog.length?'Choose an original file and review its interpretation.':'No original observation records are saved in this Workspace. Import the original file through Observations, then refresh.';
    }catch(e){if(current(version)&&ticket===request)error=e.message;}
    finally{if(current(version)&&ticket===request){busy=false;render();}}
  }
  async function doPreview(){
    if(busy||pending)return;const expected=selection(),version=epoch,ticket=++request,originalScope=scope();busy=true;error='';notice='Reading original records and station support…';render();
    try{
      const value=await node.api('context.native.preview',{selection:expected});
      if(!current(version)||ticket!==request||scope()!==originalScope)return;
      assertPreview(value,expected);preview=value;saved=null;notice='Review the cohort distinctions and original rows before saving.';
    }catch(e){if(current(version)&&ticket===request)error=e.message;}
    finally{if(current(version)&&ticket===request){busy=false;render();}}
  }
  async function save(resume=false){
    if(busy)return;
    if(storageError)throw Error(storageError);
    if(!resume){
      if(!preview)throw Error('Preview this exact source and interpretation before saving.');
      const expected=selection();assertPreview(preview,expected);
      const retained={workspace_key:workspaceKey,expected_preview_id:preview.id,selection:copy(preview.selection),draft:snapshot()};
      keepPending(retained);pending=retained;
    }
    if(!pending)throw Error('No original observation save is pending.');
    const retained=copy(pending),version=epoch;busy=true;saving=true;error='';notice='Saving the original observational context…';render();
    try{
      const value=await node.api('context.native.prepare',{selection:retained.selection,expected_preview_id:retained.expected_preview_id});
      if(!ID.test(value?.id||'')||value.network_id!==retained.selection.network_id||value.native_observation_binding?.observation_id!==retained.selection.observation_id)throw Error('The saved context does not match the original requested observation file and network.');
      saved=value;keepPending(null);pending=null;
      if(!current(version))return;
      notice='Saved the original observations, interpretation and network binding. Open the full context or continue in Sampling priorities.';
      if(node.network?.id===value.network_id)node.openSavedObservedContextRecord?.(value);
    }catch(e){if(current(version))error=e.message;}
    finally{busy=false;saving=false;if(mounted&&node.isConnected&&host.getState()?.workspace_key===workspaceKey)render();}
  }
  async function openSaved(sampling){
    if(!saved||busy)return;const version=epoch,id=saved.id;error='';
    const isCurrent=()=>current(version)&&saved?.id===id;
    if(sampling)await host.openDesk('monitoring-recommendations','openContext',{workspace_key:workspaceKey,context_id:id,isCurrent});
    else if(node.network?.id===saved.network_id){node.openSavedObservedContextRecord(saved);node.shadowRoot.querySelector('.observed-context-panel')?.scrollIntoView({block:'start'});}
    else await host.openDesk('monitoring','openStudy',{workspace_key:workspaceKey,kind:'monitoring_observed_contexts',id,isCurrent});
  }
  panel.addEventListener('change',event=>{
    if(busy||pending)return;const el=event.target;
    if(el.matches('[data-native-source]')){choose(el.value);return;}
    if(el.matches('[data-native-field]')){mappingField=el.value;render();return;}
    if(el.matches('[data-native-station]')){const key=el.dataset.nativeStation;if(el.value)stationMapping[key]=el.value;else delete stationMapping[key];}
    else if(el.matches('[data-native-column]')){const key=el.dataset.nativeColumn;if(el.value==='__original__')delete interpretation.columns[key];else interpretation.columns[key]=el.value;}
    else if(el.matches('[data-native-token]')){const token=el.dataset.nativeToken;for(const key of ['below_qualifiers','above_qualifiers','numeric_qualifiers'])interpretation[key]=interpretation[key].filter(v=>v!==token);if(['numeric','below','above'].includes(el.value))interpretation[el.value+'_qualifiers'].push(token);}
    else if(el.matches('[data-native-nonnegative]'))interpretation.nonnegative=el.checked;
    else if(el.matches('[data-native-limit-unit]'))interpretation.use_limit_unit_when_missing=el.checked;
    else if(el.matches('[data-native-title]'))title=el.value;else return;
    invalidate();render();
  });
  panel.addEventListener('input',event=>{if(event.target.matches('[data-native-title]')&&!busy&&!pending){title=event.target.value;invalidate();q('[data-native-save]').disabled=true;q('[data-native-result]').replaceChildren();}});
  panel.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||button.disabled||busy||node.busy)return;
    const version=epoch;
    try{
      if(button.matches('[data-native-refresh]'))await refresh();
      else if(button.matches('[data-native-map]')){Object.assign(stationMapping,reviewedMappings().additions);invalidate();render();}
      else if(button.matches('[data-native-preview]'))await doPreview();
      else if(button.matches('[data-native-save]'))await save();
      else if(button.matches('[data-native-resume]'))await save(true);
      else if(button.matches('[data-native-sampling]'))await openSaved(true);
      else if(button.matches('[data-native-open]'))await openSaved(false);
      else if(button.matches('[data-native-prev]')){rowPage=Math.max(0,rowPage-1);renderPreview();q('[data-native-records]').open=true;}
      else if(button.matches('[data-native-next]')){rowPage++;renderPreview();q('[data-native-records]').open=true;}
    }catch(e){if(current(version)){error=e.message;render();}}
  });
  function update(){
    if(!mounted)return;const next=scope();
    if(next!==lastScope){lastScope=next;request++;preview=null;stationMapping={};mappingField='';rowPage=0;if(!saving)busy=false;render();}
  }
  const originalRender=node.render.bind(node);
  node.render=(...args)=>{const result=originalRender(...args);update();return result;};
  async function mount(){
    mounted=true;epoch++;lastScope=scope();
    try{const retained=readPending();storageError='';if(retained){pending=retained;const draft=retained.draft;if(draft){sourceId=draft.sourceId;interpretation=copy(draft.interpretation);stationMapping=copy(draft.stationMapping);mappingField=draft.mappingField;title=draft.title;}}}
    catch(e){storageError=e.message;}
    render();if(!saving)await refresh();
  }
  function detach(){mounted=false;epoch++;request++;if(!saving)busy=false;}
  return {mount,update,refresh,detach};
}
