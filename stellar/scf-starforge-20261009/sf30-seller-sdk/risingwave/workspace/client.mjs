// MIT. Browser and agents use one original running RisingWave workbench.
import { resolve, join } from 'node:path';
import { open, lstat, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { acquireWorkspace, privateDirectory, readPrivate, readJson, createFile, atomicJson, bytes, fault } from '../../postgres/publisher/files.mjs';
import { readRisingWaveCapture } from '../source.mjs';
import { COMPARISON_FILES, readCaptureComparison } from './comparison.mjs';
const ITEM=/^[a-z][a-z0-9-]{0,100}$/;
function item(value){if(typeof value!=='string'||!ITEM.test(value))throw fault('WORKSPACE_ITEM_INVALID');return value;}
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const names={json:'data.json',ndjson:'data.ndjson',csv:'data.csv',events:'events.ndjson',checkpoint:'checkpoint.json',state:'state.sqlite',manifest:'capture.json'};
async function hashFile(path){
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const info=await handle.stat();if(!info.isFile()||info.mode&0o077)throw fault('RECEIVING_FILE_INVALID');
    const hash=createHash('sha256');for await(const chunk of handle.createReadStream({start:0,autoClose:false}))hash.update(chunk);
    return{bytes:info.size,sha256:hash.digest('hex')};
  }finally{await handle.close();}
}
async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
export async function createRisingWaveWorkbenchClient({url,connectionFile,environment=process.env}={}){
  let address=url??environment.RISINGWAVE_WORKSPACE_URL;
  if(connectionFile){const value=JSON.parse(await readPrivate(resolve(connectionFile),16384));address=typeof value==='string'?value:value.risingwaveWorkspace??value.url;}
  let endpoint;try{endpoint=new URL(address);}catch{throw fault('RISINGWAVE_WORKSPACE_CONNECTION_REQUIRED','Set RISINGWAVE_WORKSPACE_URL or select the private workbench connection file.');}
  if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||endpoint.pathname!=='/'||endpoint.username||endpoint.password||endpoint.search||!/^#[A-Za-z0-9_-]{43}$/.test(endpoint.hash))throw fault('RISINGWAVE_WORKSPACE_CONNECTION_INVALID');
  const origin=endpoint.origin,authorization='Bearer '+endpoint.hash.slice(1);
  async function request(path,body,{signal}={}){
    if(typeof path!=='string'||!path.startsWith('/api/')||path.includes('#'))throw fault('RISINGWAVE_WORKSPACE_ROUTE_INVALID');
    const response=await fetch(new URL(path,origin),{method:body===undefined?'GET':'POST',redirect:'error',
      headers:{authorization,origin,...(body===undefined?{}:{'content-type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal??AbortSignal.timeout(330000)});
    const chunks=[];let length=0;
    for await(const chunk of response.body){length+=chunk.length;if(length>8388608)throw fault('RISINGWAVE_WORKSPACE_REPLY_TOO_LARGE');chunks.push(chunk);}
    let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw fault('RISINGWAVE_WORKSPACE_REPLY_INVALID');}
    if(!response.ok)throw fault(value.code??'RISINGWAVE_WORKSPACE_REQUEST_FAILED',value.message??value.error,response.status);
    return value;
  }
  const publicationPath=id=>'/api/publications/'+item(id),capturePath=id=>'/api/captures/'+item(id);
  const client={
    state:()=>request('/api/state'),revision:number=>request('/api/revisions/'+number),save:input=>request('/api/save',input),
    compileReport:report=>request('/api/report/compile',{report}),discover:input=>request('/api/catalogue',input),
    preview:input=>request('/api/sample',input),capture:input=>request('/api/capture',input),
    subscriptionInspect:input=>request('/api/subscription/inspect',input),
    subscriptionPrepare:input=>request('/api/subscription/prepare',input),
    subscriptionCreate:input=>request('/api/subscription/create',input),
    subscriptions:()=>request('/api/subscriptions'),subscriptionRecord:id=>request('/api/subscriptions/'+item(id)),
    captures:(input={})=>request('/api/captures?'+new URLSearchParams({limit:input.limit??20,offset:input.offset??0})),
    captureRecord:id=>request(capturePath(id)),cancelCapture:id=>request('/api/capture/cancel',{id:item(id)}),
    resumeCapture:id=>request('/api/capture/resume',{id:item(id)}),
    comparisons:(input={})=>request('/api/comparisons?'+new URLSearchParams({limit:input.limit??20,offset:input.offset??0})),
    comparisonRecord:id=>request('/api/comparisons/'+item(id)),
    comparisonChunk:(id,file,input={})=>request('/api/comparison/read',{id:item(id),file,...input}),
    recoverCapture:id=>request('/api/capture/recover',{id:item(id)}),captureChunk:(id,file,input={})=>request('/api/capture/read',{id:item(id),file,...input}),
    compareCaptures:input=>request('/api/captures/compare',input),createPublication:input=>request('/api/publications',input),
    publication:id=>request(publicationPath(id)),
    publicationCommand:(id,action,input={})=>{if(!/^[a-z]+(?:\/[a-z]+)?$/.test(action))throw fault('PUBLICATION_ACTION_INVALID');return request(publicationPath(id)+'/command/'+action,input);},
    seller:(id,running)=>request(publicationPath(id)+'/seller/'+(running?'start':'stop'),{}),
    run:(id,runId)=>request(publicationPath(id)+'/run?'+new URLSearchParams({runId})),
    buyerOffer:(id,runId,query='')=>request(publicationPath(id)+'/buyer?'+new URLSearchParams({runId,query})),
    prepareBuyer:(id,input)=>request(publicationPath(id)+'/buyer',input),
  };
  async function receiveFiles({selectionId,directory,signal,kind,record,fileNames,readChunk,finish,identity}){
    item(selectionId);if(typeof directory!=='string'||!directory)throw fault('RECEIVING_DIRECTORY_REQUIRED');
    const destination=resolve(directory);await privateDirectory(destination,true);const release=await acquireWorkspace(destination);
    try{
      if(!object(record.files))throw fault('RECEIVING_FILES_REQUIRED');
      const schema=kind==='capture'?'stellar-forge.risingwave-receiving.v1':'stellar-forge.risingwave-comparison-receiving.v1';
      const statePath=join(destination,'receiving.json');let retained;
      if(await exists(statePath)){
        retained=await readJson(statePath,8388608);
        if(retained.schema!==schema||JSON.stringify(retained.identity)!==JSON.stringify(identity))throw fault('RECEIVING_SELECTION_CHANGED','Reopen this directory with its original capture and file identities.');
      }else{
        retained={schema,identity,createdAt:new Date().toISOString(),state:'RECEIVING',files:{}};
        await createFile(statePath,bytes(retained));
      }
      for(const[name,descriptor]of Object.entries(record.files)){
        signal?.throwIfAborted();
        if(fileNames[name]!==descriptor.path||!Number.isSafeInteger(descriptor.bytes)||descriptor.bytes<0||!/^[a-f0-9]{64}$/.test(descriptor.sha256))throw fault('CAPTURE_FILE_INVALID');
        const path=join(destination,descriptor.path),partial=path+'.receiving';
        if(await exists(path)){
          const observed=await hashFile(path);
          if(observed.bytes!==descriptor.bytes||observed.sha256!==descriptor.sha256)throw fault('RECEIVING_FILE_CHANGED');
          retained.files[name]={...observed,state:'COMPLETE'};await atomicJson(destination,'receiving.json',retained);continue;
        }
        const handle=await open(partial,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
        try{
          const info=await handle.stat();if(!info.isFile()||info.mode&0o077||info.size>descriptor.bytes)throw fault('RECEIVING_PARTIAL_INVALID');
          let offset=info.size;
          while(offset<descriptor.bytes){
            signal?.throwIfAborted();const part=await readChunk(name,{offset,limit:196608});
            if(part.sha256!==descriptor.sha256||part.totalBytes!==descriptor.bytes||part.offset!==offset||!Number.isSafeInteger(part.bytes)||part.bytes<1||part.bytes>196608)throw fault('RECEIVING_SOURCE_CHANGED');
            const raw=Buffer.from(part.base64,'base64');if(raw.length!==part.bytes||raw.toString('base64')!==part.base64)throw fault('RECEIVING_CHUNK_INVALID');
            let written=0;
            while(written<raw.length){const result=await handle.write(raw,written,raw.length-written,offset+written);if(!result.bytesWritten)throw fault('RECEIVING_WRITE_FAILED');written+=result.bytesWritten;}
            offset+=raw.length;
          }await handle.sync();
        }finally{await handle.close();}
        const observed=await hashFile(partial);if(observed.bytes!==descriptor.bytes||observed.sha256!==descriptor.sha256)throw fault('RECEIVING_HASH_MISMATCH');
        await link(partial,path);await unlink(partial);retained.files[name]={...observed,state:'COMPLETE'};await atomicJson(destination,'receiving.json',retained);
      }
      const completed=await finish(destination);retained.state='COMPLETE';retained.completedAt=new Date().toISOString();
      if(kind==='capture')retained.rowCount=completed.manifest.rowCount;else retained.counts=completed.counts;
      await atomicJson(destination,'receiving.json',retained);return{directory:destination,receiving:retained,[kind]:kind==='capture'?completed.manifest:completed};
    }finally{await release();}
  };
  client.receiveCapture=async({captureId,directory,signal}={})=>{
    item(captureId);const record=await client.captureRecord(captureId);
    if(record.state!=='COMPLETE')throw fault('COMPLETE_CAPTURE_REQUIRED');
    return receiveFiles({selectionId:captureId,directory,signal,kind:'capture',record,fileNames:names,
      identity:{captureId,sourceHash:record.sourceHash,files:record.files},
      readChunk:(name,input)=>client.captureChunk(captureId,name,input),finish:readRisingWaveCapture});
  };
  client.receiveComparison=async({comparisonId,directory,signal}={})=>{
    item(comparisonId);const record=await client.comparisonRecord(comparisonId);
    if(record.complete!==true)throw fault('COMPLETE_COMPARISON_REQUIRED');
    return receiveFiles({selectionId:comparisonId,directory,signal,kind:'comparison',record,fileNames:COMPARISON_FILES,
      identity:{comparisonId,requestHash:record.requestHash,files:record.files},
      readChunk:(name,input)=>client.comparisonChunk(comparisonId,name,input),finish:readCaptureComparison});
  };
  return Object.freeze(client);
}
