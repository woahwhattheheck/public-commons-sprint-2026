let panelTemplate=null;
async function template(){
 if(!panelTemplate)panelTemplate=fetch('/web/scenario-footprint.html',{credentials:'same-origin'})
  .then(response=>{if(!response.ok)throw Error('Unable to open the installed footprint panel.');return response.text();})
  .then(text=>{const doc=new DOMParser().parseFromString(text,'text/html');const main=doc.querySelector('main');if(!main)throw Error('The installed footprint panel has no main view.');return main.outerHTML;})
  .catch(error=>{panelTemplate=null;throw error;});
 return panelTemplate;
}

/** ECSA controller: one retained run selection, original API, isolated panel lifecycle. */
export function createScenarioFootprint(host){
 let controller=null,generation=0,selectedWorkspace=null,request=null;
 const workspace=()=>host.getWorkspace?.()||host.getState()?.workspace_key;
 function detach(){generation++;controller?.detach();controller=null;}
 async function mount(node,state){
  detach();const current=generation,key=workspace();selectedWorkspace=key;
  const html=await template();if(current!==generation||key!==workspace())return;
  const surface=document.createElement('div');surface.className='scenario-footprint-host';
  const shadow=surface.attachShadow({mode:'open'});
  shadow.innerHTML='<link rel="stylesheet" href="/web/scenario-footprint.css"><div class="footprint-surface embedded">'+html+'</div>';
  node.replaceChildren(surface);
  controller=attachPanel(shadow,host,request?.workspace===key?request.id:'');
  await controller.start();
 }
 function update(state){if(controller&&workspace()===selectedWorkspace)controller.update(state);}
 function openRun(runId){
  if(!/^[a-f0-9]{64}$/.test(String(runId)))throw Error('Select the complete retained native run ID.');
  request={workspace:workspace(),id:String(runId)};controller?.selectRun(request.id);
  host.navigate?.('scenario-footprint');
 }
 return {mount,update,detach,openRun};
}

function attachPanel(root,host=null,requestedRun=''){
const $=s=>root.querySelector(s);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=x=>Number(x??0).toLocaleString(undefined,{maximumFractionDigits:4});
const short=x=>String(x??'').slice(0,12);
const table=(heads,rows)=>'<div class="table-scroll"><table><thead><tr>'+heads.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const fragment=new URLSearchParams(host?'':location.hash.slice(1)),query=new URLSearchParams(location.search);
let token=host?null:fragment.get('token')||sessionStorage.getItem('upstate-operator-capability');
if(fragment.get('token')){sessionStorage.setItem('upstate-operator-capability',token);history.replaceState(null,'',location.pathname+location.search);}
let workspace=host?(host.getWorkspace?.()||host.getState()?.workspace_key):sessionStorage.getItem('upstate-selected-workspace'),catalog=null,offset=0,task=null,poll=null,activeReport=null,busy=false,epoch=0,disposed=false,polling=false,catalogStamp='',catalogRequest=0,reportRequest=0;
let initialRun=requestedRun||query.get('run')||sessionStorage.getItem('upstate-footprint-run:'+workspace)||'';
const endpoint=(path,extra={})=>path+'?'+new URLSearchParams({...workspace?{workspace}:{},...extra});
function error(e){if(disposed)return;$('#error').textContent=e.message||String(e);$('#error').hidden=false;}
function clearError(){if(disposed)return;$('#error').hidden=true;$('#error').textContent='';}
async function api(path,{method='GET',body}={}){
 if(host)return host.api(path,{method,body});
 const response=await fetch(path,{method,headers:{Authorization:'Bearer '+token,...body===undefined?{}:{'Content-Type':'application/json'}},body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin'});
 let value;try{value=await response.json();}catch{throw Error('The operator returned an unreadable response (HTTP '+response.status+').');}
 if(!response.ok)throw Error(value.error?.message||'HTTP '+response.status);return value;
}
function selectionText(){
 const id=$('#run-id').value.trim(),row=catalog?.runs.find(x=>x.id===id);sessionStorage.setItem('upstate-footprint-run:'+workspace,id);
 $('#selection').textContent=row?row.scenario_title+' · '+row.profile_title+' · '+row.state+' · grid '+short(row.selection.grid_id):id?'The complete retained selection will be loaded from this run ID.':'Choose or prepare a retained native run.';
}
async function loadCatalog({keepReport=true}={}){
 const generation=epoch,request=++catalogRequest;const data=await api(endpoint('/api/scenario-footprints/catalog',{offset,limit:100}));
 if(disposed||generation!==epoch||request!==catalogRequest)return;catalog=data;workspace=data.workspace_key;if(!host)sessionStorage.setItem('upstate-selected-workspace',workspace);
 const current=$('#run-id').value.trim()||initialRun;
 if($('#workspace'))$('#workspace').innerHTML=data.workspaces.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===workspace?'selected':'')+' '+(!x.available?'disabled':'')+'>'+esc(x.title)+'</option>').join('');
 $('#runs').innerHTML='<option value="">Choose a run</option>'+data.runs.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===current?'selected':'')+'>'+esc(x.scenario_title+' · '+x.profile_title+' · '+x.state+' · '+short(x.id))+'</option>').join('');
 $('#run-id').value=current;initialRun='';selectionText();
 $('#previous').disabled=offset===0;$('#next').disabled=data.next_offset===null;
 $('#run-page').textContent=data.total_runs?String(offset+1)+'–'+String(Math.min(offset+data.limit,data.total_runs))+' of '+data.total_runs:'No runs prepared';
 $('#saved').innerHTML=data.footprints.length?table(['Scenario input','Final changed area','Run',''],data.footprints.map(x=>'<tr><td>'+esc(x.title)+'<br><span class="muted">'+esc(new Date(x.created_at).toLocaleString())+'</span></td><td class="num">'+number(x.summary.net_changed_hectares)+' ha</td><td><code>'+esc(short(x.run_id))+'</code></td><td><button type="button" data-open="'+esc(x.id)+'">Open</button></td></tr>')):'<p class="empty">Build a preview for a prepared native run. Completed previews remain available here.</p>';
 if(!keepReport){$('#report').hidden=true;activeReport=null;}
}
function safeLink(value){try{const u=new URL(value,location.origin);return ['http:','https:'].includes(u.protocol)?u.href:null;}catch{return null;}}
function sourceLink(source){const link=safeLink(source.uri);return link?'<a href="'+esc(link)+'" target="_blank" rel="noopener noreferrer">'+esc(source.title||source.id)+'</a>':esc(source.title||source.id);}
async function openReport(id){
 clearError();const generation=epoch,request=++reportRequest;const row=await api(endpoint('/api/scenario-footprints/report',{id}));if(disposed||generation!==epoch||request!==reportRequest)return;activeReport=row;
 const s=row.summary,files=Object.fromEntries(row._downloads.map(x=>[x.artifact_id,x])),labels={scenario_lulc:'Native scenario raster',net_change_mask:'Final change mask',report:'Complete footprint JSON',final_transitions:'Final transitions CSV',final_classes:'Final classes CSV',coefficient_rows:'Coefficient rows CSV',patch_transitions:'Patch transitions CSV',preview:'Preview PNG'};
 const changed=row.transitions.filter(x=>x.from_code!==x.to_code);
 const finalCounts=new Map(row.final_classes.map(x=>[x.code,x.cells]));
 let html='<section><div class="section-head"><h2>'+esc(row.title)+'</h2><a class="button" href="/#runs">Open native runs</a></div><p class="identity">Run '+esc(row.run_id)+' · Footprint '+esc(row.id)+'</p>';
 html+='<div class="cards">'+[
  [number(s.net_changed_hectares)+' ha','Final changed area',number(s.net_changed_cells)+' native cells'],
  [number(s.eligible_hectares)+' ha','Unique eligible area',number(s.unique_eligible_cells)+' native cells'],
  [number(s.ever_changed_hectares)+' ha','Area changed at any step',number(s.ever_changed_cells)+' native cells'],
  [number(s.reverted_to_baseline_cells),'Cells restored to baseline',number(s.changed_more_than_once_cells)+' cells changed more than once']
 ].map(x=>'<div class="card"><strong>'+x[0]+'</strong><span>'+x[1]+'</span><small>'+x[2]+'</small></div>').join('')+'</div>';
 html+='<div class="map-row"><div><img class="preview-image" src="'+esc(files.preview.url)+'" alt="Grayscale footprint of final land-cover changes"><p class="legend"><span class="swatch changed"></span>Contains changed native cells &nbsp; <span class="swatch same"></span>Unchanged &nbsp; <span class="swatch nodata"></span>NoData</p><p class="muted">The preview aggregates changes for display. All counts and hectares use the original grid cells.</p></div><div><h3>Final baseline-to-scenario changes</h3>';
 html+=changed.length?table(['From code','To code','Cells','Hectares'],changed.map(x=>'<tr><td>'+x.from_code+'</td><td>'+x.to_code+'</td><td class="num">'+number(x.cells)+'</td><td class="num">'+number(x.hectares)+'</td></tr>')):'<p>The final land-cover values equal the baseline.</p>';
 html+='<p class="muted">Each native cell covers '+number(s.pixel_area_ha)+' ha. Original valid cells: '+number(s.valid_cells)+'. Original NoData cells: '+number(s.nodata_cells)+'.</p></div></div>';
 if(row.notes.length)html+='<div class="notes">'+row.notes.map(x=>'<p>'+esc(x)+'</p>').join('')+'</div>';
 html+='<h3>Ordered patch accounting</h3><p class="muted">Each patch reads the values left by the preceding patches. Final area belongs to the last patch that changed a cell, where that cell still differs from baseline.</p>';
 html+=row.patches.length?table(['Patch','Eligible ha','Immediate change ha','Final area ha','Earlier changes matched','Restored cells'],row.patches.map(x=>'<tr><td>'+String(x.index+1)+': '+esc(x.patch.from_codes.join(', '))+' → '+esc(x.patch.to_code)+'</td><td class="num">'+number(x.eligible_hectares)+'</td><td class="num">'+number(x.changed_hectares)+'</td><td class="num">'+number(x.final_owned_hectares)+'</td><td class="num">'+number(x.changed_earlier_cells)+'</td><td class="num">'+number(x.reverted_to_baseline_cells)+'</td></tr>')):'<p>This run uses the unchanged source baseline.</p>';
 html+='<details><summary>Original masks, reasons and complete patch transitions</summary>'+row.patches.map(x=>'<div class="patch-input"><strong>Patch '+String(x.index+1)+' · '+sourceLink(x.source)+'</strong><p>'+esc(x.patch.reason)+'</p><p class="muted">'+(x.mask_kind==='raster'?'Aligned binary raster · band 1':'Polygon layer: '+esc(x.selected_layer||'original source default')+' · selected features: '+number(x.selected_features))+' · valid mask cells: '+number(x.valid_mask_cells)+' · original NoData excluded: '+number(x.nodata_mask_cells)+'</p><p><code>'+esc(JSON.stringify(x.patch.where||{}))+'</code></p>'+table(['Current code','Assigned code','Eligible cells','Hectares'],x.transitions.map(t=>'<tr><td>'+t.from_code+'</td><td>'+t.to_code+'</td><td class="num">'+number(t.cells)+'</td><td class="num">'+number(t.hectares)+'</td></tr>'))+'</div>').join('')+'</details>';
 html+='<details><summary>Final class histogram and selected coefficient rows</summary><h3>Classes in the actual final raster</h3>'+table(['Code','Cells','Hectares'],row.final_classes.map(x=>'<tr><td>'+x.code+'</td><td class="num">'+number(x.cells)+'</td><td class="num">'+number(x.hectares)+'</td></tr>'));
 html+='<h3>Original coefficient table</h3><p>'+sourceLink(row.coefficient_source)+' · <code>'+esc(short(row.coefficient_source.body.sha256))+'</code></p><p class="muted">Rows are copied from the selected original CSV for final classes and every declared target. A target with zero final cells was unused or replaced by a later patch.</p>';
 html+=table(['Final cells',...row.coefficient_columns],row.coefficient_rows.map(x=>'<tr><td class="num">'+number(finalCounts.get(Number(x.lucode))||0)+'</td>'+row.coefficient_columns.map(k=>'<td>'+esc(x[k])+'</td>').join('')+'</tr>'))+'</details>';
 html+='<h3>Retained files</h3><div class="links">'+row._downloads.map(x=>'<a href="'+esc(x.url)+'?download=1">'+esc(labels[x.artifact_id]||x.artifact_id)+'</a>').join('')+'</div>';
 const run=catalog?.runs.find(x=>x.id===row.run_id),canStart=run?['prepared','failed'].includes(run.state):true;
 html+='<div class="section-head native-start"><div><h3>Use this retained native selection</h3><p class="muted">The run keeps its selected models, source grid, profile and scenario.</p></div><button class="primary" type="button" id="start-run" '+(!canStart?'disabled':'')+'>Start selected native models</button></div></section>';
 $('#report').innerHTML=html;$('#report').hidden=false;$('#report').scrollIntoView({behavior:'smooth',block:'start'});
}
function draftKey(action,run){return 'upstate-footprint-operation:'+workspace+':'+action+':'+run;}
async function submit(action,run){
 if(disposed||busy)return;busy=true;clearError();$('#preview').disabled=true;
 const selectedWorkspace=workspace;const key=draftKey(action,run);let op=sessionStorage.getItem(key);if(!op){op=crypto.randomUUID();sessionStorage.setItem(key,op);}
 try{
  const submitted=await api('/api/actions',{method:'POST',body:{workspace:selectedWorkspace,action,payload:{run_id:run},operation_id:op}});
  sessionStorage.setItem('upstate-footprint-task:'+selectedWorkspace,JSON.stringify({id:submitted.id,draft_key:key}));
  if(disposed||selectedWorkspace!==workspace)return;task=submitted;
  $('#task').hidden=false;await pollTask();if(host?.refresh)await host.refresh();
 }catch(e){error(e);$('#status').textContent='The request identity is retained. Retry the same selection to reconcile it.';}
 finally{busy=false;if(!disposed)$('#preview').disabled=false;}
}
async function pollTask(){
 clearTimeout(poll);if(disposed||!task||polling)return;polling=true;const generation=epoch,taskId=task.id;
 try{
  const next=await api(endpoint('/api/task',{id:taskId}));if(disposed||generation!==epoch||task?.id!==taskId)return;task=next;
  $('#task').hidden=false;$('#task-status').textContent=(task.action==='run.start'?'Native models':'Scenario footprint')+' · '+task.state+(task.error?.message?' · '+task.error.message:'');
  $('#resume').hidden=!['failed','interrupted','cancelled'].includes(task.state);
  if(task.state==='complete'){
   const stored=JSON.parse(sessionStorage.getItem('upstate-footprint-task:'+workspace)||'{}');
   if(stored.draft_key)sessionStorage.removeItem(stored.draft_key);
   sessionStorage.removeItem('upstate-footprint-task:'+workspace);
   await loadCatalog();if(task.action==='scenario.footprint.preview')await openReport(task.result.id);
   else $('#status').textContent='The retained native run completed. Open native runs for its outputs.';
   return;
  }
  if(!host&&['queued','running'].includes(task.state))poll=setTimeout(pollTask,1800);
 }catch(e){error(e);if(!disposed&&!host)poll=setTimeout(pollTask,4000);}
 finally{polling=false;}
}
$('#runs').addEventListener('change',()=>{$('#run-id').value=$('#runs').value;selectionText();});
$('#run-id').addEventListener('input',selectionText);
$('#preview-form').addEventListener('submit',e=>{e.preventDefault();submit('scenario.footprint.preview',$('#run-id').value.trim());});
$('#previous').addEventListener('click',()=>{offset=Math.max(0,offset-100);loadCatalog().catch(error);});
$('#next').addEventListener('click',()=>{if(catalog.next_offset!==null){offset=catalog.next_offset;loadCatalog().catch(error);}});
$('#refresh').addEventListener('click',()=>loadCatalog().catch(error));
$('#workspace')?.addEventListener('change',()=>{epoch++;clearTimeout(poll);task=null;workspace=$('#workspace').value;offset=0;$('#run-id').value='';$('#task').hidden=true;loadCatalog({keepReport:false}).catch(error);});
$('#saved').addEventListener('click',e=>{const open=e.target.closest('[data-open]');if(open)openReport(open.dataset.open).catch(error);});
$('#report').addEventListener('click',e=>{if(e.target.closest('#start-run')&&activeReport)submit('run.start',activeReport.run_id);});
$('#resume').addEventListener('click',async()=>{try{task=await api('/api/task/resume',{method:'POST',body:{id:task.id}});await pollTask();}catch(e){error(e);}});
async function start(){
 if(!host&&!token){$('#connect').hidden=false;$('#preview').disabled=true;return;}
 try{
  if(!host)await api('/api/session',{method:'POST',body:{}});await loadCatalog();if(disposed)return;
  const stored=JSON.parse(sessionStorage.getItem('upstate-footprint-task:'+workspace)||'null');
  if(stored?.id){task={id:stored.id};await pollTask();}
  if(initialRun)$('#run-id').value=initialRun;
 }catch(e){error(e);}
}
root.addEventListener('click',event=>{
 const anchor=event.target.closest('a[href="/#runs"]');
 if(anchor&&host?.navigate){event.preventDefault();host.navigate('runs');}
});
function update(state){
 if(disposed)return;
 if(task&&task.state!=='complete')pollTask();
 const stamp=JSON.stringify([
  (state?.data?.runs||[]).map(x=>[x.id,x.state]),
  (state?.tasks||[]).filter(x=>x.action==='scenario.footprint.preview').map(x=>[x.id,x.state])
 ]);
 if(stamp!==catalogStamp){catalogStamp=stamp;loadCatalog().catch(error);}
}
function selectRun(id){if(disposed)return;$('#run-id').value=id;selectionText();}
function detach(){disposed=true;epoch++;clearTimeout(poll);}
return {start,update,selectRun,detach};

}

if(document.querySelector('[data-scenario-footprint-standalone]'))attachPanel(document).start();
