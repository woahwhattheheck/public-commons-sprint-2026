/** Retained Web Map layers in the original authenticated scientific workbench. */
const copy=value=>value==null?value:JSON.parse(JSON.stringify(value));
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':
 value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}':JSON.stringify(value);
const terminal=new Set(['failed','interrupted','canceled','cancelled']);
const workspaceOf=state=>state?.workspace_key||null;
const refKey=ref=>ref?JSON.stringify([ref.source_collection_id,ref.source_id]):'';
const validRef=ref=>ref&&typeof ref.source_collection_id==='string'&&!!ref.source_collection_id&&typeof ref.source_id==='string'&&!!ref.source_id;
export function createWebMapSourceClient(options){
 const {api,getWorkspace,onChange=()=>{},onNotice=()=>{}}=options;
 let storage=options.storage;try{storage??=globalThis.sessionStorage;}catch{}
 const contexts=new Map();
 const storageKey=w=>'upstate-webmap-sources:'+w;
 function context(w){
  if(!w)throw Error('Select a scientific workspace.');
  if(!contexts.has(w)){
   let saved={};try{saved=JSON.parse(storage?.getItem(storageKey(w))||'{}');}catch{}
   contexts.set(w,{workspace:w,sources:[],selection:validRef(saved.selection)?saved.selection:null,
    layerPaths:Array.isArray(saved.layerPaths)?saved.layerPaths.filter(x=>typeof x==='string'):[],
    catalog:null,contextId:typeof saved.contextId==='string'?saved.contextId:null,loading:false,error:null,pending:saved.pending||null,lastTask:saved.lastTask||null,
    result:saved.result||null,readVersion:0,listVersion:0,history:Array.isArray(saved.history)?saved.history.slice(0,12):[]});
  }return contexts.get(w);
 }
 function persist(c){try{storage?.setItem(storageKey(c.workspace),JSON.stringify({
  selection:c.selection,layerPaths:c.layerPaths,contextId:c.contextId,pending:c.pending,lastTask:c.lastTask,result:c.result,history:c.history}));
 }catch{onNotice('Browser recovery storage is unavailable. The original operation remains in Operations.');}}
 const snapshot=()=>copy(context(getWorkspace()));
 function changed(c){persist(c);if(c.workspace===getWorkspace())onChange(copy(c));}
 const read=(w,ref)=>api('/api/webmap-sources/catalog?'+new URLSearchParams({workspace:w,...(ref||{})}));
 async function sources(w=getWorkspace()){
  const c=context(w),version=++c.listVersion,value=await read(w);
  if(version===c.listVersion){c.sources=Array.isArray(value.sources)?value.sources:[];changed(c);}return value;
 }
 async function select(ref,w=getWorkspace()){
  const c=context(w),version=++c.readVersion;
  if(ref!=null&&!validRef(ref))throw Error('Choose a retained original Web Map.');
  if(refKey(ref)!==refKey(c.selection)){c.selection=copy(ref);c.layerPaths=[];c.catalog=null;c.contextId=null;c.result=null;}
  c.loading=!!ref;c.error=null;changed(c);if(!ref)return null;
  try{
   const value=await read(w,ref);
   if(refKey(value)!==refKey(ref))throw Error('The returned layers do not match the selected original source.');
   if(version===c.readVersion&&refKey(c.selection)===refKey(ref)){
    c.catalog=value;
    const available=new Set((value.layers||[]).filter(x=>x.eligible!==false).map(x=>x.layer_path));
    c.layerPaths=c.layerPaths.filter(x=>available.has(x));
    if(c.contextId&&!(value.contexts||[]).some(x=>x.id===c.contextId&&x.available&&x.compatible))c.contextId=null;changed(c);
   }return value;
  }catch(error){if(version===c.readVersion){c.error=error.message;changed(c);}throw error;}
  finally{if(version===c.readVersion){c.loading=false;changed(c);}}
 }
 function choose(paths,enabled=true){
  if(!Array.isArray(paths))throw Error('Choose retained map layers.');
  const c=context(getWorkspace()),available=new Set((c.catalog?.layers||[]).filter(x=>x.eligible!==false).map(x=>x.layer_path));
  const selected=new Set(c.layerPaths);
  for(const path of paths){if(!available.has(path))throw Error('Refresh this original map before selecting its layers.');
   if(enabled)selected.add(path);else selected.delete(path);}
  c.layerPaths=[...selected];changed(c);
 }
 function chooseContext(id){const c=context(getWorkspace());if(id!=null&&!(c.catalog?.contexts||[]).some(x=>x.id===id&&x.available&&x.compatible))throw Error('Choose an available context table for this retained layer.');c.contextId=id||null;changed(c);}
 function clearSelection(){const c=context(getWorkspace());c.layerPaths=[];changed(c);}
 function rememberResult(c,task){
  c.lastTask={id:task.id,workspace:task.workspace,action:task.action,operation_id:task.operation_id,state:task.state};
  c.result=copy(task.result||{});c.pending=null;
  c.history=[{task:copy(c.lastTask),result:copy(c.result)},...c.history.filter(x=>x.task?.id!==task.id)].slice(0,12);
  changed(c);
 }
 async function accept(c,p,task){
  if(task.workspace!==c.workspace||task.action!==p.body.action||task.operation_id!==p.body.operation_id||
   stable(task.payload)!==stable(p.body.payload)||typeof task.id!=='string'||!/^[0-9a-f]{64}$/.test(task.id))
   throw Error('The returned operation differs from this original workspace request.');
  p.taskId=task.id;p.state=task.state;p.error=null;
  c.lastTask={id:task.id,workspace:task.workspace,action:task.action,operation_id:task.operation_id,state:task.state};
  if(task.state==='complete'){rememberResult(c,task);await sources(c.workspace);if(c.selection)await select(c.selection,c.workspace);}
  else{if(terminal.has(task.state))p.error=task.error?.message||'The original operation '+task.state+'. Open Operations to inspect the retained result.';changed(c);}
  return task;
 }
 async function send(c,p){
  p.error=null;changed(c);
  try{const task=await api('/api/actions',{method:'POST',body:copy(p.body)});
   if(c.pending===p)await accept(c,p,task);return task;
  }catch(error){if(c.pending===p){p.error=error.message;changed(c);}throw error;}
 }
 async function admit(){
  const c=context(getWorkspace());if(c.pending)throw Error('Finish or reopen the existing admission operation.');
  if(!c.selection||!c.layerPaths.length)throw Error('Choose a retained map and at least one polygon layer.');
  const operation='webmap_'+(options.randomUUID?.()||globalThis.crypto?.randomUUID?.()||
    Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)).replaceAll('-','');
  const p={body:{workspace:c.workspace,action:'webmap.source.admit',operation_id:operation,
   payload:{...copy(c.selection),layer_paths:[...c.layerPaths],...(c.contextId?{context_id:c.contextId}:{})}},taskId:null,state:null,error:null};
  c.pending=p;changed(c);return send(c,p);
 }
 async function poll(w=getWorkspace()){
  const c=context(w),p=c.pending;if(!p?.taskId)return null;
  try{const task=await api('/api/task?'+new URLSearchParams({workspace:w,id:p.taskId}));
   if(c.pending===p)return accept(c,p,task);return task;
  }catch(error){if(c.pending===p){p.error=error.message;changed(c);}throw error;}
 }
 function retry(){const c=context(getWorkspace()),p=c.pending;return !p?Promise.resolve(null):p.taskId?poll(c.workspace):send(c,p);}
 function clearFinished(){const c=context(getWorkspace());if(!c.pending||!terminal.has(c.pending.state))throw Error('Keep this original request until its operation status is known.');c.pending=null;changed(c);}
 async function refresh(w=getWorkspace()){
  const c=context(w);c.error=null;changed(c);
  try{await sources(w);if(c.selection)await select(c.selection,w);if(c.pending?.taskId)await poll(w);}
  catch(error){c.error=error.message;changed(c);throw error;}
 }
 async function acceptState(state){
  const w=workspaceOf(state);if(!w)return;
  const c=context(w),p=c.pending;
  if(p?.taskId){const t=state.tasks?.find(t=>t.id===p.taskId);if(t&&t.state!==p.state)return poll(w);}
 }
 async function openAdmission(id){
  const c=context(getWorkspace());if(!c.selection)throw Error('Choose the original map for this saved admission.');
  await select(c.selection,c.workspace);
  const record=(c.catalog?.admissions||[]).find(x=>(x.admission_id||x.id)===id);
  if(!record)throw Error('This admission is absent from the selected original map.');
  c.result=copy(record);
  c.lastTask=record.task_id?{id:record.task_id,workspace:c.workspace,action:'webmap.source.admit',state:'complete'}:null;
  changed(c);return record;
 }
 async function historyResult(id){
  const c=context(getWorkspace()),entry=c.history.find(x=>x.task?.id===id);if(!entry)return null;
  const result=entry.result,ref={source_collection_id:result.parent_source_collection_id,source_id:result.parent_source_id};
  if(validRef(ref)&&result.admission_id){await select(ref,c.workspace);return openAdmission(result.admission_id);}
  c.result=copy(result);c.lastTask=copy(entry.task);changed(c);return result;
 }
 return {snapshot,sources,select,choose,chooseContext,clearSelection,admit,poll,retry,clearFinished,refresh,acceptState,openAdmission,historyResult};
}

export function attachWebMapSources(host){
 const doc=host.document||globalThis.document;
 let root=null,workspace=null,generation=0,latest=null,listStamp='',layerStamp='',resultStamp='',historyStamp='',polling=null;
 const nodes={},checks=new Map(),contexts=new Map();
 const el=(tag,text,cls)=>{const node=doc.createElement(tag);if(text!=null)node.textContent=String(text);if(cls)node.className=cls;return node;};
 const number=value=>typeof value==='number'?new Intl.NumberFormat('en-US').format(value):value==null?'—':String(value);
 function notice(message){if(nodes.notice)nodes.notice.textContent=message;host.toast?.(message);}
 function failure(error){notice(error?.message||String(error));}
 const client=createWebMapSourceClient({api:host.api,getWorkspace:()=>workspaceOf(host.getState()),storage:host.storage,
  randomUUID:host.randomUUID,onNotice:notice,onChange:state=>{latest=state;if(root&&workspace===state.workspace)render(state);}});
 function run(fn){const epoch=generation,owner=workspace;return Promise.resolve().then(()=>{
  if(root&&generation===epoch&&workspace===owner)return fn();
 }).catch(error=>{if(root&&generation===epoch&&workspace===owner)failure(error);});}
 function button(label,fn,cls){const b=el('button',label,cls);b.type='button';b.addEventListener('click',()=>run(fn));return b;}
 function detail(label,value){const node=el('details'),pre=el('pre',JSON.stringify(value,null,2));node.append(el('summary',label),pre);return node;}
 function crs(value){if(!value)return 'Not declared';if(typeof value==='string')return value;
  const id=value.latestWkid||value.wkid;return id?'WKID '+id:value.wkt?'Declared WKT':JSON.stringify(value);}
 function safeURL(value,download=false){
  if(typeof value!=='string')return null;
  if(download)return value.startsWith('/api/')&&!value.startsWith('//')?value:null;
  try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}
 }
 function fileLink(file){
  const url=safeURL(file.url,true);if(!url)return null;
  const a=el('a',file.label||file.filename||'Download retained file');a.href=url+(url.includes('?')?'&':'?')+'download=1';a.setAttribute('download','');return a;
 }
 function sourceOptions(state){
  const stamp=stable(state.sources);if(stamp!==listStamp){
   listStamp=stamp;nodes.maps.replaceChildren(el('option','Choose a retained Web Map'));
   nodes.maps.firstChild.value='';
   for(const source of state.sources){const option=el('option',source.label||source.filename||source.source_id);
    option.value=refKey(source);nodes.maps.append(option);}
  }
  nodes.maps.value=refKey(state.selection);
  nodes.sourceInfo.replaceChildren();
  const current=state.sources.find(x=>refKey(x)===refKey(state.selection));
  if(current){nodes.sourceInfo.append(el('p',(current.filename||'Retained original source')+' · '+number(current.bytes)+' bytes','webmap-muted'),
    detail('Original source identity',{source_collection_id:current.source_collection_id,source_id:current.source_id,
     sha256:current.sha256,uri:current.uri,vintage:current.vintage}));}
 }
 function renderLayers(state){
  const stamp=stable({selection:state.selection,catalog:state.catalog});
  if(stamp!==layerStamp){
   layerStamp=stamp;checks.clear();contexts.clear();nodes.layers.replaceChildren();nodes.contexts.replaceChildren();nodes.remote.replaceChildren();
   if(!state.selection)nodes.layers.append(el('p','Choose an original map to inspect its retained polygon layers.','webmap-empty'));
   else if(!state.catalog)nodes.layers.append(el('p',state.loading?'Reading original layers…':'Refresh the selected original map.','webmap-empty'));
   else{
    const layers=state.catalog.layers||[];
    if(!layers.length)nodes.layers.append(el('p','This retained map contains no embedded polygon layers. Linked services are listed below.','webmap-empty'));
    for(const layer of layers){
     const row=el('article',null,'webmap-layer'),heading=el('div',null,'webmap-layer-heading'),label=el('label',null,'webmap-checkbox');
     const input=el('input');input.type='checkbox';input.disabled=layer.eligible===false;
     input.addEventListener('change',()=>run(()=>client.choose([layer.layer_path],input.checked)));
     checks.set(layer.layer_path,input);label.append(input,el('strong',layer.label||layer.layer_path));heading.append(label);
     row.append(heading,el('p',number(layer.feature_count)+' features · '+(layer.geometry_type||'Polygon')+' · '+crs(layer.spatial_reference),'webmap-muted'));
     if(layer.eligible===false)row.append(el('p',layer.reason||'This layer cannot be admitted as a native polygon source.','webmap-notice'));
     const fields=(layer.fields||[]).map(f=>typeof f==='string'?f:f.name).filter(Boolean);
     if(fields.length)row.append(el('p','Retained fields: '+fields.join(', '),'webmap-fields'));
     row.append(detail('Layer and coordinate details',{layer_path:layer.layer_path,spatial_reference:layer.spatial_reference,
      fields:layer.fields,suggested_id_field:layer.suggested_id_field,suggested_name_field:layer.suggested_name_field}));
     nodes.layers.append(row);
    }
    for(const context of state.catalog.contexts||[]){
     if(!context.available||!context.compatible)continue;
     const label=el('label',null,'webmap-checkbox'),input=el('input');input.type='checkbox';contexts.set(context.id,input);
     input.addEventListener('change',()=>run(()=>client.chooseContext(input.checked?context.id:null)));
     label.append(input,el('span',context.label));nodes.contexts.append(label);
    }
    if(contexts.size)nodes.contexts.append(el('p','The dated table is retained separately from the original polygon attributes. Its estimates, vintage and source links travel with the admitted collection.','webmap-muted'));
    if((state.catalog.remote_layers||[]).length){
     nodes.remote.append(el('h3','Linked source services'));
     for(const remote of state.catalog.remote_layers){
      const row=el('div',null,'webmap-remote'),url=safeURL(remote.url||remote.uri);
      if(url){const a=el('a',remote.label||remote.title||url);a.href=url;a.target='_blank';a.rel='noopener noreferrer';row.append(a);}
      else row.append(el('span',remote.label||remote.title||remote.id||'Linked service'));
      if(remote.layer_path)row.append(el('small',remote.layer_path));nodes.remote.append(row);
     }
     nodes.remote.append(el('p','Use the existing source-capture workflow to retain service data, then open its saved source here.','webmap-muted'));
    }
   }
  }
  for(const [path,input]of checks)input.checked=state.layerPaths.includes(path);
  for(const [id,input]of contexts)input.checked=state.contextId===id;
  nodes.count.textContent=number(state.layerPaths.length)+' selected layers';
  nodes.admit.disabled=state.loading||!!state.pending||!state.layerPaths.length;
  nodes.selectAll.disabled=state.loading||!state.catalog;
 }
 function renderPending(state){
  nodes.pending.replaceChildren();const pending=state.pending;
  if(!pending){if(state.lastTask?.id)nodes.pending.append(button('Open last admission operation',()=>host.showTask(state.lastTask.id)));return;}
  nodes.pending.append(el('strong','Original layer admission'),el('p',pending.state||'Sending original request'));
  nodes.pending.append(el('p',pending.body.operation_id,'webmap-id'));
  if(pending.error)nodes.pending.append(el('p',pending.error,'webmap-notice'));
  if(pending.taskId)nodes.pending.append(button('Open original operation',()=>host.showTask(pending.taskId)),button('Refresh operation',()=>client.poll()));
  else nodes.pending.append(button('Retry this original request',()=>client.retry()));
  if(terminal.has(pending.state))nodes.pending.append(button('Keep result and start another admission',()=>client.clearFinished()));
 }
 async function analyzeSource(result,source){
  const selectedWorkspace=workspaceOf(host.getState());
  if(!selectedWorkspace||selectedWorkspace!==workspace)throw Error('Choose the original workspace before opening its analysis.');
  if(!result?.source_collection_id||!Array.isArray(source?.scenario_zones)||!source.scenario_zones.length)
   throw Error('This retained source has no native reporting regions.');
  const request={workspace_key:selectedWorkspace,
   selection:{title:(source.title||'Retained map regions')+' — scenario comparison',zones:copy(source.scenario_zones)},
   origin:{admission_id:result.admission_id,source_collection_id:result.source_collection_id,source_id:source.source_id}};
  if(request.selection.zones.some(zone=>zone.source_collection_id!==result.source_collection_id||zone.source_id!==source.source_id))
   throw Error('The selected regions differ from their admitted original source.');
  if(typeof host.openExtension!=='function')throw Error('The current operator extension host is required to open native analysis.');
  await host.refreshState?.({force:true});
  if(workspaceOf(host.getState())!==selectedWorkspace)throw Error('The workspace changed while opening the selected analysis.');
  return host.openExtension('scenario-analysis','createForSourceAreas',request);
 }
 async function openGIS(result){
  const selectedWorkspace=workspaceOf(host.getState());
  if(!selectedWorkspace||selectedWorkspace!==workspace)throw Error('Choose the original workspace before preparing its GIS handover.');
  const records=result?.admitted_sources||[],collection=result?.source_collection_id;
  if(!collection||!records.some(row=>['vector','raster'].includes(row.kind))||records.some(row=>!row.source_id))
   throw Error('Open a retained admission with original geographic sources.');
  const request={workspace_key:selectedWorkspace,selection:{
   title:(result.title||'Admitted map sources')+' — editable GIS',
   project_crs:'EPSG:4326',source_collection_id:collection,
   sources:records.map(row=>({source_collection_id:collection,source_id:row.source_id})),
   notes:['Selected admitted map layers and their retained original attributes.',
    ...(result.context?['The Census table describes whole counties and retains its original population date and estimate vintage.']:[])]}};
  request.selection.title=request.selection.title.slice(0,240);
  if(typeof host.openExtension!=='function')throw Error('The current operator extension host is required to open native GIS delivery.');
  return host.openExtension('gis-projects','createForSources',copy(request));
 }
 function resultCard(result,taskId){
  const section=el('article',null,'webmap-admission');section.append(el('h3','Retained native sources'));
  const records=result.admitted_sources||[];
  for(const source of records){
   const row=el('div',null,'webmap-result-row');row.append(el('strong',source.title||source.source_id));
   row.append(el('p',source.feature_count!=null?number(source.feature_count)+' features · '+(source.kind||'vector'):(source.kind||'Registered source'),'webmap-muted'));
   if(Array.isArray(source.scenario_zones)&&source.scenario_zones.length)
    row.append(button('Use these regions in scenario analysis',()=>analyzeSource(result,source)));
   if(source.region_selector)row.append(el('p','Registered reporting regions are also available to native land-cover workflows.','webmap-muted'));
   row.append(detail('Registered source and region selection',{source_collection_id:result.source_collection_id,
    source_id:source.source_id,region_selector:source.region_selector,scenario_zones:source.scenario_zones,related_source_ids:source.related_source_ids}));
   section.append(row);
  }
  if(records.some(source=>['vector','raster'].includes(source.kind)))
   section.append(button('Prepare complete editable GIS handover',()=>openGIS(result)));
  if(result.context)section.append(el('p',result.context.label||'Dated whole-county population context included.'),detail('Context source and reference dates',result.context));
  const downloads=el('nav',null,'webmap-downloads');downloads.setAttribute('aria-label','Admitted source downloads');
  for(const file of result.files||[]){const a=fileLink(file);if(a)downloads.append(a);}if(downloads.childNodes.length)section.append(downloads);
  if(taskId)section.append(button('Open original admission operation',()=>host.showTask(taskId)));
  section.append(detail('Admission source lineage',{admission_id:result.admission_id,source_collection_id:result.source_collection_id,
   parent_source_collection_id:result.parent_source_collection_id,parent_source_id:result.parent_source_id}));
  return section;
 }
 function renderResults(state){
  const stamp=stable(state.result);if(stamp!==resultStamp){resultStamp=stamp;nodes.result.replaceChildren();
   if(state.result)nodes.result.append(resultCard(state.result,state.lastTask?.id));}
  const admissions=state.catalog?.admissions||[],history=stable({admissions,local:state.history});
  if(history!==historyStamp){historyStamp=history;nodes.history.replaceChildren();
   if(admissions.length){nodes.history.append(el('h3','Saved admissions for this original map'));
    for(const record of admissions){const id=record.admission_id||record.id;
     nodes.history.append(button(record.label||record.title||'Open saved admission '+String(id).slice(0,12),()=>client.openAdmission(id)));}}
   else if(state.history.length){nodes.history.append(el('h3','Recent admission operations'));
    for(const record of state.history)nodes.history.append(button('Open retained result '+record.task.id.slice(0,12),()=>client.historyResult(record.task.id)));}
  }
 }
 function render(state){
  if(!root||state.workspace!==workspace)return;
  nodes.notice.textContent=state.error||'';
  nodes.workspace.textContent=host.getState()?.data?.project?.title||'Scientific workspace';
  sourceOptions(state);renderLayers(state);renderPending(state);renderResults(state);
 }
 function build(){
  const desk=el('section',null,'webmap-desk'),header=el('header',null,'webmap-heading'),title=el('div');
  nodes.workspace=el('p',null,'webmap-muted');title.append(nodes.workspace,el('h1','Original map layers'));
  header.append(title,button('Refresh originals',()=>client.refresh()));desk.append(header);
  desk.append(el('p','Turn embedded polygon layers from a retained Web Map into registered native sources for land-cover, reporting regions and saved analyses.','webmap-intro'));
  nodes.notice=el('p',null,'webmap-notice');nodes.notice.setAttribute('role','status');nodes.notice.setAttribute('aria-live','polite');desk.append(nodes.notice);
  nodes.pending=el('section',null,'webmap-pending');nodes.pending.setAttribute('aria-label','Original admission operation');desk.append(nodes.pending);
  const label=el('label','Retained original Web Map','webmap-map-label');nodes.maps=el('select');label.append(nodes.maps);desk.append(label);
  nodes.maps.addEventListener('change',()=>run(()=>{if(!nodes.maps.value)return client.select(null);
   const [source_collection_id,source_id]=JSON.parse(nodes.maps.value);return client.select({source_collection_id,source_id});}));
  nodes.sourceInfo=el('div');desk.append(nodes.sourceInfo);
  const controls=el('div',null,'webmap-controls');nodes.count=el('p',null,'webmap-muted');
  nodes.selectAll=button('Select eligible layers',()=>client.choose((latest?.catalog?.layers||[]).filter(x=>x.eligible!==false).map(x=>x.layer_path)));
  controls.append(nodes.count,nodes.selectAll,button('Clear selection',()=>client.clearSelection()));desk.append(controls);
  nodes.layers=el('div',null,'webmap-layers');desk.append(nodes.layers);
  nodes.contexts=el('div',null,'webmap-contexts');desk.append(nodes.contexts);
  nodes.admit=button('Admit selected layers',()=>client.admit(),'webmap-primary');desk.append(nodes.admit);
  nodes.remote=el('section',null,'webmap-remote-list');nodes.result=el('section');nodes.history=el('section',null,'webmap-history');
  desk.append(nodes.remote,nodes.result,nodes.history);root.replaceChildren(desk);
 }
 function detach(){generation++;root=null;workspace=null;checks.clear();contexts.clear();for(const key of Object.keys(nodes))delete nodes[key];listStamp=layerStamp=resultStamp=historyStamp='';}
 async function mount(node,state=host.getState()){
  detach();root=node;workspace=workspaceOf(state);generation++;latest=client.snapshot();build();render(latest);
  const epoch=generation;try{await client.refresh(workspace);}catch(error){if(root&&epoch===generation)failure(error);}
 }
 function update(state=host.getState()){
  if(!root||workspace!==workspaceOf(state))return;
  if(!polling)polling=client.acceptState(state).catch(failure).finally(()=>{polling=null;});
 }
 return {mount,update,detach,client};
}
