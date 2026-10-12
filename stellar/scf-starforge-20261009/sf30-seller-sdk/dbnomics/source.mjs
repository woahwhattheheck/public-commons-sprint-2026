// MIT. Retained DBnomics source declarations for the original SourceDatasetPublisher.
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { readPrivate } from '../postgres/publisher/files.mjs';
import { need, isRecord, clone, canonical, hash, text, seriesId, MAX_CAPTURE_BYTES, OBSERVATION_COLUMNS,
  reportSpec, calculateReport, observationRows } from './model.mjs';
import { inspectDbnomicsCapture, sealDbnomicsCapture } from './provider.mjs';
export const SOURCE_SCHEMA='stellar-forge.dbnomics-dataset-source.v1';
export const HASH=/^[a-f0-9]{64}$/;
export const QUERY_NAME=/^[a-z][a-z0-9_-]{0,63}$/;
export const REPORT_COLUMNS=Object.freeze({calculated_value:'string',calculation:'string',calculation_reason:'string',
  base_period:'string',base_value:'string',base_observation_id:'string',calculation_precision:'string'});
const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
function own(value,keys,name){need(isRecord(value)&&Object.keys(value).every(key=>keys.includes(key)),'Use the documented '+name+' fields.');}
export function memberPath(root,name){
  need(typeof name==='string'&&!name.includes('\\')&&!name.startsWith('/')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'),'Use a contained source member path.');
  const path=resolve(root,name),r=relative(root,path);
  need(r!==''&&!r.startsWith('..'+sep)&&r!=='..','The member must remain within its source directory.');
  return path;
}
/** Public examples may be 0644; immutable retained copies use the original private writer. */
export async function readOriginalFile(path,maximum=MAX_CAPTURE_BYTES){
  const handle=await open(resolve(path),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await handle.stat();need(before.isFile()&&before.size>0&&before.size<=maximum,'The complete input exceeds its file capacity.');
    const bytes=Buffer.alloc(before.size+1);let n=0;
    while(n<bytes.length){const part=await handle.read(bytes,n,bytes.length-n,null);if(!part.bytesRead)break;n+=part.bytesRead;}
    const after=await handle.stat();
    need(n===before.size&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,
      'The original input changed while it was read.','DBNOMICS_INPUT_CHANGED',409);
    return bytes.subarray(0,n);
  }finally{await handle.close();}
}
export async function importDbnomicsInput(path){
  const inputBytes=await readOriginalFile(path),input=JSON.parse(decode(inputBytes));
  if(input.schema==='stellar-forge.dbnomics-capture.v1'){inspectDbnomicsCapture(input);return input;}
  own(input,['schema','selection','rights','sourceMode','responses'],'source-import');
  need(input.schema==='stellar-forge.dbnomics-response-import.v1'&&Array.isArray(input.responses),'Use a complete response-import manifest.');
  const responses=[];
  for(const row of input.responses){
    own(row,['file','receipt'],'response reference');
    responses.push({receipt:row.receipt,bytes:await readOriginalFile(memberPath(dirname(resolve(path)),row.file))});
  }
  return sealDbnomicsCapture({selection:input.selection,rights:input.rights,sourceMode:input.sourceMode,responses});
}
export async function readDbnomicsCapture(path){
  const bytes=await readPrivate(path,MAX_CAPTURE_BYTES),capture=JSON.parse(decode(bytes)),model=inspectDbnomicsCapture(capture);
  return {capture,model,captureBytes:bytes,captureSha256:hash(bytes),captureFile:resolve(path)};
}
export function normalizeSourceQuery(value,model=null){
  own(value,['captureId','seriesIds','start','end','includeMissing','analysis','review'],'saved query');
  need(HASH.test(value.captureId??''),'Choose the exact retained source capture.');
  const chosen=value.seriesIds??model?.series.map(row=>row.id);
  need(Array.isArray(chosen)&&chosen.length>0&&chosen.length<=100&&new Set(chosen).size===chosen.length,'Select retained series once.');
  const seriesIds=chosen.map(seriesId);
  if(model)need(model.captureId===value.captureId&&seriesIds.every(id=>model.series.some(row=>row.id===id)),'The query belongs to another source edition.');
  const filter=reportSpec({title:'Source selection',seriesIds,start:value.start??null,end:value.end??null},model??{series:seriesIds.map(id=>({id}))});
  need(value.includeMissing===undefined||typeof value.includeMissing==='boolean','Choose whether to include missing source observations.');
  own(value.review,['reviewer','note'],'source review');
  const review={reviewer:text(value.review.reviewer,'source reviewer',160),note:text(value.review.note??'','source review note',8000,true)};
  let analysis=null;
  if(value.analysis!==undefined&&value.analysis!==null){
    analysis=reportSpec({...value.analysis,seriesIds,start:filter.start,end:filter.end},model??{series:seriesIds.map(id=>({id}))});
  }
  return {captureId:value.captureId,seriesIds,start:filter.start,end:filter.end,includeMissing:value.includeMissing??true,analysis,review};
}
export function queryColumns(query){
  return Object.entries({...OBSERVATION_COLUMNS,...(query.analysis?REPORT_COLUMNS:{})}).map(([name,type])=>({name,type,nullable:false}));
}
export function selectedObservationRows(model,query){
  query=normalizeSourceQuery(query,model);
  const rows=observationRows(model);
  const selectedIndexes=[];
  for(let i=0;i<model.rows.length;i++){
    const row=model.rows[i];
    if(!query.seriesIds.includes(row.seriesId)||!query.includeMissing&&row.missing)continue;
    if(query.start&&(row.periodStartDay===null||row.periodStartDay<query.start))continue;
    if(query.end&&(row.periodStartDay===null||row.periodStartDay>query.end))continue;
    selectedIndexes.push(i);
  }
  const analyses=query.analysis?new Map(calculateReport(model,query.analysis).rows.map(row=>[row.observationId,row])):null;
  return selectedIndexes.map(index=>{
    const row=rows[index],a=analyses?.get(row.observation_id);
    const out={...row};
    if(analyses){need(a,'The analyst selection differs from its original observations.');Object.assign(out,{
      calculated_value:a.calculatedValue===null?'':String(a.calculatedValue),calculation:a.calculation,
      calculation_reason:a.calculationReason??'',base_period:a.basePeriod??'',base_value:a.baseValue===null?'':String(a.baseValue),
      base_observation_id:a.baseObservationId??'',calculation_precision:a.precision});}
    return {index,row:Object.fromEntries(Object.entries(out).map(([key,value])=>[key,value===null?'':typeof value==='boolean'?String(value):String(value)]))};
  });
}
export async function readDbnomicsSource(sourceFile,{captureId=null}={}){
  const original=await readPrivate(sourceFile,2*1024*1024),config=JSON.parse(decode(original));
  own(config,['schema','captures','queries'],'source declaration');
  need(config.schema===SOURCE_SCHEMA&&isRecord(config.captures)&&Object.keys(config.captures).length<=1000&&
    isRecord(config.queries)&&Object.keys(config.queries).length<=1000,'Use an original DBnomics source declaration.');
  for(const [id,ref] of Object.entries(config.captures)){
    own(ref,['file','sha256','summary'],'capture reference');
    need(HASH.test(id)&&HASH.test(ref.sha256??''),'Capture references must keep their exact hashes.');
    memberPath(dirname(resolve(sourceFile)),ref.file);
  }
  const queries=Object.create(null);
  for(const [name,raw] of Object.entries(config.queries)){
    need(QUERY_NAME.test(name)&&config.captures[raw?.captureId],'Choose a named query with a retained source capture.');
    const q=normalizeSourceQuery(raw);need(canonical(q)===canonical(raw),'The source query is not normalized.');
    const columnTypes=queryColumns(q);
    queries[name]={...q,columns:columnTypes.map(row=>row.name),columnTypes,parameters:[],
      captureSha256:config.captures[q.captureId].sha256};
  }
  let retained=null;
  if(captureId!==null){
    const ref=config.captures[captureId];need(ref,'The selected source capture is absent.','DBNOMICS_CAPTURE_NOT_FOUND',404);
    retained=await readDbnomicsCapture(memberPath(dirname(resolve(sourceFile)),ref.file));
    need(retained.capture.captureId===captureId&&retained.captureSha256===ref.sha256,'The retained source bytes differ from their declaration.','DBNOMICS_SOURCE_CHANGED',409);
  }
  return {sourceFile:resolve(sourceFile),config,queries,original,hash:hash(original),bytes:original.length,retained};
}
export async function inspectDbnomicsSource(sourceFile){
  const selected=await readDbnomicsSource(sourceFile);
  return {hash:selected.hash,bytes:selected.bytes,config:clone(selected.config),queries:selected.queries,
    captures:Object.fromEntries(Object.entries(selected.config.captures).map(([id,ref])=>[id,{...clone(ref.summary),captureId:id,captureSha256:ref.sha256}]))};
}
