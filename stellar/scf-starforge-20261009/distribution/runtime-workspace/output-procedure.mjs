// MIT. Complete fixed-end Runtime output carried by the original Operating Plan.
import { createHash } from 'node:crypto';
import { createOperatingFile, operatingFileBytes, OPERATING_FILE_MAX_BYTES } from '../discovery/operating-plan.mjs';
import { need, plain, canonical, operationId, recordId } from './storage.mjs';
import { projectOutputReview, verifyOutputReview } from './output-review-core.mjs';
export const OUTPUT_CAPTURE_SCHEMA = 'stellar-forge.runtime-output-capture.v1';
const hash = value => createHash('sha256').update(value).digest('hex');
const same = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const only = (value,keys) => need(plain(value)&&Object.keys(value).every(key=>keys.includes(key)),'PROCEDURE_OUTPUT_FIELDS');
const HASH = /^[a-f0-9]{64}$/;
const failCapacity = () => need(false,'PROCEDURE_OUTPUT_CAPACITY',
  'Keep the complete selected output with its native download. This entire output and its match index must fit the original 24 MiB carried-file and 32 MiB saved-plan capacities.',413);
export function checkedProcedureOutput(value) {
  only(value,['kind','input','selection','query','contextBytes']);
  need(['application','runtime'].includes(value.kind),'PROCEDURE_OUTPUT_KIND');
  const input=value.input;
  if(value.kind==='application') {
    only(input,['applicationId','operationId']);
    recordId(input.applicationId);operationId(input.operationId);
  } else {
    only(input,['operationId','runtimeId','logFile']);
    need((input.operationId!==undefined)!==(input.runtimeId!==undefined),'PROCEDURE_OUTPUT_SOURCE');
    if(input.operationId!==undefined){operationId(input.operationId);need(input.logFile===undefined,'PROCEDURE_OUTPUT_SOURCE');}
    else {recordId(input.runtimeId);need(typeof input.logFile==='string'&&/^install-(\d+)(?:-[a-f0-9-]{36})?\.log$/.test(input.logFile),'PROCEDURE_OUTPUT_LOG');}
  }
  need(typeof value.selection==='string'&&value.selection.length>0&&value.selection.length<=2048&&/^[A-Za-z0-9_-]+$/.test(value.selection),'PROCEDURE_OUTPUT_SELECTION');
  need(typeof value.query==='string','PROCEDURE_OUTPUT_QUERY');
  const query=Buffer.from(value.query,'utf8');
  need(query.length>0&&query.length<=4096&&query.toString('utf8')===value.query,'PROCEDURE_OUTPUT_QUERY');
  const contextBytes=value.contextBytes??96;
  need(Number.isSafeInteger(contextBytes)&&contextBytes>=0&&contextBytes<=4096,'PROCEDURE_OUTPUT_CONTEXT');
  return {...value,input:{...input},contextBytes};
}
function originalSelection(selected,workspaceId) {
  let token;
  try {token=JSON.parse(Buffer.from(selected.selection,'base64url').toString('utf8'));}
  catch {need(false,'PROCEDURE_OUTPUT_SELECTION');}
  const identity=selected.kind==='application'?selected.input:
    {workspaceId,sourceKind:selected.input.operationId?'operation':'npm-install',...selected.input};
  need(plain(token)&&Object.keys(token).length===Object.keys(identity).length+4&&
    Object.keys(token).every(k=>['schema',...Object.keys(identity),'sourceId','endOffset','guardSha256'].includes(k))&&
    token.schema==='stellar-forge.'+(selected.kind==='application'?'application':'runtime')+'-output-selection.v1'&&
    Object.entries(identity).every(([k,v])=>token[k]===v)&&HASH.test(token.sourceId??'')&&HASH.test(token.guardSha256??'')&&
    Number.isSafeInteger(token.endOffset)&&token.endOffset>=0,'PROCEDURE_OUTPUT_SELECTION_BINDING');
  return token;
}
export async function captureProcedureOutput(model,workspaceId,captureId,input) {
  const selected=checkedProcedureOutput(input),token=originalSelection(selected,workspaceId);
  if(token.endOffset>OPERATING_FILE_MAX_BYTES)failCapacity();
  const download=await model[selected.kind==='application'?'applicationsOutputDownload':'runtimeOutputDownload']({...selected.input,selection:selected.selection});
  let raw;
  try {
    need(download.selection===selected.selection&&download.sourceId===token.sourceId&&download.bytes===token.endOffset,'PROCEDURE_OUTPUT_SOURCE_CHANGED');
    const chunks=[];let size=0;
    for await(const chunk of download.stream){
      const bytes=Buffer.from(chunk);size+=bytes.length;
      need(size<=token.endOffset,'PROCEDURE_OUTPUT_LENGTH');
      chunks.push(bytes);
    }
    need(size===token.endOffset,'PROCEDURE_OUTPUT_INCOMPLETE');
    raw=Buffer.concat(chunks,size);
  } finally {download.stream.destroy();await download.close();}
  const file=createOperatingFile({id:'runtime-output-'+captureId,name:download.filename,
    mediaType:'application/octet-stream',bytes:raw,
    note:'Complete original selected bytes 0–'+raw.length+'. Query, source generation, SHA-256 and every literal match are retained in the companion Runtime capture.'});
  const review=await projectOutputReview({read:async(offset,length)=>raw.subarray(offset,offset+length),
    endOffset:raw.length,query:selected.query,contextBytes:selected.contextBytes,maximumBytes:OPERATING_FILE_MAX_BYTES});
  return {file,output:{schema:OUTPUT_CAPTURE_SCHEMA,workspaceId,selection:selected,sourceId:token.sourceId,
    fileId:file.id,filename:file.name,bytes:raw.length,sha256:hash(raw),review}};
}
function filesInPlan(plan) {
  const files=new Map();
  for(const revision of plan.revisions)for(const step of revision.steps)for(const file of step.files??[]){
    const values=files.get(file.id)??[];values.push(file);files.set(file.id,values);
  }
  return files;
}
/** Structural/source-byte validation is synchronous for the original record inspector.
 * Exact exhaustive query verification is performed by verifyProcedureOutputs before
 * native read, write, receiving and returned-plan admission. */
export function inspectProcedureOutputs(plan) {
  const files=filesInPlan(plan),outputs=[],seen=new Set();
  for(const [id,versions] of files){
    if(!id.startsWith('runtime-capture-'))continue;
    const raw=operatingFileBytes(versions[0]);let body;
    try{body=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw));}catch{continue;}
    if(body?.schema!=='stellar-forge.runtime-operating-capture.v1')continue;
    const selected=body.selection?.output;
    if(selected===undefined){need(body.output===undefined,'PROCEDURE_OUTPUT_SELECTION_MISSING');continue;}
    operationId(body.id);operationId(body.workspaceId);
    need(id==='runtime-capture-'+body.id,'PROCEDURE_OUTPUT_CAPTURE_ID');
    const output=body.output;only(output,['schema','workspaceId','selection','sourceId','fileId','filename','bytes','sha256','review']);
    const choice=checkedProcedureOutput(selected),token=originalSelection(choice,body.workspaceId);
    need(output.schema===OUTPUT_CAPTURE_SCHEMA&&output.workspaceId===body.workspaceId&&same(output.selection,choice)&&
      output.sourceId===token.sourceId&&output.fileId==='runtime-output-'+body.id&&
      output.bytes===token.endOffset&&HASH.test(output.sha256??''),'PROCEDURE_OUTPUT_BINDING');
    need(output.review?.query===choice.query&&output.review?.contextBytes===choice.contextBytes&&
      output.review?.endOffset===token.endOffset,'PROCEDURE_OUTPUT_QUERY_BINDING');
    const rawVersions=files.get(output.fileId);
    need(rawVersions?.length,'PROCEDURE_OUTPUT_FILE_MISSING');
    let bytes;
    for(const file of rawVersions) {
      const current=operatingFileBytes(file);
      need(file.name===output.filename&&file.bytes===output.bytes&&hash(current)===output.sha256,'PROCEDURE_OUTPUT_FILE_CHANGED');
      bytes??=current;
    }
    const captureHash=hash(raw);
    for(const version of versions)need(hash(operatingFileBytes(version))===captureHash,'PROCEDURE_OUTPUT_CAPTURE_CHANGED');
    need(!seen.has(body.id),'PROCEDURE_OUTPUT_CAPTURE_DUPLICATE');seen.add(body.id);
    outputs.push({captureId:body.id,output,file:rawVersions[0],bytes});
  }
  return outputs;
}
export async function verifyProcedureOutputs(plan) {
  const outputs=inspectProcedureOutputs(plan);
  for(const item of outputs)await verifyOutputReview(item.output.review,{
    read:async(offset,length)=>item.bytes.subarray(offset,offset+length),
    endOffset:item.bytes.length,maximumBytes:OPERATING_FILE_MAX_BYTES});
  return outputs;
}

/** Retained returned plans remain original evidence even before their choices are applied. */
export async function verifyProcedureRecordOutputs(record) {
  const candidates=[record.plan];
  for(const review of record.returnReviews??[])candidates.push(review.current,review.incoming,review.completion?.plan);
  const verified=new Set();
  for(const plan of candidates){
    if(!plan)continue;
    const identity=hash(JSON.stringify(canonical(plan)));
    if(verified.has(identity))continue;
    await verifyProcedureOutputs(plan);verified.add(identity);
  }
}
