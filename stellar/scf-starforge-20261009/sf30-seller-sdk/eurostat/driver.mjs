// MIT. Eurostat source editions in the original durable source-dataset publisher.
import { join } from 'node:path';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { loadCsvDataset } from '../dataset-handler.mjs';
import { csvLine } from '../postgres/publisher/plan.mjs';
import { datasetExtractionOptions } from '../postgres/publisher/stream.mjs';
import { bytes, digest, identity, createFile, privateDirectory, syncDirectory } from '../postgres/publisher/files.mjs';
import { readSource, inspectEurostatSource, HASH } from './source.mjs';
import { EUROSTAT_SOURCE_SCHEMA, object, need, fault, selectedCellIndexes, cellRow, compareText } from './model.mjs';
const only=(v,keys,code)=>need(object(v)&&Object.keys(v).every(k=>keys.includes(k)),code);
export function checkEurostatColumnTypes(columns, types) {
  need(object(columns)&&Array.isArray(types),'EUROSTAT_COLUMN_TYPES');
  const byName=new Map(types.map(v=>[v.name,v]));
  for(const [name,v] of Object.entries(columns)) {
    const original=byName.get(name);
    need(original && v.type===original.type && (v.nullable??false)===original.nullable,'EUROSTAT_COLUMN_TYPE_CHANGED',
      'Retain the original lossless column type for '+name+'.');
  }
}
export function encodeEurostatRow(row,dataset) {
  return csvLine(Object.entries(dataset.columns).map(([name,v])=>{
    const text=row[name];
    need(typeof text==='string'&&text.length<=dataset.maxCellChars&&!v.nullable,'EUROSTAT_ROW_ENCODING');
    if(v.type==='integer')need(/^(0|[1-9][0-9]*)$/.test(text)&&Number.isSafeInteger(Number(text)),'EUROSTAT_CELL_INDEX_ENCODING');
    else need(v.type==='string','EUROSTAT_EXACT_VALUE_TYPE');
    return text;
  }));
}
export async function openEurostatSourceFile(sourceFile) {
  const selected=await readSource(sourceFile);
  const columnTypes=Object.fromEntries(Object.entries(selected.queries).map(([name,q])=>[name,q.columnTypes]));
  let closed=false, active=null;
  const source={
    inspect(){return {sourceName:'Eurostat',queries:selected.queries,columnTypes};},
    async exportDataset(name,input={},supplied={}) {
      need(!closed&&!active,closed?'EUROSTAT_SOURCE_CLOSED':'EUROSTAT_SOURCE_BUSY');
      const query=selected.queries[name];need(query,'QUERY_NOT_FOUND');
      need(object(input)&&Object.keys(input).length===0,'EUROSTAT_QUERY_INPUT_NOT_SUPPORTED');
      const {onRow,signal,...limits}=supplied;need(typeof onRow==='function','EUROSTAT_ROW_CALLBACK');
      const options=datasetExtractionOptions(query,limits);
      const retained=selected.captures[query.captureId],cube=retained.cube;
      const indexes=selectedCellIndexes(cube,query.selection,{includeMissing:query.includeMissing});
      need(indexes.length<=options.maxRows,'EUROSTAT_EXTRACTION_TOO_MANY_ROWS','Increase the reviewed row limit or narrow the selection.');
      const op={cancelled:false,promise:null};active=op;
      const started=Date.now();
      const ensure=()=>{need(!op.cancelled&&!signal?.aborted,'EUROSTAT_EXTRACTION_CANCELLED');
        need(Date.now()-started<=options.timeoutMs,'EUROSTAT_EXTRACTION_TIMEOUT');};
      op.promise=(async()=>{
        ensure();
        const rows=indexes.map(index=>({index,row:cellRow(cube,index)}));
        rows.sort((a,b)=>{
          for(const order of options.order){
            const cmp=order.column==='cell_index'?Number(a.row.cell_index)-Number(b.row.cell_index):
              compareText(a.row[order.column],b.row[order.column]);
            if(cmp)return order.direction==='asc'?cmp:-cmp;
          }return a.index-b.index;
        });
        let rowCount=0,sourceTextBytes=0;
        for(const {row} of rows) {
          ensure();const n=Object.values(row).reduce((sum,v)=>sum+Buffer.byteLength(v),0);
          sourceTextBytes+=n;need(n<=options.maxRowBytes&&sourceTextBytes<=options.maxBytes,'EUROSTAT_EXTRACTION_BYTE_LIMIT');
          await onRow(row,columnTypes[name],{rowCount:rowCount+1,sourceTextBytes});ensure();rowCount++;
          if(rowCount%256===0)await yieldTurn();
        }
        return {schema:'stellar-forge.eurostat-extraction.v1',query:name,captureId:query.captureId,
          captureSha256:retained.captureSha256,responseSha256:retained.capture.response.sha256,
          sourceUrl:retained.capture.sourceUrl,sourceUpdated:cube.updated,review:query.review,
          selection:query.selection,includeMissing:query.includeMissing,rowCount,sourceTextBytes,
          columns:query.columns,columnTypes:columnTypes[name],order:options.order,
          valueEncoding:'original-json-number-lexeme',nullEncoding:'separate-value-and-status-state',
          tieBreak:'original-jsonstat-cell-index'};
      })();
      try{return await op.promise;}finally{if(active===op)active=null;}
    },
    async close(){closed=true;if(active){active.cancelled=true;try{await active.promise;}catch{}}}
  };
  return {source,config:selected.config};
}
export async function captureEurostatPlan(sourceFile,directory,input) {
  only(input,['title','query','input','dataset','extraction','sourceHash'],'INVALID_PUBLICATION_PLAN');
  need(typeof input.title==='string'&&input.title.trim()&&input.title.length<=128,'PLAN_TITLE_REQUIRED');
  const selected=await readSource(sourceFile);
  need(input.sourceHash===selected.hash,'SOURCE_REVIEW_CHANGED','Reload the Eurostat source before saving.',409);
  const query=selected.queries[input.query];need(query,'QUERY_NOT_FOUND');
  need(object(input.input??{})&&Object.keys(input.input??{}).length===0,'EUROSTAT_QUERY_INPUT_NOT_SUPPORTED');
  const extraction=datasetExtractionOptions(query,input.extraction);
  only(input.dataset,['name','columns','filters','ranges','sorts','maxCellChars','defaultLimit','maxLimit','maxPageBytes'],'INVALID_DATASET_PLAN');
  need(object(input.dataset.columns)&&Object.keys(input.dataset.columns).length>0,'DATASET_COLUMNS_REQUIRED');
  const columns=Object.fromEntries(Object.entries(input.dataset.columns).map(([name,spec])=>{
    const v=typeof spec==='string'?{type:spec,nullable:false}:spec;only(v,['type','nullable'],'INVALID_DATASET_COLUMN');
    return [name,{type:v.type,nullable:v.nullable??false}];
  }));
  checkEurostatColumnTypes(columns,query.columnTypes);
  const dataset={schema:'stellar-forge.csv-dataset.v1',file:'data.csv',name:input.dataset.name,
    columns,filters:input.dataset.filters??[],ranges:input.dataset.ranges??[],sorts:input.dataset.sorts??[],
    maxBytes:extraction.maxBytes,maxRows:extraction.maxRows,maxCellChars:input.dataset.maxCellChars??65536,
    defaultLimit:input.dataset.defaultLimit??50,maxLimit:input.dataset.maxLimit??250,maxPageBytes:input.dataset.maxPageBytes??921600};
  await createFile(join(directory,'schema.csv'),csvLine(Object.keys(columns)));
  await loadCsvDataset({...dataset,file:join(directory,'schema.csv')});
  const retained=selected.captures[query.captureId];
  await privateDirectory(join(directory,'capture'),true);
  await createFile(join(directory,'capture','response.json'),retained.body);
  await createFile(join(directory,'capture','capture.json'),retained.captureBytes);
  await syncDirectory(join(directory,'capture'));
  const runtime={schema:EUROSTAT_SOURCE_SCHEMA,
    captures:{[query.captureId]:{file:'capture/capture.json',sha256:retained.captureSha256}},
    queries:{[input.query]:selected.config.queries[input.query]}};
  const runtimeBytes=bytes(runtime);
  await createFile(join(directory,'original-source.json'),selected.original);
  await createFile(join(directory,'source.json'),runtimeBytes);
  const plan={schema:'stellar-forge.eurostat-dataset-plan.v1',title:input.title.trim(),
    query:input.query,input:{},dataset,extraction,sourceHash:selected.hash,sourceBytes:selected.bytes,
    runtimeSourceHash:digest(runtimeBytes),queryHash:identity(query),sourceQuery:query,
    retainedCapture:{manifestSha256:retained.captureSha256,responseSha256:retained.capture.response.sha256,
      captureId:query.captureId,sourceUrl:retained.capture.sourceUrl}};
  plan.digest=identity(plan);await createFile(join(directory,'plan.json'),bytes(plan));return plan;
}
export const eurostatPublisherDriver=Object.freeze({
  sourceName:'Eurostat',workspaceSchema:'stellar-forge.eurostat-publisher-workspace.v1',
  statusSchema:'stellar-forge.eurostat-publisher-status.v1',candidateSchema:'stellar-forge.eurostat-dataset-candidate.v1',
  capturePlan:captureEurostatPlan,inspectSource:inspectEurostatSource,openSource:openEurostatSourceFile,
  checkColumnTypes:checkEurostatColumnTypes,encodeRow:encodeEurostatRow,
  validateExtraction:v=>v?.schema==='stellar-forge.eurostat-extraction.v1'&&HASH.test(v.captureId??'')&&
    HASH.test(v.captureSha256??'')&&HASH.test(v.responseSha256??'')&&v.valueEncoding==='original-json-number-lexeme'&&
    v.nullEncoding==='separate-value-and-status-state'&&v.tieBreak==='original-jsonstat-cell-index'&&
    Number.isSafeInteger(v.rowCount)&&v.rowCount>=0&&Array.isArray(v.columnTypes)&&Array.isArray(v.columns)&&Array.isArray(v.order)
});
