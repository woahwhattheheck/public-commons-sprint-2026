// MIT. Durable Turbolong operating periods, native acquisitions and complete incident history.
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  files, now, own, plain, clone, digest, canonical, jsonBytes, need,
  integer, text, identifier, selected, hash, privateDirectory, withLock,
  descriptor, copyDescriptor, collectFiles, publicError
} from '../stellar-indexer/common.mjs';
export { files, now, own, plain, clone, digest, canonical, jsonBytes, need, integer,
  text, identifier, selected, hash, privateDirectory, withLock, descriptor,
  copyDescriptor, collectFiles, publicError, randomUUID };
export const STATE_SCHEMA = 'stellar-forge.turbolong-operations.workspace.v1';
export const SOURCE_SCHEMA = 'stellar-forge.turbolong-operations.source.v1';
export const EDITION_SCHEMA = 'stellar-forge.turbolong-operations.edition.v1';
export const TABLES = ['periods','vaults','acquisitions','operations','attempts','sources','incidents','corrections','analyses','reports','exports'];
export const SOURCE_ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk/turbolong-operations';
export function sealed(value) {
  const body=clone(value);delete body.sha256;
  return {...body,sha256:digest(jsonBytes(body))};
}
export function verified(value,label='Retained record') {
  need(plain(value),'INVALID_SOURCE',label+' must be a JSON object.');
  hash(value.sha256);const body=clone(value);delete body.sha256;
  need(digest(jsonBytes(body))===value.sha256,'SOURCE_CHANGED',label+' differs from its retained bytes.');
  return value;
}

function stateBody(state){const body=clone(state);delete body.head;return body;}
function changes(before,after,path=[],result=[]){
  if(canonical(before)===canonical(after))return result;
  if(Array.isArray(before)&&Array.isArray(after)&&after.length>=before.length&&
    before.every((value,index)=>canonical(value)===canonical(after[index]))){
    result.push({op:'append',path,value:after.slice(before.length)});return result;
  }
  if(plain(before)&&plain(after)){
    for(const key of Object.keys(before))if(!own(after,key))result.push({op:'remove',path:[...path,key]});
    for(const key of Object.keys(after)){
      if(!own(before,key))result.push({op:'set',path:[...path,key],value:clone(after[key])});
      else changes(before[key],after[key],[...path,key],result);
    }
    return result;
  }
  result.push({op:'set',path,value:clone(after)});return result;
}
export function applyChanges(before,patch){
  const result=clone(before);
  for(const item of patch){
    need(Array.isArray(item.path)&&item.path.length>0&&item.path.every(key=>typeof key==='string'&&!['__proto__','prototype','constructor'].includes(key)),
      'INVALID_JOURNAL','The original journal path is invalid.');
    let target=result;
    for(const key of item.path.slice(0,-1)){
      need(plain(target)&&own(target,key),'INVALID_JOURNAL','The original journal parent is missing.');
      target=target[key];
    }
    const key=item.path.at(-1);need(plain(target),'INVALID_JOURNAL','The original journal destination is invalid.');
    if(item.op==='remove')delete target[key];
    else if(item.op==='set')Object.defineProperty(target,key,{value:clone(item.value),enumerable:true,writable:true,configurable:true});
    else if(item.op==='append'){
      need(Array.isArray(target[key])&&Array.isArray(item.value),'INVALID_JOURNAL','The original array continuation is invalid.');
      target[key].push(...clone(item.value));
    }else need(false,'INVALID_JOURNAL','The original journal operation is invalid.');
  }
  return result;
}
function validateState(state){
  need(state?.schema===STATE_SCHEMA,'INVALID_WORKSPACE','Select a Turbolong operations workspace.');
  identifier(state.workspaceId);integer(state.revision,'workspace revision');
  need(state.head===null||/^[a-f0-9]{64}$/.test(state.head),'INVALID_WORKSPACE','The workspace head is invalid.');
  for(const table of TABLES)need(plain(state[table]),'INVALID_WORKSPACE','A workspace record table is missing.',{table});
  need(plain(state.requests),'INVALID_WORKSPACE','The original request journal is missing.');
  return state;
}
async function unlink(directory,name){await fs.unlink(await files.filePath(directory,name)).catch(e=>{if(e.code!=='ENOENT')throw e;});}
export async function recoverState(directory){
  let pending;
  try{pending=await files.readJSON(directory,'pending.json');}catch(error){if(error.code==='ENOENT')return;throw error;}
  need(pending.schema==='stellar-forge.turbolong-operations.pending.v1','INVALID_JOURNAL','The pending workspace transition is invalid.');
  const state=validateState(await files.readJSON(directory,'state.json'));
  const next=validateState(pending.state);
  const commit=await files.readJSON(directory,pending.commit.path);
  need(digest(jsonBytes(commit))===pending.commit.sha256&&digest(jsonBytes(stateBody(next)))===commit.stateSha256,
    'SOURCE_CHANGED','The original pending transition has changed.');
  const unsigned=clone(commit);delete unsigned.hash;
  need(digest(jsonBytes(unsigned))===commit.hash&&next.head===commit.hash,'INVALID_JOURNAL','The pending journal head is invalid.');
  if(state.head===pending.previousHead){
    need(next.workspaceId===state.workspaceId&&next.revision===state.revision+1,'INVALID_JOURNAL','The pending transition has a different workspace.');
    await files.replaceJSON(directory,'state.json',next);
  }else need(state.head===next.head,'WORKSPACE_DIVERGED','The workspace advanced beyond its pending transition.');
  await unlink(directory,'pending.json');
}
export async function readState(directory){return validateState(await files.readJSON(directory,'state.json'));}
export async function initialize(directory,profile={}){
  await privateDirectory(directory);
  return withLock(directory,'writer.lock',async()=>{
    try{await recoverState(directory);return await readState(directory);}catch(error){if(error.code!=='ENOENT')throw error;}
    let previousGenesis;
    try{previousGenesis=validateState(await files.readJSON(directory,'genesis.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(previousGenesis){need(previousGenesis.revision===0&&previousGenesis.head===null,'INVALID_JOURNAL','The original genesis has already advanced.');
      await files.replaceJSON(directory,'state.json',previousGenesis);return previousGenesis;}
    const initial={schema:STATE_SCHEMA,workspaceId:randomUUID(),createdAt:now(),updatedAt:now(),revision:0,head:null,
      profile:{name:text(profile.name??'Turbolong operations workspace','workspace name'),organization:profile.organization??'',...clone(profile)},
      requests:{}};
    for(const table of TABLES)initial[table]={};
    await files.writeNew(directory,'genesis.json',jsonBytes(initial));
    await files.replaceJSON(directory,'state.json',initial);
    return initial;
  });
}
export function intent(operation,args){
  need(plain(args),'INVALID_ARGUMENT','Supply the operation arguments.');
  identifier(args.requestId);integer(args.expectedRevision,'expectedRevision');
  const body=clone(args);delete body.requestId;delete body.expectedRevision;
  return {requestId:args.requestId,intentSha256:digest(jsonBytes({operation,arguments:body}))};
}
export function replay(state,operation,args){
  const selected=intent(operation,args),prior=state.requests[selected.requestId];
  if(prior){
    need(prior.intentSha256===selected.intentSha256&&prior.operation===operation,'REQUEST_ID_CONFLICT',
      'This request identifier already names a different operation.');
    return {...clone(prior.result),replayed:true};
  }
  return null;
}
export function revision(state,args){
  need(state.revision===args.expectedRevision,'REVISION_CONFLICT','Refresh the workspace before changing this saved version.',
    {expectedRevision:args.expectedRevision,actualRevision:state.revision,workspaceId:state.workspaceId});
}
export async function commitState(directory,before,after,operation,args,result,{recordRequest=true}={}){
  const original=intent(operation,args);
  need(before.workspaceId===after.workspaceId,'INVALID_WORKSPACE','An operation cannot replace workspace identity.');
  after.revision=before.revision+1;after.updatedAt=now();
  const response={...clone(result),workspaceId:after.workspaceId,revision:after.revision,requestId:original.requestId};
  if(recordRequest)after.requests[original.requestId]={operation,intentSha256:original.intentSha256,result:clone(response)};
  const previous=stateBody(before),next=stateBody(after);
  const record={schema:'stellar-forge.turbolong-operations.commit.v1',workspaceId:after.workspaceId,
    revision:after.revision,parent:before.head,operation,requestId:original.requestId,intentSha256:original.intentSha256,
    at:after.updatedAt,patch:changes(previous,next),stateSha256:digest(jsonBytes(next))};
  record.hash=digest(jsonBytes(record));after.head=record.hash;
  const retained=await files.writeNew(directory,'history/'+String(after.revision).padStart(12,'0')+'-'+record.hash+'.json',jsonBytes(record));
  await files.replaceJSON(directory,'pending.json',{schema:'stellar-forge.turbolong-operations.pending.v1',
    previousHead:before.head,commit:retained,state:after});
  await files.replaceJSON(directory,'state.json',after);
  await unlink(directory,'pending.json');
  return response;
}
export async function mutate(directory,operation,args,work){
  return withLock(directory,'writer.lock',async()=>{
    await recoverState(directory);const before=await readState(directory);
    const prior=replay(before,operation,args);if(prior)return prior;
    revision(before,args);const after=clone(before);
    const result=await work(after,before);
    return commitState(directory,before,after,operation,args,result);
  });
}
export async function retainJSON(directory,path,value){
  return files.writeNew(directory,path,jsonBytes(clone(value)));
}
export async function readDescriptor(directory,item){
  hash(item.sha256);integer(item.bytes,'source bytes');
  const bytes=await files.readFile(directory,item.path);
  need(bytes.length===item.bytes&&digest(bytes)===item.sha256,'SOURCE_CHANGED','Retained source differs from its descriptor.',{path:item.path});
  return bytes;
}
export async function readRecord(directory,item){
  const result=JSON.parse((await readDescriptor(directory,item.file??item)).toString('utf8'));
  return result;
}
export async function originalHistoryEntries(directory,state){
  const reverse=[];let head=state.head,revision=state.revision;
  while(revision>0){
    hash(head);
    const path='history/'+String(revision).padStart(12,'0')+'-'+head+'.json';
    const record=await files.readJSON(directory,path),unsigned=clone(record);delete unsigned.hash;
    need(record.schema==='stellar-forge.turbolong-operations.commit.v1'&&record.workspaceId===state.workspaceId&&
      record.revision===revision&&record.hash===head&&digest(jsonBytes(unsigned))===head,
      'INVALID_JOURNAL','The original workspace transition differs from its selected history.',{path});
    reverse.push(record);head=record.parent;revision--;
  }
  need(head===null,'INVALID_JOURNAL','The original history does not end at its genesis.');
  return reverse.reverse();
}
export async function assertOriginalHistory(directory,state){
  let rebuilt=validateState(await files.readJSON(directory,'genesis.json'));
  need(rebuilt.workspaceId===state.workspaceId&&rebuilt.revision===0&&rebuilt.head===null,'INVALID_JOURNAL','Original workspace genesis differs.');
  for(const record of await originalHistoryEntries(directory,state)){
    need(record.parent===rebuilt.head&&record.revision===rebuilt.revision+1,
      'INVALID_JOURNAL','Original workspace history is discontinuous.');
    const next=applyChanges(stateBody(rebuilt),record.patch);
    need(digest(jsonBytes(next))===record.stateSha256,'INVALID_JOURNAL','A retained transition differs from its original state.');
    rebuilt={...next,head:record.hash};
  }
  need(canonical(rebuilt)===canonical(state),'INVALID_JOURNAL','Retained workspace state differs from its complete journal.');
  return {workspaceId:state.workspaceId,revision:state.revision,head:state.head};
}
export function safeFilename(value){
  text(value,'file name',180);need(!/[\/\\]/.test(value)&&value!=='.'&&value!=='..','INVALID_FILENAME','Use a file name without directory components.');return value;
}
export function html(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function inside(parent,child){const p=resolve(parent),c=resolve(child);return c===p||c.startsWith(p+'/');}

export const TERMINAL_OPERATIONS=new Set(['COMPLETED','FAILED','CANCELED']);
export const OPERATION_STATES=new Set(['PREPARING','PREPARED','RUNNING','PENDING','COMPLETED','FAILED','UNCERTAIN','PARTIAL','CANCELED']);
export function publicPayload(value,path=[]){
  if(Array.isArray(value))return value.map((item,index)=>publicPayload(item,[...path,String(index)]));
  if(plain(value)){
    const result={};
    for(const [key,item] of Object.entries(value)){
      need((item===null||item==='[redacted]')||!/^(?:access_?token|refresh_?token|id_?token|session_?token|submission_?token|dpop|private_?key|secret_?key|keeper_?secret|deploy_?secret_?key|keeper_?ingest_?key|stellar_?broker_?partner_?key|resend_?api_?key|vapid_?private_?key|password|otp|one_?time_?(?:password|code)|authorization|client_?secret|server_?key|personal_?access_?token)$/i.test(key),
        'PRIVATE_INPUT','Keep authentication and signing material in the original signing runtime or selected private connection.',{path:[...path,key].join('.')});
      Object.defineProperty(result,key,{value:publicPayload(item,[...path,key]),enumerable:true,writable:true,configurable:true});
    }return result;
  }
  need(value===null||['string','number','boolean'].includes(typeof value),'INVALID_ARGUMENT','Use original JSON values.');
  if(typeof value==='number')need(Number.isFinite(value),'INVALID_ARGUMENT','Use a finite JSON number.');
  return value;
}
export function publicRuntimePin(value){
  need(plain(value),'RUNTIME_SOURCE_REQUIRED','Select the complete original Turbolong installation runtime.');
  hash(value.id);hash(value.manifestSha256);
  text(value.version,'original runtime version',256);
  return {id:value.id,manifestSha256:value.manifestSha256,version:value.version,...(value.platform===undefined?{}:{platform:clone(value.platform)})};
}
export function isoTime(value,name,{nullable=false}={}){
  if(nullable&&value===null)return null;
  text(value,name,80);
  need(/^\d{4}-\d{2}-\d{2}T/.test(value)&&/(?:[zZ]|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value)),'INVALID_TIME','Supply '+name+' as a complete ISO timestamp.');
  return new Date(value).toISOString();
}
