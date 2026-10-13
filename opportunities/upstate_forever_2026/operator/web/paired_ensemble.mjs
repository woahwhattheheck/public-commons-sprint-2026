/* Original-operator ensemble panel. No model execution or provider credentials. */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fragment = new URLSearchParams(location.hash.slice(1));
let capability = fragment.get('token') || sessionStorage.getItem('upstate-operator-capability');
if(fragment.has('token')){sessionStorage.setItem('upstate-operator-capability',capability);history.replaceState(null,'',location.pathname);}

let workspace = sessionStorage.getItem('upstate-selected-workspace');
let state=null, pairs=[], selected=new Set(), missingProfiles=[], timer=null;
let lastRequest=null, pendingOperation=null, pairContrast=null;
let workspaceEpoch=0, refreshRevision=0, previewRevision=0, pollRevision=0, uploadRevision=0, submitRevision=0;
let previewSelection=null;
const drafts=new Map(), exclusions=new Map(), requests=new Map(), resultReads=new Map();
const fieldIds=['title','purpose','baseline','alternative','grid','planned','support','quantiles','memory'];
const defaults=Object.fromEntries(fieldIds.map(id=>[id,$('#'+id).value]));
const defaultPollutants=[...document.querySelectorAll('#pollutants input:checked')].map(node=>node.value);

async function api(path,{method='GET',body,raw,filename}={}){
  const headers={Authorization:'Bearer '+capability};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(filename)headers['X-Upload-Filename']=encodeURIComponent(filename);
  const response=await fetch(path,{method,headers,credentials:'same-origin',body:raw??(body===undefined?undefined:JSON.stringify(body))});
  let value;try{value=await response.json();}catch{throw new Error(`Unreadable operator response (${response.status})`);}
  if(!response.ok)throw new Error(value.error?.message||`Operator response ${response.status}`);
  return value;
}

// All views consume the same retained per-model catalogue as the Python binder.
const producingModel = output => output === 'sediment_export' ? 'sdr' : 'ndr';
function nativeOutputIssue(runs, output) {
  const model=producingModel(output);
  if(!runs.length)return 'Select original native pairs.';
  if(runs.some(run=>!run?.available_pollutants?.includes(output)))
    return 'The output is absent from a selected original run.';
  const versions=runs.map(run=>run.native_model_versions?.[model]?.comparison_version);
  if(versions.some(version=>!version))
    return model.toUpperCase()+' producing version is unavailable in a selected run.';
  const distinct=[...new Set(versions)];
  return distinct.length===1?'':model.toUpperCase()+' producing versions differ: '+distinct.join(' versus ')+'.';
}
function nativeRunLabel(run) {
  const bases={completed_stage_runtime:'completed stage',observed_run_fallback:'observed run fallback',
    requested_legacy:'requested legacy'};
  return Object.entries(run?.native_model_versions||{}).map(([model,info])=>
    model.toUpperCase()+' '+(info.comparison_version||'unavailable')+
    ' ('+(bases[info.basis]||'basis unavailable')+')').join('; ')||'Producing runtime unavailable';
}
function selectedNativeRuns(runs, pairs) {
  const byId=new Map(runs.map(run=>[run.id,run]));
  return pairs.flatMap(pair=>[byId.get(pair.baseline_run_id),byId.get(pair.alternative_run_id)]);
}

function pairedRuns(runs,grid,baseline,alternative,pollutants){
  if(!pollutants.length||baseline===alternative)return [];
  const groups=new Map();
  const required=new Set(pollutants.map(value=>value==='sediment_export'?'sdr':'ndr'));
  const models=run=>Array.isArray(run.selection.models)?run.selection.models:['ndr','sdr'];
  const score=run=>models(run).filter(model=>!required.has(model)).length;
  for(const run of runs){
    const selection=run.selection;
    if(run.state!=='complete'||!selection||selection.grid_id!==grid||
      ![baseline,alternative].includes(selection.scenario_id)||
      !pollutants.every(pollutant=>run.artifacts?.[pollutant])||
      ![...required].every(model=>models(run).includes(model)))continue;
    const group=groups.get(selection.profile_id)||{baseline:[],alternative:[]};
    group[selection.scenario_id===baseline?'baseline':'alternative'].push(run);
    groups.set(selection.profile_id,group);
  }
  const selectedPairs=[];
  for(const[profile,group]of groups){
    const order=(a,b)=>score(a)-score(b)||a.id.localeCompare(b.id);
    group.baseline.sort(order);group.alternative.sort(order);
    for(const before of group.baseline){
      const after=group.alternative.find(run=>pollutants.every(output=>!nativeOutputIssue([before,run],output)));
      if(after){
        selectedPairs.push({profile_id:profile,baseline_run_id:before.id,alternative_run_id:after.id,scenario_id:alternative});
        break;
      }
    }
  }
  return selectedPairs.sort((a,b)=>a.profile_id.localeCompare(b.profile_id));
}
function selection(){
  const title=$('#title').value.trim(),purpose=$('#purpose').value.trim();
  if(!title||!purpose)throw new Error('Give these ensemble results a title and purpose.');
  const parts=$('#quantiles').value.split(',').map(value=>value.trim());
  const quantiles=parts.map(Number);
  if(parts.some(value=>!value)||!quantiles.length||quantiles.some(q=>!Number.isFinite(q)||q<0||q>1)||new Set(quantiles).size!==quantiles.length)
    throw new Error('Enter distinct finite quantiles between zero and one, separated by commas.');
  const chosen=pairs.filter(p=>selected.has(p.profile_id));
  if(!chosen.length)throw new Error('Select at least one complete paired profile.');
  const pollutants=[...document.querySelectorAll('#pollutants input:checked')].map(x=>x.value);
  if(!pollutants.length)throw new Error('Select a physical output.');
  const originalRuns=selectedNativeRuns(state?.data?.runs||[],chosen);
  for(const output of pollutants){const issue=nativeOutputIssue(originalRuns,output);if(issue)throw new Error(issue);}
  const planned=Number($('#planned').value),memory=Number($('#memory').value);
  if(!Number.isSafeInteger(planned)||planned<chosen.length)throw new Error('The planned profile count must be a whole number at least as large as the selected pairs.');
  if(!Number.isFinite(memory)||memory<1)throw new Error('Select a positive tile working budget of at least one MiB.');
  return {title,purpose,pairs:chosen,pollutants,quantiles,support:$('#support').value,planned_member_count:planned,memory_mb:memory};
}
function scope(){return {workspace,epoch:workspaceEpoch};}
function current(context){return context.epoch===workspaceEpoch&&context.workspace===workspace;}
function storageKey(key=workspace){return `upstate-paired-ensemble-request:${key}`;}
function draftKey(key=workspace){return `upstate-paired-ensemble-draft:${key}`;}
function fail(error,context){if(context&&!current(context))return;$('#error').textContent=error.message||String(error);$('#error').hidden=false;}
function clear(){$('#error').hidden=true;}
function copy(value){return JSON.parse(JSON.stringify(value));}
function recovery(){
  $('#recovery').hidden=!lastRequest;
  if(lastRequest)$('#recovery').textContent='A saved request is retained for this workspace. Resume uses that exact selection; new form edits create a new build.'+
    (pendingOperation?.task_id?' Original task: '+pendingOperation.task_id+'.':'');
}
function retainedRequest(key){
  if(!requests.has(key)){
    let record=null;
    try{const raw=sessionStorage.getItem(storageKey(key));if(raw)record=JSON.parse(raw);}catch(_){}
    if(!record||!record.selection||!record.operation?.id||!record.operation?.action)record=null;
    requests.set(key,record);
  }
  return requests.get(key);
}
function writeRequest(record,context){
  requests.set(context.workspace,record);
  sessionStorage.setItem(storageKey(context.workspace),JSON.stringify(record));
  if(current(context)){lastRequest=record.selection;pendingOperation=record.operation;recovery();}
}
function saveRequest(value,operation,context=scope()){
  const record={selection:copy(value),operation:{...operation}};
  writeRequest(record,context);
  return record;
}
function restoreRequest(){
  const record=retainedRequest(workspace);
  lastRequest=record?.selection||null;pendingOperation=record?.operation||null;recovery();
}
function updateOperation(context,operationId,task){
  const record=retainedRequest(context.workspace);
  if(!record||record.operation.id!==operationId)return;
  const updated={selection:record.selection,operation:{...record.operation,task_id:task.id,state:task.state}};
  writeRequest(updated,context);
}
function noteTask(context,task){
  const record=retainedRequest(context.workspace);
  if(record?.operation.task_id===task.id)updateOperation(context,record.operation.id,task);
}
function draftFor(key){
  if(!drafts.has(key)){
    let value=null;
    try{const raw=sessionStorage.getItem(draftKey(key));if(raw)value=JSON.parse(raw);}catch(_){}
    drafts.set(key,value);
  }
  return drafts.get(key);
}
function saveDraft(){
  if(!workspace||state?.workspace_key!==workspace)return;
  const value={fields:Object.fromEntries(fieldIds.map(id=>[id,$('#'+id).value])),
    pollutants:[...document.querySelectorAll('#pollutants input:checked')].map(node=>node.value),
    contrast:pairContrast,excluded:[...(exclusions.get(pairContrast)||[])]};
  drafts.set(workspace,value);
  try{sessionStorage.setItem(draftKey(),JSON.stringify(value));}catch(_){}
}
function invalidateSelection(){
  previewRevision++;previewSelection=null;
  $('#preview-result').hidden=true;
  $('#preview-result').textContent='';
  saveDraft();
}
function name(kind,id){return state?.data?.[kind]?.find(row=>row.id===id)?.title||id?.slice(0,14)||'Unknown';}
function options(node,kind,desired){
  const previous=desired??node.value;
  node.innerHTML=(state?.data?.[kind]||[]).map(row=>`<option value="${esc(row.id)}">${esc(row.title||row.spec?.title||row.id.slice(0,14))}</option>`).join('');
  if([...node.options].some(option=>option.value===previous))node.value=previous;
}
function applyDraft(draft){
  for(const id of fieldIds){
    if(['baseline','alternative','grid'].includes(id))continue;
    const value=draft?.fields?.[id]??defaults[id];
    if(value!==undefined)$('#'+id).value=value;
  }
  const wanted=new Set(draft?.pollutants??defaultPollutants);
  for(const node of document.querySelectorAll('#pollutants input'))node.checked=wanted.has(node.value);
  if(draft?.contrast&&Array.isArray(draft.excluded))exclusions.set(draft.contrast,new Set(draft.excluded));
}
function pairStatus(){
  const excluded=pairs.length-selected.size;
  $('#pair-status').textContent=`${selected.size} selected complete pairs; ${excluded} excluded complete pairs; ${missingProfiles.length} profiles need a completed matching pair for the selected quantities.`+
    (missingProfiles.length?' Missing profiles: '+missingProfiles.map(id=>name('profiles',id)).join('; ')+'.':'')+
    ' Positive change = baseline − alternative: reduced export. Negative change = increased export.'+
    (selected.size?' Producing runtimes: '+[...new Set(selectedNativeRuns(state?.data?.runs||[],pairs.filter(pair=>selected.has(pair.profile_id))).map(nativeRunLabel))].join(' / ')+'.':'');
}
function pairRows(){
  const baseline=$('#baseline').value,alternative=$('#alternative').value,grid=$('#grid').value;
  const pollutants=[...document.querySelectorAll('#pollutants input:checked')].map(input=>input.value);
  pairContrast=JSON.stringify([workspace,grid,baseline,alternative]);
  const excluded=exclusions.get(pairContrast)||new Set();
  exclusions.set(pairContrast,excluded);
  pairs=pairedRuns(state?.data?.runs||[],grid,baseline,alternative,pollutants);
  selected=new Set(pairs.filter(pair=>!excluded.has(pair.profile_id)).map(pair=>pair.profile_id));
  const completeProfiles=new Set(pairs.map(pair=>pair.profile_id));
  const requestedProfiles=new Set((state?.data?.runs||[]).filter(run=>run?.selection?.grid_id===grid&&
    [baseline,alternative].includes(run.selection.scenario_id)).map(run=>run.selection.profile_id));
  missingProfiles=[...requestedProfiles].filter(id=>!completeProfiles.has(id));
  $('#planned').value=Math.max(Number($('#planned').value)||1,pairs.length,requestedProfiles.size);
  pairStatus();
  $('#pairs').innerHTML=pairs.length?'<table><thead><tr><th>Include</th><th>Original parameter profile</th><th>Baseline run</th><th>Alternative run</th></tr></thead><tbody>'+
    pairs.map(pair=>`<tr><td><input aria-label="Include ${esc(name('profiles',pair.profile_id))}" type="checkbox" ${selected.has(pair.profile_id)?'checked':''} data-profile="${esc(pair.profile_id)}"></td><th>${esc(name('profiles',pair.profile_id))}<br><code>${esc(pair.profile_id)}</code></th><td><code>${esc(pair.baseline_run_id)}</code></td><td><code>${esc(pair.alternative_run_id)}</code></td></tr>`).join('')+'</tbody></table>':
    '<p>Choose distinct scenarios and quantities with matching producing model versions in their completed runs. Existing native run programmes prepare and execute matching profiles.</p>';
}
function requireReady(context){
  if(!context.workspace||!current(context)||state?.workspace_key!==context.workspace)
    throw new Error('Wait for the selected workspace to finish opening.');
}
function sameSelection(value){
  try{return JSON.stringify(selection())===JSON.stringify(value);}catch(_){return false;}
}
async function inspect(){
  const context=scope(),revision=++previewRevision;
  clear();previewSelection=null;
  $('#preview-result').hidden=true;$('#preview-result').textContent='';
  try{
    requireReady(context);
    const value=copy(selection());
    const result=await api('/api/paired-ensemble/preview',{method:'POST',body:{workspace:context.workspace,selection:value}});
    if(!current(context)||revision!==previewRevision||!sameSelection(value))return;
    previewSelection=value;
    $('#preview-result').textContent=JSON.stringify(result,null,2);
    $('#preview-result').hidden=false;
  }catch(error){if(revision===previewRevision)fail(error,context);}
}
async function submit(action,value,operation,context=scope()){
  requireReady(context);
  const revision=++submitRevision;
  refreshRevision++;pollRevision++;clearTimeout(timer);
  const payload=copy(value),record=operation?{...operation}:{id:crypto.randomUUID(),action};
  if(record.action!==action)throw new Error('Saved request action differs.');
  const calculation=action==='paired_ensemble.build'||action==='paired_ensemble.resume';
  if(calculation)saveRequest(payload,record,context);
  let task;
  try{
    task=await api('/api/actions',{method:'POST',body:{workspace:context.workspace,action,payload,operation_id:record.id}});
    if(task.workspace&&task.workspace!==context.workspace)throw new Error('The returned task belongs to a different workspace.');
    if(calculation)updateOperation(context,record.id,task);
  }catch(error){
    if(current(context)&&revision===submitRevision)throw error;
    return null;
  }
  if(!current(context)||revision!==submitRevision)return task;
  refreshRevision++;
  $('#progress').textContent=`${task.state}: ${task.id.slice(0,14)}`;
  const polling=++pollRevision;schedule(task.id,context,polling);
  return task;
}
async function build(resume=false){
  const context=scope();clear();
  try{
    requireReady(context);
    const action=resume?'paired_ensemble.resume':'paired_ensemble.build';
    if(resume&&!lastRequest)throw new Error('No saved ensemble selection exists for this workspace.');
    const value=copy(resume?lastRequest:selection());
    const record=retainedRequest(context.workspace);
    const reusable=record?.operation.action===action&&
      !['complete','failed','cancelled','canceled'].includes(record.operation.state)&&
      JSON.stringify(record.selection)===JSON.stringify(value);
    await submit(action,value,reusable?record.operation:null,context);
  }catch(error){fail(error,context);}
}
function schedule(id,context=scope(),revision=++pollRevision){
  clearTimeout(timer);
  if(!current(context)||revision!==pollRevision)return;
  timer=setTimeout(()=>pollTask(id,context,revision).catch(error=>{if(revision===pollRevision)fail(error,context);}),2200);
}
async function pollTask(id,context=scope(),revision=pollRevision){
  const task=await api('/api/task?id='+encodeURIComponent(id));
  if(task.workspace&&task.workspace!==context.workspace)throw new Error('The retained task belongs to a different workspace.');
  noteTask(context,task);
  if(!current(context)||revision!==pollRevision)return;
  $('#progress').textContent=`${task.action}: ${task.state}${task.error?' · '+task.error.message:''}`;
  if(['queued','running'].includes(task.state)){
    if(task.action==='paired_ensemble.build'||task.action==='paired_ensemble.resume'){
      const progress=await api('/api/paired-ensemble/progress?'+new URLSearchParams({workspace:context.workspace,task_id:task.id}));
      if(!current(context)||revision!==pollRevision)return;
      if(progress.phase)$('#progress').textContent=`${task.action}: ${progress.phase} ${progress.complete} / ${progress.total}`;
    }
    schedule(id,context,revision);
  }else await refresh(false);
}
async function refresh(reset=true){
  const context=scope(),revision=++refreshRevision;
  const isLatest=()=>current(context)&&revision===refreshRevision;
  clear();
  try{
    if(!capability)throw new Error('Open the original operator startup URL in this tab first.');
    await api('/api/session',{method:'POST',body:{}});
    if(!isLatest())return;
    const result=await api('/api/state'+(context.workspace?'?workspace='+encodeURIComponent(context.workspace):''));
    if(!isLatest())return;
    if(context.workspace&&result.workspace_key!==context.workspace)throw new Error('The operator returned a different workspace.');
    if(state?.workspace_key===workspace)saveDraft();
    workspace=result.workspace_key;context.workspace=workspace;
    state=result;sessionStorage.setItem('upstate-selected-workspace',workspace);
    $('#workspace').innerHTML=(result.workspaces||[]).map(row=>`<option value="${esc(row.id)}" ${row.id===workspace?'selected':''} ${row.available?'':'disabled'}>${esc(row.title)}</option>`).join('');
    $('#workspace').value=workspace;
    const draft=draftFor(workspace);
    applyDraft(draft);
    options($('#baseline'),'scenarios',draft?.fields?.baseline);
    options($('#alternative'),'scenarios',draft?.fields?.alternative);
    options($('#grid'),'grids',draft?.fields?.grid);
    if(!draft&&$('#baseline').value===$('#alternative').value&&$('#alternative').options.length>1)$('#alternative').selectedIndex=1;
    pairRows();restoreRequest();saveDraft();renderResults();
    if(previewSelection&&!sameSelection(previewSelection))invalidateSelection();
    const tasks=(result.tasks||[]).filter(task=>task.action?.startsWith('paired_ensemble.'));
    for(const task of tasks)noteTask(context,task);
    const active=tasks.find(task=>['queued','running'].includes(task.state));
    if(active){
      $('#progress').textContent=`${active.action}: ${active.state}`;
      const polling=++pollRevision;
      schedule(active.id,context,polling);
      if(active.action==='paired_ensemble.build'||active.action==='paired_ensemble.resume'){
        const progress=await api('/api/paired-ensemble/progress?'+new URLSearchParams({workspace:context.workspace,task_id:active.id}));
        if(!isLatest()||polling!==pollRevision)return;
        if(progress.phase)$('#progress').textContent=`${active.action}: ${progress.phase} ${progress.complete} / ${progress.total}`;
      }
    }else{
      clearTimeout(timer);pollRevision++;
      const task=tasks[0];
      $('#progress').textContent=task?`${task.action}: ${task.state}${task.error?' · '+task.error.message:''}`:'';
      if(task?.state==='complete'&&task.action==='paired_ensemble.export'){
        const detail=await api('/api/task?id='+encodeURIComponent(task.id));
        if(isLatest())showDownloads(detail);
      }
    }
  }catch(error){if(isLatest())fail(error,context);}
}
function renderResults(){
  const rows=state?.data?.paired_ensemble_products||[];
  $('#results').innerHTML=rows.map(row=>`<article class="result"><h3>${esc(row.title)}</h3><p>${esc(row.state)} · ${row.members} selected profiles</p><code>${esc(row.id)}</code><div class="actions"><button data-open="${esc(row.id)}">Open results and source</button><button data-export="${esc(row.id)}" ${row.state==='complete'?'':'disabled'}>Export complete project</button></div><div id="detail-${esc(row.id)}"></div></article>`).join('')||'<p>No retained ensemble products yet.</p>';
}
function showDownloads(result,target=$('#progress')){
  const span=document.createElement('span');
  for(const file of result._downloads||[]){
    const link=document.createElement('a');
    link.href=file.url||file.href||('/api/file/'+file.id);
    link.textContent=file.title||file.filename||'Download complete project';
    link.style.marginLeft='12px';span.append(link);
  }
  target.append(span);
}
async function openResult(id){
  const context=scope(),request=(resultReads.get(id)||0)+1;resultReads.set(id,request);
  requireReady(context);
  const detail=await api('/api/item?'+new URLSearchParams({workspace:context.workspace,kind:'paired_ensemble_products',id}));
  const target=$('#detail-'+id);
  if(!current(context)||resultReads.get(id)!==request||!target)return;
  target.replaceChildren();
  if(detail._report_url){
    const link=document.createElement('a');link.href=detail._report_url;link.target='_blank';link.rel='noopener';
    link.textContent='Open complete report';target.append(link);
  }else{
    const message=document.createElement('p');message.textContent='Retained state: '+detail.state+'. Continue the saved calculation to finish its report.';target.append(message);
  }
  const direction=document.createElement('p');direction.textContent='Positive change = baseline − alternative: reduced export. Negative change = increased export.';target.append(direction);
  const pre=document.createElement('pre');
  pre.textContent=JSON.stringify({state:detail.state,effect_direction:detail.effect_direction,
    coverage:Object.fromEntries(Object.entries(detail.summary||{}).map(([pollutant,value])=>[pollutant,{common_cells:value.common_cells,reporting_cells:value.reporting_cells,units:value.units}]))},null,2);
  target.append(pre);showDownloads(detail,target);
}
async function switchWorkspace(next){
  if(next===workspace)return refresh();
  saveDraft();
  workspaceEpoch++;refreshRevision++;previewRevision++;pollRevision++;uploadRevision++;submitRevision++;previewSelection=null;
  clearTimeout(timer);
  workspace=next;state=null;pairs=[];selected=new Set();missingProfiles=[];pairContrast=null;
  sessionStorage.setItem('upstate-selected-workspace',workspace);
  $('#preview-result').hidden=true;$('#preview-result').textContent='';
  $('#pairs').innerHTML='';$('#results').innerHTML='';$('#pair-status').textContent='Opening selected workspace…';
  $('#progress').textContent='';$('#archive').value='';
  restoreRequest();
  return refresh();
}
async function receiveArchive(file){
  const context=scope(),revision=++uploadRevision;
  clear();
  try{
    if(!file)return;
    requireReady(context);
    const uploaded=await api('/api/upload',{method:'POST',raw:file,filename:file.name});
    if(!current(context)||revision!==uploadRevision||$('#archive').files[0]!==file)return;
    await submit('paired_ensemble.receive',{upload_id:uploaded.id},null,context);
  }catch(error){if(revision===uploadRevision)fail(error,context);}
}
$('#refresh').onclick=()=>refresh();
$('#preview').onclick=inspect;
$('#build').onclick=()=>build();
$('#resume').onclick=()=>build(true);
$('#pause').onclick=async()=>{
  const context=scope();clear();
  try{
    requireReady(context);
    if(!lastRequest)throw new Error('Choose the saved running selection.');
    const value=copy(lastRequest);
    await api('/api/paired-ensemble/pause',{method:'POST',body:{workspace:context.workspace,selection:value}});
    if(current(context))$('#progress').textContent='Pause requested after the current durable tile.';
  }catch(error){fail(error,context);}
};
$('#workspace').onchange=()=>switchWorkspace($('#workspace').value);
for(const id of ['baseline','alternative','grid'])$('#'+id).onchange=()=>{pairRows();invalidateSelection();};
$('#pollutants').onchange=()=>{pairRows();invalidateSelection();};
for(const id of ['title','purpose','planned','support','quantiles','memory']){
  $('#'+id).oninput=invalidateSelection;$('#'+id).onchange=invalidateSelection;
}
$('#pairs').onchange=event=>{
  const id=event.target.dataset.profile;
  if(!id||!pairs.some(pair=>pair.profile_id===id))return;
  const excluded=exclusions.get(pairContrast)||new Set();
  if(event.target.checked){selected.add(id);excluded.delete(id);}else{selected.delete(id);excluded.add(id);}
  exclusions.set(pairContrast,excluded);pairStatus();invalidateSelection();
};
$('#results').onclick=async event=>{
  const context=scope();
  try{
    if(event.target.dataset.open)await openResult(event.target.dataset.open);
    if(event.target.dataset.export)await submit('paired_ensemble.export',{ensemble_id:event.target.dataset.export},null,context);
  }catch(error){fail(error,context);}
};
$('#archive').onchange=()=>receiveArchive($('#archive').files[0]);
window.addEventListener('pagehide',()=>{
  saveDraft();workspaceEpoch++;refreshRevision++;previewRevision++;pollRevision++;uploadRevision++;submitRevision++;clearTimeout(timer);
});
refresh();
