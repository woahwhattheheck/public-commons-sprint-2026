'use strict';
const $=id=>document.getElementById(id);
const parse=(text,label='JSON')=>{try{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw new Error(label+' must be a JSON object.');}};
const formValue=id=>Object.fromEntries(new FormData($(id)));
const printable=value=>typeof value==='string'?value:JSON.stringify(value,null,2);
const lines=text=>String(text??'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
const requestId=kind=>'directus-'+kind+'-'+crypto.randomUUID();
let state=null,sourceId=null,sourceOffset=0,sourceTotal=0,selectedEdition=null,pollTimer=null,nativeRequest=null;
const sourceDocuments=new Map(),projectFormDrafts=new Map();
let pendingFieldDraft=null,draftSaveTimer=null;
let refreshGeneration=0,sourceGeneration=0,fieldGeneration=0,pageGeneration=0,editionGeneration=0;
const NATIVE_REQUEST_SCHEMA='stellar-forge.directus-browser-native-operation.v1';
const nativeOperationId=/^[A-Za-z0-9_.:-]{8,128}$/;
function operatorScope(value=state){
  return value?{operatorId:value.operator.id,instanceId:value.operator.instanceId,
    projectKey:value.operator.selected,workspaceId:value.id}:null;
}
function sameWorkspace(a,b){return !!a&&!!b&&['operatorId','projectKey','workspaceId'].every(key=>a[key]===b[key]);}
function sameScope(a,b){return sameWorkspace(a,b)&&a.instanceId===b.instanceId;}
function selectionChanged(){const error=new Error('The selected project changed. Reopen the original work in its project.');error.code='DSCOPE_BROWSER';error.status=409;return error;}
function assertWorkspace(scope){if(!sameWorkspace(scope,operatorScope()))throw selectionChanged();}
function nativePrefix(scope=operatorScope()){
  return 'directus-native-v1:'+encodeURIComponent(JSON.stringify([scope.operatorId,scope.projectKey,scope.workspaceId]))+':';
}
function nativeKey(request){return nativePrefix(request.scope)+request.input.operationId;}
function retainedNative(scope=operatorScope()){
  if(!scope)return [];
  const prefix=nativePrefix(scope),found=[];
  for(const key of Object.keys(sessionStorage)){
    if(!key.startsWith(prefix))continue;
    try{
      const record=JSON.parse(sessionStorage.getItem(key));
      if(record?.schema===NATIVE_REQUEST_SCHEMA&&sameWorkspace(record.scope,scope)&&
        typeof record.action==='string'&&nativeOperationId.test(record.input?.operationId??'')&&
        key===nativeKey(record))found.push(record);
    }catch{}
  }
  return found.sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)));
}
function canonicalInput(value){
  if(Array.isArray(value))return value.map(canonicalInput);
  return value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalInput(value[key])])):value;
}
function retainNative(record){
  const prior=sessionStorage.getItem(nativeKey(record));
  if(prior&&(JSON.parse(prior).action!==record.action||JSON.stringify(canonicalInput(JSON.parse(prior).input))!==JSON.stringify(canonicalInput(record.input))))
    throw new Error('This operation ID already retains different original inputs.');
  sessionStorage.setItem(nativeKey(record),JSON.stringify(record));
}
function formDraftKey(scope=operatorScope()){
  return 'directus-forms-v1:'+encodeURIComponent(JSON.stringify([scope.operatorId,scope.projectKey,scope.workspaceId]));
}
function projectForms(){return [...document.forms].filter(form=>form.id&&form.id!=='connection-form');}
function saveProjectFormDraft(scope=operatorScope()){
  if(!scope)return;clearTimeout(draftSaveTimer);draftSaveTimer=null;
  const forms={};
  for(const form of projectForms()){
    forms[form.id]={};
    for(const field of form.elements){
      if(!field.name||!['INPUT','TEXTAREA','SELECT'].includes(field.tagName)||
        ['file','password','button','submit','reset'].includes(field.type)||field.name==='metadataFields')continue;
      forms[form.id][field.name]={value:field.value,...(field.type==='checkbox'?{checked:field.checked}:{})};
    }
  }
  const record={schema:'stellar-forge.directus-browser-project-forms.v1',
    scope:{operatorId:scope.operatorId,projectKey:scope.projectKey,workspaceId:scope.workspaceId},forms,
    sourceId:$('edition-source').value,metadataSource:$('field-choices').dataset.source??null,
    metadataFields:[...$('field-choices').querySelectorAll('input:checked')].map(field=>field.value)};
  projectFormDrafts.set(formDraftKey(scope),record);
  try{sessionStorage.setItem(formDraftKey(scope),JSON.stringify(record));}
  catch{notice('The current project draft remains open, but browser storage could not save it for a reload.');}
}
function renderEditionChoices(){
  options($('edition-source'),state.sources.map(source=>[source.id,source.name+' · '+source.item_count+' items']));
  const editions=state.editions.map(edition=>[edition.id,edition.name+' · '+edition.row_count+' rows']);
  for(const select of document.querySelectorAll('.edition-select'))options(select,editions);
  options($('previous-edition'),editions,{empty:'First edition'});
  renderSessionBuyerChoices();
}
function renderSessionBuyerChoices(){
  options($('retained-session-buyer'),(state.project_runtime?.buyers??[]).map(item=>
    [item.id,(item.edition.name??item.edition.id)+' · '+item.id.slice(0,22)]));
}
function restoreProjectFormDraft(scope){
  for(const form of projectForms())form.reset();
  $('connection-form').reset();
  for(const input of document.querySelectorAll('[data-operation]'))input.value=requestId(input.dataset.operation);
  for(const id of ['source-list','edition-list','history-list','project-merchants','project-buyers','project-deliveries','project-sessions',
    'retained-native-work','retained-workspace-work','retained-project-receiving'])$(id)?.replaceChildren();
  for(const id of ['native-result','history-detail','merchant-result','query-result','edition-comparison'])jsonView(id,{});
  for(const id of ['edition-csv','edition-config','edition-record'])$(id).removeAttribute('href');
  $('item-search').value='';sourceOffset=0;sourceTotal=0;
  renderEditionChoices();pendingFieldDraft=null;
  let record=projectFormDrafts.get(formDraftKey(scope));
  if(!record){try{record=JSON.parse(sessionStorage.getItem(formDraftKey(scope))??'null');}catch{}}
  if(record?.schema!=='stellar-forge.directus-browser-project-forms.v1'||!sameWorkspace(record.scope,scope))return;
  for(const form of projectForms()){
    for(const field of form.elements){
      if(!field.name||!['INPUT','TEXTAREA','SELECT'].includes(field.tagName)||
        ['file','password','button','submit','reset'].includes(field.type)||field.name==='metadataFields')continue;
      const saved=record.forms?.[form.id]?.[field.name];if(!saved||typeof saved.value!=='string')continue;
      if(field.type==='checkbox')field.checked=saved.checked===true;
      else if(field.tagName==='SELECT')field.value=[...field.options].some(option=>option.value===saved.value)?saved.value:'';
      else field.value=saved.value;
    }
  }
  if(record.sourceId===record.metadataSource&&record.sourceId===$('edition-source').value&&Array.isArray(record.metadataFields))
    pendingFieldDraft={scope,sourceId:record.sourceId,fields:record.metadataFields};
}
function adoptState(next){
  const before=operatorScope(),after=operatorScope(next);
  if(!sameScope(before,after)&&before)saveProjectFormDraft(before);
  state=next;
  if(!sameScope(before,after)){
    sourceGeneration++;fieldGeneration++;pageGeneration++;editionGeneration++;
    sourceDocuments.clear();sourceId=null;selectedEdition=null;
    $('source-detail').hidden=true;$('edition-detail').hidden=true;
    $('field-choices').replaceChildren();delete $('field-choices').dataset.source;
    restoreProjectFormDraft(after);
    clearTimeout(pollTimer);pollTimer=null;nativeRequest=retainedNative()[0]??null;
    $('resume-native').hidden=!nativeRequest;
    $('native-status').textContent=nativeRequest?'Retained operation '+nativeRequest.input.operationId:'';
    jsonView('native-result',nativeRequest??{});jsonView('history-detail',{});
  }
}
function renderRetainedNative(){
  let target=$('retained-native-work');
  if(!target){
    const panel=document.createElement('section'),heading=document.createElement('h3');
    heading.textContent='Retained native work';target=document.createElement('div');target.id='retained-native-work';
    panel.append(heading,target);$('history').append(panel);
  }
  table('retained-native-work',['Original operation','Action','Saved',''],retainedNative().map(record=>{
    const actions=document.createElement('div');
    actions.append(button('Read',()=>jsonView('history-detail',record)),
      button('Continue',()=>nativeStart(record.action,record.input,record)));
    return [record.input.operationId,record.action,record.savedAt,actions];
  }));
  const legacy=sessionStorage.getItem('directus-native:'+state.id);
  let earlier=$('earlier-native-request');
  if(legacy&&!earlier){
    earlier=document.createElement('div');earlier.id='earlier-native-request';
    earlier.append(button('Download earlier browser request',()=>{
      const raw=sessionStorage.getItem('directus-native:'+state.id);
      if(raw===null)throw new Error('The earlier browser request is no longer available.');
      downloadBytes(new Blob([raw],{type:'application/json;charset=utf-8'}),'Directus_Earlier_Browser_Request.json');
    }));$('history').append(earlier);
  }else if(!legacy&&earlier)earlier.remove();
}
const WORKSPACE_REQUEST_SCHEMA='stellar-forge.directus-browser-workspace-operation.v1';
function workspacePrefix(scope=operatorScope()){
  return 'directus-workspace-v1:'+encodeURIComponent(JSON.stringify([scope.operatorId,scope.projectKey,scope.workspaceId]))+':';
}
function workspaceKey(record){return workspacePrefix(record.scope)+record.request.operationId;}
function retainedWorkspace(scope=operatorScope()){
  if(!scope)return [];
  const prefix=workspacePrefix(scope),found=[];
  for(const key of Object.keys(sessionStorage)){
    if(!key.startsWith(prefix))continue;
    try{
      const record=JSON.parse(sessionStorage.getItem(key));
      if(record?.schema===WORKSPACE_REQUEST_SCHEMA&&sameWorkspace(record.scope,scope)&&
        nativeOperationId.test(record.request?.operationId??'')&&typeof record.request.action==='string'&&
        typeof record.signature==='string'&&key===workspaceKey(record))found.push(record);
    }catch{}
  }
  return found.sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)));
}
function retainWorkspace(record){
  const key=workspaceKey(record),prior=sessionStorage.getItem(key);
  if(prior&&JSON.stringify(canonicalInput(JSON.parse(prior).request))!==JSON.stringify(canonicalInput(record.request)))
    throw new Error('This workspace operation ID already retains different original inputs.');
  sessionStorage.setItem(key,JSON.stringify(record));
}
async function originalWorkspaceResult(record){
  assertWorkspace(record.scope);
  let operation;
  try{operation=await api('/api/operation?id='+encodeURIComponent(record.request.operationId));}
  catch(error){if(error.code==='DIRECTUS_OPERATION_MISSING')return null;throw error;}
  const intent={...record.request};delete intent.operationId;
  if(JSON.stringify(canonicalInput(operation.input))!==JSON.stringify(canonicalInput(intent)))
    throw new Error('The stored operation belongs to different original inputs.');
  return operation.result;
}
async function completeWorkspace(record,result){
  if(result?.operationId!==record.request.operationId)throw new Error('The workspace result belongs to another original operation.');
  sessionStorage.removeItem(workspaceKey(record));
  if(sameWorkspace(record.scope,operatorScope())){
    jsonView('history-detail',result);renderRetainedWorkspace();await refresh();
  }
  assertWorkspace(record.scope);return result;
}
async function continueWorkspace(record,sourceBase64,readFirst=true){
  assertWorkspace(record.scope);
  if(readFirst){
    const completed=await originalWorkspaceResult(record);
    if(completed)return completeWorkspace(record,{...completed,replayed:true});
  }
  const request={...record.request};
  if(request.action==='import-source'){
    if(typeof sourceBase64!=='string')throw new Error('This import has not committed. Choose its original source file in Retained workspace work to continue the same request.');
    request.sourceBase64=sourceBase64;
  }
  const pending={...record,outcome:'pending',lastError:null};retainWorkspace(pending);
  try{
    const result=await api('/api/action',{method:'POST',value:request});
    return await completeWorkspace(pending,result);
  }catch(error){
    const rejected=error.status>=400&&error.status<500&&!String(error.code??'').startsWith('DSCOPE_');
    retainWorkspace({...pending,outcome:rejected?'rejected':'pending',
      lastError:{code:error.code??null,message:error.message},updatedAt:new Date().toISOString()});
    if(sameWorkspace(record.scope,operatorScope()))renderRetainedWorkspace();
    throw error;
  }
}
function renderRetainedWorkspace(){
  let target=$('retained-workspace-work');
  if(!target){
    const panel=document.createElement('section'),heading=document.createElement('h3');
    heading.textContent='Retained workspace work';target=document.createElement('div');target.id='retained-workspace-work';
    panel.append(heading,target);$('history').append(panel);
  }
  table('retained-workspace-work',['Original operation','Action','State',''],retainedWorkspace().map(record=>{
    const actions=document.createElement('div');
    actions.append(button('Read',()=>jsonView('history-detail',record)),
      button('Continue',()=>continueWorkspace(record)),
      button('Download request',()=>downloadBytes(new Blob([JSON.stringify(record,null,2)],{type:'application/json;charset=utf-8'}),
        'Directus_'+record.request.operationId+'.json')));
    if(record.request.action==='import-source'){
      const file=document.createElement('input');file.type='file';file.hidden=true;
      file.addEventListener('change',()=>guard(async()=>{
        const selected=file.files[0];if(!selected)return;assertWorkspace(record.scope);
        const original=await readSourceFile(selected);assertWorkspace(record.scope);
        if(JSON.stringify(canonicalInput(original.identity))!==JSON.stringify(canonicalInput(record.request.sourceBase64)))
          throw new Error('Choose the complete original source file with the retained byte length and SHA-256.');
        await continueWorkspace(record,original.sourceBase64);
      }));
      actions.append(file,button('Choose original file',()=>file.click()));
    }
    return [record.request.operationId,record.request.action,
      record.outcome==='rejected'?'Needs a new reviewed request':record.lastError?.message??'Awaiting original result',actions];
  }));
  let earlier=$('earlier-workspace-requests');
  const legacyKeys=Object.keys(sessionStorage).filter(key=>key.startsWith('directus-pending:'+state.id+':')||key==='directus-receive:'+state.id);
  if(legacyKeys.length&&!earlier){
    earlier=document.createElement('div');earlier.id='earlier-workspace-requests';
    earlier.append(button('Download earlier browser work',()=>{
      const entries=Object.keys(sessionStorage).filter(key=>key.startsWith('directus-pending:'+state.id+':')||key==='directus-receive:'+state.id)
        .map(key=>({key,value:sessionStorage.getItem(key)}));
      downloadBytes(new Blob([JSON.stringify(entries,null,2)],{type:'application/json;charset=utf-8'}),'Directus_Earlier_Workspace_Requests.json');
    }));$('history').append(earlier);
  }else if(!legacyKeys.length&&earlier)earlier.remove();
}
const RECEIVING_REQUEST_SCHEMA='stellar-forge.directus-browser-project-receiving.v1';
function receivingPrefix(scope=operatorScope()){
  return 'directus-receiving-v1:'+encodeURIComponent(JSON.stringify([scope.operatorId,scope.projectKey,scope.workspaceId]))+':';
}
function receivingKey(record){return receivingPrefix(record.scope)+record.identity.sha256;}
function retainedReceiving(scope=operatorScope()){
  if(!scope)return [];
  return Object.keys(sessionStorage).filter(key=>key.startsWith(receivingPrefix(scope))).flatMap(key=>{
    try{
      const record=JSON.parse(sessionStorage.getItem(key));
      return record?.schema===RECEIVING_REQUEST_SCHEMA&&sameWorkspace(record.scope,scope)&&
        nativeOperationId.test(record.operationId??'')&&/^[a-f0-9]{64}$/.test(record.identity?.sha256??'')&&
        key===receivingKey(record)?[record]:[];
    }catch{return [];}
  });
}
function renderRetainedReceiving(){
  let target=$('retained-project-receiving');
  if(!target){
    const panel=document.createElement('section'),heading=document.createElement('h3');
    heading.textContent='Retained project receiving';target=document.createElement('div');target.id='retained-project-receiving';
    panel.append(heading,target);$('history').append(panel);
  }
  table('retained-project-receiving',['Original operation','Project file','Bytes',''],retainedReceiving().map(record=>{
    const actions=document.createElement('div'),file=document.createElement('input');file.type='file';file.hidden=true;
    file.addEventListener('change',()=>guard(async()=>{const selected=file.files[0];if(selected)await receiveProjectFile(selected,record);}));
    actions.append(button('Read',()=>jsonView('history-detail',record)),file,button('Choose original project',()=>file.click()));
    return [record.operationId,record.filename,record.identity.bytes,actions];
  }));
}
async function receiveProjectFile(file,original=null){
  const scope=operatorScope();if(original)assertWorkspace(original.scope);
  const identity=await fileIdentity(file,'editable project');assertWorkspace(scope);
  if(original&&JSON.stringify(canonicalInput(original.identity))!==JSON.stringify(canonicalInput(identity)))
    throw new Error('Choose the complete original project with the retained byte length and SHA-256.');
  const record=original??retainedReceiving(scope).find(value=>value.identity.sha256===identity.sha256)??{
    schema:RECEIVING_REQUEST_SCHEMA,scope:{operatorId:scope.operatorId,projectKey:scope.projectKey,workspaceId:scope.workspaceId},
    operationId:requestId('receive'),identity,filename:file.name,savedAt:new Date().toISOString()};
  sessionStorage.setItem(receivingKey(record),JSON.stringify(record));renderRetainedReceiving();
  const result=await api('/api/receive',{method:'POST',raw:file,headers:{'content-type':'application/vnd.sqlite3','x-operation-id':record.operationId},scope});
  if(result.operationId!==record.operationId||result.sha256!==identity.sha256||result.bytes!==identity.bytes||
    result.state?.operator?.id!==scope.operatorId||result.state?.operator?.selected!=='received-'+identity.sha256)
    throw new Error('The received project differs from its original file or operator.');
  sessionStorage.removeItem(receivingKey(record));refreshGeneration++;adoptState(result.state);await refresh();
  if(nativeRequest)await pollNative(nativeRequest);
  notice('Complete project received and opened.');
}
function downloadBytes(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function downloadProjectFile(url){
  const scope=operatorScope(),response=await fetch(url,{headers:scopeHeaders(scope),cache:'no-store'});
  if(!response.ok){
    const data=await response.json();const error=new Error(data.message??'The original file could not be received.');
    error.code=data.error;error.status=response.status;throw error;
  }
  const name=/filename="([^"]+)"/.exec(response.headers.get('content-disposition')??'')?.[1]??'Directus_Download';
  downloadBytes(await response.blob(),name);
}
function notice(message){$('notice').textContent=message??'';}
function jsonView(id,value){$(id).textContent=JSON.stringify(value,null,2);}
function button(label,run){const node=document.createElement('button');node.type='button';node.textContent=label;node.addEventListener('click',()=>guard(run));return node;}
function table(target,headers,rows){
  const table=document.createElement('table'),thead=document.createElement('thead'),tr=document.createElement('tr');
  for(const name of headers){const th=document.createElement('th');th.textContent=name;tr.append(th);}thead.append(tr);table.append(thead);
  const tbody=document.createElement('tbody');
  for(const row of rows){const tr=document.createElement('tr');for(const value of row){const td=document.createElement('td');if(value instanceof Node)td.append(value);else td.textContent=value===null?'null':String(value??'');tr.append(td);}tbody.append(tr);}
  if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=headers.length;td.textContent='No retained records yet.';tr.append(td);tbody.append(tr);}
  table.append(tbody);$(target).replaceChildren(table);
}
function options(select,entries,{empty}={}){
  const old=select.value;select.replaceChildren();
  if(empty!==undefined){const option=document.createElement('option');option.value='';option.textContent=empty;select.append(option);}
  for(const [value,label] of entries){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}
  if(entries.some(([id])=>id===old))select.value=old;
}
function scopeHeaders(scope=operatorScope()){
  if(!scope)return {};
  return {'x-directus-operator':scope.operatorId,'x-directus-instance':scope.instanceId,
    'x-directus-project':scope.projectKey,'x-directus-workspace':scope.workspaceId};
}
async function api(url,{method='GET',value,raw,headers={},scope=operatorScope()}={}){
  const response=await fetch(url,{method,headers:{...(url==='/api/state'?{}:scopeHeaders(scope)),...(value===undefined?{}:{'content-type':'application/json'}),...headers},body:raw??(value===undefined?undefined:JSON.stringify(value)),cache:'no-store'});
  const data=await response.json();
  if(url!=='/api/state'&&scope&&!sameScope(scope,operatorScope()))throw selectionChanged();
  if(!response.ok){const error=new Error(data.message??data.error??'The operation failed.');error.code=data.error;error.status=response.status;throw error;}
  return data;
}
async function guard(run){
  try{return await run();}catch(error){notice((error.code?error.code+': ':'')+error.message);if(error.status===409)await refresh().catch(()=>{});}
}
function onForm(id,run){$(id).addEventListener('submit',event=>{event.preventDefault();guard(async()=>{const buttons=[...$(id).querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{await run(formValue(id));}finally{buttons.forEach(b=>b.disabled=false);}});});}
const actor=()=>{const value=$('actor').value.trim();if(!value)throw new Error('Name the operator making this change.');return value;};
async function change(action,input,{sourceIdentity}={}){
  const scope=operatorScope(),storedInput={...input};
  if(action==='import-source'){
    if(!sourceIdentity||!/^[a-f0-9]{64}$/.test(sourceIdentity.sha256)||!Number.isSafeInteger(sourceIdentity.bytes)||sourceIdentity.bytes<1)
      throw new Error('Read the complete original source file before retaining its import.');
    storedInput.sourceBase64=sourceIdentity;
  }
  const signature=JSON.stringify(canonicalInput(storedInput));
  const previous=retainedWorkspace(scope).find(record=>record.request.action===action&&record.signature===signature&&record.outcome!=='rejected');
  const record=previous??{schema:WORKSPACE_REQUEST_SCHEMA,scope:{operatorId:scope.operatorId,
    projectKey:scope.projectKey,workspaceId:scope.workspaceId},signature,savedAt:new Date().toISOString(),outcome:'pending',
    request:{...storedInput,action,actor:actor(),operationId:requestId(action),expectedRevision:state.revision}};
  retainWorkspace(record);renderRetainedWorkspace();
  return continueWorkspace(record,input.sourceBase64,Boolean(previous));
}
async function refresh(){
  const generation=++refreshGeneration,next=await api('/api/state');
  if(generation!==refreshGeneration)return state;
  adoptState(next);
  $('workspace-status').textContent=state.id+' · revision '+state.revision;
  $('activity').textContent=state.native_active?state.native_active+' native operation running':'';
  options($('project'),state.operator.projects.map(p=>[p.key,p.name]));$('project').value=state.operator.selected;
  if(document.activeElement!==$('base-url'))$('base-url').value=state.connection.baseUrl;
  $('connection-status').textContent=state.connection.configured?'Connection configured · '+(state.connection.authenticated?'token available':'token required'):'Configure the original Directus API.';
  const sourceRows=state.sources.map(s=>[s.name,s.collection??s.scope?.collection,s.item_count,s.recorded_at??s.created_at,button('Open',()=>openSource(s.id))]);
  table('source-list',['Capture','Collection','Items','Captured',''],sourceRows);
  renderEditionChoices();
  table('edition-list',['Edition','Rows','Latest review',''],state.editions.map(e=>{
    const review=state.reviews.filter(r=>r.edition_id===e.id).at(-1);
    return [e.name,e.row_count,review?.decision??'Awaiting review',button('Open',()=>openEdition(e.id))];
  }));
  const native=state['native-events']??[],groups=new Map();
  for(const e of native)groups.set(e.operation_id,e);
  const history=[...groups.values()].map(e=>[e.created_at,e.action,e.phase,e.operation_id,button('Read',async()=>jsonView('history-detail',await api('/api/native-history?id='+encodeURIComponent(e.operation_id))))]);
  for(const r of state.reviews)history.push([r.created_at,'Edition review',r.decision,r.id,button('Read',async()=>jsonView('history-detail',await api('/api/record?kind=reviews&id='+encodeURIComponent(r.id))))]);
  for(const p of state.publications)history.push([p.created_at,'Publication',p.publication?.status,p.id,button('Read',async()=>jsonView('history-detail',await api('/api/record?kind=publications&id='+encodeURIComponent(p.id))))]);
  history.sort((a,b)=>String(b[0]).localeCompare(String(a[0])));table('history-list',['Time','Operation','State','Original ID',''],history);
  renderProjectRuntime();renderRetainedNative();renderRetainedWorkspace();renderRetainedReceiving();
  await loadFields();return state;
}

function renderProjectRuntime(){
  const scope=operatorScope(),runtime=state.project_runtime??{merchants:[],buyers:[],deliveries:[],sessions:[]};
  renderSessionBuyerChoices();
  table('project-merchants',['Edition','Snapshot',''],runtime.merchants.map(item=>{
    const use=button('Use publisher',()=>{
      assertWorkspace(scope);
      for(const field of document.querySelectorAll('[data-package]'))field.value=item.directory;
      $('serve-form').elements.stageDirectory.value=item.stageDirectory;
      $('merchant-form').elements.editionId.value=item.edition.id;
      $('merchant-form').elements.directory.value=item.directory;
      $('merchant-form').elements.versionDirectory.value=item.versionDirectory;
      saveProjectFormDraft(scope);
      notice('Saved publisher selected. Start the seller to use its retained dataset history.');
    });
    use.dataset.projectMerchant=item.id;
    return[item.edition.name,item.edition.snapshot.slice(0,16),use];
  }));
  table('project-buyers',['Edition','Configuration',''],runtime.buyers.map(item=>{
    const download=document.createElement('a');download.textContent='Download configuration';
    download.href='/api/download?kind=buyer-config&id='+encodeURIComponent(item.id);
    download.dataset.projectBuyer=item.id;
    return[item.edition.name??item.edition.id,item.id.slice(0,22),download];
  }));
  table('project-sessions',['Acquisition','Snapshot',''],(runtime.sessions??[]).map(item=>{
    const actions=document.createElement('div');actions.className='toolbar';
    const use=button('Use session',()=>{
      assertWorkspace(scope);
      $('receive-buyer-form').elements.sessionDirectory.value=item.directory;
      $('save-session-form').elements.directory.value=item.directory;
      $('retained-session-buyer').value=item.buyerId;
      const publisher=runtime.merchants.find(merchant=>merchant.edition.snapshot===item.snapshot);
      if(publisher)$('receive-buyer-form').elements.directory.value=publisher.directory;
      saveProjectFormDraft(scope);
      notice('Saved acquisition selected for customer receiving.');
    });
    use.dataset.projectSession=item.id;
    const inspect=button('Inspect session',async()=>{
      assertWorkspace(scope);
      jsonView('merchant-result',await api('/api/buyer',{method:'POST',scope,value:{action:'session-status',id:item.id}}));
    });
    inspect.dataset.projectSessionInspect=item.id;actions.append(use,inspect);
    return[item.sessionId,item.snapshot.slice(0,16),actions];
  }));
  table('project-deliveries',['Edition','Rows',''],runtime.deliveries.map(item=>{
    const inspect=button('Inspect delivery',async()=>{
      assertWorkspace(scope);
      $('receive-buyer-form').elements.destination.value=item.directory;saveProjectFormDraft(scope);
      jsonView('merchant-result',await api('/api/buyer',{method:'POST',scope,value:{action:'inspect',directory:item.directory}}));
    });
    inspect.dataset.projectDelivery=item.id;
    return[item.edition.name??item.edition.id,item.rows,inspect];
  }));
}

async function sourceDocument(id){
  if(!sourceDocuments.has(id))sourceDocuments.set(id,await api('/api/record?kind=sources&id='+encodeURIComponent(id)+'&limit=20'));
  return sourceDocuments.get(id);
}
async function loadFields(){
  const generation=++fieldGeneration,id=$('edition-source').value;
  if(!id){$('field-choices').replaceChildren();delete $('field-choices').dataset.source;return;}
  const source=await sourceDocument(id);
  if(generation!==fieldGeneration||$('edition-source').value!==id)return;
  const restoring=pendingFieldDraft&&sameWorkspace(pendingFieldDraft.scope,operatorScope())&&pendingFieldDraft.sourceId===id;
  const previous=new Set(restoring?pendingFieldDraft.fields:[...$('field-choices').querySelectorAll('input:checked')].map(n=>n.value));
  const same=restoring||$('field-choices').dataset.source===id,fragment=document.createDocumentFragment();
  for(const field of source.native_schema.fields){
    const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');
    input.type='checkbox';input.name='metadataFields';input.value=field.field;input.checked=same?previous.has(field.field):field.schema?.is_primary_key===true;
    text.textContent=field.field+' · '+field.type+(field.schema?.is_primary_key?' · primary key':'');label.append(input,text);fragment.append(label);
  }
  $('field-choices').replaceChildren(fragment);$('field-choices').dataset.source=id;
  if(restoring)pendingFieldDraft=null;
}
async function openSource(id){
  const generation=++sourceGeneration;sourceId=id;sourceOffset=0;
  $('source-detail').hidden=false;$('edition-source').value=id;
  await loadFields();if(generation!==sourceGeneration||sourceId!==id)return;await itemPage();
}
async function itemPage(){
  if(!sourceId)return;
  const generation=++pageGeneration,id=sourceId,offset=sourceOffset,search=$('item-search').value;
  const current=()=>generation===pageGeneration&&sourceId===id&&sourceOffset===offset&&$('item-search').value===search;
  const source=await sourceDocument(id);if(!current())return;
  const page=await api('/api/items?id='+encodeURIComponent(id)+'&offset='+offset+'&limit=20&search='+encodeURIComponent(search));
  if(!current())return;if(page.sourceId!==id)throw new Error('The source page belongs to a different capture.');sourceTotal=page.total;
  $('source-title').textContent=source.name;$('source-scope').textContent=source.base_url+' · '+source.scope.collection+' · '+source.sha256;
  $('item-page').textContent=(page.total?offset+1:0)+'–'+(offset+page.items.length)+' of '+page.total;
  $('previous-items').disabled=offset===0;$('next-items').disabled=offset+page.items.length>=page.total;
  const fields=source.native_schema.fields.slice(0,5).map(f=>f.field);
  table('items',['Key',...fields,''],page.items.map(item=>[item.key,...fields.map(f=>{const v=item.values?.[f];return v?.state==='value'?v.json:v?.state??'missing';}),
    button('Original item',()=>{jsonView('history-detail',item);$('history').scrollIntoView({behavior:'smooth'});})]));
}
async function openEdition(id){
  const generation=++editionGeneration,edition=await api('/api/record?kind=editions&id='+encodeURIComponent(id)+'&limit=20');
  if(generation!==editionGeneration)return;
  if(edition.id!==id)throw new Error('The edition response belongs to another selection.');selectedEdition=edition;
  $('edition-detail').hidden=false;$('edition-title').textContent=edition.name;$('edition-identity').textContent='Edition '+edition.sha256+'\nSnapshot '+edition.snapshot;
  for(const [node,kind] of [['edition-csv','dataset'],['edition-config','config'],['edition-record','editions']])$(node).href='/api/download?kind='+kind+'&id='+encodeURIComponent(id);
  table('edition-rows',edition.columns,edition.rows.map(row=>edition.columns.map(key=>row[key])));
}
function fillNativeResult(action,result){
  const native=result?.native??result;
  if(native?.versionId)for(const input of document.querySelectorAll('[data-version]'))input.value=native.versionId;
  if(action==='draft-compare'){
    if(native?.mainHash!==undefined)$('draft-promote-form').elements.mainHash.value=native.mainHash??'';
    if(native?.versionSha256)$('draft-promote-form').elements.expectedVersionSha256.value=native.versionSha256;
  }
}
async function pollNative(request=nativeRequest){
  if(!request||!sameWorkspace(request.scope,operatorScope())||nativeRequest!==request)return;
  try{
    const result=await api('/api/native-status?id='+encodeURIComponent(request.input.operationId));
    if(nativeRequest!==request||!sameWorkspace(request.scope,operatorScope()))return;
    if(result.operationId!==request.input.operationId||result.action!==request.action)
      throw new Error('The native result belongs to a different original request.');
    $('native-status').textContent=result.operationId+' · '+result.state;
    jsonView('native-result',result.result??result.error??result);
    $('resume-native').hidden=!['failed','resumable'].includes(result.state);
    if(result.state==='running'){pollTimer=setTimeout(()=>guard(()=>pollNative(request)),1500);return;}
    if(result.state==='complete'){
      fillNativeResult(request.action,result.result);
      sessionStorage.removeItem(nativeKey(request));renderRetainedNative();
      notice('Native operation complete. Its original history is retained.');await refresh();
    }else notice(result.error?.message??'Continue the original native request to finish its retained operation.');
  }catch(error){
    if(nativeRequest!==request||!sameWorkspace(request.scope,operatorScope()))return;
    $('resume-native').hidden=false;throw error;
  }
}
async function nativeStart(action,input,original=null){
  const scope=operatorScope();let request;
  if(original){assertWorkspace(original.scope);request=original;action=original.action;input=original.input;}
  else{
    const previous=retainedNative(scope).find(record=>record.input.operationId===input.operationId);
    input={...input,actor:previous?.input.actor??input.actor??actor()};
    if(previous&&(previous.action!==action||
      JSON.stringify(canonicalInput(previous.input))!==JSON.stringify(canonicalInput(input))))
      throw new Error('This original operation has different retained inputs. Reopen it from Retained native work, or start a new request.');
    request=previous??{schema:NATIVE_REQUEST_SCHEMA,scope:{operatorId:scope.operatorId,
      projectKey:scope.projectKey,workspaceId:scope.workspaceId},action,input,savedAt:new Date().toISOString()};
  }
  assertWorkspace(request.scope);retainNative(request);nativeRequest=request;
  clearTimeout(pollTimer);$('resume-native').hidden=true;renderRetainedNative();
  try{
    const result=await api('/api/native',{method:'POST',value:{action,...input},scope});
    if(nativeRequest!==request||!sameWorkspace(request.scope,operatorScope()))return;
    if(result.operationId!==request.input.operationId||result.action!==request.action)
      throw new Error('The native start returned a different original operation.');
    $('native-status').textContent=result.operationId+' · '+result.state;await pollNative(request);
  }catch(error){
    if(nativeRequest===request&&sameWorkspace(request.scope,operatorScope()))$('resume-native').hidden=false;
    throw error;
  }
}
for(const input of document.querySelectorAll('[data-operation]'))input.value=requestId(input.dataset.operation);
for(const b of document.querySelectorAll('[data-new-request]'))b.addEventListener('click',()=>{const input=$(b.dataset.newRequest).elements.operationId;input.value=requestId(input.dataset.operation);});
$('actor').value=localStorage.getItem('directus-actor')??'Directus operator';$('actor').addEventListener('change',()=>localStorage.setItem('directus-actor',$('actor').value));
$('refresh').addEventListener('click',()=>guard(refresh));
$('project').addEventListener('change',()=>guard(async()=>{
  clearTimeout(pollTimer);const selected=await api('/api/select-project',{method:'POST',value:{key:$('project').value}});
  refreshGeneration++;adoptState(selected);await refresh();if(nativeRequest)await pollNative(nativeRequest);
}));
$('edition-source').addEventListener('change',()=>{pendingFieldDraft=null;void guard(loadFields);});
$('previous-items').addEventListener('click',()=>guard(async()=>{sourceOffset=Math.max(0,sourceOffset-20);await itemPage();}));
$('next-items').addEventListener('click',()=>guard(async()=>{if(sourceOffset+20<sourceTotal)sourceOffset+=20;await itemPage();}));
$('item-search').addEventListener('change',()=>guard(async()=>{sourceOffset=0;await itemPage();}));
$('resume-native').addEventListener('click',()=>guard(()=>{
  if(!nativeRequest)throw new Error('Choose retained native work from this project.');
  return nativeStart(nativeRequest.action,nativeRequest.input,nativeRequest);
}));
onForm('connection-form',async input=>{await api('/api/connection',{method:'POST',value:input});$('connection-form').elements.token.value='';notice('Connection configured.');await refresh();});
onForm('capture-form',async input=>{input.query=parse(input.query,'Native query');input.pageSize=Number(input.pageSize);if(!input.name)delete input.name;await nativeStart('capture',input);});
onForm('draft-create-form',async input=>{input.item=input.item||null;if(!input.name)delete input.name;await nativeStart('draft-create',input);});
onForm('draft-save-form',async input=>{parse(input.patchJson,'Original patch');await nativeStart('draft-save',input);});
onForm('draft-compare-form',input=>nativeStart('draft-compare',input));
onForm('draft-promote-form',async input=>{input.mainHash=input.mainHash||null;input.fields=lines(input.fields);if(!input.fields.length)delete input.fields;await nativeStart('draft-promote',input);});
onForm('edition-form',async input=>{
  if($('edition-source').value!==input.sourceId||$('field-choices').dataset.source!==input.sourceId)
    throw new Error('Wait for the fields of the selected original capture before saving its edition.');
  const metadataFields=[...$('field-choices').querySelectorAll('input:checked')].map(i=>i.value);
  if(metadataFields.length<1||metadataFields.length>32)throw new Error('Select 1–32 native fields.');
  const source=await sourceDocument(input.sourceId);
  if($('edition-source').value!==input.sourceId||$('field-choices').dataset.source!==input.sourceId)
    throw new Error('The source selection changed while its edition was being prepared.');
  const result=await change('save-edition',{name:input.name,mode:'collection',selection:[{sourceId:source.id,sourceSha256:source.sha256,collection:source.scope.collection}],
    metadataFields,rights:{attribution:input.attribution,basis:input.rights,...(input.reference?{reference:input.reference}:{})},
    ...(input.previousEditionId?{previousEditionId:input.previousEditionId}:{}),nativeOperationIds:lines(input.nativeOperationIds)});
  notice('Edition saved.');await openEdition(result.edition.id);
});
onForm('review-form',async input=>{const e=state.editions.find(e=>e.id===input.editionId);const result=await change('review-edition',{...input,editionSha256:e.sha256});notice('Review saved.');jsonView('history-detail',result);});
$('select-edition').addEventListener('click',()=>guard(async()=>{const editionId=$('review-form').elements.editionId.value,review=state.reviews.filter(r=>r.edition_id===editionId).at(-1);if(review?.decision!=='approved')throw new Error('Choose an edition with a current approved review.');await change('select-edition',{editionId,reviewId:review.id});notice('Approved edition selected.');}));
onForm('compare-editions-form',async input=>{const result=await change('compare-editions',input);jsonView('edition-comparison',await api('/api/record?kind=comparisons&id='+encodeURIComponent(result.comparison.id)));});
onForm('query-form',async input=>jsonView('query-result',await api('/api/query',{method:'POST',value:{editionId:input.editionId,query:parse(input.query,'Dataset query')}})));
onForm('merchant-form',async input=>{
  const edition=state.editions.find(e=>e.id===input.editionId),review=state.reviews.filter(r=>r.edition_id===edition.id).at(-1);
  if(review?.decision!=='approved')throw new Error('Choose a currently approved edition.');
  const result=await api('/api/merchant',{method:'POST',value:{action:'prepare',...input,editionSha256:edition.sha256,reviewId:review.id,payment:parse(input.payment,'Payment terms')}});
  for(const field of document.querySelectorAll('[data-package]'))field.value=result.directory;
  jsonView('merchant-result',result);await refresh();notice('Merchant package prepared.');
});
onForm('serve-form',async input=>{const result=await api('/api/merchant',{method:'POST',value:{action:'serve',directory:input.directory,stageDirectory:input.stageDirectory,runtime:parse(input.runtime,'Runtime')}});jsonView('merchant-result',result);$('buyer-form').elements.seller.value=result.url;await refresh();});
$('stop-seller').addEventListener('click',()=>guard(async()=>{jsonView('merchant-result',await api('/api/merchant',{method:'POST',value:{action:'stop',directory:$('serve-form').elements.directory.value}}));await refresh();}));
$('publish-refresh').addEventListener('click',()=>guard(async()=>{const input=formValue('serve-form');jsonView('merchant-result',await api('/api/merchant',{method:'POST',value:{action:'publish',directory:input.directory,expectedSnapshot:input.expectedSnapshot,expectedRevision:Number(input.expectedRevision)}}));await refresh();}));
const buyerInput=()=>{const input=formValue('buyer-form');return {directory:input.directory,seller:input.seller,query:parse(input.query,'First page query')};};
onForm('buyer-form',async()=>{const result=await api('/api/buyer',{method:'POST',value:{action:'offer',...buyerInput()}});jsonView('merchant-result',result);if(result.offerSha256)$('buyer-form').elements.offerSha256.value=result.offerSha256;});
$('prepare-buyer').addEventListener('click',()=>guard(async()=>{const input=formValue('buyer-form');jsonView('merchant-result',await api('/api/buyer',{method:'POST',value:{action:'prepare',...buyerInput(),intentId:input.intentId,acceptIndex:Number(input.acceptIndex),offerSha256:input.offerSha256,destination:input.destination}}));await refresh();}));
onForm('save-session-form',async input=>{
  jsonView('merchant-result',await api('/api/buyer',{method:'POST',value:{action:'retain-session',...input}}));
  await refresh();notice('Acquired session saved with this project.');
});
onForm('receive-buyer-form',async input=>{jsonView('merchant-result',await api('/api/buyer',{method:'POST',value:{action:'receive',...input,includeSourceCaptures:$('receive-buyer-form').elements.includeSourceCaptures.checked}}));await refresh();});
$('inspect-delivery').addEventListener('click',()=>guard(async()=>jsonView('merchant-result',await api('/api/buyer',{method:'POST',value:{action:'inspect',directory:$('receive-buyer-form').elements.destination.value}}))));
function fileBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('The selected file could not be read.'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});}
async function fileIdentity(file,label){
  if(file.size<1||file.size>256*1024*1024)throw new Error('Choose the complete '+label+', up to 256 MiB.');
  const bytes=await file.arrayBuffer();
  return {sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join(''),bytes:bytes.byteLength};
}
async function readSourceFile(file){
  const identity=await fileIdentity(file,'source capture');
  return {identity,sourceBase64:await fileBase64(file)};
}
$('import-source').addEventListener('change',()=>guard(async()=>{
  const file=$('import-source').files[0],scope=operatorScope();if(!file)return;
  const original=await readSourceFile(file);assertWorkspace(scope);
  const result=await change('import-source',{sourceBase64:original.sourceBase64},{sourceIdentity:original.identity});
  $('import-source').value='';notice('Source capture retained.');await openSource(result.source.id);
}));
$('receive-project').addEventListener('change',()=>guard(async()=>{
  const file=$('receive-project').files[0];if(!file)return;
  await receiveProjectFile(file);$('receive-project').value='';
}));
for(const eventName of ['input','change'])document.addEventListener(eventName,event=>{
  const form=event.target.closest('form');if(!state||!form||form.id==='connection-form')return;
  const scope=operatorScope();clearTimeout(draftSaveTimer);
  draftSaveTimer=setTimeout(()=>{if(sameWorkspace(scope,operatorScope()))saveProjectFormDraft(scope);},150);
});
window.addEventListener('pagehide',()=>{if(state)saveProjectFormDraft();});
document.addEventListener('click',event=>{
  const anchor=event.target.closest('a[href]');if(!anchor)return;
  const url=new URL(anchor.href,location.href);
  if(url.origin===location.origin&&url.pathname==='/api/download'){
    event.preventDefault();void guard(()=>downloadProjectFile(url.pathname+url.search));
  }
});
guard(async()=>{await refresh();if(nativeRequest)await pollNative(nativeRequest);});
