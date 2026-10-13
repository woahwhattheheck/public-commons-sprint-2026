// MIT. Exact chunk replay for a closed customer package; no executable upload.
import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { initializationDirectory, initializationBytes, retainInitializationFile } from '../../initialization.mjs';
import { acquireCollectionLease } from '../model.mjs';
import { bytes, need, hash, digest, publish, measure, MAX_PACKAGE, CHUNK } from './format.mjs';
const id=value=>{need(hash(value),'CUSTOMER_DELIVERY_UPLOAD_SHA');return value;};
export const UPLOAD_BATCH_CHUNKS=16;
const CACHE_UPLOADS=4, CACHE_PARTS=131072;
const stamp=stat=>[stat.dev,stat.ino,stat.mtimeNs,stat.ctimeNs].map(String).join(':');

export async function openUploads(directory){
 await initializationDirectory(directory,{create:true});
 // Advisory only. Original immutable part files and final package SHA remain
 // authoritative. Another writer's directory change or reopening rebuilds it.
 const cache=new Map();
 function forget(sha256){cache.delete(sha256);}
 function remember(sha256,state){
  cache.delete(sha256);
  if(state.parts.length>CACHE_PARTS)return;
  cache.set(sha256,state);
  let count=[...cache.values()].reduce((n,x)=>n+x.parts.length,0);
  while(cache.size>CACHE_UPLOADS||count>CACHE_PARTS){
   const oldest=cache.keys().next().value;count-=cache.get(oldest).parts.length;cache.delete(oldest);
  }
 }
 function result(state,{includeParts=true}={}){
  return{...state.value,offset:state.offset,complete:state.complete,
   ...(includeParts?{parts:state.parts.map(row=>({...row}))}:{partCount:state.parts.length})};
 }
 async function selected(sha256){
  const base=join(directory,id(sha256));await initializationDirectory(base);
  const value=JSON.parse(await initializationBytes(join(base,'upload.json')));
  need(value.sha256===sha256,'CUSTOMER_DELIVERY_UPLOAD_CHANGED');
  return{base,value};
 }
 async function version(base){return stamp(await lstat(base,{bigint:true}));}
 async function scan(base,value){
  const before=await version(base);let offset=0;const parts=[],byOffset=new Map();
  const names=(await readdir(base)).filter(x=>/^[0-9]+\.part$/.test(x)).sort((a,b)=>Number(a.split('.')[0])-Number(b.split('.')[0]));
  for(const name of names){
   need(Number(name.split('.')[0])===offset,'CUSTOMER_DELIVERY_UPLOAD_GAP');
   const row=await measure(join(base,name));
   need(row.bytes>0&&row.bytes<=CHUNK&&offset+row.bytes<=value.bytes,'CUSTOMER_DELIVERY_UPLOAD_SIZE');
   const part={offset,...row};parts.push(part);byOffset.set(offset,part);offset+=row.bytes;
  }
  let complete=false;
  try{await measure(join(base,'complete.ndjson'),value,MAX_PACKAGE);complete=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  const after=await version(base);need(before===after,'CUSTOMER_DELIVERY_UPLOAD_CHANGED');
  return{value,offset,complete,parts,byOffset,version:after};
 }
 async function current(sha256,base,value,{verify=false}={}){
  const saved=cache.get(sha256),now=await version(base);
  if(!verify&&saved&&saved.version===now&&JSON.stringify(saved.value)===JSON.stringify(value)){
   remember(sha256,saved);return saved;
  }
  const state=await scan(base,value);remember(sha256,state);return state;
 }
 async function lock(sha256,fn){
  const {base,value}=await selected(sha256);const release=await acquireCollectionLease(base);
  try{return await fn(base,value);}catch(error){forget(sha256);throw error;}finally{await release();}
 }
 async function inspect(sha256,options={}){
  // Explicit inspection/reopen always reads the original retained byte census.
  return lock(sha256,async(base,value)=>result(await current(sha256,base,value,{verify:true}),options));
 }
 async function start(input,options={}){
  need(input&&hash(input.sha256)&&Number.isSafeInteger(input.bytes)&&input.bytes>0&&input.bytes<=MAX_PACKAGE&&typeof input.filename==='string'&&input.filename.length>0&&input.filename.length<=200&&!/[\x00-\x1f]/.test(input.filename),'CUSTOMER_DELIVERY_UPLOAD_INPUT');
  const value={sha256:input.sha256,bytes:input.bytes,filename:input.filename};
  const base=join(directory,input.sha256);await initializationDirectory(base,{create:true});
  await retainInitializationFile(join(base,'upload.json'),bytes(value),{resume:true});
  return inspect(input.sha256,options);
 }
 function decoded(input){
  need(input&&Number.isSafeInteger(input.offset)&&input.offset>=0&&typeof input.base64==='string'&&input.base64.length<=Math.ceil(CHUNK/3)*4&&hash(input.sha256),'CUSTOMER_DELIVERY_UPLOAD_CHUNK');
  const body=Buffer.from(input.base64,'base64');
  need(body.length>0&&body.length<=CHUNK&&body.toString('base64')===input.base64&&digest(body)===input.sha256,'CUSTOMER_DELIVERY_UPLOAD_CHUNK');
  return{offset:input.offset,sha256:input.sha256,body};
 }
 async function append(sha256,parts,options){
  return lock(sha256,async(base,value)=>{
   const state=await current(sha256,base,value);let planned=state.offset,previous=null;
   // Validate the complete bounded batch before the first write. A process exit
   // between durable parts may retain a prefix; an exact replay rejoins it.
   for(const part of parts){
    need(previous===null||part.offset===previous,'CUSTOMER_DELIVERY_UPLOAD_BATCH_ORDER');
    previous=part.offset+part.body.length;
    const prior=state.byOffset.get(part.offset);
    if(prior)need(prior.bytes===part.body.length&&prior.sha256===part.sha256,'CUSTOMER_DELIVERY_UPLOAD_REPLAY_CHANGED');
    else{
     need(!state.complete&&part.offset===planned&&planned+part.body.length<=state.value.bytes,'CUSTOMER_DELIVERY_UPLOAD_OFFSET');
     planned+=part.body.length;
    }
   }
   for(const part of parts){
    if(state.byOffset.has(part.offset)){
     // A retry verifies that exact earlier part, not the whole prefix.
     await measure(join(base,part.offset+'.part'),{bytes:part.body.length,sha256:part.sha256});
     continue;
    }
    await retainInitializationFile(join(base,part.offset+'.part'),part.body,{resume:true});
    const row={offset:part.offset,bytes:part.body.length,sha256:part.sha256};
    state.parts.push(row);state.byOffset.set(row.offset,row);state.offset+=row.bytes;
   }
   state.version=await version(base);remember(sha256,state);return result(state,options);
  });
 }
 async function chunk(sha256,input,options={}){
  return append(sha256,[decoded(input)],options);
 }
 async function chunks(sha256,input,options={}){
  need(input&&Array.isArray(input.chunks)&&input.chunks.length>0&&input.chunks.length<=UPLOAD_BATCH_CHUNKS,'CUSTOMER_DELIVERY_UPLOAD_BATCH');
  return append(sha256,input.chunks.map(decoded),options);
 }
 async function finish(sha256,options={}){
  return lock(sha256,async(base,value)=>{
   const state=await current(sha256,base,value);
   need(state.offset===state.value.bytes,'CUSTOMER_DELIVERY_UPLOAD_INCOMPLETE');
   await publish(join(base,'complete.ndjson'),async file=>{
    for(const part of state.parts){
     const body=await initializationBytes(join(base,part.offset+'.part'),CHUNK);
     need(body.length===part.bytes&&digest(body)===part.sha256,'CUSTOMER_DELIVERY_UPLOAD_CHANGED');
     await file.writeFile(body);
    }
   },{maximum:MAX_PACKAGE});
   // This checks the sender's original whole-file digest even when the completed
   // file was already published. Cache hits never bypass complete verification.
   await measure(join(base,'complete.ndjson'),state.value,MAX_PACKAGE);
   state.complete=true;state.version=await version(base);remember(sha256,state);
   return{...result(state,options),file:join(base,'complete.ndjson')};
  });
 }
 return{start,inspect,chunk,chunks,finish};
}
