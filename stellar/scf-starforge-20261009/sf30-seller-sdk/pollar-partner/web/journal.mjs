// MIT. One durable browser journal for host requests and original SDK checkpoints.
import {Sha256} from '/source-sha256.mjs';
const DATABASE='stellar-pollar-partner',VERSION=1,STORES=['requests','sdk','views'];
const clone=value=>structuredClone(value);
export const id=()=>crypto.randomUUID();
export const now=()=>new Date().toISOString();
export function canonical(value){
 if(value===null)return 'null';if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 return JSON.stringify(value);
}
export async function sha256(value){
 const bytes=value instanceof Uint8Array?value:new TextEncoder().encode(typeof value==='string'?value:canonical(value));
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function fileSha256(file){
 const hash=new Sha256(),reader=file.stream().getReader();
 try{while(true){const value=await reader.read();if(value.done)break;hash.update(value.value);}return hash.digest();}
 finally{reader.releaseLock();}
}
function requestIdentity({method,args,route,headers,metadata,fileSelection}){
 const input=clone(args??{});delete input.expectedRevision;
 return {method,args:input,route,headers,metadata,fileSelection:fileSelection??null};
}
export function errorValue(error){return {code:error?.code??error?.name??'REQUEST_FAILED',message:String(error?.message??error),status:error?.status??null};}
function failure(code,message){return Object.assign(new Error(message),{code});}
export async function requestJSON(route,{method='GET',body,headers={},signal,binary=false}={}){
 const response=await fetch(route,{method,credentials:'same-origin',cache:'no-store',headers:{...(body!==undefined&&!(body instanceof Blob)?{'Content-Type':'application/json'}:{}),...headers},
  body:body===undefined?undefined:body instanceof Blob?body:JSON.stringify(body),signal});
 if(!response.ok){let value;try{value=await response.json();}catch{}const error=failure(value?.error?.code??'HTTP_'+response.status,value?.error?.message??'The original host request failed.');
  error.status=response.status;error.details=value?.error?.details;throw error;}
 return binary?response:response.json();
}
export async function openPollarJournal({workspaceId,scope}){
 if(!/^[a-f0-9-]{36}$/.test(workspaceId)||typeof scope!=='string'||!scope)throw failure('JOURNAL_SCOPE_REQUIRED','Select the original workspace and browser scope.');
 if(!globalThis.indexedDB)throw failure('JOURNAL_UNAVAILABLE','This browser cannot retain the original operation journal.');
 const db=await new Promise((done,reject)=>{
  const open=indexedDB.open(DATABASE,VERSION);
  open.onupgradeneeded=()=>{for(const name of STORES)if(!open.result.objectStoreNames.contains(name))open.result.createObjectStore(name,{keyPath:'key'});};
  open.onsuccess=()=>done(open.result);open.onerror=()=>reject(open.error);open.onblocked=()=>reject(failure('JOURNAL_BUSY','Close the older partner tab before upgrading its journal.'));
 });
 const prefix=location.origin+'\n'+workspaceId+'\n'+scope+'\n';
 async function transact(store,mode,work){
  return new Promise((done,reject)=>{
   let result,transaction;
   try{transaction=db.transaction(store,mode,{durability:mode==='readwrite'?'strict':'default'});result=work(transaction.objectStore(store));}
   catch(error){reject(error);return;}
   transaction.oncomplete=()=>done(result?.result??result);transaction.onerror=()=>reject(transaction.error??failure('JOURNAL_WRITE_FAILED','The browser journal write failed.'));
   transaction.onabort=()=>reject(transaction.error??failure('JOURNAL_WRITE_FAILED','The browser journal write was not committed.'));
  });
 }
 const key=id=>prefix+id;
 async function get(store,id){const row=await transact(store,'readonly',selected=>selected.get(key(id)));return row?.value??null;}
 async function put(store,id,value){
  const entry={key:key(id),workspaceId,scope,value:clone(value)};
  await transact(store,'readwrite',selected=>selected.put(entry));
  const actual=await get(store,id);
  if(!actual||actual.id!==value.id||actual.workspaceId!==value.workspaceId)throw failure('JOURNAL_WRITE_FAILED','The original browser request could not be read back.');
  return actual;
 }
 async function remove(store,id){await transact(store,'readwrite',selected=>selected.delete(key(id)));}
 async function all(store){
  const result=await transact(store,'readonly',selected=>selected.getAll(IDBKeyRange.bound(prefix,prefix+'\uffff')));
  return result.map(row=>row.value).sort((a,b)=>(a.createdAt??'').localeCompare(b.createdAt??''));
 }
 async function enqueue({requestId=id(),method,args,route='/api/invoke',file=null,headers={},metadata={}}){
  const fileSelection=file?{name:file.name??'archive',size:file.size,type:file.type,lastModified:file.lastModified??null,sha256:await fileSha256(file)}:null;
  const input={method,args:clone(args??{}),route,headers:clone(headers),metadata:clone(metadata)},intent=await sha256(requestIdentity({...input,fileSelection}));
  return exclusive('host-request',async()=>{
   const previous=await get('requests',requestId);
   if(previous){
    if(previous.intent!==intent)throw failure('JOURNAL_REQUEST_CONFLICT','This original request ID names a different action or file.');
    // An acknowledged or uncertain request always reuses its first complete body.
    // A new revision can be selected only after the server rejected the old one.
    return previous;
   }
   const record={id:requestId,workspaceId,scope,createdAt:now(),updatedAt:now(),state:'READY',...input,intent,file:file??null,
    fileSelection,attempts:[],result:null,error:null};
   return put('requests',requestId,record);
  });
 }
 async function execute(record,send,apply=async()=>{}){
  return exclusive('host-request',async()=>{
   let current=await get('requests',record.id);if(!current)throw failure('JOURNAL_REQUEST_MISSING','Recover the original durable host request.');
   if(current.state==='COMPLETE'){await apply(clone(current.result),current);return current.result;}
   if(current.state==='CANCELED')throw failure('JOURNAL_REQUEST_CANCELED','This unsent browser request was canceled.');
   const attempt={at:now(),state:'SENDING',bodySha256:await sha256({method:current.method,args:current.args,route:current.route})};
   current.attempts.push(attempt);current.state='SENDING';current.updatedAt=now();current.error=null;
   current=await put('requests',current.id,current);
   try{
    const result=await send(current),retained=clone(result);if(retained&&typeof retained==='object')delete retained.ephemeral;
    current={...current,state:'COMPLETE',result:retained,error:null,updatedAt:now()};
    current.attempts.at(-1).state='ACKNOWLEDGED';current=await put('requests',current.id,current);
    await apply(result,current);return result;
   }catch(error){
    if(current.state==='COMPLETE')throw error;
    current={...current,state:error.code==='REVISION_CONFLICT'?'REVISION_CONFLICT':error.status&&error.status<500&&
     !['OPERATION_RUNNING','OUTCOME_RECONCILIATION_REQUIRED','WORKSPACE_IDENTITY_REQUIRED','WORKSPACE_IDENTITY_MISMATCH'].includes(error.code)?'REJECTED':'UNCERTAIN',
     error:errorValue(error),updatedAt:now()};
    current.attempts.at(-1).state=current.state;await put('requests',current.id,current);throw error;
   }
  });
 }
 async function rebase(record,revision){
  const current=await get('requests',record.id);
  if(current?.state!=='REVISION_CONFLICT'||!Number.isSafeInteger(revision)||revision<0)throw failure('JOURNAL_REVISION_NOT_REJECTED','Refresh only an explicitly rejected original revision.');
  current.revisionSelections??=[];current.revisionSelections.push({expectedRevision:current.args.expectedRevision,rejectedAt:current.updatedAt});
  current.args.expectedRevision=revision;current.state='READY';current.error=null;current.updatedAt=now();
  current.intent=await sha256(requestIdentity(current));
  return put('requests',current.id,current);
 }
 async function cancel(record){
  const current=await get('requests',record.id);if(!current||!['READY','REJECTED','REVISION_CONFLICT'].includes(current.state))throw failure('JOURNAL_REQUEST_UNCERTAIN','Recover the original sent request before removing it.');
  current.state='CANCELED';current.updatedAt=now();return put('requests',current.id,current);
 }
 async function exclusive(lane,work){
  if(!navigator.locks?.request)throw failure('BROWSER_LOCKS_REQUIRED','Use a browser with the Web Locks API to preserve the original operation across tabs.');
  return navigator.locks.request('pollar:'+prefix+lane,{mode:'exclusive'},work);
 }
 async function saveSDK(value){
  if(value.workspaceId!==workspaceId||typeof value.id!=='string')throw failure('JOURNAL_SCOPE_REQUIRED','Keep the original SDK workspace and operation.');
  return put('sdk',value.id,{...value,updatedAt:now()});
 }
 async function view(name,value){
  if(arguments.length===1)return (await get('views',name))?.data??null;
  await put('views',name,{id:name,workspaceId,scope,data:clone(value),updatedAt:now()});return value;
 }
 return {workspaceId,scope,enqueue,execute,rebase,cancel,exclusive,requests:()=>all('requests'),sdkOperations:()=>all('sdk'),
  getRequest:id=>get('requests',id),getSDK:id=>get('sdk',id),saveSDK,view,close:()=>db.close()};
}
export async function downloadResponse(response,filename,{onProgress=()=>{}}={}){
 if(!response.ok)throw failure('DOWNLOAD_FAILED','The original complete file could not be downloaded.');
 if(globalThis.showSaveFilePicker){
  const handle=await showSaveFilePicker({suggestedName:filename}),writer=await handle.createWritable();
  let bytes=0;const reader=response.body.getReader();try{
   while(true){const part=await reader.read();if(part.done)break;await writer.write(part.value);bytes+=part.value.length;onProgress(bytes);}
   await writer.close();return {filename,bytes};
  }catch(error){await writer.abort().catch(()=>{});throw error;}finally{reader.releaseLock();}
 }
 const blob=await response.blob(),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
 return {filename,bytes:blob.size};
}
export function downloadJSON(value,filename){const blob=new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
export function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
export function pretty(value){return JSON.stringify(value,null,2);}
export function parseObject(value,label='Original JSON input'){const parsed=JSON.parse(value);if(!plain(parsed))throw failure('INVALID_ARGUMENT',label+' must be an object.');return parsed;}
export function exampleValue(schema){
 if(!schema||schema===true)return null;if(schema.const!==undefined)return clone(schema.const);if(schema.default!==undefined)return clone(schema.default);
 if(schema.oneOf||schema.anyOf)return exampleValue((schema.oneOf??schema.anyOf)[0]);
 if(schema.enum)return clone(schema.enum[0]);
 if(schema.type==='object'||schema.properties){return Object.fromEntries((schema.required??[]).map(key=>[key,exampleValue(schema.properties?.[key])??'']));}
 if(schema.type==='array')return [];if(schema.type==='boolean')return false;if(schema.type==='integer'||schema.type==='number')return schema.minimum??0;return '';
}
