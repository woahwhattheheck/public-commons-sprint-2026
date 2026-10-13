// MIT. Workspace-bound browser requests retain exact arguments and complete original Files.
import { Sha256 } from './sha256.mjs';
const DATABASE='paycashless-operations-browser',VERSION=1;
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
  request.onupgradeneeded=()=>{const db=request.result;const rows=db.createObjectStore('requests',{keyPath:'id'});rows.createIndex('workspaceId','workspaceId',{unique:false});db.createObjectStore('views',{keyPath:'workspaceId'});};
  request.onerror=()=>reject(problem('JOURNAL_UNAVAILABLE','The request journal could not be opened: '+(request.error?.message??'')));
  request.onblocked=()=>reject(problem('JOURNAL_BLOCKED','Close older Paycashless tabs so browser storage can finish opening.'));
  request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
 }).catch(error=>{opened=null;throw error;});
 return opened;
}
async function transaction(stores,mode,work){
 const db=await database();return new Promise((resolve,reject)=>{
  const tx=db.transaction(stores,mode);let output;
  tx.oncomplete=()=>resolve(output);tx.onabort=()=>reject(problem('JOURNAL_WRITE_FAILED','The browser could not retain this request. No new request may be sent until storage is available.'));
  tx.onerror=()=>{};try{work(tx,value=>{output=value;});}catch(error){tx.abort();reject(error);}
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
