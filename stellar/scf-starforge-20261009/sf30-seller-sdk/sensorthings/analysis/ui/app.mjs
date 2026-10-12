// MIT. Analyst UI on the original SensorThings session, operation journal and CAS.
const $=id=>document.getElementById(id),HASH=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9_-]{8,100}$/,
  TOKEN=/^[A-Za-z0-9_-]{32,200}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,
  SESSION_KEY='stellar-forge.sensorthings.analysis.tab-session.v1',MAX_BROWSER_DOWNLOAD=64*1024*1024;
const state={token:null,workspaceId:null,schema:null,view:null,overview:null,project:null,version:null,summary:null,edition:null,
  tab:'overview',pending:null,pendingObservation:null,forms:new Map(),catalogs:new Map(),editions:new Map(),sourceSummaries:new Map(),
  frame:null,framePath:null,generation:0,paneGeneration:0,mutation:false,rowsOffset:0,citationDraft:[],annotationEdit:null};
function node(tag,properties={},...children){
  const el=document.createElement(tag);
  for(const [key,value]of Object.entries(properties??{})){
    if(key.startsWith('on')&&typeof value==='function')el.addEventListener(key.slice(2).toLowerCase(),value);
    else if(key==='class')el.className=value;
    else if(key==='text')el.textContent=value;
    else if(value!==undefined&&value!==null){
      if(['value','checked','disabled','required','hidden','multiple','type','name','id','placeholder','rows','maxLength'].includes(key))el[key]=value;
      else el.setAttribute(key,String(value));
    }
  }
  for(const item of children.flat(Infinity)){if(item===null||item===undefined||item===false)continue;el.append(item instanceof Node?item:document.createTextNode(String(item)));}
  return el;
}
const p=(value,cls)=>node('p',{class:cls??''},String(value??'')),code=value=>node('code',{},format(value)),
  pre=value=>node('pre',{},JSON.stringify(value,null,2)),small=value=>node('span',{class:'small muted'},format(value));
const button=(label,fn,props={})=>node('button',{type:'button',...props,onclick:fn},label);
const format=value=>value===undefined?'Not supplied':value===null?'null':typeof value==='string'?value:JSON.stringify(value);
const short=(value,n=14)=>String(value??'').length>n?String(value).slice(0,n)+'…':String(value??'');
const count=value=>Number.isSafeInteger(value)?value.toLocaleString('en-US'):format(value);
const humanBytes=bytes=>bytes>=1024*1024?(bytes/(1024*1024)).toFixed(2)+' MiB':bytes>=1024?(bytes/1024).toFixed(1)+' KiB':bytes+' B';
function table(headers,rows){
  return node('div',{class:'table-wrap'},node('table',{},node('thead',{},node('tr',{},headers.map(h=>node('th',{scope:'col'},h)))),
    node('tbody',{},rows.map(r=>node('tr',{},r.map(cell=>node('td',{},cell)))))));
}
function details(label,value){return node('details',{},node('summary',{},label),value instanceof Node?value:pre(value));}
function field(label,input,help){
  const wrap=node('label',{class:'field'},node('span',{},label),input);if(help)wrap.append(node('span',{class:'help'},help));return wrap;
}
function input(name,value='',props={}){return node('input',{name,value,...props});}
function textarea(name,value='',props={}){return node('textarea',{name,value,rows:4,...props});}
function select(name,options,value='',props={}){
  const el=node('select',{name,...props},options.map(x=>node('option',{value:typeof x==='string'?x:x.value},typeof x==='string'?x:x.label)));
  el.value=value;return el;
}
function check(label,{name,value,checked=false,help}={}){
  const el=input(name??'',value??'',{type:'checkbox',checked}),wrap=node('label',{class:'check'},el,node('span',{},label,help?node('small',{},help):null));
  return {el,wrap};
}
function kv(pairs){return node('dl',{class:'kv'},pairs.flatMap(([key,value])=>[node('dt',{},key),node('dd',{},value instanceof Node?value:format(value))]));}
function status(message,error=false){const el=$('message');el.hidden=!message;el.className='message'+(error?' error':'');el.textContent=message??'';}
function issue(error){status((error.message??String(error))+(error.code?'\n'+error.code:''),true);}
async function guard(fn){try{return await fn();}catch(e){issue(e);return null;}}
function setBusy(value){state.mutation=value;document.querySelectorAll('[data-mutation]').forEach(b=>{b.disabled=value||Boolean(state.pending)||b.dataset.readonly==='true';});}
function requireActor(){
  const actor=$('actor').value.trim();if(!actor){$('actor').focus();throw new Error('Enter the operator name to attribute this change.');}return actor;
}
function pendingKey(){return 'stellar-forge.sensorthings.analysis.pending.'+state.workspaceId;}
function savePending(){
  if(!state.workspaceId)return;
  if(state.pending)sessionStorage.setItem(pendingKey(),JSON.stringify({schema:'stellar-forge.sensorthings-analysis-browser-pending.v1',
    workspaceId:state.workspaceId,request:state.pending}));
  else sessionStorage.removeItem(pendingKey());
}
function restorePending(){
  const raw=sessionStorage.getItem(pendingKey());if(!raw)return;
  let stored;try{stored=JSON.parse(raw);}catch{throw new Error('The existing pending-request cache is invalid. Preserve it before reopening this tab.');}
  if(stored.schema!=='stellar-forge.sensorthings-analysis-browser-pending.v1'||stored.workspaceId!==state.workspaceId||
    !ID.test(stored.request?.operationId??'')||!Number.isSafeInteger(stored.request?.expectedRevision))
    throw new Error('The pending request belongs to another workspace or request format.');
  state.pending=stored.request;
}
function canonical(value){
  return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
    Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
}
async function pendingIdentity(requestBody){
  const bytes=new TextEncoder().encode(JSON.stringify(canonical({action:requestBody.action,payload:requestBody.payload})));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function headers(){return {'Authorization':'Bearer '+state.token,'X-SensorThings-Workspace':state.workspaceId};}
async function request(path,{method='GET',body,bootstrap=false,signal}={}){
  if(!path.startsWith('/api/')||new URL(path,location.origin).origin!==location.origin)throw new Error('Use this original workspace API.');
  const h={'Authorization':'Bearer '+state.token};if(!bootstrap)h['X-SensorThings-Workspace']=state.workspaceId;
  if(body!==undefined)h['Content-Type']='application/json';
  const response=await fetch(path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',credentials:'omit',redirect:'error',signal});
  let value;try{value=await response.json();}catch{throw Object.assign(new Error('The workspace returned an incomplete response. Reconcile any pending operation before another change.'),{status:response.status});}
  if(!response.ok)throw Object.assign(new Error(value.message??'The original workspace request failed.'),value,{status:response.status});
  if(!bootstrap&&response.headers.get('X-SensorThings-Workspace')!==state.workspaceId)throw new Error('The response belongs to another persistent workspace.');
  return value;
}
async function refreshView(){
  const view=await request('/api/view');
  if(view.workspaceId!==state.workspaceId||!Number.isSafeInteger(view.revision))throw new Error('The native workspace identity/revision changed.');
  state.view=view;state.overview=view.analysis??await request('/api/analysis');
  $('identity').textContent='Workspace '+state.workspaceId+' · revision '+view.revision+' · original SensorThings session';
  renderProjects();return view;
}
function updateURL(){
  const u=new URL(location.href);u.hash='';
  for(const key of ['project','version','tab'])u.searchParams.delete(key);
  if(state.project){u.searchParams.set('project',state.project.project.id);if(state.version)u.searchParams.set('version',state.version.id);}
  u.searchParams.set('tab',state.tab);history.replaceState(null,'',u);
}
function stopViewer(){if(state.frame)state.frame.remove();state.frame=null;state.framePath=null;}
window.sensorThingsAnalysisHeaders=frameWindow=>{
  if(!state.token||!state.workspaceId||!state.frame||state.frame.contentWindow!==frameWindow)return null;
  try{if(frameWindow.location.origin!==location.origin||!frameWindow.location.pathname.startsWith(state.framePath))return null;}catch{return null;}
  return Object.freeze(headers());
};
async function connect(token,{expectedWorkspaceId=null}={}){
  if(!TOKEN.test(token??''))throw new Error('Open the original private workspace link.');
  state.token=token;
  const schema=await request('/api/schema',{bootstrap:true});
  if(!UUID.test(schema.workspaceId??'')||schema.workspaceSchema!=='stellar-forge.sensorthings-workspace.v1'||
    expectedWorkspaceId&&expectedWorkspaceId!==schema.workspaceId)throw new Error('The private link no longer names the original workspace.');
  state.workspaceId=schema.workspaceId;state.schema=schema;
  if(!schema.analysis||!schema.actions?.['analysis.create'])throw new Error('Install the complete original analysis/core/API composition before opening this interface.');
  sessionStorage.setItem(SESSION_KEY,JSON.stringify({origin:location.origin,workspaceId:state.workspaceId,token}));
  history.replaceState(null,'',location.pathname+location.search);
  $('private-link').value='';$('connection').hidden=true;$('application').hidden=false;$('refresh').disabled=false;$('lock').disabled=false;
  restorePending();await refreshView();renderPending();
  const q=new URLSearchParams(location.search),project=q.get('project'),version=q.get('version');
  if(project&&(state.overview.projects??[]).some(p=>p.id===project))await loadProject(project,HASH.test(version??'')?version:null,q.get('tab')??'overview');
  else if(state.overview.projects?.length)await loadProject(state.overview.projects[0].id,null,'overview');
  else await newProject();
  status('Connected to the existing workspace. Saved source editions and project history are unchanged.');
}
function renderProjects(){
  const query=$('project-search').value.trim().toLowerCase(),current=state.project?.project.id;
  $('projects').replaceChildren(...(state.overview?.projects??[]).filter(p=>(p.title+' '+p.id).toLowerCase().includes(query)).map(project=>{
    const el=button(project.title,()=>guard(()=>loadProject(project.id)),{class:'project-item','aria-current':String(project.id===current)});
    el.append(node('small',{},project.id));return el;
  }));
  const buttons=$('projects').querySelectorAll('button');
  if(!buttons.length)$('projects').append(p('No saved analyses match this view.','small muted'));
}
const TABS=[['overview','Overview'],['selection','Selection'],['source','Source review'],['rows','Events / rows'],['viewer','Native viewer'],['annotations','Annotations'],['compare','Compare editions'],['publish','Publication'],['transfer','Receive / export']];
function renderHeader(){
  const h=$('project-header');h.replaceChildren();
  if(!state.project){h.append(node('div',{},node('h2',{},'New analysis'),p('Select retained source data and save its first immutable version.','small muted')));}
  else{
    const project=state.project.project;
    const choice=select('version',state.project.versions.map(v=>({value:v.id,label:(v.id===project.headVersionId?'Current · ':'History · ')+v.createdAt+' · '+short(v.id,12)})),state.version?.id);
    choice.addEventListener('change',()=>guard(()=>loadProject(project.id,choice.value,state.tab)));
    h.append(node('div',{},node('h2',{},project.title),code(project.id),
      state.version?.id!==project.headVersionId?p('Historical saved version. Revise the current head to change this project.','small muted'):p('Current saved project head','small muted')),
      node('label',{class:'version-control'},small('Saved version'),choice,node('span',{class:'version-info'},state.version?.id??'')));
  }
  $('tabs').replaceChildren(...TABS.filter(([id])=>state.project||['selection','source','transfer'].includes(id)).map(([id,label])=>
    button(label,()=>guard(()=>showTab(id)),{'aria-current':state.tab===id?'page':'false'})));
}
async function loadEdition(id){
  if(!state.editions.has(id))state.editions.set(id,await request('/api/editions/'+id+'/metadata'));
  return state.editions.get(id);
}
async function sourceSummary(id){
  if(!state.sourceSummaries.has(id))state.sourceSummaries.set(id,await request('/api/editions/'+id+'/summary'));
  return state.sourceSummaries.get(id);
}
async function catalog(id){
  if(!state.catalogs.has(id))state.catalogs.set(id,await request('/api/analysis/editions/'+id+'/streams'));
  return state.catalogs.get(id);
}
async function loadProject(id,versionId=null,tab='overview'){
  const generation=++state.generation;stopViewer();
  const project=await request('/api/analysis/projects/'+encodeURIComponent(id));
  if(generation!==state.generation)return;
  const selected=versionId??project.project.headVersionId;
  if(!project.versions.some(x=>x.id===selected))throw new Error('This saved version belongs to another project.');
  const version=await request('/api/analysis/versions/'+selected),
    [summary,edition]=await Promise.all([request('/api/analysis/versions/'+selected+'/summary'),loadEdition(version.editionId)]);
  if(generation!==state.generation)return;
  if(version.projectId!==id||summary.editionId!==version.editionId)throw new Error('The saved selection and source summary differ.');
  Object.assign(state,{project,version,summary,edition,tab:TABS.some(x=>x[0]===tab)?tab:'overview',rowsOffset:0});
  renderProjects();renderHeader();updateURL();await showTab(state.tab);
}
async function newProject(){
  state.generation++;stopViewer();Object.assign(state,{project:null,version:null,summary:null,edition:null,tab:'selection',rowsOffset:0});
  renderProjects();renderHeader();updateURL();await showTab('selection');
}
function currentHead(){return state.project&&state.version?.id===state.project.project.headVersionId;}
function formCache(key,build){
  const full=state.workspaceId+':'+(state.project?.project.id??'new')+':'+(state.version?.id??'none')+':'+key;
  if(!state.forms.has(full))state.forms.set(full,build());
  return state.forms.get(full);
}
function formShell(title,submit,{className='card',revision=state.view.revision}={}){
  const form=node('form',{class:className,'data-revision':revision});
  if(title)form.append(node('h3',{},title));
  form.addEventListener('submit',event=>{event.preventDefault();void guard(async()=>{
    if(state.pending)throw new Error('Reconcile the existing original operation before submitting another change.');
    if(!form.reportValidity())return;
    await submit(form,Number(form.dataset.revision));
  });});
  form.append(p('Draft basis: workspace revision '+revision,'basis'));
  return form;
}
function submitButton(label){return node('button',{type:'submit',class:'primary','data-mutation':'true',disabled:state.mutation||Boolean(state.pending)},label);}
function value(form,name){return form.elements.namedItem(name)?.value??'';}
function jsonInput(form,name,fallback){const raw=value(form,name).trim();if(!raw)return fallback;try{return JSON.parse(raw);}catch{throw new Error('Use complete JSON in '+name+'.');}}
async function beginAction(action,payload,expectedRevision){
  if(state.pending)throw new Error('The exact prior request remains pending.');
  const requestBody={action,payload,operationId:'analysis-'+crypto.randomUUID().replaceAll('-',''),expectedRevision};
  if(JSON.stringify(requestBody).length>1900000)throw new Error('The pending request exceeds the existing native action capacity.');
  state.pending=requestBody;state.pendingObservation=null;savePending();renderPending();await dispatchPending();
}
async function acceptResult(result,operationId){
  const original=state.pending,previousSelectedVersion=state.version?.id,previousProject=state.project?.project.id;
  if(original?.action==='analysis.create')for(const key of [...state.forms.keys()])if(key.startsWith(state.workspaceId+':new:none:'))state.forms.delete(key);
  if(original?.action==='analysis.annotate'){state.annotationEdit=null;state.citationDraft=[];}
  state.pending=null;state.pendingObservation=null;savePending();renderPending();
  status('Original operation '+operationId+' completed. '+(result?.projectId?'Project '+result.projectId+'.':''));
  await refreshView();
  if(result?.projectId&&(state.overview.projects??[]).some(p=>p.id===result.projectId)){
    const versionId=result.versionId&&['analysis.create','analysis.revise','analysis.annotate'].includes(original?.action)?result.versionId:
      original?.action!=='analysis.import'&&result.projectId===previousProject?previousSelectedVersion:null;
    await loadProject(result.projectId,versionId,state.tab);
  }else if(state.project)await loadProject(state.project.project.id,state.version?.id,state.tab);
  else await showTab(state.tab);
  if(result?.sourceReviewRequired?.length)status('Project received with complete original bytes. Local source review is required for '+result.sourceReviewRequired.length+' original edition(s).');
}
async function dispatchPending(){
  if(!state.pending||state.mutation)return;
  const pending=structuredClone(state.pending);setBusy(true);
  try{
    const response=await request('/api/action',{method:'POST',body:pending});
    if(response.operationId!==pending.operationId)throw new Error('The reply names another operation.');
    if(response.state==='RUNNING'){state.pendingObservation={state:'RUNNING'};status('The same original operation is still running. Reconcile its retained result.');renderPending();return;}
    if(!Object.hasOwn(response,'result'))throw new Error('The original result is absent; retain this pending request.');
    await acceptResult(response.result,pending.operationId);
  }catch(e){
    if(state.pending){state.pendingObservation={state:'UNKNOWN',error:{code:e.code,message:e.message,status:e.status}};renderPending();}
    issue(e);
  }finally{setBusy(false);}
}
async function reconcilePending(){
  if(!state.pending||state.mutation)return;setBusy(true);
  try{
    const op=await request('/api/operations/'+state.pending.operationId);
    if(op.operationId!==state.pending.operationId||op.requestSha256!==await pendingIdentity(state.pending))throw new Error('The retained operation belongs to another exact request. Preserve the pending envelope.');
    state.pendingObservation=op;
    if(op.state==='COMPLETE'){if(op.result===null||op.result===undefined)throw new Error('The completed original result has not been returned.');await acceptResult(op.result,op.operationId);return;}
    status('Original operation '+op.operationId+': '+op.state+'. Its request remains retained.');renderPending();
  }catch(e){
    if(e.status===404){state.pendingObservation={state:'NOT_RESERVED'};status('The original journal has no reservation for this request. Review the current workspace before changing its expected revision.');renderPending();}
    else issue(e);
  }finally{setBusy(false);}
}
async function reviewPendingRevision(){
  if(state.pendingObservation?.state!=='NOT_RESERVED')throw new Error('Read the original operation first.');
  await refreshView();
  let head=null;if(state.pending.payload.projectId){const current=await request('/api/analysis/projects/'+state.pending.payload.projectId);head=current.project.headVersionId;}
  const needsHead=['analysis.revise','analysis.annotate'].includes(state.pending.action),sameHead=!needsHead||head===state.pending.payload.baseVersionId;
  const area=node('div',{},p('Pending request revision '+state.pending.expectedRevision+'; current workspace revision '+state.view.revision+'.'),
    pre({action:state.pending.action,payload:state.pending.payload,currentProjectHead:head}));
  if(sameHead)area.append(button('Use this reviewed revision and submit the same request',()=>guard(async()=>{
    state.pending.expectedRevision=state.view.revision;savePending();$('detail-dialog').close();await dispatchPending();
  }),{class:'primary'}));
  else area.append(p('The project head changed. Keep the pending payload as a draft, clear this unreserved request explicitly, and revise the current saved head.'));
  detail('Review original pending selection',area);
}
async function clearPending(){
  await reconcilePending();
  if(!state.pending)return;
  if(!['NOT_RESERVED','FAILED'].includes(state.pendingObservation?.state))throw new Error('Resolve the original operation before clearing its pending request.');
  const saved=structuredClone(state.pending);
  state.pending=null;state.pendingObservation=null;savePending();renderPending();setBusy(false);
  detail('Retained draft from the closed request',node('div',{},p('The original request below remains visible for reconciliation. A new explicit edit uses a new operation; the original server history is unchanged.'),pre(saved)));
}
function renderPending(){
  const el=$('pending');el.hidden=!state.pending;if(!state.pending){el.replaceChildren();return;}
  const observed=state.pendingObservation,stateName=observed?.state??'NOT_YET_RECONCILED';
  el.replaceChildren(...[node('h3',{},'Pending original operation'),kv([['Operation',code(state.pending.operationId)],['Action',state.pending.action],['Retained state',stateName],['Expected revision',state.pending.expectedRevision]]),
    p('Keep this request unchanged until its original journal outcome is known. Reloading this tab preserves the exact request; no second operation is created.'),
    details('Exact pending request',state.pending),observed?.error?pre(observed.error):null].filter(Boolean));
  const actions=node('div',{class:'actions'},button('Read original outcome',()=>guard(reconcilePending)));
  if(['RUNNING','UNKNOWN'].includes(stateName))actions.append(button('Resume exact original request',()=>guard(dispatchPending)));
  if(stateName==='NOT_RESERVED')actions.append(button('Review current revision',()=>guard(reviewPendingRevision)));
  if(['NOT_RESERVED','FAILED'].includes(stateName))actions.append(button('Clear resolved pending request; keep draft visible',()=>guard(clearPending)));
  el.append(actions);
}
function detail(title,content){
  $('detail-title').textContent=title;$('detail-body').replaceChildren(content instanceof Node?content:pre(content));
  if(!$('detail-dialog').open)$('detail-dialog').showModal();
}
function readFileButtons(selection){
  return button('List original files',()=>guard(async()=>{const listed=await request('/api/files?selection='+encodeURIComponent(JSON.stringify(selection)));detail('Original retained files',filesTable(listed.files));}));
}
function filesTable(files){
  return table(['Original file','Bytes','SHA256','Download'],(files??[]).map(f=>[
    p(f.name??f.filename),humanBytes(f.bytes),code(f.sha256),button('Download exact file',()=>guard(()=>downloadFile(f)),{disabled:!f.selection||!HASH.test(f.sha256??'')})]));
}
async function downloadFile(file){
  if(!file.selection||!HASH.test(file.sha256??'')||!Number.isSafeInteger(file.bytes))throw new Error('Select an exact file from the original native manifest.');
  if(file.bytes>MAX_BROWSER_DOWNLOAD){
    detail('Complete native file receiving',node('div',{},p('This file exceeds the 64 MiB browser-memory download limit. Use the installed original SensorThings inspect/download client with this exact selection; it streams and resumes the full native file.'),pre({selection:file.selection,bytes:file.bytes,sha256:file.sha256})));
    return;
  }
  status('Downloading '+(file.name??file.filename)+' · '+humanBytes(file.bytes));
  const url='/api/files/download?selection='+encodeURIComponent(JSON.stringify(file.selection))+'&expectedSha256='+file.sha256,
    response=await fetch(url,{headers:headers(),cache:'no-store',credentials:'omit',redirect:'error'});
  if(!response.ok){let e;try{e=await response.json();}catch{}throw new Error(e?.message??'The native complete-file download failed.');}
  if(response.headers.get('X-SensorThings-Workspace')!==state.workspaceId||response.headers.get('X-Source-SHA256')!==file.sha256||
    Number(response.headers.get('Content-Length'))!==file.bytes)throw new Error('The original download manifest differs from the selected file.');
  const data=await response.arrayBuffer();if(data.byteLength!==file.bytes)throw new Error('The full original file was not received.');
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(digest!==file.sha256)throw new Error('The received file differs from its complete original SHA256.');
  const blob=new Blob([data],{type:file.type??'application/octet-stream'}),urlObject=URL.createObjectURL(blob),
    anchor=node('a',{href:urlObject,download:file.name??file.filename??'original-file'});
  document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(urlObject),30000);
  status('Downloaded and verified '+(file.name??file.filename)+' · '+humanBytes(file.bytes)+' · SHA256 '+digest);
}
function originalSourceButton(editionId,sha256){
  return button('Original source',()=>guard(async()=>{const data=await request('/api/files?selection='+encodeURIComponent(JSON.stringify({kind:'source',id:editionId,sha256})));
    detail('Exact original source member',filesTable(data.files));}));
}
function pageHeading(title,intro){return [node('h2',{},title),p(intro,'intro')];}
async function showTab(tab){
  if(!TABS.some(x=>x[0]===tab))tab='overview';
  if(!state.project&&!['selection','source','transfer'].includes(tab))tab='selection';
  const generation=++state.paneGeneration;state.tab=tab;stopViewer();renderHeader();updateURL();
  $('pane').replaceChildren(p('Reading the retained workspace…','muted'));
  try{
    const result=await ({overview:overviewPane,selection:selectionPane,source:sourcePane,rows:rowsPane,viewer:viewerPane,annotations:annotationsPane,
      compare:comparePane,publish:publishPane,transfer:transferPane}[tab])();
    if(generation!==state.paneGeneration)return;$('pane').replaceChildren(...(Array.isArray(result)?result:[result]));setBusy(state.mutation);
  }catch(e){if(generation!==state.paneGeneration)return;$('pane').replaceChildren(node('div',{class:'empty'},p(e.message),button('Read this view again',()=>guard(()=>showTab(tab)))));issue(e);}
}

async function overviewPane(){
  const v=state.version,s=state.summary,e=state.edition,pj=state.project,latest=[...(state.view.reviews??[])].reverse().find(r=>r.editionId===e.id);
  return [...pageHeading(v.title,'Review the saved source, original-time meaning and publication history before changing this project.'),
    node('div',{class:'metrics'},[
      ['Selected occurrences',s.totalOccurrences],['Explicit instant events',s.instantEvents],['Explicit source intervals',s.explicitIntervals],['Unplaced original times',s.unplacedOccurrences]
    ].map(([name,value])=>node('div',{class:'metric'},node('strong',{},count(value)),node('span',{},name)))),
    node('div',{class:'grid'},node('section',{class:'card'},node('h3',{},'Saved source'),
      kv([['Source',e.source.label],['Service',code(e.source.serviceUrl)],['Edition',code(e.id)],['Original source files',e.sourceFiles.length],
        ['Selected stream count',v.selection.streamKeys.length],['Saved view',v.selection.view],['Source review',latest?.decision??'No local source review']]),
      button('Review original source',()=>guard(()=>showTab('source')))),
      node('section',{class:'card'},node('h3',{},'Retained project history'),
        kv([['Saved versions',pj.versions.length],['Comparisons',pj.comparisons.length],['Attributed evidence files',pj.evidence.length],
          ['Publications',pj.publications.length],['Receiving receipts',pj.receipts.length],['Complete project exports',pj.exports.length]]),
        button('Receive / export project',()=>guard(()=>showTab('transfer'))))),
    p(s.meaning?.time??'An instant remains an event; only explicit original intervals have duration.','flow-note'),
    table(['Original stream','Observation type','Unit','Occurrences','Eligible numeric instants'],s.streams.map(x=>[
      node('div',{},p(x.name??x.key),code(x.key)),code(x.observationType),pre(x.unit),count(x.rows),count(x.numericEligibleRows)])),
    details('Complete saved selection',v),details('Exact saved summary',s),
    node('h3',{},'Recent saved versions'),table(['Version','Recorded','Actor / source','Open'],[...pj.versions].reverse().slice(0,20).map(x=>[
      code(x.id),x.createdAt,code(x.editionId),button(x.id===pj.project.headVersionId?'Open current':'Open historical version',()=>guard(()=>loadProject(pj.project.id,x.id,'overview')))]))];
}
function editionOptions(){
  return (state.overview.sourceEditionIds??[]).map(id=>({value:id,label:(state.editions.get(id)?.source.label??'Retained edition')+' · '+short(id,18)}));
}
async function selectionPane(){
  const v=state.version,current=currentHead(),project=state.project;
  const headNote=v&&!current?node('div',{class:'flow-note'},p('This is a historical saved version. Open the current project head before editing.'),
    button('Open current head',()=>guard(()=>loadProject(project.project.id,null,'selection')))):null;
  const form=await formCache('selection',async()=>{
    const form=formShell(v?'Save a new version':'Create the first saved analysis',async(f,revision)=>{
      const selectedStreams=[...f.querySelectorAll('input[name="streamKeys"]:checked')].map(x=>x.value),
        full=f.elements.namedItem('fullPeriod').checked,
        selection={streamKeys:selectedStreams,period:full?null:{start:value(f,'start').trim(),end:value(f,'end').trim()},view:value(f,'view'),viewerId:value(f,'viewerId')||null};
      if(!selectedStreams.length||selectedStreams.length>20)throw new Error('Select between one and twenty original scalar streams.');
      const payload={title:value(f,'title').trim(),editionId:value(f,'editionId'),selection,actor:requireActor()};
      if(v){if(!currentHead()||state.version.id!==v.id)throw new Error('Reopen the current saved version before revising this project.');
        Object.assign(payload,{projectId:v.projectId,baseVersionId:v.id,reason:value(f,'reason').trim()});}
      else payload.note=value(f,'reason').trim();
      await beginAction(v?'analysis.revise':'analysis.create',payload,revision);
    });
    const chosenEdition=v?.editionId??state.newEditionId??state.overview.sourceEditionIds?.[0]??'',
      editionChoice=select('editionId',[{value:'',label:'Select a retained source edition'},...editionOptions()],chosenEdition,{required:true}),
      streamHost=node('div',{}),viewChoice=select('view',[{value:'events',label:'Literal events / intervals'},{value:'map',label:'Native map selection'},{value:'numeric',label:'Original numeric instants'}],v?.selection.view??'events'),
      viewerChoice=select('viewerId',[{value:'',label:'No native viewer selected'},...(state.overview.viewers??[]).map(x=>({value:x.id,label:(x.upstream?.tag??'Installed viewer')+' · '+short(x.id,18)}))],v?.selection.viewerId??''),
      full=check('Use the full retained source period',{name:'fullPeriod',checked:!v?.selection.period}),
      start=input('start',v?.selection.period?.start??'',{placeholder:'2026-06-01T00:00:00Z'}),
      end=input('end',v?.selection.period?.end??'',{placeholder:'2026-06-02T00:00:00Z'}),
      period=node('div',{class:'grid'},field('Inclusive start with explicit UTC offset',start),field('Exclusive end with explicit UTC offset',end));
    const periodState=()=>{start.disabled=end.disabled=full.el.checked;start.required=end.required=!full.el.checked;};
    full.el.addEventListener('change',periodState);periodState();
    form.append(field('Saved analysis title',input('title',v?.title??'',{required:true,maxLength:200})),
      field('Original retained source edition',editionChoice,'A source change preserves prior annotations with their original cited editions.'),
      streamHost,node('fieldset',{},node('legend',{},'Period and view'),full.wrap,period,
        node('div',{class:'grid'},field('Saved view',viewChoice),field('Installed original viewer edition',viewerChoice,'The viewer archive must first be received through the original host inbox.'))),
      field(v?'Reason for the new version':'Purpose / selection note',textarea('reason','',{required:true,maxLength:12000})),
      node('div',{class:'actions'},submitButton(v?'Save new version':'Create analysis')));
    if(v&&!current)form.querySelector('button[type=submit]').dataset.readonly='true';
    let streamGeneration=0;
    async function populate(editionId,preserve){
      const generation=++streamGeneration;streamHost.replaceChildren(p('Reading original stream metadata…','muted'));
      if(!editionId){streamHost.replaceChildren(p('Select a retained source edition.','empty'));return;}
      const [data,e]=await Promise.all([catalog(editionId),loadEdition(editionId)]);
      if(generation!==streamGeneration)return;state.newEditionId=editionId;
      const selected=new Set(preserve),list=node('div',{class:'check-list'});
      for(const stream of data.streams){
        const c=check(stream.name??stream.key,{name:'streamKeys',value:stream.key,checked:selected.has(stream.key),
          help:stream.observationType+' · unit '+format(stream.unit)+' · '+count(stream.rows)+' occurrences · '+count(stream.numericEligibleRows)+' numeric instants'});
        c.wrap.append(button('Inspect source',()=>detail('Original stream metadata',pre(stream))));
        list.append(c.wrap);
      }
      const tools=node('div',{class:'actions'},
        button('Select up to 20 displayed streams',()=>{[...list.querySelectorAll('input')].forEach((c,i)=>{c.checked=i<20;});}),
        button('Clear stream selection',()=>{list.querySelectorAll('input').forEach(c=>{c.checked=false;});}));
      streamHost.replaceChildren(node('h3',{},e.source.label),code(editionId),p(data.streams.length+' retained scalar stream(s). Select at most twenty.','small'),tools,
        data.streams.length?list:p('This edition has no supported scalar Datastreams. Original MultiDatastream source remains preserved.','empty'),
        details('Original scope and retained issues',{scope:data.scope,issues:data.issues,license:data.license}));
    }
    editionChoice.addEventListener('change',()=>guard(()=>populate(editionChoice.value,[...form.querySelectorAll('input[name=streamKeys]:checked')].map(x=>x.value))));
    await populate(chosenEdition,v?.selection.streamKeys??[]);return form;
  });
  const viewerChoice=form.elements.namedItem('viewerId'),editionChoice=form.elements.namedItem('editionId');
  for(const viewer of state.overview.viewers??[])if(![...viewerChoice.options].some(o=>o.value===viewer.id))
    viewerChoice.append(node('option',{value:viewer.id},(viewer.upstream?.tag??'Installed viewer')+' · '+short(viewer.id,18)));
  for(const option of editionOptions())if(![...editionChoice.options].some(o=>o.value===option.value))
    editionChoice.append(node('option',{value:option.value},option.label));
  return [...pageHeading('Source and saved selection','A save records a new immutable analysis version. Original source records, typed IDs, decimal lexemes and earlier selections remain unchanged.'),headNote,form];
}
async function sourcePane(){
  const selectedId=state.version?.editionId??state.newEditionId??state.overview.sourceEditionIds?.[0];
  if(!selectedId)return [...pageHeading('Original source review','Receive or capture an original source edition in the existing workspace first.'),button('Receive an original source',()=>guard(()=>showTab('transfer')))];
  const [edition,summary]=await Promise.all([loadEdition(selectedId),sourceSummary(selectedId)]),
    reviews=(state.view.reviews??[]).filter(r=>r.editionId===selectedId),
    required=[...new Set([...edition.issues.filter(x=>x.severity!=='notice').map(x=>x.code),...Object.keys(summary.rowIssueCounts??{}),
      ...(summary.duplicateOccurrences?['DUPLICATE_OBSERVATION_IDS']:[]),...(summary.changedDuplicates?['CONFLICTING_DUPLICATE_OBSERVATIONS']:[]),...(summary.unkeyed?['UNKEYED_OBSERVATIONS']:[])])];
  const form=formCache('source-review:'+selectedId,()=>{
    const form=formShell('Record the original edition review',async(f,revision)=>{
      await beginAction('edition.review',{editionId:selectedId,decision:value(f,'decision'),actor:requireActor(),note:value(f,'note').trim(),
        acknowledgeIssues:[...f.querySelectorAll('input[name="issues"]:checked')].map(x=>x.value)},revision);
    });
    form.append(field('Decision',select('decision',[{value:'follow_up',label:'Follow up required'},{value:'accept',label:'Accept this source edition'},{value:'reject',label:'Reject this source edition'}],'follow_up')),
      field('Source interpretation and review note',textarea('note','',{required:true,maxLength:12000})),
      node('h4',{},'Retained source findings'),
      required.length?node('div',{class:'check-list'},required.map(value=>check(value,{name:'issues',value}).wrap)):p('No mandatory issue acknowledgement codes were returned for this exact edition.','small'),
      p('Acceptance requires explicit acknowledgement of the original required findings. It is an operator decision for this edition.','small muted'),
      node('div',{class:'actions'},submitButton('Record source review')));
    return form;
  });
  return [...pageHeading('Original source and review','Inspect the exact retained query, source files and findings. A received project preserves prior reviews as history and requires a local source decision.'),
    kv([['Original edition',code(edition.id)],['Source',edition.source.label],['Service',code(edition.source.serviceUrl)],
      ['Current local decision',reviews.at(-1)?.decision??'No local review'],['Licence',format(edition.source.license)],['Complete source members',edition.sourceFiles.length]]),
    details('Complete original source plan',edition.plan),details('Original source scope and issues',{scope:edition.scope,issues:edition.issues}),
    details('Complete original observation summary',summary),
    table(['Source role','Bytes','SHA256','Read'],edition.sourceFiles.map(f=>[
      f.role??f.mediaType,humanBytes(f.bytes),code(f.sha256),originalSourceButton(selectedId,f.sha256)])),
    node('h3',{},'Original local review history'),reviews.length?table(['Recorded','Decision','Reviewer','Interpretation'],reviews.map(r=>[r.createdAt,r.decision,r.actor,p(r.note)])):p('No local review is recorded.','empty'),form];
}
function svg(tag,attrs={},...children){
  const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,String(v));
  for(const c of children.flat(Infinity))el.append(c instanceof Node?c:document.createTextNode(String(c??'')));return el;
}
function pageTimeline(rows){
  const placed=rows.filter(r=>['explicit_instant','explicit_interval'].includes(r.phenomenon_time_kind)&&Number.isFinite(Date.parse(r.phenomenon_start_utc))),
    keys=[...new Set(placed.map(r=>r.stream_key+' · '+(r.result_state==='value'&&r.result_type==='string'?r.result:r.result_state+'/'+r.result_type)))].slice(0,18),
    height=Math.max(150,110+keys.length*25),chart=svg('svg',{viewBox:'0 0 1080 '+height,class:'timeline',role:'img','aria-label':'Original events in this displayed row page'});
  chart.append(svg('rect',{width:1080,height,fill:'#fff'}),svg('text',{x:18,y:25,fill:'#222','font-size':15},'Original events in this displayed page'));
  if(!placed.length){chart.append(svg('text',{x:18,y:63,fill:'#444','font-size':12},'No explicitly placed source times on this page. Original unplaced rows remain below.'));return chart;}
  const starts=placed.map(r=>Date.parse(r.phenomenon_start_utc)),ends=placed.map(r=>Number.isFinite(Date.parse(r.phenomenon_end_utc))?Date.parse(r.phenomenon_end_utc):Date.parse(r.phenomenon_start_utc)),
    a=Math.min(...starts),b=Math.max(...ends),range=b-a||1,x=t=>290+(t-a)/range*745;
  chart.append(svg('text',{x:290,y:48,fill:'#555','font-size':10},new Date(a).toISOString()),
    svg('text',{x:1035,y:48,fill:'#555','font-size':10,'text-anchor':'end'},new Date(b).toISOString()));
  keys.forEach((key,i)=>{
    const y=78+i*25;chart.append(svg('text',{x:18,y:y+4,fill:'#333','font-size':10},short(key,42)),
      svg('line',{x1:290,x2:1035,y1:y,y2:y,stroke:'#ddd'}));
  });
  for(const r of placed){
    const key=r.stream_key+' · '+(r.result_state==='value'&&r.result_type==='string'?r.result:r.result_state+'/'+r.result_type),i=keys.indexOf(key);if(i<0)continue;
    const y=78+i*25,start=Date.parse(r.phenomenon_start_utc),end=Date.parse(r.phenomenon_end_utc),title=svg('title',{},format(r.result)+' · '+r.phenomenon_time+' · '+r.occurrence_id);
    chart.append(r.phenomenon_time_kind==='explicit_interval'&&Number.isFinite(end)?
      svg('rect',{x:x(start),y:y-4,width:Math.max(1,x(end)-x(start)),height:8,fill:'#555','fill-opacity':.65},title):
      svg('circle',{cx:x(start),cy:y,r:3,fill:'#222','fill-opacity':.7},title));
  }
  chart.append(svg('text',{x:18,y:height-16,fill:'#555','font-size':11},'Circles are original instants; bars are explicit source intervals. This preview covers this row page and at most 18 lanes.'));
  return chart;
}
async function rowsPane(){
  const v=state.version,page=await request('/api/analysis/versions/'+v.id+'/rows?offset='+state.rowsOffset+'&limit=100');
  const pager=()=>node('div',{class:'pagination'},p('Occurrences '+(page.rows.length?page.offset+1:0)+'–'+(page.offset+page.rows.length)+' of '+page.total,'small'),
    node('div',{class:'actions'},button('Previous page',()=>{state.rowsOffset=Math.max(0,page.offset-100);void guard(()=>showTab('rows'));},{disabled:page.offset===0}),
      button('Next page',()=>{state.rowsOffset=page.nextOffset;void guard(()=>showTab('rows'));},{disabled:page.nextOffset===null})));
  return [...pageHeading('Literal events and original rows','Phenomenon, result and valid times remain separate. Source intervals are shown only when explicitly supplied; missing or unresolved times remain visible.'),
    details('Complete category and numeric summaries',state.summary.streams.map(s=>({key:s.key,name:s.name,categories:s.categories,resultTypes:s.resultTypes,
      timeKinds:s.timeKinds,numericEligibleRows:s.numericEligibleRows,numericExclusionReasons:s.numericExclusionReasons}))),
    pageTimeline(page.rows),pager(),
    table(['Original observation / stream','Original times','Result','Source quality / numeric eligibility','Source / annotation'],page.rows.map(r=>[
      node('div',{},code({type:r.observation_id_type,value:r.observation_id}),node('br'),small(r.stream_name),node('br'),code(r.stream_key)),
      node('div',{},p(r.phenomenon_time||'[not supplied]'),small(r.phenomenon_time_kind),details('Result and valid times',{resultTime:r.result_time,resultTimeState:r.result_time_state,
        validTime:r.valid_time,validTimeState:r.valid_time_state})),
      node('div',{},p(r.result_state==='value'?r.result:r.result_state==='null'?'null':'[missing]'),small(r.result_type+' / '+r.result_state)),
      node('div',{},small(r.result_quality_state),p(r.result_quality),small(r.numeric?.eligible?'Eligible original numeric instant':r.numeric?.reason??'Not evaluated')),
      node('div',{},code(r.source_page_sha256),node('br'),code(r.source_pointer),node('div',{class:'actions'},
        button('Inspect original row',()=>detail('Complete original observation',r)),originalSourceButton(v.editionId,r.source_page_sha256),
        button('Cite this occurrence',()=>guard(async()=>{
          state.citationDraft=[{editionId:v.editionId,sha256:r.source_page_sha256,jsonPointer:r.source_pointer,occurrenceId:r.occurrence_id}];
          state.annotationEdit=null;await showTab('annotations');
        }),{disabled:!currentHead()})))])),pager()];
}
async function viewerPane(){
  const v=state.version;
  if(!v.selection.viewerId)return [...pageHeading('Original Helgoland viewer','Receive the pinned original viewer archive, then save its immutable viewer ID in this analysis selection.'),
    node('div',{class:'actions'},button('Receive original viewer',()=>guard(()=>showTab('transfer'))),button('Edit saved viewer selection',()=>guard(()=>showTab('selection'))))];
  const chosenMode=v.selection.view==='numeric'?'numeric':'map',
    mode=select('nativeMode',[{value:'map',label:'Original native map'},{value:'numeric',label:'Original native numeric diagram'}],chosenMode),
    metadataHost=node('div',{}),frameHost=node('div',{}),controls=node('div',{class:'actions'}),
    section=node('section',{},...pageHeading('Original Helgoland viewer','The installed original static viewer reads this exact saved edition through the retained SensorThings endpoint.'),
      kv([['Saved analysis version',code(v.id)],['Original viewer edition',code(v.selection.viewerId)],['Saved source period',v.selection.period??'All retained source times']]),
      field('Native view mode',mode),metadataHost,controls,frameHost);
  let metadata=null,readGeneration=0;
  async function inspect(){
    stopViewer();frameHost.replaceChildren();controls.replaceChildren();const generation=++readGeneration;
    const result=await request('/api/analysis/viewers/'+v.selection.viewerId+'/'+v.id+'/'+mode.value+'/deployment.json');
    if(generation!==readGeneration)return;
    if(result.workspaceId!==state.workspaceId||result.versionId!==v.id||result.viewerId!==v.selection.viewerId||result.mode!==mode.value)
      throw new Error('The deployed viewer metadata belongs to another exact saved selection.');
    metadata=result;
    metadataHost.replaceChildren(kv([['Availability',result.availability.selected.available?'Available for this original client':result.availability.selected.issue?.message??'Unavailable'],
      ['Native stream metadata',result.availability.selected.metadata?.compatible===false?'Original compatibility findings retained':'Review the retained native metadata'],
      ['Actual native entry',code(result.paths.entry)]]),details('Original archive, derived configuration and retained source identity',result));
    controls.append(button('Launch '+(mode.value==='map'?'native map':'native numeric diagram'),()=>{
      guard(async()=>{
        if(!metadata?.availability.selected.available)throw new Error('Review the original native compatibility findings first.');
        if(state.version.id!==v.id)throw new Error('Reopen the current selected version before launching its viewer.');
        const url=new URL(metadata.paths.entry,location.origin),prefix='/analysis/viewer/'+v.selection.viewerId+'/'+v.id+'/'+mode.value+'/';
        if(url.origin!==location.origin||!url.pathname.startsWith(prefix))throw new Error('The original viewer path escapes its exact binding.');
        stopViewer();
        const frame=node('iframe',{class:'native-frame',title:'Original Helgoland '+mode.value+' · '+v.title,referrerpolicy:'no-referrer'});
        frameHost.replaceChildren(frame);state.frame=frame;state.framePath=prefix; // Register before setting src.
        frame.src=url.pathname+url.search;status('Original Helgoland viewer opened for saved version '+v.id+'.');
      });
    },{class:'primary',disabled:!result.availability.selected.available}),
    button('Close viewer',()=>{stopViewer();frameHost.replaceChildren();}),
    button('Attach actual viewer evidence',()=>guard(()=>showTab('publish'))));
  }
  mode.addEventListener('change',()=>guard(inspect));await inspect();return [section];
}
async function annotationsPane(){
  const v=state.version,current=currentHead(),editing=state.annotationEdit;
  const refs=state.citationDraft.length?structuredClone(state.citationDraft):editing?.refs??[];
  const form=await formCache('annotation:'+(editing?.id??'new')+':'+JSON.stringify(refs),()=>{
    const form=formShell(editing?'Revise the attributed annotation':'Add a cited annotation',async(f,revision)=>{
      if(!currentHead()||state.version.id!==v.id)throw new Error('Annotations revise the current exact project head.');
      const annotation={kind:value(f,'kind'),text:value(f,'text').trim(),refs:jsonInput(f,'refs',[]),status:value(f,'status')};
      if(editing)annotation.id=editing.id;
      await beginAction('analysis.annotate',{projectId:v.projectId,baseVersionId:v.id,annotation,actor:requireActor(),reason:value(f,'reason').trim()},revision);
    });
    form.append(node('div',{class:'grid'},field('Annotation kind',select('kind',['note','quality','interpretation'],editing?.kind??'note')),
      field('Status',select('status',['active','withdrawn'],editing?.status??'active'))),
      field('Attributed interpretation',textarea('text',editing?.text??'',{required:true,maxLength:8000})),
      field('Exact original source citations',textarea('refs',JSON.stringify(refs,null,2),{required:true,rows:7}),
        'Use an original edition ID, source SHA256 and JSON pointer. The row view can fill a citation with its exact occurrence ID.'),
      field('Reason for this annotation revision',textarea('reason','',{required:true,maxLength:12000})),
      node('div',{class:'actions'},submitButton(editing?'Save annotation revision':'Save cited annotation')));
    if(!current)form.querySelector('button[type=submit]').dataset.readonly='true';return form;
  });
  return [...pageHeading('Attributed annotations','Provider records stay unchanged. Notes, quality interpretations and withdrawals are retained in new saved versions with their original citations.'),
    !current?node('div',{class:'flow-note'},p('This historical version is read only.'),button('Open current project head',()=>guard(()=>loadProject(v.projectId,null,'annotations')))):null,
    ...v.annotations.map(a=>{
      const currentCitations=a.refs.every(r=>r.editionId===v.editionId);
      return node('article',{class:'card'},node('div',{class:'split'},node('h3',{},a.kind+' · '+a.status),
        current&&currentCitations?button('Edit / withdraw',()=>guard(async()=>{state.annotationEdit=structuredClone(a);state.citationDraft=[];await showTab('annotations');})):null),
        p(a.text),small(a.actor+' · '+a.recordedAt),table(['Original edition','Source / pointer','Occurrence'],a.refs.map(r=>[
          code(r.editionId),node('div',{},code(r.sha256),node('br'),code(r.jsonPointer),originalSourceButton(r.editionId,r.sha256)),code(r.occurrenceId??null)])),
        !currentCitations?p('Retained from its original source edition. A new interpretation can cite the current edition explicitly.','small muted'):null);
    }),
    !v.annotations.length?p('No annotations are recorded in this saved version.','empty'):null,
    editing?button('Start a separate new annotation',()=>guard(async()=>{state.annotationEdit=null;state.citationDraft=[];await showTab('annotations');})):null,form];
}

async function comparePane(){
  const v=state.version,records=state.project.comparisons.filter(c=>c.versionId===v.id);
  const form=formCache('comparison',()=>{
    const form=formShell('Compare with another retained edition',async(f,revision)=>{
      const right=value(f,'rightEditionId');if(right===v.editionId)throw new Error('Select a distinct retained edition for this comparison.');
      await beginAction('analysis.compare',{projectId:v.projectId,baseVersionId:v.id,rightEditionId:right,actor:requireActor(),note:value(f,'note').trim()},revision);
    });
    form.append(field('Later / comparison source edition',select('rightEditionId',[{value:'',label:'Select another retained source edition'},
      ...editionOptions().filter(x=>x.value!==v.editionId)],'',{required:true})),
      field('Comparison purpose and interpretation',textarea('note','',{required:true,maxLength:12000})),
      p('This compares the saved selection with the later retained observations. The original project version and source selection remain unchanged until you explicitly save a new version.','small muted'),
      node('div',{class:'actions'},submitButton('Save edition comparison')));
    return form;
  });
  return [...pageHeading('Compare retained editions','Review observations that are unchanged, changed, one-sided or ambiguous. The comparison does not infer provider insertions, deletions, uptime or a synchronized source snapshot.'),
    kv([['Selected version',code(v.id)],['Left source edition',code(v.editionId)]]),form,
    node('h3',{},'Saved comparisons for this version'),records.length?table(['Recorded','Right edition','Observed counts','Open'],records.map(c=>[
      c.createdAt,code(c.rightEditionId),pre(c.counts),button('Review comparison',()=>guard(()=>openComparison(c.id)))])):p('No saved comparison is bound to this version.','empty'),
    node('div',{class:'actions'},button('Edit current selection after review',()=>guard(()=>loadProject(v.projectId,null,'selection'))))];
}
function comparisonContextPanel(comparison){
  const context=comparison.sourceContext,section=node('section',{},node('h3',{},'Original response context'));
  if(!context){section.append(p('This retained comparison predates source-context recording. No opening or closing response identity is inferred.','flow-note'));return section;}
  section.append(p(context.meaning,'flow-note'),node('div',{class:'grid'},['left','right'].map(side=>{
    const record=context[side];return node('section',{},node('h4',{},side+' source'),
      kv([['Edition',code(record.editionId)],['Source ID',code(record.sourceId)],['Service URL',record.serviceUrl]]),
      details('Exact selected query',record.query),details('Source scope',record.scope),details('Retained source issues',record.issues));
  })),table(['Selected stream','Opening / closing response','Original byte state','Left reads','Right reads'],context.brackets.map(b=>[
    code(b.streamKey),b.phase,code(b.state),count(b.left.length),count(b.right.length)])));
  for(const bracket of context.brackets){
    const reads=node('div',{class:'grid'},['left','right'].map(side=>{
      const body=node('section',{},node('h4',{},side+' original responses'));
      if(!bracket[side].length)body.append(p('No original response is retained for this side and phase.'));
      for(const response of bracket[side])body.append(
        kv([['Exact SHA256',code(response.sha256)],['Exact bytes',humanBytes(response.bytes)],
          ['Original pointer',code(response.jsonPointer)],['Request ID',code(response.requestId)],['Task ID',code(response.taskId)],
          ['Original URL',response.url],['Representation',response.representation],
          ['Source capture clock',code(response.sourceCapturedAt)],['Connector received clock',code(response.connectorReceivedAt)],
          ['Native request started',code(response.nativeRequestStartedAt)],['Native request completed',code(response.nativeRequestCompletedAt)]]),
        originalSourceButton(context[side].editionId,response.sha256));
      return body;
    }));
    section.append(details(bracket.phase+' · '+bracket.streamKey+' · '+bracket.state,reads));
  }
  section.append(p('Source capture, connector transfer and native request clocks retain their original meanings and values. Differing response bytes alone do not identify a particular metadata change or scientific approval.','flow-note'));
  return section;
}
async function openComparison(id){
  const c=await request('/api/analysis/comparisons/'+id);let offset=0;
  const content=node('div',{}),render=()=>{
    content.replaceChildren(kv([['Comparison',code(c.id)],['Saved version',code(c.versionId)],['Left edition',code(c.leftEditionId)],
      ['Right edition',code(c.rightEditionId)],['Original query compatibility',c.sourceQueryCompatible],['Missing later stream keys',c.missingStreamKeys]]),
      pre(c.counts),p(c.note),p(c.meaning,'flow-note'),comparisonContextPanel(c),
      table(['Original key','Observed change','Left source occurrences','Right source occurrences'],c.changes.slice(offset,offset+50).map(x=>[
        code(x.key),x.state,pre(x.left),pre(x.right)])),
      node('div',{class:'pagination'},small('Changes '+(c.changes.length?offset+1:0)+'–'+Math.min(c.changes.length,offset+50)+' of '+c.changes.length),
        node('div',{class:'actions'},button('Previous changes',()=>{offset=Math.max(0,offset-50);render();},{disabled:offset===0}),
          button('Next changes',()=>{offset+=50;render();},{disabled:offset+50>=c.changes.length}))),
      details('Unkeyed original occurrences',c.unkeyed));
  };render();detail('Retained edition comparison',content);
}
async function inbox(){
  const data=await request('/api/analysis/inbox');
  if(typeof data.bound!=='boolean'||!Array.isArray(data.files))throw new Error('The original source inbox response is incomplete.');
  return data;
}
function fileChoices(data,predicate=()=>true){
  return [{value:'',label:'Select one complete inbox file'},...data.files.filter(f=>f.available!==false&&HASH.test(f.sha256??'')&&Number.isSafeInteger(f.bytes)&&predicate(f))
    .map(f=>({value:f.name,label:f.name+' · '+humanBytes(f.bytes)+' · '+short(f.sha256,12)}))];
}
function receiveForm({kind,label,data,projectId,baseVersionId,publicationId}){
  const action={project:'analysis.import',source:'edition.import',viewer:'analysis.viewer.import',evidence:'analysis.evidence.import',receipt:'analysis.receipt.import'}[kind],
    predicate=kind==='viewer'?f=>f.name==='helgoland-complete.zip':()=>true,
    files=new Map(data.files.map(f=>[f.name,f]));
  const form=formShell(label,async(f,revision)=>{
    const chosen=files.get(value(f,'filename'));if(!chosen||chosen.available===false||!HASH.test(chosen.sha256??''))throw new Error('Select an exact complete file from the original inbox.');
    const payload={filename:chosen.name,expectedSha256:chosen.sha256,expectedBytes:chosen.bytes};
    if(kind!=='source')payload.actor=requireActor();
    if(['project','evidence','receipt'].includes(kind))payload.note=value(f,'note').trim();
    if(kind==='evidence')Object.assign(payload,{projectId,baseVersionId,title:value(f,'title').trim()});
    if(kind==='receipt')payload.publicationId=publicationId;
    await beginAction(action,payload,revision);
  });
  const choice=select('filename',fileChoices(data,predicate),'',{required:true}),chosenDetails=node('div',{}),
    update=()=>{const f=files.get(choice.value);chosenDetails.replaceChildren(f?kv([['Complete bytes',f.bytes],['Original SHA256',code(f.sha256)]]):p('No inbox file selected.','small muted'));};
  choice.addEventListener('change',update);update();
  form.append(field('Complete original inbox file',choice),chosenDetails);
  if(kind==='evidence')form.append(field('Actual evidence title',input('title','',{required:true,maxLength:200})));
  if(['project','evidence','receipt'].includes(kind))form.append(field('Receiving / provenance note',textarea('note','',{required:true,maxLength:12000})));
  if(kind==='evidence')form.append(p('Bind this supplied file to saved version '+baseVersionId+'. The file title and note describe the actual retained viewer output.','small muted'));
  if(kind==='project')form.append(p('Receiving preserves original project/version/source/file identities and any existing local head. Source reviews remain explicit on this receiving workspace.','small muted'));
  if(kind==='source')form.append(p('This uses the original immutable source-edition receiver. It does not capture another provider query.','small muted'));
  if(kind==='viewer')form.append(p('Receive the exact Helgoland v2.2.3 archive, then select its immutable viewer ID in the saved analysis.','small muted'));
  if(kind==='receipt')form.append(p('Attach an actual receiving receipt to this exact publication. Its original assertions remain distinct from the local file hash/length verification.','small muted'));
  form.append(node('div',{class:'actions'},submitButton(label)));if(!data.bound)form.querySelector('button[type=submit]').dataset.readonly='true';
  return form;
}
async function publishPane(){
  const v=state.version,latest=[...(state.view.reviews??[])].reverse().find(r=>r.editionId===v.editionId),
    comparisons=state.project.comparisons.filter(c=>c.versionId===v.id),evidence=state.project.evidence.filter(e=>e.versionId===v.id),
    data=await inbox(),form=formCache('publication',()=>{
      const form=formShell('Prepare a frozen publication',async(f,revision)=>{
        await beginAction('analysis.publish',{projectId:v.projectId,baseVersionId:v.id,title:value(f,'title').trim(),actor:requireActor(),note:value(f,'note').trim(),
          comparisonIds:[...f.querySelectorAll('input[name="comparisonIds"]:checked')].map(x=>x.value),
          evidenceIds:[...f.querySelectorAll('input[name="evidenceIds"]:checked')].map(x=>x.value)},revision);
      });
      form.append(field('Publication title',input('title',v.title,{required:true,maxLength:200})),
        field('Publication purpose / interpretation',textarea('note','',{required:true,maxLength:12000})),
        node('fieldset',{},node('legend',{},'Explicit saved comparisons'),
          comparisons.length?comparisons.map(c=>check(c.createdAt+' · '+short(c.rightEditionId,20),{name:'comparisonIds',value:c.id,help:format(c.counts)}).wrap):p('No saved comparison is bound to this version.','small muted')),
        node('fieldset',{},node('legend',{},'Actual supplied viewer evidence'),
          evidence.length?evidence.map(e=>check(e.title,{name:'evidenceIds',value:e.id,help:e.file.name+' · '+e.file.sha256}).wrap):p('No supplied viewer file is bound to this version.','small muted')),
        p('Full selected CSV/NDJSON, exact saved source and review, complete chosen comparisons/evidence, standalone HTML, labelled event/numeric/location previews and the file manifest are retained together.','small muted'),
        node('div',{class:'actions'},submitButton('Prepare publication')));
      if(latest?.decision!=='accept')form.querySelector('button[type=submit]').dataset.readonly='true';
      return form;
    });
  form.querySelector('button[type=submit]').dataset.readonly=String(latest?.decision!=='accept');
  const selectors=[...form.querySelectorAll('fieldset')];
  for(const [name,records,container]of [['comparisonIds',comparisons,selectors[0]],['evidenceIds',evidence,selectors[1]]]){
    const known=new Set([...container.querySelectorAll('input')].map(x=>x.value));
    for(const item of records)if(!known.has(item.id)){
      container.querySelector('p')?.remove();
      container.append(check(name==='evidenceIds'?item.title:item.createdAt+' · '+short(item.rightEditionId,20),{
        name,value:item.id,help:name==='evidenceIds'?item.file.name+' · '+item.file.sha256:format(item.counts)}).wrap);
    }
  }
  const boundPublications=state.project.publications.filter(x=>x.versionId===v.id);
  return [...pageHeading('Publication and actual viewer evidence','Prepare a source-bound edition from the exact saved version and latest accepted original source review. Earlier publications remain intact.'),
    latest?.decision==='accept'?p('Accepted original review: '+latest.id+' · '+latest.actor+' · '+latest.createdAt,'flow-note'):
      node('div',{class:'flow-note'},p('This original source edition needs an accepted local review before publication.'),button('Open original source review',()=>guard(()=>showTab('source')))),
    form,
    node('h3',{},'Attach actual native viewer output'),
    !data.bound?p('The original host source inbox is not configured. Bind it through the existing managed workspace configuration.','empty'):null,
    receiveForm({kind:'evidence',label:'Retain viewer evidence',data,projectId:v.projectId,baseVersionId:v.id}),
    details('Original inbox identities',data),button('Refresh inbox and publication choices',()=>guard(async()=>{
      for(const k of [...state.forms.keys()])if(k.includes(':publication'))state.forms.delete(k);await refreshView();await loadProject(v.projectId,v.id,'publish');
    })),
    node('h3',{},'Frozen publications for this version'),
    boundPublications.length?table(['Publication','Recorded','Source / evidence','Files'],boundPublications.map(x=>[
      node('div',{},p(x.title),code(x.id)),x.createdAt,small((x.evidenceIds??[]).length+' actual supplied evidence file(s)'),
      button('Review complete publication',()=>guard(()=>openPublication(x.id)))])):p('No publication is saved for this version.','empty')];
}
async function openPublication(id){
  const publication=await request('/api/analysis/publications/'+encodeURIComponent(id)),
    listed=await request('/api/files?selection='+encodeURIComponent(JSON.stringify({kind:'analysis',id})));
  detail(publication.title??'Frozen publication',node('div',{},
    kv([['Publication',code(publication.id)],['Saved version',code(publication.versionId)],['Source edition',code(publication.editionId)],
      ['Prepared',publication.createdAt],['Attributed operator',publication.actor],['Viewer edition',code(publication.viewerId)],
      ['Source review',publication.sourceReview?.decision],['Manifest identity',code(publication.manifestSha256)]]),
    p(publication.note),filesTable(listed.files),details('Exact frozen publication record',publication)));
}
async function transferPane(){
  const data=await inbox(),v=state.version,pj=state.project;
  const result=[...pageHeading('Receive, export and reopen','Use the existing source inbox, native held-file downloader and project history. All receiving choices bind the exact displayed filename, byte count and SHA256.'),
    !data.bound?p('The original host source inbox is not bound. The existing managed host configuration must select that private directory.','empty'):
      p('The original host inbox is available. Choose complete already-retained files below.','flow-note'),
    node('div',{class:'actions'},button('Refresh original inbox',()=>guard(()=>showTab('transfer')))),
    details('Complete current inbox file identities',data)];
  if(pj){
    const exportForm=formCache('project-export',()=>{
      const form=formShell('Export the complete editable project',async(f,revision)=>{
        await beginAction('analysis.export',{projectId:pj.project.id,actor:requireActor(),note:value(f,'note').trim()},revision);
      });
      form.append(p('Includes all saved versions, exact source and viewer files, comparisons, annotations, publications and receiving evidence. The original core freezes this complete project history when it reserves the operation.','small muted'),
        field('Handover purpose',textarea('note','',{required:true,maxLength:12000})),node('div',{class:'actions'},submitButton('Export complete project')));
      return form;
    });result.push(exportForm,node('h3',{},'Retained complete project exports'),
      pj.exports.length?table(['Export','Recorded','Original head','File'],pj.exports.map(x=>[
        code(x.id),x.createdAt,code(x.headVersionId),readFileButtons({kind:'analysis',id:x.id})])):p('No complete project export is recorded.','empty'));
  }
  result.push(node('div',{class:'grid'},
    receiveForm({kind:'project',label:'Receive complete project',data}),
    receiveForm({kind:'source',label:'Receive original source edition',data})),
    receiveForm({kind:'viewer',label:'Receive original viewer archive',data}),
    node('h3',{},'Installed original viewer editions'),
    state.overview.viewers.length?table(['Viewer','Original release','Original archive','Files'],state.overview.viewers.map(x=>[
      code(x.id),format(x.upstream?.tag),pre(x.archive),readFileButtons({kind:'analysis',id:x.id})])):p('No original viewer archive is installed.','empty'));
  if(pj?.publications.length){
    const target=select('publicationId',pj.publications.map(x=>({value:x.id,label:x.title+' · '+short(x.id,18)})),pj.publications.at(-1).id),
      host=node('div',{}),render=()=>host.replaceChildren(receiveForm({kind:'receipt',label:'Attach original receiving receipt',data,publicationId:target.value}));
    target.addEventListener('change',render);render();result.push(node('h3',{},'Publication receiving receipts'),field('Exact publication',target),host,
      pj.receipts.length?table(['Publication','Recorded','Attributed receiver evidence','File'],pj.receipts.map(r=>[
        code(r.publicationId),r.createdAt,p(r.note),readFileButtons({kind:'analysis',id:r.id})])):p('No external receiving file is attached to this project.','empty'));
  }
  result.push(node('h3',{},'Original project receiving history'),
    (state.overview.imports??[]).length?table(['Receiving operation','Project','Original / retained local heads','Readback'],state.overview.imports.map(x=>[
      code(x.id),code(x.projectId),pre({original:x.originalHeadVersionId,preservedLocal:x.preservedLocalHeadVersionId}),
      button('Inspect original receipt',()=>detail('Complete project receiving receipt',x))])):p('No full project import is recorded in this workspace.','empty'),
    p('The original installed client supplies merchant_sensorthings_analysis and the existing manifest-bound file list/read/release/download tools. Use that same client for large-file or interrupted receiving; this page introduces no separate source capture, session, receiver or project store.','small muted'));
  return result;
}
function closeSession(){
  stopViewer();state.generation++;state.paneGeneration++;sessionStorage.removeItem(SESSION_KEY);
  Object.assign(state,{token:null,workspaceId:null,schema:null,view:null,overview:null,project:null,version:null,summary:null,edition:null,pending:null});
  state.forms.clear();state.catalogs.clear();state.editions.clear();state.sourceSummaries.clear();$('actor').value='';
  $('application').hidden=true;$('connection').hidden=false;$('refresh').disabled=true;$('lock').disabled=true;$('pane').replaceChildren();
  $('identity').textContent='Session closed in this tab. Original workspace and any retained pending-request envelope are unchanged.';status('');
}
$('project-search').addEventListener('input',renderProjects);
$('new-project').addEventListener('click',()=>guard(newProject));
$('refresh').addEventListener('click',()=>guard(async()=>{await refreshView();if(state.project)await loadProject(state.project.project.id,state.version?.id,state.tab);else await showTab(state.tab);}));
$('lock').addEventListener('click',closeSession);$('close-detail').addEventListener('click',()=>$('detail-dialog').close());
$('connect-form').addEventListener('submit',event=>{event.preventDefault();void guard(async()=>{
  const raw=$('private-link').value.trim();let token=raw;
  if(!TOKEN.test(token)){const u=new URL(raw);if(u.origin!==location.origin)throw new Error('Open the private link on this same original workspace origin.');token=u.hash.slice(1);}
  await connect(token);
});});
window.addEventListener('pagehide',()=>{stopViewer();if(state.pending)savePending();});
async function start(){
  const fragment=location.hash.slice(1);
  if(TOKEN.test(fragment))return connect(fragment);
  const raw=sessionStorage.getItem(SESSION_KEY);if(!raw)return;
  let saved;try{saved=JSON.parse(raw);}catch{return;}
  if(saved.origin===location.origin&&TOKEN.test(saved.token??'')&&UUID.test(saved.workspaceId??''))
    return connect(saved.token,{expectedWorkspaceId:saved.workspaceId});
}
void guard(start);
