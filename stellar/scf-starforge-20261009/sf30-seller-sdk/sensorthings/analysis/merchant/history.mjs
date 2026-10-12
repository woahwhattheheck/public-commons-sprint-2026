// SPDX-License-Identifier: MIT
// Project transfer keeps the original delivery requests, phase files and committed records.
import {join} from 'node:path';
import {identity,stable,json,sha,plain,need,descriptor,uniqueFiles,phaseInventory,fileJSON,phase,verifyRecord} from './common.mjs';
import {MERCHANT_SNAPSHOT} from './schema.mjs';
const OP_HISTORY='stellar-forge.sensorthings-analysis-merchant-operation-history.v1';
export function operationProject(op){
  const c=op.context?.analysis?.merchant;
  return c?.projectId??c?.source?.publication?.projectId??c?.offer?.projectId??c?.original?.projectId??null;
}
export function selectHistory(state,projectId){
  return {records:structuredClone((state.analysisMerchant??[]).filter(x=>x.projectId===projectId)),
    operations:structuredClone(Object.values(state.operations).filter(x=>x.action.startsWith('analysis.merchant.')&&operationProject(x)===projectId)),
    imported:structuredClone((state.analysisMerchantHistory??[]).filter(x=>x.projectId===projectId))};
}
function fileReferences(value,found=[],seen=new Set()){
  if(!value||typeof value!=='object'||seen.has(value))return found;seen.add(value);
  if(plain(value)&&Object.hasOwn(value,'storage')&&Object.hasOwn(value,'sha256')&&Object.hasOwn(value,'bytes')){
    descriptor(value);found.push(value);return found;
  }
  for(const item of Array.isArray(value)?value:Object.values(value))fileReferences(item,found,seen);
  return found;
}
export function validateOperationHistory(entry,{projectId,records}={}){
  const {id,...body}=entry??{},op=entry?.original;
  need(plain(entry)&&entry.schema===OP_HISTORY&&identity(body)===id&&entry.projectId===projectId&&
    typeof entry.originWorkspaceId==='string'&&plain(op)&&/^[A-Za-z0-9_-]{8,100}$/.test(op.operationId??'')&&
    op.action?.startsWith('analysis.merchant.')&&identity({action:op.action,payload:op.payload})===op.requestSha256&&
    operationProject(op)===projectId&&['RUNNING','FAILED','COMPLETE'].includes(op.state)&&
    Array.isArray(entry.files)&&uniqueFiles(entry.files).length===entry.files.length,
    'OPERATION_HISTORY','The original project operation history is inconsistent.');
  if(op.state==='COMPLETE')need(entry.result!==null&&identity(entry.result)===entry.resultIdentity&&
    sha(json(entry.result))===op.resultSha256,'OPERATION_HISTORY','The completed original result is absent.');
  else need(entry.result===null&&entry.resultIdentity===null,'OPERATION_HISTORY','An unfinished original operation cannot have a completed result.');
  if(entry.result?.schema==='stellar-forge.sensorthings-analysis-merchant-record.v1')
    need(records?.has(entry.result.id),'OPERATION_HISTORY','The full project omits this operation’s committed delivery record.');
  return entry;
}
export function validateHistoryExtension(history,{projectId}){
  if(history===undefined)return [];
  need(history.schema===MERCHANT_SNAPSHOT&&Array.isArray(history.records),'HISTORY','The project delivery history is invalid.');
  const ids=new Set(),records=new Set(history.records.map(x=>x.id)),files=[];
  for(const entry of history.operations??[]){
    validateOperationHistory(entry,{projectId,records});
    need(!ids.has(entry.id),'OPERATION_HISTORY','The operation history repeats an identity.');ids.add(entry.id);files.push(...entry.files);
  }
  return uniqueFiles(files);
}
export async function captureHistory(store,op,selection,projectId){
  if(!selection)return undefined;
  return phase(store,op,'project-merchant-history',async()=>{
    const operations=[...selection.imported],records=selection.records,ids=new Set(operations.map(x=>x.id));
    for(const record of records)await verifyRecord(store,record);
    for(const original of selection.operations){
      // This is the request/status at the selected workspace revision. Immutable
      // phase files are retained as observed during this export. They are not a
      // claim that an in-progress operation completed at the selected revision.
      const files=await phaseInventory(store,original),references=[];
      for(const file of files){const {value}=await fileJSON(store,file);fileReferences(value,references);}
      const result=original.state==='COMPLETE'?JSON.parse((await store.object(original.resultSha256)).toString('utf8')):null;
      fileReferences(result,references);
      const body={schema:OP_HISTORY,originWorkspaceId:store.read().workspaceId,projectId,
        original:structuredClone(original),result,resultIdentity:result===null?null:identity(result),
        files:uniqueFiles([...files,...references]),exportOperationId:op.operationId,exportCreatedAt:op.createdAt,
        meaning:'Original operation at the selected workspace revision and its retained immutable phase closure. Imported history is not dispatch authority.'},
        entry={id:identity(body),...body};
      validateOperationHistory(entry,{projectId,records:new Set(records.map(x=>x.id))});
      for(const file of entry.files)await storeFile(store,file);
      if(!ids.has(entry.id)){operations.push(entry);ids.add(entry.id);}
    }
    const result={schema:MERCHANT_SNAPSHOT,records,operations};
    validateHistoryExtension(result,{projectId});return result;
  });
}
async function storeFile(store,file){
  // The original file verifier reads held descriptors and does not adopt a
  // directory or reinterpret an archive descriptor as a CAS object.
  const {inspectRetainedFile}=await import('../../portable.mjs');
  await inspectRetainedFile(join(store.root,'exports',file.storage.operationId,file.storage.filename),
    {expectedBytes:file.bytes,expectedSha256:file.sha256,maximum:2*1024*1024*1024});
}
