// SPDX-License-Identifier: MIT
// Persist complete original requests before dispatch; the original application owns replay.
import {join} from 'node:path';
import {readdir} from 'node:fs/promises';
import {hash,need,identifier,integer,readJson,writeJson,privateDirectory,MAX_JSON} from './connection.mjs';
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':
  '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
export class ReplicationRequests{
  #files;
  constructor(files){this.#files=files;}
  async directory(alias){const path=join(await this.#files.directory(alias),'requests');await privateDirectory(path,{create:true});return path;}
  async prepare(alias,connection,operation,input,access){
    identifier(input.requestId,'request ID');const bytes=Buffer.from(JSON.stringify(input));
    need(bytes.length<=MAX_JSON,'REPLICATION_REQUEST_SIZE','Use the complete original request within its native limit.',413);
    const actorId=connection.actor.id,instanceId=connection.instanceId;
    const key=hash(canonical({instanceId,actorId,requestId:input.requestId}));
    const inputSha256=hash(canonical(input)),root=await this.directory(alias),path=join(root,key+'.request.json');
    let prior;try{prior=(await readJson(path,MAX_JSON)).value;}catch(e){if(e.code!=='ENOENT')throw e;}
    if(prior){
      need(prior.schema==='stellar-forge.replication-request.v1'&&prior.workspace===alias&&prior.key===key&&
        prior.instanceId===instanceId&&prior.actorId===actorId&&prior.requestId===input.requestId&&
        prior.operation===operation&&prior.inputSha256===inputSha256,
        'REPLICATION_REQUEST_REUSED','This original actor-bound request ID already selects another complete payload.',409);
      return prior;
    }
    const retained=await this.#files.retain(alias,{bytes,value:input},{operation:'original-request',key,actorId,instanceId,tool:operation,requestId:input.requestId,access});
    const record={schema:'stellar-forge.replication-request.v1',workspace:alias,key,instanceId,actorId,requestId:input.requestId,
      operation,inputSha256,access,projectId:input.projectId??null,action:input.action??null,
      originalRequest:{fileId:retained.fileId,sha256:retained.sha256,bytes:retained.bytes,fileRead:retained.fileRead}};
    try{await writeJson(path,record);}catch(e){
      if(e.code!=='EEXIST')throw e;
      const saved=(await readJson(path,MAX_JSON)).value;need(canonical(saved)===canonical(record),
        'REPLICATION_REQUEST_REUSED','This request ID has a concurrent different original payload.',409);
    }
    return record;
  }
  async confirm(record,response,retained){
    const root=await this.directory(record.workspace),path=join(root,record.key+'.confirmed.json');
    const result={schema:'stellar-forge.replication-request-confirmed.v1',requestKey:record.key,inputSha256:record.inputSha256,
      originalStatus:response.status,originalResponseSha256:response.sha256,originalResponseBytes:response.bytes.length,
      responseFile:retained?{fileId:retained.fileId,sha256:retained.sha256,bytes:retained.bytes,fileRead:retained.fileRead}:null};
    try{await writeJson(path,result);}catch(e){
      if(e.code!=='EEXIST')throw e;
      const prior=(await readJson(path,MAX_JSON)).value;need(prior.schema===result.schema&&prior.requestKey===record.key&&
        prior.inputSha256===record.inputSha256,'REPLICATION_REQUEST_REUSED','The retained original completion selects another request.',409);
    }
    return result;
  }
  async list(alias,{offset=0,limit=25}={}){
    integer(offset,'request offset');integer(limit,'request page size',100,1);const root=await this.directory(alias);
    const names=(await readdir(root)).filter(n=>/^[a-f0-9]{64}\.request\.json$/.test(n)).sort();
    const requests=[];
    for(const name of names.slice(offset,offset+limit)){
      const record=(await readJson(join(root,name),MAX_JSON)).value;
      need(record.schema==='stellar-forge.replication-request.v1'&&record.workspace===alias&&name===record.key+'.request.json',
        'REPLICATION_REQUEST_IDENTITY','The original retained request identity changed.',409);
      let confirmation=null;try{confirmation=(await readJson(join(root,record.key+'.confirmed.json'),65536)).value;
        need(confirmation.schema==='stellar-forge.replication-request-confirmed.v1'&&confirmation.requestKey===record.key&&confirmation.inputSha256===record.inputSha256,
          'REPLICATION_REQUEST_IDENTITY','The original retained completion identity changed.',409);
      }catch(e){if(e.code!=='ENOENT')throw e;}
      requests.push({...record,state:confirmation?'CONFIRMED':'RECONCILE_OR_REPLAY',confirmation});
    }
    return{workspace:alias,offset,total:names.length,nextOffset:offset+limit<names.length?offset+limit:null,requests};
  }
}
