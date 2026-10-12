// MIT — Customer job metadata. The original buyer/inbox remain payment authority.
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readJson, writeJson, privateDirectory, now, object } from '../node/store.mjs';
import { acquireStateLease } from '../../merchant-fleet-gateway/state-lease.mjs';
import { hash, requireValue, plain } from './source.mjs';
export const SCHEMA='stellar-forge.review-job-workspace.v1';
export const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export function key(value) {
  plain(value,160,'EXTERNAL_JOB_ID_REQUIRED');requireValue(value.trim().length>0,'EXTERNAL_JOB_ID_REQUIRED');
  return hash(Buffer.from(value));
}
export function actionID(value) {
  requireValue(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value),'OPERATION_ID_REQUIRED');
  return value;
}
export async function openJobStore({state,workspace,profile,buyerState,inbox,environment}={}) {
  state=await privateDirectory(resolve(state));const lease=await acquireStateLease(state);
  try {
    const configPath=join(state,'workspace.json');let config;
    try{config=await readJson(configPath);}
    catch(e){
      if(e.code!=='ENOENT')throw e;
      requireValue(Boolean(workspace)!==Boolean(profile),'CHOOSE_NATIVE_WORKSPACE_OR_PROFILE');
      config={schema:SCHEMA,id:randomUUID(),createdAt:now(),workspace:workspace?resolve(workspace):null,
        profile:profile?resolve(profile):null,buyerState:resolve(buyerState??join(state,'buyer')),
        inbox:resolve(inbox??join(state,'inbox'))};
      await writeJson(configPath,config,{exclusive:true});
    }
    requireValue(config.schema===SCHEMA&&typeof config.id==='string'&&
      Boolean(config.workspace)!==Boolean(config.profile),'JOB_WORKSPACE_CONFIG_INVALID');
    for(const [field,value]of Object.entries({workspace,profile,buyerState,inbox}))
      if(value!==undefined)requireValue(resolve(value)===config[field],'JOB_WORKSPACE_BINDING_CHANGED',409);
    for(const part of ['jobs','sources','catalogs','requests','reviews','exports'])await privateDirectory(join(state,part));
    let serial=Promise.resolve(),closed=false;
    const file=id=>join(state,'jobs',key(id)+'.json');
    const run=fn=>{
      const result=serial.then(()=>{requireValue(!closed,'JOB_WORKSPACE_CLOSED');lease.assertHeld();return fn();});
      serial=result.catch(()=>{});return result;
    };
    const get=async id=>{
      const record=await readJson(file(id),1048576);
      requireValue(record.schema==='stellar-forge.review-job.v1'&&record.externalId===id,'JOB_RECORD_ID_MISMATCH');
      return record;
    };
    const create=record=>run(async()=>{
      try{const existing=await get(record.externalId);
        requireValue(existing.identitySha256===record.identitySha256,'EXTERNAL_JOB_ID_ALREADY_BOUND',409);
        return existing;
      }catch(e){if(e.code!=='ENOENT')throw e;}
      const value={...record,schema:'stellar-forge.review-job.v1',revision:1,createdAt:now(),updatedAt:now(),
        binding:null,approval:null,resultReview:null,delivery:null,actions:[],events:[]};
      await writeJson(file(record.externalId),value,{exclusive:true});return value;
    });
    const mutate=(id,expectedRevision,kind,fn)=>run(async()=>{
      const before=await get(id);
      requireValue(expectedRevision===undefined||before.revision===expectedRevision,'JOB_REVISION_CHANGED',409);
      const next=await fn(structuredClone(before));
      if(next===null)return before;
      requireValue(next.externalId===before.externalId&&next.identitySha256===before.identitySha256,
        'JOB_IDENTITY_IMMUTABLE',409);
      next.revision=before.revision+1;next.updatedAt=now();
      requireValue(next.events.length<10000&&next.actions.length<=1000,'JOB_HISTORY_CAPACITY_REACHED',409);
      next.events.push({revision:next.revision,kind,at:next.updatedAt});
      requireValue(Buffer.byteLength(JSON.stringify(next))<1048576,'JOB_RECORD_CAPACITY_REACHED',409);
      await writeJson(file(id),next);return next;
    });
    async function list({offset=0,limit=50,q=''}={}) {
      requireValue(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'JOB_PAGE_INVALID');
      plain(q,200,'JOB_QUERY_INVALID');
      const rows=[];
      for(const name of await readdir(join(state,'jobs')))if(/^[a-f0-9]{64}\.json$/.test(name)){
        const row=await readJson(join(state,'jobs',name),1048576);
        requireValue(key(row.externalId)+'.json'===name,'JOB_RECORD_ID_MISMATCH');
        if(!q||[row.externalId,row.title,row.owner,row.service].join(' ').toLowerCase().includes(q.toLowerCase()))rows.push(row);
      }
      rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.externalId.localeCompare(b.externalId));
      return {total:rows.length,offset,limit,items:rows.slice(offset,offset+limit)};
    }
    return {state,config,environment,lease,get,create,mutate,list,
      async close(){await serial;closed=true;await lease.close();}};
  }catch(e){await lease.close();throw e;}
}
