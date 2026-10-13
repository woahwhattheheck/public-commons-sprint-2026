// MIT. Customer procedures on the original GridFabric controller and Operating Plans.
import {
  inspectOperatingPlan, operatingPlanDraft, operatingPlanRevision, saveOperatingPlanRevision,
  receiveOperatingPlan, forkOperatingPlan, createOperatingStep, addOperatingStep, moveOperatingStep,
  createOperatingFile, addOperatingFile, removeOperatingFile, operatingFileBytes, OPERATING_FILE_MAX_BYTES,
  renderOperatingPlanMarkdown, renderOperatingPlanHTML, compareOperatingPlan, STEP_STATES
} from '/procedures/model/operating-plan.mjs';

const $=id=>document.getElementById(id);
const copy=value=>structuredClone(value);
const format=value=>JSON.stringify(value,null,2);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const need=(value,message)=>{if(!value)throw new Error(message);};
const BROWSER_HASH_MAX_BYTES=64*1024*1024;
const ARCHIVE_MAX_BYTES=4*1024*1024*1024;
const NATIVE_ARCHIVE_RECEIVE='starforge gridfabric-procedure receive --archive COMPLETE_ARCHIVE_GZ --sha256 ARCHIVE_SHA256 --bytes ARCHIVE_BYTES --out NEW_CAPTURE_DIRECTORY [--maximum-expanded-bytes BYTES]';
const STEP_IDS=['workspace','configuration','sources','mappings','callbacks','events','dispatch','reports','delivery'];
const META=[['title','Title'],['customer','Customer'],['period','Period'],['owner','Operating owner'],
  ['purpose','Useful result'],['receiving','Receiving and continuation'],['notes','Notes']];
const IDS={instances:'instance_id',instance_editions:'edition_id',sources:'source_id',source_rows:'row_id',
  source_issues:'issue_id',mappings:'mapping_id',callbacks:'callback_id',callback_deliveries:'delivery_id',
  events:'id',event_revisions:'revision_id',distributions:'distribution_id',opt_decisions:'decision_id',
  device_actions:'device_action_id',reports:'report_id',report_rows:'report_row_id',
  management_operations:'operation_id',management_receipts:'receipt_id',operations:'request_id'};
const state={token:location.hash.slice(1)||sessionStorage.getItem('gridfabric-connection')||'',
  context:null,key:null,db:null,diskVersion:0,sequence:0,savedSequence:0,queue:Promise.resolve(),
  storageError:null,connected:false,busy:false,section:'plan',data:null,recordPage:null,detail:null,
  capturePage:null,selectedRequest:null,selectedImport:null};
if(location.hash){sessionStorage.setItem('gridfabric-connection',state.token);history.replaceState(null,'',location.pathname+location.search);}
function node(tag,attrs={},...children){
  const e=document.createElement(tag);
  for(const[k,v]of Object.entries(attrs)){if(k==='class')e.className=v;else if(k==='text')e.textContent=v;
    else if(k in e&&k!=='list')e[k]=v;else e.setAttribute(k,String(v));}
  for(const child of children.flat())if(child!==null&&child!==undefined)e.append(typeof child==='string'?document.createTextNode(child):child);
  return e;
}
const text=(tag,value,cls)=>node(tag,{text:String(value??''),...(cls?{class:cls}:{})});
const details=(title,value)=>node('details',{},node('summary',{text:title}),node('pre',{text:format(value)}));
function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);$('notice').hidden=!message;}
function storageNotice(){
  $('storage-panel').hidden=!state.storageError;
  $('storage-message').textContent=state.storageError?'The complete entered work remains in this page. '+state.storageError.message:'';
  $('save-state').textContent=state.storageError?'Entered work is not yet durable':state.savedSequence===state.sequence?'Current browser work is saved':'Saving complete entered work';
}
function button(label,action){const b=node('button',{type:'button',text:label});b.addEventListener('click',()=>run(action));return b;}
function actions(...buttons){return node('div',{class:'procedure-actions'},...buttons);}
function field(label,value,onchange,{area=false,type='text',max=32000,wide=false}={}){
  const input=node(area?'textarea':'input',area?{value:value??'',maxLength:max}:{type,value:value??'',maxLength:max});
  input.addEventListener('input',()=>{onchange(input.value);persist().catch(()=>{});});
  return node('label',wide?{class:'wide'}:{},text('span',label),input);
}
function select(label,values,current,onchange){
  const input=node('select');for(const value of values){const option=Array.isArray(value)?value:[value,value];input.append(node('option',{value:option[0],text:option[1],selected:option[0]===current}));}
  input.addEventListener('change',()=>run(async()=>{onchange(input.value);await persist();render();}));
  return node('label',{},text('span',label),input);
}
function fileInput(label,accept,onchange){
  const input=node('input',{type:'file',accept});
  input.addEventListener('change',()=>{const file=input.files?.[0];if(file)run(()=>onchange(file));});
  return node('label',{},text('span',label),input);
}
function downloadBlob(name,blob){
  const url=URL.createObjectURL(blob),a=node('a',{href:url,download:name});document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function jsonDownload(name,value){downloadBlob(name,new Blob([format(value)+'\n'],{type:'application/json'}));}
async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}

const BACKUP_SCHEMA='gridfabric.procedure-browser-backup.v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const safeKey=value=>typeof value==='string'&&value!=='__proto__'&&value!=='constructor'&&value!=='prototype';
function browserHomeKey(){return state.context.workspace.workspace_id+':'+state.context.workspace.source_sha256;}
function binaryBase64(bytes){
  const chunks=[];
  for(let offset=0;offset<bytes.length;offset+=49152){let raw='';for(const byte of bytes.subarray(offset,offset+49152))raw+=String.fromCharCode(byte);chunks.push(btoa(raw));}
  return chunks.join('');
}
function base64Bytes(value){
  need(typeof value==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),'The embedded archive is not complete canonical base64.');
  const raw=atob(value),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  need(binaryBase64(bytes)===value,'The embedded archive encoding differs.');return bytes;
}
async function browserBundle(){
  need(state.data,'Open the browser work before exporting it.');
  const data=copy(state.data);let embedded=0;
  for(const local of Object.values(data.requests||{})){
    if(!(local.archive instanceof Blob))continue;
    const original=local.request;
    need(local.kind==='import'&&local.archive.size===original.bytes,'The retained archive declaration is incomplete.');
    const external={encoding:'external-original',name:original.name,bytes:original.bytes,sha256:original.sha256};
    if(local.archive.size<=BROWSER_HASH_MAX_BYTES-embedded){
      try{
        const bytes=new Uint8Array(await local.archive.arrayBuffer());
        need(await sha256(bytes)===original.sha256,'The retained archive differs from its frozen declaration.');
        local.archive={...external,encoding:'base64',content:binaryBase64(bytes)};embedded+=bytes.byteLength;
      }catch(error){local.archive={...external,receivingNote:'Reselect this exact original file; browser embedding was unavailable: '+error.message};}
    }else local.archive=external;
  }
  return {schema:BACKUP_SCHEMA,exportedAt:new Date().toISOString(),workspace:copy(data.workspace),data};
}
function validateBackupInput(input,id,{unbound=false,request=false}={}){
  need(object(input)&&input.id===id,'The browser plan input has another identity.');
  if(unbound)return;
  need(input.schema==='stellar-forge.gridfabric-procedure-input.v1'&&object(input.workspace)&&
    Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>=0&&typeof input.instanceId==='string'&&
    Array.isArray(input.records)&&Array.isArray(input.files)&&Array.isArray(input.stepResults),'The complete procedure input is missing.');
  need(typeof input.workspace.workspace_id==='string'&&typeof input.workspace.workspace_directory==='string'&&
    /^[a-f0-9]{64}$/.test(input.workspace.source_sha256),'The procedure workspace identity is incomplete.');
  for(const key of META.map(([key])=>key))need(typeof input[key]==='string','The procedure input is missing '+key+'.');
  if(request)need(input.instanceId.length>0,'The frozen capture has no instance identity.');
}
function validateBackupDraft(entry,id){
  if(entry.plan===null||entry.plan===undefined){need(!entry.draft,'An unprepared input has an unexplained plan draft.');return;}
  const plan=inspectOperatingPlan(entry.plan);need(plan.id===id,'The saved plan ID differs from its browser key.');
  const draft=entry.draft;
  need(object(draft)&&draft.schema===operatingPlanDraft(plan).schema&&draft.planId===id&&
    Number.isSafeInteger(draft.baseRevision)&&draft.baseRevision>=1&&draft.baseRevision<=plan.revisions.length&&
    object(draft.content)&&Array.isArray(draft.content.steps),'The complete entered draft identity is missing.');
  for(const key of META.map(([key])=>key))need(typeof draft.content[key]==='string','The entered draft is missing '+key+'.');
  const ids=new Set();
  for(const step of draft.content.steps){
    need(object(step)&&typeof step.id==='string'&&!ids.has(step.id),'An entered step identity is missing or repeated.');ids.add(step.id);
    for(const key of ['title','instruction','inputs','expectedResult','owner','due','status','recordedResult'])
      need(typeof step[key]==='string','The complete entered step is missing '+key+'.');
    need(Array.isArray(step.argv)&&step.argv.every(item=>typeof item==='string')&&Array.isArray(step.files??[]),'The entered step structure is incomplete.');
    for(const file of step.files||[])operatingFileBytes(file);
  }
  need(entry.argvText===undefined||object(entry.argvText)&&Object.values(entry.argvText).every(value=>typeof value==='string'),'Keep the complete raw argument text.');
}
function validateBackupRequest(local,id,workspace){
  need(UUID.test(id)&&object(local)&&local.request_id===id&&object(local.request)&&local.request.request_id===id,
    'The frozen browser request ID differs from its key.');
  const r=local.request;
  if(local.kind==='capture'){
    need(same(Object.keys(r).sort(),['request_id','input','catalog','plan','savedAt'].sort()),'The complete frozen capture body is required.');
    const plan=inspectOperatingPlan(r.plan);validateBackupInput(r.input,plan.id,{request:true});
    need(same(r.input.workspace,workspace)&&typeof r.savedAt==='string','The frozen capture belongs to another browser workspace.');
    compareOperatingPlan(plan,r.catalog);
  }else{
    need(local.kind==='import'&&same(Object.keys(r).sort(),['request_id','kind','name','bytes','sha256'].sort())&&r.kind==='import'&&
      typeof r.name==='string'&&r.name.length>0&&Number.isSafeInteger(r.bytes)&&r.bytes>=0&&r.bytes<=ARCHIVE_MAX_BYTES&&
      /^[a-f0-9]{64}$/.test(r.sha256),'The complete frozen import declaration is required.');
  }
  if(local.view){matchProcedureRequestView(local.view,r);need(local.view.kind===local.kind,'The saved response kind differs.');
    if(local.view.result?.plan)inspectOperatingPlan(local.view.result.plan);
    if(local.view.result?.input)need(local.view.result.input.id===local.view.result.plan?.id,'The saved result has another plan identity.');
  }
  if(local.archiveExternal)need(local.kind==='import'&&local.archiveExternal.name===r.name&&
    local.archiveExternal.bytes===r.bytes&&local.archiveExternal.sha256===r.sha256,'The external original archive declaration differs.');
}
async function inspectBrowserBundle(value){
  const framed=value?.schema===BACKUP_SCHEMA;
  need(framed||value?.schema==='gridfabric.procedure-browser.v1','Choose a complete GridFabric browser-work backup.');
  const data=copy(framed?value.data:value);
  need(object(data)&&data.schema==='gridfabric.procedure-browser.v1'&&object(data.workspace)&&
    same(data.workspace,state.context.workspace)&&(!framed||same(value.workspace,data.workspace)),
    'This browser-work journal belongs to another workspace, directory or source.');
  need(object(data.plans)&&object(data.requests)&&Object.keys(data.plans).every(safeKey),'The browser journal needs complete keyed plans and requests.');
  for(const[id,entry]of Object.entries(data.plans)){
    need(object(entry),'A browser plan entry is incomplete.');validateBackupInput(entry.input,id,{unbound:!!entry.inputUnbound});
    validateBackupDraft(entry,id);
    if(entry.catalog&&entry.plan)compareOperatingPlan(entry.plan,entry.catalog);
    for(const binding of entry.bindingHistory||[])need(object(binding)&&object(binding.input),'The prior binding history is incomplete.');
  }
  need(data.current===null||Object.hasOwn(data.plans,data.current),'The selected browser plan is absent.');
  let embedded=0;
  for(const[id,local]of Object.entries(data.requests)){
    validateBackupRequest(local,id,data.workspace);
    if(local.archive!==undefined&&local.archive!==null){
      const declaration=local.archive,r=local.request;
      if(!framed&&object(declaration)&&declaration.encoding==='base64'&&declaration.name===undefined)declaration.name=r.name;
      need(local.kind==='import'&&object(declaration)&&declaration.name===r.name&&declaration.bytes===r.bytes&&
        declaration.sha256===r.sha256&&['base64','external-original'].includes(declaration.encoding),
        'The backup archive differs from its original request.');
      local.archiveExternal={name:r.name,bytes:r.bytes,sha256:r.sha256};
      if(declaration.encoding==='base64'){
        embedded+=r.bytes;need(embedded<=BROWSER_HASH_MAX_BYTES,'Embedded backup archives exceed the bounded browser hash buffer.');
        need(typeof declaration.content==='string'&&declaration.content.length===Math.ceil(r.bytes/3)*4,'The embedded archive length differs from its declaration.');
        const bytes=base64Bytes(declaration.content);
        need(bytes.length===r.bytes&&await sha256(bytes)===r.sha256,'The complete embedded archive hash differs.');
        local.archive=new Blob([bytes],{type:'application/gzip'});
      }else delete local.archive;
    }
  }
  if(data.incoming?.plan)inspectOperatingPlan(data.incoming.plan);
  return {data,exportedAt:framed?value.exportedAt:null};
}
function requireOriginalRead(local,source){
  const saved=copy(local);
  local.recoveryObservations??=[];
  local.recoveryObservations.push({source,receivedAt:new Date().toISOString(),status:saved.status??null,
    view:saved.view??null,error:saved.error??null,lastObservedAt:saved.lastObservedAt??null});
  local.status='RECOVERY_READ_REQUIRED';local.releasedForNewCapture=false;
  return local;
}
function planMerge(existing,incoming){
  if(same(existing,incoming))return existing;
  need(existing.plan&&incoming.plan&&!dirty(existing)&&!dirty(incoming),'Entered drafts differ; open the backup as a separate recovery journal.');
  const omit=entry=>Object.fromEntries(Object.entries(entry).filter(([key])=>!['plan','draft','argvText'].includes(key)));
  need(same(omit(existing),omit(incoming)),'Selections or other entered plan fields differ; keep both journals.');
  const received=receiveOperatingPlan(incoming.plan,existing.plan),merged=copy(existing);
  merged.plan=received.plan;merged.draft=operatingPlanDraft(received.plan);merged.argvText={};return merged;
}
function previewBrowserMerge(incoming){
  const merged=copy(state.data),conflicts=[],addedPlans=[],joinedPlans=[],addedRequests=[];
  for(const[id,entry]of Object.entries(incoming.plans)){
    if(!Object.hasOwn(merged.plans,id)){merged.plans[id]=copy(entry);addedPlans.push(id);}
    else try{merged.plans[id]=planMerge(merged.plans[id],entry);joinedPlans.push(id);}catch(error){conflicts.push({kind:'plan',id,message:error.message});}
  }
  for(const[id,request]of Object.entries(incoming.requests)){
    const existing=merged.requests[id];
    if(!existing){merged.requests[id]=requireOriginalRead(copy(request),'browser-backup');addedRequests.push(id);continue;}
    if(existing.kind!==request.kind||!same(existing.request,request.request)){conflicts.push({kind:'request',id,message:'The same original UUID has different frozen input.'});continue;}
    const receipt=copy(request);delete receipt.archive;
    existing.backupReceipts??=[];
    if(!existing.backupReceipts.some(item=>same(item,receipt)))existing.backupReceipts.push(receipt);
    if(!(existing.archive instanceof Blob)&&request.archive instanceof Blob)existing.archive=request.archive;
    if(request.archiveExternal)existing.archiveExternal=copy(request.archiveExternal);
  }
  if(!merged.current)merged.current=incoming.current;
  return {merged,conflicts,addedPlans,joinedPlans,addedRequests};
}
async function listBrowserJournals(){
  const base=browserHomeKey();
  const keys=await new Promise((resolve,reject)=>{
    const request=state.db.transaction('workspaces','readonly').objectStore('workspaces').getAllKeys();
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  state.journalKeys=keys.filter(key=>typeof key==='string'&&(key===base||key.startsWith(base+':recovery:'))).sort();
  return state.journalKeys;
}
async function stageBrowserBundle(file){
  const value=JSON.parse(await file.text()),received=await inspectBrowserBundle(value);
  state.backupPreview={...received,filename:file.name,preview:previewBrowserMerge(received.data)};
  state.section='receive';render();notice('The complete backup is retained for review. No request has been sent.');
}
async function receiveBrowserBundle(separate=false){
  need(state.backupPreview,'Choose the complete browser-work backup first.');
  await flush();
  const incoming=state.backupPreview,checked=previewBrowserMerge(incoming.data);
  if(!separate){
    need(checked.conflicts.length===0,'The journals contain divergent entered work or frozen requests. Open a separate recovery journal to retain both.');
    checked.merged.backupImports??=[];
    checked.merged.backupImports.push({filename:incoming.filename,exportedAt:incoming.exportedAt,receivedAt:new Date().toISOString(),
      metadata:Object.fromEntries(Object.entries(copy(incoming.data)).filter(([key])=>!['plans','requests'].includes(key)))});
    state.data=checked.merged;await persist();
  }else{
    const previous={key:state.key,data:state.data,diskVersion:state.diskVersion,sequence:state.sequence,savedSequence:state.savedSequence,
      queue:state.queue,storageError:state.storageError};
    const next=copy(incoming.data),key=browserHomeKey()+':recovery:'+crypto.randomUUID();
    if(next.recoveryOrigin){next.recoveryJournalHistory??=[];next.recoveryJournalHistory.push(copy(next.recoveryOrigin));}
    next.recoveryOrigin={filename:incoming.filename,exportedAt:incoming.exportedAt,receivedAt:new Date().toISOString()};
    for(const local of Object.values(next.requests))requireOriginalRead(local,'separate-browser-backup');
    Object.assign(state,{key,data:next,diskVersion:0,sequence:0,savedSequence:0,queue:Promise.resolve(),storageError:null});
    try{await persist();}catch(error){Object.assign(state,previous);throw error;}
    sessionStorage.setItem('gridfabric-procedure-journal:'+browserHomeKey(),key);
  }
  state.backupPreview=null;state.journalToOpen=null;state.recordPage=null;state.detail=null;state.selectedRequest=Object.keys(state.data.requests).at(-1)||null;
  await listBrowserJournals();render();notice('The complete browser journal is received. Read each restored original request before any explicit continuation.');
}
async function openBrowserJournal(key){
  await flush();need((await listBrowserJournals()).includes(key),'Choose an existing browser journal.');
  const saved=await loadLocal(key);need(saved&&same(saved.data.workspace,state.context.workspace),'The saved browser journal belongs to another workspace.');
  Object.assign(state,{key,data:saved.data,diskVersion:saved.version,sequence:0,savedSequence:0,queue:Promise.resolve(),storageError:null,
    selectedRequest:Object.keys(saved.data.requests).at(-1)||null,backupPreview:null,journalToOpen:null,recordPage:null,detail:null});
  sessionStorage.setItem('gridfabric-procedure-journal:'+browserHomeKey(),key);render();notice('The selected complete browser journal is open. No request was sent.');
}
function renderBrowserRecovery(root){
  root.append(text('h3','Keep and recover all browser work'),
    text('p','The journal retains every plan history, entered draft, raw command arguments and frozen request. Small archives may be embedded. Larger files remain exact external declarations: reselect the original file before continuing; the native importer verifies its complete bytes.'),
    actions(button('Download all current browser work',async()=>jsonDownload('GridFabric_Procedure_Browser_Work.json',await browserBundle()))),
    fileInput('Review saved browser-work journal','.json,application/json',stageBrowserBundle),
    button('Read saved browser journals',async()=>{await listBrowserJournals();render();}));
  if(state.journalKeys?.length)root.append(select('Open a saved local journal',state.journalKeys.map(key=>[key,
    key===browserHomeKey()?'Main browser work':'Recovered journal '+key.split(':recovery:')[1]]),state.journalKeys.includes(state.journalToOpen)?state.journalToOpen:state.key,
    key=>{state.journalToOpen=key;}),button('Open selected journal',()=>openBrowserJournal(state.journalToOpen||state.key)));
  const incoming=state.backupPreview;if(!incoming)return;
  const preview=previewBrowserMerge(incoming.data);
  root.append(details('Incoming backup identity',{filename:incoming.filename,exportedAt:incoming.exportedAt,workspace:incoming.data.workspace}),
    details('Proposed compatible join',{addedPlans:preview.addedPlans,joinedPlans:preview.joinedPlans,addedRequests:preview.addedRequests,conflicts:preview.conflicts}),
    details('Complete incoming plans and entered drafts',incoming.data.plans),
    details('Complete incoming frozen requests and histories',incoming.data.requests));
  if(!preview.conflicts.length)root.append(button('Merge this compatible journal',()=>receiveBrowserBundle(false)));
  root.append(button('Open as a separate recovery journal',()=>receiveBrowserBundle(true)),
    text('p','Separate recovery leaves the current journal intact and remains selectable after reopening. Restored requests require an original outcome read; receiving a backup sends nothing.'));
}


async function request(path,{method='GET',body,raw=false,headers={},signal}={}){
  need(state.token,'Open the original private GridFabric connection.');
  const response=await fetch(path,{method,credentials:'omit',cache:'no-store',signal,
    headers:{Authorization:'Bearer '+state.token,...(body!==undefined&&!raw?{'Content-Type':'application/json'}:{}),...headers},
    body:body===undefined?undefined:raw?body:JSON.stringify(body)});
  if(!response.ok){
    let observed;try{observed=await response.json();}catch{observed=null;}
    const error=Object.assign(new Error(observed?.error?.message||'The original owner returned HTTP '+response.status),
      {code:observed?.error?.code,status:response.status,original:observed});
    if(response.status===401)$('connection-panel').hidden=false;throw error;
  }
  return response;
}
const read=async path=>(await request(path)).json();
async function run(action){
  if(state.busy)return;
  state.busy=true;$('controls').disabled=true;$('connection-form').querySelector('button').disabled=true;
  $('work-state').textContent='Receiving the original operation';
  try{await action();}
  catch(error){notice((error.code?error.code+': ':'')+error.message,true);}
  finally{state.busy=false;$('controls').disabled=!state.connected;$('connection-form').querySelector('button').disabled=false;
    $('work-state').textContent=state.connected?'Original owner connected':'Waiting for the original connection';storageNotice();}
}
function openDB(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('gridfabric-customer-procedures',1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('workspaces'))request.result.createObjectStore('workspaces',{keyPath:'key'});};
    request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Close an older procedure page so the original browser store can open.'));
    request.onsuccess=()=>resolve(request.result);
  });
}
function loadLocal(key){
  return new Promise((resolve,reject)=>{
    const tx=state.db.transaction('workspaces','readonly'),r=tx.objectStore('workspaces').get(key);
    r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error);
  });
}
function writeLocal(key,data){
  return new Promise((resolve,reject)=>{
    const tx=state.db.transaction('workspaces','readwrite'),store=tx.objectStore('workspaces'),r=store.get(key);
    let failure;
    r.onsuccess=()=>{
      if((r.result?.version??0)!==state.diskVersion){failure=new Error('Another procedure page saved this workspace. Download this page’s entered work before reopening the current browser record.');tx.abort();return;}
      store.put({key,version:state.diskVersion+1,data});
    };
    tx.oncomplete=()=>{state.diskVersion++;resolve();};
    tx.onabort=()=>reject(failure||tx.error||new Error('The browser did not commit the complete procedure record.'));
    tx.onerror=()=>{};
  });
}
function persist(){
  need(state.data&&state.key&&state.db,'Open the original workspace before saving a procedure.');
  const snapshot=copy(state.data),key=state.key,seq=++state.sequence;
  state.queue=state.queue.catch(()=>{}).then(()=>writeLocal(key,snapshot)).then(()=>{
    state.savedSequence=seq;if(seq===state.sequence)state.storageError=null;storageNotice();
  },error=>{state.storageError=error;storageNotice();throw error;});
  storageNotice();return state.queue;
}
async function flush(){await state.queue;if(state.storageError)throw state.storageError;}
function freshInput(context){
  return {schema:'stellar-forge.gridfabric-procedure-input.v1',id:'grid-'+crypto.randomUUID(),title:'GridFabric customer operation',
    customer:'',period:'',owner:'',purpose:'',notes:'',receiving:'',workspace:copy(context.workspace),
    expectedRevision:context.revision,instanceId:'',records:[],files:[],stepResults:[]};
}
const current=()=>state.data?.plans[state.data.current]||null;
const dirty=entry=>{
  if(!entry?.plan||!entry?.draft)return false;
  if(!same(entry.draft,operatingPlanDraft(entry.plan)))return true;
  return Object.entries(entry.argvText||{}).some(([id,raw])=>{
    const step=entry.draft.content.steps.find(item=>item.id===id);
    if(!step)return true;
    try{return !same(JSON.parse(raw),step.argv);}catch{return true;}
  });
};
function changeView(section){
  state.section=section;
  for(const name of ['plan','selection','capture','receive'])$('section-'+name).hidden=name!==section;
  for(const b of document.querySelectorAll('[data-section]'))b.setAttribute('aria-current',b.dataset.section===section?'page':'false');
}
async function connect(){
  if(state.data)await flush();
  const context=await read('/api/procedures/context');
  need(context.workspace?.workspace_id&&context.workspace?.workspace_directory&&context.workspace?.source_sha256&&Number.isSafeInteger(context.revision),
    'The original procedure context has no complete workspace identity.');
  need(Array.isArray(context.tables)&&context.catalog,'The complete native tables and command catalog are required.');
  if(!state.db)state.db=await openDB();
  const home=context.workspace.workspace_id+':'+context.workspace.source_sha256;
  const wanted=sessionStorage.getItem('gridfabric-procedure-journal:'+home);
  let key=typeof wanted==='string'&&(wanted===home||wanted.startsWith(home+':recovery:'))?wanted:home;
  let stored=await loadLocal(key);if(!stored&&key!==home){key=home;stored=await loadLocal(home);}
  if(stored)need(same(stored.data.workspace,context.workspace),'The saved browser work is bound to another original workspace directory or source.');
  state.context=context;state.key=key;state.diskVersion=stored?.version??0;state.sequence=0;state.savedSequence=0;
  state.data=stored?.data??{schema:'gridfabric.procedure-browser.v1',workspace:copy(context.workspace),plans:{},current:null,requests:{},incoming:null};
  state.storageError=null;state.queue=Promise.resolve();state.connected=true;
  state.selectedRequest=Object.keys(state.data.requests).at(-1)||null;state.journalToOpen=null;
  if(!state.data.current){const input=freshInput(context);state.data.plans[input.id]={input,plan:null,draft:null};state.data.current=input.id;await persist();}
  $('connection-panel').hidden=true;$('connection-state').textContent='Original owner connected';
  $('workspace-identity').textContent=context.workspace.workspace_id+' · '+context.workspace.workspace_directory;
  $('workspace-revision').textContent='Current revision '+context.revision;
  await listBrowserJournals();render();notice('Saved procedure drafts and original requests are open.');
}
async function savePlan(){
  const entry=current();need(entry?.plan&&entry.draft,'Prepare or receive a complete Operating Plan first.');
  for(const step of entry.draft.content.steps)if(Object.hasOwn(entry.argvText||{},step.id)){
    const args=JSON.parse(entry.argvText[step.id]);need(Array.isArray(args)&&args.every(x=>typeof x==='string'),'Command arguments must remain a complete JSON array of text.');
    step.argv=args;
  }
  entry.plan=saveOperatingPlanRevision(entry.plan,entry.draft);entry.draft=operatingPlanDraft(entry.plan);
  for(const[key]of META)entry.input[key]=entry.draft.content[key];
  await persist();return entry.plan;
}
async function prepare(){
  await flush();const entry=current();need(!entry.plan,'This plan already has a history. Edit it or create a separate new plan.');
  const response=await(await request('/api/procedures/prepare',{method:'POST',body:{input:copy(entry.input)}})).json();
  need(response.input?.id===entry.input.id&&same(response.input.workspace,entry.input.workspace),'Prepared plan belongs to another input.');
  const plan=inspectOperatingPlan(response.plan);need(plan.id===entry.input.id,'The original preparer returned a different plan.');
  entry.input=response.input;entry.catalog=response.catalog;entry.plan=plan;entry.draft=operatingPlanDraft(plan);await persist();render();notice('The complete nine-step procedure is prepared.');
}
async function newPlan(){
  await flush();const input=freshInput(state.context);state.data.plans[input.id]={input,plan:null,draft:null};state.data.current=input.id;await persist();render();
}
function render(){
  if(!state.data)return;
  renderPlan();renderSelection();renderCapture();renderReceive();changeView(state.section);storageNotice();
}


function renderPlan(){
  const root=$('section-plan');root.replaceChildren();const entry=current();if(!entry)return;
  const options=Object.entries(state.data.plans).map(([id,e])=>[id,(e.draft?.content.title||e.input.title)+' · '+id]);
  root.append(node('div',{class:'procedure-grid'},select('Saved local procedure',options,state.data.current,value=>{state.data.current=value;}),
    actions(button('New procedure',newPlan),button('Save plan revision',async()=>{await savePlan();render();notice('The plan revision and complete history are saved.');}))));
  root.append(text('p','Plan '+entry.input.id+(entry.plan?' · '+entry.plan.revisions.length+' saved revisions':' · not yet prepared'),'mono'));
  const content=entry.draft?.content||entry.input,grid=node('div',{class:'procedure-grid'});
  for(const[key,label]of META)grid.append(field(label,content[key],value=>{content[key]=value;if(!entry.plan)entry.input[key]=value;},
    {area:['purpose','receiving','notes'].includes(key),wide:['purpose','receiving','notes'].includes(key),max:key==='title'||key==='owner'?300:['customer','period'].includes(key)?1000:32000}));
  root.append(grid);
  if(!entry.plan){root.append(actions(button('Prepare the original nine-step plan',prepare)));return;}
  root.append(actions(
    button('Download complete editable plan',async()=>jsonDownload(entry.plan.id+'.json',await savePlan())),
    button('Download readable HTML',async()=>downloadBlob(entry.plan.id+'.html',new Blob([renderOperatingPlanHTML(await savePlan())],{type:'text/html'}))),
    button('Download readable Markdown',async()=>downloadBlob(entry.plan.id+'.md',new Blob([renderOperatingPlanMarkdown(await savePlan())],{type:'text/markdown'})))
  ));
  root.append(details('Complete saved revision history',entry.plan),details('Current registration comparison',compareOperatingPlan(entry.plan,state.context.catalog)));
  for(const [index,step]of entry.draft.content.steps.entries()){
    const section=node('section',{class:'procedure-step'},text('h3',(index+1)+'. '+step.title),text('p','Step '+step.id,'mono'));
    const fields=node('div',{class:'procedure-grid'});
    fields.append(field('Step title',step.title,v=>step.title=v,{max:300}),field('Step owner',step.owner,v=>step.owner=v,{max:300}),
      field('Due date',step.due,v=>step.due=v,{type:'date',max:10}),
      select('Recorded status',STEP_STATES,step.status,v=>step.status=v));
    for(const[key,label]of [['instruction','Work'],['inputs','Inputs and retained workspace binding'],['expectedResult','Expected result'],['recordedResult','Recorded operator result']])
      fields.append(field(label,step[key],v=>step[key]=v,{area:true,wide:true}));
    entry.argvText??={};
    fields.append(field('Command arguments — complete JSON array',entry.argvText[step.id]??format(step.argv),v=>entry.argvText[step.id]=v,{area:true,wide:true}));
    section.append(fields);
    if(step.selection)section.append(details('Original command registration and source',step.selection));
    section.append(actions(button('Move earlier',async()=>{need(index>0,'This step is already first.');entry.draft=moveOperatingStep(entry.draft,step.id,index-1);await persist();render();}),
      button('Move later',async()=>{need(index<entry.draft.content.steps.length-1,'This step is already last.');entry.draft=moveOperatingStep(entry.draft,step.id,index+1);await persist();render();})));
    section.append(fileInput('Attach a complete output file (up to 24 MiB)','',async file=>{
      need(file.size<=OPERATING_FILE_MAX_BYTES,'The original Operating Plan carries files up to 24 MiB each. Keep a larger original in the native capture.');
      need(file.size<=OPERATING_FILE_MAX_BYTES,'The original Operating Plan file limit is '+OPERATING_FILE_MAX_BYTES+' bytes. Larger evidence belongs in the native capture archive.');
      const bytes=new Uint8Array(await file.arrayBuffer()),output=createOperatingFile({id:'file-'+crypto.randomUUID(),name:file.name,mediaType:file.type,bytes});
      entry.draft=addOperatingFile(entry.draft,step.id,output);await persist();render();
    }));
    for(const file of step.files||[]){
      const row=node('div',{class:'file-row'},text('strong',file.name),text('p',file.bytes+' bytes · '+file.mediaType+' · '+file.id,'small'));
      row.append(field('File note',file.note,v=>file.note=v,{area:true}),
        actions(button('Download complete file',async()=>downloadBlob(file.name,new Blob([operatingFileBytes(file)],{type:file.mediaType}))),
          button('Remove from this draft',async()=>{entry.draft=removeOperatingFile(entry.draft,step.id,file.id);await persist();render();})));
      section.append(row);
    }
    root.append(section);
  }
  root.append(actions(button('Add an operating step',async()=>{
    entry.draft=addOperatingStep(entry.draft,createOperatingStep({id:'step-'+crypto.randomUUID(),title:'Additional customer work'}));await persist();render();
  })));
}
function selectionStep(){return current().selectionStep||'sources';}
function addRecord(collection,id){
  const entry=current(),row={stepId:selectionStep(),collection,id};
  need(entry.input.records.length+entry.input.files.length<500,'The original procedure supports up to 500 selected record/file references.');
  if(!entry.input.records.some(x=>same(x,row)))entry.input.records.push(row);
}
function addFile(fileId){
  const entry=current(),row={stepId:selectionStep(),fileId};
  need(entry.input.records.length+entry.input.files.length<500,'The original procedure supports up to 500 selected record/file references.');
  if(!entry.input.files.some(x=>same(x,row)))entry.input.files.push(row);
}
async function readRecords(offset=0){
  await flush();const entry=current(),filter=entry.filter||{collection:'instances',scope:''};
  const query=new URLSearchParams({collection:filter.collection,offset:String(offset),limit:'25',order:'asc'});
  if(filter.scope)query.set('scope',filter.scope);
  const page=await read('/api/page?'+query);
  need(Array.isArray(page.rows)&&Number.isSafeInteger(page.total)&&page.offset===offset,'The original record page is incomplete.');
  state.recordPage={collection:filter.collection,scope:filter.scope,...page};state.detail=null;renderSelection();
}
function originalFiles(value){
  const seen=new Map(),queue=[value];
  while(queue.length){const item=queue.pop();if(!item||typeof item!=='object')continue;
    if(/^[a-f0-9]{64}$/.test(item.sha256||'')&&Number.isSafeInteger(item.bytes)&&(item.name||item.mime_type))seen.set(item.sha256,item);
    for(const child of Object.values(item))if(child&&typeof child==='object')queue.push(child);
  }
  return [...seen.values()];
}
async function inspectRecord(collection,id){
  const detail=await read('/api/detail?'+new URLSearchParams({collection,id}));
  need(detail.collection===collection&&detail.id===id&&detail.record,'The native detail returned another record.');
  state.detail=detail;renderSelection();
}
function renderSelection(){
  const root=$('section-selection');root.replaceChildren();const entry=current();if(!entry)return;
  if(entry.inputUnbound){root.append(text('h2','Original procedure input required'),
    text('p','This complete editable Operating Plan remains available in Plan and steps. Receive its original procedure-input.json before selecting or capturing native evidence.'),
    fileInput('Receive original procedure input','.json,application/json',bindProcedureInput));return;}
  root.append(text('h2','Select original records and files'),text('p','Each selected item remains linked to its procedure step. Capture receives its complete original dependencies and files.'));
  if(entry.bindingHistory?.length)root.append(details('Prior complete selections and catalogs',entry.bindingHistory));
  root.append(details('Reviewed workspace binding',entry.input.workspace),
    text('p','Selected revision '+entry.input.expectedRevision+' · latest connected revision '+state.context.revision));
  root.append(actions(button('Read current workspace revision',async()=>{
    const context=await read('/api/procedures/context');need(same(context.workspace,entry.input.workspace),'The current owner is a different source or workspace.');
    state.context=context;entry.input.expectedRevision=context.revision;await persist();
    $('workspace-revision').textContent='Current revision '+context.revision;renderSelection();notice('The procedure now selects the explicitly reviewed current revision.');
  })));
  root.append(field('Plaid instance ID',entry.input.instanceId,v=>entry.input.instanceId=v,{max:500}),
    select('Associate selected evidence with step',STEP_IDS,selectionStep(),v=>entry.selectionStep=v));
  const tables=state.context.tables.map(t=>typeof t==='string'?t:t.name||t.collection);
  need(tables.every(t=>Object.hasOwn(IDS,t)),'The original context returned an unsupported collection.');
  entry.filter??={collection:'instances',scope:''};
  root.append(node('div',{class:'procedure-grid'},
    select('Original collection',tables,entry.filter.collection,v=>{entry.filter.collection=v;state.recordPage=null;state.detail=null;}),
    field('Exact scope (optional)',entry.filter.scope,v=>entry.filter.scope=v,{max:8192})));
  root.append(actions(button('Read first page',()=>readRecords(0))));
  const page=state.recordPage;
  if(page){
    root.append(text('p',page.collection+' · '+page.offset+'–'+(page.offset+page.rows.length)+' of '+page.total));
    const body=node('tbody');
    for(const row of page.rows){
      const id=row.id??row[IDS[page.collection]];need(typeof id==='string'&&id,'The original row lacks its stable identity.');
      body.append(node('tr',{},node('td',{},text('span',id,'mono')),node('td',{},text('span',row.status||row.name||row.action||'')),
        node('td',{},actions(button('Inspect complete record',()=>inspectRecord(page.collection,id)),
          button('Select record',async()=>{addRecord(page.collection,id);await persist();renderSelection();}),
          ...(page.collection==='instances'?[button('Use this instance',async()=>{entry.input.instanceId=row.instance_id||id;await persist();renderSelection();})]:[])))));
    }
    root.append(node('div',{class:'procedure-scroll'},node('table',{},node('thead',{},node('tr',{},text('th','Original ID'),text('th','Native state'),text('th','Selection'))),body)));
    const previous=button('Previous page',()=>readRecords(Math.max(0,page.offset-25))),next=button('Next page',()=>readRecords(page.next_offset));
    previous.disabled=page.offset===0;next.disabled=page.next_offset===null;root.append(actions(previous,next));
  }
  if(state.detail){
    root.append(details('Complete original '+state.detail.collection+' record',state.detail.record));
    for(const file of originalFiles(state.detail.record))root.append(node('div',{class:'file-row'},text('strong',file.name||file.sha256),
      text('p',file.bytes+' bytes · '+file.sha256,'mono'),actions(button('Select original file',async()=>{addFile('file_'+file.sha256);await persist();renderSelection();}))));
  }
  root.append(actions(button('Read original portable exports',async()=>{
    const value=await read('/api/exports');need(Array.isArray(value.items),'Original exports are unavailable.');state.exports=value.items;renderSelection();
  })));
  for(const file of state.exports||[]){
    const ready=file.status==='READY';const id=file.export_id??file.id;
    const row=node('div',{class:'file-row'},text('strong','Portable export '+id),text('p','Revision '+file.revision+' · '+file.status),details('Complete native export record',file));
    if(ready&&typeof id==='string')row.append(button('Select complete portable export',async()=>{addFile('export_'+id);await persist();renderSelection();}));
    root.append(row);
  }
  root.append(text('h3','Complete procedure selection'));
  for(const kind of ['records','files']){
    for(const [index,row]of entry.input[kind].entries())root.append(node('div',{class:'file-row'},
      text('p',row.stepId+' · '+(row.collection?row.collection+' / '+row.id:row.fileId),'mono'),
      button('Remove this reference',async()=>{entry.input[kind].splice(index,1);await persist();renderSelection();})));
  }
  root.append(details('Complete selected original input',entry.input));
}


export function matchProcedureRequestView(view,expected){
  need(view&&view.request_id===expected.request_id&&same(view.request,expected),'The returned capture belongs to a different frozen request.');
  need(['COMPLETE','INCOMPLETE','RUNNING'].includes(view.state),'The original request state is unavailable.');
  return view;
}
function observedRequest(view){
  need(view&&typeof view.request_id==='string'&&view.request&&view.request.request_id===view.request_id,'Keep the complete original request identity.');
  const local=state.data.requests[view.request_id];
  if(local){need(view.kind===local.kind,'The original request kind changed.');matchProcedureRequestView(view,local.request);}
  else{
    need(view.kind==='capture'||view.kind==='import','The original request kind is unavailable.');
    if(view.kind==='capture')need(view.request.input&&view.request.plan&&view.request.catalog&&typeof view.request.savedAt==='string','The retained capture body is incomplete.');
    else need(view.request.kind==='import'&&Number.isSafeInteger(view.request.bytes)&&/^[a-f0-9]{64}$/.test(view.request.sha256),'The retained import declaration is incomplete.');
    state.data.requests[view.request_id]={request_id:view.request_id,kind:view.kind,request:copy(view.request),origin:'native-history',createdAt:new Date().toISOString(),view:null};
  }
  const retained=state.data.requests[view.request_id];
  retained.view=copy(view);retained.lastObservedAt=new Date().toISOString();retained.status=view.state;
  state.selectedRequest=view.request_id;return retained;
}
async function readRequest(id){
  await flush();try{const view=await read('/api/procedures/request?'+new URLSearchParams({request_id:id}));
    observedRequest(view);await persist();renderCapture();return view;
  }catch(error){
    const local=state.data.requests[id];
    if(local){local.error={message:error.message,code:error.code||null,status:error.status||null,observedAt:new Date().toISOString()};
      if(error.status===404)local.status='NOT_FOUND';await persist();renderCapture();}
    throw error;
  }
}
async function sendFrozen(local,continuation=false){
  await flush();need(state.data.requests[local.request_id]===local,'Use the retained original request.');
  need(local.status!=='RECOVERY_READ_REQUIRED','Read the original native request after restoring this browser journal before sending anything.');
  if(continuation)need(local.status==='INCOMPLETE'&&local.view?.state==='INCOMPLETE','Inspect this original incomplete request before continuing it.');
  let options,path;
  if(local.kind==='capture'){
    path='/api/procedures/capture'+(continuation?'?continue=1':'');
    options={method:'POST',body:copy(local.request)};
  }else{
    need(local.archive instanceof Blob,'Reselect the exact original archive before continuing this import.');
    need(local.archive.size===local.request.bytes,'The retained archive differs from this original request.');
    await archiveIdentity(local.archive,local.request.sha256);
    path='/api/procedures/import'+(continuation?'?continue=1':'');
    options={method:'POST',body:local.archive,raw:true,headers:{'Content-Type':'application/gzip','X-Procedure-Request-Id':local.request_id,
      'X-Procedure-SHA256':local.request.sha256,'X-Procedure-Name':encodeURIComponent(local.request.name)}};
  }
  local.status='AWAITING_ORIGINAL_RESPONSE';local.lastSentAt=new Date().toISOString();await persist();
  try{
    const view=await(await request(path,options)).json();matchProcedureRequestView(view,local.request);observedRequest(view);
    await persist();renderCapture();notice(view.state==='COMPLETE'?'The complete original capture is received. Review it before receiving its plan.':'The original request is retained as '+view.state+'.');
    return view;
  }catch(error){
    local.error={message:error.message,code:error.code||null,status:error.status||null,observedAt:new Date().toISOString()};
    local.status='OUTCOME_NOT_CONFIRMED';await persist();renderCapture();throw error;
  }
}
async function capture(){
  const entry=current();need(entry?.plan&&!entry.inputUnbound,'Prepare a complete plan or receive its original procedure input first.');
  await savePlan();await flush();
  need(same(entry.input.workspace,state.context.workspace),'The selected plan belongs to a different native workspace.');
  const unresolved=Object.values(state.data.requests).find(r=>r.kind==='capture'&&r.request.input.id===entry.plan.id&&r.status!=='COMPLETE'&&!r.releasedForNewCapture);
  need(!unresolved,'Read the saved original request '+(unresolved?.request_id||'')+' before creating another capture for this plan.');
  const request_id=crypto.randomUUID(),body={request_id,input:copy(entry.input),catalog:copy(entry.catalog||state.context.catalog),plan:copy(entry.plan),savedAt:new Date().toISOString()};
  const local={request_id,kind:'capture',request:body,origin:'this-browser',createdAt:body.savedAt,status:'PREPARED',view:null};
  state.data.requests[request_id]=local;state.selectedRequest=request_id;await persist();
  await sendFrozen(local);
}
async function readCaptureList(offset=0){
  const page=await read('/api/procedures/list?'+new URLSearchParams({offset:String(offset),limit:'25'}));
  need(Array.isArray(page.items)&&page.offset===offset&&Number.isSafeInteger(page.total),'The complete saved-request page is unavailable.');
  state.capturePage=page;renderCapture();
}
function renderCapture(){
  const root=$('section-capture');root.replaceChildren();const entry=current();if(!entry)return;
  if(entry.inputUnbound)root.append(text('p','This editable plan needs its original procedure input before another native capture. Saved requests remain available below.','procedure-banner'),
    fileInput('Receive original procedure input','.json,application/json',bindProcedureInput));
  entry.input.stepResults??=[];
  root.append(text('h2','Capture the customer operation'),text('p','Capture reads the selected original workspace and complete evidence. Native actions and dispatch stay in Device events and reporting.'));
  const assessment=node('details',{},node('summary',{text:'Record operator assessments for the nine procedure steps'}));
  for(const stepId of STEP_IDS){
    const found=entry.input.stepResults.find(x=>x.stepId===stepId),box=node('section',{class:'file-row'});
    const check=node('input',{type:'checkbox',checked:!!found});
    check.addEventListener('change',()=>run(async()=>{
      if(check.checked)entry.input.stepResults.push({stepId,status:'planned',note:''});
      else entry.input.stepResults=entry.input.stepResults.filter(x=>x.stepId!==stepId);
      await persist();renderCapture();
    }));
    box.append(node('label',{class:'inline-check'},check,text('span','Include assessment: '+stepId)));
    if(found)box.append(select('Operator status',STEP_STATES,found.status,v=>found.status=v),field('Assessment and evidence note',found.note,v=>found.note=v,{area:true,max:12000}));
    assessment.append(box);
  }
  root.append(assessment,actions(button('Capture selected original history',capture),button('Read saved requests',()=>readCaptureList(0))));
  const rows=Object.values(state.data.requests);
  if(rows.length)root.append(select('Requests retained in this browser',rows.map(r=>[r.request_id,r.kind+' · '+r.status+' · '+r.request_id]),
    state.selectedRequest||rows.at(-1).request_id,value=>state.selectedRequest=value));
  const local=state.data.requests[state.selectedRequest];
  if(local){
    root.append(text('h3','Original request '+local.request_id),text('p',local.kind+' · '+local.status),
      details('Frozen original request',local.request),details('Complete native response and attempt history',local.view||local.error||{status:local.status}));
    root.append(actions(button('Read this original outcome',()=>readRequest(local.request_id))));
    if(['PREPARED','NOT_FOUND'].includes(local.status))root.append(button('Send this saved original request',()=>sendFrozen(local)));
    if(local.status==='INCOMPLETE'&&local.view?.state==='INCOMPLETE')root.append(actions(
      button('Continue the same incomplete request',()=>sendFrozen(local,true)),
      button('Keep this incomplete attempt and allow a new capture',async()=>{local.releasedForNewCapture=true;await persist();renderCapture();notice('The complete incomplete attempt remains in saved history. A separate reviewed capture can now be prepared.');})));
    if(local.kind==='import'&&!(local.archive instanceof Blob))root.append(fileInput('Reselect the same complete archive','.gz,application/gzip',async file=>{
      need(file.size===local.request.bytes&&file.name===local.request.name,
        'The reselected file differs from the original import declaration.');
      await archiveIdentity(file,local.request.sha256);
      local.archive=file;await persist();renderCapture();
    }));
    if(local.status==='COMPLETE'&&local.view?.state==='COMPLETE'){
      const result=local.view.result;need(result?.plan&&result?.capture&&result?.input,'The completed request is missing its original result.');
      root.append(details('Captured source workspace',result.input.workspace),details('Complete capture and member identities',result.capture));
      root.append(actions(button('Review captured plan for receiving',async()=>{
        state.data.incoming={plan:inspectOperatingPlan(result.plan),input:copy(result.input),catalog:copy(result.catalog),request_id:local.request_id,
          sourceWorkspace:copy(result.input.workspace),from:'complete-capture'};await persist();state.section='receive';render();
      }),button('Download complete capture archive',()=>downloadOriginal('/api/procedures/archive?'+new URLSearchParams({request_id:local.request_id}),
        'GridFabric_'+local.request_id+'.gridprocedure.jsonl.gz',null,true))));
      if(typeof window.showSaveFilePicker==='function')root.append(button('Save archive directly to a file',()=>downloadOriginal(
        '/api/procedures/archive?'+new URLSearchParams({request_id:local.request_id}),
        'GridFabric_'+local.request_id+'.gridprocedure.jsonl.gz',null,true,true)));
      root.append(text('p','Verified browser downloads use at most 64 MiB. Direct file saving streams larger archives and reports the sender’s SHA-256; the native reader verifies complete contents when reopened.','small'));
      root.append(button('Download complete capture manifest',()=>downloadOriginal('/api/procedures/file?'+new URLSearchParams({request_id:local.request_id,path:'capture.json'}),
        'capture.json',result.receipt)));
      const members=node('details',{},node('summary',{text:'Download any complete capture member'}));
      for(const member of result.capture.members||[])members.append(node('div',{class:'file-row'},
        text('p',member.path+' · '+member.bytes+' bytes','mono'),button('Download member',()=>downloadOriginal('/api/procedures/file?'+new URLSearchParams({request_id:local.request_id,path:member.path}),
          member.path.split('/').at(-1),member))));
      root.append(members);
    }
  }
  const page=state.capturePage;
  if(page){
    root.append(text('h3','Native saved requests'),text('p','Rows '+page.offset+'–'+(page.offset+page.items.length)+' of '+page.total));
    for(const row of page.items)root.append(node('div',{class:'file-row'},
      text('strong',row.title||row.result?.title||'Original customer capture'),
      text('p',row.request_id+' · '+row.state+' · '+row.kind,'mono'),
      text('p',row.validation||'Open this request to validate its complete original capture.','small'),
      button('Open complete native request',()=>readRequest(row.request_id))));
    const previous=button('Previous request page',()=>readCaptureList(Math.max(0,page.offset-25))),next=button('Next request page',()=>readCaptureList(page.next_offset));
    previous.disabled=page.offset===0;next.disabled=page.next_offset===null;root.append(actions(previous,next));
  }
}
async function downloadOriginal(path,name,expected=null,requireHeaders=false,stream=false){
  // Reserve the picker in this direct click call, before fetch or any other wait.
  const destination=stream?await window.showSaveFilePicker({suggestedName:name}):null;
  const control=stream?new window.AbortController():null;
  let reader=null,output=null,response=null,committed=false,received=0,leaving=false;
  const abandon=()=>{
    leaving=true;control?.abort();
    reader?.cancel().catch(()=>{});output?.abort().catch(()=>{});
  };
  if(stream)window.addEventListener('pagehide',abandon);
  try{
    response=await request(path,{signal:control?.signal});
    const declared=response.headers.get('X-Content-SHA256'),length=response.headers.get('Content-Length');
    const count=length===null?null:Number(length);
    if(requireHeaders||stream)need(/^[0-9a-f]{64}$/.test(declared||'')&&count!==null&&Number.isSafeInteger(count)&&count>=0,
      'The original archive has no complete byte/hash declaration.');
    if(count!==null)need(Number.isSafeInteger(count)&&count>=0,'The original byte count is invalid.');
    if(expected?.sha256&&declared)need(declared===expected.sha256,'The sender identity differs from the selected capture member.');
    if(expected?.bytes!==undefined&&count!==null)need(count===expected.bytes,'The sender length differs from the capture member.');
    if(!stream&&count!==null&&count>BROWSER_HASH_MAX_BYTES){
      throw Error('This complete file exceeds the 64 MiB verified browser buffer. Use Save archive directly to a file, or the original native procedure archive command. The saved request and full native archive remain unchanged.');
    }
    need(response.body?.getReader,'This browser cannot receive the original byte stream.');
    reader=response.body.getReader();
    if(stream)output=await destination.createWritable();
    const chunks=[];
    while(true){
      const {done,value}=await reader.read();if(done)break;
      received+=value.byteLength;
      need(!leaving,'The file save was interrupted before completion.');
      need(count===null||received<=count,'The original stream exceeds its declared length.');
      if(stream)await output.write(value);
      else{
        need(received<=BROWSER_HASH_MAX_BYTES,'The original file exceeds the 64 MiB verified browser buffer. Its saved native request remains available for direct file saving.');
        chunks.push(value);
      }
    }
    need(count===null||received===count,'The original file download ended before its declared length.');
    if(expected?.bytes!==undefined)need(received===expected.bytes,'The downloaded member length differs from its capture identity.');
    if(stream){
      need(!leaving,'The file save was interrupted before completion.');
      await output.close();committed=true;
      notice('Saved '+name+' · '+received+' bytes · sender SHA-256 '+declared+'. Reopen with the original native reader to verify complete archive contents.');
    }else{
      const bytes=new Uint8Array(received);let offset=0;
      for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      const hash=await sha256(bytes);
      if(declared)need(hash===declared,'The downloaded complete file differs from its original SHA-256.');
      if(expected?.sha256)need(hash===expected.sha256,'The downloaded member differs from its capture identity.');
      downloadBlob(name,new Blob([bytes],{type:response.headers.get('Content-Type')||'application/octet-stream'}));
      notice('Received '+name+' · '+received+' bytes · verified SHA-256 '+hash);
    }
  }finally{
    if(stream)window.removeEventListener('pagehide',abandon);
    if(!committed&&control)control.abort();
    if(!committed&&output)try{await output.abort();}catch{}
    if(!reader&&response?.body)try{await response.body.cancel();}catch{}
    if(reader){try{await reader.cancel();}catch{}try{reader.releaseLock();}catch{}}
  }
}

async function archiveIdentity(file,senderHash=''){
  need(Number.isSafeInteger(file.size)&&file.size>=0&&file.size<=ARCHIVE_MAX_BYTES,'The original native archive limit is 4 GiB compressed.');
  const supplied=String(senderHash).trim().toLowerCase();
  if(file.size>BROWSER_HASH_MAX_BYTES){
    need(/^[0-9a-f]{64}$/.test(supplied),
      'For an archive above 64 MiB, enter its complete original SHA-256 from the saved archive identity. The browser streams the retained file; the native importer verifies every byte before receiving it.');
    return {sha256:supplied,verification:'sender-declared; native full-byte verification required'};
  }
  let raw;
  try{raw=await file.arrayBuffer();}catch(error){
    throw Error('The browser could not read this file into its bounded verification buffer. Keep the original file and saved request; use: '+NATIVE_ARCHIVE_RECEIVE+'. '+error.message);
  }
  const hash=await sha256(raw);
  if(supplied)need(hash===supplied,'The selected archive differs from the original SHA-256.');
  return {sha256:hash,verification:'browser full-byte SHA-256'};
}

export function receivePlanWithoutDiscardingDraft(incoming,existing){
  const plan=inspectOperatingPlan(incoming);
  if(existing)need(!dirty(existing),'Save or download the current edited draft before receiving another history. The incoming plan remains retained.');
  return receiveOperatingPlan(plan,existing?.plan??null);
}
async function stagePlan(file){
  const incoming=inspectOperatingPlan(JSON.parse(await file.text()));
  state.data.incoming={plan:incoming,input:null,catalog:null,request_id:null,from:'editable-plan-file',filename:file.name};
  await persist();renderReceive();notice('The complete returned history is retained for review.');
}
async function receiveIncoming(asCopy=false){
  const incoming=state.data.incoming;need(incoming?.plan,'Receive a complete plan first.');
  let plan=inspectOperatingPlan(incoming.plan),id=plan.id;
  if(incoming.input)need(incoming.input.id===plan.id,'The received input belongs to another plan ID.');
  if(asCopy){
    const chosen=$('receive-copy-id')?.value.trim();need(chosen,'Enter a distinct ID for this received copy.');
    need(!state.data.plans[chosen],'This local plan ID already exists.');
    plan=forkOperatingPlan(plan,{id:chosen,title:plan.revisions.at(-1).title});id=chosen;
  }
  const existing=state.data.plans[id],received=receivePlanWithoutDiscardingDraft(plan,existing);
  if(existing){
    if(incoming.input&&(received.addedRevisions>0||same(plan,received.plan))){
      need(incoming.input.id===incoming.plan.id,'The received input belongs to another plan ID.');
      const nextInput={...copy(incoming.input),id},nextCatalog=incoming.catalog?copy(incoming.catalog):null;
      if(!same(existing.input,nextInput)||!same(existing.catalog??null,nextCatalog)){
        existing.bindingHistory??=[];
        existing.bindingHistory.push({receivedAt:new Date().toISOString(),request_id:incoming.request_id??null,
          input:copy(existing.input),catalog:copy(existing.catalog??null),inputUnbound:!!existing.inputUnbound,
          planRevision:existing.plan.revisions.length});
      }
      existing.input=nextInput;existing.catalog=nextCatalog;existing.inputUnbound=false;
    }
    existing.plan=received.plan;existing.draft=operatingPlanDraft(received.plan);existing.argvText={};
  }
  else{
    const input=incoming.input?{...copy(incoming.input),id}:{id,...copy(operatingPlanDraft(received.plan).content)};
    state.data.plans[id]={input,plan:received.plan,draft:operatingPlanDraft(received.plan),catalog:incoming.catalog?copy(incoming.catalog):null,inputUnbound:!incoming.input};
  }
  state.data.current=id;await persist();state.section='plan';render();notice('Received '+received.addedRevisions+' complete revisions; the existing history is retained.');
}
async function importArchive(file){
  await flush();state.selectedImport=file;
  const identity=await archiveIdentity(file,state.data.archiveImportSha256||''),id=crypto.randomUUID();
  const declaration={request_id:id,kind:'import',name:file.name,bytes:file.size,sha256:identity.sha256};
  const retained={request_id:id,kind:'import',request:declaration,archive:file,status:'PREPARED',view:null,origin:'this-browser',createdAt:new Date().toISOString(),browserVerification:identity.verification};
  state.data.requests[id]=retained;state.selectedRequest=id;
  await persist();state.section='capture';render();await sendFrozen(retained);
}
async function bindProcedureInput(file){
  await flush();const entry=current(),input=JSON.parse(await file.text());
  need(input.id===entry.plan.id,'The original procedure input belongs to another plan ID.');
  const prepared=await(await request('/api/procedures/prepare',{method:'POST',body:{input}})).json();
  need(prepared.input.id===entry.plan.id,'The original input validator returned a different plan.');
  entry.input=copy(prepared.input);entry.catalog=copy(prepared.catalog);entry.inputUnbound=false;await persist();render();
}
function renderReceive(){
  const root=$('section-receive');root.replaceChildren();
  root.append(text('h2','Receive a complete customer procedure'),
    text('p','Reopen the full capture archive to inspect its original workspace, records, files and plan. Receive the editable plan to continue its complete history and return another saved revision.'),
    field('Original archive SHA-256 (required above 64 MiB)',state.data.archiveImportSha256||'',value=>state.data.archiveImportSha256=value,{max:64,wide:true}),
    text('p','Archives up to 64 MiB are also hashed in this browser. Larger files, up to the native 4 GiB compressed limit, stream from the retained File with the entered sender hash. The complete declaration, UUID and File save before sending; the native importer verifies all bytes. If browser storage is full, keep the original file and use the native procedure archive receive command.'),
    details('Native archive commands',{archive:'starforge gridfabric-procedure archive --directory CAPTURE_DIRECTORY --out NEW_ARCHIVE_GZ',
      receive:NATIVE_ARCHIVE_RECEIVE,receiving:'Choose a new destination directory. Complete native verification defaults to 16 GiB expanded; the original owner may set the explicit limit.'}),
    fileInput('Reopen complete capture archive','.gridprocedure.jsonl.gz,.gz,application/gzip',importArchive),
    fileInput('Receive complete editable Operating Plan','.json,application/json',stagePlan));
  const incoming=state.data.incoming;
  if(incoming){
    root.append(text('h3','Received plan '+incoming.plan.id),
      details('Full incoming history',incoming.plan),
      details('Retained source identity',incoming.input?.workspace??{note:'This editable plan does not carry the original separate procedure-input.json. Its own complete steps and source registrations are retained.'}));
    const existing=state.data.plans[incoming.plan.id];
    root.append(text('p',existing?'A local plan with this ID has '+existing.plan?.revisions.length+' saved revisions. Shared revisions must match exactly.':'This plan is new to this browser.'));
    if(existing?.plan)root.append(details('Current local history',existing.plan),
      details('Current complete selection and catalog',{input:existing.input,catalog:existing.catalog??null}));
    if(incoming.input)root.append(details('Incoming complete selection and catalog',{input:incoming.input,catalog:incoming.catalog??null}),
      text('p','Receiving an equal or newer compatible history also adopts its complete selection. An older history keeps the current selection. Prior selections remain in this browser’s complete history.'));
    root.append(actions(button(incoming.input?'Receive compatible history and its bound selection':'Receive compatible plan history',()=>receiveIncoming())));
    const copyField=node('label',{},text('span','Distinct ID for a separate received copy'),node('input',{id:'receive-copy-id',type:'text',maxLength:128,value:incoming.plan.id+'-copy'}));
    root.append(copyField,actions(button('Receive as a separate original-model copy',()=>receiveIncoming(true)),
      button('Download original incoming plan',async()=>jsonDownload(incoming.plan.id+'-received.json',incoming.plan))));
  }
  renderBrowserRecovery(root);
}
$('connection-form').addEventListener('submit',event=>{
  event.preventDefault();run(async()=>{state.token=$('connection-token').value.trim();sessionStorage.setItem('gridfabric-connection',state.token);await connect();});
});
for(const b of document.querySelectorAll('[data-section]'))b.addEventListener('click',()=>run(async()=>{await flush();changeView(b.dataset.section);}));
$('storage-retry').addEventListener('click',()=>run(async()=>{await persist();notice('The same complete entered work is saved.');}));
$('storage-export').addEventListener('click',()=>run(async()=>jsonDownload('GridFabric_Procedure_Unsaved_Work.json',await browserBundle())));
window.addEventListener('beforeunload',event=>{if(state.storageError||state.savedSequence!==state.sequence){event.preventDefault();event.returnValue='';}});
run(connect);
