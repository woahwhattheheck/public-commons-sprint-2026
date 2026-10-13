const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=x=>Number(x??0).toLocaleString(undefined,{maximumFractionDigits:4});
const short=x=>String(x||'').slice(0,12);
const table=(headers,rows)=>'<div class="table-scroll"><table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const modelName={ndr:'Nutrients (NDR)',sdr:'Sediment (SDR)'};
const scopeName={native_domain:'Native routing domain',reporting_area:'Reporting basin',nitrogen_export:'Nitrogen paired output support',phosphorus_export:'Phosphorus paired output support',sediment_export:'Sediment paired output support'};
const TEMPLATE='<main><h1>Model input changes</h1><p>Compare the actual land-cover classes, selected model coefficients and native parameters behind two completed runs. The original paired export comparison supplies the outcome change.</p><p class="muted">Both runs use the same retained grid. Each model is audited only when it was selected in both runs.</p><div class="error" hidden data-error></div><form data-form><div class="fields"><label>Baseline completed run<input name="baseline" list="input-run-options" autocomplete="off" required pattern="[a-f0-9]{64}" placeholder="Select or paste the complete retained run ID"></label><label>Alternative completed run<input name="alternative" list="input-run-options" autocomplete="off" required pattern="[a-f0-9]{64}" placeholder="Select or paste the complete retained run ID"></label></div><datalist id="input-run-options"></datalist><p class="muted" data-selection></p><div class="toolbar"><button type="submit" class="primary" data-compare>Compare native inputs</button><button type="button" data-refresh>Refresh runs</button><button type="button" data-previous>Previous runs</button><button type="button" data-next>More runs</button><span data-page></span></div></form><div class="status" data-status></div><button data-resume hidden>Resume retained comparison</button><section><h2>Saved input comparisons</h2><div data-saved></div></section><section data-report hidden></section></main>';

export function createScenarioInputs(host){
 let epoch=0,node=null,root=null,key=null,request=null,controller=null,task=null,taskPolling=null,submitting=false,offset=0,catalog=null,report=null,readGeneration=0,reportGeneration=0,taskStamp='';
 const workspace=()=>host.getWorkspace?.()||host.getState()?.workspace_key;
 const alive=e=>root&&e===epoch&&key===workspace();
 const $=s=>root?.querySelector(s);
 const endpoint=(path,params={})=>path+'?'+new URLSearchParams({workspace:key,...params});
 const api=(path,options={})=>host.api(path,{...options,signal:controller.signal});
 function error(e,generation=epoch){if(!alive(generation)||e?.name==='AbortError')return;$('[data-error]').textContent=e.message||String(e);$('[data-error]').hidden=false;}
 function clearError(){if($('[data-error]')){$('[data-error]').textContent='';$('[data-error]').hidden=true;}}
 const draftKey=()=> 'upstate-input-selection:'+key;
 const taskKey=()=> 'upstate-input-task:'+key;
 function selection(){
  if(!root)return;
  const a=$('[name=baseline]').value.trim(),b=$('[name=alternative]').value.trim();
  sessionStorage.setItem(draftKey(),JSON.stringify({baseline_run_id:a,alternative_run_id:b}));
  const rows=[a,b].map(id=>catalog?.runs.find(row=>row.id===id));
  $('[data-selection]').textContent=rows.map((row,i)=>row?['Baseline','Alternative'][i]+': '+row.scenario_title+' / '+row.profile_title+' / grid '+short(row.selection.grid_id):'').filter(Boolean).join(' · ');
  if(rows[0]&&rows[1]&&rows[0].selection.grid_id!==rows[1].selection.grid_id)$('[data-selection]').textContent+=' · Select runs on the same retained grid.';
 }
 async function loadCatalog(){
  const current=epoch,reading=++readGeneration;
  try{
   const value=await api(endpoint('/api/scenario-inputs/catalog',{offset,limit:100}));
   if(!alive(current)||reading!==readGeneration)return;catalog=value;
   $('#input-run-options').innerHTML=value.runs.map(row=>'<option value="'+esc(row.id)+'">'+esc(row.scenario_title+' / '+row.profile_title+' / grid '+short(row.selection.grid_id))+'</option>').join('');
   $('[data-page]').textContent=value.total?String(value.offset+1)+'–'+String(value.offset+value.runs.length)+' of '+value.total+' completed runs':'No completed runs in this workspace';
   $('[data-previous]').disabled=offset===0;$('[data-next]').disabled=value.next_offset===null;
   $('[data-saved]').innerHTML=value.reports.length?value.reports.map(row=>'<p><button data-open="'+esc(row.id)+'">'+esc(row.title)+'</button> <span class="muted">'+esc(row.models.join(', ').toUpperCase()+' · '+row.created_at)+'</span></p>').join(''):'<p class="muted">Completed input comparisons appear here.</p>';
   selection();
  }catch(e){error(e,current);}
 }
 async function openReport(id){
  const current=epoch,reading=++reportGeneration;
  try{
   const value=await api(endpoint('/api/scenario-inputs/report',{id}));
   if(!alive(current)||reading!==reportGeneration)return;report=value;renderReport();
  }catch(e){error(e,current);}
 }
 function renderReport(){
  const row=report;if(!row)return;
  const routing=row.scopes.native_domain,reporting=row.scopes.reporting_area;
  let html='<h2>'+esc(row.title)+'</h2><p class="mono">Baseline '+esc(row.baseline_run_id)+'<br>Alternative '+esc(row.alternative_run_id)+'</p><div class="cards"><div class="card">Reporting basin land-cover change<strong>'+num(reporting.landcover_changed_ha)+' ha</strong></div><div class="card">Native domain land-cover change<strong>'+num(routing.landcover_changed_ha)+' ha</strong></div><div class="card">Native cell area<strong>'+num(row.pixel_area_ha)+' ha</strong></div></div>';
  html+='<h3>Selected model input footprint</h3><p>Categories describe the two actual coefficient vectors at the same native cell. A code-only change has identical selected coefficients. Global parameter changes are listed separately.</p>';
  html+=table(['Area','Model','Paired LULC ha','Code only ha','Coefficient only ha','Code + coefficients ha','All changed coefficients ha'],Object.entries(row.scopes).flatMap(([name,scope])=>row.models.map(model=>{const m=scope.models[model];return[scopeName[name]||name,modelName[model],num(scope.paired_lulc_cells*row.pixel_area_ha),num(m.categories.code_only.hectares),num(m.categories.coefficient_only.hectares),num(m.categories.code_and_coefficients.hectares),num(m.coefficient_changed_ha)];})));
  html+='<h3>Original paired annual export changes</h3><p>Alternative minus baseline, on each original paired output support. A negative change is lower annual export. Routing can change outputs beyond the cells where inputs changed.</p>';
  html+=table(['Output','Annual change','Unit','Paired valid output cells'],Object.entries(row.outcome_comparison.artifacts).map(([name,item])=>[name.replaceAll('_',' '),num(item.sum_change),name==='sediment_export'?'metric tonnes/year':'kg/year',num(item.valid_cells)]));
  if(row.response){
   html+='<h3>Spatial response ledger</h3><p>Gross reductions and increases can occur together. These are changes in modeled source contributions reaching streams, grouped by the model input category at the source cell. The net reproduces the original comparison.</p>';
   html+=table(['Output','Gross reduction','Gross increase','Net change','Units','Area with increases ha'],Object.entries(row.response.metrics).map(([name,item])=>[name.replaceAll('_',' '),num(item.gross_reduction_mass),num(item.gross_increase_mass),num(item.net_change_mass),item.units,num(item.increased_area_ha)]));
   html+='<details><summary>Response inside and outside changed model inputs</summary>';
   html+=table(['Output','Input category','Gross reduction','Gross increase','Net change','Units','Valid area ha'],Object.entries(row.response.metrics).flatMap(([name,item])=>Object.entries(item.input_categories).map(([category,value])=>[name.replaceAll('_',' '),category.replaceAll('_',' '),num(value.gross_reduction_mass),num(value.gross_increase_mass),num(value.net_change_mass),item.units,num(value.valid_area_ha)])));
   const configured=Object.entries(row.response.metrics).filter(([,item])=>item.global_parameter_changes.length);
   if(configured.length)html+='<p>Global native parameters also changed for '+esc(configured.map(([name])=>name.replaceAll('_',' ')).join(', '))+'. Their effects apply across this comparison and are not allocated to an input category.</p>';
   html+='<p class="muted">The report retains lossless binary partition totals and separates any native floating-sum roundoff from physical changes.</p></details>';
   html+='<details><summary>Largest actual cell responses</summary><p>The first ten cells in each direction and output are shown here. The complete ranked inventory contains up to fifty per direction and output, with exact native cell centres in the GeoPackage and CSV downloads.</p>';
   html+=table(['Output','Direction','Rank','Annual change','Units','Native X','Native Y','Class transition','Input category'],row.response.largest_cell_responses.filter(p=>p.rank<=10).map(p=>[p.metric.replaceAll('_',' '),p.direction,p.rank,num(p.delta_mass),p.units,num(p.native_x),num(p.native_y),String(p.baseline_code)+' → '+String(p.alternative_code),p.input_category.replaceAll('_',' ')]));
   html+='<p class="mono">Coordinate system: '+esc(row.response.source_crs_name)+'</p></details>';
  }
  html+='<h3>Global native parameter changes</h3>';
  const changes=Object.entries(row.native_parameters.changes).flatMap(([model,rows])=>rows.map(item=>[modelName[model],item.name,item.baseline.present?item.baseline.value:'Omitted: native automatic/default behavior',item.alternative.present?item.alternative.value:'Omitted: native automatic/default behavior']));
  html+=changes.length?table(['Model','Parameter','Baseline','Alternative'],changes):'<p>The selected native parameter values are identical.</p>';
  if(row.runtime_changed)html+='<p>These runs retain different runtime descriptors. The report JSON contains both original descriptors for interpretation.</p>';
  html+='<details><summary>Changed coefficient fields and their reporting areas</summary>';
  html+=table(['Model','Coefficient','Changed cells','Changed ha'],row.models.flatMap(model=>Object.entries(reporting.models[model].fields).map(([field,value])=>[modelName[model],field,num(value.cells),num(value.hectares)])));
  html+='</details><details><summary>Native class transitions and exact coefficient changes</summary>';
  html+=table(['Baseline code','Alternative code','Domain ha','Reporting ha','Changed selected fields'],row.transitions.map(item=>[item.baseline_code,item.alternative_code,num(item.support.native_domain.hectares),num(item.support.reporting_area.hectares),item.changed_fields.join(', ')||'Identical selected coefficients']));
  html+='</details><details><summary>Coverage and source lineage</summary>';
  html+=table(['Area','Extent cells','Both LULC valid','Baseline only','Alternative only','Neither LULC valid'],Object.entries(row.scopes).map(([name,s])=>[scopeName[name]||name,num(s.extent_cells),num(s.paired_lulc_cells),num(s.baseline_only_cells),num(s.alternative_only_cells),num(s.neither_lulc_cells)]));
  html+=table(['Operand','Coefficient edition','Source URL','SHA256'],row.coefficient_sources.map((s,i)=>[i?'Alternative':'Baseline',s.title+' / '+s.vintage,s.uri,s.body.sha256]));
  html+='<p class="mono">Grid '+esc(row.grid_id)+'<br>Original outcome comparison '+esc(row.outcome_comparison.id)+'</p></details>';
  html+='<h3>Downloads</h3><div class="downloads">'+(row._downloads||[]).map(item=>'<a href="'+esc('/api/file/'+encodeURIComponent(item.id)+'?download=1')+'">'+esc(item.artifact_id.replaceAll('_',' '))+'</a>').join('')+'</div><p class="muted">Map categories: 0 same code and coefficients; 1 code only; 2 coefficients only; 3 both; 255 outside the native domain or invalid land-cover support.</p><p class="muted">Input changes identify model operands. Use the original model results and scenario assessment for the resulting exports.</p>';
  $('[data-report]').innerHTML=html;$('[data-report]').hidden=false;
 }
 async function pollTask(){
  if(!task)return;
  const current=epoch,id=task.id,pollKey=current+':'+id;
  if(taskPolling===pollKey)return;taskPolling=pollKey;
  try{
   const value=await api(endpoint('/api/task',{id}));
   if(!alive(current)||task?.id!==id)return;task=value;
   $('[data-status]').textContent='Native input comparison · '+task.state+(task.error?.message?' · '+task.error.message:'');
   $('[data-resume]').hidden=!['failed','interrupted','cancelled'].includes(task.state);
   if(task.state==='complete'){
    const saved=JSON.parse(sessionStorage.getItem(taskKey())||'{}');
    if(saved.operation_key)sessionStorage.removeItem(saved.operation_key);
    sessionStorage.removeItem(taskKey());
    const resultId=task.result.id;task=null;
    await loadCatalog();if(!alive(current))return;await openReport(resultId);
   }
  }catch(e){error(e,current);}finally{if(taskPolling===pollKey)taskPolling=null;}
 }
 async function submit(event){
  event.preventDefault();if(submitting)return;
  const current=epoch,selectedWorkspace=key,payload={baseline_run_id:$('[name=baseline]').value.trim(),alternative_run_id:$('[name=alternative]').value.trim()};
  if(payload.baseline_run_id===payload.alternative_run_id){error(Error('Select two distinct completed runs.'));return;}
  const operationKey='upstate-input-operation:'+key+':'+payload.baseline_run_id+':'+payload.alternative_run_id;
  let operationId=sessionStorage.getItem(operationKey);
  if(!operationId){operationId=crypto.randomUUID();sessionStorage.setItem(operationKey,operationId);}
  submitting=true;clearError();$('[data-compare]').disabled=true;
  try{
   const value=await api('/api/actions',{method:'POST',body:{workspace:selectedWorkspace,action:'scenario.inputs.compare',payload,operation_id:operationId}});
   sessionStorage.setItem('upstate-input-task:'+selectedWorkspace,JSON.stringify({id:value.id,operation_key:operationKey}));
   if(!alive(current))return;task=value;await pollTask();if(alive(current))await host.refresh?.();
  }catch(e){error(e,current);}finally{if(alive(current)){submitting=false;$('[data-compare]').disabled=false;}}
 }
 function detach(){epoch++;controller?.abort();controller=null;root=null;node=null;task=null;taskPolling=null;submitting=false;catalog=null;report=null;taskStamp='';}
 async function mount(target,state){
  detach();const current=epoch;key=workspace();node=target;controller=new AbortController();
  const surface=document.createElement('div');root=surface.attachShadow({mode:'open'});
  root.innerHTML='<link rel="stylesheet" href="/web/scenario-inputs.css">'+TEMPLATE;node.replaceChildren(surface);
  try{
   const saved=request?.workspace===key?request:JSON.parse(sessionStorage.getItem(draftKey())||'{}');
   $('[name=baseline]').value=saved.baseline_run_id||'';$('[name=alternative]').value=saved.alternative_run_id||'';
   $('[data-form]').addEventListener('submit',submit);
   root.addEventListener('input',selection);
   root.addEventListener('click',event=>{
    if(event.target.closest('[data-refresh]'))loadCatalog();
    if(event.target.closest('[data-previous]')){offset=Math.max(0,offset-100);loadCatalog();}
    if(event.target.closest('[data-next]')&&catalog&&catalog.next_offset!==null){offset=catalog.next_offset;loadCatalog();}
    const open=event.target.closest('[data-open]');if(open)openReport(open.dataset.open);
   });
   $('[data-resume]').addEventListener('click',async()=>{
    if(!task)return;const generation=epoch,id=task.id;
    try{const value=await api('/api/task/resume',{method:'POST',body:{id}});
     if(!alive(generation)||task?.id!==id)return;task=value;await pollTask();
    }catch(e){error(e,generation);}
   });
   offset=0;await loadCatalog();if(!alive(current))return;
   const previous=JSON.parse(sessionStorage.getItem(taskKey())||'null');
   if(previous?.id){task={id:previous.id};await pollTask();}
  }catch(e){if(alive(current)&&e?.name!=='AbortError')throw e;}
 }
 function update(state){
  if(!root||key!==workspace())return;
  if(task)pollTask();
  const stamp=JSON.stringify((state?.tasks||[]).filter(t=>t.action==='scenario.inputs.compare').map(t=>[t.id,t.state]));
  if(stamp!==taskStamp){taskStamp=stamp;loadCatalog();}
 }
 function openPair(baselineRunId,alternativeRunId){
  if(![baselineRunId,alternativeRunId].every(id=>/^[a-f0-9]{64}$/.test(String(id))))throw Error('Select complete native run IDs.');
  request={workspace:workspace(),baseline_run_id:baselineRunId,alternative_run_id:alternativeRunId};
  if(root&&key===request.workspace){$('[name=baseline]').value=baselineRunId;$('[name=alternative]').value=alternativeRunId;selection();}
  host.navigate?.('scenario-inputs');
 }
 return {mount,update,detach,openPair};
}
