import {ROLES,clone,canonical,blankDraft,selectionFromDraft,exclusionKey,draftFromSelection,emptyDesk,validateDesk,prepareRequest,retainReceipt,persistDesk,describeState,numeric} from "./multivariate_control_core.mjs";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const list=v=>Array.isArray(v)?v:[];
const label={DEM:"Elevation",K_FACTOR:"Soil erodibility",R_FACTOR:"Rainfall erosivity",SLOPE:"Slope",CONNECTIVITY:"Stream connectivity"};
const option=(v,t,selected)=>'<option value="'+esc(v)+'"'+(v===selected?' selected':'')+'>'+esc(t)+'</option>';
const button=(action,title,attrs="")=>'<button type="button" data-mc-action="'+action+'" '+attrs+'>'+esc(title)+'</button>';
const details=(title,value)=>'<details><summary>'+esc(title)+'</summary><pre>'+esc(JSON.stringify(value,null,2))+'</pre></details>';
const kv=value=>'<dl class="mc-facts">'+Object.entries(value||{}).filter(([,v])=>v===null||typeof v!=="object").map(([k,v])=>'<div><dt>'+esc(k.replaceAll("_"," "))+'</dt><dd>'+esc(typeof v==="number"?numeric(v):v??"—")+'</dd></div>').join("")+'</dl>';
const table=(heads,rows)=>'<div class="mc-scroll"><table><thead><tr>'+heads.map(h=>'<th scope="col">'+esc(h)+'</th>').join("")+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';
const stat=s=>s?esc(numeric(s.mean))+'<small>n '+esc(numeric(s.count))+' · SD '+esc(numeric(s.population_sd))+'<br>'+esc(numeric(s.minimum))+' to '+esc(numeric(s.maximum))+'</small>':"—";
export function createMultivariateControlWorkbench(host){
 const storage=host.storage||globalThis.localStorage;
 let node=null,workspace=null,generation=0,catalog=null,desk=null,preview=null,result=null,busy=false,message="",error="",loadedTaskFingerprint="",loadGeneration=0,inspectGeneration=0;
 const active=(w,g)=>!!node&&workspace===w&&generation===g&&host.getWorkspace()===w;
 const key=w=>"upstate-multivariate-control-desk-v1:"+w;
 const read=(operation,payload,w=workspace)=>host.api("/api/multivariate-control/"+operation,{method:"POST",body:{workspace:w,...payload}});
 const write=next=>{persistDesk(storage,key(workspace),next);desk=next;};
 const fail=e=>{error=e?.message||String(e);notice();};
 const notice=()=>{if(!node)return;const a=node.querySelector("[data-mc-error]"),b=node.querySelector("[data-mc-notice]");if(a){a.textContent=error;a.hidden=!error;}if(b){b.textContent=message;b.hidden=!message;}};
 const download=(value,name)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+"\n"],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);};
 function form(){
  if(!catalog||!desk)return '<p>Reading retained original sources…</p>';
  const d=desk.draft,restored=catalog.restorations.find(x=>x.id===d.restoration_footprint_id);
  const field=(name,title,type="text",extra="")=>'<label><span>'+esc(title)+'</span><input data-mc-field="'+name+'" type="'+type+'" value="'+esc(d[name])+'" '+extra+'></label>';
  const select=(name,title,rows)=>'<label><span>'+esc(title)+'</span><select data-mc-field="'+name+'">'+option("","Choose an original item",d[name])+rows+'</select></label>';
  return '<fieldset '+(busy?"disabled":"")+'><legend>Define a new control design</legend><div class="mc-grid">'+field("title","Design title")+
   '<label class="mc-wide"><span>Scientific reason and comparison question</span><textarea data-mc-field="reason" rows="3">'+esc(d.reason)+'</textarea></label>'+
   select("baseline_run_id","Original baseline run",catalog.baselines.map(x=>option(x.id,(x.title||x.id)+" · "+x.state,d.baseline_run_id)).join(""))+
   select("restoration_footprint_id","Actual restoration footprint",catalog.restorations.map(x=>option(x.id,(x.title||x.id)+" · run "+x.run_id,d.restoration_footprint_id)).join(""))+
   '</div>'+(!catalog.restorations.length?'<p class="mc-callout">No saved restoration footprint is available yet. Open Scenario footprints, select the actual original restoration run and prepare its footprint, then return here. This compiles the original land-cover change without rerunning the nutrient or sediment models.</p>':'')+'<p>Select the prepared covariates to constrain. Exact land-cover transitions remain separate. Every original changed treatment cell stays in the design. Bounds divide each covariate into intervals; the first and last intervals remain open. Blank bounds create a single interval and do not constrain that covariate. An included covariate still requires valid values at all treatment cells, even with no boundaries; disable it to keep it descriptive only.</p>'+
   table(["Include prepared covariate","Original units and range","Increasing interval boundaries"],ROLES.map(role=>['<label class="mc-check"><input type="checkbox" data-mc-enabled="'+role+'" '+(d.enabled[role]?"checked":"")+' '+(!restored?.scalars?.[role]?"disabled":"")+'>'+esc(label[role])+'</label>',esc(restored?.scalars?.[role]?.units||"Choose a footprint")+"<small>"+esc(numeric(restored?.scalars?.[role]?.minimum))+" to "+esc(numeric(restored?.scalars?.[role]?.maximum))+"</small>",'<label><span class="mc-sr">'+esc(label[role])+' boundaries</span><input data-mc-boundaries="'+role+'" value="'+esc(d.boundaries[role])+'" placeholder="Enter increasing boundaries"></label>']))+
   '<h3>Additional original covariates</h3><p>Slope and stream connectivity are matched only when you select aligned source rasters below. Elevation does not substitute for slope. Describe the physical meaning of each selected source.</p>'+
   ["SLOPE","CONNECTIVITY"].map(role=>{const x=d.optional[role];return '<section class="mc-optional"><label class="mc-check"><input type="checkbox" data-mc-optional="'+role+'" data-mc-part="enabled" '+(x.enabled?"checked":"")+'>Include '+esc(label[role])+'</label>'+(x.enabled?'<div class="mc-grid"><label><span>Original source and units</span><select data-mc-optional="'+role+'" data-mc-part="source">'+option("","Choose an aligned original raster",x.source)+list(catalog.covariate_sources).map(y=>option(exclusionKey(y),(y.title||y.source_id)+" · "+y.units,x.source)).join("")+'</select></label><label><span>Increasing boundaries</span><input data-mc-optional="'+role+'" data-mc-part="boundaries" value="'+esc(x.boundaries)+'"></label><label class="mc-wide"><span>What this raster measures</span><textarea data-mc-optional="'+role+'" data-mc-part="definition">'+esc(x.definition)+'</textarea></label></div>':"")+'</section>';}).join("")+
   '<div class="mc-grid">'+field("precipitation_caliper","Maximum runoff-proxy pair difference ("+(restored?.scalars?.PRECIPITATION?.units||"original units; choose a footprint")+", optional)","text",'inputmode="decimal"')+
   field("max_working_bytes","Matching working-memory budget in bytes","text",'inputmode="numeric"')+
   select("exclusion_source","Additional original binary exclusion raster",[option("","Use the original reporting domain and treatment exclusion only",d.exclusion_source),...catalog.exclusions.map(x=>option(exclusionKey(x),x.title||x.source_id,d.exclusion_source))].join(""))+
   '</div><p>Runoff-proxy differences use the retained original raster units shown in the source preview. Matching occurs inside the original reporting mask and exact transition/covariate strata. The runoff-proxy threshold checks the computed optimum; a failed threshold is not proof that all other pairings fail.</p>'+
   '<div class="mc-actions">'+button("preview","Review original sources")+button("prepare","Prepare control design",preview&&canonical(preview.selection)===canonical(selectionSafely())?"":"disabled")+button("new","New draft")+'</div></fieldset>';
 }
 function selectionSafely(){try{return selectionFromDraft(desk.draft,catalog);}catch{return null;}}
 function previewMarkup(){
  if(!preview)return '<p>Review the exact source bindings before native matching.</p>';
  return '<h3>'+esc(describeState(preview.state))+'</h3>'+kv(preview.summary)+details("Original source bindings and prepared units",preview.binding)+details("Exact matching choices",preview.selection);
 }
 function resultMarkup(){
  if(!result)return '<p>Open a saved design or prepare a new one to inspect stratum support, residual imbalance and original native outputs.</p>';
  const x=result,adopted=x.adoption,accepted=x.state==="prepared";
  return '<header><h3>'+esc(x.selection?.title||x.id)+'</h3><p>'+esc(describeState(x.state))+'</p><code>'+esc(x.id)+'</code></header>'+kv(x.summary)+details("Complete treatment-support accounting",x.summary)+
   (x.state==="threshold_not_met"?'<p class="mc-callout">The computed match exceeds your runoff-proxy threshold. The full treatment footprint is retained. This result makes no assertion about whether a different constrained pairing exists.</p>':"")+
   '<div class="mc-actions">'+button("clone","Use choices for a new design")+
   button("adopt","Create original scenario and experiment",accepted&&!adopted&&!busy?"":"disabled")+
   (adopted?button("experiment","Open saved experiment")+button("run","Open control run")+button("scenario","Open control scenario")+button("execute","Execute saved experiment",busy?"disabled":""):"")+
   button("export-result","Download complete design JSON")+'</div>'+
   '<h3>Support in each exact stratum</h3>'+table(["Transition / stratum","Covariate bins","Eligible treatment in stratum","Candidate cells","Matched cells","State / reasons"],list(x.strata).map(s=>[esc(s.from_code)+" → "+esc(s.to_code)+"<small>"+esc(s.key)+"</small>",esc(typeof s.bins==="object"?JSON.stringify(s.bins):s.bins),esc(numeric(s.eligible_target_cells??s.target_cells)),esc(numeric(s.candidate_cells)),esc(numeric(s.matched_cells)),esc(s.state)+"<small>"+esc(list(s.reasons).join("; "))+"</small>"]))+
   '<h3>Balance and remaining differences</h3><p>Means, population standard deviations and ranges describe the original prepared cells. Residual pair differences remain visible even when both cells occupy the same interval. Shared class, area or rainfall totals do not establish local watershed balance.</p>'+
   table(["Stratum / covariate","Treatment","Candidates","Selected controls","Residual difference"],list(x.balance).map(b=>[esc(b.stratum)+"<small>"+esc(label[b.role]||b.role)+" · "+esc(b.units)+"</small>",stat(b.target),stat(b.candidate),stat(b.control),stat(b.residual)+"<small>Mean absolute "+esc(numeric(b.residual?.mean_absolute))+"<br>Maximum absolute "+esc(numeric(b.residual?.max_absolute))+"</small>"]))+
   '<h3>Retained source and design files</h3>'+table(["File","Bytes","Open"],list(x._downloads).map(f=>[esc(f.label||f.filename),esc(numeric(f.bytes)),'<a href="'+esc(f.url)+'" download="'+esc(f.filename)+'">Download</a>']))+
   '<p>Native completed experiment comparisons report modeled annual stream delivery. This matching design does not establish causal validation.</p>'+details("Exact choices, additional covariate definitions and source binding",{selection:x.selection,binding:x.binding})+(adopted?details("Original adopted scenario, source collection, footprint, run and experiment",adopted):"");
 }
 function taskRows(){
  if(!desk)return "";
  const tasks=list(host.getState()?.tasks),rows=desk.requests.filter(r=>r.body.workspace===workspace);
  return table(["Native operation","Queue state","Original request","Open"],rows.map(r=>{const t=tasks.find(t=>t.id===r.task_id);return [esc(r.body.action),esc(t?.state||(r.task_id?"Retained; open task":"Awaiting receipt")),esc(r.body.operation_id),r.task_id?button("task","Open task",'data-task-id="'+esc(r.task_id)+'"'):button("retry","Recover same request",'data-operation-id="'+esc(r.body.operation_id)+'" '+(busy?"disabled":""))];}));
 }
 function render(){
  if(!node)return;
  node.innerHTML='<div class="mc-desk" data-mc-desk><header class="page-header"><div><p class="eyebrow">UPPER SAVANNAH MODELING</p><h1>Matched controls</h1><p>Prepare, inspect and run source-bound counterfactual land-cover controls.</p></div><div class="mc-actions">'+button("reload","Refresh retained designs")+button("footprints","Scenario footprints")+button("sources","Original sources")+button("export","Export desk choices")+button("import","Reopen desk choices")+button("backup","Export original Workspace")+'</div></header>'+
   '<div role="alert" data-mc-error hidden></div><div role="status" aria-live="polite" data-mc-notice hidden></div>'+
   '<input type="file" accept=".json,application/json" data-mc-import hidden>'+
   '<section class="mc-section" data-mc-form>'+form()+'</section>'+
   '<section class="mc-section"><h2>Source preview</h2><div data-mc-preview>'+previewMarkup()+'</div></section>'+
   '<section class="mc-section"><h2>Saved control designs</h2><div class="mc-actions"><label><span>Design</span><select data-mc-saved>'+option("","Choose a saved control design",desk?.selected_id)+[...list(catalog?.designs),...(result&&!list(catalog?.designs).some(x=>x.id===result.id)?[result]:[])].map(x=>option(x.id,(x.selection?.title||x.id)+" · "+describeState(x.state),desk?.selected_id)).join("")+'</select></label>'+button("open","Open retained design")+'</div><div data-mc-result>'+resultMarkup()+'</div></section>'+
   '<section class="mc-section"><h2>Original native operations</h2><div data-mc-tasks>'+taskRows()+'</div></section>'+
   (list(catalog?.issues).length?'<section class="mc-section"><h2>Source catalogue issues</h2><ul>'+catalog.issues.map(x=>'<li>'+esc(typeof x==="string"?x:JSON.stringify(x))+'</li>').join("")+'</ul></section>':"")+'</div>';
  notice();
 }
 function capture(target){
  if(!desk||busy||!node?.contains(target))return;
  const next=clone(desk);let changed=false;
  if(target.dataset.mcField){next.draft[target.dataset.mcField]=target.value;changed=true;}
  if(target.dataset.mcEnabled){next.draft.enabled[target.dataset.mcEnabled]=target.checked;changed=true;}
  if(target.dataset.mcBoundaries){next.draft.boundaries[target.dataset.mcBoundaries]=target.value;changed=true;}
  if(target.dataset.mcOptional){next.draft.optional[target.dataset.mcOptional][target.dataset.mcPart]=target.type==="checkbox"?target.checked:target.value;changed=true;}
  if(!changed)return;
  if(target.dataset.mcField==="restoration_footprint_id"){const r=catalog.restorations.find(x=>x.id===next.draft.restoration_footprint_id);for(const role of ROLES)if(!r?.scalars?.[role])next.draft.enabled[role]=false;}
  desk=next;preview=null;error="";message="";
  try{write(next);}catch(e){fail(new Error("Draft is held in this view but browser storage failed: "+e.message+" Export the desk choices to retain your work."));}
  const p=node.querySelector("[data-mc-preview]");if(p)p.innerHTML=previewMarkup();
  node.querySelector('[data-mc-action="prepare"]')?.setAttribute("disabled","");
  if(target.tagName==="SELECT"||target.type==="checkbox")render();else notice();
 }
 async function loadCatalog(){
  const w=workspace,g=generation,own=++loadGeneration;
  const value=await read("catalog",{},w);if(!active(w,g)||own!==loadGeneration)return;
  if(!desk){const raw=storage.getItem(key(w));desk=raw?validateDesk(JSON.parse(raw),value.project_id):emptyDesk(value.project_id);}
  else if(desk.project_id!==value.project_id)throw Error("The original project identity changed.");
  catalog=value;render();
  if(desk.selected_id&&list(catalog.designs).some(x=>x.id===desk.selected_id))await openDesign(desk.selected_id);
 }
 async function openDesign(id,{isCurrent=()=>true}={}){
  if(!id||!isCurrent())return;
  const w=workspace,g=generation,own=++inspectGeneration;
  const value=await read("inspect",{design_id:id},w);if(!active(w,g)||own!==inspectGeneration||!isCurrent())return;
  if(!desk){const project=value.binding?.project_id;if(typeof project!=="string"||!project)throw Error("The saved design is missing its original project identity.");const raw=storage.getItem(key(w));desk=raw?validateDesk(JSON.parse(raw),project):emptyDesk(project);}
  const next=clone(desk);next.selected_id=id;write(next);result=value;render();
 }
 async function sendRetained(request){
  const w=workspace,g=generation,originProject=desk.project_id;
  if(request.body.workspace!==w)throw Error("Open the request's original Workspace to recover its task.");
  busy=true;error="";message="Submitting the retained original request…";render();
  try{
   const task=await host.api("/api/actions",{method:"POST",body:clone(request.body)});
   // A late response is retained in its original desk before checking the
   // current view. It never writes the newly selected Workspace's choices.
   const raw=storage.getItem(key(w));if(!raw)throw Error("The original request storage is missing; retain the returned task "+task.id+".");
   const original=validateDesk(JSON.parse(raw),originProject),received=retainReceipt(original,request.body.operation_id,task);
   persistDesk(storage,key(w),received);
   if(!active(w,g))return;
   desk=received;message="Original task "+task.state+". Use Open task to follow native work.";
   await host.refresh({force:true});
   if(!active(w,g))return;
   await loadCatalog();
  }catch(e){if(active(w,g))fail(new Error(e.message+" Recover the same saved request to obtain its original task."));}
  finally{if(active(w,g)){busy=false;render();}}
 }
 async function submit(action,payload){
  const id=globalThis.crypto.randomUUID().replaceAll("-","");
  const next=prepareRequest(desk,workspace,action,payload,id);next.desk.selected_id=payload.design_id||payload.expected_design_id||next.desk.selected_id;write(next.desk);await sendRetained(next.request);
 }
 async function click(event){
  const target=event.target.closest?.("[data-mc-action]");if(!target||!node?.contains(target)||target.disabled)return;
  const action=target.dataset.mcAction, clickWorkspace=workspace, clickGeneration=generation;
  try{
   if(action==="reload"){await loadCatalog();return;}
   if(action==="footprints"){await host.navigate("scenario-footprint");return;}
   if(action==="sources"){await host.navigate("sources");return;}
   if(action==="export"){if(!desk)throw Error("Load the original project first.");download(desk,"matched-control-desk.json");return;}
   if(action==="import"){node.querySelector("[data-mc-import]").click();return;}
   if(action==="backup"){await host.openBackup();return;}
   if(action==="task"){await host.showTask(target.dataset.taskId);return;}
   if(action==="retry"){if(busy)return;const r=desk.requests.find(x=>x.body.operation_id===target.dataset.operationId);if(!r)throw Error("Choose a saved native request.");await sendRetained(r);return;}
   if(action==="open"){await openDesign(node.querySelector("[data-mc-saved]").value);return;}
   if(action==="export-result"){if(result)download(result,"matched-control-"+result.id+".json");return;}
   if(action==="experiment"){await host.openExperiment(result.adoption.experiment_id);return;}
   if(action==="run"){await host.openItem("runs",result.adoption.run_id);return;}
   if(action==="scenario"){await host.openItem("scenarios",result.adoption.scenario_id);return;}
   if(busy)return;
   if(action==="new"){const next=clone(desk);next.draft=blankDraft();write(next);preview=null;render();return;}
   if(action==="clone"){if(!result)throw Error("Open an original design first.");const next=clone(desk);next.draft=draftFromSelection(result.selection);write(next);preview=null;message="Original choices copied into the editable draft. Change a scientific choice to prepare a new design.";render();return;}
   if(action==="preview"){
    const selection=selectionFromDraft(desk.draft,catalog),w=workspace,g=generation,fingerprint=canonical(selection);
    busy=true;error="";message="Reviewing the original source bindings…";render();
    try{const value=await read("preview",{selection},w);if(active(w,g)&&fingerprint===canonical(selectionSafely())){preview=value;message="Original sources bound. Preparation will verify these same inputs.";}}
    finally{if(active(w,g)){busy=false;render();}}return;
   }
   if(action==="prepare"){
    const selection=selectionFromDraft(desk.draft,catalog);
    if(!preview||canonical(preview.selection)!==canonical(selection))throw Error("Review the exact current choices before native preparation.");
    await submit("control.prepare",{selection,expected_design_id:preview.id});return;
   }
   if(action==="adopt"){if(result?.state!=="prepared"||result.adoption)throw Error("Choose a prepared, unadopted design.");await submit("control.adopt",{design_id:result.id});return;}
   if(action==="execute"){if(!result?.adoption)throw Error("Create the original scenario and experiment first.");await submit("control.execute",{design_id:result.id});return;}
  }catch(e){if(active(clickWorkspace,clickGeneration))fail(e);}
 }
 async function input(event){
  if(event.target.matches?.("[data-mc-import]")){
   const file=event.target.files?.[0],w=workspace,g=generation;if(!file||!desk||busy)return;
   try{const value=JSON.parse(await file.text());if(!active(w,g))return;const next=validateDesk(value,desk.project_id);
    // Merge immutable original requests rather than erasing existing receipts.
    for(const row of desk.requests){const old=next.requests.find(x=>x.body.operation_id===row.body.operation_id);if(old){if(canonical(old.body)!==canonical(row.body))throw Error("Imported request conflicts with this desk.");if(old.task_id&&row.task_id&&old.task_id!==row.task_id)throw Error("Imported task receipt conflicts with this desk.");old.task_id=old.task_id||row.task_id;}else next.requests.push(clone(row));}
    write(next);preview=null;result=null;message="Complete choices and original requests reopened.";await loadCatalog();
   }catch(e){if(active(w,g))fail(e);}return;
  }
  capture(event.target);
 }
 function update(state){
  if(!node||host.getWorkspace()!==workspace)return;
  const rows=list(state?.tasks).filter(x=>x.workspace===workspace&&/^control\./.test(x.action));
  const signature=canonical(rows.map(x=>[x.id,x.state]));
  const target=node.querySelector("[data-mc-tasks]");if(target)target.innerHTML=taskRows();
  if(loadedTaskFingerprint&&signature!==loadedTaskFingerprint&&!busy){const w=workspace,g=generation;loadCatalog().catch(e=>{if(active(w,g))fail(e);});}
  loadedTaskFingerprint=signature;
 }
 async function mount(target){
  detach();node=target;workspace=host.getWorkspace();generation++;catalog=null;desk=null;preview=null;result=null;busy=false;error="";message="";loadedTaskFingerprint="";
  node.addEventListener("click",click);node.addEventListener("input",input);node.addEventListener("change",input);render();
  const w=workspace,g=generation;try{await loadCatalog();}catch(e){if(active(w,g))fail(e);}
 }
 function detach(){generation++;loadGeneration++;inspectGeneration++;if(node){node.removeEventListener("click",click);node.removeEventListener("input",input);node.removeEventListener("change",input);}node=null;workspace=null;}
 async function openSavedDesign({workspace_key,design_id,isCurrent=()=>true}){if(!isCurrent())return;if(!node||workspace!==workspace_key||host.getWorkspace()!==workspace_key)throw Error("Open the design's original matched-control desk.");await openDesign(design_id,{isCurrent});}
 return {mount,update,detach,openSavedDesign};
}
