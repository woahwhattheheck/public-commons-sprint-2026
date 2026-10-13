/** Named management practices over the original profile and native experiment workflows. */
const text=v=>String(v??''),copy=v=>JSON.parse(JSON.stringify(v)),list=v=>Array.isArray(v)?v:[];
const esc=v=>text(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const short=v=>text(v).slice(0,12);
const button=(action,label,attrs='')=>'<button type="button" data-mc-action="'+esc(action)+'" '+attrs+'>'+esc(label)+'</button>';
const option=(value,label,selected=false)=>'<option value="'+esc(value)+'"'+(selected?' selected':'')+'>'+esc(label)+'</option>';
const field=(key,label,value,attrs='')=>'<label class="pw-field"><span>'+esc(label)+'</span><input data-mc-field="'+esc(key)+'" value="'+esc(value)+'" '+attrs+'></label>';
const area=(key,label,value)=>'<label class="pw-field"><span>'+esc(label)+'</span><textarea data-mc-field="'+esc(key)+'" rows="2">'+esc(value)+'</textarea></label>';
const categories={nutrient_load:'Nutrient loading',cover_support:'Cover and support practices',retention:'Vegetation and nutrient retention'};
const ACTIONS=new Set(['profile.management.prepare','profile.management.experiment.prepare','experiment.run']);
export function managementSelection(draft,profileId,tableSHA){
  return {title:draft.title,reason:draft.reason,baseline_profile_id:profileId,expected_table_sha256:tableSHA,
    practices:copy(draft.practices),combinations:copy(draft.combinations)};
}
export function readManagementDraft(value,profileId,tableSHA){
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const requireText=(v,label)=>{if(typeof v!=='string')throw Error(label+' must be text.');return v;};
  const selection=copy(value?.selection||value);
  if(!object(selection)||selection.baseline_profile_id!==profileId||selection.expected_table_sha256!==tableSHA)throw Error('Open this design with its original profile and exact coefficient table.');
  requireText(selection.title,'Design title');requireText(selection.reason,'Design reason');
  if(!Array.isArray(selection.practices)||!Array.isArray(selection.combinations))throw Error('The design needs its complete practice and combination lists.');
  const source=v=>{if(!object(v))throw Error('A coefficient source is missing.');return Object.fromEntries(['title','uri','locator','period','applicability'].map(k=>[k,requireText(v[k]??'', 'Source '+k)]));};
  const practice=v=>{
    if(!object(v)||!Object.hasOwn(categories,v.category)||!Array.isArray(v.changes))throw Error('A practice needs its source category and complete changed cells.');
    return {key:requireText(v.key,'Practice key'),name:requireText(v.name,'Practice name'),category:v.category,reason:requireText(v.reason,'Practice reason'),source_mode:v.source_mode||'coupled',
      changes:v.changes.map(c=>{if(!object(c)||!Number.isInteger(c.lucode)||!Number.isFinite(Number(c.value))||!['load_n','load_p','proportion_subsurface_n','eff_n','eff_p','crit_len_n','crit_len_p','usle_c','usle_p'].includes(c.parameter))throw Error('A selected native coefficient is malformed.');
        return {lucode:c.lucode,parameter:c.parameter,value:c.value,units:requireText(c.units,'Coefficient units'),load_type:requireText(c.load_type??'','Load basis'),source:source(c.source)};})};
  };
  selection.practices=selection.practices.map(practice);
  selection.combinations=selection.combinations.map(v=>{if(!object(v)||!Array.isArray(v.practice_keys)||v.practice_keys.some(k=>typeof k!=='string'))throw Error('A combination must retain its practice keys.');return {name:requireText(v.name,'Combination name'),reason:requireText(v.reason,'Combination reason'),practice_keys:[...v.practice_keys]};});
  let working_editor=null;
  if(value?.working_editor){
    const w=value.working_editor;if(!object(w)||!object(w.cell))throw Error('The unfinished practice editor is incomplete.');
    working_editor={editing:practice(w.editing),source:source(w.source),cell:Object.fromEntries(['lucode','parameter','value'].map(k=>[k,requireText(w.cell[k]??'','Working cell '+k)]))};
  }
  return {selection,working_editor};
}
export function createManagementCases(host,{onProfile=async()=>{}}={}){
  let root=null,events=null,workspace=null,profileId=null,generation=0,catalog=null,record=null,preview=null;
  let memory=null,busy=false,processing=false,message='',error=false,signature='',intent=0,publishedPreview=null,publishedIntent=0;
  const memories=new Map(),$=s=>root?.querySelector(s),$$=s=>root?[...root.querySelectorAll(s)]:[];
  const scope=()=>({workspace,profileId,generation});
  const alive=s=>Boolean(root?.isConnected&&s.workspace===workspace&&s.profileId===profileId&&s.generation===generation&&host.getState()?.workspace_key===workspace);
  const storageKey=key=>'upstate-management-cases-v1:'+key;
  function stored(key){
    if(memories.has(key))return memories.get(key);
    let value;try{value=JSON.parse(localStorage.getItem(storageKey(key))||'null');}catch{}
    if(!value?.drafts||!Array.isArray(value.requests))value={drafts:{},requests:[]};
    memories.set(key,value);return value;
  }
  function persist(value=memory,key=workspace){
    if(!value||!key)return;memories.set(key,value);
    try{localStorage.setItem(storageKey(key),JSON.stringify(value));}
    catch{if(key===workspace)notice('Browser draft storage is unavailable. Download this design or save its profiles before closing.',true);}
  }
  const emptyPractice=()=>({key:'',name:'',category:catalog?.categories?.find(x=>x.parameters.length)?.id||'nutrient_load',reason:'',source_mode:'coupled',changes:[]});
  function draft(){return memory.drafts[profileId]??={title:'Land-management cases',reason:'',practices:[],combinations:[],editing:emptyPractice(),source:{title:'',uri:'',locator:'',period:'',applicability:''},cell:{lucode:'',parameter:'',value:''},saved_id:'',baseline_run_id:'',scenario_ids:[],combination_name:'',combination_reason:'',combination_keys:[]};}
  function publishedDraft(){return draft().published??={lucode:'',nitrogen_compartment:'',applicability:'',confirm_pasture:false,open:false};}
  function publishedInput(){
    const d=publishedDraft(),recipe=catalog.published_recipe;
    if(!recipe)throw Error('The published source catalogue is unavailable.');
    return {recipe_id:recipe.id,profile_id:profileId,expected_table_sha256:catalog.biophysical_sha256,
      lucode:d.lucode===''?null:Number(d.lucode),confirm_pasture:d.confirm_pasture===true,
      nitrogen_compartment:d.nitrogen_compartment,applicability:d.applicability};
  }
  function publishedHTML(){
    const r=catalog.published_recipe;if(!r)return '';
    const d=publishedDraft(),row=list(r.land_cover).find(x=>text(x.lucode)===d.lucode);
    const eligible=list(r.land_cover).some(x=>x.eligible),choice=publishedPreview?canonical(publishedInput()):'';
    const valid=publishedPreview&&publishedPreview._choice_signature===choice;
    return '<details class="pw-original-source" data-mc-published-panel'+(d.open?' open':'')+'><summary>Use a published pasture treatment source</summary>'+
      '<p>'+esc(r.meaning)+'</p><p class="pw-note">'+esc(r.scope)+'</p>'+
      '<p><strong>'+esc(r.source.title)+'</strong> · '+esc(r.source.period)+' · '+
      (/^https:\/\//i.test(r.source.supplement_uri)?'<a href="'+esc(r.source.supplement_uri)+'" target="_blank" rel="noopener noreferrer">Read the original treatment table</a>':'')+'</p>'+
      '<div class="pw-table-scroll"><table><thead><tr><th>Endophyte</th><th>Fertilizer</th><th>Total N kg/ha/year</th><th>Total P kg/ha/year</th></tr></thead><tbody>'+
      list(r.treatments).map(t=>'<tr><td>'+esc(t.endophyte)+'</td><td>'+esc(t.fertilizer==='BL'?'Broiler litter':'Inorganic fertilizer')+'</td><td>'+esc(Number(t.load_n).toFixed(2))+'</td><td>'+esc(Number(t.load_p).toFixed(2))+'</td></tr>').join('')+'</tbody></table></div>'+
      '<p class="pw-note">Annual surface-runoff estimates include author gap filling. These are source-transfer scenarios; no local calibration or published confidence interval is implied. Both nutrients stay paired within each treatment.</p>'+
      (!eligible?'<p class="pw-error">This profile has no class with NDR measured-runoff tags for both nutrients. Open an appropriate original source profile; application-rate inputs are not converted here.</p>':'')+
      '<div class="pw-two-columns"><label class="pw-field"><span>Actual pasture land-cover class</span><select data-mc-published="lucode">'+option('','Choose an original class',d.lucode==='')+
      list(r.land_cover).map(x=>'<option value="'+esc(x.lucode)+'"'+(text(x.lucode)===d.lucode?' selected':'')+(!x.eligible?' disabled':'')+'>'+esc(x.lucode+(x.description?' · '+x.description:''))+'</option>').join('')+'</select></label>'+
      '<label class="pw-field"><span>Nitrogen compartment</span><select data-mc-published="nitrogen_compartment">'+option('','Choose the scientific boundary',!d.nitrogen_compartment)+
      '<option value="existing-surface-only"'+(d.nitrogen_compartment==='existing-surface-only'?' selected':'')+(row&&row.proportion_subsurface_n!==0?' disabled':'')+'>Keep original surface-only partition (requires zero)</option>'+
      option('explicit-surface-only','Explicitly model surface N only in all six cases',d.nitrogen_compartment==='explicit-surface-only')+'</select></label></div>'+
      '<p class="pw-note">Original selected-class subsurface N share: '+esc(row?.proportion_subsurface_n??'Choose a class')+'. An explicit zero is a modeling boundary, not evidence of no subsurface loss.</p>'+
      '<label class="pw-field"><span>Pasture mapping and applicability to this project</span><textarea data-mc-published="applicability" rows="3">'+esc(d.applicability)+'</textarea></label>'+
      '<label><input type="checkbox" data-mc-published="confirm_pasture"'+(d.confirm_pasture?' checked':'')+'> I confirm this class is the intended grazed pasture area; the coefficient changes apply to the whole selected class.</label>'+
      '<div class="pw-actions">'+button('published-preview','Preview these six source cases',!eligible?'disabled':'')+
      button('published-use','Add these six cases to this design',!valid?'disabled':'')+'</div>'+
      (valid?'<p class="pw-note">Source preview checked '+esc(publishedPreview.binding.table_sha256.slice(0,12))+' / class '+esc(publishedPreview.binding.lucode)+'. Adding keeps existing practices, combinations and unfinished editor fields; duplicate names or keys must be resolved explicitly.</p>':'')+'</details>';
  }
  function notice(value='',failed=false){message=text(value);error=failed;const node=$('[data-mc-message]');if(node){node.textContent=message;node.hidden=!message;node.classList.toggle('pw-error',failed);}}
  async function read(operation,payload={},s=scope()){
    if(!alive(s))throw Error('Reopen management cases in the selected original profile.');
    const value=await host.api('/api/profile-workbench/management/'+operation,{method:'POST',body:{workspace:s.workspace,...payload}});
    if(!alive(s))throw Error('The selected project or profile changed while loading.');return value;
  }
  function selection(){return managementSelection(draft(),profileId,catalog.biophysical_sha256);}
  function sourceRow(){return list(catalog?.table_rows).find(row=>text(row.lucode)===text(draft().cell.lucode));}
  function parameters(){return list(catalog?.categories).find(row=>row.id===draft().editing.category)?.parameters||[];}
  function allTasks(){const rows=list(host.getState()?.tasks).filter(row=>ACTIONS.has(row.action));const ids=new Set(rows.map(row=>row.id));return [...rows,...list(memory?.requests).filter(row=>row.task&&!ids.has(row.task.id)).map(row=>row.task)];}
  const taskFor=request=>allTasks().find(row=>row.id===request.task_id)||request.task;
  function retain(request,patch,s){
    const target=stored(s.workspace);let row=target.requests.find(x=>x.operation_id===request.operation_id);
    if(!row){row=copy(request);target.requests.push(row);}Object.assign(row,copy(patch));persist(target,s.workspace);return row;
  }
  const taskReceipt=task=>({id:task.id,action:task.action,state:task.state,result:{id:task.result?.id},experiment_id:task.experiment_id,request_sha256:task.request_sha256,operation_id:task.operation_id,...(task._downloads?{_downloads:copy(task._downloads)}:{}),...(task.error?{error:task.error}:{})});
  function checkedTask(request,task,s,acceptedId=null,expectedSHA=null){
    if(!task||typeof task.id!=='string'||!task.id||(acceptedId&&task.id!==acceptedId))throw Error('The operator returned a different accepted task identity.');
    if(task.workspace!==s.workspace||task.action!==request.action||canonical(task.payload)!==canonical(request.payload))throw Error('The accepted task does not match this project, action and exact selected payload.');
    if(!/^[a-f0-9]{64}$/.test(task.request_sha256||'')||(expectedSHA&&task.request_sha256!==expectedSHA))throw Error('The accepted task source digest changed or is missing.');
    return task;
  }
  async function acceptedTask(request,s,raw=null){
    const original=raw?checkedTask(request,raw,s,request.task_id||null,request.request_sha256||null):null;
    const id=original?.id||request.task_id,sha=original?.request_sha256||request.request_sha256;
    if(!id)throw Error('No accepted operation was retained. Retry the same authored request.');
    if(original)retain(request,{task_id:id,request_sha256:sha,accepted_operation_id:original.operation_id,task:taskReceipt(original)},s);
    const value=await host.api('/api/task?id='+encodeURIComponent(id),{method:'GET'});
    const detail=checkedTask(request,value,s,id,sha||null);
    retain(request,{task_id:id,request_sha256:detail.request_sha256,accepted_operation_id:detail.operation_id,task:taskReceipt(detail)},s);
    return detail;
  }
  function operationHTML(){
    return list(memory?.requests).filter(x=>x.profile_id===profileId).slice().reverse().map(request=>{
      const task=taskFor(request),state=task?.state||'request saved';return '<div class="pw-operations"><strong>'+esc(request.action==='experiment.run'?'Run native cases':request.action==='profile.management.prepare'?'Prepare management profiles':'Prepare native experiment')+'</strong><span>'+esc(state)+'</span>'+
        (task?.error?.message?'<p>'+esc(task.error.message)+'</p>':'')+
        (request.task_id?button('task','Open operation','data-mc-id="'+esc(request.task_id)+'"'):'')+
        (!request.task_id?button('retry','Retry same request','data-mc-id="'+esc(request.operation_id)+'"'):
         ['failed','interrupted'].includes(state)?button('resume','Resume operation','data-mc-id="'+esc(request.task_id)+'"'):'')+'</div>';
    }).join('');
  }
  function render(){
    if(!root?.isConnected||!catalog)return;
    const d=draft(),e=d.editing,src=d.source,row=sourceRow(),p=d.cell.parameter,rule=list(catalog.parameters).find(x=>x.target==='table.'+p);
    const saved=list(catalog.saved);
    root.innerHTML='<section class="pw-panel"><header class="pw-panel-heading"><div><h2>Land-management cases</h2><p>Compare separately named changes to nutrient loading, erosion practices and vegetation retention, then run explicit combinations with the native models.</p></div>'+button('refresh','Refresh')+'</header><div class="pw-panel-body"><p data-mc-message class="pw-message" role="status" aria-live="polite" hidden></p><div data-mc-operations>'+operationHTML()+'</div>'+
      '<p class="pw-note">'+esc(catalog.methods.scope)+'</p><p class="pw-note">'+esc(catalog.methods.load_basis)+'</p>'+
      publishedHTML()+
      '<div class="pw-inline-form"><label class="pw-field"><span>Saved management design</span><select data-mc-field="saved_id">'+option('','Choose a saved design',!d.saved_id)+saved.map(x=>option(x.id,x.title+' · '+x.profile_count+' profiles',x.id===d.saved_id)).join('')+'</select></label>'+button('open','Open saved design')+button('export-study','Export saved design as Study',!d.saved_id?'disabled':'')+button('download','Download editable design')+'<label class="pw-upload">Load design<input type="file" data-mc-upload accept=".json,application/json"></label></div>'+
      (memory.previous_drafts?.[profileId]?'<p class="pw-note">A previous working design and its unfinished practice are retained. '+button('previous-draft','Return to previous working design')+'</p>':'')+
      '<div class="pw-two-columns">'+field('title','Design title',d.title)+area('reason','Scientific purpose and assumptions',d.reason)+'</div>'+
      '<details class="pw-original-source" open><summary>'+esc(e.key?'Edit practice: '+e.name:'Add a named practice')+'</summary><div class="pw-form-grid">'+field('practice.name','Practice name',e.name)+
      '<label class="pw-field"><span>Input family</span><select data-mc-field="practice.category"'+(e.changes.length?' disabled':'')+'>'+Object.entries(categories).filter(([k])=>catalog.categories.some(x=>x.id===k&&x.parameters.length)).map(([k,v])=>option(k,v,k===e.category)).join('')+'</select></label>'+area('practice.reason','Practice assumptions and purpose',e.reason)+'</div>'+
      (e.category==='retention'?'<label class="pw-field"><span>Nutrient source treatment</span><select data-mc-field="practice.source_mode">'+option('coupled','Use explicit management inputs, including native source coupling',e.source_mode!=='hold_effective_source')+option('hold_effective_source','Hold effective nutrient source for controlled retention comparison',e.source_mode==='hold_effective_source')+'</select></label><p class="pw-note">'+esc(catalog.methods.source_control)+'</p>':'')+
      '<div class="pw-form-grid">'+field('source.title','Coefficient source title',src.title)+field('source.uri','Source URL or reference',src.uri)+field('source.locator','Exact table, row, page or field',src.locator)+field('source.period','Source period',src.period)+area('source.applicability','Why this source applies to this coefficient and location',src.applicability)+'</div>'+
      '<p class="pw-note">Enter the absolute target coefficient. A reported percentage change in runoff, erosion or buffer removal is not automatically this model coefficient.</p>'+
      '<div class="pw-inline-form"><label class="pw-field"><span>Original land-cover code</span><select data-mc-field="cell.lucode">'+option('','Choose code',!d.cell.lucode)+list(catalog.lucodes).map(code=>option(code,code,text(code)===d.cell.lucode)).join('')+'</select></label>'+
      '<label class="pw-field"><span>Native coefficient</span><select data-mc-field="cell.parameter">'+option('','Choose coefficient',!p)+parameters().map(name=>option(name,name,p===name)).join('')+'</select></label>'+field('cell.value','Absolute target value',d.cell.value,'type="number" step="any"')+button('add-cell','Add or replace coefficient')+'</div>'+
      '<p class="pw-note">Original value: '+esc(row&&p?row[p]:'Choose a cell')+' · Units: '+esc(rule?.units||'—')+(row&&['load_n','load_p'].includes(p)?' · Original basis: '+esc(row['load_type_'+p.slice(-1)]):'')+'</p>'+
      changeTable(e.changes,true)+'<div class="pw-actions">'+button('save-practice','Keep this practice')+button('clear-practice','Clear practice editor')+'</div></details>'+
      '<h3>Individual cases</h3>'+(!d.practices.length?'<p class="pw-empty">Add a practice with its exact source coefficients.</p>':d.practices.map(practice=>'<section class="pw-original-source"><div class="pw-panel-heading"><h4>'+esc(practice.name)+'</h4><div class="pw-actions">'+button('edit-practice','Edit','data-mc-id="'+esc(practice.key)+'"')+button('remove-practice','Remove','data-mc-id="'+esc(practice.key)+'"')+'</div></div><p>'+esc(practice.reason)+'</p>'+changeTable(practice.changes,false)+'</section>').join(''))+
      '<h3>Explicit combined cases</h3><p>Each practice above is retained separately. Add combinations to compare interactions on the same baseline.</p>'+
      '<div class="pw-two-columns">'+field('combination_name','Combination name',d.combination_name)+area('combination_reason','Why these practices are combined',d.combination_reason)+'</div><fieldset class="pw-model-choice"><legend>Practices in this combination</legend>'+d.practices.map(practice=>'<label><input type="checkbox" data-mc-combination="'+esc(practice.key)+'"'+(d.combination_keys.includes(practice.key)?' checked':'')+'> '+esc(practice.name)+'</label>').join('')+'</fieldset>'+button('add-combination','Add combined case')+
      d.combinations.map((c,i)=>'<p><strong>'+esc(c.name)+'</strong> · '+esc(c.practice_keys.map(k=>d.practices.find(p=>p.key===k)?.name||k).join(' + '))+' '+button('remove-combination','Remove','data-mc-index="'+i+'"')+'</p>').join('')+
      '<div class="pw-actions">'+button('preview','Preview exact source changes',busy?'disabled':'')+button('prepare','Prepare native profiles',busy||!preview?'disabled':'')+'</div><div data-mc-preview></div><div data-mc-saved></div></div></section>';
    notice(message,error);renderPreview();renderSaved();syncBusy();
  }
  function syncBusy(){
    const publishedReady=publishedPreview&&publishedPreview._choice_signature===canonical(publishedInput());
    const publishedEligible=list(catalog?.published_recipe?.land_cover).some(x=>x.eligible);
    for(const node of $$('[data-mc-action]'))node.disabled=busy||
      (node.dataset.mcAction==='prepare'&&!preview)||
      (node.dataset.mcAction==='published-use'&&!publishedReady)||
      (node.dataset.mcAction==='published-preview'&&!publishedEligible)||
      (['open','export-study'].includes(node.dataset.mcAction)&&!draft().saved_id);
  }
  function changeTable(rows,editable){
    return rows.length?'<div class="pw-table-scroll"><table><thead><tr><th>Land cover</th><th>Coefficient</th><th>Target and units</th><th>Source</th>'+(editable?'<th>Change</th>':'')+'</tr></thead><tbody>'+rows.map((r,i)=>'<tr><td>'+esc(r.lucode)+'</td><td>'+esc(r.parameter)+'</td><td>'+esc(r.value)+' '+esc(r.units)+(r.load_type?'<br>'+esc(r.load_type):'')+'</td><td>'+esc(r.source.title)+'<br>'+esc(r.source.locator)+'<br>'+(/^https?:\/\//i.test(r.source.uri)?'<a href="'+esc(r.source.uri)+'" target="_blank" rel="noopener noreferrer">Open source</a>':esc(r.source.uri))+'</td>'+(editable?'<td>'+button('edit-cell','Edit','data-mc-index="'+i+'"')+button('remove-cell','Remove','data-mc-index="'+i+'"')+'</td>':'')+'</tr>').join('')+'</tbody></table></div>':'';
  }
  function renderPreview(){
    const node=$('[data-mc-preview]');if(!node)return;
    node.innerHTML=!preview?'':'<h3>Exact model input changes</h3><p>'+esc(preview.profile_preview.profile_count)+' distinct native profiles including the original baseline. Equivalent or unchanged cases retain their names with the same source configuration.</p>'+list(preview.cases).map(c=>'<section class="pw-original-source"><h4>'+esc(c.management_cases.map(x=>x.name).join(' / ')||c.name)+'</h4>'+
      (c.unchanged_from_baseline?'<p>This case is numerically identical to the original baseline.</p>':'')+
      '<div class="pw-table-scroll"><table><thead><tr><th>Coefficient</th><th>Land cover</th><th>Original</th><th>Target</th><th>Units</th></tr></thead><tbody>'+c.changes.flatMap(x=>x.lucodes.map(code=>'<tr><td>'+esc(x.target)+'</td><td>'+esc(code)+'</td><td>'+esc(x.before[String(code)])+'</td><td>'+esc(x.value)+'</td><td>'+esc(x.units)+'</td></tr>')).join('')+'</tbody></table></div>'+
      (c.nutrient_source_terms.length?'<details><summary>Native nutrient source terms before runoff normalization and routing</summary><div class="pw-table-scroll"><table><thead><tr><th>Code / nutrient</th><th>Load basis</th><th>Original source kg/ha/year</th><th>Changed source kg/ha/year</th></tr></thead><tbody>'+c.nutrient_source_terms.map(x=>'<tr><td>'+esc(x.lucode)+' / '+esc(x.nutrient.toUpperCase())+'</td><td>'+esc(x.load_type)+'</td><td>'+esc(x.on_pixel_source_before)+'</td><td>'+esc(x.on_pixel_source_after)+'</td></tr>').join('')+'</tbody></table></div></details>':'')+'</section>').join('');
  }
  function baselineRuns(){
    const ids=new Set(list(host.getState()?.data?.scenarios).filter(x=>x.kind==='baseline').map(x=>x.id));
    return list(host.getState()?.data?.runs).filter(x=>x.state==='complete'&&x.selection?.profile_id===profileId&&ids.has(x.selection?.scenario_id)&&canonical([...(x.selection.models||['ndr','sdr'])].sort())===canonical([...catalog.models].sort()));
  }
  function renderSaved(){
    const node=$('[data-mc-saved]');if(!node)return;const d=draft();
    if(!record){node.innerHTML='';return;}
    const requests=memory.requests.filter(x=>x.profile_id===profileId&&x.action==='profile.management.experiment.prepare'&&x.payload.case_id===record.id),finished=requests.map(taskFor).filter(x=>x?.state==='complete'&&x.result?.id);
    node.innerHTML='<h3>Saved native profiles and experiment</h3><p>'+esc(record.selection.title)+' · '+esc(short(record.id))+'</p><div class="pw-actions">'+record.profiles.map(p=>button('profile',p.title,'data-mc-id="'+esc(p.profile_id)+'"')).join('')+'</div><div class="pw-actions">'+list(record._downloads).filter(f=>/^\/api\/file\/[A-Za-z0-9/_-]+$/.test(f.url||'')).map(f=>'<a class="pw-download" href="'+esc(f.url)+'?download=1" download>'+esc(f.label||f.filename)+'</a>').join('')+'</div>'+
      '<label class="pw-field"><span>Completed original baseline run</span><select data-mc-field="baseline_run_id">'+option('','Choose native baseline',!d.baseline_run_id)+baselineRuns().map(r=>option(r.id,short(r.id)+' · '+(r.completed_at||''),r.id===d.baseline_run_id)).join('')+'</select></label>'+
      '<fieldset class="pw-model-choice"><legend>Additional mapped land-cover scenarios</legend>'+list(host.getState()?.data?.scenarios).filter(x=>x.kind==='landcover').map(x=>'<label><input type="checkbox" data-mc-scenario="'+esc(x.id)+'"'+(d.scenario_ids.includes(x.id)?' checked':'')+'> '+esc(x.title)+'</label>').join('')+'</fieldset>'+
      '<div class="pw-actions">'+button('experiment','Prepare native experiment',busy?'disabled':'')+finished.map(t=>button('run','Run saved experiment '+short(t.result.id),'data-mc-id="'+esc(t.result.id)+'"')).join('')+'</div><p class="pw-note">The existing Scenario experiments view contains native progress, maps, paired results and downloadable reports for these exact profiles.</p>';
  }
  function checkedDesign(value,requested={}){
    if(!value||value.schema!=='upstate.management-cases/v1'||!/^[0-9a-f]{64}$/.test(value.id||'')||
       value.id!==requested.management_case_id||value.baseline_profile_id!==profileId||
       value.selection?.baseline_profile_id!==profileId||
       value.selection?.expected_table_sha256!==catalog?.biophysical_sha256||
       (host.getState()?.project?.id&&value.workspace_id!==host.getState().project.id)||
       (requested.profile_id&&requested.profile_id!==profileId)||
       (requested.profile_set_id&&requested.profile_set_id!==value.profile_set_id)||
       (requested.table_sha256&&requested.table_sha256!==catalog.biophysical_sha256))
      throw Error('The saved management design differs from its original project, profile or coefficient table.');
    readManagementDraft(value.selection,profileId,catalog.biophysical_sha256);
    return value;
  }
  async function openSavedDesign(requested){
    const s=scope(),token=++intent,prior=canonical(draft());
    if(!alive(s)||requested?.workspace_key!==workspace||!/^[0-9a-f]{64}$/.test(requested?.management_case_id||''))
      throw Error('Open this saved management design in its original workspace.');
    const value=await read('inspect',{case_id:requested.management_case_id},s);
    if(!alive(s)||token!==intent||prior!==canonical(draft()))return null;
    checkedDesign(value,requested);
    const d=draft();
    if(canonical(selection())!==canonical(value.selection)||canonical(d.editing)!==canonical(emptyPractice())||Object.values(d.source).some(text)||Object.values(d.cell).some(text)){
      memory.previous_drafts??={};memory.previous_drafts[profileId]=copy(d);
    }
    record=value;Object.assign(d,copy(value.selection));d.saved_id=value.id;d.editing=emptyPractice();
    preview=null;publishedPreview=null;publishedIntent++;persist();render();
    notice('The original saved management design is open. Any different working draft remains available below.');
    root?.scrollIntoView?.({block:'start'});
    return {workspace_key:workspace,management_case_id:value.id,profile_id:profileId,profile_set_id:value.profile_set_id};
  }
  async function refresh(){
    const s=scope(),value=await read('catalog',{profile_id:profileId},s);if(!alive(s))return;catalog=value;
    const d=draft();if(!catalog.categories.some(x=>x.id===d.editing.category&&x.parameters.length))d.editing.category=catalog.categories.find(x=>x.parameters.length)?.id||'nutrient_load';
    if(d.saved_id){record=await read('inspect',{case_id:d.saved_id},s);if(!alive(s))return;}render();
  }
  async function issue(request,s){
    retain(request,{},s);const task=await host.api('/api/actions',{method:'POST',body:{workspace:s.workspace,action:request.action,payload:copy(request.payload),operation_id:request.operation_id}});
    if(!task?.id)throw Error('No operation receipt returned. Retry the same saved request.');
    await acceptedTask(request,s,task);
    if(alive(s)){await host.refreshState?.({force:true});if(alive(s)){await completeOperations();render();notice('The original operator retained the operation. Open it above for progress.');}}
  }
  async function queue(action,payload){
    const s=scope();if(!alive(s))throw Error('Reopen the original profile.');
    const token=canonical({action,payload});let request=memory.requests.find(x=>x.profile_id===profileId&&x.signature===token);
    if(!request){if(!globalThis.crypto?.randomUUID)throw Error('This browser cannot create an operation identifier.');request={operation_id:crypto.randomUUID(),profile_id:profileId,action,payload:copy(payload),signature:token};memory.requests.push(request);persist();}
    return issue(copy(request),s);
  }
  async function completeOperations(){
    if(processing||!root?.isConnected)return;const s=scope(),before=intent;processing=true;
    try{
      const finished=memory.requests.filter(x=>x.profile_id===profileId&&!x.handled&&taskFor(x)?.state==='complete');
      for(const request of finished){
        const task=await acceptedTask(request,s);if(!alive(s))return;
        if(request.action==='profile.management.prepare'&&before===intent){const value=await read('inspect',{case_id:task.result.id},s);if(!alive(s))return;record=value;draft().saved_id=value.id;catalog=await read('catalog',{profile_id:profileId},s);if(!alive(s))return;}
        retain(request,{handled:true},s);
      }
      if(alive(s)){persist();const node=$('[data-mc-operations]');if(node)node.innerHTML=operationHTML();renderSaved();}
    }finally{if(s.generation===generation)processing=false;}
  }
  function invalidate(){intent++;preview=null;persist();renderPreview();const button=$('[data-mc-action="prepare"]');if(button)button.disabled=true;}
  async function action(name,node){
    const d=draft();
    if(name==='refresh'){publishedPreview=null;publishedIntent++;return refresh();}
    if(name==='published-preview'){
      const s=scope(),token=++publishedIntent,input=publishedInput(),value=await read('published-preview',input,s);
      if(alive(s)&&token===publishedIntent&&canonical(input)===canonical(publishedInput())){
        publishedPreview={...value,_choice_signature:canonical(input)};render();notice('Published source cases are checked. Use Add to place them in the current design.');
      }return;
    }
    if(name==='published-use'){
      if(!publishedPreview||publishedPreview._choice_signature!==canonical(publishedInput()))throw Error('Preview the current pasture mapping and compartment before adding source cases.');
      const before=selection(),added=publishedPreview.selection,keys=new Set(d.practices.map(x=>x.key)),names=new Set(d.practices.map(x=>x.name));
      if(added.practices.some(x=>keys.has(x.key)||names.has(x.name)))throw Error('These treatment keys or names already exist. Keep them, or explicitly remove the old practices before adding this selection; nothing was replaced.');
      const combined={...copy(before),practices:[...copy(before.practices),...copy(added.practices)]};
      if(!before.practices.length&&(!before.title.trim()||before.title==='Land-management cases'))combined.title=added.title;
      if(!before.reason.trim())combined.reason=added.reason;
      const s=scope(),token=++intent,input=canonical(publishedInput()),checked=await read('preview',combined,s);
      if(alive(s)&&token===intent&&canonical(before)===canonical(selection())&&input===canonical(publishedInput())){
        Object.assign(d,copy(checked.selection));record=null;d.saved_id='';
        preview={...checked,_input_signature:canonical(selection())};persist();render();
        notice('The six paired treatments were added. Existing practices, combinations and unfinished editor fields were preserved. Prepare profiles when this complete design is ready.');
      }return;
    }
    if(name==='add-cell'){
      const row=sourceRow(),field=d.cell.parameter,rule=list(catalog.parameters).find(x=>x.target==='table.'+field);
      if(!row||!parameters().includes(field)||!rule||d.cell.value.trim()==='')throw Error('Choose an original coefficient cell and its absolute target.');
      const value=Number(d.cell.value);if(!Number.isFinite(value))throw Error('Supply a finite coefficient value.');
      for(const k of ['title','uri','locator','applicability'])if(!text(d.source[k]).trim())throw Error('Complete the source title, reference, locator and applicability.');
      const cell={lucode:Number(row.lucode),parameter:field,value,units:rule.units,load_type:['load_n','load_p'].includes(field)?row['load_type_'+field.slice(-1)].trim():'',source:copy(d.source)};
      const i=d.editing.changes.findIndex(x=>x.lucode===cell.lucode&&x.parameter===cell.parameter);if(i<0)d.editing.changes.push(cell);else d.editing.changes[i]=cell;invalidate();render();return;
    }
    if(name==='edit-cell'){const cell=d.editing.changes[Number(node.dataset.mcIndex)];d.source=copy(cell.source);d.cell={lucode:text(cell.lucode),parameter:cell.parameter,value:text(cell.value)};persist();render();return;}
    if(name==='remove-cell'){d.editing.changes.splice(Number(node.dataset.mcIndex),1);invalidate();render();return;}
    if(name==='save-practice'){
      const p=copy(d.editing);if(!p.name.trim()||!p.reason.trim()||!p.changes.length)throw Error('Name the practice, explain its assumptions and add its source coefficients.');
      if(!p.key){if(!globalThis.crypto?.randomUUID)throw Error('This browser cannot create a practice identifier.');p.key=crypto.randomUUID();}
      if(d.practices.some(x=>x.key!==p.key&&x.name.trim()===p.name.trim()))throw Error('Use a distinct practice name.');
      const i=d.practices.findIndex(x=>x.key===p.key);if(i<0)d.practices.push(p);else d.practices[i]=p;d.editing=emptyPractice();invalidate();render();return;
    }
    if(name==='clear-practice'){d.editing=emptyPractice();persist();render();return;}
    if(name==='edit-practice'){d.editing=copy(d.practices.find(x=>x.key===node.dataset.mcId));persist();render();return;}
    if(name==='remove-practice'){const key=node.dataset.mcId;d.practices=d.practices.filter(x=>x.key!==key);d.combinations=d.combinations.filter(x=>!x.practice_keys.includes(key));d.combination_keys=d.combination_keys.filter(x=>x!==key);invalidate();render();return;}
    if(name==='add-combination'){if(!d.combination_name.trim()||!d.combination_reason.trim()||d.combination_keys.length<2)throw Error('Name the combination, give its purpose and choose at least two practices.');d.combinations.push({name:d.combination_name,reason:d.combination_reason,practice_keys:copy(d.combination_keys)});d.combination_name='';d.combination_reason='';d.combination_keys=[];invalidate();render();return;}
    if(name==='remove-combination'){d.combinations.splice(Number(node.dataset.mcIndex),1);invalidate();render();return;}
    if(name==='preview'){const s=scope(),token=++intent,selected=selection(),value=await read('preview',selected,s);if(alive(s)&&intent===token&&canonical(selected)===canonical(selection())){preview={...value,_input_signature:canonical(selected)};render();}return;}
    if(name==='prepare'){if(!preview||preview._input_signature!==canonical(selection()))throw Error('Preview the current source choices before preparing profiles.');return queue('profile.management.prepare',preview.selection);}
    if(name==='open'){if(!d.saved_id)throw Error('Choose a saved design.');return openSavedDesign({workspace_key:workspace,management_case_id:d.saved_id});}
    if(name==='previous-draft'){
      const prior=memory.previous_drafts?.[profileId];if(!prior)throw Error('No previous working design is retained.');
      readManagementDraft({selection:managementSelection(prior,profileId,catalog.biophysical_sha256),working_editor:{editing:prior.editing,source:prior.source,cell:prior.cell}},profileId,catalog.biophysical_sha256);
      memory.previous_drafts[profileId]=copy(d);memory.drafts[profileId]=copy(prior);
      record=null;preview=null;publishedPreview=null;intent++;publishedIntent++;persist();render();notice('The previous working design and unfinished practice are restored. Preview it before preparing profiles.');return;
    }
    if(name==='export-study'){
      if(!d.saved_id||typeof host.openDesk!=='function')throw Error('Choose a saved design and open the maintained Study transfer desk.');
      const s=scope(),token=++intent,id=d.saved_id,value=await read('inspect',{case_id:id},s);
      if(!alive(s)||token!==intent||draft().saved_id!==id)return;
      checkedDesign(value,{management_case_id:id});persist();
      return host.openDesk('study-transfer','openForStudies',{workspace_key:workspace,roots:[{kind:'management-cases',id:value.id,title:value.selection.title}]});
    }
    if(name==='download'){const body=JSON.stringify({schema:'upstate.management-selection/v1',selection:selection(),working_editor:{editing:copy(d.editing),source:copy(d.source),cell:copy(d.cell)}},null,2)+'\n',url=URL.createObjectURL(new Blob([body],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='management-cases-'+short(profileId)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;}
    if(name==='experiment'){if(!record||!baselineRuns().some(x=>x.id===d.baseline_run_id))throw Error('Select the original completed baseline for this saved design.');return queue('profile.management.experiment.prepare',{case_id:record.id,baseline_run_id:d.baseline_run_id,scenario_ids:copy(d.scenario_ids)});}
    if(name==='run')return queue('experiment.run',{experiment_id:node.dataset.mcId});
    if(name==='profile')return onProfile(node.dataset.mcId);
    if(name==='task')return host.showTask?.(node.dataset.mcId);
    if(name==='retry'){const request=memory.requests.find(x=>x.operation_id===node.dataset.mcId);if(!request)throw Error('The saved request is unavailable.');return issue(copy(request),scope());}
    if(name==='resume'){
      const request=memory.requests.find(x=>x.task_id===node.dataset.mcId);
      if(!request)throw Error('The original authored request for this task is unavailable.');
      const s=scope(),task=await host.api('/api/task/resume',{method:'POST',body:{id:request.task_id}});
      await acceptedTask(copy(request),s,task);
      if(alive(s)){await host.refreshState?.({force:true});if(alive(s))return completeOperations();}
      return;
    }
  }
  async function clicked(event){
    const node=event.target.closest('[data-mc-action]');if(!node||!root?.contains(node))return;event.preventDefault();event.stopPropagation();if(busy)return;
    const s=scope();busy=true;syncBusy();try{await action(node.dataset.mcAction,node);}catch(e){if(alive(s))notice(e.message,true);}finally{if(alive(s)){busy=false;syncBusy();}}
  }
  async function changed(event){
    const node=event.target;if(!root?.contains(node))return;const d=draft();
    if(node.dataset.mcPublished!==undefined){
      const key=node.dataset.mcPublished,p=publishedDraft();
      if(!['lucode','nitrogen_compartment','applicability','confirm_pasture'].includes(key))return;
      p[key]=key==='confirm_pasture'?node.checked===true:node.value;
      publishedIntent++;publishedPreview=null;persist();
      if(event.type==='change'&&['lucode','nitrogen_compartment','confirm_pasture'].includes(key))render();else syncBusy();
      return;
    }
    if(node.hasAttribute('data-mc-upload')&&event.type==='change'&&node.files?.[0]){
      const s=scope(),token=++intent;try{
        const value=JSON.parse(await node.files[0].text());if(!alive(s)||token!==intent)return;
        const selected=readManagementDraft(value,profileId,catalog.biophysical_sha256);
        Object.assign(d,selected.selection);
        if(selected.working_editor){d.editing=selected.working_editor.editing;d.source=selected.working_editor.source;d.cell=selected.working_editor.cell;}
        preview=null;persist();render();notice('The editable design and unfinished practice are loaded. Preview the current choices before preparing native profiles.');
      }catch(e){if(alive(s))notice(e.message,true);}return;
    }
    if(node.dataset.mcCombination!==undefined||node.dataset.mcScenario!==undefined){
      const key=node.dataset.mcCombination!==undefined?'combination_keys':'scenario_ids',id=node.dataset.mcCombination??node.dataset.mcScenario;d[key]=node.checked?[...new Set([...d[key],id])]:d[key].filter(x=>x!==id);persist();return;
    }
    const key=node.dataset.mcField;if(!key)return;
    const parts=key.split('.');if(parts[0]==='practice')d.editing[parts[1]]=node.value;else if(parts.length===2)d[parts[0]][parts[1]]=node.value;else d[key]=node.value;
    if(key==='practice.category'){d.editing.source_mode='coupled';d.cell.parameter='';}
    if(!['saved_id','baseline_run_id'].includes(key))invalidate();else{persist();syncBusy();}
    if(['practice.category','cell.lucode','cell.parameter'].includes(key))render();
  }
  async function mount(node,selected){
    detach();root=node;workspace=selected.workspace_key;profileId=selected.profile_id;memory=stored(workspace);events=new AbortController();
    root.addEventListener('toggle',event=>{if(event.target.hasAttribute?.('data-mc-published-panel')){publishedDraft().open=event.target.open===true;persist();}},{signal:events.signal,capture:true});
    root.addEventListener('click',clicked,{signal:events.signal});root.addEventListener('input',changed,{signal:events.signal});root.addEventListener('change',changed,{signal:events.signal});root.addEventListener('submit',event=>event.preventDefault(),{signal:events.signal});
    root.innerHTML='<p class="pw-note">Reading native management inputs…</p>';const s=scope();try{await refresh();if(alive(s))await completeOperations();}catch(e){if(alive(s))root.textContent=e.message;}
  }
  function update(snapshot=host.getState()){
    if(!root?.isConnected)return;if(snapshot.workspace_key!==workspace){detach();return;}
    const next=canonical(allTasks().map(x=>[x.id,x.state]));if(next!==signature){signature=next;completeOperations().catch(e=>notice(e.message,true));}
  }
  function detach(){persist();generation++;events?.abort();events=null;root=null;busy=false;processing=false;catalog=null;record=null;preview=null;publishedPreview=null;publishedIntent++;signature='';}
  return {mount,update,detach,openSavedDesign};
}
