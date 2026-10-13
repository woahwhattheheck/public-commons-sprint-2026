/** Joint sampling in the existing operator, with retained original action requests. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>JSON.parse(JSON.stringify(value));
const short=value=>String(value??'').slice(0,12);
const number=value=>Number.isFinite(value)?new Intl.NumberFormat(undefined,{maximumSignificantDigits:6}).format(value):'—';
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const encode=value=>JSON.stringify(ordered(value));
const rejectedBeforeDispatch=new Set(['INPUT_REQUIRED','JSON_NUMBER','JSON_INVALID','JSON_OBJECT','ACTION_INVALID','OPERATION_REQUIRED']);
function blank(){return {title:'Joint parameter study',reason:'',baseline_run_id:'',scenario_ids:[],
  axes:[{id:'axis-1',label:'',paths:[],distribution:'uniform',lower:'',upper:'',units:'',reason:'',references:''}],
  replicates:[{id:'replicate-1',samples:'',seed:''}]};}
function database(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('upstate-joint-parameter-studies-v1',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('workspaces');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
}
async function retained(workspace,value){
 const db=await database();
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction('workspaces',value===undefined?'readonly':'readwrite');
  const request=value===undefined?tx.objectStore('workspaces').get(workspace):tx.objectStore('workspaces').put(value,workspace);
  let result;request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);
  tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('The browser did not retain the original request.'));
 });}finally{db.close();}
}
function download(name,value){
 const blob=new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'});
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function attachJointParameterStudies(host){
 let root=null,workspace=null,generation=0,catalog=null,draft=blank(),candidate=null,pending=null,active=null,
     busy=false,error='',notice='',lastStamp='',loaded=false,saveTail=Promise.resolve();
 const current=()=>host.getState()?.workspace_key;
 const selected=token=>root&&workspace===current()&&token===generation;
 function snapshot(){return {schema:'upstate.joint-parameter-browser/v1',draft:copy(draft),
   candidate:copy(candidate),pending:copy(pending),active_id:active?.id??null};}
 function persist(){
  const key=workspace,value=snapshot();
  const task=saveTail.catch(()=>{}).then(()=>retained(key,value));
  saveTail=task;return task;
 }
 function read(operation,params={}){
  const token=generation,key=workspace;
  return host.api(host.endpoint('/api/joint-parameters/'+operation,params)).then(value=>{
   if(!selected(token)||workspace!==key)throw Error('The workspace changed. Reopen the original study.');
   return value;
  });
 }
 function message(){if(root){root.querySelector('[data-joint-message]').innerHTML=
   (error?'<p class="joint-error" role="alert">'+esc(error)+'</p>':'')+
   (notice?'<p role="status">'+esc(notice)+'</p>':'');
   root.querySelectorAll('[data-joint-command]').forEach(button=>{button.disabled=busy;});
   root.querySelectorAll('[data-joint-editor] input,[data-joint-editor] select,[data-joint-editor] textarea').forEach(field=>{field.disabled=busy;});
   const save=root.querySelector('[data-joint-command="prepare"]');if(save)save.disabled=busy||!candidate||Boolean(pending);
   const retry=root.querySelector('[data-joint-command="retry"]');if(retry)retry.hidden=!pending;
  }}
 function settings(value){return '<option value="'+esc(value)+'">'+esc(value)+'</option>';}
 function axisHTML(axis,index){
  const paths=Object.entries(catalog?.axes??{}).filter(([path])=>!path.endsWith('.flow_dir_algorithm'));
  return '<fieldset class="joint-axis" data-axis="'+index+'"><legend>Axis '+(index+1)+'</legend>'+
   '<div class="joint-grid"><label>Stable axis ID<input data-field="id" value="'+esc(axis.id)+'" required></label>'+
   '<label>Label<input data-field="label" value="'+esc(axis.label)+'" required></label></div>'+
   '<label>Native parameters coupled to this axis<select data-field="paths" multiple size="4" required>'+
   paths.map(([path,info])=>'<option value="'+esc(path)+'"'+(axis.paths.includes(path)?' selected':'')+'>'+esc(path+' — '+info.units)+'</option>').join('')+
   '</select><small>Select one parameter, or parameters that must share the same value and units.</small></label>'+
   '<div class="joint-grid"><label>Exploratory marginal<select data-field="distribution">'+
   ['uniform','log-uniform'].map(value=>'<option'+(value===axis.distribution?' selected':'')+'>'+value+'</option>').join('')+
   '</select></label><label>Units<input data-field="units" value="'+esc(axis.units)+'" required></label>'+
   '<label>Lower bound<input data-field="lower" type="number" step="any" value="'+esc(axis.lower)+'" required></label>'+
   '<label>Upper bound<input data-field="upper" type="number" step="any" value="'+esc(axis.upper)+'" required></label></div>'+
   '<label>Reason for this range<textarea data-field="reason" required>'+esc(axis.reason)+'</textarea></label>'+
   '<label>Original references — one per line<textarea data-field="references" required>'+esc(axis.references)+'</textarea></label>'+
   '<button type="button" data-joint-command="remove-axis" data-index="'+index+'">Remove axis</button></fieldset>';
 }
 function editorHTML(){
  const runs=catalog?.runs??[];
  return '<form class="joint-editor" data-joint-editor><h2>Design a study</h2>'+
   '<p>Choose documented parameter ranges. Routing stays fixed at the selected baseline; use a separate study for another routing algorithm. Independent marginals are exploratory assumptions.</p>'+
   '<div class="joint-grid"><label>Study title<input name="title" value="'+esc(draft.title)+'" required></label>'+
   '<label>Completed native baseline<select name="baseline_run_id" required><option value="">Select an original baseline</option>'+
   runs.map(run=>'<option value="'+esc(run.id)+'"'+(run.id===draft.baseline_run_id?' selected':'')+'>'+
      esc(short(run.id)+' · profile '+short(run.selection.profile_id)+' · '+(run.selection.models??['ndr','sdr']).join('/'))+'</option>').join('')+
   '</select></label></div><label>Scientific question<textarea name="reason" required>'+esc(draft.reason)+'</textarea></label>'+
   '<label>Land-cover scenarios<select name="scenario_ids" multiple size="4">'+
   (catalog?.scenarios??[]).filter(row=>row.kind!=='baseline').map(row=>'<option value="'+esc(row.id)+'"'+
     (draft.scenario_ids.includes(row.id)?' selected':'')+'>'+esc(row.title||short(row.id))+'</option>').join('')+
   '</select><small>Each alternative uses the matching sampled profile baseline.</small></label>'+
   '<div data-joint-axes>'+draft.axes.map(axisHTML).join('')+'</div>'+
   '<button type="button" data-joint-command="add-axis">Add numeric axis</button>'+
   '<h3>Independent replicate designs</h3><p>Each explicit seed creates a separate Latin hypercube. Sample count is per replicate. The preview shows the complete native workload before saving.</p>'+
   '<div data-joint-replicates>'+draft.replicates.map((row,index)=>
    '<fieldset data-replicate="'+index+'"><legend>Replicate '+(index+1)+'</legend><div class="joint-grid">'+
    '<label>ID<input data-field="id" value="'+esc(row.id)+'" required></label>'+
    '<label>Samples<input data-field="samples" type="number" min="1" step="1" value="'+esc(row.samples)+'" required></label>'+
    '<label>Seed<input data-field="seed" type="number" min="0" step="1" value="'+esc(row.seed)+'" required></label></div>'+
    '<button type="button" data-joint-command="remove-replicate" data-index="'+index+'">Remove replicate</button></fieldset>').join('')+
   '</div><div class="joint-actions"><button type="button" data-joint-command="add-replicate">Add replicate</button>'+
   '<button type="button" data-joint-command="preview">Preview complete design</button>'+
   '<button type="button" data-joint-command="prepare"'+(!candidate||pending?' disabled':'')+'>Save preview and prepare profiles</button>'+
   '<button type="button" data-joint-command="export-draft">Download specification</button>'+
   '<label class="joint-import">Import specification<input data-joint-import type="file" accept=".json,application/json"></label></div>'+
   '</form>';
 }
 function capture(){
  const form=root?.querySelector('[data-joint-editor]');if(!form)return;
  const sourceRuns=draft.source_run_ids;
  draft={title:form.elements.title.value,reason:form.elements.reason.value,
    baseline_run_id:form.elements.baseline_run_id.value,
    scenario_ids:[...form.elements.scenario_ids.selectedOptions].map(option=>option.value),
    axes:[...form.querySelectorAll('[data-axis]')].map(row=>Object.fromEntries(
      [...row.querySelectorAll('[data-field]')].map(field=>[field.dataset.field,
        field.multiple?[...field.selectedOptions].map(option=>option.value):field.value]))),
    replicates:[...form.querySelectorAll('[data-replicate]')].map(row=>Object.fromEntries(
      [...row.querySelectorAll('[data-field]')].map(field=>[field.dataset.field,field.value])))};
  if(Array.isArray(sourceRuns))draft.source_run_ids=copy(sourceRuns);
 }
 function specification(){
  capture();
  const form=root.querySelector('[data-joint-editor]');
  if(!form.reportValidity())throw Error('Complete each selected parameter range, reference and replicate.');
  return {schema:'upstate.joint-parameter-design/v1',...copy(draft),
   axes:draft.axes.map(axis=>({...axis,lower:Number(axis.lower),upper:Number(axis.upper),
       references:axis.references.split(/\r?\n/).map(text=>text.trim()).filter(Boolean)})),
   replicates:draft.replicates.map(row=>({...row,samples:Number(row.samples),seed:Number(row.seed)}))};
 }
 function showCandidate(){
  const node=root?.querySelector('[data-joint-preview]');if(!node)return;
  if(!candidate){node.innerHTML='';return;}
  const definition=candidate.definition;
  node.innerHTML='<h2>Frozen candidate</h2><p><strong>'+number(candidate.sample_count)+' sampled profiles</strong>; '+
    number(candidate.requested_native_cases)+' requested native cases before exact reuse. Study <code>'+esc(candidate.id)+'</code>.</p>'+
    '<p>Sampler: '+esc(definition.sampler.implementation)+' · SciPy '+esc(definition.sampler.scipy_version)+
    ' · NumPy '+esc(definition.sampler.numpy_version)+'. All coordinates, transformations and original source bindings are retained.</p>'+
    '<button type="button" data-joint-command="download-preview">Download complete design</button>'+
    '<div class="joint-scroll"><table><caption>First '+Math.min(20,definition.samples.length)+' samples; the download contains every sample.</caption><thead><tr><th>Replicate / sample</th>'+
    definition.specification.axes.map(axis=>'<th>'+esc(axis.label)+' ('+esc(axis.units)+')</th>').join('')+'</tr></thead><tbody>'+
    definition.samples.slice(0,20).map(sample=>'<tr><th>'+esc(sample.replicate_id)+' / '+(sample.ordinal+1)+'</th>'+
      definition.specification.axes.map(axis=>'<td>'+number(sample.values[axis.id])+'</td>').join('')+'</tr>').join('')+
    '</tbody></table></div>';
 }
 function showSaved(){
  const node=root?.querySelector('[data-joint-saved]');if(!node)return;
  const studies=host.getState()?.data?.joint_parameter_studies??catalog?.studies??[];
  node.innerHTML='<h2>Retained studies</h2>'+(studies.length?'<ul class="joint-saved">'+studies.map(row=>
   '<li><button type="button" data-joint-command="open" data-id="'+esc(row.id)+'">'+esc(row.title||short(row.id))+
   '</button><span>'+esc(row.state)+' · '+number(row.sample_count)+' samples</span></li>').join('')+'</ul>':
   '<p>No joint study has been prepared in this workspace.</p>');
 }
 function showActive(){
  const node=root?.querySelector('[data-joint-active]');if(!node)return;
  if(!active){node.innerHTML='';return;}
  const rows=active.definition.specification.replicates;
  node.innerHTML='<h2>'+esc(active.definition.specification.title)+'</h2><p>'+esc(active.definition.specification.reason)+'</p>'+
   '<p>State: <strong>'+esc(active.state)+'</strong> · '+number(active.prepared_samples)+' / '+number(active.sample_count)+
   ' mapped samples · '+rows.length+' replicate design'+(rows.length===1?'':'s')+'.</p>'+
   '<p>Study <code>'+esc(active.id)+'</code></p>'+
   '<div class="joint-actions"><button type="button" data-joint-command="run">Run or resume original native cases</button>'+
   '<button type="button" data-joint-command="analyze">Analyze currently completed cases</button>'+
   '<button type="button" data-joint-command="transfer">Export editable study</button>'+
   '<button type="button" data-joint-command="revise">New design from this selection</button></div>'+
   (active.analysis?'<p>Analysis: '+esc(active.analysis.state)+'. Grouped by replicate, scenario, units and exact paired spatial support. Open the report to inspect completion, rank and held-out diagnostics.</p>':'')+
   (active.native_summary?'<p>Native cases: '+esc(JSON.stringify(active.native_summary.progress??{}))+'</p>':'')+
   '<div class="joint-downloads">'+host.fileList(active._downloads??[])+'</div>';
 }
 function render(){
  if(!root)return;
  root.innerHTML='<div class="joint-parameters"><header class="page-header"><div><h1>Joint parameter studies</h1>'+
   '<p>Explore sourced ranges together using the retained native model and explicit Latin-hypercube designs.</p></div>'+
   '<div class="joint-actions"><button type="button" data-joint-command="reload">Refresh original sources</button>'+
   '<button type="button" data-joint-command="retry"'+(!pending?' hidden':'')+'>Recover original submitted request</button></div></header>'+
   '<div data-joint-message aria-live="polite"></div><section class="panel" data-joint-active></section>'+
   '<section class="panel" data-joint-saved></section><section class="panel">'+editorHTML()+'</section>'+
   '<section class="panel" data-joint-preview></section></div>';
  root.querySelector('[data-joint-editor]').addEventListener('submit',event=>event.preventDefault());
  showSaved();showActive();showCandidate();message();
 }
 async function loadCatalog(){
  const token=generation;catalog=await read('catalog');if(!selected(token))return;
  render();
 }
 async function open(id){
  const token=generation;const value=await read('inspect',{study_id:id});
  if(!selected(token))return;active=value;await persist();showActive();message();
 }
 async function submit(action,payload){
  if(pending)throw Error('Recover the original pending request before preparing another action.');
  pending={workspace,action,payload:copy(payload),operation_id:crypto.randomUUID()};
  await persist();return recover();
 }
 async function recover(){
  if(!pending)throw Error('There is no retained request to recover.');
  await persist();
  const request=copy(pending),token=generation;
  if(request.workspace!==workspace)throw Error('Reopen the workspace that owns this original request.');
  let result;
  try{result=await host.api('/api/actions',{method:'POST',body:request});}
  catch(failure){
   if(selected(token)&&[400,422].includes(failure.status)&&rejectedBeforeDispatch.has(failure.code)){
    pending=null;await persist();
   }
   throw failure;
  }
  if(!result||!/^[0-9a-f]{64}$/.test(result.id??'')||result.workspace!==request.workspace||result.action!==request.action||encode(result.payload)!==encode(request.payload))throw Error('The operator acknowledgment does not identify this original task. Recover the same retained request.');
  if(!selected(token))return;
  pending=null;await persist();
  notice='Original request accepted. Task '+result.id+' retains its progress and recovery controls.';
  message();await host.refreshState();await host.showTask(result.id);return result;
 }
 async function command(button){
  const action=button.dataset.jointCommand;
  capture();error='';notice='';
  if(busy)return;
  let selectedSpecification;
  try{if(action==='preview'||action==='export-draft')selectedSpecification=specification();}
  catch(failure){error=failure.message;message();return;}
  busy=true;message();const token=generation;
  try{
   if(action==='add-axis'){draft.axes.push({...blank().axes[0],id:'axis-'+crypto.randomUUID().slice(0,8)});candidate=null;render();}
   else if(action==='remove-axis'){draft.axes.splice(Number(button.dataset.index),1);candidate=null;render();}
   else if(action==='add-replicate'){draft.replicates.push({id:'replicate-'+crypto.randomUUID().slice(0,8),samples:'',seed:''});candidate=null;render();}
   else if(action==='remove-replicate'){draft.replicates.splice(Number(button.dataset.index),1);candidate=null;render();}
   else if(action==='preview'){
    const spec=selectedSpecification,key=workspace;
    const value=await host.api(host.endpoint('/api/joint-parameters/preview'),{method:'POST',body:{workspace,specification:spec}});
    if(!selected(token)||workspace!==key)return;candidate=value;showCandidate();
   }
   else if(action==='prepare'){if(!candidate)throw Error('Preview the current complete design first.');
    await submit('joint-study.prepare',{definition:candidate.definition});}
   else if(action==='retry')await recover();
   else if(action==='open')await open(button.dataset.id);
   else if(action==='run'||action==='analyze'){
    if(!active)throw Error('Open a retained joint study first.');
    await submit(action==='run'?'joint-study.run':'joint-study.analyze',{study_id:active.id});
   }
   else if(action==='reload')await loadCatalog();
   else if(action==='download-preview'){if(candidate)download('Joint_Parameter_Design.json',candidate);}
   else if(action==='export-draft')download('Joint_Parameter_Specification.json',selectedSpecification);
   else if(action==='transfer'){
    if(!active)throw Error('Open a retained study first.');
    await host.openExtension('study-transfer','openForStudies',[{kind:'joint-parameter-studies',id:active.id}]);
   }
   else if(action==='revise'){
    const spec=copy(active.definition.specification);draft={...spec,axes:spec.axes.map(axis=>({...axis,references:axis.references.join('\n')}))};
    candidate=null;render();
   }
   if(selected(token))await persist();
  }catch(failure){if(selected(token)){error=failure.message||String(failure);message();}}
  finally{if(selected(token)){busy=false;message();}}
 }
 function onClick(event){const button=event.target.closest('[data-joint-command]');if(button&&root?.contains(button)){event.preventDefault();void command(button);}}
 function onInput(event){
  if(!root?.querySelector('[data-joint-editor]')?.contains(event.target)||event.target.matches('[data-joint-import]'))return;
  capture();candidate=null;showCandidate();message();
  void persist().catch(failure=>{error='Draft retention: '+failure.message;message();});
 }
 async function onChange(event){
  if(event.target.matches('[data-field="paths"]')){
   const row=event.target.closest('[data-axis]'),paths=[...event.target.selectedOptions].map(option=>option.value);
   const units=[...new Set(paths.map(path=>catalog.axes[path].units))];
   if(units.length===1)row.querySelector('[data-field="units"]').value=units[0];
   onInput(event);
  }
  if(!event.target.matches('[data-joint-import]'))return;
  if(busy)return;
  busy=true;message();const token=generation;
  try{
   const value=JSON.parse(await event.target.files[0].text());
   const spec=value.definition?.specification??value.specification??value;
   if(spec.schema!=='upstate.joint-parameter-design/v1'||!Array.isArray(spec.axes)||!Array.isArray(spec.replicates))throw Error('Choose a complete original specification or frozen design.');
   const imported=await host.api(host.endpoint('/api/joint-parameters/preview'),{method:'POST',body:{workspace,specification:spec}});
   if(!selected(token))return;
   const normalized=imported.definition.specification;
   draft={...copy(normalized),axes:normalized.axes.map(axis=>({...axis,references:axis.references.join('\n')}))};
   candidate=imported;await persist();render();
  }catch(failure){if(selected(token)){error=failure.message;message();}}
  finally{if(selected(token)){busy=false;message();}}
 }
 async function mount(node,state=host.getState()){
  detach();root=node;workspace=state.workspace_key;const token=generation;
  root.addEventListener('click',onClick);root.addEventListener('input',onInput);root.addEventListener('change',onChange);
  root.innerHTML='<p role="status">Opening original joint studies and retained draft…</p>';
  try{
   await saveTail.catch(()=>{});
   const saved=await retained(workspace);if(!selected(token))return;
   if(saved?.schema==='upstate.joint-parameter-browser/v1'){
    draft=saved.draft??blank();candidate=saved.candidate??null;pending=saved.pending??null;
   }else{draft=blank();candidate=null;pending=null;}
   loaded=true;await loadCatalog();
   if(saved?.active_id&&selected(token))await open(saved.active_id);
  }catch(failure){if(selected(token)){error=failure.message;loaded=true;render();}}
 }
 function update(state=host.getState()){
  if(!root||state.workspace_key!==workspace||!loaded)return;
  showSaved();
  const tasks=Array.isArray(state.tasks)?state.tasks:state.tasks?.tasks??[];
  const stamp=JSON.stringify(tasks.filter(task=>task.action?.startsWith('joint-study.')).map(task=>[task.id,task.state,task.updated_at]));
  if(stamp!==lastStamp&&!busy){lastStamp=stamp;if(active)void open(active.id).catch(failure=>{error=failure.message;message();});}
 }
 function detach(){
  if(root){root.removeEventListener('click',onClick);root.removeEventListener('input',onInput);root.removeEventListener('change',onChange);}
  generation++;root=null;workspace=null;catalog=null;active=null;loaded=false;busy=false;error='';notice='';
 }
 return {mount,update,detach};
}
