// MIT. Workspace-bound browser requests retain exact arguments and complete original Files.
import { Sha256 } from './sha256.mjs';
const DATABASE='principal-operations-browser',VERSION=2;
const encode=new TextEncoder();
let opened;
function problem(code,message){return Object.assign(new Error(message),{code});}
function ordinary(value){
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'){if(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value))throw problem('ARGUMENT_NUMBER_UNSAFE','Use an exact decimal string for this value.');return value;}
 if(Array.isArray(value))return value.map(ordinary);
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordinary(value[key])]));
 throw problem('ARGUMENT_TYPE_INVALID','Request arguments must contain JSON values.');
}
export function canonical(value){return JSON.stringify(ordinary(value));}
export function textHash(text){return new Sha256().update(encode.encode(text)).digest();}
export async function fileHash(file,onProgress){
 if(!(file instanceof Blob))throw problem('ORIGINAL_FILE_REQUIRED','Select the complete original file.');
 const hash=new Sha256(),size=1024*1024;
 for(let offset=0;offset<file.size;offset+=size){hash.update(new Uint8Array(await file.slice(offset,offset+size).arrayBuffer()));onProgress?.(Math.min(file.size,offset+size),file.size);}
 return hash.digest();
}
function database(){
 if(!opened)opened=new Promise((resolve,reject)=>{
  if(!globalThis.indexedDB){reject(problem('JOURNAL_UNAVAILABLE','This browser cannot retain operation requests. Enable local browser storage before making changes.'));return;}
  const request=indexedDB.open(DATABASE,VERSION);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('requests')){const rows=db.createObjectStore('requests',{keyPath:'id'});rows.createIndex('workspaceId','workspaceId',{unique:false});}if(!db.objectStoreNames.contains('views'))db.createObjectStore('views',{keyPath:'workspaceId'});if(!db.objectStoreNames.contains('restores')){const restores=db.createObjectStore('restores',{keyPath:'id'});restores.createIndex('workspaceId','workspaceId',{unique:false});}};
  request.onerror=()=>reject(problem('JOURNAL_UNAVAILABLE','The request journal could not be opened: '+(request.error?.message??'')));
  request.onblocked=()=>reject(problem('JOURNAL_BLOCKED','Close older Principal tabs so browser storage can finish opening.'));
  request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opened=null;};resolve(db);};
 }).catch(error=>{opened=null;throw error;});
 return opened;
}
async function transaction(stores,mode,work){
 const db=await database();return new Promise((resolve,reject)=>{
  const tx=db.transaction(stores,mode);let output,failure=null;
  const abort=error=>{failure=error;try{tx.abort();}catch{reject(error);}};
  tx.oncomplete=()=>resolve(output);tx.onabort=()=>reject(failure??problem('JOURNAL_WRITE_FAILED','The browser could not retain this request. No new request may be sent until storage is available.'));
  tx.onerror=()=>{};try{work(tx,value=>{output=value;},abort);}catch(error){abort(error);}
 });
}
export async function getRequest(id){return transaction(['requests'],'readonly',(tx,result)=>{const r=tx.objectStore('requests').get(id);r.onsuccess=()=>result(r.result??null);});}
export async function listRequests(workspaceId){return transaction(['requests'],'readonly',(tx,result)=>{const r=tx.objectStore('requests').index('workspaceId').getAll(workspaceId);r.onsuccess=()=>result(r.result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));});}
export async function putRequest(record){
 if(!record?.id||!record.workspaceId)throw problem('REQUEST_ID_REQUIRED','The retained request identity is missing.');
 return transaction(['requests'],'readwrite',(tx,result)=>{tx.objectStore('requests').put(record);result(record);});
}
export async function prepareRequest({workspaceId,revision,kind='command',method,args={},file=null,manifestSha256=null,label=null}){
 if(!workspaceId)throw problem('WORKSPACE_REQUIRED','Open a workspace before preparing an operation.');
 canonical(args);const id=crypto.randomUUID(),createdAt=new Date().toISOString();
 const source=file?{name:file.name??'source.bin',type:file.type,size:file.size,lastModified:file.lastModified??null,sha256:await fileHash(file)}:null;
 const request={requestId:id,expectedRevision:revision,method,args};
 const intent={workspaceId,kind,method,args,source,manifestSha256};
 const record={id,workspaceId,kind,method,args,request,source,file,manifestSha256,label:label??method,status:'PENDING',intentSha256:textHash(canonical(intent)),createdAt,updatedAt:createdAt,attempts:[],response:null,error:null,appliedAt:null};
 await putRequest(record);return record;
}
export async function verifyRequest(record,workspaceId){
 if(record.workspaceId!==workspaceId)throw problem('WORKSPACE_CHANGED','This request belongs to a different workspace. Open its original workspace to continue.');
 const intent={workspaceId:record.workspaceId,kind:record.kind,method:record.method,args:record.args,source:record.source,manifestSha256:record.manifestSha256};
 if(textHash(canonical(intent))!==record.intentSha256||record.request.requestId!==record.id||canonical(record.request.args)!==canonical(record.args)||record.request.method!==record.method)throw problem('REQUEST_CHANGED','The retained request body no longer matches its original identity.');
 if(record.source){if(!(record.file instanceof Blob)||record.file.size!==record.source.size||await fileHash(record.file)!==record.source.sha256)throw problem('RETAINED_FILE_CHANGED','The retained original file could not be verified. The request was not sent.');}
 return record;
}
export async function beginAttempt(record,workspaceId){
 await verifyRequest(record,workspaceId);const attempt={number:record.attempts.length+1,startedAt:new Date().toISOString(),expectedRevision:record.request.expectedRevision};
 const next={...record,status:'RUNNING',error:null,updatedAt:attempt.startedAt,attempts:[...record.attempts,attempt]};await putRequest(next);return next;
}
export async function finishAttempt(record,{response=null,error=null,status}){
 const completedAt=new Date().toISOString(),attempts=record.attempts.map((item,index)=>index===record.attempts.length-1?{...item,completedAt,status,error:error?{code:error.code,message:error.message,status:error.status}:null}:item);
 const next={...record,attempts,updatedAt:completedAt,status,response,error:error?{code:error.code??'REQUEST_FAILED',message:error.message,status:error.status??null,details:error.details??null}:null};await putRequest(next);return next;
}
export async function rebaseRequest(record,revision){
 if(record.status!=='REJECTED'||record.error?.code!=='REVISION_CONFLICT')throw problem('REQUEST_REBASE_NOT_AVAILABLE','Only an explicit workspace revision conflict can refresh the retained revision.');
 if(!Number.isSafeInteger(revision)||revision<0)throw problem('REVISION_REQUIRED','The current workspace revision is unavailable.');
 const next={...record,request:{...record.request,expectedRevision:revision},status:'PENDING',error:null,updatedAt:new Date().toISOString(),revisionHistory:[...(record.revisionHistory??[]),{from:record.request.expectedRevision,to:revision,reason:'REVISION_CONFLICT',at:new Date().toISOString()}]};await putRequest(next);return next;
}
export async function getView(workspaceId){return transaction(['views'],'readonly',(tx,result)=>{const r=tx.objectStore('views').get(workspaceId);r.onsuccess=()=>result(r.result?.value??{});});}
export async function saveView(workspaceId,value){return transaction(['views'],'readwrite',(tx,result)=>{tx.objectStore('views').put({workspaceId,value,updatedAt:new Date().toISOString()});result(value);});}
export async function markApplied(record,view){
 const updated={...record,appliedAt:new Date().toISOString()};return transaction(['requests','views'],'readwrite',(tx,result)=>{tx.objectStore('requests').put(updated);tx.objectStore('views').put({workspaceId:record.workspaceId,value:view,updatedAt:updated.appliedAt});result(updated);});
}
export async function initializeJournal(workspaceId){await database();return {requests:await listRequests(workspaceId),view:await getView(workspaceId)};}


// Complete browser working copies include original Files and optional undefined
// metadata fields. They contain private source data, never the operator token.
export const WORKING_COPY_SCHEMA='principal.browser-working-copy.v1';
const workingNeed=(condition,code,message)=>{if(!condition)throw problem(code,message);};
const plainObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
function metadataValue(value){
 const undefinedPaths=[],active=new Set();
 function visit(item,path){
  if(item===undefined){undefinedPaths.push(path);return null;}
  if(item===null||typeof item==='string'||typeof item==='boolean')return item;
  if(typeof item==='number'){workingNeed(Number.isFinite(item),'WORKING_COPY_VALUE_INVALID','Retain finite original metadata numbers.');return item;}
  workingNeed(Array.isArray(item)||plainObject(item),'WORKING_COPY_VALUE_INVALID','Retain only original JSON metadata and selected Files.');
  workingNeed(!active.has(item),'WORKING_COPY_VALUE_INVALID','The original metadata must not contain cycles.');active.add(item);
  const result=Array.isArray(item)?item.map((child,index)=>visit(child,[...path,String(index)])):
   Object.fromEntries(Object.keys(item).sort().map(key=>[key,visit(item[key],[...path,key])]));
  active.delete(item);return result;
 }
 return{value:visit(value,[]),undefinedPaths};
}
function readMetadata(encoded){
 workingNeed(plainObject(encoded)&&Object.keys(encoded).length===2&&Object.hasOwn(encoded,'value')&&Array.isArray(encoded.undefinedPaths),
  'WORKING_COPY_METADATA_INVALID','Keep the complete original metadata representation.');
 const selected=JSON.parse(JSON.stringify(encoded.value)),seen=new Set();
 for(const path of encoded.undefinedPaths){
  workingNeed(Array.isArray(path)&&path.length>0&&path.every(k=>typeof k==='string'),'WORKING_COPY_METADATA_INVALID','Retain exact optional-field paths.');
  const identity=JSON.stringify(path);workingNeed(!seen.has(identity),'WORKING_COPY_METADATA_INVALID','An optional field was repeated.');seen.add(identity);
  let parent=selected;
  for(const key of path.slice(0,-1)){
   workingNeed(parent!==null&&typeof parent==='object'&&Object.hasOwn(parent,key),'WORKING_COPY_METADATA_INVALID','An optional-field parent is missing.');
   parent=parent[key];
  }
  const key=path.at(-1);workingNeed(parent!==null&&typeof parent==='object'&&Object.hasOwn(parent,key)&&parent[key]===null,
   'WORKING_COPY_METADATA_INVALID','An optional-field value changed.');
  Object.defineProperty(parent,key,{value:undefined,writable:true,enumerable:true,configurable:true});
 }
 workingNeed(JSON.stringify(metadataValue(selected))===JSON.stringify(encoded),'WORKING_COPY_METADATA_INVALID','Metadata must retain its exact canonical field and optional-field ordering.');
 return selected;
}
function metadataHash(value){return textHash(JSON.stringify(metadataValue(value)));}
function workingCanonical(value){const encoded=metadataValue(value);workingNeed(encoded.undefinedPaths.length===0,'WORKING_COPY_VALUE_INVALID','Keep the complete portable envelope in JSON.');return JSON.stringify(encoded.value);}
function bytesBase64(bytes){
 let result='';const chunk=3*8192;
 for(let start=0;start<bytes.length;start+=chunk){
  let binary='';for(const byte of bytes.subarray(start,start+chunk))binary+=String.fromCharCode(byte);
  result+=btoa(binary);
 }
 return result;
}
function base64Bytes(value){
 workingNeed(typeof value==='string'&&value.length%4===0,'WORKING_COPY_FILE_INVALID','Retain complete canonical base64 source bytes.');
 const padding=value.endsWith('==')?2:value.endsWith('=')?1:0,alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
 for(let i=0;i<value.length-padding;i++)workingNeed(alphabet.includes(value[i]),'WORKING_COPY_FILE_INVALID','Retain complete canonical base64 source bytes.');
 let binary;try{binary=atob(value);}catch{throw problem('WORKING_COPY_FILE_INVALID','The complete source file cannot be decoded.');}
 const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 workingNeed(bytesBase64(bytes)===value,'WORKING_COPY_FILE_INVALID','The source byte encoding changed.');return bytes;
}
async function wireRequest(record,workspaceId){
 await validateWorkingRequest(record,workspaceId);
 const {file,...metadata}=record;let originalFile=null;
 if(file){
  const bytes=new Uint8Array(await file.arrayBuffer());
  originalFile={encoding:'base64',bytes:bytes.length,sha256:new Sha256().update(bytes).digest(),data:bytesBase64(bytes)};
  workingNeed(originalFile.bytes===record.source.size&&originalFile.sha256===record.source.sha256,
   'RETAINED_FILE_CHANGED','The complete retained file changed during export.');
 }
 return{id:record.id,intentSha256:record.intentSha256,metadata:metadataValue(metadata),originalFile};
}
async function validateWorkingRequest(record,workspaceId){
 workingNeed(plainObject(record)&&typeof record.id==='string'&&record.id.length>0&&record.workspaceId===workspaceId,
  'WORKING_COPY_REQUEST_INVALID','Each original request must belong to the selected workspace.');
 workingNeed(['command','upload','file-upload','unpack'].includes(record.kind)&&typeof record.method==='string'&&
  ['PENDING','RUNNING','UNCERTAIN','REJECTED','COMPLETE'].includes(record.status)&&Array.isArray(record.attempts)&&
  plainObject(record.request)&&Number.isSafeInteger(record.request.expectedRevision)&&record.request.expectedRevision>=0,
  'WORKING_COPY_REQUEST_INVALID','Retain the complete original request state and revision.');
 workingNeed(record.source===null?record.file===null:plainObject(record.source)&&record.file instanceof Blob,
  'WORKING_COPY_FILE_INVALID','Each selected original file needs its complete source receipt and bytes.');
 if(record.source)workingNeed(typeof record.source.name==='string'&&typeof record.source.type==='string'&&
  Number.isSafeInteger(record.source.size)&&record.source.size>=0&&/^[a-f0-9]{64}$/.test(record.source.sha256)&&
  (record.source.lastModified===null||Number.isFinite(record.source.lastModified)),
  'WORKING_COPY_FILE_INVALID','Retain the complete original file identity.');
 for(let i=0;i<record.attempts.length;i++)workingNeed(plainObject(record.attempts[i])&&record.attempts[i].number===i+1,
  'WORKING_COPY_REQUEST_INVALID','Retain every original attempt in its original order.');
 await verifyRequest(record,workspaceId);
 if(record.status==='COMPLETE')workingNeed(record.response!==null&&typeof record.response==='object'&&
  (record.kind==='unpack'||record.response.requestId===record.id&&record.response.workspaceId===workspaceId),
  'WORKING_COPY_RESPONSE_INVALID','A completed original response must match its retained request and workspace.');
 return record;
}
async function readWireRequest(wire,workspaceId){
 workingNeed(plainObject(wire)&&Object.keys(wire).length===4&&typeof wire.id==='string'&&typeof wire.intentSha256==='string',
  'WORKING_COPY_REQUEST_INVALID','Retain each complete encoded original request.');
 const record=readMetadata(wire.metadata);workingNeed(plainObject(record)&&!Object.hasOwn(record,'file')&&record.id===wire.id&&record.intentSha256===wire.intentSha256,
  'WORKING_COPY_REQUEST_INVALID','The original request identity changed.');
 record.file=null;
 if(wire.originalFile!==null){
  const f=wire.originalFile;
  workingNeed(plainObject(f)&&Object.keys(f).length===4&&f.encoding==='base64'&&
   Number.isSafeInteger(f.bytes)&&f.bytes>=0&&/^[a-f0-9]{64}$/.test(f.sha256)&&plainObject(record.source),
   'WORKING_COPY_FILE_INVALID','Keep the complete source file envelope.');
  const bytes=base64Bytes(f.data);
  workingNeed(bytes.length===f.bytes&&new Sha256().update(bytes).digest()===f.sha256&&
   f.bytes===record.source.size&&f.sha256===record.source.sha256,'RETAINED_FILE_CHANGED','The imported original file differs from its receipt.');
  record.file=record.source.lastModified===null?new Blob([bytes],{type:record.source.type}):
   new File([bytes],record.source.name,{type:record.source.type,lastModified:record.source.lastModified});
 }
 return validateWorkingRequest(record,workspaceId);
}
function validateRestore(row,workspaceId){
 workingNeed(plainObject(row)&&typeof row.id==='string'&&row.id.length>0&&row.workspaceId===workspaceId&&
  typeof row.restoredAt==='string'&&/^[a-f0-9]{64}$/.test(row.sourcePayloadSha256)&&
  Object.hasOwn(row,'previousView')&&plainObject(row.previousView),
  'WORKING_COPY_RESTORE_INVALID','Retain each exact prior-view recovery receipt.');
 metadataValue(row);return row;
}
async function workingSnapshot(workspaceId){
 workingNeed(typeof workspaceId==='string'&&workspaceId.length>0,'WORKSPACE_REQUIRED','Open the original workspace.');
 return transaction(['requests','views','restores'],'readonly',(tx,result)=>{
  const value={requests:null,view:null,restores:null};let remaining=3;
  function done(){if(--remaining===0)result(value);}
  const requests=tx.objectStore('requests').index('workspaceId').getAll(workspaceId);requests.onsuccess=()=>{value.requests=requests.result;done();};
  const view=tx.objectStore('views').get(workspaceId);view.onsuccess=()=>{value.view=view.result?.value??{};done();};
  const restores=tx.objectStore('restores').index('workspaceId').getAll(workspaceId);restores.onsuccess=()=>{value.restores=restores.result;done();};
 });
}

function currentIntent(record,workspaceId){
 workingNeed(record.workspaceId===workspaceId&&record.request?.requestId===record.id&&record.request.method===record.method&&
  canonical(record.request.args)===canonical(record.args)&&textHash(canonical({workspaceId:record.workspaceId,kind:record.kind,method:record.method,args:record.args,source:record.source,manifestSha256:record.manifestSha256}))===record.intentSha256,
  'REQUEST_CHANGED','Keep the current original request identity before restoring a working copy.');
 return record;
}

async function checkedWorkingCopy(packet,workspaceId){
 workingNeed(plainObject(packet)&&Object.keys(packet).length===3&&packet.schema===WORKING_COPY_SCHEMA&&
  plainObject(packet.payload)&&typeof packet.payloadSha256==='string','WORKING_COPY_SCHEMA_INVALID','Select a complete Principal browser working copy.');
 const p=packet.payload;
 workingNeed(Object.keys(p).length===5&&p.workspaceId===workspaceId&&typeof p.exportedAt==='string'&&
  Array.isArray(p.requests)&&Array.isArray(p.restores),'WORKING_COPY_WORKSPACE_MISMATCH','Open this file in its original workspace.');
 workingNeed(textHash(workingCanonical(p))===packet.payloadSha256,'WORKING_COPY_HASH_MISMATCH','The complete browser working copy changed.');
 const view=readMetadata(p.view);workingNeed(plainObject(view),'WORKING_COPY_VIEW_INVALID','Retain the full original editor view.');
 const requests=[],requestIds=new Set();
 for(const wire of p.requests){workingNeed(!requestIds.has(wire?.id),'WORKING_COPY_REQUEST_DUPLICATE','An original request is repeated.');requestIds.add(wire?.id);requests.push(await readWireRequest(wire,workspaceId));}
 const restores=[],restoreIds=new Set();for(const raw of p.restores){
  const row=validateRestore(readMetadata(raw),workspaceId);workingNeed(!restoreIds.has(row.id),'WORKING_COPY_RESTORE_DUPLICATE','A prior-view recovery receipt is repeated.');restoreIds.add(row.id);restores.push(row);
 }
 return{view,requests,restores,payloadSha256:packet.payloadSha256};
}
export async function exportWorkingCopy(workspaceId,{view:currentView}={}){
 const snapshot=await workingSnapshot(workspaceId),requests=[];
 for(const row of snapshot.requests.sort((a,b)=>a.id.localeCompare(b.id)))requests.push(await wireRequest(row,workspaceId));
 const restores=snapshot.restores.sort((a,b)=>a.id.localeCompare(b.id)).map(row=>metadataValue(validateRestore(row,workspaceId)));
 const payload={workspaceId,exportedAt:new Date().toISOString(),view:metadataValue(currentView===undefined?snapshot.view:currentView),requests,restores};
 const packet={schema:WORKING_COPY_SCHEMA,payloadSha256:textHash(workingCanonical(payload)),payload};
 await checkedWorkingCopy(packet,workspaceId);return packet;
}
export async function inspectWorkingCopy(packet,workspaceId){
 const checked=await checkedWorkingCopy(packet,workspaceId),current=await workingSnapshot(workspaceId),byId=new Map(current.requests.map(row=>[row.id,row]));
 let newRequests=0;for(const row of checked.requests){const old=byId.get(row.id);if(old){await validateWorkingRequest(old,workspaceId);workingNeed(old.intentSha256===row.intentSha256,'REQUEST_ID_CONFLICT','This request ID already has a different original intent.');}else newRequests++;}
 const restores=new Map(current.restores.map(row=>[row.id,row]));for(const row of checked.restores){const old=restores.get(row.id);workingNeed(!old||metadataHash(old)===metadataHash(row),'RESTORE_ID_CONFLICT','A prior-view recovery receipt changed.');}
 return{schema:WORKING_COPY_SCHEMA,workspaceId,payloadSha256:checked.payloadSha256,view:checked.view,
  requests:checked.requests.length,newRequests,preservedRequests:checked.requests.length-newRequests,
  files:checked.requests.filter(row=>row.source).length,bytes:checked.requests.reduce((n,row)=>n+(row.source?.size??0),0),restores:checked.restores.length};
}
export async function listWorkingCopyRestores(workspaceId){const snapshot=await workingSnapshot(workspaceId);return snapshot.restores.sort((a,b)=>b.restoredAt.localeCompare(a.restoredAt));}
export async function restoreWorkingCopy(packet,workspaceId){
 const checked=await checkedWorkingCopy(packet,workspaceId);
 // Hashing is complete before opening the transaction. The transaction itself
 // re-reads current requests and retains every existing same-intent original.
 return transaction(['requests','views','restores'],'readwrite',(tx,result,abort)=>{
  const requests=tx.objectStore('requests'),views=tx.objectStore('views'),restores=tx.objectStore('restores');
  const existing=requests.index('workspaceId').getAll(workspaceId);
  existing.onsuccess=()=>{
   try{
    const byId=new Map(existing.result.map(row=>[row.id,row]));let added=0;
    for(const row of checked.requests){const old=byId.get(row.id);if(old)currentIntent(old,workspaceId);workingNeed(!old||old.intentSha256===row.intentSha256,'REQUEST_ID_CONFLICT','This request ID already has a different original intent.');if(!old){requests.add({...row,needsExplicitRecovery:true});added++;}}
    const history=restores.index('workspaceId').getAll(workspaceId);
    history.onsuccess=()=>{
     try{
      const byRestore=new Map(history.result.map(row=>[row.id,row]));let addedRestores=0;
      for(const row of checked.restores){const old=byRestore.get(row.id);workingNeed(!old||metadataHash(old)===metadataHash(row),'RESTORE_ID_CONFLICT','A prior-view recovery receipt changed.');if(!old){restores.add(row);addedRestores++;}}
      const previous=views.get(workspaceId);previous.onsuccess=()=>{
       try{
        const restoredAt=new Date().toISOString(),restoreId=crypto.randomUUID(),previousView=previous.result?.value??{};
        const receipt={id:restoreId,workspaceId,restoredAt,sourcePayloadSha256:checked.payloadSha256,previousView};
        restores.add(validateRestore(receipt,workspaceId));
        views.put({workspaceId,value:checked.view,updatedAt:restoredAt});
        result({schema:WORKING_COPY_SCHEMA,workspaceId,payloadSha256:checked.payloadSha256,restoreId,
         addedRequests:added,preservedRequests:checked.requests.length-added,view:checked.view,restores:history.result.length+addedRestores+1});
       }catch(error){abort(error);}
      };
     }catch(error){abort(error);}
    };
   }catch(error){abort(error);}
  };
 });
}

export async function packWorkingFile(file){
 workingNeed(file instanceof Blob,'ORIGINAL_FILE_REQUIRED','Select the complete original file.');
 const bytes=new Uint8Array(await file.arrayBuffer());
 return{schema:'principal.browser-file.v1',name:file.name??'source.bin',type:file.type,lastModified:file.lastModified??null,
  bytes:bytes.length,sha256:new Sha256().update(bytes).digest(),data:bytesBase64(bytes)};
}
export async function openWorkingFile(value){
 workingNeed(plainObject(value)&&Object.keys(value).length===7&&value.schema==='principal.browser-file.v1'&&
  typeof value.name==='string'&&typeof value.type==='string'&&(value.lastModified===null||Number.isFinite(value.lastModified))&&
  Number.isSafeInteger(value.bytes)&&value.bytes>=0&&/^[a-f0-9]{64}$/.test(value.sha256),
  'WORKING_COPY_FILE_INVALID','Retain the complete selected-file identity.');
 const bytes=base64Bytes(value.data);
 workingNeed(bytes.length===value.bytes&&new Sha256().update(bytes).digest()===value.sha256,
  'RETAINED_FILE_CHANGED','The original selected file changed.');
 return value.lastModified===null?new Blob([bytes],{type:value.type}):new File([bytes],value.name,{type:value.type,lastModified:value.lastModified});
}
