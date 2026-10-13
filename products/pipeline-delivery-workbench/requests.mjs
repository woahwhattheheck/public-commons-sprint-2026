// SPDX-License-Identifier: MIT
// Full host request selection precedes dispatch. Original Staff owns outcomes/replay.
import {join} from 'node:path';
import {readdir} from 'node:fs/promises';
import {hash,need,identifier,integer,readJson,writeJson,privateDirectory,MAX_JSON} from './connection.mjs';
export const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':
 '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
export class PipelineDeliveryRequests{
 #files;
 constructor(files){this.#files=files;}
 async directory(alias){const path=join(await this.#files.directory(alias),'requests');await privateDirectory(path,{create:true});return path;}
 async prepare(alias,access,operation,requestId,intent,source=null){
  identifier(requestId,'original request ID');
  const key=hash(canonical({authority:access,requestId,family:operation==='archive'?'archive':'staff'}));
  const inputSha256=hash(canonical({operation,intent,source:source?{sha256:source.sha256,bytes:source.bytes}:null}));
  const root=await this.directory(alias),path=join(root,key+'.request.json');
  let prior;try{prior=(await readJson(path,MAX_JSON)).value;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(prior){need(prior.schema==='stellar-forge.pipeline-delivery-request.v1'&&prior.workspace===alias&&prior.key===key&&prior.requestId===requestId&&
    prior.inputSha256===inputSha256&&canonical(prior.access)===canonical(access),
    'PIPELINE_DELIVERY_REQUEST_CONFLICT','This original request ID retains another complete operation. Reopen its saved exact body.',409);return prior;}
  const bytes=Buffer.from(JSON.stringify(intent));
  const full=await this.#files.retain(alias,{bytes,value:intent},{operation:'original-request',requestId,access});
  const record={schema:'stellar-forge.pipeline-delivery-request.v1',workspace:alias,key,requestId,operation,inputSha256,access,
   originalRequest:{fileId:full.fileId,sha256:full.sha256,bytes:full.bytes,fileRead:full.fileRead},
   source:source?{fileId:source.fileId,sha256:source.sha256,bytes:source.bytes,fileRead:source.fileRead}:null};
  try{await writeJson(path,record);}catch(e){if(e.code!=='EEXIST')throw e;need(canonical((await readJson(path,MAX_JSON)).value)===canonical(record),
    'PIPELINE_DELIVERY_REQUEST_CONFLICT','A concurrent request selected another original payload.',409);}
  return record;
 }
 async confirm(record,response,retained){
  const root=await this.directory(record.workspace);
  // An HTTP500 may precede a later exact replay's200. Preserve every observed response.
  const result={schema:'stellar-forge.pipeline-delivery-request-observation.v1',requestKey:record.key,inputSha256:record.inputSha256,
   originalStatus:response.status??200,ok:response.ok??((response.status??200)<400),
   responseSha256:response.sha256,responseBytes:typeof response.bytes==='number'?response.bytes:response.bytes.length,
   responseFile:retained?{fileId:retained.fileId,sha256:retained.sha256,bytes:retained.bytes,fileRead:retained.fileRead}:null};
  const path=join(root,record.key+'.'+hash(canonical(result))+'.observed.json');
  try{await writeJson(path,result);}catch(e){if(e.code!=='EEXIST')throw e;need(canonical((await readJson(path,65536)).value)===canonical(result),
    'PIPELINE_DELIVERY_REQUEST_OBSERVATION','The exact original response observation changed.',409);}
  return result;
 }
 async list(alias,{offset=0,limit=25}={}){
  integer(offset,'request offset');integer(limit,'request page size',100,1);const root=await this.directory(alias),all=await readdir(root);
  const names=all.filter(n=>/^[a-f0-9]{64}\.request\.json$/.test(n)).sort(),requests=[];
  for(const name of names.slice(offset,offset+limit)){
   const record=(await readJson(join(root,name),MAX_JSON)).value;
   need(record.schema==='stellar-forge.pipeline-delivery-request.v1'&&record.workspace===alias&&name===record.key+'.request.json',
    'PIPELINE_DELIVERY_REQUEST_IDENTITY','The complete original request descriptor changed.',409);
   const observations=[];
   for(const n of all.filter(n=>n.startsWith(record.key+'.')&&/^[a-f0-9]{64}\.[a-f0-9]{64}\.observed\.json$/.test(n)).sort()){
    const value=(await readJson(join(root,n),65536)).value;
    need(value.schema==='stellar-forge.pipeline-delivery-request-observation.v1'&&value.requestKey===record.key&&value.inputSha256===record.inputSha256&&
     n===record.key+'.'+hash(canonical(value))+'.observed.json','PIPELINE_DELIVERY_REQUEST_IDENTITY','The original request observation changed.',409);
    observations.push(value);
   }
   requests.push({...record,state:observations.length?'HTTP_OBSERVED':'RECONCILE_OR_REPLAY',observations});
  }
  return{workspace:alias,offset,total:names.length,nextOffset:offset+limit<names.length?offset+limit:null,requests};
 }
}
