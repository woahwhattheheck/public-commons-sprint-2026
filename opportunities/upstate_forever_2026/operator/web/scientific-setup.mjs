/** Scientific setup preparation through the existing Workspace and review desk. */
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const arr = value => Array.isArray(value) ? value : [];
const text = value => value == null ? 'Not recorded' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const human = value => String(value ?? '').replace(/[_-]+/g,' ');
const title = value => value?.title || value?.name || value?.id || 'Untitled';
const date = value => value ? new Date(value).toLocaleString() : '';
const short = value => String(value ?? '').slice(0,12);
const pretty = value => JSON.stringify(value,null,2);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clone = value => JSON.parse(JSON.stringify(value));
const list = (values, render = esc) => arr(values).length ? '<ul>'+values.map(v=>'<li>'+render(v)+'</li>').join('')+'</ul>' : '<p class="note">None selected.</p>';
const defs = entries => '<dl class="setup-definitions">'+entries.map(([key,value])=>'<dt>'+esc(key)+'</dt><dd>'+esc(text(value))+'</dd>').join('')+'</dl>';
const details = (label,value) => '<details><summary>'+esc(label)+'</summary><pre class="json-view">'+esc(pretty(value))+'</pre></details>';
const table = (headers,rows) => '<div class="table-scroll"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const button = (action,label,extra='',primary=false) => '<button type="button" data-setup-action="'+action+'" '+extra+' class="'+(primary?'primary':'small')+'">'+esc(label)+'</button>';
const field = (name,label,value='',{rows=0,type='text',help='',required=false}={}) => '<label><span>'+esc(label)+(required?' *':'')+'</span>'+(rows?'<textarea data-setup-field="'+name+'" rows="'+rows+'" maxlength="20000"'+(required?' required':'')+'>'+esc(value)+'</textarea>':'<input data-setup-field="'+name+'" type="'+type+'" value="'+esc(value)+'"'+(type==='number'?' min="0" step="any"':' maxlength="600"')+(required?' required':'')+'>')+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
const option = (id,label,selected) => '<option value="'+esc(id)+'"'+(id===selected?' selected':'')+'>'+esc(label)+'</option>';
function select(name,label,rows,selected='',help='') {
  const known=rows.some(r=>r.id===selected);
  return '<label><span>'+esc(label)+' *</span><select data-setup-field="'+name+'" required>'+
    option('','Choose a saved item',selected)+rows.map(r=>option(r.id,title(r),selected)).join('')+
    (selected&&!known?option(selected,'Saved selection unavailable: '+short(selected),selected):'')+
    '</select>'+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
}
function choices(name,rows,selected=[],help='') {
  const ids=new Set(selected),known=new Set(rows.map(r=>r.id));
  return (help?'<p class="note">'+esc(help)+'</p>':'')+
    (rows.length?'<div class="setup-choices">'+rows.map(row=>'<label class="check"><input type="checkbox" data-setup-group="'+name+'" value="'+esc(row.id)+'"'+(ids.has(row.id)?' checked':'')+'><span>'+esc(title(row))+'<small>'+esc(row.kind||row.models?.join(', ')||(row.entries!=null?row.entries+' sources':''))+'</small></span></label>').join('')+'</div>':'<p class="note">No saved items are available in this project.</p>')+
    selected.filter(id=>!known.has(id)).map(id=>'<label class="check"><input type="checkbox" data-setup-group="'+name+'" value="'+esc(id)+'" checked><span>Saved selection unavailable: '+esc(short(id))+'</span></label>').join('');
}
function section(label,body,description='') {
  return '<section class="section"><header class="section-header"><div><h2>'+esc(label)+'</h2>'+(description?'<p>'+esc(description)+'</p>':'')+'</div></header><div class="section-body">'+body+'</div></section>';
}
export function defaultSetupSelection() {
  return {schema:'upstate.scientific-setup-selection/v1',title:'',question:'',domain_rationale:'',
    grid_id:'',profile_id:'',baseline_scenario_id:'',alternative_scenario_ids:[],source_collection_ids:[],observation_ids:[],
    expected_resolution_m:30,expected_alternative_count:2,validation:{method:'',intended_comparison:'',limitations:''},
    roles:{scientific_reviewer:{name:'',role:'Scientific reviewer',organization:''},receiving_operator:{name:'',role:'Receiving operator',organization:''}},notes:[]};
}
export function normalizeSetupDraft(value) {
  const base=defaultSetupSelection(),v=value&&typeof value==='object'?value:{};
  const result = {...base,...v,schema:base.schema,
    alternative_scenario_ids:arr(v.alternative_scenario_ids),source_collection_ids:arr(v.source_collection_ids),
    observation_ids:arr(v.observation_ids),notes:arr(v.notes),
    validation:{...base.validation,...v.validation},
    roles:{scientific_reviewer:{...base.roles.scientific_reviewer,...v.roles?.scientific_reviewer},
      receiving_operator:{...base.roles.receiving_operator,...v.roles?.receiving_operator}}};
  if(value&&typeof value==='object')for(const key of ['expected_resolution_m','expected_alternative_count'])if(!Object.hasOwn(value,key))delete result[key];
  return result;
}
function roleSummary(role) {
  return [role?.name||'Unassigned',role?.role,role?.organization].filter(Boolean).join(' · ');
}
export function renderSetupChecks(checks) {
  if(!arr(checks).length)return '<p class="note">No setup checks were returned.</p>';
  const labels={matches:'Matches requested setup',differs:'Review the difference',not_requested:'No requested target',needs_description:'Description needed'};
  return table(['Setup check','Finding','Actual','Requested','Explanation'],checks.map(row=>'<tr><th scope="row">'+esc(row.title||human(row.id))+'</th><td>'+esc(labels[row.status]||human(row.status))+'</td><td>'+esc(text(row.actual))+'</td><td>'+esc(text(row.expected))+'</td><td>'+esc(row.detail||'')+'</td></tr>'));
}
function scenarioCard(row,label) {
  if(!row)return '<p>'+esc(label)+': not selected.</p>';
  return '<article class="setup-scenario"><h3>'+esc(label)+': '+esc(title(row))+'</h3>'+
    defs([['Kind',row.kind],['Purpose',row.reason||row.description],['Original source collection',row.source_collection_id],['Saved scenario',row.id]])+
    (arr(row.patches).length?details('Exact selected land-cover changes',row.patches):'')+
    details('Complete saved scenario',row)+'</article>';
}
function sourceInventory(rows) {
  return rows.length?table(['Original source','Edition and units','Coverage and purpose','Selected use'],rows.map(row=>'<tr><th scope="row">'+esc(row.title||row.source_id)+'<small>'+esc(row.source_id)+'</small></th><td>'+esc(row.vintage||'Edition not recorded')+'<br>'+esc(text(row.units))+'<br>'+esc(text(row.source_crs))+'</td><td>'+esc(text(row.coverage))+'<br>'+esc(text(row.intended_use))+'</td><td>'+esc(arr(row.selected_for).join(', '))+details('Original metadata and retained files',row)+'</td></tr>')):'<p>No source inventory was returned.</p>';
}
export function renderScientificSetup(spec,checks=null) {
  if(!spec||typeof spec!=='object')return '<p>Open a saved setup or preview the selected specification.</p>';
  const grid=spec.grid||{},definition=grid.definition||{},method=spec.method||{},validation=spec.validation||{},roles=spec.roles||{},areas=spec.areas||{};
  const inputs=arr(grid.prepared_inputs);
  return section('Scientific question and study area',
    '<p class="setup-prose">'+esc(spec.question||spec.selection?.question||'Not described')+'</p>'+
    defs([['Reporting area',areas.reporting_area],['Contributing model domain',areas.model_domain],['Upstream buffer',areas.upstream_buffer_m!=null?String(areas.upstream_buffer_m)+' m':null]])+
    '<h3>Why the model domain extends beyond the reporting area</h3><p class="setup-prose">'+esc(spec.domain_rationale||'Not described')+'</p>')+
    section('Grid and prepared inputs',
      defs([['Saved grid',grid.id],['State',grid.state],['Resolution',definition.resolution_m!=null?String(definition.resolution_m)+' m':null],['Coordinate system',definition.crs_name||definition.crs],['Grid size',definition.width!=null?definition.width+' × '+definition.height:null],['Pixel area',definition.pixel_area_ha!=null?String(definition.pixel_area_ha)+' ha':null]])+
      (inputs.length?table(['Input','Aligned file','Raster definition','Source transformation'],inputs.map(row=>'<tr><th scope="row">'+esc(human(row.role))+'</th><td>'+esc(row.prepared_file?.path||'')+'<br>'+esc(text(row.prepared_file?.units))+'</td><td>'+(row.header?defs([['CRS',row.header.crs_name||row.header.crs],['Size',row.header.width+' × '+row.header.height],['NoData',row.header.nodata],['Transform',row.header.transform]]):'<p class="note">Original grid metadata is shown in preview. Raster headers are captured when this setup is retained.</p>')+'</td><td>'+details('Prepared input and provenance',row)+'</td></tr>')):'<p>No prepared input inventory was returned.</p>')+
      details('Complete grid specification',grid.spec||grid))+
    section('Model and parameter profile',
      defs([['Implementation',method.model_implementation],['Version',method.version],['Selected models',method.selected_models],['Saved parameter profile',title(method.profile)],['Native model source',method.source],['Coefficient source collection',method.profile?.source_collection_id],['Biophysical coefficient table',method.profile?.biophysical_source_id]])+
      details('Original parameter profile and coefficient bindings',method.profile||method))+
    section('Baseline and alternatives',
      scenarioCard(spec.baseline,'Baseline')+arr(spec.alternatives).map((row,i)=>scenarioCard(row,'Alternative '+(i+1))).join(''))+
    section('Original sources',sourceInventory(arr(spec.source_inventory)),
      'Original editions, coverage, units and transformation records remain attached to the setup.')+
    section('Observations and validation',
      (arr(spec.observations).length?table(['Observation','Included records','Context records','Original metadata'],spec.observations.map(row=>'<tr><th scope="row">'+esc(row.metadata?.title||row.metadata?.name||row.id)+'</th><td>'+esc(text(row.admitted_count))+'</td><td>'+esc(text(row.context_count))+'</td><td>'+details('Observation source and metadata',row)+'</td></tr>')):'<p>No saved observations are selected.</p>')+
      defs([['Validation method',validation.method],['Intended comparison',validation.intended_comparison],['Limitations',validation.limitations]]))+
    section('Review findings and responsibilities',renderSetupChecks(checks||spec.checks)+
      defs([['Scientific reviewer',roleSummary(roles.scientific_reviewer)],['Receiving operator',roleSummary(roles.receiving_operator)]])+
      (arr(spec.requirements).length?details('Original review requirements',spec.requirements):'')+
      (arr(spec.notes).length?list(spec.notes):''))+
    '<details><summary>Complete editable setup specification</summary><pre class="json-view">'+esc(pretty(spec))+'</pre></details>';
}
function safeDownload(item) {
  try {
    const url=new URL(item.url,globalThis.location?.href||'https://localhost/');
    if(!['http:','https:'].includes(url.protocol))return '';
    return '<a class="button" href="'+esc(url.href+(url.search?'&':'?')+'download=1')+'" download>'+esc(item.label||item.filename||'Download retained file')+'</a>';
  } catch(_){return '';}
}
export function attachScientificSetup(host) {
  let root=null,catalog=null,draft=defaultSetupSelection(),preview=null,active=null,pending=null,busy=false;
  let epoch=0,sequence=0,workspaceKey=null,storageWarning=false;
  const q=(selector,node=root)=>node?.querySelector(selector);
  const qa=(selector,node=root)=>[...(node?.querySelectorAll(selector)||[])];
  const workspace=()=>host.getState()?.workspace_key;
  const alive=(generation,key)=>root?.isConnected&&epoch===generation&&workspace()===key;
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const key=(kind)=>'upstate-scientific-setup:v1:'+workspaceKey+':'+(catalog?.project?.id||'project')+':'+kind;
  function stored(name){try{return JSON.parse(localStorage.getItem(name)||'null');}catch(_){return null;}}
  function save(name,value){try{if(value==null)localStorage.removeItem(name);else localStorage.setItem(name,JSON.stringify(value));return true;}catch(_){if(!storageWarning){storageWarning=true;notice('Browser draft saving is unavailable. Keep this page open until the setup task is retained.',true);}return false;}}
  function notice(message,error=false){const node=q('[data-setup-notice]');if(node){node.textContent=message;node.hidden=!message;node.className=error?'notice error':'notice';}else if(message)host.toast?.(message);}
  function stateBusy(value,message=''){busy=value;for(const node of qa('[data-setup-action="preview"],[data-setup-action="create"],[data-setup-action="refresh"],[data-setup-action="new"],[data-setup-action="edit"],[data-setup-action="resume"],[data-setup-action="open"]'))node.disabled=value;const p=q('[data-setup-progress]');if(p)p.textContent=message;const create=q('[data-setup-action="create"]');if(create)create.disabled=value||!preview||!!pending;}
  function request(path,{method='GET',body}={}){return host.api(method==='GET'?host.endpoint(path,body||{}):path,method==='GET'?{}:{method,body:{workspace:workspaceKey,...body}});}
  function fieldValue(name){return q('[data-setup-field="'+name+'"]')?.value??'';}
  function selected(name){return qa('[data-setup-group="'+name+'"]:checked').map(n=>n.value);}
  function readForm(){
    if(!q('[data-setup-form]'))return draft;
    const value=normalizeSetupDraft(draft);
    for(const name of ['title','question','domain_rationale','grid_id','profile_id','baseline_scenario_id'])value[name]=fieldValue(name).trim();
    for(const name of ['alternative_scenario_ids','source_collection_ids','observation_ids'])value[name]=selected(name);
    for(const name of ['method','intended_comparison','limitations'])value.validation[name]=fieldValue('validation.'+name).trim();
    for(const role of ['scientific_reviewer','receiving_operator'])for(const name of ['name','role','organization'])value.roles[role][name]=fieldValue('roles.'+role+'.'+name).trim();
    for(const name of ['expected_resolution_m','expected_alternative_count']){const raw=fieldValue(name).trim();if(raw==='')delete value[name];else value[name]=Number(raw);}
    value.notes=fieldValue('notes').split('\n').map(v=>v.trim()).filter(Boolean);
    return value;
  }
  function persistDraft(){draft=readForm();save(key('draft'),draft);}
  function invalidatePreview(){sequence++;preview=null;const target=q('[data-setup-preview]');if(target)target.innerHTML='';stateBusy(busy);}
  function roleForm(role,label){const r=draft.roles[role];return '<fieldset><legend>'+esc(label)+'</legend><div class="form-grid">'+field('roles.'+role+'.name','Name',r.name,{help:'Leave blank when the person has not yet been assigned.'})+field('roles.'+role+'.role','Responsibility',r.role)+field('roles.'+role+'.organization','Organization',r.organization)+'</div></fieldset>';}
  function renderForm(){
    const node=q('[data-setup-form]');if(!node||!catalog)return;
    node.innerHTML='<div class="form-grid">'+field('title','Setup title',draft.title,{required:true})+
      select('grid_id','Saved model grid',catalog.grids,draft.grid_id,'The saved grid supplies the actual reporting area, model domain and aligned input definitions.')+
      select('profile_id','Saved parameter profile',catalog.profiles,draft.profile_id)+
      select('baseline_scenario_id','Baseline',catalog.scenarios.filter(row=>row.kind==='baseline'),draft.baseline_scenario_id)+
      field('expected_resolution_m','Requested grid resolution (m)',draft.expected_resolution_m??'',{type:'number',help:'A requested target to compare with the saved grid. Leave blank for no requested target.'})+
      field('expected_alternative_count','Requested number of alternatives',draft.expected_alternative_count??'',{type:'number',help:'A difference is shown for review alongside the selected scenarios.'})+'</div>'+
      field('question','Scientific question',draft.question,{rows:3,required:true})+
      field('domain_rationale','Model domain rationale',draft.domain_rationale,{rows:3,required:true,help:'Describe why the contributing domain extends beyond the area being reported.'})+
      '<fieldset><legend>Selected alternatives</legend>'+choices('alternative_scenario_ids',catalog.scenarios.filter(row=>row.kind==='landcover'),draft.alternative_scenario_ids,'Choose the saved scenarios to compare with the baseline.')+'</fieldset>'+
      '<fieldset><legend>Additional original source collections</legend>'+choices('source_collection_ids',catalog.source_collections,draft.source_collection_ids,'Sources bound to the grid, profile and selected scenarios are included automatically.')+'</fieldset>'+
      '<fieldset><legend>Saved observations</legend>'+choices('observation_ids',catalog.observations,draft.observation_ids,'Select the original observations used to define the proposed comparison.')+'</fieldset>'+
      '<fieldset><legend>Validation approach</legend>'+field('validation.method','Method',draft.validation.method,{rows:3,required:true})+
      field('validation.intended_comparison','Intended comparison',draft.validation.intended_comparison,{rows:3})+
      field('validation.limitations','Known limitations',draft.validation.limitations,{rows:3})+'</fieldset>'+
      roleForm('scientific_reviewer','Scientific reviewer')+roleForm('receiving_operator','Receiving operator')+
      field('notes','Additional notes',draft.notes.join('\n'),{rows:3,help:'One note per line.'});
    updateBaseline();
  }
  function updateBaseline(){const baseline=fieldValue('baseline_scenario_id');for(const node of qa('[data-setup-group="alternative_scenario_ids"]')){node.disabled=node.value===baseline;if(node.disabled)node.checked=false;}}
  function renderHistory(){
    const node=q('[data-setup-history]');if(!node)return;
    node.innerHTML=arr(catalog?.setups).length?table(['Setup','Created','Review',''],catalog.setups.map(row=>'<tr><th scope="row">'+esc(row.title)+'</th><td>'+esc(date(row.created_at))+'</td><td>'+esc(short(row.review_id))+'</td><td>'+button('open','Open setup','data-setup-id="'+esc(row.id)+'"')+'</td></tr>')):'<p>No setup specifications have been retained in this project.</p>';
  }
  function renderShell(){
    root.classList.add('scientific-setup');
    root.innerHTML='<header class="page-header"><div><p class="eyebrow">SCIENTIFIC SETUP</p><h1>Prepare a setup for review</h1><p>Retain the study area, original sources, grid, parameter profile and scenario definitions in one editable review package.</p></div><div class="page-actions">'+button('refresh','Refresh saved inputs')+button('new','New setup')+'</div></header>'+
      '<p data-setup-notice class="notice" role="status" aria-live="polite" hidden></p>'+
      section('Select the saved project setup','<form data-setup-form></form><div class="page-actions">'+button('preview','Preview setup','',true)+button('create','Retain setup and create review','disabled')+'</div><p data-setup-progress role="status" aria-live="polite"></p><div data-setup-pending></div>','Use the actual saved inputs. Requested targets appear as review findings alongside their measured definitions.')+
      '<div data-setup-preview></div><div data-setup-detail></div>'+
      section('Retained setup packages','<div data-setup-history></div>');
    renderForm();renderHistory();renderPending();
  }
  function renderPending(){
    const node=q('[data-setup-pending]');if(!node)return;
    node.innerHTML=pending?'<p>A setup operation is retained for this project.</p>'+button('resume',pending.task_id?'Reopen or resume retained task':'Continue retained request')+(pending.task_id?button('task','Open task details','data-task-id="'+esc(pending.task_id)+'"'):''):'';
    stateBusy(busy);
  }
  async function refresh({first=false}={}){
    const generation=epoch,keyValue=workspaceKey,value=await request('/api/scientific-setup/catalog');
    if(!alive(generation,keyValue))return false;
    catalog=value;
    for(const name of ['grids','profiles','scenarios','source_collections','observations','setups'])catalog[name]=arr(catalog[name]);
    if(first){draft=normalizeSetupDraft(stored(key('draft')));pending=stored(key('operation'));}
    renderShell();return true;
  }
  async function previewSetup(){
    if(busy||pending)return;
    const form=q('[data-setup-form]');if(!form?.reportValidity())return;
    persistDraft();const selection=clone(draft),generation=epoch,keyValue=workspaceKey,requestNumber=++sequence;
    if(selection.expected_resolution_m!==undefined&&(!finite(selection.expected_resolution_m)||selection.expected_resolution_m<=0))throw Error('Enter a positive requested grid resolution or leave it blank.');
    if(selection.expected_alternative_count!==undefined&&(!Number.isInteger(selection.expected_alternative_count)||selection.expected_alternative_count<0))throw Error('Enter a whole requested alternative count or leave it blank.');
    stateBusy(true,'Reading the selected original project inputs…');notice('');
    try{
      const value=await request('/api/scientific-setup/preview',{method:'POST',body:selection});
      if(!alive(generation,keyValue)||sequence!==requestNumber)return;
      preview={...value,request:selection};
      q('[data-setup-preview]').innerHTML='<header class="page-header"><div><h2>Setup preview</h2><p>Review the original selections and findings, then retain this setup to create its normal customer review.</p></div></header>'+renderScientificSetup(value.specification,value.checks);
      q('[data-setup-preview]').scrollIntoView({block:'start',behavior:'smooth'});
    }finally{if(alive(generation,keyValue))stateBusy(false);}
  }
  async function openSetup(id){
    const generation=epoch,keyValue=workspaceKey,requestNumber=++sequence;
    stateBusy(true,'Opening the retained setup…');notice('');
    try{
      const value=await request('/api/scientific-setup/detail',{body:{setup_id:id}});
      if(!alive(generation,keyValue)||requestNumber!==sequence)return null;
      active=value;save(key('active'),id);
      const reviewId=value.review_id||value.setup?.review_id||value.review?.id;
      q('[data-setup-detail]').innerHTML='<header class="page-header"><div><h2>'+esc(value.setup?.title||value.specification?.selection?.title||'Retained scientific setup')+'</h2><p>'+esc(date(value.setup?.created_at))+'</p></div><div class="page-actions">'+button('edit','Use as a new setup')+(reviewId?'<button type="button" class="primary" data-action="review-open" data-id="'+esc(reviewId)+'">Open customer review</button>':'')+'</div></header>'+
        '<div class="page-actions">'+arr(value._downloads).map(safeDownload).join('')+'</div>'+renderScientificSetup(value.specification,value.checks);
      q('[data-setup-detail]').scrollIntoView({block:'start',behavior:'smooth'});return value;
    }finally{if(alive(generation,keyValue))stateBusy(false);}
  }
  function savePending(value){
    const prior=stored(key('operation'));if(prior&&prior.operation_id!==value.operation_id)throw Error('Another setup request is retained in this browser. Reopen it before starting another.');
    pending=value;save(key('operation'),value);renderPending();
  }
  function clearPending(value){const prior=stored(key('operation'));if(prior?.operation_id===value.operation_id)save(key('operation'),null);if(pending?.operation_id===value.operation_id)pending=null;renderPending();}
  async function awaitTask(operation,task,generation,keyValue){
    while(alive(generation,keyValue)){
      operation={...operation,task_id:task.id};savePending(operation);
      stateBusy(true,'Setup task '+human(task.state)+'…');
      if(task.state==='complete'){clearPending(operation);return task;}
      if(['failed','interrupted','cancelled'].includes(task.state))throw Object.assign(new Error(task.error?.message||'Open the retained task to continue.'),{taskId:task.id});
      await delay(1000);if(!alive(generation,keyValue))return null;
      task=await request('/api/task',{body:{id:task.id}});
    }return null;
  }
  async function finishTask(task,generation,keyValue){
    if(!task||!alive(generation,keyValue))return;
    if(host.refreshState)await host.refreshState({force:true});
    if(!alive(generation,keyValue))return;
    preview=null;await refresh();if(!alive(generation,keyValue))return;
    if(task.result?.setup_id)await openSetup(task.result.setup_id);
    if(!alive(generation,keyValue))return;
    notice('The setup and its original customer review are retained. Continue review decisions in Customer reviews.');
  }
  async function createSetup(){
    if(busy||pending||!preview)return;
    persistDraft();if(JSON.stringify(draft)!==JSON.stringify(preview.request)){invalidatePreview();throw Error('The selected setup changed. Preview the current inputs before retaining it.');}
    const generation=epoch,keyValue=workspaceKey,operation={workspace:keyValue,action:'scientific.setup.create',payload:clone(preview.request),operation_id:crypto.randomUUID()};
    savePending(operation);stateBusy(true,'Retaining the original setup and creating its review…');notice('');
    try{const first=await host.api('/api/actions',{method:'POST',body:operation});if(!alive(generation,keyValue))return;const task=await awaitTask(operation,first,generation,keyValue);await finishTask(task,generation,keyValue);}
    finally{if(alive(generation,keyValue))stateBusy(false);}
  }
  async function resume(){
    if(busy||!pending)return;
    const generation=epoch,keyValue=workspaceKey,operation=clone(pending);
    if(operation.workspace!==keyValue)throw Error('Open the original workspace for this setup operation.');
    stateBusy(true,'Reopening the retained setup operation…');notice('');
    try{
      let task=operation.task_id?await request('/api/task',{body:{id:operation.task_id}}):await host.api('/api/actions',{method:'POST',body:operation});
      if(!alive(generation,keyValue))return;
      if(['failed','interrupted','cancelled'].includes(task.state))task=await host.api('/api/task/resume',{method:'POST',body:{id:task.id}});
      const completed=await awaitTask(operation,task,generation,keyValue);await finishTask(completed,generation,keyValue);
    }finally{if(alive(generation,keyValue))stateBusy(false);}
  }
  function change(event){
    const node=event.target;
    if(!node.matches('[data-setup-field],[data-setup-group]'))return;
    if(node.dataset.setupField==='baseline_scenario_id')updateBaseline();
    persistDraft();invalidatePreview();
  }
  async function click(event){
    const node=event.target.closest('[data-setup-action]');if(!node||!root?.contains(node))return;
    event.preventDefault();event.stopPropagation();const action=node.dataset.setupAction;
    const generation=epoch,keyValue=workspaceKey;
    if(busy&&action!=='task')return;
    try{
      if(action==='reload'){await mount(root);return;}
      if(action==='preview')await previewSetup();
      if(action==='create')await createSetup();
      if(action==='resume')await resume();
      if(action==='open')await openSetup(node.dataset.setupId);
      if(action==='task')await host.showTask?.(node.dataset.taskId);
      if(action==='refresh'){persistDraft();invalidatePreview();await refresh();}
      if(action==='new'){if(pending)throw Error('Reopen the retained operation before creating another setup.');draft=defaultSetupSelection();preview=null;active=null;sequence++;save(key('draft'),draft);save(key('active'),null);renderShell();}
      if(action==='edit'&&active){if(pending)throw Error('Reopen the retained operation before creating another setup.');draft=normalizeSetupDraft(active.setup?.selection||active.specification?.selection);preview=null;sequence++;save(key('draft'),draft);renderForm();q('[data-setup-form]').scrollIntoView({block:'start',behavior:'smooth'});stateBusy(false);}
    }catch(error){if(alive(generation,keyValue))notice(error.message||String(error),true);}
  }
  function submit(event){if(!event.target.matches('[data-setup-form]'))return;event.preventDefault();const generation=epoch,keyValue=workspaceKey;previewSetup().catch(error=>{if(alive(generation,keyValue))notice(error.message,true);});}
  async function mount(node){
    detach();root=node;workspaceKey=workspace();epoch++;storageWarning=false;catalog=null;active=null;preview=null;pending=null;
    root.addEventListener('click',click);root.addEventListener('input',change);root.addEventListener('change',change);root.addEventListener('submit',submit);
    root.innerHTML='<p role="status">Opening saved scientific setup inputs…</p>';
    const generation=epoch,keyValue=workspaceKey;
    try{if(!await refresh({first:true})||!alive(generation,keyValue))return;const id=stored(key('active'));if(id&&catalog.setups.some(v=>v.id===id))await openSetup(id);}
    catch(error){if(alive(generation,keyValue)){root.innerHTML='<p data-setup-notice class="notice error" role="alert"></p>'+button('reload','Reopen saved setup inputs');notice(error.message,true);}}
  }
  function update(){if(root?.isConnected&&workspace()!==workspaceKey)detach();}
  function detach(){if(root){if(catalog&&q('[data-setup-form]'))persistDraft();root.removeEventListener('click',click);root.removeEventListener('input',change);root.removeEventListener('change',change);root.removeEventListener('submit',submit);root.classList.remove('scientific-setup');}epoch++;sequence++;root=null;busy=false;}
  return {mount,update,detach,openSetup};
}
