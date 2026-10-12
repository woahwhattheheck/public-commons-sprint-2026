// MIT. Complete customer-update operator on the original Research listener.
const $=id=>document.getElementById(id),clone=value=>structuredClone(value),pretty=value=>JSON.stringify(value,null,2),
  now=()=>new Date().toISOString(),uid=()=>crypto.randomUUID(),tokenKey='research-dossiers-session:'+location.origin;
const state={token:sessionStorage.getItem(tokenKey)||'',workspaceId:null,instanceId:null,dossierId:null,projectId:null,
  revision:null,historyRevision:null,tab:'brief',busy:false,data:{},dossiers:[],requestId:null,newRequest:false,
  newProject:uid(),requestDraft:uid(),workId:null,deliveryId:null,recordOffset:0,recordQuery:'',recordPage:null,
  drafts:{},changeOffset:0,changePage:null,historySection:'operations',historyOffset:0,historyPage:null,form:null,
  latestRevision:null,workingView:null,workingImportKey:null,workingImportReview:null};
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.has('token')){state.token=fragment.get('token');sessionStorage.setItem(tokenKey,state.token);
  history.replaceState(null,'',location.pathname+location.search);}
const fail=code=>{throw Object.assign(new Error(code),{code});};
const need=(value,code)=>{if(!value)fail(code);};
const msg=(value,error=false)=>{$('message').textContent=value;$('message').className=error?'error':'';};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const jsonSha=value=>sha(new TextEncoder().encode(JSON.stringify(canonical(value),null,2)+'\n'));
const scope=()=>state.workspaceId+':'+state.dossierId+':';
const project=()=>state.data.projects?.find(row=>row.id===state.projectId);
const currentBrief=()=>state.data.briefs?.find(row=>row.id===(state.workingView?.bindings?.briefId??project()?.currentBriefId));
const selectedRequest=()=>state.data.requests?.find(row=>row.id===state.requestId);
const requestedBrief=()=>state.data.briefs?.find(row=>row.id===selectedRequest()?.definition.briefId);
const actor=()=>{const value={id:$('actor-id').value,name:$('actor-name').value};
  need(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value.id)&&value.name.trim(),'Enter the operator ID and name.');return value;};
const urlParams=value=>{const params=new URLSearchParams();for(const[key,item]of Object.entries(value??{}))
  if(item!==undefined&&item!==null&&item!=='')params.set(key,String(item));return params.size?'?'+params:'';
};
const rootPath=()=>'/api/dossiers/'+encodeURIComponent(state.dossierId)+'/customer-updates';
const dataKey=(kind,id)=>'form:'+scope()+kind+':'+id;
let database;const persistenceErrors=new Map();
const writes=new Set();
function db(){
  if(!database)database=new Promise((resolve,reject)=>{
    const request=indexedDB.open('research-customer-updates-v1',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('records',{keyPath:'key'});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });return database;
}
async function transact(mode,work){
  const connection=await db();return await new Promise((resolve,reject)=>{
    const tx=connection.transaction('records',mode),store=tx.objectStore('records');let result;
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('Local storage transaction stopped.'));
    work(store,value=>{result=value;});
  });
}
const get=key=>transact('readonly',(store,set)=>{const request=store.get(key);request.onsuccess=()=>set(request.result);});
const put=row=>transact('readwrite',store=>store.put(row));
const remove=key=>transact('readwrite',store=>store.delete(key));
const rows=prefix=>transact('readonly',(store,set)=>{const result=[],request=store.openCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));
  request.onsuccess=()=>{const cursor=request.result;if(cursor){result.push(cursor.value);cursor.continue();}else set(result);};});
function retain(form){
  const row=clone({...form,updatedAt:now()});
  const pending=put(row).then(()=>{persistenceErrors.delete(row.key);},error=>{persistenceErrors.set(row.key,error);
    msg('The working form could not be retained locally. Save a copy from Working forms before leaving this page. '+error.message,true);});
  writes.add(pending);pending.finally(()=>writes.delete(pending));return pending;
}
async function flush(){await Promise.all([...writes]);if(persistenceErrors.size)throw persistenceErrors.values().next().value;}
const draftNonce=(kind,id)=>state.drafts[kind]?.[id]??'first';
async function nextDraft(kind,id){await leaveWorkingView();(state.drafts[kind]??={})[id]=uid();}
async function retainSelection(){
  if(!state.workspaceId)return;
  const selected=Object.fromEntries(['dossierId','projectId','tab','requestId','newRequest','newProject','requestDraft',
    'workId','deliveryId','correctionDelivery','drafts','workingView','workingImportKey'].filter(key=>state[key]!==undefined).map(key=>[key,clone(state[key])]));
  await put({key:'selection:'+state.workspaceId,selected});
}
async function restoreSelection(){
  const saved=await get('selection:'+state.workspaceId);if(saved)Object.assign(state,saved.selected);
  const initial=new URLSearchParams(location.search);
  if(initial.has('dossier'))state.dossierId=initial.get('dossier');
  if(initial.has('project'))state.projectId=initial.get('project');
  if(initial.has('request'))state.requestId=initial.get('request');
}
async function working(kind,id,data){
  const selected=state.workingView?.kind===kind?state.workingView:null;
  const key=selected?.key??dataKey(kind,id),saved=await get(key);
  if(saved){need(saved.workspaceId===state.workspaceId&&saved.dossierId===state.dossierId,'Working form belongs to another workspace.');return saved;}
  const form={key,kind,id,workspaceId:state.workspaceId,dossierId:state.dossierId,projectId:state.projectId,
    baseRevision:state.revision,baseSha256:await originalRevisionSha(state.dossierId,state.revision),
    data:clone(data),updatedAt:now()};await put(form);return form;
}
function node(tag,text,className){const element=document.createElement(tag);if(text!==undefined)element.textContent=text;
  if(className)element.className=className;return element;}
function button(text,action,{primary=false,disabled=false}={}){
  const element=node('button',text,primary?'primary':'');element.type='button';element.disabled=disabled;
  element.addEventListener('click',()=>run(action));return element;
}
function detail(title,value){const block=node('details'),heading=node('summary',title);block.append(heading);
  block.addEventListener('toggle',()=>{if(block.open&&!block.querySelector('pre'))block.append(node('pre',pretty(value)));});return block;}
function paragraph(parent,text,className='muted'){parent.append(node('p',text,className));}
function grid(parent){const element=node('div',undefined,'grid');parent.append(element);return element;}
function card(parent,title){const element=node('section',undefined,'card');if(title)element.append(node('h3',title));parent.append(element);return element;}
function actions(parent){const element=node('div',undefined,'actions');parent.append(element);return element;}
function field(parent,label,value,onChange,{type='text',options,rows:lineCount,help,full=false,disabled=false}={}){
  const wrapper=node('label',undefined,full?'full':'');wrapper.append(node('span',label));
  const input=node(options?'select':lineCount?'textarea':'input');input.disabled=disabled;
  if(options)for(const option of options){const row=typeof option==='string'?{value:option,label:option}:option;
    const element=node('option',row.label);element.value=row.value;input.append(element);}
  else if(lineCount)input.rows=lineCount;else input.type=type;
  input.value=value??'';input.addEventListener(options?'change':'input',()=>onChange?.(input.value,input));
  wrapper.append(input);if(help)wrapper.append(node('small',help));parent.append(wrapper);return input;
}
function check(parent,label,checked,onChange,disabled=false){
  const wrapper=node('label',undefined,'check'),input=node('input');input.type='checkbox';input.checked=checked;input.disabled=disabled;
  input.addEventListener('change',()=>onChange(input.checked));wrapper.append(input,node('span',label));parent.append(wrapper);return input;
}
function edit(form,parent,label,target,key,options={}){
  return field(parent,label,target[key],value=>{target[key]=value;form.saved=null;retain(form);},options);
}
function jsonEdit(form,parent,label,target,key,{help}={}){
  const textKey=key+'Text';if(target[textKey]===undefined)target[textKey]=pretty(target[key]??{});
  return edit(form,parent,label,target,textKey,{rows:3,full:true,help});
}
function readJson(value,label){let result;try{result=JSON.parse(value);}catch{fail(label+' must contain valid JSON.');}
  need(result&&typeof result==='object'&&!Array.isArray(result),label+' must be a JSON object.');return result;}
function objectFromEditor(value,keys){
  const result={...clone(value)};for(const key of keys){if(Object.hasOwn(result,key+'Text')){result[key]=readJson(result[key+'Text'],key);delete result[key+'Text'];}}
  return result;
}
function table(parent,headers,values,render){
  const wrap=node('div',undefined,'table-wrap'),element=node('table'),head=node('thead'),row=node('tr');
  headers.forEach(text=>row.append(node('th',text)));head.append(row);element.append(head);const body=node('tbody');
  values.forEach((value,index)=>{const tr=node('tr');for(const item of render(value,index)){
    const td=node('td');td.append(item instanceof Node?item:node('span',String(item??'')));tr.append(td);}body.append(tr);});
  element.append(body);wrap.append(element);parent.append(wrap);return body;
}
function counts(parent,values){const row=node('div',undefined,'counts');for(const[key,value]of Object.entries(values??{})){
  const cell=node('span');cell.append(node('strong',String(value)),node('span',key));row.append(cell);}parent.append(row);}
function formState(parent,form){
  if(state.historyRevision)paragraph(parent,'Viewing saved dossier revision '+state.historyRevision+'. Working forms and pending operations retain their original selections.','warning');
  else if(form.saved)paragraph(parent,'Saved as original operation '+form.saved.requestId+' at revision '+form.saved.revision+'.','warning');
  else if(form.baseRevision!==(state.latestRevision??state.revision)){
    const row=node('div',undefined,'warning');paragraph(row,'This working form began at dossier revision '+form.baseRevision+
      '. Current revision is '+(state.latestRevision??state.revision)+'. Its original values remain retained.');
    row.append(button('Review this form against the current dossier revision',async()=>{
      await changeWorkingBase(form,state.latestRevision??state.revision);await openWorkingForm(form);
    }));
    parent.append(row);
  }
}
const formDisabled=form=>!!state.historyRevision||!!form.saved;
async function api(path,{body,method=body===undefined?'GET':'POST',type='application/json',omitInstance=false,readOnly=false}={}){
  need(state.token,'Enter the current Research workspace token.');
  let response;
  try{response=await fetch(path,{method,redirect:'error',headers:{Authorization:'Bearer '+state.token,
    ...(body===undefined?{}:{'Content-Type':type}),...(state.workspaceId?{'X-Research-Workspace-Id':state.workspaceId}:{}),
    ...(!omitInstance&&state.instanceId?{'X-Research-Instance-Id':state.instanceId}:{})},
    ...(body===undefined?{}:{body:body instanceof Blob?body:JSON.stringify(body)})});}
  catch(error){throw Object.assign(error,{outcomeUnknown:method==='POST'&&!readOnly});}
  let value;try{value=await response.json();}catch(error){throw Object.assign(error,{outcomeUnknown:method==='POST'&&!readOnly});}
  if(!response.ok)throw Object.assign(new Error(value.error??'Research request failed.'),{code:value.error,status:response.status,
    outcomeUnknown:response.status>=500&&method==='POST'&&!readOnly});
  return value;
}
async function synchronize(){
  const status=await api('/api/status',{omitInstance:true});
  need(status.mode==='RESEARCH_DOSSIER_WORKSPACE'&&/^research_[a-f0-9]{64}$/.test(status.workspaceId),'Original Research workspace required.');
  if(state.workspaceId)need(state.workspaceId===status.workspaceId,'The selected workspace has changed.');
  state.workspaceId=status.workspaceId;state.instanceId=status.instanceId;
  $('identity').textContent='Original workspace '+status.workspaceId+' · customer updates '+(status.api.customerUpdates?'available':'awaiting source integration');
}
async function allPages(path,options={}){
  const result=[];let offset=0,revision=options.revision,snapshot;
  for(;;){
    const page=await api(path+urlParams({...options,revision,offset,limit:100,...(snapshot?{snapshot}:{})}));
    need(Array.isArray(page.items)&&page.offset===offset,'Research page changed. Refresh this selection.');
    if(revision!==undefined&&page.revision!==undefined)need(page.revision===revision,'Research revision changed.');
    revision=page.revision??revision;snapshot=page.snapshot??snapshot;result.push(...page.items);
    if(page.nextOffset===null)return result;need(page.nextOffset===offset+page.items.length&&page.items.length>0,'Research page did not advance.');
    offset=page.nextOffset;
  }
}
async function loadDossiers(){
  state.dossiers=await allPages('/api/dossiers');
  if(!state.dossiers.some(row=>row.id===state.dossierId))state.dossierId=state.dossiers[0]?.id??null;
}
async function load(){
  await synchronize();await loadDossiers();
  if(!state.dossierId){state.data={};return;}
  if(state.workingView&&state.workingView.dossierId!==state.dossierId)state.workingView=null;
  state.latestRevision=state.dossiers.find(row=>row.id===state.dossierId)?.revision??null;
  const overview=await api(rootPath()+urlParams({revision:state.historyRevision??state.workingView?.baseRevision}));
  state.revision=overview.revision;
  const sections=['projects','briefs','requests','intakes','work','deliveries','questions','editions'];
  const pairs=await Promise.all(sections.map(async section=>[section,await allPages(rootPath(),{section,revision:state.revision})]));
  state.data=Object.fromEntries(pairs);
  if(state.projectId&&!state.data.projects.some(row=>row.id===state.projectId))state.projectId=null;
  if(!state.projectId&&state.tab!=='brief')state.projectId=state.data.projects[0]?.id??null;
  const requests=state.data.requests.filter(row=>row.projectId===state.projectId&&row.current);
  if(state.workingView?.bindings?.requestId)state.requestId=state.workingView.bindings.requestId;
  else if(!requests.some(row=>row.id===state.requestId)&&!state.newRequest)state.requestId=requests.at(-1)?.id??null;
  state.recordPage=null;state.changePage=null;state.historyPage=null;
}
async function saveOperation(action,data,form,{replayRequest}={}){
  need(!state.historyRevision||replayRequest,'Return to the current dossier before saving.');
  const request=replayRequest??{requestId:uid(),expectedRevision:form?.baseRevision??state.revision,actor:actor(),action,data:clone(data)};
  const record={key:'operation:'+state.workspaceId+':'+request.requestId,kind:'review',workspaceId:state.workspaceId,
    dossierId:state.dossierId,request:clone(request),requestSha256:await jsonSha(request),formKey:form?.key??null,formDataSha256:form?await jsonSha(form.data):null,
    status:'PENDING',createdAt:now()};
  const old=await get(record.key);
  if(old){need(old.requestSha256===record.requestSha256&&old.dossierId===record.dossierId,'Retained request changed.');return await dispatch(old,{replay:!!replayRequest});}
  await put(record);return await dispatch(record,{replay:!!replayRequest});
}
async function dispatch(record,{replay=false}={}){
  need(record.workspaceId===state.workspaceId,'Retained operation belongs to another workspace.');
  replay=record.kind==='review'&&(replay||!!record.replayPending);
  if(record.status==='COMPLETE'&&!replay)return record.result;
  const completed=record.status==='COMPLETE'&&record.result;
  if(replay&&!record.replayPending){
    record.replayPending={id:uid(),startedAt:now(),requestSha256:record.requestSha256};await put(record);
  }
  let result;
  try{
    await synchronize();
    if(record.kind==='review'){
      result=await api('/api/dossiers/'+encodeURIComponent(record.dossierId)+'/customer-updates/reviews?projection=metadata',{body:record.request});
      need(result.operation?.requestId===record.request.requestId&&result.operation.requestSha256===record.requestSha256&&
        result.operation.dossierId===record.dossierId,'Original saved operation reply changed.');
    }else{
      need(record.kind==='receive'&&record.file instanceof Blob&&record.file.size===record.bytes,'Retained receiving file missing.');
      result=await api('/api/reopen-stream?projection=metadata',{body:record.file,type:'application/octet-stream'});
      need(/^d_[a-f0-9-]{36}$/.test(result.id)&&Number.isSafeInteger(result.revision),'Received dossier response changed.');
    }
  }catch(error){
    record.error=String(error.code??error.message);
    record.status=completed?'COMPLETE':error.status&&error.status<500?'REJECTED':'PENDING';
    await put(record);throw error;
  }
  if(completed)need(result.operation.id===record.result.operation.id&&result.operation.revision===record.result.operation.revision,
    'The replay did not return the original saved operation.');
  if(replay){(record.replays??=[]).push({...record.replayPending,completedAt:now(),result:clone(result)});delete record.replayPending;}
  record.status='COMPLETE';if(!completed){record.result=clone(result);record.completedAt=now();}
  delete record.error;await put(record);
  if(record.formKey&&!replay){
    const form=await get(record.formKey);
    if(form&&record.formDataSha256&&await jsonSha(form.data)===record.formDataSha256){
      form.saved={requestId:record.request.requestId,revision:result.operation.revision};await put(form);
    }
  }
  if(record.kind==='review'&&!replay&&state.dossierId===record.dossierId&&!state.historyRevision){
    state.workingView=null;
    if(result.operation.result.project)state.projectId=result.operation.result.project.id;
    if(result.operation.result.updateRequest){state.requestId=result.operation.result.updateRequest.id;state.newRequest=false;}
    if(result.operation.result.work)state.workId=result.operation.result.work.id;
    if(result.operation.result.delivery)state.deliveryId=result.operation.result.delivery.id;
  }
  if(record.kind==='receive'&&!state.historyRevision){state.workingView=null;state.dossierId=result.id;state.projectId=null;state.tab='delivery';}
  await load();msg((replay?'Replayed the exact saved native request; original ':'Saved original ')+(record.kind==='review'?record.request.action+' at dossier revision '+result.operation.revision:
    'received dossier at revision '+result.revision)+'.');
  return result;
}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function download(path,name,expected){
  const response=await fetch(path,{redirect:'error',headers:{Authorization:'Bearer '+state.token,
    'X-Research-Workspace-Id':state.workspaceId,'X-Research-Instance-Id':state.instanceId}});
  if(!response.ok){let value;try{value=await response.json();}catch{}fail(value?.error??'Download failed.');}
  const blob=await response.blob();need(blob.size<=256*1024*1024,'Portable dossier exceeds the original file limit.');
  const declared=response.headers.get('x-research-customer-file-sha256'),hash=expected??declared;
  if(hash)need(await sha(await blob.arrayBuffer())===hash,'Original downloaded file changed.');
  downloadBlob(blob,name);
}
async function retainReceive(file){
  need(file instanceof File&&file.size>0&&file.size<=256*1024*1024,'Select an original portable dossier JSON or gzip file, up to 256 MiB.');
  const hash=await sha(await file.arrayBuffer()),id=uid(),record={key:'operation:'+state.workspaceId+':'+id,kind:'receive',
    workspaceId:state.workspaceId,requestId:id,file,name:file.name,bytes:file.size,sha256:hash,status:'PENDING',createdAt:now()};
  await put(record);return dispatch(record);
}

const WORKING_SCHEMA='sf88-research-customer-working-form/v1',WORKING_LIMIT=64*1024*1024;
const workingKinds=['brief','agreement','request','intake','work','delivery','delivery-response','project-status'];
const workingTab=kind=>({brief:'brief',agreement:'brief',request:'request',intake:'sources',work:'review',
  delivery:'delivery','delivery-response':'delivery','project-status':'history'})[kind];
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const stringFields=(value,keys)=>plain(value)&&keys.every(key=>typeof value[key]==='string');
const arrayOf=(value,test)=>Array.isArray(value)&&value.every(test);
const revisionHashes=new Map();
async function originalRevisionSha(dossierId,revision){
  need(/^d_[a-f0-9-]{36}$/.test(dossierId)&&Number.isSafeInteger(revision)&&revision>=1,'Original saved dossier revision required.');
  const key=state.workspaceId+':'+dossierId+':'+revision;if(revisionHashes.has(key))return revisionHashes.get(key);
  const page=await api('/api/dossiers/'+encodeURIComponent(dossierId)+'/sections/revisions'+
    urlParams({revision,offset:revision-1,limit:1}));
  const selected=page.items?.find(row=>row.revision===revision);
  need(page.dossier?.id===dossierId&&page.revision===revision&&/^[a-f0-9]{64}$/.test(selected?.sha256),
    'The original dossier base revision is not present in this workspace. Receive its editable dossier first.');
  revisionHashes.set(key,selected.sha256);return selected.sha256;
}
function validateWorkingPacket(packet){
  need(plain(packet)&&packet.schema===WORKING_SCHEMA&&Object.keys(packet).every(key=>['schema','source','form'].includes(key)),
    'Select a complete Research customer working-form file.');
  const source=packet.source,form=packet.form;
  need(plain(source)&&Object.keys(source).every(key=>['workspaceId','dossierId','projectId','revision','revisionSha256'].includes(key))&&
    /^research_[a-f0-9]{64}$/.test(source.workspaceId)&&/^d_[a-f0-9-]{36}$/.test(source.dossierId)&&
    (source.projectId===null||/^cup_[a-f0-9]{64}$/.test(source.projectId))&&
    Number.isSafeInteger(source.revision)&&source.revision>=1&&/^[a-f0-9]{64}$/.test(source.revisionSha256),
    'The working form must identify its original workspace, dossier, project and exact base revision hash.');
  need(plain(form)&&Object.keys(form).every(key=>['kind','id','data','updatedAt','saved','previousBases','origin'].includes(key))&&
    workingKinds.includes(form.kind)&&typeof form.id==='string'&&form.id.length<=240&&
    /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(form.id)&&plain(form.data)&&
    (form.saved===null||plain(form.saved))&&Array.isArray(form.previousBases)&&
    (form.origin===null||plain(form.origin))&&typeof form.updatedAt==='string','The complete working-form identity is invalid.');
  const value=form.data,text=key=>typeof value[key]==='string',texts=keys=>keys.every(text),strs=value=>arrayOf(value,item=>typeof item==='string');
  if(form.kind==='brief'){
    const brief=value.brief;
    need(plain(brief)&&stringFields(brief,['name','purpose','updatePolicy'])&&
      stringFields(brief.customer,['id','name','reference'])&&stringFields(brief.owner,['id','name'])&&
      stringFields(brief.protocol,['title','version','source','notes'])&&stringFields(brief.scope,['currency','amount','unit','note','reference'])&&
      strs(brief.questionIds)&&arrayOf(brief.sourcePlans,plan=>stringFields(plan,['id','name','questionId','provider','query','terms','constraints'])&&
        plain(plan.parameters)&&plain(plan.original))&&arrayOf(brief.outputs,output=>stringFields(output,['id','label','format','acceptance']))&&text('reason'),
      'The working brief is missing its complete customer, query, output or scope fields.');
  }else if(form.kind==='request'){
    const requested=value.definition;
    need(stringFields(requested,['briefId','kind','label','instructions'])&&
      (requested.previousDeliveryId===null||typeof requested.previousDeliveryId==='string')&&
      stringFields(requested.request,['receivedAt','reference','note'])&&stringFields(requested.request.by,['id','name'])&&
      arrayOf(requested.periods,period=>stringFields(period,['planId','from','until','field','notes']))&&text('reason'),
      'The working request is missing its complete original brief, requester or source periods.');
  }else if(form.kind==='intake')need(texts(['planId','note'])&&strs(value.editionIds)&&plain(value.original),'The complete working source intake is required.');
  else if(form.kind==='work'){
    need(plain(value.selection)&&strs(value.selection.intakeIds)&&
      arrayOf(value.selection.records,row=>stringFields(row,['path','sha256']))&&
      texts(['summary','limitations','note'])&&arrayOf(value.changeDecisions,row=>stringFields(row,['sourceId','fingerprint','disposition','reason']))&&
      arrayOf(value.acceptance,row=>stringFields(row,['outputId','status','note']))&&Array.isArray(value.priorReviews)&&
      (value.preview===null||plain(value.preview)&&plain(value.previewInput)&&Array.isArray(value.preview.brief?.definition?.outputs)),
      'The working review must include its complete selection, decisions, acceptance and retained preview.');
    if(value.preview)need(value.preview.dossierId===source.dossierId&&value.preview.revision===source.revision&&
      value.preview.revisionSha256===source.revisionSha256&&value.preview.project?.id===source.projectId&&
      value.preview.brief.definition.outputs.every(output=>value.acceptance.some(row=>row.outputId===output.id)),
      'The working review preview belongs to a different original dossier, revision or output selection.');
  }else if(form.kind==='delivery')need(texts(['title','coverNote','deliveryNote']),'The complete working delivery is required.');
  else if(form.kind==='agreement')need(texts(['disposition','occurredAt','reference','message'])&&
    stringFields(value.by,['id','name'])&&plain(value.records),'The complete working customer response is required.');
  else if(form.kind==='delivery-response')need(texts(['status','occurredAt','channel','reference','message'])&&
    stringFields(value.by,['id','name'])&&plain(value.original),'The complete working delivery response is required.');
  else need(texts(['status','reason']),'The complete working project status is required.');
  return packet;
}
function workingBindings(packet){
  const {kind,id,data}=packet.form,result={projectId:packet.source.projectId};
  const original=prefix=>{const match=id.match(new RegExp('^('+prefix+'_[a-f0-9]{64})(?:-|$)'));return match?.[1]??null;};
  if(kind==='brief'){
    result.briefId=original('cub');
    need(result.briefId?!id.startsWith('new-')&&!!result.projectId:id.startsWith('new-')&&result.projectId===null,
      'The working brief does not match its original project identity.');
  }else if(kind==='agreement')result.briefId=original('cub');
  else if(kind==='request'){
    result.requestId=original('cur');result.briefId=data.definition.briefId;
    need(result.requestId||id.startsWith('new-'+result.projectId+'-'),'The working request identity changed.');
  }else if(kind==='intake'||kind==='work')result.requestId=original('cur');
  else if(kind==='delivery')result.workId=original('cuw');
  else if(kind==='delivery-response')result.deliveryId=original('cud');
  else need(original('cup')===result.projectId,'The working project status identity changed.');
  if(kind!=='brief')need(result.projectId&&Object.entries(result).every(([key,value])=>
    value!==null||kind==='request'&&key==='requestId'),
    'The working form is missing an original saved project or record identity.');
  return result;
}
async function inspectWorkingBase(packet){
  validateWorkingPacket(packet);
  const {source,form}=packet,bindings=workingBindings(packet);
  need(await originalRevisionSha(source.dossierId,source.revision)===source.revisionSha256,
    'This dossier has a different history at the working form’s original base revision.');
  const path='/api/dossiers/'+encodeURIComponent(source.dossierId)+'/customer-updates',
    required=['projects',...(bindings.briefId?['briefs']:[]),...(bindings.requestId?['requests','briefs']:[]),
      ...(bindings.workId?['work']:[]),...(bindings.deliveryId?['deliveries','work']:[])];
  const sections=Object.fromEntries(await Promise.all([...new Set(required)].map(async section=>
    [section,await allPages(path,{section,revision:source.revision})])));
  const original=(section,id)=>{const row=sections[section]?.find(item=>item.id===id);
    need(row&&(section==='projects'||row.projectId===source.projectId),'The working form’s original '+section+' record is absent or belongs to another project.');return row;};
  if(source.projectId)original('projects',source.projectId);
  if(bindings.briefId)original('briefs',bindings.briefId);
  if(bindings.requestId){
    const request=original('requests',bindings.requestId);
    const brief=original('briefs',request.definition.briefId);
    if(form.kind==='intake')need(brief.definition.sourcePlans.some(row=>row.id===form.data.planId),
      'The selected intake plan is absent from the original requested brief.');
    if(form.kind==='work'&&form.data.preview)need(form.data.preview.requested?.id===request.id,
      'The working preview belongs to another requested update.');
  }
  if(bindings.workId)original('work',bindings.workId);
  if(bindings.deliveryId){const delivery=original('deliveries',bindings.deliveryId);bindings.workId=delivery.workId;
    original('work',bindings.workId);}
  const current=await api(path);
  return {bindings,currentRevision:current.revision,source:clone(source)};
}
async function workingPacket(row){
  need(row&&row.workspaceId===state.workspaceId,'This working form belongs to another local workspace.');
  const hash=await originalRevisionSha(row.dossierId,row.baseRevision);
  need(!row.baseSha256||row.baseSha256===hash,'The retained working base hash changed.');
  if(!row.baseSha256){row.baseSha256=hash;await put(row);}
  return validateWorkingPacket({schema:WORKING_SCHEMA,source:{workspaceId:row.workspaceId,dossierId:row.dossierId,
    projectId:row.projectId??null,revision:row.baseRevision,revisionSha256:hash},
    form:{kind:row.kind,id:row.id,data:clone(row.data),updatedAt:row.updatedAt,
      saved:clone(row.saved??null),previousBases:clone(row.previousBases??[]),origin:clone(row.origin??null)}});
}
async function exportWorkingForm(row){
  const packet=await workingPacket(row),file=new Blob([pretty(packet)+'\n'],{type:'application/json'});
  need(file.size<=WORKING_LIMIT,'The complete working form exceeds 64 MiB.');
  downloadBlob(file,'research-working-'+row.kind+'.json');
}
async function changeWorkingBase(form,revision){
  const hash=await originalRevisionSha(form.dossierId,revision);
  if(form.baseRevision!==revision)form.previousBases=[...(form.previousBases??[]),{revision:form.baseRevision,
    sha256:form.baseSha256??await originalRevisionSha(form.dossierId,form.baseRevision)}];
  form.baseRevision=revision;form.baseSha256=hash;form.saved=null;
  if(form.kind==='work'&&form.data.preview){
    form.data.previousPreview=form.data.preview;form.data.preview=null;
  }
  await put(form);
}
async function leaveWorkingView(){
  if(!state.workingView)return;
  await flush();state.workingView=null;state.historyRevision=null;await load();
}
async function openWorkingForm(row){
  need(row,'The retained working form is missing.');
  const packet=await workingPacket(row),review=await inspectWorkingBase(packet);
  state.workingView={key:row.key,kind:row.kind,id:row.id,dossierId:row.dossierId,
    projectId:row.projectId,baseRevision:row.baseRevision,bindings:review.bindings};
  state.dossierId=row.dossierId;state.projectId=row.projectId;state.historyRevision=null;state.tab=workingTab(row.kind);
  state.requestId=review.bindings.requestId??null;state.newRequest=row.kind==='request'&&!review.bindings.requestId;
  state.workId=review.bindings.workId??null;state.deliveryId=review.bindings.deliveryId??null;
  state.workingImportKey=null;state.workingImportReview=null;await load();await retainSelection();
  msg('Opened the complete retained '+row.kind+' form at original dossier revision '+row.baseRevision+'.');
}
async function retainWorkingImport(file){
  need(file instanceof File&&file.size>0&&file.size<=WORKING_LIMIT,'Select a complete working-form JSON file, up to 64 MiB.');
  const bytes=await file.arrayBuffer(),hash=await sha(bytes);let packet;
  try{packet=validateWorkingPacket(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}
  catch(error){throw Object.assign(new Error(error.message??'Invalid working-form JSON.'),{code:error.code});}
  const key='working-import:'+state.workspaceId+':'+hash,old=await get(key);
  if(!old)await put({key,workspaceId:state.workspaceId,file,name:file.name,bytes:file.size,sha256:hash,packet,retainedAt:now()});
  else need(old.sha256===hash&&old.bytes===file.size,'The retained incoming working form changed.');
  await reviewWorkingImport(key);
}
async function reviewWorkingImport(key){
  const record=await get(key);need(record?.workspaceId===state.workspaceId,'The incoming form belongs to another receiving workspace.');
  state.workingImportKey=key;state.workingImportReview=null;await retainSelection();
  if(record.adopted){await openWorkingForm(await get(record.adopted.key));return;}
  need(record.file instanceof Blob&&record.file.size===record.bytes&&await sha(await record.file.arrayBuffer())===record.sha256,
    'The complete retained incoming form file changed.');
  const reviewed=await inspectWorkingBase(record.packet),
    primaryKey='form:'+state.workspaceId+':'+record.packet.source.dossierId+':'+record.packet.form.kind+':'+record.packet.form.id,
    existing=await get(primaryKey);
  state.workingImportReview={key,sha256:record.sha256,reviewed,primaryKey,
    existing:existing?clone(existing):null,existingSha256:existing?await jsonSha(existing):null};
  state.tab='history';msg('Reviewed the incoming form against its original dossier history. Choose a separate draft or preserve-and-replace the current draft.');
}
async function installWorkingForm(record,form,review,backup){
  const connection=await db();await new Promise((resolve,reject)=>{
    const tx=connection.transaction('records','readwrite'),store=tx.objectStore('records');let failure;
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(failure??tx.error);tx.onabort=()=>reject(failure??tx.error??new Error('Working-form receiving stopped.'));
    const request=store.get(form.key);
    request.onsuccess=()=>{
      const current=request.result,expected=review.replace?review.existing:null;
      if(JSON.stringify(canonical(current??null))!==JSON.stringify(canonical(expected))){
        failure=new Error('The destination working form changed after review. Review the current form before receiving.');tx.abort();return;
      }
      if(backup)store.put(backup);
      store.put(form);store.put({...record,adopted:{key:form.key,mode:review.replace?'PRESERVE_AND_REPLACE':'SEPARATE',
        originalFileSha256:record.sha256,receivedAt:now(),backupKey:backup?.key??null}});
    };
  });
}
async function adoptWorkingImport(replace){
  const review=state.workingImportReview,record=review&&await get(review.key);
  need(record&&record.sha256===review.sha256,'Review the original working form before receiving it.');
  if(record.adopted){await openWorkingForm(await get(record.adopted.key));return;}
  await synchronize();await inspectWorkingBase(record.packet);
  const existing=await get(review.primaryKey);
  need((existing?await jsonSha(existing):null)===review.existingSha256,'The current working form changed. Review both complete forms again.');
  const source=record.packet.source,original=record.packet.form,
    key=replace?review.primaryKey:review.primaryKey+':received:'+record.sha256;
  const already=await get(key);
  if(!replace&&already){need(already.origin?.fileSha256===record.sha256,'The received working-form identity changed.');
    await put({...record,adopted:{key,mode:'SEPARATE',originalFileSha256:record.sha256,receivedAt:now(),backupKey:null}});
    await openWorkingForm(already);return;}
  const form={key,kind:original.kind,id:original.id,workspaceId:state.workspaceId,dossierId:source.dossierId,
    projectId:source.projectId,baseRevision:source.revision,baseSha256:source.revisionSha256,data:clone(original.data),
    saved:null,previousBases:clone(original.previousBases),updatedAt:now(),
    origin:{fileSha256:record.sha256,fileName:record.name,source:clone(source),originalForm:clone({...original,data:undefined})}};
  delete form.origin.originalForm.data;
  const backup=replace&&existing?{...clone(existing),key:review.primaryKey+':preserved:'+review.existingSha256,
    origin:{preservedFrom:existing.key,formSha256:review.existingSha256,priorOrigin:clone(existing.origin??null)}}:null;
  await installWorkingForm(record,form,{...review,replace},backup);
  await openWorkingForm(form);
}
async function renderWorkingImport(parent){
  if(!state.workingImportKey)return;
  const record=await get(state.workingImportKey);if(!record||record.adopted)return;
  const box=card(parent,'Receive a complete working form');
  paragraph(box,record.name+' · '+record.bytes+' bytes · '+record.sha256);
  box.append(detail('Original dossier and base revision',record.packet.source),detail('Complete incoming working form',record.packet.form));
  const review=state.workingImportReview;
  if(review?.key!==record.key){
    paragraph(box,'The original file is retained. Receive its editable dossier if needed, then review the matching original base.','warning');
    actions(box).append(button('Review original form and destination',async()=>reviewWorkingImport(record.key)));
  }else{
    paragraph(box,'Original base revision '+record.packet.source.revision+' matches this dossier history. Current destination revision is '+
      review.reviewed.currentRevision+'. The form retains its original base for native save review.');
    if(review.existing)box.append(detail('Complete existing working form that will be preserved',review.existing));
    else paragraph(box,'There is no working form in the matching original slot.');
    const row=actions(box);row.append(button('Receive as a separate working draft',async()=>adoptWorkingImport(false),{primary:true}));
    if(review.existing)row.append(button('Preserve current draft and replace its working slot',async()=>adoptWorkingImport(true)));
  }
  actions(box).append(button('Download retained incoming form',async()=>downloadBlob(record.file,record.name)),
    button('Keep this file for later',async()=>{state.workingImportKey=null;state.workingImportReview=null;}));
}

async function run(work){
  if(state.busy)return;state.busy=true;$('workspace').disabled=true;
  try{await flush();await work();}
  catch(error){msg(error.code??error.message??String(error),true);}
  finally{
    try{await retainSelection();renderShell();await renderPanel();await renderPending();}catch(error){msg(error.code??error.message,true);}
    state.busy=false;$('workspace').disabled=!state.workspaceId;}
}

function editable(parent){const body=node('fieldset');body.disabled=!!state.historyRevision;parent.append(body);return body;}
function defaultBrief(){
  return {name:'',customer:{id:'',name:'',reference:''},purpose:'',owner:{id:$('actor-id').value,name:$('actor-name').value},
    questionIds:state.data.questions?.slice(0,1).map(row=>row.id)??[],
    protocol:{title:'',version:'',source:'',notes:''},sourcePlans:[],outputs:[{id:'output-'+uid(),label:'',format:'JSON, Markdown, HTML and CSV',acceptance:''}],
    scope:{currency:'',amount:'',unit:'',note:'',reference:''},updatePolicy:''};
}
function briefFromForm(value){
  const brief=clone(value.brief);brief.sourcePlans=brief.sourcePlans.map(row=>objectFromEditor(row,['parameters','original']));
  return brief;
}
async function briefPanel(parent){
  const original=currentBrief(),form=await working('brief',original?.id??'new-'+state.newProject,
    {brief:original?.definition??defaultBrief(),reason:''});
  state.form=form;formState(parent,form);
  const body=editable(parent),brief=form.data.brief,main=grid(body);
  edit(form,main,'Project name',brief,'name');
  edit(form,main,'Customer ID',brief.customer,'id',{help:'The same stable customer identity continues through revised briefs.'});
  edit(form,main,'Customer name',brief.customer,'name');edit(form,main,'Customer reference',brief.customer,'reference');
  edit(form,main,'Purpose and research question',brief,'purpose',{rows:4,full:true});
  edit(form,main,'Responsible operator ID',brief.owner,'id');edit(form,main,'Responsible operator name',brief.owner,'name');
  const questions=card(body,'Original dossier questions');
  for(const question of state.data.questions??[])check(questions,question.title??question.text??question.id,
    brief.questionIds.includes(question.id),selected=>{brief.questionIds=selected?[...brief.questionIds,question.id]:
      brief.questionIds.filter(id=>id!==question.id);retain(form);});
  paragraph(questions,'Question definitions remain in the original dossier. Open Dossiers and evidence to create or revise them.');
  const protocol=grid(card(body,'Question and protocol edition'));
  edit(form,protocol,'Protocol title',brief.protocol,'title');edit(form,protocol,'Version or edition',brief.protocol,'version');
  edit(form,protocol,'Original protocol URL or file reference',brief.protocol,'source',{full:true});
  edit(form,protocol,'Protocol notes',brief.protocol,'notes',{rows:3,full:true});
  const plans=card(body,'Agreed source queries');
  for(let index=0;index<brief.sourcePlans.length;index++){
    const plan=brief.sourcePlans[index],row=card(plans,'Source plan '+(index+1)),fields=grid(row);
    edit(form,fields,'Plan ID',plan,'id');edit(form,fields,'Plan name',plan,'name');
    field(fields,'Original dossier question',plan.questionId,value=>{plan.questionId=value;retain(form);},
      {options:state.data.questions.map(q=>({value:q.id,label:q.title??q.text??q.id}))});
    edit(form,fields,'Provider',plan,'provider');edit(form,fields,'Exact agreed query',plan,'query',{rows:3,full:true});
    jsonEdit(form,fields,'Original query parameters',plan,'parameters',{help:'The original provider parameters retain their types and exact values.'});
    jsonEdit(form,fields,'Original query/workspace handle',plan,'original');
    edit(form,fields,'Source terms and attribution',plan,'terms',{rows:3,full:true});
    edit(form,fields,'Coverage constraints and exclusions',plan,'constraints',{rows:3,full:true});
    row.append(button('Remove this source plan from the working brief',async()=>{brief.sourcePlans.splice(index,1);await put(form);}));
  }
  const planActions=actions(plans);
  planActions.append(button('Add source plan',async()=>{brief.sourcePlans.push({id:'plan-'+uid(),name:'',questionId:brief.questionIds[0]??'',
    provider:'',query:'',parameters:{},original:{},terms:'',constraints:''});await put(form);}));
  const imported=form.data.queryImport??={queryId:'',queryRevision:'1',questionId:brief.questionIds[0]??'',planId:'plan-'+uid(),
    name:'',constraints:'',library:'original'};
  const importBox=card(plans,'Use an existing Europe PMC query edition'),importFields=grid(importBox);
  edit(form,importFields,'Original query ID',imported,'queryId');edit(form,importFields,'Exact query revision',imported,'queryRevision',{type:'number'});
  field(importFields,'Original dossier question',imported.questionId,value=>{imported.questionId=value;retain(form);},
    {options:state.data.questions.map(q=>({value:q.id,label:q.title??q.text??q.id}))});
  edit(form,importFields,'Source plan ID',imported,'planId');edit(form,importFields,'Source plan name',imported,'name');
  edit(form,importFields,'Selected source library',imported,'library',{help:'original or the exact received-… library selected in Literature searches.'});
  importBox.append(button('Import the saved query selection',async()=>{
    const input={...clone(imported),queryRevision:Number(imported.queryRevision)};
    if(!input.name)delete input.name;
    const result=await api('/api/customer-updates/europe-pmc-plan',{body:input,readOnly:true});
    need(result.plan?.id===input.planId,'Saved query selection changed.');
    need(!brief.sourcePlans.some(row=>row.id===result.plan.id),'This plan ID is already in the working brief.');
    brief.sourcePlans.push(result.plan);form.data.queryImport={...imported,planId:'plan-'+uid()};await put(form);
  }));
  paragraph(importBox,'Literature searches owns the query and acquisition. Importing here retains its original saved selection and terms.');
  const outputs=card(body,'Agreed customer outputs');
  for(let index=0;index<brief.outputs.length;index++){
    const output=brief.outputs[index],row=card(outputs,'Output '+(index+1)),fields=grid(row);
    edit(form,fields,'Output ID',output,'id');edit(form,fields,'Customer-facing label',output,'label');
    edit(form,fields,'Requested format',output,'format',{full:true});
    edit(form,fields,'Acceptance criteria',output,'acceptance',{rows:3,full:true});
    row.append(button('Remove this output from the working brief',async()=>{brief.outputs.splice(index,1);await put(form);}));
  }
  outputs.append(button('Add agreed output',async()=>{brief.outputs.push({id:'output-'+uid(),label:'',format:'',acceptance:''});await put(form);}));
  const scopeFields=grid(card(body,'Commercial scope and update policy'));
  edit(form,scopeFields,'Currency',brief.scope,'currency');edit(form,scopeFields,'Quoted or agreed amount',brief.scope,'amount');
  edit(form,scopeFields,'Unit or charging basis',brief.scope,'unit');edit(form,scopeFields,'Original commercial reference',brief.scope,'reference');
  edit(form,scopeFields,'Scope and price notes',brief.scope,'note',{rows:3,full:true});
  edit(form,scopeFields,'When another update is commissioned and who reviews it',brief,'updatePolicy',{rows:4,full:true});
  if(original)edit(form,scopeFields,'Reason for this brief edition',form.data,'reason',{rows:3,full:true});
  const save=actions(body);
  save.append(button(original?'Save brief edition':'Save initial customer brief',async()=>{
    const data=original?{projectId:state.projectId,expectedBriefId:original.id,brief:briefFromForm(form.data),reason:form.data.reason}:
      {brief:briefFromForm(form.data)};
    await saveOperation(original?'revise-brief':'create-project',data,form);
  },{primary:true,disabled:formDisabled(form)}));
  save.append(button('Download working brief',async()=>downloadBlob(new Blob([pretty(briefFromForm(form.data))+'\n'],
    {type:'application/json'}),'customer-brief.json')));
  if(original)await agreementPanel(body,original);
}
async function agreementPanel(parent,brief){
  const form=await working('agreement',brief.id+'-'+draftNonce('agreement',brief.id),{disposition:'PROPOSED',by:{id:'',name:''},occurredAt:now(),reference:'',message:'',records:{}});
  const body=card(parent,'Record the customer’s brief response'),fields=grid(body);formState(body,form);
  edit(form,fields,'Response',form.data,'disposition',{options:['PROPOSED','ACCEPTED','CHANGES_REQUESTED','DECLINED']});
  edit(form,fields,'When it occurred',form.data,'occurredAt');edit(form,fields,'Customer contact ID',form.data.by,'id');
  edit(form,fields,'Customer contact name',form.data.by,'name');edit(form,fields,'Original correspondence reference',form.data,'reference',{full:true});
  edit(form,fields,'Response or requested change',form.data,'message',{rows:4,full:true});
  jsonEdit(form,fields,'Original correspondence handle',form.data,'records');
  actions(body).append(button('Record another customer response',async()=>nextDraft('agreement',brief.id)),button('Save customer response',async()=>saveOperation('record-agreement',
    {projectId:state.projectId,briefId:brief.id,...objectFromEditor(form.data,['records'])},form),
    {disabled:formDisabled(form)}));
}
function newRequestDefinition(brief,{correction}={}){
  const previous=correction??state.data.deliveries.filter(row=>row.projectId===state.projectId).at(-1)?.id??null;
  return {briefId:brief.id,kind:correction?'CORRECTION':previous?'UPDATE':'BASELINE',previousDeliveryId:previous,label:'',
    request:{by:{id:'',name:''},receivedAt:now(),reference:'',note:''},
    periods:brief.definition.sourcePlans.map(plan=>({planId:plan.id,from:'',until:'',field:'',notes:''})),instructions:''};
}
async function requestPanel(parent){
  const current=currentBrief();if(!current){paragraph(parent,'Save the customer brief first.','empty');return;}
  const selected=state.newRequest?null:selectedRequest(),form=await working('request',
    selected?.id??'new-'+state.projectId+'-'+state.requestDraft,
    {definition:selected?.definition??newRequestDefinition(current,{correction:state.correctionDelivery}),reason:''});
  state.form=form;const top=actions(parent);top.append(button('Commission a separate update',async()=>{
    await leaveWorkingView();state.newRequest=true;state.requestDraft=uid();state.correctionDelivery=null;
  }));
  if(selected)paragraph(parent,'Selected request edition '+selected.edition+' · '+selected.id+' · '+selected.status);
  formState(parent,form);const body=editable(parent),definition=form.data.definition,fields=grid(body);
  field(fields,'Customer brief edition',definition.briefId,async value=>{
    definition.briefId=value;const brief=state.data.briefs.find(row=>row.id===value);
    definition.periods=brief.definition.sourcePlans.map(plan=>definition.periods.find(row=>row.planId===plan.id)??
      {planId:plan.id,from:'',until:'',field:'',notes:''});retain(form);
    await run(async()=>{});
  },{options:state.data.briefs.filter(row=>row.projectId===state.projectId).map(row=>({value:row.id,label:'Edition '+row.edition+' · '+row.definition.name}))});
  field(fields,'Kind of work',definition.kind,value=>{definition.kind=value;if(value==='BASELINE')definition.previousDeliveryId=null;retain(form);},
    {options:['BASELINE','UPDATE','CORRECTION']});
  field(fields,'Previous frozen delivery',definition.previousDeliveryId??'',value=>{definition.previousDeliveryId=value||null;retain(form);},
    {options:[{value:'',label:'No prior delivery (baseline)'},...state.data.deliveries.filter(row=>row.projectId===state.projectId)
      .map(row=>({value:row.id,label:row.title+' · revision '+row.revision}))]});
  edit(form,fields,'Requested update label',definition,'label');
  edit(form,fields,'Requester ID',definition.request.by,'id');edit(form,fields,'Requester name',definition.request.by,'name');
  edit(form,fields,'Request received at',definition.request,'receivedAt');edit(form,fields,'Original request reference',definition.request,'reference');
  edit(form,fields,'What the customer requested',definition.request,'note',{rows:4,full:true});
  edit(form,fields,'Instructions for this update',definition,'instructions',{rows:4,full:true});
  const brief=state.data.briefs.find(row=>row.id===definition.briefId);
  const periods=card(body,'Exact requested source periods');
  for(const period of definition.periods){
    const plan=brief.definition.sourcePlans.find(row=>row.id===period.planId),row=grid(card(periods,plan?.name??period.planId));
    edit(form,row,'Original provider date field or full-scope rule',period,'field',{full:true});
    edit(form,row,'Literal lower bound (blank when unbounded)',period,'from');
    edit(form,row,'Literal upper bound (blank when unbounded)',period,'until');
    edit(form,row,'Interpretation and coverage notes',period,'notes',{rows:3,full:true});
  }
  paragraph(periods,'These are the requested periods. The original acquisition query remains explicit; publication, indexing and acquisition dates retain their separate meanings.');
  if(selected)edit(form,fields,'Reason for changing this request',form.data,'reason',{rows:3,full:true});
  actions(body).append(button(selected?'Save request edition':'Save requested update',async()=>{
    const data=selected?{projectId:state.projectId,cycleId:selected.cycleId,expectedRequestEditionId:selected.id,
      definition:clone(definition),reason:form.data.reason}:{projectId:state.projectId,definition:clone(definition)};
    await saveOperation(selected?'revise-request':'request-update',data,form);
  },{primary:true,disabled:formDisabled(form)}));
}

function requireRequested(parent){
  const requested=selectedRequest();if(!requested){paragraph(parent,'Select or commission an update before attaching sources or reviewing work.','empty');return null;}
  paragraph(parent,requested.definition.label+' · '+requested.definition.kind+' · request edition '+requested.edition);
  return requested;
}
async function sourcesPanel(parent){
  const requested=requireRequested(parent);if(!requested)return;
  const brief=requestedBrief(),form=await working('intake',requested.id+'-'+draftNonce('intake',requested.id),
    {planId:brief.definition.sourcePlans[0].id,editionIds:[],original:{},note:''});
  state.form=form;formState(parent,form);const body=editable(parent),fields=grid(body);
  field(fields,'Commissioned source plan',form.data.planId,value=>{form.data.planId=value;form.data.editionIds=[];retain(form);run(async()=>{});},
    {options:brief.definition.sourcePlans.map(row=>({value:row.id,label:row.name+' · '+row.provider}))});
  const plan=brief.definition.sourcePlans.find(row=>row.id===form.data.planId);
  if(!plan){paragraph(body,'The source plan changed. Open the current requested update.','warning');return;}
  body.append(detail('Exact commissioned query and original handle',plan));
  const editions=state.data.editions.filter(row=>row.questionId===plan.questionId),selection=card(body,'Original retained dossier editions');
  for(const edition of editions)check(selection,(edition.label??edition.id)+' · '+edition.provider+' · '+edition.mode,
    form.data.editionIds.includes(edition.id),selected=>{form.data.editionIds=selected?[...form.data.editionIds,edition.id]:
      form.data.editionIds.filter(id=>id!==edition.id);retain(form);});
  if(!editions.length)paragraph(selection,'Receive the original source edition through Dossiers or Literature searches, then refresh this page.');
  const acquisition=node('a','Open original literature acquisition');acquisition.href='/europe-pmc.html?dossier='+encodeURIComponent(state.dossierId);
  selection.append(acquisition);
  jsonEdit(form,fields,'Original acquisition / receiving operation handle',form.data,'original');
  edit(form,fields,'Intake and coverage notes',form.data,'note',{rows:4,full:true});
  const buttons=actions(body);
  buttons.append(button('Attach these original editions',async()=>saveOperation('attach-intake',
    {projectId:state.projectId,cycleId:requested.cycleId,requestEditionId:requested.id,...objectFromEditor(form.data,['original'])},form),
    {primary:true,disabled:formDisabled(form)}));
  buttons.append(button('Attach another source intake',async()=>{await nextDraft('intake',requested.id);}));
  const old=state.data.intakes.filter(row=>row.requestEditionId===requested.id);
  table(parent,['Saved intake','Source plan','Original editions','Saved revision'],old,row=>[
    detail(row.id,{...row}),brief.definition.sourcePlans.find(plan=>plan.id===row.planId)?.name??row.planId,row.editionIds.length,row.revision]);
}
async function reviewWorking(requested){
  const initialIntakes=state.data.intakes.filter(row=>row.requestEditionId===requested.id).map(row=>row.id);
  return working('work',requested.id+'-'+draftNonce('work',requested.id),{selection:{intakeIds:initialIntakes,records:[]},
    preview:null,summary:'',limitations:'',note:'',changeDecisions:[],acceptance:requestedBrief().definition.outputs.map(row=>({
      outputId:row.id,status:'not_reviewed',note:''})),priorReviews:[]});
}
function invalidatePreview(form){
  if(form.data.preview)form.data.previousPreview=form.data.preview;
  form.data.preview=null;form.saved=null;state.changePage=null;retain(form);
}
async function preparePreview(form,requested){
  const input={revision:state.revision,projectId:state.projectId,cycleId:requested.cycleId,
    requestEditionId:requested.id,selection:clone(form.data.selection)};
  const preview=await api(rootPath()+'/preview',{body:input,readOnly:true});
  const previous=form.data.preview??form.data.previousPreview;
  if(previous&&previous.fingerprint!==preview.fingerprint){
    form.data.priorReviews.push({preview:previous,changeDecisions:clone(form.data.changeDecisions),acceptance:clone(form.data.acceptance),
      summary:form.data.summary,limitations:form.data.limitations,note:form.data.note});
    form.data.changeDecisions=[];
  }
  if(form.baseRevision!==preview.revision)form.previousBases=[...(form.previousBases??[]),{revision:form.baseRevision,sha256:form.baseSha256??null}];
  form.baseRevision=preview.revision;form.baseSha256=preview.revisionSha256;form.data.preview=preview;form.data.previewInput=input;
  form.data.acceptance=preview.brief.definition.outputs.map(output=>form.data.acceptance.find(row=>row.outputId===output.id)??
    {outputId:output.id,status:'not_reviewed',note:''});
  form.saved=null;delete form.data.previousPreview;await put(form);state.changeOffset=0;state.changePage=null;
}
async function changePage(form){
  const selected=form.data.preview;
  if(!state.changePage||state.changePage.fingerprint!==selected.fingerprint||state.changePage.offset!==state.changeOffset)
    state.changePage=await api(rootPath()+'/preview',{body:{...clone(form.data.previewInput),fingerprint:selected.fingerprint,
      section:'changes',offset:state.changeOffset,limit:20},readOnly:true});
  return state.changePage;
}
async function reviewPanel(parent){
  const requested=requireRequested(parent);if(!requested)return;
  const form=await reviewWorking(requested);state.form=form;formState(parent,form);const body=editable(parent);
  const source=card(body,'Select source intakes for this work edition');
  const intakes=state.data.intakes.filter(row=>row.requestEditionId===requested.id);
  for(const intake of intakes)check(source,intake.planId+' · '+intake.editionIds.length+' original editions · revision '+intake.revision,
    form.data.selection.intakeIds.includes(intake.id),selected=>{form.data.selection.intakeIds=selected?[...form.data.selection.intakeIds,intake.id]:
      form.data.selection.intakeIds.filter(id=>id!==intake.id);invalidatePreview(form);});
  if(!intakes.length)paragraph(source,'Attach the original source editions in Source intakes.');
  const native=card(body,'Include original research decisions and results');
  paragraph(native,'Select exact saved eligibility, extraction, appraisal, synthesis, publication or dossier records. The complete selected record is frozen with this delivery review.');
  const filter=grid(native);
  field(filter,'Find a native record',state.recordQuery,value=>{state.recordQuery=value;});
  actions(native).append(button('Search original records',async()=>{state.recordOffset=0;state.recordPage=null;}));
  if(!state.recordPage)state.recordPage=await api(rootPath()+urlParams({section:'records',revision:state.revision,offset:state.recordOffset,
    limit:20,query:state.recordQuery}));
  const catalog=state.recordPage;
  table(native,['Include','Original record','Kind / path','Inspect'],catalog.items,row=>{
    const wrap=node('div');check(wrap,'Include',form.data.selection.records.some(value=>value.path===row.path&&value.sha256===row.sha256),
      selected=>{
        form.data.selection.records=form.data.selection.records.filter(value=>value.path!==row.path);
        if(selected)form.data.selection.records.push({path:row.path,sha256:row.sha256,label:row.label});
        invalidatePreview(form);
      });
    return [wrap,row.label,node('span',row.kind+' · '+row.path,'id'),button('Read full record',async()=>{
      const selected=await api(rootPath()+'/record',{body:{revision:catalog.revision,path:row.path,sha256:row.sha256},readOnly:true});
      state.inspectedRecord=selected;
    })];
  });
  const pages=actions(native);pages.append(button('Previous',async()=>{state.recordOffset=Math.max(0,state.recordOffset-20);state.recordPage=null;},
    {disabled:state.recordOffset===0}),button('Next',async()=>{state.recordOffset=catalog.nextOffset;state.recordPage=null;},{disabled:catalog.nextOffset===null}));
  paragraph(native,form.data.selection.records.length+' native records selected. '+catalog.total+' records match the current search.');
  if(state.inspectedRecord)native.append(detail('Selected original record: '+state.inspectedRecord.path,state.inspectedRecord));
  if(form.data.selection.records.length)native.append(detail('Full saved record selection',form.data.selection.records));
  actions(body).append(button('Review this selection at the current dossier revision',async()=>preparePreview(form,requested),
    {primary:true,disabled:formDisabled(form)}));
  const preview=form.data.preview;
  if(preview){
    const review=card(body,'Exact source-change review');
    counts(review,preview.changeCounts);paragraph(review,'Original dossier revision '+preview.revision+' · '+preview.recordCount+
      ' selected native records · '+preview.uncoveredPlanCount+' source plans without a selected intake.');
    if(preview.currentBriefId!==preview.brief.id)paragraph(review,'This requested update retains an earlier agreed brief. Its actual selected brief remains visible in the report.','warning');
    if(preview.uncoveredPlanCount)review.append(button('Read uncovered source plans',async()=>{
      state.uncoveredPlans=await api(rootPath()+'/preview',{body:{...clone(form.data.previewInput),fingerprint:preview.fingerprint,
        section:'uncovered-plans',offset:0,limit:100},readOnly:true});
    }));
    if(state.uncoveredPlans?.fingerprint===preview.fingerprint)review.append(detail('Uncovered source plans',state.uncoveredPlans.items));
    const page=await changePage(form);
    for(const source of page.items){
      const row=card(review,source.status+' · '+source.id);row.append(detail('Original before and after source values',source));
      if(source.status==='UNCHANGED')continue;
      let decision=form.data.changeDecisions.find(value=>value.sourceId===source.id&&value.fingerprint===source.fingerprint);
      const local=decision??{sourceId:source.id,fingerprint:source.fingerprint,disposition:'needs_review',reason:''};
      const changed=()=>{form.data.changeDecisions=form.data.changeDecisions.filter(value=>value.sourceId!==source.id);
        form.data.changeDecisions.push(local);form.saved=null;retain(form);};
      const fields=grid(row);
      field(fields,'Review disposition',local.disposition,value=>{local.disposition=value;changed();},
        {options:['needs_review','reviewed','not_applicable']});
      field(fields,'Reason and impact',local.reason,value=>{local.reason=value;changed();},{rows:3,full:true});
      actions(row).append(button('Leave this source without an authored decision',async()=>{
        form.data.changeDecisions=form.data.changeDecisions.filter(value=>value.sourceId!==source.id);await put(form);
      }));
    }
    const paging=actions(review);paging.append(button('Previous changes',async()=>{state.changeOffset=Math.max(0,state.changeOffset-20);state.changePage=null;},
      {disabled:state.changeOffset===0}),button('Next changes',async()=>{state.changeOffset=page.nextOffset;state.changePage=null;},{disabled:page.nextOffset===null}));
    paragraph(review,'Showing '+page.offset+'–'+(page.offset+page.items.length)+' of '+page.total+' source comparisons. '+
      form.data.changeDecisions.length+' authored change decisions will be retained.');
    const acceptance=card(body,'Review the agreed customer outputs');
    for(const output of preview.brief.definition.outputs){
      const selected=form.data.acceptance.find(row=>row.outputId===output.id),fields=grid(card(acceptance,output.label));
      paragraph(fields,output.acceptance);
      edit(form,fields,'Result',selected,'status',{options:['not_reviewed','met','partly_met','not_met','not_applicable']});
      edit(form,fields,'Acceptance notes',selected,'note',{rows:3,full:true});
    }
    const summary=grid(card(body,'Delivery review narrative'));
    edit(form,summary,'Summary for the customer',form.data,'summary',{rows:7,full:true});
    edit(form,summary,'Limitations and remaining questions',form.data,'limitations',{rows:5,full:true});
    edit(form,summary,'Review note',form.data,'note',{rows:4,full:true});
    actions(body).append(button('Save this complete work review',async()=>{
      await saveOperation('review-work',{projectId:state.projectId,cycleId:requested.cycleId,requestEditionId:requested.id,
        selection:clone(form.data.selection),fingerprint:preview.fingerprint,summary:form.data.summary,limitations:form.data.limitations,
        changeDecisions:clone(form.data.changeDecisions),acceptance:clone(form.data.acceptance),note:form.data.note},form);
    },{primary:true,disabled:formDisabled(form)}));
  }
  if(form.data.priorReviews.length)body.append(detail('Retained earlier working review contexts',form.data.priorReviews));
  actions(body).append(button('Start another work review from this request',async()=>{await nextDraft('work',requested.id);state.changePage=null;state.changeOffset=0;}));
}

async function deliveryPanel(parent){
  if(!project()){paragraph(parent,'Select a customer project.','empty');return;}
  const works=state.data.work.filter(row=>row.projectId===state.projectId);
  if(!works.some(row=>row.id===state.workId))state.workId=works.at(-1)?.id??null;
  field(parent,'Saved work review to publish',state.workId??'',value=>{state.workId=value;run(async()=>{});},
    {options:[{value:'',label:'Select a saved work review'},...works.map(row=>({value:row.id,
      label:'Revision '+row.revision+' · '+row.summary.slice(0,120)}))]});
  const work=works.find(row=>row.id===state.workId);
  if(work){
    const form=await working('delivery',work.id,{title:selectedRequest()?.definition.label??project().name,coverNote:'',deliveryNote:''});
    state.form=form;const body=editable(card(parent,'Publish a frozen customer delivery'));formState(body,form);
    paragraph(body,'This delivery uses the exact saved review from source revision '+work.sourceRevision+'. Later evidence edits retain their own history.');
    body.append(detail('Complete saved work selection',work));const fields=grid(body);
    edit(form,fields,'Delivery title',form.data,'title',{full:true});
    edit(form,fields,'Customer cover note',form.data,'coverNote',{rows:5,full:true});
    edit(form,fields,'Delivery and continuation instructions',form.data,'deliveryNote',{rows:5,full:true});
    actions(body).append(button('Publish all four complete report formats',async()=>saveOperation('publish-delivery',
      {projectId:state.projectId,workId:work.id,expectedWorkSha256:work.sha256,...clone(form.data)},form),
      {primary:true,disabled:formDisabled(form)}));
    actions(body).append(button('Download original complete work review',async()=>download(rootPath()+'/export'+urlParams({workId:work.id,
      format:'json'}),work.id+'.review.json',work.snapshot.sha256)));
  }else paragraph(parent,'Save a complete work review to publish the customer’s first delivery.','empty');
  const deliveries=state.data.deliveries.filter(row=>row.projectId===state.projectId);
  if(!deliveries.some(row=>row.id===state.deliveryId))state.deliveryId=deliveries.at(-1)?.id??null;
  const library=card(parent,'Frozen delivery library');
  field(library,'Delivery edition',state.deliveryId??'',value=>{state.deliveryId=value;run(async()=>{});},
    {options:[{value:'',label:'Select a delivery'},...deliveries.map(row=>({value:row.id,label:row.title+' · revision '+row.revision}))]});
  const delivery=deliveries.find(row=>row.id===state.deliveryId);
  if(delivery){
    paragraph(library,'Published '+delivery.createdAt+' by '+delivery.actor.name+'. Exact frozen source revision '+delivery.sourceRevision+'.');
    const downloads=actions(library);
    for(const file of delivery.files)downloads.append(button('Download '+file.format.toUpperCase(),async()=>download(
      rootPath()+'/export'+urlParams({deliveryId:delivery.id,format:file.format}),file.name,file.sha256)));
    downloads.append(button('Download complete editable dossier',async()=>download(rootPath()+'/export'+urlParams({
      deliveryId:delivery.id,format:'portable.gz'}),delivery.id+'.dossier.json.gz'),{primary:true}));
    paragraph(library,'The editable dossier includes its complete original history through this publication, source bytes, saved work and all four reports. Receive it here to continue the same project.');
    library.append(detail('Exact delivery identity and complete file set',delivery));
    actions(library).append(button('Commission a correction to this delivery',async()=>{
      await leaveWorkingView();state.newRequest=true;state.requestDraft=uid();state.correctionDelivery=delivery.id;state.tab='request';
    },{disabled:!!state.historyRevision}));
    await deliveryResponse(library,delivery);
  }
}
async function deliveryResponse(parent,delivery){
  const form=await working('delivery-response',delivery.id+'-'+draftNonce('response',delivery.id),
    {status:'RECEIVED',by:{id:'',name:''},occurredAt:now(),channel:'',reference:'',message:'',original:{}});
  const body=editable(card(parent,'Record delivery or the customer’s response'));formState(body,form);const fields=grid(body);
  edit(form,fields,'Actual event',form.data,'status',{options:['SENT','RECEIVED','ACCEPTED','CORRECTIONS_REQUESTED','WITHDRAWN']});
  edit(form,fields,'When it occurred',form.data,'occurredAt');edit(form,fields,'Contact ID',form.data.by,'id');
  edit(form,fields,'Contact name',form.data.by,'name');edit(form,fields,'Delivery / response channel',form.data,'channel');
  edit(form,fields,'Original correspondence reference',form.data,'reference');
  edit(form,fields,'Delivery note or actual customer response',form.data,'message',{rows:5,full:true});
  jsonEdit(form,fields,'Original delivery / correspondence handle',form.data,'original');
  actions(body).append(button('Save delivery event',async()=>saveOperation('record-delivery',
    {projectId:state.projectId,deliveryId:delivery.id,...objectFromEditor(form.data,['original'])},form),
    {disabled:formDisabled(form)}),button('Record another delivery event',async()=>{await nextDraft('response',delivery.id);}));
}
async function historyPanel(parent){
  const bar=grid(parent);
  field(bar,'History section',state.historySection,value=>{state.historySection=value;state.historyOffset=0;state.historyPage=null;run(async()=>{});},
    {options:['operations','briefs','agreements','requests','intakes','work','deliveries','delivery-events']});
  let revisionText=state.historyRevision??'';
  field(bar,'Exact saved dossier revision (blank for current)',revisionText,value=>{revisionText=value;},{type:'number'});
  actions(parent).append(button('Open that saved revision',async()=>{
    need(revisionText===''||Number.isSafeInteger(Number(revisionText))&&Number(revisionText)>=1,'Enter a saved dossier revision.');
    state.workingView=null;state.historyRevision=revisionText===''?null:Number(revisionText);await load();
  }));
  if(!state.historyPage)state.historyPage=await api(rootPath()+urlParams({section:state.historySection,projectId:state.projectId,
    revision:state.revision,offset:state.historyOffset,limit:20}));
  const page=state.historyPage;
  table(parent,['Original saved record','Saved revision','Actor','Open / original replay'],page.items,row=>{
    const cell=node('div');cell.append(detail('Read complete original record',row));
    if(state.historySection==='operations')cell.append(button('Replay this exact saved request',async()=>{
      await saveOperation(row.action,{},null,{replayRequest:row.request});
    }));
    return [row.definition?.label??row.definition?.name??row.title??row.action??row.id,row.revision,row.actor?.name??'',cell];
  });
  const paging=actions(parent);paging.append(button('Previous history',async()=>{state.historyOffset=Math.max(0,state.historyOffset-20);state.historyPage=null;},
    {disabled:state.historyOffset===0}),button('Next history',async()=>{state.historyOffset=page.nextOffset;state.historyPage=null;},{disabled:page.nextOffset===null}));
  const drafts=card(parent,'Retained working forms');
  const local=(await rows('form:'+scope())).filter(row=>!state.projectId||row.projectId===state.projectId);
  actions(drafts).append(button('Receive a complete working form',async()=>{$('working-file').value='';$('working-file').click();}));
  table(drafts,['Working form','Original base','Last retained','Open / copy'],local,row=>{
    const cell=node('div');cell.append(button('Open retained working form',async()=>openWorkingForm(row)),
      button('Download complete working form',async()=>exportWorkingForm(row)));
    return [row.kind+' · '+row.id+(row.origin?' · received or preserved':''),row.baseRevision,row.updatedAt,cell];
  });
  paragraph(drafts,'Working forms remain separate by original brief/request/work identity. Navigation and exact saved-request replay preserve their retained contents.');
  if(project()&&!state.historyRevision){
    const statusForm=await working('project-status',state.projectId+'-'+draftNonce('status',state.projectId),{status:project().status??'ACTIVE',reason:''});
    const body=card(parent,'Project operating status'),fields=grid(body);formState(body,statusForm);
    edit(statusForm,fields,'Status',statusForm.data,'status',{options:['ACTIVE','PAUSED','COMPLETE']});
    edit(statusForm,fields,'Reason',statusForm.data,'reason',{rows:3,full:true});
    actions(body).append(button('Save project status',async()=>saveOperation('set-project-status',
      {projectId:state.projectId,...clone(statusForm.data)},statusForm),{disabled:formDisabled(statusForm)}),
      button('Record another status change',async()=>{await nextDraft('status',state.projectId);}));
  }
}
async function renderPending(){
  const parent=$('pending-list');parent.replaceChildren();if(!state.workspaceId)return;
  const records=await rows('operation:'+state.workspaceId+':');
  table(parent,['Retained operation','State','Original selection','Continue'],records.slice().reverse(),record=>{
    const cell=node('div');
    if(record.status!=='COMPLETE'||record.replayPending)cell.append(button(record.replayPending?'Resume exact native replay':record.status==='REJECTED'?'Retry original request':'Resume exact original request',
      async()=>dispatch(record)));
    else cell.append(button('Open current dossier',async()=>{
      state.dossierId=record.dossierId??record.result.id;state.workingView=null;state.historyRevision=null;await load();
    }));
    cell.append(button('Download original request / result',async()=>{
      const {file,...selection}=record;downloadBlob(new Blob([pretty(selection)+'\n'],{type:'application/json'}),
        'research-operation-'+(record.request?.requestId??record.requestId)+'.json');
    }));
    if(record.file)cell.append(button('Download retained receiving file',async()=>downloadBlob(record.file,record.name)));
    return [record.kind==='review'?record.request.action+' · '+record.request.requestId:'Receive '+record.name,
      record.status+(record.replayPending?' · exact replay pending':'')+(record.error?' · '+record.error:''),record.dossierId??record.sha256,cell];
  });
  if(!records.length)paragraph(parent,'Requests and receiving files are retained here before the first write. Saved operations can be recovered after a lost reply.');
  const imports=await rows('working-import:'+state.workspaceId+':');
  if(imports.length){const box=card(parent,'Retained working-form receiving');
    table(box,['Original file','Dossier / base revision','State','Continue'],imports.slice().reverse(),row=>[
      row.name,row.packet.source.dossierId+' · '+row.packet.source.revision,row.adopted?'RECEIVED':'RETAINED',
      button(row.adopted?'Open received working form':'Review original form and destination',async()=>{
        if(row.adopted)await openWorkingForm(await get(row.adopted.key));
        else await reviewWorkingImport(row.key);
      })]);
  }
}
function renderShell(){
  const dossiers=$('dossier');dossiers.replaceChildren();
  for(const row of state.dossiers){const option=node('option',row.title+' · revision '+row.revision);option.value=row.id;dossiers.append(option);}
  dossiers.value=state.dossierId??'';
  const projects=$('project');projects.replaceChildren();const empty=node('option','New customer project');empty.value='';projects.append(empty);
  for(const row of state.data.projects??[]){const option=node('option',row.name+' · '+row.status);option.value=row.id;projects.append(option);}
  projects.value=state.projectId??'';
  $('revision').textContent=state.revision?'Dossier revision '+state.revision+(state.historyRevision?' · historical view':state.workingView?' · retained working form':''):'';
  $('tabs').replaceChildren();
  for(const[id,label]of [['brief','Customer brief'],['request','Requested update'],['sources','Source intakes'],
    ['review','Work review'],['delivery','Delivery'],['history','History and working forms']]){
    const item=button(label,async()=>{if(state.workingView&&id!==workingTab(state.workingView.kind)&&id!=='history')await leaveWorkingView();state.tab=id;});item.setAttribute('aria-current',state.tab===id?'page':'false');$('tabs').append(item);
  }
}
async function renderPanel(){
  const parent=$('panel');parent.replaceChildren();state.form=null;
  await renderWorkingImport(parent);
  if(!state.dossierId){paragraph(parent,'Open or create the original dossier in Dossiers and evidence, or receive an editable dossier here.','empty');return;}
  if(!state.projectId&&state.tab!=='brief'&&state.tab!=='history'){
    paragraph(parent,'Select an existing customer project or save its first brief.','empty');return;
  }
  parent.append(node('h2',({brief:'Customer brief',request:'Requested update',sources:'Source intakes',review:'Work review',
    delivery:'Frozen customer delivery',history:'History and retained work'})[state.tab]));
  if(state.projectId&&['request','sources','review'].includes(state.tab)){
    const requests=state.data.requests.filter(row=>row.projectId===state.projectId&&(row.current||row.id===state.workingView?.bindings?.requestId));
    field(parent,'Current requested update',state.newRequest?'':state.requestId??'',value=>{
      run(async()=>{await leaveWorkingView();state.newRequest=!value;state.requestId=value||null;state.recordPage=null;state.changePage=null;});
    },{options:[{value:'',label:'New separately requested update'},...requests.map(row=>({value:row.id,
      label:row.definition.label+' · '+row.definition.kind+' · '+row.status}))]});
  }
  if(state.workingView){const banner=card(parent,'Retained working form');
    paragraph(banner,state.workingView.kind+' · original base '+state.workingView.baseRevision+' · current dossier '+state.latestRevision+
      '. The complete form remains in History and working forms when you leave this view.');
    actions(banner).append(button('Return to the current dossier',async()=>leaveWorkingView()));
  }
  if(state.historyRevision&&state.tab!=='history'){
    paragraph(parent,'This is the exact saved dossier revision '+state.revision+'. Return to the current dossier to edit.','warning');
    const section={brief:'briefs',request:'requests',sources:'intakes',review:'work',delivery:'deliveries'}[state.tab];
    for(const row of state.data[section]?.filter(value=>value.projectId===state.projectId)??[])parent.append(detail(
      row.definition?.name??row.definition?.label??row.title??row.id,row));
    return;
  }
  await ({brief:briefPanel,request:requestPanel,sources:sourcesPanel,review:reviewPanel,delivery:deliveryPanel,history:historyPanel})[state.tab](parent);
}
$('token').value=state.token;
$('connection').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
  state.token=$('token').value.trim();sessionStorage.setItem(tokenKey,state.token);state.instanceId=null;state.workspaceId=null;
  await synchronize();await restoreSelection();await load();await restoreOperator();msg('Connected to the original Research workspace.');
});});
async function restoreOperator(){
  const saved=await get('operator:'+state.workspaceId);
  if(saved){$('actor-id').value=saved.actor.id;$('actor-name').value=saved.actor.name;}
}
for(const id of ['actor-id','actor-name'])$(id).addEventListener('input',()=>{
  if(!state.workspaceId)return;const record={key:'operator:'+state.workspaceId,actor:{id:$('actor-id').value,name:$('actor-name').value}};
  const pending=put(record).catch(error=>msg(error.message,true));writes.add(pending);pending.finally(()=>writes.delete(pending));
});
$('dossier').addEventListener('change',()=>run(async()=>{
  state.workingView=null;state.dossierId=$('dossier').value;state.projectId=null;state.requestId=null;state.historyRevision=null;state.tab='brief';
  state.newProject=uid();await load();
}));
$('project').addEventListener('change',()=>run(async()=>{
  state.workingView=null;state.historyRevision=null;state.projectId=$('project').value||null;state.requestId=null;state.newRequest=false;state.newProject=uid();
  await load();
}));
$('new-project').addEventListener('click',()=>run(async()=>{state.workingView=null;state.projectId=null;state.newProject=uid();state.tab='brief';state.historyRevision=null;await load();}));
$('refresh').addEventListener('click',()=>run(async()=>{state.workingView=null;state.historyRevision=null;await load();}));
$('receive').addEventListener('click',()=>{$('receive-file').value='';$('receive-file').click();});
$('receive-file').addEventListener('change',()=>{const file=$('receive-file').files[0];if(file)run(async()=>retainReceive(file));});
$('working-file').addEventListener('change',()=>{const file=$('working-file').files[0];if(file)run(async()=>retainWorkingImport(file));});
window.addEventListener('beforeunload',event=>{if(writes.size||state.busy){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{if(state.form)retain(state.form);});
const initial=new URLSearchParams(location.search);state.dossierId=initial.get('dossier');
state.projectId=initial.get('project');state.requestId=initial.get('request');
await run(async()=>{await db();if(state.token){await synchronize();await restoreSelection();await load();await restoreOperator();}});
