// MIT. Exact Crossref HTTPS responses, retained captures and shared original-account caching.
import {request as httpsRequest,Agent} from 'node:https';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {privateDirectory,withPrivateLock,atomicJson,readPrivateJson} from '../routescan/quota.mjs';
import {beginUpstreamRequest} from '../upstream-handler.mjs';
import {openCrossrefGate} from './gate.mjs';
import {requestFor,parseCapture,buildCrossrefEdition,need,sha256,json,retainedHeaders} from './metadata.mjs';
const POINTER_SCHEMA='stellar-forge.crossref-cache.v1';

function contact(value){
  if(value===undefined||value===null||value==='')return null;
  need(typeof value==='string'&&value.length<=254&&/^[^@\s<>()]+@[^@\s<>()]+\.[^@\s<>()]+$/.test(value),'CROSSREF_CONTACT_INVALID');
  return value;
}
function errorCode(error){return typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/.test(error.code)?error.code:'CROSSREF_SOURCE_UNAVAILABLE';}
async function acquire(directory,name,work,signal){
  while(true){
    signal.throwIfAborted();let entered=false;
    try{return await withPrivateLock(directory,name,async()=>{entered=true;return work();});}
    catch(error){if(entered||error.code!=='ROUTESCAN_RECORD_BUSY')throw error;await delay(40,undefined,{signal});}
  }
}
export async function createCrossrefSource({directory,account='crossref-public',mailto,timeoutMs=30000,
  maxResponseBytes=16*1024*1024,cacheSeconds=86400,env=process.env}={}){
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=120000,'CROSSREF_TIMEOUT_INVALID');
  need(Number.isSafeInteger(maxResponseBytes)&&maxResponseBytes>=1024&&maxResponseBytes<=16*1024*1024,'CROSSREF_RESPONSE_LIMIT_INVALID');
  need(Number.isSafeInteger(cacheSeconds)&&cacheSeconds>=0&&cacheSeconds<=604800,'CROSSREF_CACHE_TTL_INVALID');
  mailto=contact(mailto);
  await privateDirectory(directory);
  const capturesDirectory=join(directory,'captures'),cacheDirectory=join(directory,'cache'),gateDirectory=join(directory,'gate');
  await Promise.all([privateDirectory(capturesDirectory),privateDirectory(cacheDirectory)]);
  const gate=await openCrossrefGate({directory:gateDirectory,account,mailto});
  const agent=new Agent({keepAlive:false,proxyEnv:env});
  const userAgent='StarforgeCrossref/1.0'+(mailto?' (mailto:'+mailto+')':'');
  let closed=false,closing,lastCaptureId=null,lastError=null;
  const pending=new Set(),counts={requests:0,cacheHits:0,originalCalls:0,retained:0};
  async function retainCapture(input,{cache=false}={}){
    const {record}=parseCapture(input,{validateResponse:false}),captureId=sha256(json(record));
    let created=true;
    try{await atomicJson(capturesDirectory,captureId+'.json',record,{exclusive:true});}
    catch(error){
      if(error.code!=='EEXIST')throw error;created=false;
      need(sha256(json(await readPrivateJson(join(capturesDirectory,captureId+'.json'),24*1024*1024)))===captureId,'CROSSREF_RETAINED_CAPTURE_CHANGED',503);
    }
    if(created)counts.retained++;lastCaptureId=captureId;
    if(cache&&record.status===200){
      parseCapture(record);
      const requestHash=sha256(record.url);
      await atomicJson(cacheDirectory,requestHash+'.json',{schema:POINTER_SCHEMA,requestHash,captureId,
        retrievedAt:record.retrievedAt,expiresAt:Date.parse(record.retrievedAt)+cacheSeconds*1000});
    }
    return {captureId,capture:record};
  }
  async function readCapture(captureId){
    need(typeof captureId==='string'&&/^[a-f0-9]{64}$/.test(captureId),'CROSSREF_CAPTURE_ID_INVALID');
    const record=await readPrivateJson(join(capturesDirectory,captureId+'.json'),24*1024*1024);
    need(sha256(json(record))===captureId,'CROSSREF_RETAINED_CAPTURE_CHANGED',503);
    return parseCapture(record,{validateResponse:false}).record;
  }
  async function cached(request){
    if(!cacheSeconds)return null;
    let pointer;
    try{pointer=await readPrivateJson(join(cacheDirectory,sha256(request.url)+'.json'));}
    catch(error){if(error.code==='ENOENT')return null;throw error;}
    need(pointer.schema===POINTER_SCHEMA&&pointer.requestHash===sha256(request.url)&&Number.isSafeInteger(pointer.expiresAt),
      'CROSSREF_CACHE_POINTER_CHANGED',503);
    if(pointer.expiresAt<=Date.now())return null;
    const capture=await readCapture(pointer.captureId);
    need(capture.url===request.url&&capture.status===200&&capture.retrievedAt===pointer.retrievedAt,'CROSSREF_CACHE_SOURCE_CHANGED',503);
    return {captureId:pointer.captureId,capture,cached:true};
  }
  async function exchange(request,signal){
    counts.originalCalls++;
    const startedAt=new Date().toISOString();
    const captured=await new Promise((resolve,reject)=>{
      let settled=false,req;
      const finish=(error,value)=>{if(settled)return;settled=true;error?reject(error):resolve(value);};
      req=httpsRequest(request.url,{method:'GET',agent,signal,headers:{
        accept:'application/vnd.crossref-api-message+json, application/json',
        'accept-encoding':'identity','user-agent':userAgent,
      }},res=>{
        const chunks=[];let length=0;
        res.on('data',chunk=>{
          length+=chunk.length;
          if(length>maxResponseBytes){
            const error=Object.assign(new Error('CROSSREF_RESPONSE_SIZE_LIMIT'),{code:'CROSSREF_RESPONSE_SIZE_LIMIT',status:502});
            res.destroy(error);req.destroy(error);finish(error);return;
          }
          chunks.push(chunk);
        });
        res.once('error',error=>finish(error));
        res.once('aborted',()=>finish(Object.assign(new Error('CROSSREF_RESPONSE_INTERRUPTED'),{code:'CROSSREF_RESPONSE_INTERRUPTED',status:502})));
        res.once('end',()=>{
          if(settled)return;
          const headers=Object.fromEntries(Object.entries(res.headers).flatMap(([key,value])=>
            typeof value==='string'?[[key,value]]:Array.isArray(value)?[[key,value.join(', ')]]:[]));
          finish(null,{request,url:request.url,finalUrl:request.url,status:res.statusCode,
            startedAt,retrievedAt:new Date().toISOString(),headers:retainedHeaders(headers),body:Buffer.concat(chunks)});
        });
      });
      req.once('error',error=>finish(error));req.end();
    });
    // Preserve the exact source before projecting metadata or publishing the cache pointer.
    const retained=await retainCapture(captured);
    return {status:retained.capture.status,headers:retained.capture.headers,...retained,cached:false};
  }
  function request(kind,input,{signal,refresh=false}={}){
    const operation=(async()=>{
      need(!closed,'CROSSREF_SOURCE_CLOSED',503);need(typeof refresh==='boolean','CROSSREF_REFRESH_INVALID');
      const selected=requestFor(kind,input),lifetime=beginUpstreamRequest(signal,timeoutMs);
      counts.requests++;
      try{
        if(!refresh){const saved=await cached(selected);if(saved){counts.cacheHits++;return saved;}}
        const result=await acquire(cacheDirectory,sha256(selected.url)+'.lock',async()=>{
          if(!refresh){const saved=await cached(selected);if(saved){counts.cacheHits++;return saved;}}
          const received=await gate.run(selected.pool,()=>exchange(selected,lifetime.signal),{signal:lifetime.signal});
          if(received.capture.status===200&&cacheSeconds){
            let valid=true;try{parseCapture(received.capture);}catch{valid=false;}
            if(valid)await retainCapture(received.capture,{cache:true});
          }
          return received;
        },lifetime.signal);
        lastError=null;return result;
      }catch(error){lastError=errorCode(error);throw error;}
      finally{lifetime.close();}
    })();
    pending.add(operation);operation.finally(()=>pending.delete(operation)).catch(()=>{});return operation;
  }
  async function edition(kind,input,options={}){
    const result=await request(kind,input,options),selected=result.capture.request;
    return {...result,envelope:buildCrossrefEdition({captures:[result.capture],
      dois:selected.kind==='work'?[selected.doi]:selected.dois,
      query:selected.kind==='work'?'Publication metadata for '+selected.doi:
        'Registered editorial updates for '+selected.dois.join('; '),
      label:selected.kind==='work'?'Crossref publication metadata':'Crossref registered updates'})};
  }
  return {request,edition,retainCapture,readCapture,
    async snapshot(){return {schema:'stellar-forge.crossref-source.v1',account,mode:mailto?'polite':'public',
      cacheSeconds,counts:{...counts},lastCaptureId,lastError,gate:await gate.snapshot()};},
    close(){return closing??=(async()=>{closed=true;await Promise.allSettled([...pending]);agent.destroy();await gate.close();})();}};
}
