/** Original restoration-extent operator: explicit sources, exact queued tasks and complete working copies. */
const WORKING='upstate.restoration-extent-working/v1', INPUT='upstate.restoration-extent-study-input/v1';
const ACTIONS=new Set(['restoration-extent.prepare','restoration-extent.report','run.start']);
const clone=x=>structuredClone(x), esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=x=>String(x??'').slice(0,14), fmt=x=>x===null||x===undefined?'—':Number(x).toLocaleString(undefined,{maximumFractionDigits:5});
const canonical=x=>x===null?'null':Array.isArray(x)?'['+x.map(canonical).join(',')+']':typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const uuid=()=>crypto.randomUUID();
const operation=/^[A-Za-z0-9_-]{16,100}$/;
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
function requestShape(r,workspace){if(!object(r)||r.workspace!==workspace||!ACTIONS.has(r.action)||!operation.test(r.operation_id||'')||!object(r.payload))throw Error('The retained original request is incomplete.');return r;}
function taskMatch(task,request,id=null,accepted=null){if(!object(task)||!/^[0-9a-f]{64}$/.test(task.id||'')||!operation.test(task.operation_id||'')||!/^[0-9a-f]{64}$/.test(task.request_sha256||'')||task.workspace!==request.workspace||task.action!==request.action||canonical(task.payload)!==canonical(request.payload)||(id&&task.id!==id)||(accepted&&(task.operation_id!==accepted.operation_id||task.request_sha256!==accepted.request_sha256)))throw Error('The returned task differs from the complete original request and accepted binding.');return task;}
function emptySpec(){return {schema:INPUT,title:'',reason:'',baseline_run_id:'',stream_source:{source_collection_id:'',source_id:''},placements:[],widths_m:[],from_codes:[],to_code:null,scope:'reporting'};}
function validateSpec(s){
 if(!s||s.schema!==INPUT||typeof s.title!=='string'||!s.title.trim()||typeof s.reason!=='string'||!s.reason.trim())throw Error('Name this study and explain the source-bound restoration choice.');
 if(!/^[0-9a-f]{64}$/.test(s.baseline_run_id||''))throw Error('Choose an exact retained baseline run.');
 if(!s.stream_source||typeof s.stream_source!=='object'||!s.stream_source.source_collection_id||!s.stream_source.source_id)throw Error('Choose the retained stream source edition and original source ID.');
 if(!Array.isArray(s.placements)||!s.placements.length||new Set(s.placements.map(x=>x.id)).size!==s.placements.length)throw Error('Provide distinct named placement selections.');
 for(const p of s.placements)if(!p||typeof p.id!=='string'||!p.id.trim()||typeof p.title!=='string'||!p.title.trim()||(p.where!==undefined&&(!p.where||typeof p.where!=='object'||Array.isArray(p.where))))throw Error('Each placement needs its original field selection, ID and title.');
 if(!Array.isArray(s.widths_m)||!s.widths_m.length||s.widths_m.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<=0)||new Set(s.widths_m).size!==s.widths_m.length)throw Error('Enter distinct positive widths in metres on each side of the selected stream.');
 if(!Array.isArray(s.from_codes)||!s.from_codes.length||s.from_codes.some(x=>!Number.isSafeInteger(x))||!Number.isSafeInteger(s.to_code))throw Error('Enter explicit integer source and destination land-cover codes.');
 if(!['reporting','model_domain'].includes(s.scope))throw Error('Select reporting or model-domain support.');
 return s;
}
function validateWorking(w,projectId,workspace){
 if(!object(w)||w.schema!==WORKING||w.project_id!==projectId||w.workspace!==workspace||!operation.test(w.id||'')||!object(w.spec)||!Array.isArray(w.history)||!Array.isArray(w.tasks))throw Error('Select a complete working copy for this original project and operator workspace.');
 const s=w.spec,scalar=x=>x===null||['string','number','boolean'].includes(typeof x);
 if(s.schema!==INPUT||['title','reason','baseline_run_id','scope'].some(k=>typeof s[k]!=='string')||!object(s.stream_source)||typeof s.stream_source.source_collection_id!=='string'||typeof s.stream_source.source_id!=='string'||(s.stream_source.layer!==undefined&&typeof s.stream_source.layer!=='string'))throw Error('The unfinished source selection has an invalid structure.');
 if(s.stream_source.where!==null&&s.stream_source.where!==undefined&&(!object(s.stream_source.where)||Object.values(s.stream_source.where).some(x=>!scalar(x))))throw Error('The original source filters have an invalid structure.');
 for(const name of ['widths_m','from_codes'])if(!Array.isArray(s[name])||s[name].some(x=>x!==null&&(typeof x!=='number'||!Number.isFinite(x))))throw Error('Retain the unfinished numeric choices as an array.');
 if(s.to_code!==null&&(typeof s.to_code!=='number'||!Number.isFinite(s.to_code)))throw Error('The unfinished destination code is invalid.');
 if(s.placements!==null&&(!Array.isArray(s.placements)||s.placements.some(x=>!object(x)||typeof x.id!=='string'||typeof x.title!=='string'||(x.where!==undefined&&x.where!==null&&(!object(x.where)||Object.values(x.where).some(v=>!scalar(v)))))))throw Error('The unfinished placements have an invalid structure.');
 if(w.raw_fields!==undefined&&(!object(w.raw_fields)||Object.values(w.raw_fields).some(x=>typeof x!=='string')))throw Error('Retain the complete unfinished form text.');
 if(w.friendly!==undefined){
  const f=w.friendly,rows=r=>Array.isArray(r)&&r.every(x=>object(x)&&['field','type','value'].every(k=>typeof x[k]==='string'));
  if(!object(f)||!rows(f.shared)||!Array.isArray(f.placements)||f.placements.some(x=>!object(x)||typeof x.id!=='string'||typeof x.title!=='string'||!rows(x.filters)))throw Error('The unfinished placement controls have an invalid structure.');
 }
 if(!Number.isSafeInteger(w.sequence)||w.sequence<0||typeof w.updated_at!=='string'||(w.friendly_error!==undefined&&typeof w.friendly_error!=='string'))throw Error('The working-copy continuation metadata is incomplete.');
 for(const row of w.tasks){if(!object(row))throw Error('Retain each complete original task row.');requestShape(row.request,workspace);taskMatch(row.task,row.request);}
 if(w.pending){
  const p=w.pending,r=requestShape(p.request,workspace);
  if(!Array.isArray(p.attempts)||p.attempts.some(x=>!object(x)||typeof x.state!=='string'))throw Error('Retain every original dispatch observation.');
  if(r.action==='restoration-extent.prepare')validateSpec(r.payload.spec);
  else if(r.action==='restoration-extent.report'&&!/^[0-9a-f]{64}$/.test(r.payload.study_id||''))throw Error('The retained report selection is incomplete.');
  else if(r.action==='run.start'&&!/^[0-9a-f]{64}$/.test(r.payload.run_id||''))throw Error('The retained native run selection is incomplete.');
 }
 return w;
}

function download(text,name,type='application/json'){
 const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function database(){
 return new Promise((resolve,reject)=>{const r=indexedDB.open('upstate-restoration-extents-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('copies',{keyPath:'key'});r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result);});
}
async function transact(mode,fn){
 const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('copies',mode),request=fn(tx.objectStore('copies'));let value;request.onsuccess=()=>{value=request.result;};request.onerror=()=>reject(request.error);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Working-copy retention was interrupted.'));});}finally{db.close();}
}
export function createRestorationExtents(host){
 let root=null,workspace=null,project=null,catalog=null,selected=null,working=null,epoch=0,selectionEpoch=0,busy=false,disposed=true,status='',error='',storageError='',persistQueue=Promise.resolve(),poll=null,polling=false,person=null,fieldSource=null,listeners=null;
 const windowId=uuid(), explicitBackups=new Map(),memoryCopies=new Map();
 const key=w=>w.workspace+':'+w.id;
 const currentWorkspace=()=>host.getWorkspace?.()||host.getState()?.workspace_key;
 const active=(e=epoch,w=workspace)=>!disposed&&e===epoch&&w===workspace&&w===currentWorkspace()&&canonical(person)===canonical(host.getState()?.person??null);
 const $=s=>root?.querySelector(s);
 const endpoint=(path,extra={})=>path+'?'+new URLSearchParams({workspace,...extra});
 function note(message,isError=false){if(isError)error=message;else status=message;renderStatus();}
 function renderStatus(){
  if(!root)return;$('#extent-status').textContent=status;$('#extent-error').textContent=[error,storageError].filter(Boolean).join('\n');
  const pending=!!working?.pending;$('#extent-prepare').disabled=busy||pending;$('#extent-new').disabled=busy;$('#extent-import').disabled=busy;$('#extent-copy-select').disabled=busy;
  const resume=$('#extent-replay');resume.hidden=!pending;resume.disabled=busy;
  $('#extent-pending').textContent=pending?'Retained original request '+working.pending.request.operation_id+' · '+working.pending.request.action+(working.pending.last_error?' · '+working.pending.last_error:''):'No unresolved original request.';
  $('#extent-backup').disabled=!working;$('#extent-form').setAttribute('aria-busy',String(busy));
 }
 function remember(value){
  const frozen=clone(value);memoryCopies.set(key(frozen),frozen);
  const next=persistQueue.catch(()=>{}).then(()=>transact('readwrite',store=>store.put({key:key(frozen),value:frozen,updated_at:frozen.updated_at})));
  persistQueue=next;next.then(()=>{if(working?.id===frozen.id){storageError='';renderStatus();}},e=>{if(working?.id===frozen.id){storageError='This complete working copy is retained in this tab, but browser storage failed: '+e.message+'. Download the complete working file before dispatch or leaving.';renderStatus();}});return next;
 }
 function changed(){
  if(!working)return;working.updated_at=new Date().toISOString();working.sequence++;remember(working).catch(()=>{});
 }
 async function durable(){
  if(!working)throw Error('Open a working copy first.');
  const frozen=clone(working),text=JSON.stringify(frozen,null,2)+'\n';
  try{await remember(frozen);}catch(e){if(explicitBackups.get(key(frozen))!==text)throw Error('Download the exact complete working copy using its button before this request can continue; browser storage did not retain it.');}
  if(!working||canonical(working)!==canonical(frozen))throw Error('The working copy changed while preserving this operation. Review it and repeat.');
 }
 function freezeCopy(reason){
  if(!working)return;const kept=clone(working);kept.id=uuid();kept.parent_id=working.id;kept.name=reason+' · '+(working.name||working.spec.title||'Untitled');kept.updated_at=new Date().toISOString();memoryCopies.set(key(kept),kept);remember(kept).catch(()=>{});
 }
 function adoptWorking(value){selectionEpoch++;working=value;try{sessionStorage.setItem('upstate-restoration-last:'+workspace,working.id);}catch{}remember(working).catch(()=>{});}
 function fresh(spec=emptySpec(),origin=null){
  adoptWorking({schema:WORKING,id:uuid(),window_id:windowId,workspace,project_id:project.id,name:spec.title||'Untitled restoration study',spec:clone(spec),selected_study_id:origin,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),sequence:0,history:[],tasks:[],pending:null});
 }
 function form(){
  const s=working.spec;
  $('#extent-title').value=s.title||'';$('#extent-reason').value=s.reason||'';$('#extent-baseline').value=s.baseline_run_id||'';
  $('#extent-source').value=JSON.stringify([s.stream_source?.source_collection_id||'',s.stream_source?.source_id||'']);
  $('#extent-layer').value=s.stream_source?.layer||'';$('#extent-stream-where').value=JSON.stringify(s.stream_source?.where||{},null,2);
  $('#extent-placements').value=JSON.stringify(s.placements||[],null,2);$('#extent-widths').value=(s.widths_m||[]).join(', ');
  $('#extent-from').value=(s.from_codes||[]).join(', ');$('#extent-to').value=s.to_code??'';$('#extent-scope').value=s.scope||'reporting';renderFriendly();renderStatus();
 }
 function readForm(){
  if(!working)return;const parse=(id,previous)=>{try{return JSON.parse($(id).value);}catch{return previous;}};
  const selectedSource=parse('#extent-source',['','']),source=Array.isArray(selectedSource)?selectedSource:['',''],raw={title:$('#extent-title').value,reason:$('#extent-reason').value,layer:$('#extent-layer').value,stream_where:$('#extent-stream-where').value,placements:$('#extent-placements').value,widths:$('#extent-widths').value,from_codes:$('#extent-from').value,to_code:$('#extent-to').value,scope:$('#extent-scope').value,source:$('#extent-source').value,baseline:$('#extent-baseline').value};
  working.raw_fields=raw;working.spec={schema:INPUT,title:raw.title,reason:raw.reason,baseline_run_id:raw.baseline,
   stream_source:{source_collection_id:source[0],source_id:source[1],...(raw.layer?{layer:raw.layer}:{}),where:parse('#extent-stream-where',null)},
   placements:parse('#extent-placements',null),widths_m:raw.widths.trim()?raw.widths.split(',').map(x=>Number(x.trim())):[],
   from_codes:raw.from_codes.trim()?raw.from_codes.split(',').map(x=>x.trim()?Number(x.trim()):NaN):[],to_code:raw.to_code.trim()?Number(raw.to_code):null,scope:raw.scope};
  working.name=raw.title||'Untitled restoration study';changed();
 }
 function restoreRaw(){
  const r=working.raw_fields;if(!r)return;
  for(const [field,id] of Object.entries({title:'title',reason:'reason',layer:'layer',stream_where:'stream-where',placements:'placements',widths:'widths',from_codes:'from',to_code:'to',scope:'scope',source:'source',baseline:'baseline'}))if(typeof r[field]==='string')$('#extent-'+id).value=r[field];
 }
 function friendlyFromSpec(){
  const filters=where=>Object.entries(where&&typeof where==='object'&&!Array.isArray(where)?where:{}).map(([field,value])=>({field,type:value===null?'null':typeof value,value:value===null?'':String(value)}));
  return {shared:filters(working.spec.stream_source?.where),placements:(Array.isArray(working.spec.placements)?working.spec.placements:[]).map(p=>({id:p.id,title:p.title,filters:filters(p.where)}))};
 }
 function friendlyRows(rows,where,index=''){
  return rows.map((r,n)=>'<div class="extent-filter"><label>Original field<input list="extent-source-fields" data-friendly="field" data-where="'+where+'" data-placement="'+index+'" data-filter="'+n+'" value="'+esc(r.field)+'"></label><label>Value type<select data-friendly="type" data-where="'+where+'" data-placement="'+index+'" data-filter="'+n+'">'+['string','number','boolean','null'].map(t=>'<option'+(t===r.type?' selected':'')+'>'+t+'</option>').join('')+'</select></label><label>Exact source value<input data-friendly="value" data-where="'+where+'" data-placement="'+index+'" data-filter="'+n+'" value="'+esc(r.value)+'"></label><button type="button" data-filter-remove="'+n+'" data-where="'+where+'" data-placement="'+index+'">Remove condition</button></div>').join('');
 }
 function renderFriendly(){
  const target=$('#extent-friendly');if(!target||!working)return;
  const f=working.friendly||friendlyFromSpec();
  target.innerHTML='<h4>Shared stream selection</h4><p>Conditions match original field values exactly. With no conditions, the complete selected layer is admitted.</p>'+friendlyRows(f.shared,'shared')+'<button type="button" data-filter-add="shared">Add shared source condition</button><h4>Named placements</h4>'+f.placements.map((r,i)=>'<fieldset><legend>Placement '+(i+1)+'</legend><label>Placement ID<input data-friendly="id" data-placement="'+i+'" value="'+esc(r.id)+'"></label><label>Placement title<input data-friendly="title" data-placement="'+i+'" value="'+esc(r.title)+'"></label>'+friendlyRows(r.filters,'placement',i)+'<div class="extent-tools"><button type="button" data-filter-add="placement" data-placement="'+i+'">Add placement condition</button><button type="button" data-placement-remove="'+i+'">Remove placement</button></div></fieldset>').join('')+'<button type="button" id="extent-add-placement">Add named placement</button><p class="extent-error">'+esc(working.friendly_error||'')+'</p><datalist id="extent-source-fields">'+Object.keys(fieldSource?.fields||{}).map(x=>'<option value="'+esc(x)+'">').join('')+'</datalist>';
 }
 function applyFriendly(){
  const f=working.friendly;
  const parse=rows=>Object.fromEntries(rows.map(r=>{
   if(!r.field.trim())throw Error('Name every source field, or remove its unfinished condition.');
   if(rows.filter(x=>x.field===r.field).length!==1)throw Error('Use one condition per exact source field.');
   let value=r.value;if(r.type==='number'){if(!value.trim()||!Number.isFinite(Number(value)))throw Error('Enter the original finite numeric value.');value=Number(value);}
   else if(r.type==='boolean'){if(!['true','false'].includes(value))throw Error('A boolean source value must be true or false.');value=value==='true';}
   else if(r.type==='null')value=null;
   else if(r.type!=='string')throw Error('Choose an explicit source value type.');
   return [r.field,value];
  }));
  try{
   const shared=parse(f.shared),placements=f.placements.map(r=>({id:r.id,title:r.title,where:parse(r.filters)}));
   $('#extent-stream-where').value=JSON.stringify(shared,null,2);$('#extent-placements').value=JSON.stringify(placements,null,2);
   working.friendly_error='';readForm();
  }catch(e){working.friendly_error=e.message;changed();renderStatus();}
 }
 function friendlyInput(target){
  if(!target.dataset.friendly)return false;
  if(!working.friendly)working.friendly=friendlyFromSpec();
  const f=working.friendly,field=target.dataset.friendly,index=Number(target.dataset.placement);
  if(field==='id'||field==='title')f.placements[index][field]=target.value;
  else {const rows=target.dataset.where==='shared'?f.shared:f.placements[index].filters;rows[Number(target.dataset.filter)][field]=target.value;}
  applyFriendly();return true;
 }
 async function inspectFields(){
  const e=epoch,w=workspace,owner=working,source=clone(working.spec.stream_source),selection=canonical(source);
  if(!source.source_collection_id||!source.source_id)throw Error('Select the original stream source first.');
  const value=await host.api(endpoint('/api/restoration-extents/source-fields',{source_collection_id:source.source_collection_id,source_id:source.source_id,...(source.layer?{layer:source.layer}:{})}));
  if(!active(e,w)||working!==owner||canonical(owner.spec.stream_source)!==selection)return;
  if(value.workspace_key!==w||value.project_id!==project.id||value.source_collection_id!==source.source_collection_id||value.source_id!==source.source_id)throw Error('The source-field return differs from the selected original.');
  fieldSource=value;renderFriendly();$('#extent-source-preview').innerHTML='<p>'+esc(value.note)+'</p><p>'+esc(value.geometry_type||'')+' · '+esc(value.total_features??'')+' original features</p><p>Layers: '+esc(value.layers.join(', '))+'</p>'+reportTable(Object.entries(value.fields).map(([field,type])=>({field,type})),[['field','Original field'],['type','Provider type']])+(value.examples.length?'<details><summary>Original example values</summary>'+reportTable(value.examples.flatMap(r=>Object.entries(r.properties).map(([field,value])=>({id:r.id,field,value}))),[['id','Feature'],['field','Field'],['value','Original value']])+'</details>':'');
 }
 async function listCopies(){
  let rows=[];try{rows=(await transact('readonly',store=>store.getAll())).map(x=>x.value);}catch(e){storageError='Stored copies could not be read: '+e.message;}
  const all=new Map(rows.filter(x=>x.workspace===workspace&&x.project_id===project.id).map(x=>[key(x),x]));
  for(const [k,v]of memoryCopies)if(v.workspace===workspace&&v.project_id===project.id)all.set(k,v);
  return [...all.values()].sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)));
 }
 async function renderCopies(){
  const e=epoch,rows=await listCopies();if(!active(e))return;
  $('#extent-copy-select').innerHTML='<option value="">Open another complete working copy</option>'+rows.filter(x=>x.id!==working?.id).map(x=>'<option value="'+esc(x.id)+'">'+esc((x.name||'Untitled')+' · '+x.updated_at+(x.pending?' · unresolved request':''))+'</option>').join('');
 }
 function options(){
  $('#extent-baseline').innerHTML='<option value="">Choose the original baseline run</option>'+catalog.runs.map(x=>'<option value="'+esc(x.id)+'">'+esc((x.scenario_title||x.id)+' · '+(x.profile_title||'')+' · '+x.state+' · '+short(x.id))+'</option>').join('');
  $('#extent-source').innerHTML='<option value=\'["",""]\'>Choose a retained vector source</option>'+catalog.vector_sources.map(x=>'<option value="'+esc(JSON.stringify([x.source_collection_id,x.source_id]))+'">'+esc(x.title+' · '+x.vintage+' · '+short(x.source_collection_id))+'</option>').join('');
  $('#extent-studies').innerHTML=catalog.studies.length?catalog.studies.map(x=>'<button type="button" data-study="'+esc(x.id)+'">'+esc(x.title||x.spec?.title||short(x.id))+' <small>'+esc(short(x.id))+'</small></button>').join(''):'<p>No restoration extent studies have been prepared in this project.</p>';
 }
 async function loadCatalog(){
  const e=epoch,w=workspace,value=await host.api(endpoint('/api/restoration-extents/catalog'));if(!active(e,w))return;
  if(value.project.id!==project.id||value.workspace_key!==workspace)throw Error('The original project selection changed.');
  catalog=value;options();form();restoreRaw();await renderCopies();
 }
 function display(value){
  selected=value;const record=value.record,rows=value.current_cases||[],spec=record.spec;
  const runButton=id=>'<button type="button" data-run="'+esc(id)+'">Submit original native run</button><button type="button" data-open-run="'+esc(id)+'">Open native run</button>';
  $('#extent-selected').innerHTML='<h3>'+esc(record.title||spec.title)+'</h3><p>'+esc(record.id)+' · '+esc(spec.scope)+'</p><p>'+esc(spec.reason)+'</p><p>Widths measure metres on each side of the retained stream. Corridor area and actual changed raster area remain separate. Equivalent cell editions share one effective native execution.</p><p><strong>Original baseline:</strong> <code>'+esc(spec.baseline_run_id)+'</code></p><div class="extent-tools">'+runButton(spec.baseline_run_id)+'</div><div class="extent-table"><table><thead><tr><th>Placement / width</th><th>Actual extent</th><th>Prepared source identity</th><th>Effective execution</th></tr></thead><tbody>'+rows.map(x=>'<tr><td>'+esc(x.placement_title||x.placement_id)+'<br>'+esc(fmt(x.width_m))+' m each side</td><td>'+esc(fmt(x.changed_area_ha))+' changed ha<br>'+esc(fmt(x.corridor_area_ha))+' corridor ha<br>'+esc(x.changed_cells)+' changed cells</td><td><code>'+esc(x.run_id)+'</code><small>Footprint '+esc(x.footprint_id||'empty corridor; original baseline')+'</small></td><td>'+esc(x.state)+'<br><code>'+esc(x.execute_run_id)+'</code><p>'+esc(x.geometry_empty?'Empty corridor: baseline retained.':x.execute_run_id!==x.run_id?'Exact categorical cells reuse '+(x.equivalent_case_id||'the baseline')+'.':'Own original native run.')+'</p>'+(x.state==='complete'?'<button type="button" data-open-run="'+esc(x.execute_run_id)+'">Open completed native run</button>':runButton(x.execute_run_id))+'</td></tr>').join('')+'</tbody></table></div><div class="extent-tools"><button type="button" id="extent-report">Build current response report</button><button type="button" id="extent-fork">New study from this definition</button><button type="button" id="extent-refresh-selection">Refresh retained run states</button></div><div id="extent-report-output"></div><details><summary>Complete retained study and source bindings</summary><pre>'+esc(JSON.stringify(value,null,2))+'</pre></details>';
  showReport(value.report);
 }
 function plot(rows){
  const good=rows.filter(r=>Number.isFinite(r.export_reduction));if(!good.length)return '<p>No common valid native support; the original values remain undefined.</p>';
  const xmax=Math.max(1,...good.map(r=>r.changed_area_ha)),ymin=Math.min(0,...good.map(r=>r.export_reduction)),ymax0=Math.max(0,...good.map(r=>r.export_reduction)),ymax=ymax0===ymin?ymin+1:ymax0;
  const X=v=>70+650*v/xmax,Y=v=>300-250*(v-ymin)/(ymax-ymin);
  let svg='<svg viewBox="0 0 800 370" role="img" aria-label="Actual changed hectares and signed native export reduction"><rect width="800" height="370" fill="white"/><path d="M70 40V300H720" fill="none" stroke="#222"/><path d="M70 '+Y(0)+'H720" stroke="#888" stroke-dasharray="3 4"/>';
  for(let i=0;i<6;i++){const x=xmax*i/5,y=ymin+(ymax-ymin)*i/5;svg+='<text x="'+X(x)+'" y="323" text-anchor="middle">'+esc(Number(x.toPrecision(5)))+'</text><text x="62" y="'+(Y(y)+4)+'" text-anchor="end">'+esc(Number(y.toPrecision(5)))+'</text>';}
  const groups=new Map();for(const r of rows){if(!groups.has(r.placement_id))groups.set(r.placement_id,[]);groups.get(r.placement_id).push(r);}
  let index=0;const legend=[];
  for(const [id,points]of groups){index++;let line=[];const dash=['','8 4','2 4','10 3 2 3'][(index-1)%4],flush=()=>{if(line.length)svg+='<polyline points="'+line.join(' ')+'" fill="none" stroke="#222" stroke-width="2" stroke-dasharray="'+dash+'"/>';line=[];};
   for(const r of points.sort((a,b)=>a.width_m-b.width_m)){if(!Number.isFinite(r.export_reduction)){flush();continue;}const x=X(r.changed_area_ha),y=Y(r.export_reduction);line.push(x+','+y);svg+='<circle cx="'+x+'" cy="'+y+'" r="4" fill="white" stroke="#111"><title>'+esc(id+'; '+r.width_m+' m each side; '+r.changed_area_ha+' changed ha; signed reduction '+r.export_reduction+' '+r.units)+'</title></circle><text x="'+(x+5)+'" y="'+(y-6)+'" font-size="11">'+index+'</text>';}
   flush();legend.push(index+': '+(points[0].placement_title||id));
  }
  return svg+'<text x="395" y="351" text-anchor="middle">Actual changed hectares</text><text x="70" y="22">Signed annual export reduction</text></svg><p>'+esc(legend.join(' · '))+'</p>';
 }
 function reportTable(rows,columns){
  return '<div class="extent-table"><table><thead><tr>'+columns.map(([key,label])=>'<th>'+esc(label)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+columns.map(([key])=>'<td>'+esc(row[key]===null||row[key]===undefined?'Not defined':row[key])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
 }
 function showReport(report){
  const target=$('#extent-report-output');if(!target)return;
  if(!report){target.innerHTML='<p>No response report has been retained. Complete the original selected native runs, then build a report. Their actual states stay visible above.</p>';return;}
  const groups=new Map();for(const row of report.curves){const key=row.pollutant+' · '+row.units;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  target.innerHTML='<h3>Retained native response report</h3><p>'+esc(report.title)+' · <code>'+esc(report.id)+'</code></p><div class="extent-tools">'+(report._downloads||[]).map(x=>'<a href="'+esc(x.url)+(x.url.includes('?')?'&':'?')+'download=1" download>'+esc(x.filename||x.artifact_id)+'</a>').join('')+'</div><p>Lines connect discrete original scenarios, without fitting a response model. Negative reduction means increased export. Placement alternatives are not additive.</p>'+[...groups].map(([name,rows])=>'<section><h4>'+esc(name)+'</h4>'+plot(rows)+'</section>').join('')+'<h4>Exact native values and common support</h4>'+reportTable(report.curves,[['placement_title','Placement'],['width_m','Width each side (m)'],['changed_area_ha','Changed ha'],['corridor_area_ha','Corridor ha'],['native_export','Native export'],['export_reduction','Signed reduction'],['units','Units'],['percent_reduction','Reduction %'],['common_valid_cells','Common cells'],['common_area_ha','Common ha'],['common_coverage_fraction','Common coverage'],['status','Status']])+'<h4>Marginal response</h4>'+reportTable(report.marginals,[['placement_id','Placement'],['pollutant','Pollutant'],['from_width_m','From width'],['to_width_m','To width'],['additional_changed_area_ha','Additional changed ha'],['additional_export_reduction','Additional reduction'],['marginal_reduction_per_ha','Reduction / additional ha'],['units','Units'],['status','Status']])+'<dl>'+Object.entries(report.interpretation).map(([k,v])=>'<dt>'+esc(k.replaceAll('_',' '))+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl><details><summary>Complete original report and source identities</summary><pre>'+esc(JSON.stringify(report,null,2))+'</pre></details>';
 }
 async function openStudy(id){
  const e=epoch,w=workspace,owner=working,seq=++selectionEpoch,value=await host.api(endpoint('/api/restoration-extents/inspect',{id}));
  if(!active(e,w)||seq!==selectionEpoch||working!==owner)return;
  if(value.record?.id!==id)throw Error('The retained study differs from the selected identity.');
  working.selected_study_id=id;changed();display(value);
  const report=await host.api(endpoint('/api/restoration-extents/report',{id}));if(active(e,w)&&seq===selectionEpoch&&working===owner)showReport(report.report);
 }
 async function dispatchPending(){
  if(busy||!working?.pending)return;busy=true;error='';renderStatus();
  const e=epoch,w=workspace,owner=working,pending=owner.pending;
  pending.last_error=null;pending.attempts=pending.attempts||[];
  const attempt={started_at:new Date().toISOString(),state:'PRESERVING'};pending.attempts.push(attempt);changed();
  let result;
  try{
   await durable();if(!active(e,w)||working!==owner||owner.pending!==pending)throw Error('The current working copy changed before dispatch.');
   attempt.state='DISPATCHING';owner.sequence++;await durable();
   if(!active(e,w)||working!==owner||owner.pending!==pending)throw Error('The current working copy changed before dispatch.');
   result=await host.api('/api/actions',{method:'POST',body:clone(pending.request)});
   taskMatch(result,pending.request);
  }catch(err){
   attempt.state=attempt.state==='DISPATCHING'?'RETURN_UNCERTAIN':'NOT_DISPATCHED';attempt.error=err.message;pending.last_error=err.message;
   owner.updated_at=new Date().toISOString();owner.sequence++;remember(owner).catch(()=>{});
   if(active(e,w)&&working===owner)error=err.message+' The exact original request remains available for reconciliation.';
   if(active(e,w)&&working===owner){busy=false;renderStatus();}return;
  }
  attempt.state='RETURNED';attempt.result=clone(result);
  owner.tasks.push({request:clone(pending.request),task:clone(result)});
  owner.history.push({kind:'accepted-task',request:clone(pending.request),task:clone(result)});
  owner.pending=null;owner.updated_at=new Date().toISOString();owner.sequence++;
  try{await remember(owner);}catch{
   download(JSON.stringify(owner,null,2)+'\n','Restoration_Complete_Returned_Working.json');
  }
  if(active(e,w)&&working===owner)busy=false;
  if(!active(e,w)||working!==owner){download(JSON.stringify(owner,null,2)+'\n','Restoration_Complete_Returned_Working.json');return;}
  status='Original task '+result.id+' is '+result.state+'.';renderStatus();
  // A later display/read failure cannot change the retained accepted provider result.
  await refreshTasks();
 }
 async function submit(action,payload){
  if(busy)return;if(working.pending)throw Error('Reconcile the retained original request first.');
  if(action==='restoration-extent.prepare'){if(working.friendly_error)throw Error(working.friendly_error);validateSpec(payload.spec);}
  working.pending={request:{workspace,action,payload:clone(payload),operation_id:uuid()},created_at:new Date().toISOString(),attempts:[],last_error:null};changed();await dispatchPending();
 }
 async function refreshTasks(){
  if(polling||disposed||!working)return;polling=true;const e=epoch,w=workspace,owner=working,selectedId=owner.selected_study_id,selection=selectionEpoch;let modified=false;
  try{
   for(const row of owner.tasks){
    if(!['queued','running','interrupted','failed','cancelled','complete'].includes(row.task.state))continue;
    const value=await host.api(endpoint('/api/task',{id:row.task.id}));if(!active(e,w)||working!==owner)return;
    taskMatch(value,row.request,row.task.id,row.task);
    if(canonical(row.task)!==canonical(value)){row.task=value;modified=true;}
   }
   if(modified)changed();renderTasks();
   if(selectedId&&selection===selectionEpoch&&owner.selected_study_id===selectedId)await openStudy(selectedId);
  }catch(err){if(active(e,w)&&working===owner)note(err.message,true);}
  finally{if(active(e,w)&&working===owner){polling=false;clearTimeout(poll);if(owner.tasks.some(x=>['queued','running'].includes(x.task.state)))poll=setTimeout(()=>refreshTasks(),2500);}}
 }
 function renderTasks(){
  $('#extent-tasks').innerHTML=working.tasks.length?working.tasks.map(row=>'<article><strong>'+esc(row.request.action)+' · '+esc(row.task.state)+'</strong><p><code>'+esc(row.task.id)+'</code></p>'+(row.task.error?'<p class="extent-error">'+esc(row.task.error.message||JSON.stringify(row.task.error))+'</p>':'')+(['failed','interrupted','cancelled'].includes(row.task.state)?'<button type="button" data-resume="'+esc(row.task.id)+'">Resume this original task</button>':'')+(row.task.state==='complete'&&row.task.action==='restoration-extent.prepare'?'<button type="button" data-study="'+esc(row.task.result.id)+'">Open prepared study</button>':'')+'<button type="button" data-task="'+esc(row.task.id)+'">Open task and native logs</button></article>').join(''):'<p>No tasks have been submitted from this working copy.</p>';
 }
 async function resumeTask(id){
  const row=working.tasks.find(x=>x.task.id===id);if(!row||busy)return;const e=epoch,w=workspace,owner=working;busy=true;renderStatus();
  try{
   owner.history.push({kind:'resume-original-task',task_id:id,request:clone(row.request),observed_at:new Date().toISOString()});changed();
   await durable();if(!active(e,w)||working!==owner)return;
   const result=await host.api('/api/task/resume',{method:'POST',body:{id}});
   taskMatch(result,row.request,id,row.task);row.task=result;owner.updated_at=new Date().toISOString();owner.sequence++;
   try{await remember(owner);}catch{download(JSON.stringify(owner,null,2)+'\n','Restoration_Complete_Resume_Return.json');}
   if(active(e,w)&&working===owner)await refreshTasks();
  }finally{if(active(e,w)&&working===owner){busy=false;renderStatus();}}
 }
 async function importWorking(file){
  if(!file||busy)return;const e=epoch,w=workspace,seq=working.sequence,id=working.id;{
   const text=await file.text();if(!active(e,w)||working.id!==id||working.sequence!==seq)throw Error('The working copy changed while reading this file. The current copy is preserved.');
   const incoming=validateWorking(JSON.parse(text),project.id,w);await durable();if(!active(e,w)||working.id!==id||working.sequence!==seq)throw Error('The selection changed while preserving the current working copy.');
   freezeCopy('Before import');adoptWorking({...clone(incoming),id:uuid(),parent_id:incoming.id,window_id:windowId,updated_at:new Date().toISOString()});
   changed();form();restoreRaw();renderTasks();await renderCopies();if(working.selected_study_id)await openStudy(working.selected_study_id);
  }
 }
 function attach(){
  listeners=new AbortController();const on=(node,event,fn)=>node.addEventListener(event,fn,{signal:listeners.signal});
  on(root,'input',event=>{if(friendlyInput(event.target))return;if(event.target.closest('#extent-form')){if(['extent-stream-where','extent-placements'].includes(event.target.id))delete working.friendly;readForm();}});
  on(root,'change',event=>{if(friendlyInput(event.target))return;if(event.target.closest('#extent-form'))readForm();});
  on(root,'click',event=>{
   const button=event.target.closest('button');if(!button||button.disabled)return;
   const run=async()=>{
    if(button.id==='extent-inspect-source')return inspectFields();
    if(button.id==='extent-add-placement'||button.dataset.filterAdd||button.dataset.filterRemove!==undefined||button.dataset.placementRemove!==undefined){
     if(!working.friendly)working.friendly=friendlyFromSpec();const f=working.friendly;
     if(button.id==='extent-add-placement')f.placements.push({id:'',title:'',filters:[]});
     else if(button.dataset.filterAdd){const rows=button.dataset.filterAdd==='shared'?f.shared:f.placements[Number(button.dataset.placement)].filters;rows.push({field:'',type:'string',value:''});}
     else if(button.dataset.filterRemove!==undefined){const rows=button.dataset.where==='shared'?f.shared:f.placements[Number(button.dataset.placement)].filters;rows.splice(Number(button.dataset.filterRemove),1);}
     else f.placements.splice(Number(button.dataset.placementRemove),1);
     applyFriendly();renderFriendly();return;
    }
    if(button.id==='extent-prepare'){readForm();return submit('restoration-extent.prepare',{spec:clone(working.spec)});}
    if(button.id==='extent-replay')return dispatchPending();
    if(button.id==='extent-backup'){const text=JSON.stringify(working,null,2)+'\n';download(text,'Restoration_Working_'+working.id+'.json');explicitBackups.set(key(working),text);return;}
    if(button.id==='extent-refresh')return loadCatalog();
    if(button.id==='extent-new'){if(working.pending)throw Error('Reconcile the original request before starting another study.');await durable();freezeCopy('Before new study');fresh();selected=null;$('#extent-selected').replaceChildren();form();renderTasks();return renderCopies();}
    if(button.dataset.study)return openStudy(button.dataset.study);
    if(button.dataset.run)return submit('run.start',{run_id:button.dataset.run});
    if(button.dataset.openRun){if(host.openItem)return host.openItem('runs',button.dataset.openRun);return host.navigate?.('runs');}
    if(button.dataset.task)return host.showTask?.(button.dataset.task);
    if(button.dataset.resume)return resumeTask(button.dataset.resume);
    if(button.id==='extent-report'&&selected)return submit('restoration-extent.report',{study_id:selected.record.id});
    if(button.id==='extent-refresh-selection'&&selected)return openStudy(selected.record.id);
    if(button.id==='extent-fork'&&selected){if(working.pending)throw Error('Reconcile the original request before starting another study.');await durable();freezeCopy('Before selected-study copy');const spec=selected.record.spec||selected.record.definition;fresh(spec,selected.record.id);form();renderTasks();return renderCopies();}
   };run().catch(e=>note(e.message,true));
  });
  on($('#extent-import'),'change',event=>importWorking(event.target.files?.[0]).catch(e=>note(e.message,true)));
  on($('#extent-copy-select'),'change',async event=>{const id=event.target.value;if(!id)return;try{const e=epoch,w=workspace,seq=working.sequence,rows=await listCopies();if(!active(e,w)||seq!==working.sequence)return;const value=rows.find(x=>x.id===id);if(!value)throw Error('That retained copy is unavailable.');await durable();if(!active(e,w)||seq!==working.sequence)return;freezeCopy('Before opening another copy');adoptWorking({...clone(value),id:uuid(),parent_id:value.id,window_id:windowId,updated_at:new Date().toISOString()});selected=null;$('#extent-selected').replaceChildren();changed();form();restoreRaw();renderTasks();await renderCopies();}catch(e){note(e.message,true);}});
 }
 function shell(){
  return '<section class="restoration-extents"><header><p class="extent-eyebrow">SOURCE-BOUND NATIVE STUDIES</p><h2>Restoration extent and placement</h2><p>Compare explicitly selected stream corridors on the original grid. Every new case retains its own scenario and native run. Width is measured in metres on each side; actual changed hectares come from the native footprint.</p></header><div class="extent-tools"><button type="button" id="extent-refresh">Refresh saved sources and studies</button><button type="button" id="extent-new">New study</button><button type="button" id="extent-backup">Download complete working copy</button><label>Receive working file<input type="file" id="extent-import" accept=".json,application/json"></label><select id="extent-copy-select" aria-label="Retained working copies"></select></div><p id="extent-status" role="status"></p><p id="extent-error" class="extent-error" role="alert"></p><div class="extent-grid"><section><h3>Explicit scientific selection</h3><form id="extent-form"><label>Study title<input id="extent-title" required></label><label>Scientific reason<textarea id="extent-reason" rows="3"></textarea></label><label>Original baseline run<select id="extent-baseline"></select></label><label>Retained stream source<select id="extent-source"></select></label><label>Original layer name, if selected<input id="extent-layer"></label><button type="button" id="extent-inspect-source">Inspect original layers and fields</button><div id="extent-source-preview"></div><div id="extent-friendly"></div><details><summary>Advanced exact selection data</summary><label>Shared original feature filter (JSON object)<textarea id="extent-stream-where" rows="3" spellcheck="false"></textarea></label><label>Named placement selections (JSON array)<textarea id="extent-placements" rows="7" spellcheck="false"></textarea></label><p>Each placement has an explicit id and title, and optional where object using retained stream fields. An empty where selects all lines admitted by the shared source selection.</p></details><label>Each-side widths, metres, comma separated<input id="extent-widths" inputmode="decimal"></label><div class="extent-pair"><label>Existing land-cover codes, comma separated<input id="extent-from"></label><label>Destination land-cover code<input id="extent-to" inputmode="numeric"></label></div><label>Clipping support<select id="extent-scope"><option value="reporting">Retained reporting area</option><option value="model_domain">Retained model domain</option></select></label><p>Only explicitly eligible original classes change. Raster quantization, existing cover and water exclusion affect the final treated area. No width or coefficient is preselected.</p><button type="button" id="extent-prepare" class="extent-primary">Prepare exact cases through original queue</button></form><aside><p id="extent-pending"></p><button type="button" id="extent-replay" hidden>Reconcile the exact original request</button></aside></section><section><h3>Saved studies</h3><div id="extent-studies"></div><h3>Original task history</h3><div id="extent-tasks"></div></section></div><section id="extent-selected"></section></section>';
 }
 async function mount(node,state){
  detach();disposed=false;busy=false;polling=false;root=node;workspace=currentWorkspace();project=state.data?.project||host.getState().data.project;person=clone(state.person??host.getState().person??null);const e=epoch;let priorId=null;try{priorId=sessionStorage.getItem('upstate-restoration-last:'+workspace);}catch{}root.innerHTML=shell();attach();fresh();form();
  try{const rows=await listCopies();if(!active(e))return;const prior=rows.find(x=>x.id===priorId);if(prior&&prior.id!==working.id){adoptWorking({...clone(prior),id:uuid(),parent_id:prior.id,window_id:windowId,updated_at:new Date().toISOString()});changed();}
   await loadCatalog();if(!active(e))return;renderTasks();if(working.selected_study_id)await openStudy(working.selected_study_id);await refreshTasks();
  }catch(e){note(e.message,true);}
 }
 function update(state){if(disposed||state.workspace_key!==workspace)return;if(working?.tasks.some(x=>['queued','running'].includes(x.task.state)))refreshTasks();}
 function detach(){listeners?.abort();listeners=null;if(working)remember(working).catch(()=>{});disposed=true;epoch++;selectionEpoch++;clearTimeout(poll);root=null;selected=null;catalog=null;fieldSource=null;}
 return {mount,update,detach,openStudy};
}
