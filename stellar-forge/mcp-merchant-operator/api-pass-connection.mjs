// MIT. Private host-declared connection to one existing API-pass workspace writer.
import {constants} from 'node:fs';
import {open,realpath,lstat} from 'node:fs/promises';
import {dirname,resolve,isAbsolute,join} from 'node:path';
import {privateSupportDirectory} from './host-files.mjs';
import {API_PASS_CONNECTION_SCHEMA,API_PASS_ALIAS,API_PASS_UUID,API_PASS_SHA,API_PASS_ID,API_PASS_MAX_FILE_BYTES,
 apiPassPlain,apiPassExact,apiPassChecked,apiPassText,apiPassInteger,apiPassNeed,apiPassFailure,apiPassHash} from './api-pass-protocol.mjs';
export const API_PASS_LAUNCH_SCHEMA='stellar-forge.sf101.api-pass-workspace-launch.v1';
export const API_PASS_SESSION_SCHEMA='stellar-forge.sf101.api-pass-workspace-session.v1';
const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
export function apiPassHostPath(value,base=process.cwd()){
 apiPassNeed(typeof value==='string'&&value.length>0&&!/[\0\r\n]/.test(value),'Declare an original private host path.','API_PASS_CONFIGURATION');
 const path=resolve(base,value);apiPassNeed(path!=='/','Choose an owned private directory or file.','API_PASS_CONFIGURATION');return path;
}
export async function apiPassPrivateDirectory(path){
 await privateSupportDirectory(path);
 const info=await lstat(path);
 apiPassNeed(await realpath(path)===path&&(!process.getuid||info.uid===process.getuid()),'Use an owner-controlled canonical private directory.','API_PASS_PRIVATE_DIRECTORY');
 return path;
}
export async function readApiPassPrivateFile(path,maximum,{sha256}={}){
 const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 try{
  const before=await handle.stat();
  apiPassNeed(before.isFile()&&before.nlink===1&&before.size<=maximum&&!(before.mode&0o077)&&(!process.getuid||before.uid===process.getuid()),'Use a private regular original file within its declared byte limit.','API_PASS_PRIVATE_FILE');
  const bytes=await handle.readFile(),after=await handle.stat();
  apiPassNeed(bytes.length===before.size&&bytes.length<=maximum&&before.size===after.size&&before.dev===after.dev&&before.ino===after.ino&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'The selected original file changed while reading.','API_PASS_FILE_CHANGED');
  if(sha256!==undefined)apiPassNeed(apiPassHash(bytes)===apiPassChecked(sha256,API_PASS_SHA,'original file SHA256'),'The complete file differs from its declared or selected SHA256.','API_PASS_FILE_CHANGED');
  return bytes;
 }finally{await handle.close();}
}
function parse(bytes,code){try{return JSON.parse(decode(bytes));}catch{throw apiPassFailure(code,'The selected original file is not valid complete UTF-8 JSON.');}}
export async function readApiPassWorkspaceConfiguration(filename){
 filename=apiPassHostPath(filename);const raw=parse(await readApiPassPrivateFile(filename,1024*1024),'API_PASS_CONFIGURATION');
 apiPassExact(raw,['schema','workspaces'],['schema','workspaces']);
 apiPassNeed(raw.schema===API_PASS_CONNECTION_SCHEMA&&apiPassPlain(raw.workspaces)&&Object.keys(raw.workspaces).length>=1&&Object.keys(raw.workspaces).length<=32,'Declare 1–32 original API-pass workspace connections.','API_PASS_CONFIGURATION');
 const base=dirname(filename),workspaces=Object.create(null),ownedPaths=new Set();
 for(const [alias,input]of Object.entries(raw.workspaces)){
  apiPassChecked(alias,API_PASS_ALIAS,'workspace alias');
  apiPassExact(input,['label','workspaceId','launchFile','expectedEntrySha256','exportDirectory','snapshotDirectory','operationDirectory','maxExports','maxExportBytes','files','purchases'],['workspaceId','launchFile','exportDirectory','snapshotDirectory','operationDirectory']);
  const definition={label:apiPassText(input.label??alias,160,'workspace label'),workspaceId:apiPassChecked(input.workspaceId,API_PASS_UUID,'original workspace ID'),
   launchFile:apiPassHostPath(input.launchFile,base),exportDirectory:apiPassHostPath(input.exportDirectory,base),snapshotDirectory:apiPassHostPath(input.snapshotDirectory,base),operationDirectory:apiPassHostPath(input.operationDirectory,base),
   maxExports:apiPassInteger(input.maxExports??256,1,10000,'retained export count'),maxExportBytes:apiPassInteger(input.maxExportBytes??256*1024*1024,1,4*1024*1024*1024,'retained export byte capacity'),files:Object.create(null),purchases:Object.create(null)};
  if(input.expectedEntrySha256!==undefined)definition.expectedEntrySha256=apiPassChecked(input.expectedEntrySha256,API_PASS_SHA,'configured original source SHA');
  for(const path of [definition.exportDirectory,definition.snapshotDirectory,definition.operationDirectory]){
   apiPassNeed([...ownedPaths].every(owned=>path!==owned&&!path.startsWith(owned+'/')&&!owned.startsWith(path+'/')),'Each workspace must have separate nonoverlapping export, snapshot and operation directories.','API_PASS_CONFIGURATION');
   await apiPassPrivateDirectory(path);ownedPaths.add(path);
  }
  apiPassNeed(definition.exportDirectory!==definition.snapshotDirectory&&!definition.exportDirectory.startsWith(definition.snapshotDirectory+'/')&&!definition.snapshotDirectory.startsWith(definition.exportDirectory+'/'),'Keep export storage and temporary snapshot storage separate.','API_PASS_CONFIGURATION');
  apiPassNeed(input.files===undefined||apiPassPlain(input.files)&&Object.keys(input.files).length<=128,'Declare at most 128 original file handles.','API_PASS_CONFIGURATION');
  for(const [name,file]of Object.entries(input.files??{})){
   apiPassChecked(name,API_PASS_ALIAS,'file handle');apiPassExact(file,['path','kind','sha256','label'],['path','kind','sha256']);
   apiPassNeed(['handoff','body','approved-request'].includes(file.kind),'Choose handoff, body or approved-request.','API_PASS_CONFIGURATION');
   definition.files[name]={path:apiPassHostPath(file.path,base),kind:file.kind,sha256:apiPassChecked(file.sha256,API_PASS_SHA,'declared source SHA'),label:apiPassText(file.label??name,160,'file label')};
  }
  apiPassNeed(input.purchases===undefined||apiPassPlain(input.purchases)&&Object.keys(input.purchases).length<=200,'Declare at most 200 existing purchases.','API_PASS_CONFIGURATION');
  for(const [name,purchase]of Object.entries(input.purchases??{})){
   apiPassChecked(name,API_PASS_ALIAS,'purchase handle');apiPassExact(purchase,['directory','customerSha256','intentId','orderReference','label'],['directory','customerSha256','intentId','orderReference']);
   definition.purchases[name]={directory:apiPassHostPath(purchase.directory,base),customerSha256:apiPassChecked(purchase.customerSha256,API_PASS_SHA,'original customer metadata SHA'),
    intentId:apiPassChecked(purchase.intentId,API_PASS_ID,'original purchase intent'),orderReference:apiPassChecked(purchase.orderReference,API_PASS_ID,'original order reference'),label:apiPassText(purchase.label??name,160,'purchase label')};
  }
  workspaces[alias]=definition;
 }
 return {schema:API_PASS_CONNECTION_SCHEMA,workspaces};
}
export async function readApiPassResponse(response,maximum){
 const chunks=[];let size=0;
 try{
  for await(const chunk of response.body??[]){size+=chunk.length;apiPassNeed(size<=maximum,'The complete native response exceeds this operation’s declared file limit.','API_PASS_RESPONSE_TOO_LARGE');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks,size),length=response.headers.get('content-length');
  if(length!==null)apiPassNeed(/^(0|[1-9][0-9]*)$/.test(length)&&Number(length)===bytes.length,'The original response ended before its declared byte count.','API_PASS_RESPONSE_INCOMPLETE');
  return bytes;
 }catch(error){await response.body?.cancel().catch(()=>{});throw error;}
}
function publicLaunch(connection){return {workspaceId:connection.workspaceId,instanceId:connection.instanceId,processId:connection.processId,startedAt:connection.startedAt,origin:connection.origin,launchSha256:connection.launchSha256,entrySha256:connection.entrySha256};}
export class ApiPassWorkspaceHttpClient{
 #definition;
 constructor(definition){this.#definition=definition;}
 get definition(){return this.#definition;}
 async connection(){
  let bytes,record;try{bytes=await readApiPassPrivateFile(this.#definition.launchFile,131072);record=parse(bytes,'API_PASS_LAUNCH_INVALID');}
  catch(error){if(error.code==='API_PASS_LAUNCH_INVALID')throw error;throw apiPassFailure('API_PASS_LAUNCH_UNAVAILABLE','Reopen the declared original API-pass workspace and its private launch record.');}
  apiPassNeed(apiPassPlain(record)&&record.schema===API_PASS_LAUNCH_SCHEMA&&record.status==='LISTENING'&&record.workspaceId===this.#definition.workspaceId&&API_PASS_UUID.test(record.instanceId??'')&&Number.isSafeInteger(record.processId)&&record.processId>0&&Number.isFinite(Date.parse(record.startedAt))&&apiPassPlain(record.source)&&API_PASS_SHA.test(record.source.sha256??'')&&typeof record.source.entry==='string'&&isAbsolute(record.source.entry),'The private launch must name the selected running original workspace.','API_PASS_LAUNCH_INVALID');
  if(this.#definition.expectedEntrySha256!==undefined)apiPassNeed(record.source.sha256===this.#definition.expectedEntrySha256,'The original workspace source differs from the declared release.','API_PASS_LAUNCH_SOURCE_CHANGED');
  let url;try{url=new URL(record.url);}catch{}
  apiPassNeed(url&&url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.pathname==='/'&&!url.username&&!url.password&&!url.search&&/^[A-Za-z0-9_-]{43}$/.test(url.hash.slice(1))&&Number(url.port||'80')>=1&&Number(url.port||'80')<=65535,'Use the original private loopback startup URL.','API_PASS_LAUNCH_INVALID');
  return {workspaceId:record.workspaceId,instanceId:record.instanceId,processId:record.processId,startedAt:record.startedAt,origin:url.origin,token:url.hash.slice(1),launchSha256:apiPassHash(bytes),entrySha256:record.source.sha256};
 }
 async #unchanged(connection){const current=await this.connection();apiPassNeed(current.launchSha256===connection.launchSha256,'The original workspace restarted during this operation. Reopen its current session.','API_PASS_SESSION_CHANGED');}
 async #fetch(connection,path,{body,signal,timeoutMs=120000}={},maximum=16*1024*1024){
  const mutation=body!==undefined,deadline=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,deadline]):deadline;
  let sent=false;
  try{
   apiPassNeed(typeof path==='string'&&path.startsWith('/api/')&&!/[\r\n\0]/.test(path),'Use an original workspace API path.');
   const payload=mutation?JSON.stringify(body):undefined;
   if(mutation)apiPassNeed(Buffer.byteLength(payload)<=Math.ceil(1048576/3)*4+131072,'The exact original request exceeds the native body limit.','API_PASS_REQUEST_TOO_LARGE');
   sent=true;
   const response=await fetch(connection.origin+path,{method:mutation?'POST':'GET',redirect:'error',signal:combined,headers:{authorization:'Bearer '+connection.token,origin:connection.origin,accept:'application/json, application/octet-stream',...(mutation?{'content-type':'application/json'}:{})},...(mutation?{body:payload}:{})});
   const bytes=await readApiPassResponse(response,response.ok?maximum:65536);
   if(!response.ok){let value;try{value=JSON.parse(decode(bytes));}catch{}
    const code=/^[A-Z][A-Z0-9_]{1,140}$/.test(value?.error??'')?value.error:'API_PASS_HTTP_'+response.status;
    throw apiPassFailure(code,'The original API-pass workspace returned '+code+'. Read its current state and retain the same original operation ID on retry.',{status:response.status,outcomeUnknown:mutation&&response.status>=500});
   }
   return {bytes,headers:response.headers};
  }catch(error){
   const code=/^[A-Z][A-Z0-9_]{1,140}$/.test(error?.code??'')?error.code:'API_PASS_TRANSPORT_FAILED';
   throw apiPassFailure(code,error?.code===code?error.message:'The original workspace transport did not return a complete response. Retain the exact selected operation.',{...(Number.isInteger(error?.status)?{status:error.status}:{}),outcomeUnknown:mutation&&sent&&(error?.outcomeUnknown??true)});
  }
 }
 async request(path,options={},maximum=16*1024*1024){
  const connection=await this.connection();
  const sessionResponse=await this.#fetch(connection,'/api/session',{signal:options.signal,timeoutMs:options.timeoutMs},65536);
  const session=parse(sessionResponse.bytes,'API_PASS_SESSION_INVALID');
  apiPassNeed(session.schema===API_PASS_SESSION_SCHEMA&&session.workspaceId===this.#definition.workspaceId,'The authenticated native session belongs to another workspace.','API_PASS_SESSION_CHANGED');
  await this.#unchanged(connection);
  let sent=false;
  try{
   sent=options.body!==undefined;const response=path==='/api/session'&&!sent?sessionResponse:await this.#fetch(connection,path,options,maximum);
   await this.#unchanged(connection);
   return {...response,connection:publicLaunch(connection),session};
  }catch(error){if(sent&&error.outcomeUnknown===undefined)error.outcomeUnknown=true;throw error;}
 }
 async json(path,options={},maximum=16*1024*1024){
  const reply=await this.request(path,options,maximum);let native;
  try{native=JSON.parse(decode(reply.bytes));}catch{throw apiPassFailure('API_PASS_NATIVE_JSON_INVALID','The original API returned invalid complete JSON.',{outcomeUnknown:options.body!==undefined});}
  if(!apiPassPlain(native))throw apiPassFailure('API_PASS_NATIVE_JSON_INVALID','The original API result must be an object.',{outcomeUnknown:options.body!==undefined});
  if(path==='/api/state')apiPassNeed(native.id===this.#definition.workspaceId,'The original state belongs to another workspace.','API_PASS_SESSION_CHANGED');
  if(options.body!==undefined&&!(native.state?.id===this.#definition.workspaceId&&Number.isSafeInteger(native.state.revision)&&native.state.revision>=1&&apiPassPlain(native.result)))throw apiPassFailure('API_PASS_NATIVE_MUTATION_INVALID','The original mutation response lacks its exact workspace and result.',{outcomeUnknown:true});
  return {...reply,native};
 }
 async input(name,kind,expectedSha256){
  apiPassChecked(name,API_PASS_ALIAS,'file handle');const file=this.#definition.files[name];
  apiPassNeed(file&&(!kind||file.kind===kind),'Select a declared original file of the required kind.','API_PASS_INPUT_NOT_CONFIGURED');
  if(expectedSha256!==undefined)apiPassNeed(apiPassChecked(expectedSha256,API_PASS_SHA,'selected source SHA')===file.sha256,'The selected original file SHA differs from its host declaration.','API_PASS_INPUT_CHANGED');
  const maximum={handoff:65536,body:1048576,'approved-request':32768}[file.kind];
  const bytes=await readApiPassPrivateFile(file.path,maximum,{sha256:file.sha256});
  return {bytes,source:{handle:name,kind:file.kind,label:file.label,bytes:bytes.length,sha256:file.sha256}};
 }
 async purchase(name){
  apiPassChecked(name,API_PASS_ALIAS,'purchase handle');const purchase=this.#definition.purchases[name];
  apiPassNeed(purchase,'Select a host-declared original purchase directory.','API_PASS_PURCHASE_NOT_CONFIGURED');
  await apiPassPrivateDirectory(purchase.directory);
  const metadata=parse(await readApiPassPrivateFile(join(purchase.directory,'customer.json'),2*1024*1024,{sha256:purchase.customerSha256}),'API_PASS_PURCHASE_METADATA_INVALID');
  apiPassNeed(metadata.schema==='stellar-forge.sf101.api-purchase-customer.v1'&&metadata.intentId===purchase.intentId&&metadata.orderReference===purchase.orderReference,'The hash-pinned original purchase metadata differs from the declared intent or order.','API_PASS_PURCHASE_BINDING');
  return purchase;
 }
}
