// SPDX-License-Identifier: MIT
// Host request custody is separate from Hive's original entity revisions.
import {join} from 'node:path';
import {readdir} from 'node:fs/promises';
import {acquirePrivateDirectoryWriter} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/operations/history.mjs';
import {hash,need,integer,readJson,readFile,writeJson,privateDirectory,MAX_JSON} from './connection.mjs';
import {canonical,requestId,writePrivate} from './helpers.mjs';
const SCHEMA='stellar-forge.hive-request.v1';
const response=(value,status=200)=>{const bytes=Buffer.from(JSON.stringify(value)+'\n');return{ok:status>=200&&status<300,status,value,bytes,sha256:hash(bytes),mediaType:'application/json'};};
export class HiveRequests{
  #files;
  constructor(files){this.#files=files;}
  async directory(alias){const root=join(await this.#files.directory(alias),'requests');await privateDirectory(root,{create:true});return root;}
  async #json(path,max=MAX_JSON){try{return(await readJson(path,max)).value;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
  async #save(path,value){try{await writeJson(path,value);}catch(e){if(e.code!=='EEXIST')throw e;
    need(canonical(await this.#json(path,MAX_JSON*3))===canonical(value),'HIVE_REQUEST_CONFLICT','The original request custody changed.',409);}}
  async selected(alias,workspaceId,id){
    requestId(id);const root=await this.directory(alias),key=hash(canonical({workspaceId,requestId:id}));
    return await this.#json(join(root,key+'.request.json'),MAX_JSON*3);
  }
  async run({alias,access,input,resolved,before,dispatch,recover}){
    requestId(input.requestId);const root=await this.directory(alias),lease=await acquirePrivateDirectoryWriter(root);
    try{
      const key=hash(canonical({workspaceId:access.workspaceId,requestId:input.requestId}));
      const path=join(root,key+'.request.json'),inputSha256=hash(canonical(input));
      let record=await this.#json(path,MAX_JSON*3);
      if(record)need(record.schema===SCHEMA&&record.workspace===alias&&record.workspaceId===access.workspaceId&&
        record.key===key&&record.inputSha256===inputSha256&&canonical(record.input)===canonical(input),
        'HIVE_REQUEST_REUSED','This host request ID already selects another exact operation.',409);
      else{
        const body=Buffer.from(JSON.stringify({input,resolved}));
        need(body.length<=MAX_JSON,'HIVE_REQUEST_SIZE','Keep the complete action within the selected 32 MiB limit.',413);
        const original=await this.#files.retain(alias,{bytes:body,value:{input,resolved}}, {operation:'original-request',requestId:input.requestId,access});
        record={schema:SCHEMA,workspace:alias,workspaceId:access.workspaceId,key,inputSha256,input,resolved,before,access,
          originalRequest:{fileId:original.fileId,sha256:original.sha256,bytes:original.bytes,fileRead:original.fileRead}};
        await this.#save(path,record);
      }
      const confirmed=await this.#json(join(root,key+'.outcome.json'));
      if(confirmed)return this.#reopen(root,record,confirmed);
      // The raw response candidate is closed before its publication receipt.
      // Reopen it before inspecting mutable current state or dispatching again.
      const candidate=await this.#json(join(root,key+'.candidate.json'),MAX_JSON*2);
      if(candidate)return this.#finishCandidate(root,record,candidate,true);
      const dispatched=await this.#json(join(root,key+'.dispatch.json'));
      if(dispatched){
        const recovered=await recover(record);
        if(!recovered) return{record,outcome:'RECONCILIATION_REQUIRED',replayed:true,response:response({
          requestId:record.input.requestId,state:'RECONCILIATION_REQUIRED',
          message:'The original dispatch may have taken effect. Inspect the exact request, current original entities and retained native files. No action was repeated.',
          action:record.resolved.action,originalRequest:record.originalRequest},409)};
        if(recovered.response)return await this.#capture(root,record,recovered.response,'RECOVERED_EFFECT',true);
        need(recovered.retry===true,'HIVE_RECOVERY','The selected original operation requires a proven recovery rule.',409);
      }else await this.#save(join(root,key+'.dispatch.json'),{schema:'stellar-forge.hive-request-dispatch.v1',key,inputSha256,selected:true});
      let observed;
      try{observed=await dispatch(record);}
      catch(error){error.details={...error.details,requestId:input.requestId,originalRequest:record.originalRequest,
        outcome:'UNKNOWN',recovery:'Repeat the same host request only to reconcile its original saved effect. The adapter does not blindly repeat uncertain actions.'};throw error;}
      // Even an actual HTTP error may follow a partial original mutation.
      // Its full returned bytes are a confirmed response, not proof of no effect.
      return await this.#capture(root,record,observed,'ORIGINAL_RESPONSE',Boolean(dispatched));
    }finally{await lease.release();}
  }
  async #capture(root,record,observed,outcome,replayed){
    need(Buffer.isBuffer(observed.bytes)&&observed.bytes.length<=MAX_JSON&&hash(observed.bytes)===observed.sha256,
      'HIVE_RESPONSE_IDENTITY','Retain the full actual original response.',409);
    const candidate={schema:'stellar-forge.hive-request-outcome.v1',key:record.key,inputSha256:record.inputSha256,
      outcome,status:observed.status,bytes:observed.bytes.length,sha256:observed.sha256,mediaType:observed.mediaType??'application/json',
      base64:observed.bytes.toString('base64')};
    await this.#save(join(root,record.key+'.candidate.json'),candidate);
    return this.#finishCandidate(root,record,candidate,replayed);
  }
  async #finishCandidate(root,record,candidate,replayed){
    need(candidate.schema==='stellar-forge.hive-request-outcome.v1'&&candidate.key===record.key&&candidate.inputSha256===record.inputSha256&&
      typeof candidate.base64==='string','HIVE_RESPONSE_IDENTITY','The closed response candidate changed.',409);
    const bytes=Buffer.from(candidate.base64,'base64');
    need(bytes.toString('base64')===candidate.base64&&bytes.length===candidate.bytes&&bytes.length<=MAX_JSON&&hash(bytes)===candidate.sha256,
      'HIVE_RESPONSE_IDENTITY','The complete closed response candidate changed.',409);
    const raw=join(root,record.key+'.response');
    try{await writePrivate(raw,bytes);}catch(e){if(e.code!=='EEXIST')throw e;
      const old=await readFile(raw,MAX_JSON);need(old.sha256===candidate.sha256&&old.bytes.length===bytes.length,
        'HIVE_RESPONSE_CHANGED','The published original response differs from its closed candidate.',409);}
    const{base64,...outcome}=candidate;
    await this.#save(join(root,record.key+'.outcome.json'),outcome);
    return{record,response:{...outcome,ok:outcome.status>=200&&outcome.status<300,bytes,value:JSON.parse(bytes.toString('utf8'))},
      outcome:outcome.outcome,replayed};
  }
  async #reopen(root,record,confirmed){
    need(confirmed.schema==='stellar-forge.hive-request-outcome.v1'&&confirmed.key===record.key&&confirmed.inputSha256===record.inputSha256,
      'HIVE_REQUEST_IDENTITY','The original response belongs to another request.',409);
    const raw=await readFile(join(root,record.key+'.response'),MAX_JSON);
    need(raw.sha256===confirmed.sha256&&raw.bytes.length===confirmed.bytes,'HIVE_RESPONSE_CHANGED','The retained original response changed.',409);
    return{record,outcome:confirmed.outcome,replayed:true,response:{...confirmed,ok:confirmed.status>=200&&confirmed.status<300,
      bytes:raw.bytes,value:JSON.parse(raw.bytes.toString('utf8'))}};
  }
  async list(alias,{offset=0,limit=25}={}){
    integer(offset,'request offset');integer(limit,'request page size',100,1);const root=await this.directory(alias);
    const names=(await readdir(root)).filter(n=>/^[a-f0-9]{64}\.request\.json$/.test(n)).sort();
    const requests=[];
    for(const name of names.slice(offset,offset+limit)){
      const r=await this.#json(join(root,name),MAX_JSON*3);
      need(r.schema===SCHEMA&&r.workspace===alias&&name===r.key+'.request.json','HIVE_REQUEST_IDENTITY','The original request journal changed.',409);
      const outcome=await this.#json(join(root,r.key+'.outcome.json'));
      requests.push({workspaceId:r.workspaceId,requestId:r.input.requestId,operation:r.input.operation,action:r.resolved.action,inputSha256:r.inputSha256,
        originalRequest:r.originalRequest,state:outcome?outcome.outcome:'RECONCILE_OR_DISPATCH',outcome});
    }
    return{workspace:alias,total:names.length,offset,nextOffset:offset+limit<names.length?offset+limit:null,requests};
  }
}
export {response as hiveResponse};
