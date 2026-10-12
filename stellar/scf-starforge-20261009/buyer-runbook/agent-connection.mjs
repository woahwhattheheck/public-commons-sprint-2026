// MIT. A borrowed connection to the original running Buyer application.
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {matchRunbookWorkspaceLaunch} from './launch.mjs';
import {BUYER_AGENT_CONFIGURATION,SHA,plain,need,fail} from './agent-contract.mjs';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export function parse(bytes,code='BUYER_AGENT_JSON_INVALID'){
 try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));need(plain(value),code,'Read a complete original JSON object.');return value;}
 catch(error){if(error.code===code)throw error;throw fail(code,'Read a complete original UTF-8 JSON object.');}
}
export function hostPath(value,base=process.cwd()){
 need(typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\0\r\n]/.test(value),'BUYER_AGENT_CONFIGURATION','Select an original private host path.');
 const path=resolve(base,value);need(path!=='/','BUYER_AGENT_CONFIGURATION','Select a specific private host path.');return path;
}
export async function privateDirectory(path){
 const info=await lstat(path);
 need(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===path&&
  (!process.getuid||info.uid===process.getuid())&&(process.platform==='win32'||!(info.mode&0o077)),
  'BUYER_AGENT_PRIVATE_DIRECTORY','Use an existing canonical owner-private directory.');
 return path;
}
export async function readPrivate(path,maximum,{sha256}={}){
 need(isAbsolute(path)&&await realpath(dirname(path))===dirname(path),'BUYER_AGENT_PRIVATE_FILE','Use a canonical original file path.');
 const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 try{
  const a=await file.stat();
  need(a.isFile()&&a.nlink===1&&a.size<=maximum&&(!process.getuid||a.uid===process.getuid())&&
   (process.platform==='win32'||!(a.mode&0o077)),'BUYER_AGENT_PRIVATE_FILE','Use an owner-private regular file within its declared size.');
  const bytes=await file.readFile(),b=await file.stat();
  need(bytes.length===a.size&&bytes.length<=maximum&&['dev','ino','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]),
   'BUYER_AGENT_INPUT_CHANGED','The selected original file changed while reading.');
  if(sha256!==undefined)need(SHA.test(sha256)&&hash(bytes)===sha256,'BUYER_AGENT_INPUT_CHANGED','The original complete file differs from its selected SHA256.');
  return bytes;
 }finally{await file.close();}
}
function fields(value,allowed,required=[]){
 need(plain(value)&&Object.keys(value).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(value,k)),
  'BUYER_AGENT_CONFIGURATION','Supply only the declared host configuration fields.');
}
const alias=value=>need(typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value),'BUYER_AGENT_CONFIGURATION','Use a declared lowercase host alias.');
const KINDS=Object.freeze({'settings':16384,'sdk-manifest':65536,'sdk-file':16*1024*1024,
 'request-handoff':8*1024*1024,'paid-handoff':1024*1024,'ticket':16384,'backup-profile':65536});
export async function readBuyerAgentConfiguration(filename){
 filename=hostPath(filename);const raw=parse(await readPrivate(filename,2*1024*1024),'BUYER_AGENT_CONFIGURATION');
 fields(raw,['schema','workspaces'],['schema','workspaces']);
 need(raw.schema===BUYER_AGENT_CONFIGURATION&&plain(raw.workspaces)&&Object.keys(raw.workspaces).length>=1&&Object.keys(raw.workspaces).length<=32,
  'BUYER_AGENT_CONFIGURATION','Declare 1–32 original Buyer application connections.');
 const workspaces=Object.create(null),used=[];
 for(const [name,input]of Object.entries(raw.workspaces)){
  alias(name);fields(input,['label','directory','launchFile','expectedSelectionSha256','storageDirectory','files','operators','maximumFileBytes','maximumExportBytes','maximumExports'],
   ['directory','launchFile','expectedSelectionSha256','storageDirectory']);
  const base=dirname(filename),definition={label:input.label??name,directory:hostPath(input.directory,base),
   launchFile:hostPath(input.launchFile,base),expectedSelectionSha256:input.expectedSelectionSha256,
   storageDirectory:hostPath(input.storageDirectory,base),files:Object.create(null),operators:Object.create(null),
   maximumFileBytes:input.maximumFileBytes??256*1024*1024,maximumExportBytes:input.maximumExportBytes??1024*1024*1024,
   maximumExports:input.maximumExports??128};
  need(typeof definition.label==='string'&&definition.label.length>=1&&definition.label.length<=160&&
   !/[\0\r\n]/.test(definition.label)&&SHA.test(definition.expectedSelectionSha256),
   'BUYER_AGENT_CONFIGURATION','Declare the original selected workspace and its reviewed selection digest.');
  for(const [k,max]of [['maximumFileBytes',8*1024*1024*1024],['maximumExportBytes',32*1024*1024*1024],['maximumExports',10000]])
   need(Number.isSafeInteger(definition[k])&&definition[k]>=1&&definition[k]<=max,'BUYER_AGENT_CONFIGURATION','Declare a positive original '+k+' within the supported range.');
  await privateDirectory(definition.directory);await privateDirectory(definition.storageDirectory);
  const overlaps=(a,b)=>a===b||a.startsWith(b+'/')||b.startsWith(a+'/');
  need(!overlaps(definition.directory,definition.storageDirectory)&&used.every(p=>!overlaps(p,definition.storageDirectory)),
   'BUYER_AGENT_CONFIGURATION','Keep each agent storage directory separate from native workspace and other agent stores.');
  used.push(definition.storageDirectory);
  need(input.files===undefined||plain(input.files)&&Object.keys(input.files).length<=256,'BUYER_AGENT_CONFIGURATION','Declare up to 256 original input handles.');
  for(const [handle,file]of Object.entries(input.files??{})){
   alias(handle);fields(file,['path','kind','sha256','label'],['path','kind','sha256']);
   need(Object.hasOwn(KINDS,file.kind)&&SHA.test(file.sha256),'BUYER_AGENT_CONFIGURATION','Bind each original input to its declared kind and SHA256.');
   need(file.label===undefined||typeof file.label==='string'&&file.label.length<=160&&!/[\0\r\n]/.test(file.label),'BUYER_AGENT_CONFIGURATION','Use a short original input label.');
   definition.files[handle]={path:hostPath(file.path,base),kind:file.kind,sha256:file.sha256,label:file.label??handle,maximum:KINDS[file.kind]};
  }
  need(input.operators===undefined||plain(input.operators),'BUYER_AGENT_CONFIGURATION','Declare original accounting operator aliases.');
  for(const [handle,path]of Object.entries(input.operators??{})){alias(handle);definition.operators[handle]=hostPath(path,base);await privateDirectory(definition.operators[handle]);}
  workspaces[name]=definition;
 }
 return {schema:BUYER_AGENT_CONFIGURATION,workspaces};
}
function codeOf(error){return /^[A-Z][A-Z0-9_]{1,140}$/.test(error?.code??'')?error.code:'BUYER_AGENT_TRANSPORT_FAILED';}
function publicConnection(value){return {schema:value.schema,directory:value.directory,selectionSha256:value.selectionSha256,
 instanceId:value.instanceId,pid:value.pid,url:value.url,approvalMode:value.approvalMode,approvalAvailable:value.approvalAvailable,
 launchSha256:value.launchSha256,sourceFiles:structuredClone(value.sourceFiles)};}
export class BuyerWorkspaceConnection{
 #definition;#pending=new Set();#closing=false;#close;#token=null;#tokenLaunch=null;
 constructor(definition){this.#definition=definition;}
 get definition(){return this.#definition;}
 async selected(){
  const bytes=await readPrivate(this.#definition.launchFile,262144),record=parse(bytes,'BUYER_AGENT_LAUNCH_INVALID');
  need(record.directory===this.#definition.directory&&record.selectionSha256===this.#definition.expectedSelectionSha256&&
   record.selection?.directory===this.#definition.directory&&SHA.test(record.selectionSha256??''),
   'BUYER_AGENT_LAUNCH_CHANGED','Select the original running Buyer workspace and reviewed source.');
  need(hash(JSON.stringify({selection:record.selection,sourceFiles:record.sourceFiles}))===record.selectionSha256,
   'BUYER_AGENT_LAUNCH_CHANGED','The original launch selection and source digest differ.');
  matchRunbookWorkspaceLaunch(record,record);
  need(new URL(record.url).origin===record.url,'BUYER_AGENT_LAUNCH_INVALID','Use the exact canonical original listener origin.');
  return {...record,launchSha256:hash(bytes)};
 }
 async #stillSelected(connection){
  const current=await this.selected();need(current.launchSha256===connection.launchSha256,
   'BUYER_AGENT_INSTANCE_CHANGED','The original application restarted during this request. Reopen its current retained launch.');
 }
 async #raw(connection,path,{body,signal,timeoutMs=120000,maximum=16*1024*1024,receive}={}){
  need(typeof path==='string'&&(/^\/api\/[A-Za-z0-9_./-]+$/.test(path)||/^\/files\/[A-Za-z0-9_./-]+$/.test(path))&&
   !path.split('/').includes('..')&&(path!=='/api/approval'||body===undefined),
   'BUYER_AGENT_ROUTE_INVALID','Select an original declared workspace route.');
  need(!this.#closing,'BUYER_AGENT_CLOSING','The agent connection is draining its accepted requests.');
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=300000,'BUYER_AGENT_TIMEOUT','Use a request timeout up to five minutes.');
  const controller=new AbortController(),deadline=AbortSignal.timeout(timeoutMs);
  const combined=AbortSignal.any([controller.signal,deadline,...(signal?[signal]:[])]);
  const mutation=body!==undefined,payload=mutation?JSON.stringify(body):undefined;
  need(!mutation||plain(body)&&Buffer.byteLength(payload)<=24*1024*1024,'BUYER_AGENT_REQUEST_TOO_LARGE','Supply a complete original JSON request within the native file limit.');
  let attempted=false;
  const operation=(async()=>{
   try{
    attempted=true;
    const response=await fetch(connection.url+path,{method:mutation?'POST':'GET',redirect:'error',signal:combined,
     headers:{origin:connection.url,accept:'application/json, application/octet-stream',...(mutation?{'content-type':'application/json','x-runbook-session':this.#token}:{})},
     ...(mutation?{body:payload}:{})});
    if(receive&&response.ok){try{return await receive(response,combined);}catch(error){await response.body?.cancel().catch(()=>{});throw error;}}
    const chunks=[];let size=0;
    try{
     for await(const chunk of response.body??[]){size+=chunk.length;need(size<=(response.ok?maximum:65536),'BUYER_AGENT_RESPONSE_TOO_LARGE','Capture the complete native file or use a smaller inventory page.');chunks.push(chunk);}
    }catch(error){await response.body?.cancel().catch(()=>{});throw error;}
    const bytes=Buffer.concat(chunks,size),length=response.headers.get('content-length');
    need(length===null||/^(0|[1-9][0-9]*)$/.test(length)&&Number(length)===bytes.length,'BUYER_AGENT_RESPONSE_INCOMPLETE','The original HTTP response ended before its declared byte count.');
    if(!response.ok){let value;try{value=parse(bytes);}catch{}
     const code=/^[A-Z][A-Z0-9_]{1,140}$/.test(value?.code??'')?value.code:'BUYER_AGENT_HTTP_'+response.status;
     throw fail(code,'The original Buyer workspace returned '+code+'. Continue its retained native record.',
      {status:response.status,outcomeUnknown:mutation&&response.status>=500});
    }
    return {bytes,headers:response.headers};
   }catch(error){throw fail(codeOf(error),error.buyerAgentPublic?error.message:'The original Buyer request did not return a complete response.',
    {status:Number.isInteger(error.status)?error.status:undefined,outcomeUnknown:mutation&&attempted&&(error.outcomeUnknown??true)});}
  })();
  const active={controller,operation};this.#pending.add(active);
  try{return await operation;}finally{this.#pending.delete(active);}
 }
 async #verify(connection,options={}){
  const reply=await this.#raw(connection,'/api/launch',{...options,maximum:262144}),native=parse(reply.bytes,'BUYER_AGENT_LISTENER_INVALID');
  matchRunbookWorkspaceLaunch(native,connection);
  need(native.instanceId===connection.instanceId&&native.pid===connection.pid&&native.url===connection.url,
   'BUYER_AGENT_INSTANCE_CHANGED','The actual listener differs from the selected original launch.');
  await this.#stillSelected(connection);
  return native;
 }
 async request(path,options={}){
  const connection=await this.selected();await this.#verify(connection,{signal:options.signal,timeoutMs:options.timeoutMs});
  const mutation=options.body!==undefined;
  if(mutation&&(this.#tokenLaunch!==connection.launchSha256||!this.#token)){
   const response=await this.#raw(connection,'/api/state',{signal:options.signal,timeoutMs:options.timeoutMs,maximum:32*1024*1024});
   const native=parse(response.bytes,'BUYER_AGENT_SESSION_INVALID');
   need(native.directory===connection.directory&&native.launch?.instanceId===connection.instanceId&&
    typeof native.token==='string'&&/^[a-f0-9]{64}$/.test(native.token),'BUYER_AGENT_SESSION_INVALID','Read this original application session before writing.');
   matchRunbookWorkspaceLaunch(native.launch,connection);this.#token=native.token;this.#tokenLaunch=connection.launchSha256;
  }
  await this.#stillSelected(connection);
  let sent=false;
  try{
   sent=mutation;const result=await this.#raw(connection,path,options);
   await this.#stillSelected(connection);await this.#verify(connection,{signal:options.signal,timeoutMs:options.timeoutMs});
   return {...result,connection:publicConnection(connection)};
  }catch(error){if(sent&&error.outcomeUnknown===undefined)error.outcomeUnknown=true;throw error;}
 }
 async json(path,options={}){
  const result=await this.request(path,options);
  let native;try{native=parse(result.bytes,'BUYER_AGENT_NATIVE_JSON_INVALID');}
  catch(error){error.outcomeUnknown=options.body!==undefined;throw error;}
  if(path==='/api/state'){
   need(native.directory===this.#definition.directory,'BUYER_AGENT_INSTANCE_CHANGED','The original state belongs to another workspace.');
   delete native.token;
  }
  return {native,connection:result.connection};
 }
 async input(handle,kind,expectedSha256){
  const file=this.#definition.files[handle];
  need(file&&file.kind===kind&&file.sha256===expectedSha256,'BUYER_AGENT_INPUT_NOT_CONFIGURED','Select the host-declared original input and exact SHA256.');
  const bytes=await readPrivate(file.path,file.maximum,{sha256:file.sha256});
  return {bytes,source:{handle,kind,sha256:file.sha256,bytes:bytes.length}};
 }
 close(){
  if(this.#close)return this.#close;this.#closing=true;this.#token=null;this.#tokenLaunch=null;
  for(const request of this.#pending)request.controller.abort();
  return this.#close=(async()=>{await Promise.allSettled([...this.#pending].map(r=>r.operation));})();
 }
}
