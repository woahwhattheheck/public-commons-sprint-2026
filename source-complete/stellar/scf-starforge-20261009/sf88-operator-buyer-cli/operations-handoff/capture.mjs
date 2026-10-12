// MIT. Capture selected original Inbox jobs and verify retained output without executing them.
import {constants} from 'node:fs';
import {open,lstat,realpath,link,unlink} from 'node:fs/promises';
import {join,resolve,dirname,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {openQueue} from '../queue.mjs';
import {config,execution} from '../config.mjs';
import {InboxResponse} from '../node/inbox.mjs';
import {SCHEMA,FILES,MAX_BYTES,MAX_JOBS,sha,canonical,need,inspectHandoff} from './contract.mjs';

const privateStat=s=>s.isFile()&&(process.platform==='win32'||(s.mode&0o077n)===0n&&s.uid===BigInt(process.getuid()));
const sameStat=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
const now=()=>new Date().toISOString();
async function readSource(path,name,{optional=false,limit=MAX_BYTES}={}){
  let handle;
  try{handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));}
  catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
  try{
    const before=await handle.stat({bigint:true});
    need(privateStat(before)&&before.size<=BigInt(limit),'BUYER_ORIGINAL_PRIVATE_SOURCE_REQUIRED');
    const buffer=Buffer.alloc(Number(before.size)+1);let length=0;
    while(length<buffer.length){const result=await handle.read(buffer,length,buffer.length-length,length);if(!result.bytesRead)break;length+=result.bytesRead;}
    const raw=buffer.subarray(0,length),after=await handle.stat({bigint:true});
    need(BigInt(raw.length)===before.size&&raw.length<=limit&&sameStat(before,after)&&await realpath(path)===resolve(path),'BUYER_ORIGINAL_SOURCE_CHANGED');
    return {path,stat:after,source:{name,bytes:raw.length,sha256:sha(raw),contentBase64:raw.toString('base64')}};
  }finally{await handle.close();}
}
async function currentSource(saved){
  if(!saved)return;
  const current=await lstat(saved.path,{bigint:true});
  need(!current.isSymbolicLink()&&sameStat(saved.stat,current),'BUYER_SOURCE_CHANGED_DURING_CAPTURE');
}
function missingOutput(job){
  const saved=job.outcome?.responseFile;
  return {state:!saved||saved.status==='NOT_REQUESTED'?'NOT_REQUESTED':'NOT_SAVED',
    bytes:null,sha256:null,originalState:saved?.status??'NOT_REQUESTED',code:null};
}
export async function captureInbox({directory,intentIds,maxVerifyBytes=268435456,signal}={}){
  need(typeof directory==='string'&&isAbsolute(directory)&&resolve(directory)===directory,'BUYER_INBOX_ABSOLUTE_PATH_REQUIRED');
  need(Array.isArray(intentIds)&&intentIds.length>0&&intentIds.length<=MAX_JOBS&&new Set(intentIds).size===intentIds.length&&
    intentIds.every(x=>typeof x==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(x)),'BUYER_SELECT_ORIGINAL_INTENTS');
  need(Number.isSafeInteger(maxVerifyBytes)&&maxVerifyBytes>=0&&maxVerifyBytes<=1073741824,'BUYER_OUTPUT_LIMIT_INVALID');
  need(signal===undefined||signal instanceof AbortSignal,'BUYER_SIGNAL_INVALID');
  const captureStartedAt=now(),queue=await openQueue(directory),inbox=await readSource(join(directory,'inbox.json'),'inbox.json');
  const jobs=[];let size=inbox.source.contentBase64.length,totalVerified=0;
  for(const intentId of intentIds){
    need(!signal?.aborted,'BUYER_CAPTURE_ABORTED');
    const started=now(),native=await queue.show(intentId),jobDir=join(queue.root,'jobs',native.id),sources=[];
    for(const name of FILES){
      const path=name==='evidence.json'?native.evidencePath:join(jobDir,name);
      if(typeof path!=='string')continue;
      const item=await readSource(path,name,{optional:name!=='request.json'});
      if(item){size+=item.source.contentBase64.length;need(size<MAX_BYTES,'BUYER_SELECT_SMALLER_CAPTURE');sources.push(item);}
    }
    let output=missingOutput(native);
    const saved=native.outcome?.responseFile;
    if(saved?.status==='SAVED'){
      if(!Number.isSafeInteger(saved.bytes)||saved.bytes<0)need(false,'BUYER_SAVED_OUTPUT_METADATA_INVALID');
      if(saved.bytes>maxVerifyBytes||totalVerified+saved.bytes>1073741824)
        output={state:'OVER_LIMIT',bytes:null,sha256:null,originalState:'SAVED',code:'BUYER_OUTPUT_REVIEW_LIMIT'};
      else{
        const cfgSource=await readSource(join(jobDir,'execution.json'),'execution.json',{limit:65536});
        need(cfgSource.source.sha256===native.configSha256,'BUYER_ORIGINAL_CONFIG_CHANGED');
        const cfg=await config(join(jobDir,'execution.json')),download=execution(cfg).download;
        need(download!==undefined&&download!==null,'BUYER_ORIGINAL_DOWNLOAD_CONFIG_REQUIRED');
        try{
          const response=new InboxResponse(native,download,fileURLToPath(new URL('..',import.meta.url)));
          const verified=await response.verify({signal});
          output={state:'VERIFIED',...verified,reader:'ORIGINAL_SF88_INBOX_RESPONSE_VERIFY',originalState:'SAVED',code:null};
          totalVerified+=verified.bytes;
          await currentSource(cfgSource);
        }catch(error){
          if(signal?.aborted)throw error;
          output={state:'UNAVAILABLE',bytes:null,sha256:null,originalState:'SAVED',
            code:typeof error.code==='string'&&/^[A-Z0-9_]{1,120}$/.test(error.code)?error.code:'RETAINED_OUTPUT_READ_FAILED'};
        }
      }
    }
    const after=await queue.show(intentId);
    need(canonical(native)===canonical(after),'BUYER_INBOX_CHANGED_DURING_CAPTURE');
    for(const source of sources)await currentSource(source);
    jobs.push({captureStartedAt:started,capturedAt:now(),native,files:sources.map(x=>x.source),output});
  }
  await currentSource(inbox);
  const packet={schema:SCHEMA,captureStartedAt,capturedAt:now(),inbox:inbox.source,jobs,
    producer:{reader:'ORIGINAL_SF88_OPEN_QUEUE_SHOW',outputReader:'ORIGINAL_SF88_INBOX_RESPONSE_VERIFY',
      noExecution:true,maxVerifyBytes,verifiedBytes:totalVerified}};
  const raw=Buffer.from(JSON.stringify(packet,null,2)+'\n');
  need(raw.length<=MAX_BYTES,'BUYER_SELECT_SMALLER_CAPTURE');
  const report=inspectHandoff(raw);
  return {packet,raw,report};
}
export async function saveHandoff(destination,raw){
  need(typeof destination==='string'&&isAbsolute(destination)&&resolve(destination)===destination&&
    Buffer.isBuffer(raw)&&raw.length<=MAX_BYTES,'BUYER_HANDOFF_DESTINATION_INVALID');
  inspectHandoff(raw);
  const parent=await lstat(dirname(destination));
  need(parent.isDirectory()&&!parent.isSymbolicLink()&&await realpath(dirname(destination))===dirname(destination)&&
    (process.platform==='win32'||(parent.mode&0o077)===0&&parent.uid===process.getuid()),'BUYER_PRIVATE_OUTPUT_DIRECTORY_REQUIRED');
  const temporary=join(dirname(destination),'.buyer-operations-'+randomUUID());
  const file=await open(temporary,'wx',0o600);
  try{
    await file.writeFile(raw);await file.sync();await file.close();
    try{await link(temporary,destination);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const prior=await readSource(destination,'handoff.json');
      need(prior.source.sha256===sha(raw)&&prior.source.bytes===raw.length,'BUYER_HANDOFF_DESTINATION_EXISTS');
    }
    await unlink(temporary);
    const dir=await open(dirname(destination),'r');try{await dir.sync();}finally{await dir.close();}
    return {path:destination,bytes:raw.length,sha256:sha(raw)};
  }finally{await file.close().catch(()=>{});await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
