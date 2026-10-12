// SPDX-License-Identifier: MIT
// Immutable phase artifacts inside the ORIGINAL SensorThings store. No additional store or lock.
import {join,isAbsolute,resolve} from 'node:path';
import {readdir,lstat} from 'node:fs/promises';
import {identity,json,stable,sha,plain,fault,fields} from '../../contract.mjs';
import {readOwned,privateDirectory} from '../../../stellar-expert/store.mjs';
import {openPrivateFile,hashHeldFile,inspectRetainedFile} from '../../portable.mjs';
import {safeFile,retainedPath,retainBytes} from '../artifacts.mjs';
import {MERCHANT_RECORD,MERCHANT_SNAPSHOT} from './schema.mjs';
export {identity,json,stable,sha,plain,fault,fields,safeFile,retainedPath};
export const MAX_JSON=24*1024*1024,MAX_HANDOFF=8*1024*1024,MAX_CATALOG=1024*1024;
const OP=/^[A-Za-z0-9_-]{8,100}$/,HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function need(ok,code,message,status=409,details){if(!ok)throw fault('ANALYSIS_MERCHANT_'+code,message,status,details);}
export function opId(value){need(OP.test(value??''),'OPERATION','Use the original SensorThings operation ID.',422);return value;}
export function hash(value,label='SHA256'){need(HASH.test(value??''),'IDENTITY','Retain the exact '+label+'.',422);return value;}
export function text(value,label,max=12000){need(typeof value==='string'&&value.trim()&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),'INPUT','Supply '+label+'.',422);return value;}
export function absolute(value,label){text(value,label,4096);need(isAbsolute(value)&&resolve(value)===value,'PATH','Select an absolute normalized '+label+'.',422);return value;}
export function selected(rows,id,label){const value=(rows??[]).find(r=>r.id===id);need(value,'SELECTION','Select an existing '+label+'.',404);return structuredClone(value);}
export function descriptor(value){
  need(plain(value)&&typeof value.name==='string'&&safeFile(value.name)===value.storage?.filename&&OP.test(value.storage?.operationId??'')&&
    HASH.test(value.sha256??'')&&Number.isSafeInteger(value.bytes)&&value.bytes>=0&&typeof value.type==='string'&&!/[\r\n\0]/.test(value.type),
    'FILE','The complete original held-file descriptor is invalid.');return value;
}
export async function exactPath(path,expected,maximum=MAX_JSON){
  need(Number.isSafeInteger(expected.bytes)&&expected.bytes>=0&&expected.bytes<=maximum,'FILE_CAPACITY','The complete selected file exceeds its declared limit.',413);hash(expected.sha256);
  const held=await openPrivateFile(path,{expectedBytes:expected.bytes,maximum});
  try{
    await hashHeldFile(held.handle,{expectedBytes:expected.bytes,expectedSha256:expected.sha256,maximum});
    const raw=Buffer.alloc(expected.bytes);let offset=0;
    while(offset<raw.length){const r=await held.handle.read(raw,offset,raw.length-offset,offset);need(r.bytesRead>0,'FILE_CHANGED','The retained file ended during its exact read.');offset+=r.bytesRead;}
    need(sha(raw)===expected.sha256,'FILE_CHANGED','The retained file changed during its exact read.');
    await inspectRetainedFile(path,{expectedBytes:expected.bytes,expectedSha256:expected.sha256,maximum});return raw;
  }finally{await held.handle.close();}
}
export async function exactFile(store,file,maximum=MAX_JSON){descriptor(file);return exactPath(retainedPath(store,file),file,maximum);}
export async function fileJSON(store,file,maximum=MAX_JSON){
  const raw=await exactFile(store,file,maximum);let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{need(false,'JSON','The retained JSON file is incomplete.');}
  return {raw,value};
}
export async function optionalJSON(path){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readOwned(path,MAX_JSON)));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export function operationRoot(store,op){opId(op.operationId);hash(op.requestSha256);return join(store.root,'exports',op.operationId);}
export async function claimOperation(store,op){
  const root=operationRoot(store,op),path=join(root,'merchant-owner.attempt.json'),
    wanted={schema:'stellar-forge.sensorthings-analysis-merchant-owner.v1',workspaceId:store.read().workspaceId,
      operationId:op.operationId,requestSha256:op.requestSha256,contextSha256:identity(op.context),createdAt:op.createdAt};
  const prior=await optionalJSON(path);
  if(prior){need(stable(prior)===stable(wanted),'OPERATION_OWNER','These retained files belong to another original workspace or request. Imported history cannot authorize execution.');return prior;}
  let entries=[];try{entries=await readdir(root);}catch(e){if(e.code!=='ENOENT')throw e;}
  need(entries.length===0,'OPERATION_OWNER','An unclaimed operation directory already contains original files. Preserve those files and use their original operation.');
  await privateDirectory(root,{create:true});await store.immutable(path,json(wanted));return wanted;
}
export async function phase(store,op,name,build){
  safeFile(name);need(/^[a-z][a-z0-9-]{0,80}$/.test(name),'PHASE','Use a declared original phase.');
  const path=join(operationRoot(store,op),'merchant-'+name+'.phase.json'),prior=await optionalJSON(path);
  if(prior){
    need(prior.schema==='stellar-forge.sensorthings-analysis-merchant-phase.v1'&&prior.operationId===op.operationId&&
      prior.requestSha256===op.requestSha256&&prior.workspaceId===store.read().workspaceId&&prior.contextSha256===identity(op.context)&&prior.name===name&&prior.valueSha256===identity(prior.value),'PHASE_IDENTITY','The retained phase belongs to another exact request.');return prior.value;
  }
  const value=await build(),record={schema:'stellar-forge.sensorthings-analysis-merchant-phase.v1',operationId:op.operationId,
    workspaceId:store.read().workspaceId,contextSha256:identity(op.context),requestSha256:op.requestSha256,name,valueSha256:identity(value),value};
  const raw=json(record);need(raw.length<=MAX_JSON,'PHASE_CAPACITY','The complete original phase exceeds the retained JSON capacity.',413);
  await privateDirectory(operationRoot(store,op),{create:true});await store.immutable(path,raw);return value;
}
export async function freeze(store,op,name,raw,type,inputIdentity={}){
  safeFile(name);return retainBytes(store,raw,{operationId:op.operationId,createdAt:op.createdAt,filename:'merchant-'+name,type,
    inputIdentity:{requestSha256:op.requestSha256,...inputIdentity},maximum:Math.max(MAX_JSON,raw.length)});
}
export async function phaseInventory(store,op){
  const root=operationRoot(store,op),files=[];
  try{for(const name of await readdir(root)){
    if(!/^merchant-[a-z0-9-]+\.phase\.json$/.test(name)&&!/^merchant-[a-z0-9-]+\.attempt\.json$/.test(name))continue;
    const path=join(root,name),stat=await lstat(path);need(stat.isFile()&&!stat.isSymbolicLink(),'PHASE_FILE','The retained phase path is not an original regular file.');
    const raw=await readOwned(path,MAX_JSON),info=await inspectRetainedFile(path,{expectedBytes:raw.length,expectedSha256:sha(raw),maximum:MAX_JSON});
    files.push({name,type:'application/json',bytes:info.bytes,sha256:info.sha256,storage:{operationId:op.operationId,filename:name}});
  }}catch(e){if(e.code!=='ENOENT')throw e;}return files.sort((a,b)=>a.name.localeCompare(b.name));
}
export function uniqueFiles(files){
  const found=new Map();for(const f of files){descriptor(f);const key=f.storage.operationId+'/'+f.storage.filename,old=found.get(key);
    need(!old||stable(old)===stable(f),'FILE_CONFLICT','One retained file path has different original descriptors.');found.set(key,structuredClone(f));}
  return [...found.values()].sort((a,b)=>(a.storage.operationId+'/'+a.name).localeCompare(b.storage.operationId+'/'+b.name));
}
export async function makeRecord(store,op,{kind,projectId,versionId,publicationId,value,files=[]}){
  need(UUID.test(store.read().workspaceId??''),'WORKSPACE','Use the original SensorThings workspace.');
  const proof={schema:'stellar-forge.sensorthings-analysis-merchant-operation.v1',workspaceId:store.read().workspaceId,
    operationId:op.operationId,requestSha256:op.requestSha256,action:op.action,payload:structuredClone(op.payload),
    expectedRevision:op.expectedRevision,createdAt:op.createdAt,context:structuredClone(op.context.analysis),kind,projectId,versionId,publicationId,value};
  const proofRaw=json(proof);need(proofRaw.length<=MAX_JSON,'JOURNAL_CAPACITY','The complete original request and result exceed the retained journal capacity.',413);
  const journal=await freeze(store,op,'operation.json',proofRaw,'application/json',{kind}),
    body={schema:MERCHANT_RECORD,originWorkspaceId:store.read().workspaceId,operationId:op.operationId,requestSha256:op.requestSha256,
      kind,projectId,versionId,publicationId,createdAt:op.createdAt,actor:op.payload.actor,value:structuredClone(value),
      files:uniqueFiles([...files,journal,...await phaseInventory(store,op)]),journal};
  return {id:identity(body),...body};
}
export function validateRecord(record,{projectId,versions,publications}={}){
  const {id,...body}=record??{};
  need(plain(record)&&record.schema===MERCHANT_RECORD&&HASH.test(id??'')&&identity(body)===id&&UUID.test(record.originWorkspaceId??'')&&
    OP.test(record.operationId??'')&&HASH.test(record.requestSha256??'')&&typeof record.actor==='string'&&
    ['offer','buyer-preparation','inbox-capture','receiving','service-start','service-stop'].includes(record.kind),
    'RECORD','The retained merchant record has another identity or schema.');
  if(projectId)need(record.projectId===projectId,'PROJECT','The delivery record belongs to another project.');
  if(versions)need(versions.has(record.versionId),'VERSION','The full transfer omits the delivery record’s original saved version.');
  if(publications)need(publications.has(record.publicationId),'PUBLICATION','The full transfer omits the original selected publication.');
  need(Array.isArray(record.files)&&record.files.length<=20000,'FILES','The complete delivery file inventory is unavailable.');
  const files=uniqueFiles(record.files);need(files.length===record.files.length,'FILES','The delivery inventory repeats a file identity.');
  descriptor(record.journal);need(files.some(f=>stable(f)===stable(record.journal)),'JOURNAL','The original request/result journal is outside the delivery closure.');
  return record;
}
export function inspectMerchantHistory(history,{projectId,versions,publications}={}){
  if(history===undefined)return [];
  need(plain(history)&&history.schema===MERCHANT_SNAPSHOT&&Array.isArray(history.records)&&history.records.length<=5000,'HISTORY','The retained delivery history is invalid.');
  const ids=new Set(),files=[];
  for(const record of history.records){validateRecord(record,{projectId,versions,publications});need(!ids.has(record.id),'HISTORY','The delivery history repeats a record.');ids.add(record.id);files.push(...record.files);}
  return uniqueFiles(files);
}
export async function verifyRecord(store,record){
  validateRecord(record);for(const file of record.files)await inspectRetainedFile(retainedPath(store,file),{expectedBytes:file.bytes,expectedSha256:file.sha256,maximum:2*1024*1024*1024});
  const {value:proof}=await fileJSON(store,record.journal);
  need(proof.schema==='stellar-forge.sensorthings-analysis-merchant-operation.v1'&&proof.workspaceId===record.originWorkspaceId&&
    proof.operationId===record.operationId&&proof.requestSha256===record.requestSha256&&identity({action:proof.action,payload:proof.payload})===record.requestSha256&&
    proof.kind===record.kind&&proof.projectId===record.projectId&&proof.versionId===record.versionId&&proof.publicationId===record.publicationId&&
    proof.payload.actor===record.actor&&stable(proof.value)===stable(record.value),'JOURNAL','The complete record differs from its original request and result.');
  return proof;
}
