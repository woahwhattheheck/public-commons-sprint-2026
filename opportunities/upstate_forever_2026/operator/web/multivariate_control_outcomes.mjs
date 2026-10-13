import {POLLUTANTS,canonical,clone,numeric,blankDraft,emptyDesk,validateDesk,selectionFromDraft,draftFromSelection,prepareRequest,retainReceipt,persistDesk,mergeDesk} from "./multivariate_control_outcomes_core.mjs";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const list=x=>Array.isArray(x)?x:[];
const n=x=>esc(numeric(x));
const label={nitrogen_export:"Nitrogen",phosphorus_export:"Phosphorus",sediment_export:"Sediment"};
const option=(v,t,s)=>'<option value="'+esc(v)+'"'+(v===s?' selected':'')+'>'+esc(t)+'</option>';
const button=(a,t,attrs="")=>'<button type="button" data-mco-action="'+a+'" '+attrs+'>'+esc(t)+'</button>';
const details=(t,v)=>'<details><summary>'+esc(t)+'</summary><pre>'+esc(JSON.stringify(v,null,2))+'</pre></details>';
const table=(heads,rows)=>'<div class="mc-scroll"><table><thead><tr>'+heads.map(h=>'<th scope="col">'+esc(h)+'</th>').join("")+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';
const regionKey=r=>[r.kind,r.relationship,r.quantity_scope].join("|");
export function createMultivariateControlOutcomesWorkbench(host){
 const storage=host.storage||globalThis.localStorage;
 let node=null,workspace=null,generation=0,loadGeneration=0,inspectGeneration=0,catalog=null,desk=null,preview=null,result=null,busy=false,error="",message="",fingerprint="",supportMode="group_common",chosenRegion="";
 const active=(w,g)=>!!node&&workspace===w&&generation===g&&host.getWorkspace()===w;
 const key=w=>"upstate-multivariate-control-outcome-desk-v1:"+w;
 const read=(op,payload,w=workspace)=>host.api("/api/multivariate-control-outcomes/"+op,{method:"POST",body:{workspace:w,...payload}});
 const write=value=>{persistDesk(storage,key(workspace),value);desk=value;};
 const download=(value,name)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+"\n"],{type:"application/json"})),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);};
 const notify=()=>{if(!node)return;for(const [sel,value]of[["[data-mco-error]",error],["[data-mco-notice]",message]]){const target=node.querySelector(sel);if(target){target.textContent=value;target.hidden=!value;}}};
 const fail=e=>{error=e?.message||String(e);notify();};
 const safely=()=>{try{return selectionFromDraft(desk.draft,catalog);}catch{return null;}};
 const designTitle=id=>list(result?.placements).find(x=>x.design_id===id)?.title||list(catalog?.designs).find(x=>x.id===id)?.title||list(catalog?.designs).find(x=>x.id===id)?.selection?.title||id;
 function form(){
  if(!desk||!catalog)return '<p>Reading completed original controls…</p>';
  const d=desk.draft;
  return '<fieldset '+(busy?'disabled':'')+'><legend>Compare completed original placements</legend><div class="mc-grid"><label><span>Comparison title</span><input data-mco-field="title" value="'+esc(d.title)+'"></label><label><span>Quantity area</span><select data-mco-field="quantity_scope">'+option("reporting","Original selected reporting area",d.quantity_scope)+option("model_domain","Complete retained model domain",d.quantity_scope)+'</select></label><label class="mc-wide"><span>Scientific question and reason</span><textarea data-mco-field="reason" rows="3">'+esc(d.reason)+'</textarea></label></div>'+
   '<p>Choose controls sharing the original baseline, restoration and native grid. The source preview checks each producing model version, output units and quantity conversion. Native results are read from their completed runs.</p>'+
   (catalog.designs.length?table(["Include","Original control design","Retained native run","Selection order"],catalog.designs.map(x=>['<label class="mc-check"><input type="checkbox" data-mco-design="'+esc(x.id)+'" '+(d.design_ids.includes(x.id)?'checked':'')+(!x.ready&&!d.design_ids.includes(x.id)?' disabled':'')+'><span class="mc-sr">Include '+esc(x.title||x.selection?.title||x.id)+'</span></label>',esc(x.title||x.selection?.title||x.id)+'<small>'+esc(x.id)+'</small>',esc(x.control_run_id||"See source preview")+(!x.ready?"<small>Native runs incomplete</small>":""),d.design_ids.includes(x.id)?n(d.design_ids.indexOf(x.id)+1):"—"])):'<p class="mc-callout">No completed adopted control is available. Open Matched controls, adopt a prepared design and execute its original experiment. Return here when its native run is complete.</p>')+
   '<p>Controls stay in your selection order. Removing and adding one moves it to the end. Matching choices and duplicate placement identities remain attached to every result.</p>'+
   '<div class="mc-actions">'+POLLUTANTS.map(p=>'<label class="mc-check"><input type="checkbox" data-mco-pollutant="'+p+'" '+(d.pollutants.includes(p)?'checked':'')+'>'+label[p]+'</label>').join("")+'</div>'+
   '<div class="mc-actions">'+button("preview","Review native sources")+button("prepare","Prepare outcome comparison",preview&&canonical(preview.selection)===canonical(safely())?"":"disabled")+button("new","New comparison")+'</div></fieldset>';
 }
 function previewMarkup(){
  if(!preview)return '<p>Review the selected placements and their exact original native sources before analysis.</p>';
  return '<h3>'+esc(preview.state==="existing"?"Original comparison already retained":"Native sources bound")+'</h3>'+details("Comparison choices",preview.selection)+details("Native output, domain, conversion and source bindings",preview.binding)+details("Comparison scope",preview.summary);
 }
 function primaryTable(rows){
  const values=[];
  for(const r of rows)for(const [p,v]of Object.entries(r.siting_contrasts||{})){
   values.push([esc(designTitle(r.design_id)),esc(label[p]||p)+'<small>'+esc(v.units)+'</small>',n(v.native_common_cells)+'<small>'+n(v.native_common_hectares)+' ha</small>',n(v.mass?.baseline),n(v.mass?.restoration),n(v.mass?.control),n(v.alternatives?.restoration?.avoided_export_mass),n(v.alternatives?.control?.avoided_export_mass),n(v.restoration_advantage_mass)]);
  }
  return table(["Control placement","Quantity / annual units","Common source cells","Baseline B","Restoration R","Control C","B − R","B − C","C − R"],values);
 }
 function denominatorTable(rows){
  const values=[];
  for(const r of rows)for(const [p,v]of Object.entries(r.siting_contrasts||{}))for(const role of["restoration","control"]){
   const a=v.alternatives?.[role];if(!a)continue;
   values.push([esc(designTitle(r.design_id))+'<small>'+esc(role)+'</small>',esc(label[p]||p)+'<small>'+esc(v.normalized_units)+'</small>',n(a.whole_scenario_changed_hectares),n(a.region_changed_hectares),n(a.native_common_changed_hectares),n(a.avoided_export_per_whole_scenario_changed_ha),n(a.avoided_export_per_changed_ha),n(a.avoided_export_per_native_common_changed_ha)]);
  }
  return table(["Placement / scenario","Quantity / rate units","Whole-scenario changed ha","Changed ha in region","Changed ha in common support","Avoided / whole changed ha","Avoided / region changed ha","Avoided / common changed ha"],values);
 }
 function partitionTable(rows){
  const values=[];
  for(const r of rows)for(const [p,v]of Object.entries(r.siting_contrasts||{}))for(const [role,a]of Object.entries(v.alternatives||{}))for(const [part,value]of Object.entries(a.source_cell_partitions||{})){
   values.push([esc(designTitle(r.design_id))+'<small>'+esc(role)+'</small>',esc(label[p]||p)+'<small>'+esc(v.units)+'</small>',esc(part.replaceAll("_"," ")),n(value.cells),n(value.hectares),n(value.avoided_export_mass)]);
  }
  return table(["Placement / scenario","Quantity","Source-cell partition","Cells","Hectares","Avoided annual export"],values);
 }
 function coverageTable(rows){
  const values=[];
  for(const r of rows)for(const [p,v]of Object.entries(r.siting_contrasts||{})){
   values.push([esc(designTitle(r.design_id)),esc(label[p]||p),n(r.selected_cells),n(v.native_common_cells),n(v.native_common_hectares),'<code>'+esc(v.mask_sha256)+'</code>',details("Individual original run coverage",v.original_run_valid_cells||r.original_run_valid_cells||r.native_support?.[p])]);
  }
  return table(["Placement","Quantity","Selected region cells","Common finite cells","Common finite ha","Exact support identity","Original run coverage"],values);
 }
 function resultMarkup(){
  if(!result)return '<p>Open a retained comparison or prepare selected completed controls to read their native annual outcomes.</p>';
  const x=result,regions=list(x.regions),choices=[...new Map(regions.map(r=>[regionKey(r),r])).values()];
  if(!choices.some(r=>regionKey(r)===chosenRegion))chosenRegion=regionKey(choices.find(r=>r.kind==="whole_selection")||choices[0]||{});
  const rows=regions.filter(r=>r.support_mode===supportMode&&regionKey(r)===chosenRegion);
  const files=list(x._downloads),plots=files.filter(f=>/\.svg$/i.test(f.filename||f.source_path||""));
  const fileLabel=f=>{const path=f.source_path||f.filename||f.label||"";return x.directory&&path.startsWith(x.directory+"/")?path.slice(x.directory.length+1):path;};
  return '<header><h3>'+esc(x.selection?.title||x.id)+'</h3><p>'+esc(x.selection?.quantity_scope==="model_domain"?"Complete retained model domain":"Original selected reporting area")+'</p><code>'+esc(x.id)+'</code></header>'+
   '<div class="mc-actions">'+button("clone","Use choices for a new comparison")+button("export-result","Download complete result JSON")+'</div>'+
   '<p class="mc-callout">The main comparison uses the intersection of finite baseline, restoration and every selected control output, separately for each pollutant. Positive C − R means less modeled annual stream delivery under restoration. Negative values remain visible.</p>'+
   '<dl class="mc-facts"><div><dt>Selected designs</dt><dd>'+n(x.summary?.design_count)+'</dd></div><div><dt>Distinct placements</dt><dd>'+n(x.summary?.distinct_placements)+'</dd></div><div><dt>Duplicate placements</dt><dd>'+n(x.summary?.duplicate_placements)+'</dd></div></dl>'+
   '<h3>Original control placements</h3>'+table(["Order / design","Native control run","Actual changed area","Placement identity","Same placement as"],list(x.placements).map((p,i)=>[n(i+1)+' · '+esc(p.title||p.design_id),button("run","Open native run",'data-run-id="'+esc(p.control_run_id)+'"')+'<small>'+esc(p.control_run_id)+'</small>',n(p.changed_hectares)+' ha<small>'+n(p.changed_cells)+' cells</small>','<code>'+esc(p.placement_sha256)+'</code>',esc(p.same_placement_as||"Distinct selected placement")]))+
   '<p>Placement identity is based on the original changed cells. These authored controls are deterministic scenarios; counts and overlaps do not create independent statistical replicates.</p>'+
   '<div class="mc-grid"><label><span>Original region</span><select data-mco-region>'+choices.map(r=>option(regionKey(r),(r.kind==="whole_selection"?"Whole selected area":r.kind)+" · "+(r.quantity_scope||"region"),chosenRegion)).join("")+'</select></label><label><span>Native support basis</span><select data-mco-support>'+option("group_common","All selected controls on identical cells",supportMode)+option("per_design","Each baseline / restoration / control triple",supportMode)+'</select></label></div>'+
   (supportMode==="per_design"?'<p class="mc-callout">Each triple may have different valid cells. Read these rows as individual coverage and scenario comparisons; cross-placement differences can include a change in support.</p>':"")+
   '<h3>Annual native stream-delivery outcomes</h3>'+primaryTable(rows)+
   '<p>Each quantity retains its native annual mass unit. A dash means the value is unavailable. These are modeled exports originating in the named source-cell region and reaching modeled streams; they do not represent concentration or a water-utility intake load.</p>'+
   '<h3>Changed-area denominators</h3>'+denominatorTable(rows)+
   '<p>The three areas describe the whole intervention, its allocation within this region, and changed cells within the common output support. Each rate divides the entire region contrast by its named area. A zero denominator remains unavailable. These rates describe whole-scenario behavior, including routing and retention outside converted cells.</p>'+
   '<details><summary>Changes at converted, unchanged and unknown source cells</summary>'+partitionTable(rows)+'</details>'+
   '<details><summary>Native coverage and exact support</summary>'+coverageTable(rows)+details("Common support across the complete selected roster",x.summary?.group_common_support)+'</details>'+
   '<details><summary>Original placement choices, covariate balance and overlaps</summary>'+details("Placements and authored matching choices",x.placements)+details("Spatial overlaps",x.placement_overlaps)+'</details>'+
   '<h3>Retained report, tables and exact map files</h3>'+table(["Original file","Bytes","Open / download"],files.map(f=>[esc(fileLabel(f)),n(f.bytes),'<a href="'+esc(f.url)+'" download="'+esc(f.filename||"")+'">Download</a>']))+
   (plots.length?'<details><summary>Retained native figures</summary><div class="mco-figures">'+plots.map(f=>'<figure><img loading="lazy" src="'+esc(f.url)+'" alt="'+esc(fileLabel(f)||"Retained native outcome figure")+'"><figcaption>'+esc(fileLabel(f))+'</figcaption></figure>').join("")+'</div></details>':"")+
   details("Exact full-resolution maps and support descriptors",{maps:x.maps,support_maps:x.support_maps})+details("Original native binding and conversion provenance",x.binding)+
   '<p class="mco-attribution">Prepared by TokenJunkieLabs. Original native model, source and matching lineage remains in the exported Study and reports.</p>';
 }
 function taskRows(){
  const tasks=list(host.getState()?.tasks);
  return table(["Original request","State","Native operation"],list(desk?.requests).filter(r=>r.body.workspace===workspace).map(r=>{const t=tasks.find(t=>t.id===r.task_id);return[esc(r.body.operation_id),esc(t?.state||(r.task_id?"Retained; open task":"Awaiting receipt")),r.task_id?button("task","Open task",'data-task-id="'+esc(r.task_id)+'"'):button("retry","Recover same request",'data-operation-id="'+esc(r.body.operation_id)+'" '+(busy?"disabled":""))];}));
 }
 function render(){
  if(!node)return;
  node.innerHTML='<div class="mc-desk" data-mco-desk><header class="page-header"><div><p class="eyebrow">UPPER SAVANNAH MODELING</p><h1>Control outcomes</h1><p>Compare retained native baseline, restoration and control runs on common cells.</p></div><div class="mc-actions">'+button("reload","Refresh native results")+button("controls","Matched controls")+button("export","Export comparison choices")+button("import","Reopen comparison choices")+button("backup","Export original Workspace")+'</div></header><div data-mco-error role="alert" hidden></div><div data-mco-notice role="status" aria-live="polite" hidden></div><input type="file" accept=".json,application/json" data-mco-import hidden>'+
   '<section class="mc-section" data-mco-form>'+form()+'</section><section class="mc-section"><h2>Native source preview</h2><div data-mco-preview>'+previewMarkup()+'</div></section>'+
   '<section class="mc-section"><h2>Saved native comparisons</h2><div class="mc-actions"><label><span>Comparison</span><select data-mco-saved>'+option("","Choose a retained comparison",desk?.selected_id)+[...list(catalog?.outcomes),...(result&&!list(catalog?.outcomes).some(x=>x.id===result.id)?[result]:[])].map(x=>option(x.id,x.selection?.title||x.title||x.id,desk?.selected_id)).join("")+'</select></label>'+button("open","Open comparison")+'</div><div data-mco-result>'+resultMarkup()+'</div></section>'+
   '<section class="mc-section"><h2>Original native analysis tasks</h2><div data-mco-tasks>'+taskRows()+'</div></section>'+
   (list(catalog?.issues).length?'<section class="mc-section"><h2>Original source catalogue</h2><ul>'+catalog.issues.map(x=>'<li>'+esc(typeof x==="string"?x:JSON.stringify(x))+'</li>').join("")+'</ul></section>':"")+'</div>';
  notify();
 }
 async function openOutcome(id,{isCurrent=()=>true}={}){
  if(!id||!isCurrent())return;const w=workspace,g=generation,own=++inspectGeneration;
  const value=await read("inspect",{outcome_id:id},w);
  if(!active(w,g)||own!==inspectGeneration||!isCurrent())return;
  if(value.id!==id||value.schema!=="upstate.multivariate-control-outcomes/v1"||!value.binding?.project_id||desk&&value.binding.project_id!==desk.project_id)throw Error("The returned outcome differs from this original project and saved identity.");
  if(!desk){const project=value.binding?.project_id;if(typeof project!=="string"||!project)throw Error("The saved outcome is missing its original project identity.");const raw=storage.getItem(key(w));desk=raw?validateDesk(JSON.parse(raw),project):emptyDesk(project);}
  const next=clone(desk);next.selected_id=id;write(next);result=value;supportMode="group_common";chosenRegion="";render();
 }
 async function loadCatalog(){
  const w=workspace,g=generation,own=++loadGeneration,value=await read("catalog",{},w);
  if(!active(w,g)||own!==loadGeneration)return;
  if(!desk){const raw=storage.getItem(key(w));desk=raw?validateDesk(JSON.parse(raw),value.project_id):emptyDesk(value.project_id);}
  if(desk.project_id!==value.project_id)throw Error("The original project identity changed.");
  catalog=value;render();
  if(desk.selected_id&&list(value.outcomes).some(x=>x.id===desk.selected_id))await openOutcome(desk.selected_id);
 }
 async function sendRetained(request){
  const w=workspace,g=generation,project=desk.project_id;
  if(request.body.workspace!==w)throw Error("Open this request's original Workspace before recovering its task.");
  busy=true;error="";message="Submitting the retained native analysis request…";render();
  try{
   const task=await host.api("/api/actions",{method:"POST",body:clone(request.body)}),raw=storage.getItem(key(w));
   if(!raw)throw Error("Original request storage is missing; retain returned task "+task.id+".");
   const received=retainReceipt(validateDesk(JSON.parse(raw),project),request.body.operation_id,task);persistDesk(storage,key(w),received);
   if(!active(w,g))return;
   desk=received;message="Original analysis task "+task.state+". Open the task to follow progress.";
   await host.refresh({force:true});if(active(w,g))await loadCatalog();
  }catch(e){if(active(w,g))fail(new Error(e.message+" Recover the same retained request to obtain its original task."));}
  finally{if(active(w,g)){busy=false;render();}}
 }
 function capture(target){
  if(!desk||busy||!node?.contains(target))return;
  if(target.matches?.("[data-mco-support]")){supportMode=target.value;const out=node.querySelector("[data-mco-result]");if(out)out.innerHTML=resultMarkup();return;}
  if(target.matches?.("[data-mco-region]")){chosenRegion=target.value;const out=node.querySelector("[data-mco-result]");if(out)out.innerHTML=resultMarkup();return;}
  const next=clone(desk);let changed=false;
  if(target.dataset.mcoField){next.draft[target.dataset.mcoField]=target.value;changed=true;}
  if(target.dataset.mcoDesign){const id=target.dataset.mcoDesign;next.draft.design_ids=next.draft.design_ids.filter(x=>x!==id);if(target.checked)next.draft.design_ids.push(id);changed=true;}
  if(target.dataset.mcoPollutant){const p=target.dataset.mcoPollutant;next.draft.pollutants=next.draft.pollutants.filter(x=>x!==p);if(target.checked)next.draft.pollutants.push(p);changed=true;}
  if(!changed)return;
  desk=next;preview=null;error="";message="";
  try{write(next);}catch(e){fail(new Error("Choices remain in this view but browser storage failed: "+e.message+" Export the comparison choices to retain them."));}
  const out=node.querySelector("[data-mco-preview]");if(out)out.innerHTML=previewMarkup();
  node.querySelector('[data-mco-action="prepare"]')?.setAttribute("disabled","");
  if(target.type==="checkbox"||target.tagName==="SELECT")render();else notify();
 }
 async function click(event){
  const target=event.target.closest?.("[data-mco-action]");if(!target||!node?.contains(target)||target.disabled)return;
  const action=target.dataset.mcoAction,w=workspace,g=generation;
  try{
   if(action==="controls"){await host.navigate("multivariate-control");return;}
   if(action==="backup"){await host.openBackup();return;}
   if(action==="reload"){await loadCatalog();return;}
   if(action==="export"){if(!desk)throw Error("Load the original project first.");download(desk,"matched-control-outcome-desk.json");return;}
   if(action==="import"){node.querySelector("[data-mco-import]").click();return;}
   if(action==="open"){await openOutcome(node.querySelector("[data-mco-saved]").value);return;}
   if(action==="export-result"){if(result)download(result,"matched-control-outcomes-"+result.id+".json");return;}
   if(action==="run"){await host.openItem("runs",target.dataset.runId);return;}
   if(action==="task"){await host.showTask(target.dataset.taskId);return;}
   if(busy)return;
   if(action==="retry"){const r=desk.requests.find(x=>x.body.operation_id===target.dataset.operationId);if(!r)throw Error("Choose a saved original request.");await sendRetained(r);return;}
   if(action==="new"){const next=clone(desk);next.draft=blankDraft();write(next);preview=null;render();return;}
   if(action==="clone"){if(!result)throw Error("Open a saved outcome first.");const next=clone(desk);next.draft=draftFromSelection(result.selection);write(next);preview=null;message="Original comparison choices copied into the editable draft.";render();return;}
   if(action==="preview"){
    const selection=selectionFromDraft(desk.draft,catalog),exact=canonical(selection);busy=true;error="";message="Reviewing exact original native sources…";render();
    try{const value=await read("preview",{selection},w);if(active(w,g)&&exact===canonical(safely())){preview=value;message="Original sources bound. Preparation will verify the same native inputs.";}}
    finally{if(active(w,g)){busy=false;render();}}return;
   }
   if(action==="prepare"){
    const selection=selectionFromDraft(desk.draft,catalog);
    if(!preview||canonical(preview.selection)!==canonical(selection))throw Error("Review these exact current native choices first.");
    const prepared=prepareRequest(desk,workspace,{selection,expected_id:preview.id},globalThis.crypto.randomUUID().replaceAll("-",""));
    prepared.desk.selected_id=preview.id;write(prepared.desk);await sendRetained(prepared.request);
   }
  }catch(e){if(active(w,g))fail(e);}
 }
 async function input(event){
  if(event.target.matches?.("[data-mco-import]")){
   const file=event.target.files?.[0],w=workspace,g=generation;if(!file||!desk||busy)return;
   try{const value=JSON.parse(await file.text());if(!active(w,g))return;write(mergeDesk(value,desk));preview=null;result=null;message="Complete original comparison choices and requests reopened.";await loadCatalog();}
   catch(e){if(active(w,g))fail(e);}return;
  }
  capture(event.target);
 }
 function update(state){
  if(!node||host.getWorkspace()!==workspace)return;
  const signature=canonical(list(state?.tasks).filter(x=>x.workspace===workspace&&x.action==="control.outcomes.prepare").map(x=>[x.id,x.state]));
  const out=node.querySelector("[data-mco-tasks]");if(out)out.innerHTML=taskRows();
  if(fingerprint&&signature!==fingerprint&&!busy){const w=workspace,g=generation;loadCatalog().catch(e=>{if(active(w,g))fail(e);});}
  fingerprint=signature;
 }
 async function mount(target){
  detach();node=target;workspace=host.getWorkspace();generation++;catalog=null;desk=null;preview=null;result=null;busy=false;error="";message="";fingerprint="";supportMode="group_common";chosenRegion="";
  node.addEventListener("click",click);node.addEventListener("input",input);node.addEventListener("change",input);render();
  const w=workspace,g=generation;try{await loadCatalog();}catch(e){if(active(w,g))fail(e);}
 }
 function detach(){generation++;loadGeneration++;inspectGeneration++;if(node){node.removeEventListener("click",click);node.removeEventListener("input",input);node.removeEventListener("change",input);}node=null;workspace=null;}
 async function openSavedOutcome({workspace_key,outcome_id,isCurrent=()=>true}){if(!isCurrent())return;if(!node||workspace!==workspace_key||host.getWorkspace()!==workspace_key)throw Error("Open this outcome's original project desk.");await openOutcome(outcome_id,{isCurrent});}
 return {mount,update,detach,openSavedOutcome};
}
