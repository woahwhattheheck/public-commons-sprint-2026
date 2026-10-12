// MIT. Retained agent requests and exact native file receiving.
import {constants} from 'node:fs';
import {mkdir,open,readdir,link,unlink,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {acquireStateLease} from '../merchant-fleet-gateway/state-lease.mjs';
import {RetainedFileReads} from '../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import {hash,encode,parse,readPrivate,privateDirectory} from './agent-connection.mjs';
import {BUYER_AGENT_EXPORT,BUYER_AGENT_ACTIONS,SHA,UUID,need,fail,SDK_FILES,FILE_SELECTION,validate} from './agent-contract.mjs';
const now=()=>new Date().toISOString();
export const BUYER_AGENT_MANIFEST='buyer-agent-export.json';
const exportIdCheck=value=>need(typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value),'INVALID_PARAMS','Select the original export identifier.');
const REQUEST_SCHEMA='stellar-forge.buyer-runbook.agent-request.v1';
const failCode=error=>/^[A-Z][A-Z0-9_]{1,140}$/.test(error?.code??'')?error.code:'BUYER_AGENT_OPERATION_FAILED';
async function exists(path){try{const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));await file.close();return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function ensure(path){try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}return privateDirectory(path);}
async function sync(directory){const file=await open(directory,'r');try{await file.sync();}finally{await file.close();}}
async function atomic(directory,name,value){
 const temporary=join(directory,'.'+randomUUID()+'.tmp'),file=await open(temporary,'wx',0o600);
 try{await file.writeFile(encode(value));await file.sync();await file.close();await rename(temporary,join(directory,name));await sync(directory);}
 finally{await file.close().catch(()=>{});await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
async function optional(path,limit=64*1024*1024){try{return parse(await readPrivate(path,limit));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function originalRecord(value,definition,requestId){
 need(value?.schema===REQUEST_SCHEMA&&value.requestId===requestId&&value.directory===definition.directory&&
  value.selectionSha256===definition.expectedSelectionSha256&&BUYER_AGENT_ACTIONS[value.action]?.mutating&&
  ['PREPARED','DISPATCHING','COMPLETE','ATTENTION','REJECTED','RECONCILED'].includes(value.phase)&&Array.isArray(value.attempts)&&
  value.attempts.length<=1000&&
  hash(encode({action:value.action,args:value.args,body:value.body,path:value.path,before:value.before??null}))===value.requestSha256,
  'BUYER_AGENT_REQUEST_CHANGED','The retained original agent request changed or belongs to another selected workspace.');
 return value;
}
export class BuyerAgentStorage{
 #definition;#root;#tails=new Map();#closing=false;#reads=new RetainedFileReads({errorPrefix:'BUYER_AGENT'});
 constructor(definition){this.#definition=definition;this.#root=definition.storageDirectory;}
 get definition(){return this.#definition;}
 get summary(){return this.#reads.summary;}
 async #locked(kind,fn){
  need(!this.#closing,'BUYER_AGENT_CLOSING','The agent store is draining its accepted operations.');
  const operation=(this.#tails.get(kind)??Promise.resolve()).then(async()=>{
   const directory=await ensure(join(this.#root,kind)),lease=await acquireStateLease(directory);
   try{return await fn(directory,lease);}finally{await lease.close();}
  });this.#tails.set(kind,operation.catch(()=>{}));return operation;
 }
 #view(record){
  return {requestId:record.requestId,action:record.action,requestSha256:record.requestSha256,phase:record.phase,
   createdAt:record.createdAt,updatedAt:record.updatedAt,args:record.args,
   attempts:record.attempts??[],response:record.response??null,reconciliation:record.reconciliation??null,error:record.error??null};
 }
 async operation(requestId){
  need(UUID.test(requestId),'INVALID_PARAMS','Select the original saved request UUID.');
  return this.#locked('operations',async directory=>{
   const record=await optional(join(directory,requestId+'.json'));
   return record?{found:true,...this.#view(originalRecord(record,this.#definition,requestId))}:{found:false,requestId};
  });
 }
 async mutate(action,args,resolve,send){
  need(UUID.test(args.requestId),'INVALID_PARAMS','Select the original saved request UUID.');
  return this.#locked('operations',async(directory,lease)=>{
   const path=join(directory,args.requestId+'.json');let record=await optional(path);
   if(record){
    originalRecord(record,this.#definition,args.requestId);
    need(record.action===action&&hash(encode(record.args))===hash(encode(args)),
     'BUYER_AGENT_REQUEST_ID_REUSED','Continue this original request ID with its exact original arguments.');
   }else{
    const resolved=await resolve(),content={action,args,body:resolved.body,path:resolved.path,before:resolved.before??null};
    record={schema:REQUEST_SCHEMA,requestId:args.requestId,directory:this.#definition.directory,
     selectionSha256:this.#definition.expectedSelectionSha256,...content,requestSha256:hash(encode(content)),
     createdAt:now(),updatedAt:now(),phase:'PREPARED',attempts:[],response:null,error:null};
    lease.assertHeld();await atomic(directory,args.requestId+'.json',record);
   }
   return this.#dispatch(directory,lease,record,send);
  });
 }
 async #dispatch(directory,lease,record,send){
  if(record.phase==='COMPLETE')return {...record.response,operation:{...this.#view(record),replayed:true}};
  if(record.phase==='RECONCILED')return {native:record.reconciliation.native,operation:{...this.#view(record),replayed:true}};
  const spec=BUYER_AGENT_ACTIONS[record.action];
  need(record.attempts.length===0||spec.replay||record.phase==='REJECTED','BUYER_AGENT_ORIGINAL_OUTCOME_UNCERTAIN',
   'Read or reconcile this original action before sending another native operation.');
  need(record.attempts.length<1000,'BUYER_AGENT_REQUEST_ATTEMPT_LIMIT','This retained request reached its native dispatch history limit.');
  const startedAt=now();record={...record,phase:'DISPATCHING',updatedAt:startedAt,error:null,
   attempts:[...record.attempts,{startedAt,finishedAt:null,error:null}]};
  lease.assertHeld();await atomic(directory,record.requestId+'.json',record);
  let response;
  try{
   response=await send(record);
   record={...record,phase:'COMPLETE',response,updatedAt:now(),
    attempts:record.attempts.map((a,i)=>i===record.attempts.length-1?{...a,finishedAt:now()}:a)};
   lease.assertHeld();await atomic(directory,record.requestId+'.json',record);
   return {...response,operation:{...this.#view(record),replayed:false}};
  }catch(error){
   if(response)throw fail('BUYER_AGENT_RESPONSE_SAVE_UNCERTAIN','The original response was received. Read this retained request before continuing.',{outcomeUnknown:true,requestId:record.requestId});
   const problem={code:failCode(error),outcomeUnknown:error.outcomeUnknown??true,...(Number.isInteger(error.status)?{status:error.status}:{})};
   record={...record,phase:problem.outcomeUnknown?'ATTENTION':'REJECTED',updatedAt:now(),error:problem,
    attempts:record.attempts.map((a,i)=>i===record.attempts.length-1?{...a,finishedAt:now(),error:problem}:a)};
   try{lease.assertHeld();await atomic(directory,record.requestId+'.json',record);}catch{error.journalWriteUncertain=true;}
   error.requestId=record.requestId;throw error;
  }
 }
 async resume(requestId,send){
  need(UUID.test(requestId),'INVALID_PARAMS','Select the original saved request UUID.');
  return this.#locked('operations',async(directory,lease)=>{
   const record=await optional(join(directory,requestId+'.json'));
   need(record,'BUYER_AGENT_REQUEST_NOT_FOUND','Select an existing original request ID.');
   originalRecord(record,this.#definition,requestId);return this.#dispatch(directory,lease,record,send);
  });
 }
 async reconcile(requestId,readNative){
  need(UUID.test(requestId),'INVALID_PARAMS','Select the original saved request UUID.');
  return this.#locked('operations',async(directory,lease)=>{
   let record=await optional(join(directory,requestId+'.json'));
   need(record,'BUYER_AGENT_REQUEST_NOT_FOUND','Select an existing original request ID.');
   originalRecord(record,this.#definition,requestId);
   if(['COMPLETE','RECONCILED'].includes(record.phase))return {found:true,...this.#view(record)};
   const result=await readNative(record);
   need(result?.matched===true,'BUYER_AGENT_NATIVE_RECONCILIATION_REQUIRED',
    'The current original record does not establish this action result. Inspect its saved native acquisition and original attempt.');
   record={...record,phase:'RECONCILED',updatedAt:now(),reconciliation:{...result,observedAt:now()},error:null};
   lease.assertHeld();await atomic(directory,requestId+'.json',record);return {found:true,...this.#view(record)};
  });
 }
 async exports({offset=0,limit=100}={}){
  return this.#locked('exports',async directory=>{
   const names=(await readdir(directory)).filter(n=>/^[a-z0-9][a-z0-9_-]{0,63}$/.test(n)&&n!=='lease.lock'),rows=[];
   for(const id of names){const manifest=await optional(join(directory,id,'buyer-agent-export.json'),1048576);if(manifest)rows.push({id,createdAt:manifest.createdAt,files:manifest.files.length,bytes:manifest.files.reduce((n,f)=>n+f.bytes,0),manifestSha256:hash(encode(manifest))});}
   rows.sort((a,b)=>a.id.localeCompare(b.id));return {items:rows.slice(offset,offset+limit),offset,limit,total:rows.length,nextOffset:offset+limit<rows.length?offset+limit:null};
  });
 }
 async manifest(exportId){
  exportIdCheck(exportId);
  const directory=join(this.#root,'exports',exportId);await privateDirectory(directory);
  const bytes=await readPrivate(join(directory,'buyer-agent-export.json'),65000),manifest=parse(bytes);
  need(manifest.schema===BUYER_AGENT_EXPORT&&manifest.exportId===exportId&&manifest.directory===this.#definition.directory&&
   manifest.selectionSha256===this.#definition.expectedSelectionSha256&&Array.isArray(manifest.files)&&manifest.files.length>0,
   'BUYER_AGENT_EXPORT_CHANGED','Select the original complete receiving export.');
  return {state:'MANIFEST_RETAINED',exportId,manifest,manifestSha256:hash(bytes),
   manifestFile:{name:BUYER_AGENT_MANIFEST,bytes:bytes.length,sha256:hash(bytes)},bytes};
 }
 async capture(exportId,files,receive,context={}){
  exportIdCheck(exportId);need(Array.isArray(files)&&files.length>=1&&files.length<=64,'INVALID_PARAMS','Select 1–64 complete original files.');
  files.forEach(file=>{validate(FILE_SELECTION,file);originalFilePath(file);});
  return this.#locked('exports',async(parent,lease)=>{
   const known=(await readdir(parent)).filter(n=>/^[a-z0-9][a-z0-9_-]{0,63}$/.test(n)&&n!=='lease.lock');
   need(known.includes(exportId)||known.length<this.#definition.maximumExports,'BUYER_AGENT_EXPORT_CAPACITY','Use a retained export or release owner-selected obsolete exports before adding another.');
   const directory=await ensure(join(parent,exportId)),selectionSha256=hash(encode(files));
   let selection=await optional(join(directory,'selection.json'),1048576);
   if(selection)need(selection.sha256===selectionSha256&&hash(encode(selection.files))===selectionSha256,
    'BUYER_AGENT_EXPORT_ID_REUSED','This export ID belongs to a different original file selection.');
   else{selection={files,sha256:selectionSha256,createdAt:now()};lease.assertHeld();await atomic(directory,'selection.json',selection);}
   if(await exists(join(directory,'buyer-agent-export.json'))){const complete=await this.manifest(exportId);return {exportId,manifest:complete.manifest,manifestSha256:complete.manifestSha256,replayed:true};}
   const entries=[];let total=0;
   for(let i=0;i<files.length;i++){
    context.signal?.throwIfAborted();
    const slot=String(i+1).padStart(3,'0'),filePath=join(directory,slot+'.data'),partPath=join(directory,slot+'.part');
    let receipt=await optional(join(directory,slot+'.json'),1048576);
    if(receipt){
     need(receipt.selectionSha256===hash(encode(files[i])),'BUYER_AGENT_EXPORT_CHANGED','The retained source file selection changed.');
     if(!await exists(filePath)){await verifyFile(partPath,receipt.file);lease.assertHeld();await link(partPath,filePath);await sync(directory);}
     await verifyFile(filePath,receipt.file);await unlink(partPath).catch(e=>{if(e.code!=='ENOENT')throw e;});
    }else{
     await unlink(partPath).catch(e=>{if(e.code!=='ENOENT')throw e;});
     const file=await open(partPath,'wx',0o600);let completed=false;
     try{
      const native=await receive(files[i],async(response,signal)=>{
       const digest=createHash('sha256');let count=0;
       for await(const chunk of response.body??[]){
        signal?.throwIfAborted();count+=chunk.length;
        need(count<=this.#definition.maximumFileBytes&&total+count<=this.#definition.maximumExportBytes,
         'BUYER_AGENT_EXPORT_TOO_LARGE','The original selected files exceed this host receiving capacity.');
        let written=0;while(written<chunk.length){const result=await file.write(chunk,written,chunk.length-written,null);need(result.bytesWritten>0,'BUYER_AGENT_FILE_WRITE_FAILED','The original receiving file could not be saved.');written+=result.bytesWritten;}digest.update(chunk);
       }
       const sha256=digest.digest('hex'),length=response.headers.get('content-length'),expected=response.headers.get('x-content-sha256');
       need(length!==null&&/^(0|[1-9][0-9]*)$/.test(length)&&Number(length)===count,
        'BUYER_AGENT_RESPONSE_INCOMPLETE','The native complete file differs from its declared byte count.');
       need((expected===null||SHA.test(expected)&&expected===sha256)&&
        (files[i].expectedSha256===undefined||files[i].expectedSha256===sha256),
        'BUYER_AGENT_NATIVE_FILE_CHANGED','The original complete file differs from its native or selected SHA256.');
       const type=response.headers.get('content-type')??'application/octet-stream';
       need(type.length<=255&&!/[\r\n\0]/.test(type),'BUYER_AGENT_FILE_METADATA_INVALID','The original file media type is invalid.');
       return {file:{name:slot+'-'+fileName(files[i]),bytes:count,sha256,contentType:type},nativeSha256:expected};
      },context);
      await file.sync();await file.close();
      receipt={selectionSha256:hash(encode(files[i])),selection:files[i],file:native.file,
       source:{connection:native.connection,path:originalFilePath(files[i]),nativeSha256:native.nativeSha256,receivedAt:now()}};
      lease.assertHeld();await atomic(directory,slot+'.json',receipt);await link(partPath,filePath);await sync(directory);
      completed=true;await unlink(partPath);
     }finally{await file.close().catch(()=>{});if(!completed&&!receipt)await unlink(partPath).catch(()=>{});}
    }
    total+=receipt.file.bytes;need(total<=this.#definition.maximumExportBytes,'BUYER_AGENT_EXPORT_TOO_LARGE','The complete selected export exceeds its declared capacity.');
    entries.push({...receipt.file,slot,selection:receipt.selection,source:{path:receipt.source.path,nativeSha256:receipt.source.nativeSha256,
     receivedAt:receipt.source.receivedAt,instanceId:receipt.source.connection.instanceId,pid:receipt.source.connection.pid,
     launchSha256:receipt.source.connection.launchSha256}});
   }
   const manifest={schema:BUYER_AGENT_EXPORT,exportId,directory:this.#definition.directory,
    selectionSha256:this.#definition.expectedSelectionSha256,fileSelectionSha256:selectionSha256,createdAt:selection.createdAt,files:entries};
   need(encode(manifest).length<=65000,'BUYER_AGENT_MANIFEST_TOO_LARGE','Select fewer original files in one complete export.');
   lease.assertHeld();await atomic(directory,'buyer-agent-export.json',manifest);
   const complete=await this.manifest(exportId);return {exportId,manifest:complete.manifest,manifestSha256:complete.manifestSha256,replayed:false};
  });
 }
 async file({exportId,file:name,readId,expectedManifestSha256,expectedSha256,offset=0,limit=65536}){
  const selected=await this.manifest(exportId);
  need(SHA.test(expectedManifestSha256??'')&&selected.manifestSha256===expectedManifestSha256,
   'BUYER_AGENT_EXPORT_CHANGED','Repeat the complete original manifest SHA256 for this retained file.');
  const metadata=name===BUYER_AGENT_MANIFEST?{...selected.manifestFile,contentType:'application/json'}:selected.manifest.files.find(f=>f.name===name);
  need(metadata,'BUYER_AGENT_FILE_NOT_LISTED','Select one original file named in this complete export.');
  const directory=join(this.#root,'exports',exportId),path=join(directory,name===BUYER_AGENT_MANIFEST?BUYER_AGENT_MANIFEST:metadata.slot+'.data');
  const result=await this.#reads.read({scope:exportId,key:name,kind:'buyer-runbook',directory,readId,expectedSha256,offset,limit,
   load:async()=>{const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
    try{const info=await file.stat();need(info.isFile()&&(!process.getuid||info.uid===process.getuid())&&!(info.mode&0o077),
     'BUYER_AGENT_FILE_CHANGED','The retained native file is no longer owner-private.');return {readonlyFileHandle:file,bytes:metadata.bytes,sha256:metadata.sha256,name,type:metadata.contentType};}
    catch(error){await file.close();throw error;}}});
  return {exportId,manifestSha256:selected.manifestSha256,...result};
 }
 async release(exportId,readId){exportIdCheck(exportId);await this.#reads.release(exportId,readId);return {exportId,readId,released:true};}
 async close(){this.#closing=true;await Promise.allSettled([...this.#tails.values()]);await this.#reads.close();}
}
async function verifyFile(path,metadata){
 const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 try{
  const before=await file.stat(),digest=createHash('sha256');
  need(before.isFile()&&before.size===metadata.bytes&&(!process.getuid||before.uid===process.getuid())&&!(before.mode&0o077),
   'BUYER_AGENT_FILE_CHANGED','The retained receiving file changed.');
  const buffer=Buffer.alloc(65536);let position=0;
  while(position<before.size){const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,before.size-position),position);need(bytesRead>0,'BUYER_AGENT_FILE_CHANGED','The retained receiving file ended early.');digest.update(buffer.subarray(0,bytesRead));position+=bytesRead;}
  const after=await file.stat();need(['dev','ino','size','mtimeMs','ctimeMs'].every(k=>before[k]===after[k])&&digest.digest('hex')===metadata.sha256,
   'BUYER_AGENT_FILE_CHANGED','The retained receiving file differs from its complete original SHA256.');
 }finally{await file.close();}
}
function selectedId(value,pattern){need(typeof value==='string'&&pattern.test(value),'INVALID_PARAMS','Select the original native item identifier.');return value;}
export function originalFilePath(s){
 const run=/^(draft-[a-f0-9-]{36}|import-[a-f0-9]{32})$/,op=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
 switch(s.kind){
  case 'sdk':selectedId(s.id,/^client-[a-f0-9]{64}$/);need(SDK_FILES.includes(s.name),'INVALID_PARAMS','Select an original SDK filename.');return '/files/clients/'+s.id+'/'+s.name;
  case 'operator':selectedId(s.id,/^preset-[a-f0-9]{64}$/);return '/files/operator/'+s.id+'/settings.json';
  case 'request':selectedId(s.id,/^request-[a-f0-9]{64}$/);need(['body','handoff'].includes(s.name),'INVALID_PARAMS','Select original request body or handoff.');return '/files/requests/'+s.id+'/'+s.name;
  case 'paid-handoff':selectedId(s.id,/^file-[a-f0-9]{64}$/);return '/files/paid-files/'+s.id+'/handoff';
  case 'resource':case 'paid-resource':selectedId(s.id,run);selectedId(s.operation,op);return '/files/'+s.id+'/'+(s.kind==='resource'?'resources':'paid-files')+'/'+s.operation;
  case 'report':selectedId(s.id,run);need(['json','html'].includes(s.format),'INVALID_PARAMS','Select an original report format.');return '/files/'+s.id+'/report.'+s.format;
  case 'accounting':selectedId(s.id,run);return '/files/'+s.id+'/accounting.csv';
  default:throw fail('INVALID_PARAMS','Select a complete original Buyer file kind.');
 }
}
function fileName(s){
 originalFilePath(s);
 if(s.kind==='sdk')return s.name;
 if(s.kind==='operator')return 'operator-settings.json';
 if(s.kind==='request')return s.name==='handoff'?'request.handoff.json':'request.body';
 if(s.kind==='paid-handoff')return 'merchant.handoff.json';
 if(s.kind==='report')return 'buyer-report.'+s.format;
 if(s.kind==='accounting')return 'buyer-accounting.csv';
 return s.operation+'.bin';
}
