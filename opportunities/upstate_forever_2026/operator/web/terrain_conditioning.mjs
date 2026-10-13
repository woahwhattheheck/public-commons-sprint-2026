/** Original terrain editions, native response and retained scientific-report promotion.
 * TokenJunkieLabs. Native sources/models remain in the original Workspace and queue.
 */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>typeof v==='number'?(v!==0&&Math.abs(v)<0.001?v.toExponential(3):(v===0?0:v).toLocaleString(undefined,{maximumFractionDigits:3})):String(v??'—');
const copy=v=>JSON.parse(JSON.stringify(v));
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const ident=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const canonical=v=>JSON.stringify(sort(v));
function sort(v){if(Array.isArray(v))return v.map(sort);if(object(v))return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])]));return v;}
const requestId=()=>{if(typeof crypto.randomUUID==='function')return crypto.randomUUID();const a=crypto.getRandomValues(new Uint8Array(16));a[6]=(a[6]&15)|64;a[8]=(a[8]&63)|128;const h=Array.from(a,x=>x.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);};
export function createTerrainConditioning(host){
 let root=null,workspace=null,epoch=0,alive=false,retained=null,selected=null,draft={},requests={},busy=false;
 let currentCase=null,currentResponse=null,selectedResponse=null,reportDrafts={},reportSelected={},reportPreview=null,reportResult=null;
 let storageError=null;
 let loadSerial=0,detailSerial=0,sourceSerial=0,previewSerial=0,busySerial=0,taskSignature='';
 const $=s=>root?.querySelector(s),key=(w=workspace)=>'terrain-input-draft:'+w;
 const endpoint=(p,w=workspace)=>'/api/terrain-conditioning?'+new URLSearchParams({workspace:w,...p});
 const state=()=>host.getState();
 const active=(w,e)=>alive&&root&&epoch===e&&workspace===w&&host.getWorkspace()===w;
 const status=t=>{if($('#tc-status'))$('#tc-status').textContent=t;};
 function error(e){if(alive)status(e?.message||String(e));}
 function stored(w){
  const raw=localStorage.getItem(key(w)),v=raw?JSON.parse(raw):{};
  if(!object(v)||v.draft!==undefined&&!object(v.draft)||v.requests!==undefined&&!object(v.requests))throw Error('Reopen the complete original terrain choices; their saved format is invalid.');
  for(const r of Object.values(v.requests||{}))if(!object(r)||typeof r.operation_id!=='string'||typeof r.action!=='string'||!object(r.payload)||r.workspace!==w||r.task_id!==undefined&&!ident(r.task_id))throw Error('A retained terrain request no longer matches this Workspace.');
  return {draft:v.draft||{},requests:v.requests||{},selected:v.selected||null,
   selectedResponse:v.selectedResponse||null,reportDrafts:object(v.reportDrafts)?v.reportDrafts:{},reportSelected:object(v.reportSelected)?v.reportSelected:{}};
 }
 function snapshot(){return {draft:copy(draft),requests:copy(requests),selected,selectedResponse,reportDrafts:copy(reportDrafts),reportSelected:copy(reportSelected)};}
 function persist(w,value){if(storageError&&w===workspace)throw Error('Saved terrain choices are unreadable; preserve that original record before submitting another request.');const exact=JSON.stringify(value);localStorage.setItem(key(w),exact);if(localStorage.getItem(key(w))!==exact)throw Error('Save the original terrain choices and request before submitting. Export or restore browser storage if it is unavailable.');}
 function capture(){if(!root)return;for(const e of root.querySelectorAll('[data-field]'))draft[e.dataset.field]=e.value;
  if(currentResponse){const d=reportDrafts[currentResponse.id]||(reportDrafts[currentResponse.id]={title:currentResponse.title+' — scientific report',reason:''});for(const e of root.querySelectorAll('[data-report-field]'))d[e.dataset.reportField]=e.value;}}
 function save(event){if(!alive)return;capture();if(event?.target?.dataset?.reportField){reportPreview=null;previewSerial++;renderPreview();renderButtons();}try{persist(workspace,snapshot());}catch(e){error(e);}}
 function strictSave(){if(storageError)throw storageError;capture();persist(workspace,snapshot());}
 function bindResponse(value,id,w,kind){
  if(!object(value)||value.id!==id||value.workspace_key!==w)throw Error('The returned '+kind+' differs from this original Workspace and saved identity.');
  return value;
 }
 function renderButtons(){root?.querySelectorAll('[data-submit]').forEach(b=>b.disabled=busy);root?.querySelectorAll('[data-report-field]').forEach(e=>e.disabled=busy);
  const prepare=$('[data-report-prepare]');if(prepare)prepare.disabled=busy||!reportPreview;}
 function requestRows(){
  const target=$('#tc-requests');if(!target)return;
  const rows=Object.values(requests),tasks=state()?.tasks||[];
  target.innerHTML=rows.length?'<div class="tc-scroll"><table><thead><tr><th>Original action</th><th>Operation / task</th><th>State</th><th>Continue</th></tr></thead><tbody>'+rows.map(r=>{
   const task=tasks.find(t=>t.id===r.task_id&&t.workspace===workspace);
   return '<tr><td>'+esc(r.action)+'</td><td class="tc-id">'+esc(r.operation_id)+(r.task_id?'<br>'+esc(r.task_id):'')+'</td><td>'+esc(task?.state||(r.task_id?'Receipt retained':'Reply not retained'))+'</td><td>'+(r.task_id?'<button data-task="'+esc(r.task_id)+'">Open original task</button> ':'')+'<button data-retry="'+esc(r.operation_id)+'" data-submit>Recover same request</button></td></tr>';
  }).join('')+'</tbody></table></div>':'<p>No original queue request has been submitted from this desk.</p>';renderButtons();
 }
 async function sendRequest(r){
  if(busy)throw Error('Wait for the current queue submission to return before recovering another request.');
  const w=workspace,e=epoch,own=++busySerial,body={operation_id:r.operation_id,action:r.action,payload:copy(r.payload),workspace:r.workspace};
  if(body.workspace!==w)throw Error('Open this request’s original Workspace.');
  persist(w,snapshot());busy=true;renderButtons();status('Submitting the retained original queue request…');
  try{
   const task=await host.api('/api/actions',{method:'POST',body});
   if(!ident(task?.id))throw Error('The original queue returned an incomplete task receipt.');
   const disk=stored(w),match=Object.values(disk.requests).find(x=>x.operation_id===body.operation_id);
   if(!match||canonical({operation_id:match.operation_id,action:match.action,payload:match.payload,workspace:match.workspace})!==canonical(body))throw Error('Keep accepted task '+task.id+'; the original local request changed before its reply.');
   if(match.task_id&&match.task_id!==task.id)throw Error('The same operation returned a different task identity.');
   match.task_id=task.id;persist(w,disk);
   if(!active(w,e))return task;
   requests=disk.requests;status('Original task retained · '+task.id);requestRows();
   await host.refresh();if(active(w,e))await load();
   return task;
  }catch(err){if(active(w,e))error(err);throw err;}
  finally{if(active(w,e)&&own===busySerial){busy=false;renderButtons();}}
 }
 async function request(action,payload){
  if(busy)throw Error('Wait for the current original queue submission.');
  strictSave();const fingerprint=canonical([action,payload]);
  let r=Object.values(requests).find(x=>x.workspace===workspace&&canonical([x.action,x.payload])===fingerprint);
  if(!r){r={operation_id:requestId(),action,payload:copy(payload),workspace};requests[fingerprint]=r;}
  persist(workspace,snapshot());requestRows();return sendRequest(r);
 }
 const entries=()=> (retained?.sources||[]).flatMap(c=>(c.entries||[]).map(e=>({id:c.id+'/'+e.id,title:c.title+' · '+e.title,entry:e})));
 function options(node,rows,value,blank='Choose an original source'){
  node.innerHTML='<option value="">'+esc(blank)+'</option>'+rows.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.title)+'</option>').join('')+(value&&!rows.some(x=>x.id===value)?'<option value="'+esc(value)+'">Retained choice unavailable · '+esc(value)+'</option>':'');
  if(value)node.value=value;
 }
 function values(){const [dem_collection_id,dem_source_id]=(draft.dem||'').split('/'),[hydro_collection_id,hydro_source_id]=(draft.hydro||'').split('/');let where=null;if(draft.where?.trim())where=JSON.parse(draft.where);return {title:draft.title,dem_collection_id,dem_source_id,context_collection_id:draft.context||dem_collection_id,purpose:draft.purpose||'',nodata_boundary:draft.boundary||'edge-and-nodata',burn_depths_m:(draft.depths||'').split(/[,\s]+/).filter(Boolean).map(Number),corridor_half_width_m:Number(draft.width||0),...(hydro_source_id?{hydro_collection_id,hydro_source_id,hydro_layer:draft.layer||null,hydro_where:where}:{})};}
 function form(){const e=entries();options($('#tc-dem'),e.filter(x=>x.entry.kind==='raster'&&['m','metre','metres','meter','meters'].includes(String(x.entry.units||'').toLowerCase())),draft.dem);options($('#tc-hydro'),e.filter(x=>x.entry.kind==='vector'),draft.hydro,'No stream burning');options($('#tc-context'),(retained?.sources||[]).map(c=>({id:c.id,title:c.title})),draft.context,'Use original DEM source collection');for(const n of root.querySelectorAll('[data-field]'))if(n.tagName!=='SELECT'&&draft[n.dataset.field]!==undefined)n.value=draft[n.dataset.field];$('#tc-boundary').value=draft.boundary||'edge-and-nodata';}
 function cases(){const rows=retained?.cases||[];$('#tc-cases').innerHTML=rows.length?'<div class="tc-scroll"><table><thead><tr><th>Saved terrain case</th><th>State</th><th>Editions</th><th>Open</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.title)+'<div class="tc-id">'+esc(r.id)+'</div></td><td>'+esc(r.state)+'</td><td>'+((r.variants||[]).length)+'</td><td><button data-open="'+esc(r.id)+'">Open</button></td></tr>').join('')+'</tbody></table></div>':'<p>No saved terrain cases. Select a retained DEM above to prepare one.</p>';}
 function renderCase(r){currentCase=r;const id=r.id;const c=r.case,rows=r.variants||[];$('#tc-result').innerHTML='<h3>'+esc(c.title)+'</h3><p class="tc-id">'+esc(id)+'</p><p>Source classification: <strong>'+esc(c.source_classification||'Retained publisher/source record')+'</strong>. '+esc(c.dem.source_title||c.dem.source_id)+'.</p><div class="tc-actions"><button data-run="'+esc(id)+'" data-submit>Prepare / resume terrain editions</button><button id="tc-copy">Edit as a new saved case</button></div><p>'+esc(r.progress?.phase||r.state)+'</p>'+(rows.length?'<div class="tc-scroll"><table><thead><tr><th>Edition</th><th>Changed ha</th><th>Raise max (m)</th><th>Lower max (m)</th><th>Fill (m³)</th></tr></thead><tbody>'+rows.map(v=>'<tr><td>'+esc(v.name)+'</td>'+[v.statistics.changed_area_ha,v.statistics.maximum_raise_m,v.statistics.maximum_lower_m,v.statistics.fill_volume_m3].map(x=>'<td>'+fmt(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div><p>'+esc(r.interpretation)+'</p><div class="tc-grid"><label>Completed terrain edition<select id="tc-variant">'+rows.map(v=>'<option>'+esc(v.name)+'</option>').join('')+'</select></label><label>Original native reference run<select id="tc-base-run"><option value="">Choose a retained run</option>'+((state()?.data?.runs)||[]).map(run=>'<option value="'+esc(run.id)+'">'+esc(run.id.slice(0,16)+' · '+run.state)+'</option>').join('')+'</select></label></div><div class="tc-actions"><button id="tc-native" data-submit>Prepare new native comparison run</button></div><p class="tc-note">This retains the original profile, scenario, reporting geometry and model version, and changes the DEM source. Execute the resulting run through the original Run action.</p>':'')+nativeLinks(id)+responseLinks(id)+'<div id="tc-native-response"></div><div id="tc-files">'+downloadGroups(r)+'</div><details><summary>Saved source selection</summary><pre>'+esc(JSON.stringify(c,null,2))+'</pre></details>';
 $('#tc-copy').onclick=()=>{draft={title:c.title+' / revised',dem:c.dem.collection_id+'/'+c.dem.source_id,context:c.context_collection_id,hydro:c.hydrography?c.hydrography.collection_id+'/'+c.hydrography.source_id:'',layer:c.hydrography?.layer||'',where:c.hydrography?.where?JSON.stringify(c.hydrography.where):'',depths:c.burn_depths_m.join(', '),width:String(c.corridor_half_width_m),boundary:c.nodata_boundary,purpose:c.purpose};form();save();};
 if($('#tc-native'))$('#tc-native').onclick=()=>perform(()=>request('terrain.conditioning.native.prepare',{case_id:id,variant:$('#tc-variant').value,run_id:$('#tc-base-run').value}));renderButtons();}
 function downloadGroups(result){if(!host.fileList)return '<p>Open the completed task for its original downloads.</p>';const files=result._downloads||[],groups=new Map();for(const f of files){const parts=String(f.label||f.filename).split(' / '),name=(result.variants||[]).some(v=>v.name===parts[0])?parts[0]:'Comparison and source record';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(f);}return '<h3>Original files and full-resolution GIS</h3>'+Array.from(groups,([name,items])=>'<details class="tc-downloads"><summary>'+esc(name)+' · '+items.length+' files</summary>'+host.fileList(items)+'</details>').join('');}
 function nativeLinks(id){const bindings=(retained?.bindings||[]).filter(b=>b.case_id===id&&b.run_id);return bindings.length?'<h3>Prepared native comparisons</h3><div class="tc-actions"><button data-compare="'+esc(id)+'" data-submit>Compare completed native terrain runs</button></div><div class="tc-scroll"><table><tr><th>Terrain edition</th><th>Native run</th><th>Execute</th></tr>'+bindings.map(b=>'<tr><td>'+esc(b.variant)+'</td><td class="tc-id">'+esc(b.run_id)+'</td><td><button data-native-start="'+esc(b.run_id)+'" data-submit>Run native models</button></td></tr>').join('')+'</table></div>':'';}
 function responseLinks(id){const rows=(retained?.responses||[]).filter(r=>r.case_id===id);return rows.length?'<h3>Saved native responses</h3><div class="tc-actions">'+rows.map(r=>'<button data-response="'+esc(r.id)+'">Open native response · '+esc(r.id.slice(0,12))+'</button>').join('')+'</div>':'';}

 function perform(action){const w=workspace,e=epoch;try{Promise.resolve(action()).catch(err=>{if(active(w,e))error(err);});}catch(err){if(active(w,e))error(err);}}
 async function open(id,{isCurrent=()=>true}={}){
  if(!ident(id))throw Error('Choose the original saved terrain case.');
  if(!isCurrent())return;capture();const w=workspace,e=epoch,own=++detailSerial;
  const current=()=>active(w,e)&&own===detailSerial&&isCurrent();
  try{
   const r=await host.api(endpoint({action:'get',id},w));if(!current())return;
   bindResponse(r,id,w,'terrain case');if(!object(r.case)||r.case.id!==id)throw Error('The saved terrain case record changed.');
   selected=id;selectedResponse=null;currentResponse=null;reportPreview=null;reportResult=null;sourceSerial++;previewSerial++;
   if(!storageError)persist(w,snapshot());renderCase(r);return r;
  }catch(err){if(current())throw err;}
 }
 function responseMarkup(r){
  return '<h3>'+esc(r.title)+'</h3><p class="tc-id">'+esc(r.id)+'</p><p>Source classification: <strong>'+esc(r.source_classification||currentCase?.case?.source_classification||'Original source classification retained')+'</strong>.</p><p>'+esc(r.interpretation)+'</p>'+
   '<p class="tc-note">Change is alternative minus baseline. Each quantity uses the same valid cells across the baseline and every selected terrain edition. Positive values mean greater modeled export; negative values mean less. These are terrain-input sensitivities, not measured water concentrations or evidence of improved predictive accuracy.</p>'+
   '<div class="tc-scroll"><table><thead><tr><th>Terrain / quantity</th><th>Baseline</th><th>Alternative</th><th>Change</th><th>Annual units</th><th>Common ha</th><th>Lost / gained cells</th></tr></thead><tbody>'+(r.rows||[]).map(x=>'<tr>'+[x.variant+' / '+x.metric.replaceAll('_',' '),x.baseline_joint_total,x.alternative_joint_total,x.change_joint_total,x.units,x.joint_area_ha,x.lost_valid_cells+' / '+x.gained_valid_cells].map(v=>'<td>'+esc(fmt(v))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'+downloadGroups(r)+
   '<section class="tc-report-source tc-box"><h3>Use this completed response in a scientific report</h3><p>The source keeps the original common-support quantities, terrain choices, classifications, figures and complete GIS companions. Preparing it reuses the completed model outputs. The ordered report composer remains in Sources.</p>'+
   '<div class="tc-grid"><label>Scientific source title<input data-report-field="title"></label><label>Scientific question and interpretation<textarea data-report-field="reason"></textarea></label></div>'+
   '<div class="tc-actions"><button data-report-preview data-submit>Preview original report source</button><button data-report-prepare data-submit disabled>Prepare scientific source</button></div><div id="tc-report-preview"></div>'+
   '<h4>Saved scientific sources for this response</h4><div class="tc-actions"><label>Retained source<select id="tc-report-source"></select></label><button data-report-open>Open saved scientific source</button></div><div id="tc-report-result"></div></section>';
 }
 function reportSelection(){if(!currentResponse)throw Error('Open a completed native response first.');capture();const d=reportDrafts[currentResponse.id]||{};const title=String(d.title||'').trim(),reason=String(d.reason||'').trim();if(!title||!reason)throw Error('Enter the scientific source title and interpretation before previewing.');return {response_id:currentResponse.id,title,reason};}
 function reportChoices(){
  const rows=new Map();for(const r of [...(retained?.report_sources||[]),...(currentResponse?.report_sources||[])])if(r.response_id===currentResponse?.id)rows.set(r.id,r);
  if(reportResult)rows.set(reportResult.id,{id:reportResult.id,title:reportResult.selection.title,response_id:currentResponse.id});
  return [...rows.values()];
 }
 function renderReportForm(){
  if(!currentResponse)return;
  const d=reportDrafts[currentResponse.id]||(reportDrafts[currentResponse.id]={title:currentResponse.title+' — scientific report',reason:''});
  for(const node of root.querySelectorAll('[data-report-field]'))node.value=d[node.dataset.reportField]||'';
  options($('#tc-report-source'),reportChoices(),reportSelected[currentResponse.id],'Choose a retained scientific source');
  renderPreview();renderReportResult();renderButtons();
 }
 function renderPreview(){
  const node=$('#tc-report-preview');if(!node)return;
  node.innerHTML=reportPreview?'<p>Original source bound · <code>'+esc(reportPreview.id)+'</code></p><p>Case <span class="tc-id">'+esc(reportPreview.binding.case_id)+'</span> · response <span class="tc-id">'+esc(reportPreview.selection.response_id)+'</span></p><details><summary>Complete original source summary</summary><pre>'+esc(JSON.stringify(reportPreview.summary,null,2))+'</pre></details>':'<p class="tc-note">Preview the exact saved native response and these authored report choices.</p>';
 }
 function renderReportResult(){
  const node=$('#tc-report-result');if(!node)return;
  node.innerHTML=reportResult?'<h4>'+esc(reportResult.selection.title)+'</h4><p>'+esc(reportResult.selection.reason)+'</p><p class="tc-id">'+esc(reportResult.id)+'</p><p>Original source collection <code>'+esc(reportResult.source.source_collection_id)+'</code><br>Source <code>'+esc(reportResult.source.source_id)+'</code></p><div class="tc-actions"><button data-report-compose>Open in scientific report composer</button><button data-report-download>Download complete source record</button></div>'+downloadGroups(reportResult):'<p>No retained source is open. Preparing a source appears in the original queue below.</p>';
 }
 async function openReportSource(id,{isCurrent=()=>true}={}){
  if(!ident(id))throw Error('Choose an original retained scientific source.');if(!currentResponse||!isCurrent())return;
  const responseId=currentResponse.id,w=workspace,e=epoch,own=++sourceSerial;
  const current=()=>active(w,e)&&own===sourceSerial&&currentResponse?.id===responseId&&isCurrent();
  try{
   const r=await host.api(endpoint({action:'report-source',id},w));if(!current())return;
   bindResponse(r,id,w,'terrain scientific source');
   const project=state()?.data?.project?.id;
   if(r.schema!=='upstate.terrain-conditioning-report-source/v1'||r.state!=='complete'||r.selection?.response_id!==responseId||r.binding?.response_id!==responseId||r.binding?.case_id!==currentCase?.id||project&&r.binding?.project_id!==project||!ident(r.source?.source_collection_id)||typeof r.source?.source_id!=='string'||!r.source.source_id)throw Error('The retained scientific source differs from this exact native response and project.');
   reportResult=r;reportSelected[responseId]=id;if(!storageError)persist(w,snapshot());renderReportForm();return r;
  }catch(err){if(current())throw err;}
 }
 async function openResponse(id,{isCurrent=()=>true}={}){
  if(!ident(id))throw Error('Choose the original saved native response.');if(!isCurrent())return;
  capture();const w=workspace,e=epoch,own=++detailSerial;
  const current=()=>active(w,e)&&own===detailSerial&&isCurrent();
  try{
   const r=await host.api(endpoint({action:'response',id},w));if(!current())return;
   bindResponse(r,id,w,'native terrain response');
   if(r.schema!=='upstate.terrain-native-response/v1'||r.state!=='complete'||!ident(r.selection?.case_id))throw Error('Open a complete original native terrain response.');
   const caseId=r.selection.case_id;
   let c=currentCase;if(c?.id!==caseId)c=await host.api(endpoint({action:'get',id:caseId},w));if(!current())return;
   bindResponse(c,caseId,w,'response terrain case');if(c.case?.id!==caseId)throw Error('The native response lost its original case.');
   selected=caseId;selectedResponse=id;currentResponse=r;reportPreview=null;reportResult=null;sourceSerial++;previewSerial++;
   if(!storageError)persist(w,snapshot());renderCase(c);$('#tc-native-response').innerHTML=responseMarkup(r);renderReportForm();
   const sourceId=reportSelected[id];if(sourceId)await openReportSource(sourceId,{isCurrent:current});
   return r;
  }catch(err){if(current())throw err;}
 }
 async function previewReport(){
  if(busy)throw Error('Wait for the current original operation.');const selection=reportSelection();strictSave();
  const w=workspace,e=epoch,own=++previewSerial,responseId=currentResponse.id,signature=canonical(selection),token=++busySerial;
  const current=()=>active(w,e)&&own===previewSerial&&currentResponse?.id===responseId;
  busy=true;reportPreview=null;renderPreview();renderButtons();status('Reading the exact original terrain response for this report source…');
  try{
   const v=await host.api('/api/terrain-conditioning/report-source-preview',{method:'POST',body:{workspace:w,selection}});
   if(!current())return;
   if(v.workspace_key!==w||!ident(v.id)||canonical(v.selection)!==signature||v.binding?.response_id!==responseId||v.binding?.case_id!==currentCase.id||state()?.data?.project?.id&&v.binding?.project_id!==state().data.project.id)throw Error('The source preview differs from the authored choices or original native project.');
   if(canonical(reportSelection())!==signature)return;
   reportPreview=v;renderPreview();status('Original scientific source preview retained. Prepare these exact choices when ready.');
  }catch(err){if(current())throw err;}
  finally{if(active(w,e)&&token===busySerial){busy=false;renderButtons();}}
 }
 function downloadJSON(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function load(){
  capture();const w=workspace,e=epoch,own=++loadSerial,detail=detailSerial;
  const current=()=>active(w,e)&&own===loadSerial;
  try{
   const v=await host.api(endpoint({action:'catalog'},w));if(!current())return;
   if(v.workspace_key!==w)throw Error('The terrain catalogue belongs to another Workspace.');
   retained=v;form();cases();requestRows();
   if(detail!==detailSerial)return;
   if(selectedResponse)await openResponse(selectedResponse,{isCurrent:current});
   else if(selected)await open(selected,{isCurrent:current});
  }catch(err){if(current())throw err;}
 }

 function click(event){
  const b=event.target.closest?.('button');if(!b||!root?.contains(b)||b.disabled)return;
  perform(async()=>{
   if(b.dataset.task){if(host.showTask)await host.showTask(b.dataset.task);return;}
   if(b.dataset.retry){const r=Object.values(requests).find(x=>x.operation_id===b.dataset.retry);if(!r)throw Error('Select a retained original request.');strictSave();await sendRequest(r);return;}
   if(b.hasAttribute('data-report-preview')){await previewReport();return;}
   if(b.hasAttribute('data-report-prepare')){
    const selection=reportSelection();if(!reportPreview||canonical(reportPreview.selection)!==canonical(selection))throw Error('Preview these exact current report choices first.');
    await request('terrain.conditioning.report-source.prepare',{selection,expected_id:reportPreview.id});return;
   }
   if(b.hasAttribute('data-report-open')){await openReportSource($('#tc-report-source').value);return;}
   if(b.hasAttribute('data-report-compose')){
    if(!reportResult||reportResult.selection.response_id!==currentResponse?.id)throw Error('Open the retained scientific source for this response.');
    await host.openScientificReport({workspace_key:workspace,sources:[copy(reportResult.source)],title:reportResult.selection.title});return;
   }
   if(b.hasAttribute('data-report-download')){if(reportResult)downloadJSON(reportResult,'terrain-scientific-source-'+reportResult.id+'.json');return;}
   if(b.dataset.response){await openResponse(b.dataset.response);return;}
   if(b.dataset.compare){
    const candidates=[...new Set((retained?.bindings||[]).filter(x=>x.case_id===b.dataset.compare&&x.original_run_id).map(x=>x.original_run_id))];
    const baseline=$('#tc-base-run')?.value||(candidates.length===1?candidates[0]:'');
    await request('terrain.conditioning.compare',{case_id:b.dataset.compare,baseline_run_id:baseline});return;
   }
   if(b.dataset.nativeStart){await request('run.start',{run_id:b.dataset.nativeStart});return;}
   if(b.dataset.open){await open(b.dataset.open);return;}
   if(b.dataset.run){await request('terrain.conditioning.run',{case_id:b.dataset.run});}
  });
 }
 async function mount(node,current){
  detach();root=node;alive=true;workspace=host.getWorkspace();const e=++epoch;
  retained=null;currentCase=null;currentResponse=null;reportPreview=null;reportResult=null;busy=false;taskSignature='';
  let readError=null;
  try{const v=stored(workspace);draft=v.draft;requests=v.requests;selected=v.selected;selectedResponse=v.selectedResponse;reportDrafts=v.reportDrafts;reportSelected=v.reportSelected;}
  catch(err){draft={};requests={};selected=null;selectedResponse=null;reportDrafts={};reportSelected={};readError=err;storageError=err;}
 root.innerHTML='<div class="terrain-desk"><h2>Terrain editions</h2><p>Retain the original DEM, compare explicit conditioning choices, then prepare a new native run through the existing scientific workflow.</p><section class="tc-box"><h3>New source-bound case</h3><div class="tc-grid"><label>Case title<input data-field="title" id="tc-title" required></label><label>Original DEM in metres<select data-field="dem" id="tc-dem"></select></label><label>Native context source collection<select data-field="context" id="tc-context"></select></label><label>Original line hydrography<select data-field="hydro" id="tc-hydro"></select></label><details class="tc-advanced"><summary>Advanced original layer and feature selection</summary><label>Layer override (optional)<input data-field="layer" placeholder="Use retained source layer"></label><label>Exact source-field filter (optional JSON object)<input data-field="where" placeholder="Use all original line features"></label></details><label>Stream-burn depths (metres, comma separated)<input data-field="depths" placeholder="Leave empty for raw and fill only"></label><label>Corridor half-width (metres)<input data-field="width" type="number" min="0" step="any" value="0"></label><label>Outlet boundary<select data-field="boundary" id="tc-boundary"><option value="edge-and-nodata">Raster edges and NoData-adjacent cells</option><option value="outer-edge-only">Outer raster edges only</option></select></label><label>Purpose and interpretation<textarea data-field="purpose"></textarea></label></div><p class="tc-note">Raw and spill-level-filled editions are always retained. Stream burning requires a selected original line source and explicitly entered depth. Neither depth nor width is treated as a measured channel property. Original source records and native grids remain unchanged.</p><div class="tc-actions"><button id="tc-save" data-submit>Save case</button><button id="tc-refresh">Refresh sources and results</button></div><p id="tc-status" role="status" class="tc-note"></p></section><section class="tc-box"><h3>Saved cases</h3><div id="tc-cases"></div></section><section class="tc-box"><h3>Original queue requests</h3><div id="tc-requests"></div></section><section id="tc-result" class="tc-box tc-result"><p>Open a saved case to inspect its terrain and source files.</p></section></div>';
  root.addEventListener('input',save);root.addEventListener('change',save);root.addEventListener('click',click);
  $('#tc-save').onclick=()=>perform(()=>{strictSave();return request('terrain.conditioning.save',values());});
  $('#tc-refresh').onclick=()=>perform(()=>load());
  form();requestRows();
  try{await load();}catch(err){if(alive&&epoch===e)error(err);}
  if(readError&&alive&&epoch===e)error(readError);
 }
 function update(current){
  if(!alive||!root)return;
  if(host.getWorkspace()!==workspace){perform(()=>mount(root,current));return;}
  const rows=(current?.tasks||[]).filter(t=>t.workspace===workspace&&Object.values(requests).some(r=>r.task_id===t.id));
  const signature=canonical(rows.map(t=>[t.id,t.state]));
  requestRows();
  const n=current?.data?.terrain_conditioning;if(n){retained={...retained,...n};cases();}
  if(signature!==taskSignature){taskSignature=signature;if(rows.some(t=>t.state==='complete')&&!busy)perform(()=>load());}
 }
 function detach(){
  if(root&&alive){capture();try{if(!storageError)persist(workspace,snapshot());}catch{}root.removeEventListener('input',save);root.removeEventListener('change',save);root.removeEventListener('click',click);}
  alive=false;epoch++;loadSerial++;detailSerial++;sourceSerial++;previewSerial++;busySerial++;busy=false;retained=null;root=null;workspace=null;storageError=null;
 }
 function opening(value,idName){
  if(!value||!ident(value[idName]))throw Error('Choose the original saved terrain identity.');
  const current=typeof value.isCurrent==='function'?value.isCurrent:()=>true;if(!current())return null;
  if(!alive||!root||workspace!==value.workspace_key||host.getWorkspace()!==value.workspace_key)throw Error('Open this saved terrain record in its original Workspace.');
  return current;
 }
 async function openSavedCase(value){const current=opening(value,'case_id');if(current)return open(value.case_id,{isCurrent:current});}
 async function openSavedResponse(value){const current=opening(value,'response_id');if(current)return openResponse(value.response_id,{isCurrent:current});}
 return {mount,update,detach,openSavedCase,openSavedResponse};
}
