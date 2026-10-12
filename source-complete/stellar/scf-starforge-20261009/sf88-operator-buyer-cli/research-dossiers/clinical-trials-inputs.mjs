// MIT. Retain an original ClinicalTrials source packet; use the standard Python ZIP reader.
// This module never calls the registry or acquires the original provider workspace lease.
import {createHash,randomUUID} from 'node:crypto';
import {open,link,unlink,mkdtemp,rm,readdir,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {privateDirectory,readBytes,readJson,writeJson,safeCode as nativeCode} from '../node/store.mjs';
import {withPrivateLock} from '../../sf30-seller-sdk/routescan/quota.mjs';
import {need,object,sha,json,validateEdition} from './clinical-trials-model.mjs';
const MAX_PACKET=128*1024*1024,MAX_EDITION=64*1024*1024;
const SCRIPT=fileURLToPath(new URL('./clinical-trials-packet.py',import.meta.url));
const code=error=>nativeCode(error?.code,'CLINICALTRIALS_PACKET_READ_FAILED');
const sourceId=value=>{need(typeof value==='string'&&/^ctsrc_[a-f0-9]{64}$/.test(value),'CLINICALTRIALS_INPUT_ID_INVALID');return value;};
const digest=value=>{need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'CLINICALTRIALS_PACKET_SHA_REQUIRED');return value;};
async function sync(directory){const handle=await open(directory,'r');try{await handle.sync();}finally{await handle.close();}}
async function runReader(python,args,{signal}={}){
 signal?.throwIfAborted();
 const child=spawn(python,[SCRIPT,...args],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 let out='',error='',spawnError=null;
 child.stdout.on('data',data=>{if(out.length<65536)out+=data.toString('utf8');});
 child.stderr.on('data',data=>{if(error.length<65536)error+=data.toString('utf8');});
 const abort=()=>child.kill('SIGTERM');signal?.addEventListener('abort',abort,{once:true});
 if(signal?.aborted)abort();
 const result=await new Promise(resolve=>{child.once('error',e=>{spawnError=e;});child.once('close',(exitCode,exitSignal)=>resolve({exitCode,exitSignal}));});
 signal?.removeEventListener('abort',abort);
 if(signal?.aborted)throw Object.assign(new Error('OPERATION_ABORTED'),{code:'OPERATION_ABORTED'});
 if(spawnError)throw Object.assign(new Error('CLINICALTRIALS_PYTHON_UNAVAILABLE'),{code:'CLINICALTRIALS_PYTHON_UNAVAILABLE'});
 if(result.exitCode!==0){
  let failure;try{failure=JSON.parse(error.trim().split('\n').at(-1));}catch{}
  const selected=/^CLINICALTRIALS_[A-Z0-9_]+$/.test(failure?.error??'')?failure.error:'CLINICALTRIALS_PACKET_READ_FAILED';
  throw Object.assign(new Error(selected),{code:selected});
 }
 let value;try{value=JSON.parse(out.trim());}catch{}
 need(value?.status==='CLINICALTRIALS_RETAINED_SOURCE_READ'&&/^[a-f0-9]{64}$/.test(value.sha256)&&
  Number.isSafeInteger(value.bytes)&&value.bytes>0&&value.bytes<=MAX_EDITION,'CLINICALTRIALS_READER_RESULT_INVALID');
 return value;
}
export async function openClinicalTrialsInputs({directory,python='python3'}={}){
 need(typeof python==='string'&&python.length>0&&!/[\u0000-\u001f]/.test(python),'CLINICALTRIALS_PYTHON_INVALID');
 directory=await privateDirectory(directory);const jobs=new Set(),work=new Set();let closed=false;
 const folder=id=>join(directory,sourceId(id));
 async function get(id){
  const value=await readJson(join(folder(id),'input.json'),8*1024*1024);
  need(value.schema==='stellar-forge.clinicaltrials-research-input.v1'&&value.sourceId===id&&
   value.packetSha256===id.slice(6)&&Array.isArray(value.captures),'CLINICALTRIALS_INPUT_CHANGED');
  return value;
 }
 async function importStreamCore(stream,{expectedSha256,expectedBytes=null,signal}={}){
  need(!closed,'CLINICALTRIALS_WORKSPACE_CLOSED');expectedSha256=digest(expectedSha256);
  need(expectedBytes===null||Number.isSafeInteger(expectedBytes)&&expectedBytes>0&&expectedBytes<=MAX_PACKET,'CLINICALTRIALS_PACKET_SIZE_INVALID');
  const id='ctsrc_'+expectedSha256,dir=await privateDirectory(folder(id));
  return withPrivateLock(dir,'input.lock',async()=>{
   const stage=await mkdtemp(join(dir,'.receiving-'));const temporary=join(stage,'packet.zip');
   let handle=null,published=false;
   try{
    handle=await open(temporary,'wx',0o600);const hasher=createHash('sha256');let count=0;
    for await(const piece of stream){
     signal?.throwIfAborted();const bytes=Buffer.from(piece);count+=bytes.length;
     need(count<=MAX_PACKET,'CLINICALTRIALS_PACKET_SIZE_INVALID');hasher.update(bytes);
     let at=0;while(at<bytes.length){const result=await handle.write(bytes,at,bytes.length-at);need(result.bytesWritten>0,'CLINICALTRIALS_SOURCE_WRITE_FAILED');at+=result.bytesWritten;}
    }
    need(count>0&&(expectedBytes===null||count===expectedBytes)&&hasher.digest('hex')===expectedSha256,'CLINICALTRIALS_PACKET_CHANGED');
    await handle.sync();await handle.close();handle=null;
    const output=join(stage,'inspection.json');
    const receipt=await runReader(python,['--input',temporary,'--expected-sha256',expectedSha256,'--output',output],{signal});
    const bytes=await readBytes(output,8*1024*1024);need(bytes.length===receipt.bytes&&sha(bytes)===receipt.sha256,'CLINICALTRIALS_READER_OUTPUT_CHANGED');
    const inspection=JSON.parse(bytes.toString('utf8'));
    need(inspection.packetSha256===expectedSha256&&inspection.packetBytes===count,'CLINICALTRIALS_INPUT_CHANGED');
    try{await link(temporary,join(dir,'packet.zip'));published=true;}catch(error){
     if(error.code!=='EEXIST')throw error;
     const existing=await readBytes(join(dir,'packet.zip'),MAX_PACKET);
     need(existing.length===count&&sha(existing)===expectedSha256,'CLINICALTRIALS_INPUT_CHANGED');published=true;
    }
    const value={...inspection,sourceId:id,receivedAt:new Date().toISOString()};
    try{
     const prior=await get(id);
     need(prior.packetSha256===expectedSha256&&prior.manifestSha256===inspection.manifestSha256,'CLINICALTRIALS_INPUT_CHANGED');
     await sync(dir);return prior;
    }catch(error){if(error.code!=='ENOENT')throw error;}
    await writeJson(join(dir,'input.json'),value,{exclusive:true});await sync(dir);return value;
   }finally{
    await handle?.close().catch(()=>{});
    // A committed source packet is never removed if metadata publication needs continuation.
    await rm(stage,{recursive:true,force:true});
   }
  });
 }
 async function importFile(path,options={}){
  need(typeof path==='string'&&path===resolve(path),'CLINICALTRIALS_ABSOLUTE_INPUT_REQUIRED');
  const handle=await open(path,'r');try{
   const before=await handle.stat();need(before.isFile()&&before.size<=MAX_PACKET,'CLINICALTRIALS_PACKET_SIZE_INVALID');
   const value=await managedImport(handle.createReadStream({autoClose:false}),{...options,expectedBytes:options.expectedBytes??before.size});
   const after=await handle.stat();need(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'CLINICALTRIALS_PACKET_CHANGED');
   return value;
  }finally{await handle.close();}
 }
 async function list({after='',limit=30}={}){
  need(typeof after==='string'&&(after===''||/^ctsrc_[a-f0-9]{64}$/.test(after))&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'CLINICALTRIALS_INPUT_PAGE_INVALID');
  const names=(await readdir(directory)).filter(x=>/^ctsrc_[a-f0-9]{64}$/.test(x)&&x>after).sort();
  const items=[];let last=after,more=false;
  for(const id of names){
   let item;try{item=await get(id);}catch(error){if(error.code==='ENOENT')continue;throw error;}
   if(items.length===limit){more=true;break;}items.push(item);last=id;
  }
  return {items,next:more?last:null};
 }
 async function buildCore(id,plan,{output,signal}={}){
  need(!closed,'CLINICALTRIALS_WORKSPACE_CLOSED');const input=await get(id);
  need(object(plan)&&plan.sourceId===id&&input.captures.some(row=>row.id===plan.captureId),'CLINICALTRIALS_CAPTURE_NOT_FOUND');
  const stage=await mkdtemp(join(folder(id),'.review-')),planPath=join(stage,'plan.json');
  const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  jobs.add(controller);
  try{
   await writeJson(planPath,plan,{exclusive:true});
   const receipt=await runReader(python,['--input',join(folder(id),'packet.zip'),'--expected-sha256',input.packetSha256,
    '--plan',planPath,'--output',output],{signal:controller.signal});
   const bytes=await readBytes(output,MAX_EDITION);need(bytes.length===receipt.bytes&&sha(bytes)===receipt.sha256,'CLINICALTRIALS_READER_OUTPUT_CHANGED');
   const value=validateEdition(JSON.parse(bytes.toString('utf8')));
   need(value.sourcePacket.sha256===input.packetSha256&&value.sourcePacket.manifestSha256===input.manifestSha256&&
    value.usage.captureId===plan.captureId&&value.usage.sourceId===id&&value.usage.operationId===plan.operationId&&
    value.query===plan.question&&value.label===plan.label,'CLINICALTRIALS_EDITION_PLAN_CHANGED');
   return {bytes,value,sha256:receipt.sha256};
  }finally{signal?.removeEventListener('abort',abort);jobs.delete(controller);await rm(stage,{recursive:true,force:true});}
 }
 async function packet(id){
  const input=await get(id),bytes=await readBytes(join(folder(id),'packet.zip'),MAX_PACKET);
  need(bytes.length===input.packetBytes&&sha(bytes)===input.packetSha256,'CLINICALTRIALS_INPUT_CHANGED');
  return {bytes,sha256:input.packetSha256,filename:'clinicaltrials-workspace-'+input.packetSha256.slice(0,12)+'.zip'};
 }
 function tracked(fn,signal){
  need(!closed,'CLINICALTRIALS_WORKSPACE_CLOSED');
  const controller=new AbortController(),abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const entry={controller,promise:null};
  const promise=(async()=>{controller.signal.throwIfAborted();return fn(controller.signal);})();
  entry.promise=promise;work.add(entry);
  promise.finally(()=>{work.delete(entry);signal?.removeEventListener('abort',abort);}).catch(()=>{});
  return promise;
 }
 const managedImport=(stream,options={})=>tracked(async signal=>{
  const abort=()=>stream.destroy?.(Object.assign(new Error('OPERATION_ABORTED'),{code:'OPERATION_ABORTED'}));
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  try{return await importStreamCore(stream,{...options,signal});}
  finally{signal.removeEventListener('abort',abort);}
 },options.signal);
 const managedBuild=(id,plan,options={})=>tracked(signal=>buildCore(id,plan,{...options,signal}),options.signal);
 return {directory,python,identity:{schema:'stellar-forge.clinicaltrials-original-packet-reader.v1'},get,list,importStream:managedImport,importFile,build:managedBuild,packet,
  async close(){closed=true;for(const entry of work)entry.controller.abort();for(const controller of jobs)controller.abort();await Promise.allSettled([...work].map(entry=>entry.promise));}};
}
