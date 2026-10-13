/* Original-operator ensemble panel. No model execution or provider credentials. */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fragment = new URLSearchParams(location.hash.slice(1));
let capability = fragment.get('token') || sessionStorage.getItem('upstate-operator-capability');
if(fragment.has('token')){sessionStorage.setItem('upstate-operator-capability',capability);history.replaceState(null,'',location.pathname);}
let workspace = sessionStorage.getItem('upstate-selected-workspace');
let state, pairs=[], selected=new Set(), busy=false, timer, lastRequest, pendingOperation;
const storageKey=()=>`upstate-paired-ensemble-request:${workspace}`;
async function api(path,{method='GET',body,raw,filename}={}){
  const headers={Authorization:'Bearer '+capability};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(filename)headers['X-Upload-Filename']=encodeURIComponent(filename);
  const response=await fetch(path,{method,headers,credentials:'same-origin',body:raw??(body===undefined?undefined:JSON.stringify(body))});
  let value;try{value=await response.json();}catch{throw new Error(`Unreadable operator response (${response.status})`);}
  if(!response.ok)throw new Error(value.error?.message||`Operator response ${response.status}`);
  return value;
}
function fail(error){$('#error').textContent=error.message||String(error);$('#error').hidden=false;}
function clear(){ $('#error').hidden=true; }
function saveRequest(value,operation){lastRequest=value;pendingOperation=operation;sessionStorage.setItem(storageKey(),JSON.stringify({selection:value,operation}));$('#recovery').hidden=false;}
function restoreRequest(){const value=sessionStorage.getItem(storageKey());lastRequest=null;pendingOperation=null;if(value){try{const record=JSON.parse(value);lastRequest=record.selection;pendingOperation=record.operation;}catch{}}$('#recovery').hidden=!lastRequest;}
function name(kind,id){return state?.data[kind]?.find(x=>x.id===id)?.title||id?.slice(0,14)||'Unknown';}
function options(node,kind){const previous=node.value;node.innerHTML=(state.data[kind]||[]).map(x=>`<option value="${esc(x.id)}">${esc(x.title||x.spec?.title||x.id.slice(0,14))}</option>`).join('');if([...node.options].some(x=>x.value===previous))node.value=previous;}
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
      const after=group.alternative.find(run=>run.selection.invest_version===before.selection.invest_version);
      if(after){
        selectedPairs.push({profile_id:profile,baseline_run_id:before.id,alternative_run_id:after.id,scenario_id:alternative});
        break;
      }
    }
  }
  return selectedPairs.sort((a,b)=>a.profile_id.localeCompare(b.profile_id));
}
let pairContrast=null;
function pairRows(){
  const baseline=$('#baseline').value, alternative=$('#alternative').value,grid=$('#grid').value;
  const pollutants=[...document.querySelectorAll('#pollutants input:checked')].map(input=>input.value);
  const contrast=JSON.stringify([grid,baseline,alternative]), previousProfiles=new Set(pairs.map(pair=>pair.profile_id));
  const previousSelection=new Set(selected);
  pairs=pairedRuns(state?.data.runs||[],grid,baseline,alternative,pollutants);
  selected=new Set(pairs.filter(pair=>contrast!==pairContrast||!previousProfiles.has(pair.profile_id)||previousSelection.has(pair.profile_id)).map(pair=>pair.profile_id));
  pairContrast=contrast;
  $('#planned').value=Math.max(Number($('#planned').value)||1,pairs.length);
  const requestedProfiles=new Set((state?.data.runs||[]).filter(r=>r.selection.grid_id===grid&&[baseline,alternative].includes(r.selection.scenario_id)).map(r=>r.selection.profile_id));
  const missing=[...requestedProfiles].filter(id=>!selected.has(id));
  $('#planned').value=Math.max(Number($('#planned').value)||1,requestedProfiles.size);
  $('#pair-status').textContent=`${pairs.length} complete profile-matched pairs cover the selected quantities on this grid. ${missing.length} additional profiles need a completed matching pair with those outputs.`+(missing.length?' Profiles: '+missing.map(id=>name('profiles',id)).join('; '):'');
  $('#pairs').innerHTML=pairs.length?'<table><thead><tr><th>Include</th><th>Original parameter profile</th><th>Baseline run</th><th>Alternative run</th></tr></thead><tbody>'+pairs.map(p=>`<tr><td><input aria-label="Include ${esc(name('profiles',p.profile_id))}" type="checkbox" ${selected.has(p.profile_id)?'checked':''} data-profile="${p.profile_id}"></td><th>${esc(name('profiles',p.profile_id))}<br><code>${p.profile_id}</code></th><td><code>${p.baseline_run_id}</code></td><td><code>${p.alternative_run_id}</code></td></tr>`).join('')+'</tbody></table>':'<p>Choose distinct scenarios and the quantities available in their completed runs. Existing native run programmes prepare and execute matching profiles.</p>';
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
  const planned=Number($('#planned').value),memory=Number($('#memory').value);
  if(!Number.isSafeInteger(planned)||planned<chosen.length)throw new Error('The planned profile count must be a whole number at least as large as the selected pairs.');
  if(!Number.isFinite(memory)||memory<1)throw new Error('Select a positive tile working budget of at least one MiB.');
  return {title,purpose,pairs:chosen,pollutants,quantiles,support:$('#support').value,planned_member_count:planned,memory_mb:memory};
}
async function inspect(){clear();try{const value=selection();const result=await api('/api/paired-ensemble/preview',{method:'POST',body:{workspace,selection:value}});$('#preview-result').textContent=JSON.stringify(result,null,2);$('#preview-result').hidden=false;}catch(e){fail(e);}}
async function submit(action,value,operation){
  const record=operation||{id:crypto.randomUUID(),action};
  if(record.action!==action)throw new Error('Saved request action differs.');
  if(action==='paired_ensemble.build'||action==='paired_ensemble.resume')saveRequest(value,record);
  const task=await api('/api/actions',{method:'POST',body:{workspace,action,payload:value,operation_id:record.id}});
  $('#progress').textContent=`${task.state}: ${task.id.slice(0,14)}`;
  schedule(task.id);return task;
}
async function build(resume=false){clear();try{let value;if(resume){if(!lastRequest)throw new Error('No saved ensemble selection exists for this workspace.');value=lastRequest;}else value=selection();await submit(resume?'paired_ensemble.resume':'paired_ensemble.build',value,!resume&&pendingOperation?.action==='paired_ensemble.build'&&JSON.stringify(lastRequest)===JSON.stringify(value)?pendingOperation:null);}catch(e){fail(e);}}
function schedule(id){clearTimeout(timer);timer=setTimeout(()=>pollTask(id).catch(fail),2200);}
async function pollTask(id){
  const task=await api('/api/task?id='+encodeURIComponent(id));
  $('#progress').textContent=`${task.action}: ${task.state}${task.error?' · '+task.error.message:''}`;
  if(['queued','running'].includes(task.state)){
    if(task.action==='paired_ensemble.build'||task.action==='paired_ensemble.resume'){
      const progress=await api('/api/paired-ensemble/progress?'+new URLSearchParams({workspace,task_id:task.id}));
      if(progress.phase)$('#progress').textContent=`${task.action}: ${progress.phase} ${progress.complete} / ${progress.total}`;
    }
    schedule(id);
  }else await refresh(false);
}
async function refresh(reset=true){
  if(busy)return;busy=true;clear();
  try{
    if(!capability)throw new Error('Open the original operator startup URL in this tab first.');
    await api('/api/session',{method:'POST',body:{}});
    const result=await api('/api/state'+(workspace?'?workspace='+encodeURIComponent(workspace):''));
    const changed=result.workspace_key!==workspace;state=result;workspace=result.workspace_key;sessionStorage.setItem('upstate-selected-workspace',workspace);
    $('#workspace').innerHTML=result.workspaces.map(x=>`<option value="${x.id}" ${x.id===workspace?'selected':''} ${x.available?'':'disabled'}>${esc(x.title)}</option>`).join('');
    if(reset||changed){options($('#baseline'),'scenarios');options($('#alternative'),'scenarios');options($('#grid'),'grids');if($('#baseline').value===$('#alternative').value&&$('#alternative').options.length>1)$('#alternative').selectedIndex=1;pairRows();restoreRequest();}
    renderResults();
    const tasks=result.tasks.filter(t=>t.action.startsWith('paired_ensemble.')&&['queued','running'].includes(t.state));
    if(tasks.length){const task=tasks[0];$('#progress').textContent=`${task.action}: ${task.state}`;if(task.action==='paired_ensemble.build'||task.action==='paired_ensemble.resume'){const progress=await api('/api/paired-ensemble/progress?'+new URLSearchParams({workspace,task_id:task.id}));if(progress.phase)$('#progress').textContent=`${task.action}: ${progress.phase} ${progress.complete} / ${progress.total}`;}schedule(task.id);}
    else {clearTimeout(timer);const task=result.tasks.find(t=>t.action.startsWith('paired_ensemble.'));if(task){$('#progress').textContent=`${task.action}: ${task.state}${task.error?' · '+task.error.message:''}`;if(task.state==='complete'&&task.action==='paired_ensemble.export'){const detail=await api('/api/task?id='+encodeURIComponent(task.id));showDownloads(detail);}}}
  }finally{busy=false;}
}
function renderResults(){
  const rows=state.data.paired_ensemble_products||[];
  $('#results').innerHTML=rows.map(row=>`<article class="result"><h3>${esc(row.title)}</h3><p>${esc(row.state)} · ${row.members} selected profiles</p><code>${row.id}</code><div class="actions"><button data-open="${row.id}">Open results and source</button><button data-export="${row.id}" ${row.state==='complete'?'':'disabled'}>Export complete project</button></div><div id="detail-${row.id}"></div></article>`).join('')||'<p>No retained ensemble products yet.</p>';
}
function showDownloads(result,target=$('#progress')){const span=document.createElement('span');for(const file of result._downloads||[]){const a=document.createElement('a');a.href=file.url||file.href||('/api/file/'+file.id);a.textContent=file.title||file.filename||'Download complete project';a.style.marginLeft='12px';span.append(a);}target.append(span);}
async function openResult(id){
  const requestedWorkspace=workspace;
  const detail=await api('/api/item?'+new URLSearchParams({workspace,kind:'paired_ensemble_products',id}));
  const target=$('#detail-'+id);
  if(requestedWorkspace!==workspace||!target)return;
  target.replaceChildren();
  if(detail._report_url){
    const link=document.createElement('a');link.href=detail._report_url;link.target='_blank';link.rel='noopener';
    link.textContent='Open complete report';target.append(link);
  }else{
    const message=document.createElement('p');message.textContent='Retained state: '+detail.state+'. Continue the saved calculation to finish its report.';target.append(message);
  }
  const pre=document.createElement('pre');
  pre.textContent=JSON.stringify({state:detail.state,effect_direction:detail.effect_direction,
    coverage:Object.fromEntries(Object.entries(detail.summary||{}).map(([p,s])=>[p,{common_cells:s.common_cells,reporting_cells:s.reporting_cells,units:s.units}]))},null,2);
  target.append(pre);showDownloads(detail,target);
}
$('#refresh').onclick=()=>refresh().catch(fail);$('#preview').onclick=inspect;$('#build').onclick=()=>build();$('#resume').onclick=()=>build(true);
$('#pause').onclick=async()=>{try{if(!lastRequest)throw new Error('Choose the saved running selection.');await api('/api/paired-ensemble/pause',{method:'POST',body:{workspace,selection:lastRequest}});$('#progress').textContent='Pause requested after the current durable tile.';}catch(e){fail(e);}};
$('#workspace').onchange=()=>{workspace=$('#workspace').value;refresh().catch(fail);};
for(const id of ['baseline','alternative','grid'])$('#'+id).onchange=pairRows;
$('#pollutants').onchange=()=>{pairRows();$('#preview-result').hidden=true;};
$('#pairs').onchange=event=>{const id=event.target.dataset.profile;if(id){if(event.target.checked)selected.add(id);else selected.delete(id);}};
$('#results').onclick=async event=>{try{if(event.target.dataset.open)await openResult(event.target.dataset.open);if(event.target.dataset.export)await submit('paired_ensemble.export',{ensemble_id:event.target.dataset.export});}catch(e){fail(e);}};
$('#archive').onchange=async()=>{try{const file=$('#archive').files[0];if(!file)return;const uploaded=await api('/api/upload',{method:'POST',raw:file,filename:file.name});await submit('paired_ensemble.receive',{upload_id:uploaded.id});}catch(e){fail(e);}};
window.addEventListener('pagehide',()=>clearTimeout(timer));
refresh().catch(fail);
