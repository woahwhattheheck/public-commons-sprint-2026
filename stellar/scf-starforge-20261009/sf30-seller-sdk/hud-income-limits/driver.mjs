// MIT. HUD capture and selection join the ORIGINAL durable dataset publisher.
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { loadCsvDataset } from '../dataset-handler.mjs';
import { csvLine } from '../postgres/publisher/plan.mjs';
import { datasetExtractionOptions } from '../postgres/publisher/stream.mjs';
import { openSourceDatasetPublisher } from '../postgres/publisher/model.mjs';
import { bytes,digest,identity,readPrivate,createFile,privateDirectory,syncDirectory,fault } from '../postgres/publisher/files.mjs';
import { HASH,TYPES,COLUMNS,ORDER,only,selection,observations,queryDefinition,datasetPlan } from './contract.mjs';
import { readHudSource } from './release.mjs';

export function checkHudColumnTypes(columns,types){
  if(!Array.isArray(types))throw fault('HUD_COLUMN_TYPES_REQUIRED');
  for(const [name,spec] of Object.entries(columns)){
    const type=types.find(item=>item.name===name);
    if(!type||type.type!==spec.type||type.nullable!==spec.nullable)throw fault('HUD_COLUMN_TYPE_MISMATCH','Retain the original declared type and nullability for '+name+'.');
  }
}
export function encodeHudRow(row,dataset){
  return csvLine(Object.entries(dataset.columns).map(([name,spec])=>{
    const value=row[name];
    if(value===null){if(!spec.nullable)throw fault('HUD_NULL_NOT_ALLOWED');return '';}
    if(spec.type==='integer'&&!Number.isSafeInteger(value)||spec.type==='string'&&typeof value!=='string')throw fault('HUD_NATIVE_SCALAR_CHANGED');
    const text=String(value);
    if(text.length>dataset.maxCellChars||!text&&spec.nullable)throw fault('HUD_CELL_ENCODING_INVALID');
    return text;
  }));
}
export async function inspectHudSource(filename){
  const source=await readHudSource(filename,{includeRows:false});
  return {hash:source.hash,bytes:source.original.length,sourceName:'HUD Income Limits',queries:source.queries,
    release:{releaseId:source.manifest.releaseId,fiscalYear:source.manifest.fiscalYear,effectiveDate:source.manifest.effectiveDate,
      localities:source.manifest.projection.localityRows,hudAreas:source.manifest.projection.hudAreaCount,
      workbookSha256:source.manifest.files.workbook.sha256,parserSha256:source.manifest.projection.parserSha256}};
}
export async function openHudSourceFile(filename){
  const selected=await readHudSource(filename),types=Object.entries(TYPES).map(([name,spec])=>({name,...spec}));
  const lifetime=new AbortController();let active=false,closed=false;
  return {source:{
    inspect:()=>({columnTypes:{limits:structuredClone(types)}}),
    async exportDataset(name,input={},supplied={}){
      if(name!=='limits')throw fault('QUERY_NOT_FOUND');
      if(closed||active)throw fault(closed?'HUD_SOURCE_CLOSED':'HUD_SOURCE_BUSY');
      const chosen=selection({...selected.selection,...input}),query=selected.queries.limits;
      const {signal,onRow,...limits}=supplied,options=datasetExtractionOptions(query,limits);
      if(typeof onRow!=='function')throw fault('HUD_ROW_CONSUMER_REQUIRED');
      const timeout=AbortSignal.timeout(options.timeoutMs),abort=AbortSignal.any([lifetime.signal,timeout,...(signal?[signal]:[])]);
      const ensure=()=>{if(abort.aborted)throw fault(timeout.aborted?'HUD_EXTRACTION_TIMEOUT':'HUD_EXTRACTION_CANCELLED');};
      active=true;
      try{
        const rows=[];let sourceTextBytes=0;
        for(let i=0;i<selected.rows.length;i++){
          if(i%256===0){await setImmediate();ensure();}
          for(const row of observations(selected.rows[i],selected.manifest,chosen)){
            if(rows.length>=options.maxRows)throw fault('DATASET_EXTRACTION_TOO_MANY_ROWS');
            const rowBytes=Object.values(row).reduce((sum,value)=>sum+(value===null?0:Buffer.byteLength(String(value))),0);
            sourceTextBytes+=rowBytes;
            if(rowBytes>options.maxRowBytes||sourceTextBytes>options.maxBytes)throw fault('DATASET_EXTRACTION_TOO_MANY_BYTES');
            rows.push(row);
          }
        }
        if(!rows.length)throw fault('HUD_SELECTION_EMPTY','The explicit selection matches no published observations.');
        rows.sort((a,b)=>{
          for(const order of options.order){
            const left=a[order.column],right=b[order.column];
            if(left===right)continue;if(left===null||right===null)return left===null?1:-1;
            return (left<right?-1:1)*(order.direction==='asc'?1:-1);
          }
          return a.source_row-b.source_row;
        });
        for(let i=0;i<rows.length;i++){
          ensure();await onRow(rows[i],types,{rowCount:i+1,sourceTextBytes});
          if(i%256===0)await setImmediate();
        }
        ensure();
        return {schema:'stellar-forge.hud-dataset-extraction.v1',query:name,rowCount:rows.length,sourceTextBytes,
          columns:[...COLUMNS],columnTypes:types,order:options.order,valueEncoding:'hud-published-workbook-values',nullEncoding:'json-null',
          observation:{schema:'stellar-forge.hud-release-observation.v1',kind:'RETAINED_PUBLISHED_HUD_RELEASE',readOnly:true,
            releaseId:selected.manifest.releaseId,fiscalYear:selected.manifest.fiscalYear,effectiveDate:selected.manifest.effectiveDate,
            workbookSha256:selected.manifest.files.workbook.sha256,indexSha256:selected.manifest.projection.indexSha256,
            parserSha256:selected.manifest.projection.parserSha256,selection:chosen,selectionHash:identity(chosen),
            localityRows:selected.manifest.projection.localityRows,sourceDocuments:selected.manifest.files,
            geography:'original HUD locality and income-limit area',additive:false}};
      }finally{active=false;}
    },
    close(){closed=true;lifetime.abort();}
  }};
}
export async function captureHudPlan(sourceFile,directory,input){
  only(input,['title','query','input','dataset','extraction','sourceHash'],'HUD_PUBLICATION_PLAN_INVALID');
  if(typeof input.title!=='string'||!input.title.trim()||input.title.length>128)throw fault('PLAN_TITLE_REQUIRED');
  const selected=await readHudSource(sourceFile,{includeRows:false});
  if(selected.hash!==input.sourceHash)throw fault('SOURCE_REVIEW_CHANGED','Reload the selected HUD release and save this plan again.',409);
  if(input.query!=='limits')throw fault('QUERY_NOT_FOUND');
  const chosen=selection({...selected.selection,...input.input}),query=queryDefinition(selected.manifest,chosen);
  const extraction=datasetExtractionOptions(query,input.extraction);
  only(input.dataset,['name','columns','filters','ranges','sorts','maxCellChars','defaultLimit','maxLimit','maxPageBytes'],'HUD_DATASET_PLAN_INVALID');
  if(!input.dataset.columns||Object.keys(input.dataset.columns).some(name=>!COLUMNS.includes(name)))throw fault('HUD_DATASET_COLUMNS_INVALID');
  for(const name of COLUMNS)
    if(!Object.hasOwn(input.dataset.columns,name))throw fault('HUD_IDENTITY_COLUMN_REQUIRED','Preserve '+name+' with each published value.');
  const columns=Object.fromEntries(Object.entries(input.dataset.columns).map(([name,spec])=>{
    const value=typeof spec==='string'?{type:spec,nullable:false}:spec;
    only(value,['type','nullable']);return [name,{type:value.type,nullable:value.nullable??false}];
  }));
  checkHudColumnTypes(columns,query.columnTypes);
  const dataset={schema:'stellar-forge.csv-dataset.v1',file:'data.csv',name:input.dataset.name,columns,
    filters:input.dataset.filters??[],ranges:input.dataset.ranges??[],sorts:input.dataset.sorts??[],
    maxBytes:extraction.maxBytes,maxRows:extraction.maxRows,maxCellChars:input.dataset.maxCellChars??65536,
    defaultLimit:input.dataset.defaultLimit??50,maxLimit:input.dataset.maxLimit??250,maxPageBytes:input.dataset.maxPageBytes??921600};
  await createFile(join(directory,'schema.csv'),csvLine(Object.keys(columns)));
  await loadCsvDataset({...dataset,file:join(directory,'schema.csv')});
  const retained=join(directory,'release');await privateDirectory(retained,true);
  for(const record of Object.values(selected.manifest.files)){
    await createFile(join(retained,record.name),await readPrivate(join(selected.directory,record.name),record.bytes));
    await createFile(join(retained,record.capture.name),await readPrivate(join(selected.directory,record.capture.name),65536));
  }
  await createFile(join(retained,'localities.jsonl'),selected.index);
  await createFile(join(retained,'release.json'),selected.raw);await syncDirectory(retained);
  const runtime={...selected.config,release:'release/release.json',selection:chosen},runtimeBytes=bytes(runtime);
  await createFile(join(directory,'original-source.json'),selected.original);await createFile(join(directory,'source.json'),runtimeBytes);
  const plan={schema:'stellar-forge.hud-dataset-plan.v1',title:input.title.trim(),query:'limits',input:chosen,
    dataset,extraction,sourceHash:selected.hash,sourceBytes:selected.original.length,runtimeSourceHash:digest(runtimeBytes),
    queryHash:identity(query),releaseId:selected.manifest.releaseId,sourceQuery:query};
  plan.digest=identity(plan);await createFile(join(directory,'plan.json'),bytes(plan));return plan;
}
export const hudPublisherDriver=Object.freeze({
  sourceName:'HUD Income Limits',
  workspaceSchema:'stellar-forge.hud-publisher-workspace.v1',statusSchema:'stellar-forge.hud-publisher-status.v1',
  candidateSchema:'stellar-forge.hud-dataset-candidate.v1',capturePlan:captureHudPlan,inspectSource:inspectHudSource,
  openSource:openHudSourceFile,checkColumnTypes:checkHudColumnTypes,encodeRow:encodeHudRow,
  validateExtraction:record=>record?.schema==='stellar-forge.hud-dataset-extraction.v1'&&
    record.valueEncoding==='hud-published-workbook-values'&&record.nullEncoding==='json-null'&&
    record.observation?.kind==='RETAINED_PUBLISHED_HUD_RELEASE'&&record.observation.readOnly===true&&
    record.observation.additive===false&&HASH.test(record.observation.releaseId??'')&&
    HASH.test(record.observation.workbookSha256??'')&&HASH.test(record.observation.indexSha256??'')&&
    Number.isSafeInteger(record.rowCount)&&record.rowCount>0
});
export const openHudPublisher=(options={})=>openSourceDatasetPublisher(options,hudPublisherDriver);
export async function defaultHudPlan(sourceFile,{title='Reviewed HUD published selection',selection:chosen,name}={}){
  const source=await readHudSource(sourceFile,{includeRows:false});
  return {title,query:'limits',sourceHash:source.hash,input:selection(chosen??source.selection),dataset:datasetPlan(name),
    extraction:{maxRows:250000,maxBytes:134217728,maxRowBytes:1048576,timeoutMs:120000,order:structuredClone(ORDER)}};
}
