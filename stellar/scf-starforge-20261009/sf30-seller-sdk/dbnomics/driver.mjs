// MIT. DBnomics source driver in the maintained source-dataset publisher.
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {loadCsvDataset} from '../dataset-handler.mjs';
import {csvLine} from '../postgres/publisher/plan.mjs';
import {datasetExtractionOptions} from '../postgres/publisher/stream.mjs';
import {bytes,digest,identity,createFile,privateDirectory,syncDirectory} from '../postgres/publisher/files.mjs';
import {need,isRecord,canonical,hash,operationId} from './model.mjs';
import {SOURCE_SCHEMA,HASH,readDbnomicsSource,readOriginalFile,inspectDbnomicsSource,normalizeSourceQuery,queryColumns,selectedObservationRows} from './source.mjs';
const only=(value,keys)=>need(isRecord(value)&&Object.keys(value).every(key=>keys.includes(key)),'Use the documented publication fields.');
export function checkDbnomicsColumnTypes(columns,types){
  need(isRecord(columns)&&Array.isArray(types),'Use the original typed source columns.');
  const byName=new Map(types.map(row=>[row.name,row]));
  for(const [name,spec] of Object.entries(columns)){
    const original=byName.get(name);
    need(original&&spec.type===original.type&&(spec.nullable??false)===original.nullable,
      'Keep the original lossless type for '+name+'.','DBNOMICS_COLUMN_TYPE_CHANGED');
  }
}
export function encodeDbnomicsRow(row,dataset){
  return csvLine(Object.entries(dataset.columns).map(([name,spec])=>{
    const value=row[name];need(typeof value==='string'&&value.length<=dataset.maxCellChars&&!spec.nullable,'The source row does not match its reviewed columns.');
    need(spec.type==='string'||spec.type==='boolean'&&['true','false'].includes(value),'Use the original string or boolean encoding.');
    return value;
  }));
}
export async function openDbnomicsSourceFile(sourceFile){
  const selected=await readDbnomicsSource(sourceFile);
  const columnTypes=Object.fromEntries(Object.entries(selected.queries).map(([name,q])=>[name,q.columnTypes]));
  let closed=false,active=null;
  const source={
    inspect(){return {sourceName:'DBnomics',queries:selected.queries,columnTypes};},
    async exportDataset(name,input={},supplied={}){
      need(!closed&&!active,'The selected source is closed or already extracting.','DBNOMICS_SOURCE_BUSY',409);
      const declared=selected.queries[name];need(declared,'Choose a saved source query.','QUERY_NOT_FOUND',404);
      need(isRecord(input)&&Object.keys(input).length===0,'The saved exact query carries its full reviewed selection.');
      const {onRow,signal,...limits}=supplied;need(typeof onRow==='function','The original publisher must own row delivery.');
      const options=datasetExtractionOptions(declared,limits),op={cancelled:false,promise:null};
      const start=Date.now();active=op;
      const ensure=()=>{need(!op.cancelled&&!signal?.aborted,'Source extraction was cancelled.','DBNOMICS_EXTRACTION_CANCELLED');
        need(Date.now()-start<=options.timeoutMs,'The selected extraction exceeded its timeout.','DBNOMICS_EXTRACTION_TIMEOUT');};
      op.promise=(async()=>{
        ensure();const current=await readDbnomicsSource(sourceFile,{captureId:declared.captureId});
        need(current.hash===selected.hash,'The retained source changed before extraction.','DBNOMICS_SOURCE_CHANGED',409);
        const retained=current.retained,query=normalizeSourceQuery(selected.config.queries[name],retained.model);
        const rows=selectedObservationRows(retained.model,query);
        need(rows.length<=options.maxRows,'Increase the reviewed row limit or narrow this source selection.','DBNOMICS_EXTRACTION_ROW_LIMIT');
        rows.sort((a,b)=>{for(const order of options.order){const left=a.row[order.column],right=b.row[order.column],cmp=left<right?-1:left>right?1:0;if(cmp)return order.direction==='asc'?cmp:-cmp;}return a.index-b.index;});
        let rowCount=0,sourceTextBytes=0;
        for(const {row} of rows){
          ensure();const size=Object.values(row).reduce((sum,value)=>sum+Buffer.byteLength(value),0);
          sourceTextBytes+=size;need(size<=options.maxRowBytes&&sourceTextBytes<=options.maxBytes,'The extraction exceeds its reviewed byte capacity.','DBNOMICS_EXTRACTION_BYTE_LIMIT');
          await onRow(row,columnTypes[name],{rowCount:rowCount+1,sourceTextBytes});ensure();rowCount++;
          if(rowCount%256===0)await yieldTurn();
        }
        return {schema:'stellar-forge.dbnomics-extraction.v1',query:name,captureId:query.captureId,captureSha256:retained.captureSha256,
          responseSha256s:retained.capture.responses.map(row=>row.receipt.sha256),sourceMode:retained.capture.sourceMode,
          selection:{seriesIds:query.seriesIds,start:query.start,end:query.end,includeMissing:query.includeMissing},analysis:query.analysis,
          review:query.review,terms:retained.capture.terms,sourceUpdates:retained.model.series.map(row=>({id:row.id,updatedAt:row.sourceUpdatedAt,indexedAt:row.indexedAt})),
          rowCount,sourceTextBytes,columns:declared.columns,columnTypes:columnTypes[name],order:options.order,
          valueEncoding:'original-json-number-lexeme',missingEncoding:'original-token-and-explicit-state',
          tieBreak:'original-response-series-period-order'};
      })();
      try{return await op.promise;}finally{if(active===op)active=null;}
    },
    async close(){closed=true;if(active){active.cancelled=true;try{await active.promise;}catch{}}}
  };
  return {source,config:selected.config};
}
export async function captureDbnomicsPlan(sourceFile,directory,input){
  only(input,['title','query','input','dataset','extraction','sourceHash','operationId']);
  need(typeof input.title==='string'&&input.title.trim()&&input.title.length<=128,'Give the reviewed plan a title.');
  const initial=await readDbnomicsSource(sourceFile),declared=initial.queries[input.query];need(declared,'Choose a saved exact source query.');
  need(input.sourceHash===initial.hash,'Reload the changed source before saving this plan.','SOURCE_REVIEW_CHANGED',409);
  const selected=await readDbnomicsSource(sourceFile,{captureId:declared.captureId});
  need(selected.hash===initial.hash,'The source declaration changed while it was read.','SOURCE_REVIEW_CHANGED',409);
  const retained=selected.retained,query=normalizeSourceQuery(selected.config.queries[input.query],retained.model);
  need(isRecord(input.input??{})&&Object.keys(input.input??{}).length===0,'The saved query contains its complete selection.');
  const extraction=datasetExtractionOptions(declared,input.extraction);
  only(input.dataset,['name','columns','filters','ranges','sorts','maxCellChars','defaultLimit','maxLimit','maxPageBytes']);
  need(isRecord(input.dataset.columns)&&Object.keys(input.dataset.columns).length>0,'Select source columns for the customer dataset.');
  const columns=Object.fromEntries(Object.entries(input.dataset.columns).map(([name,spec])=>{
    const value=typeof spec==='string'?{type:spec,nullable:false}:spec;only(value,['type','nullable']);
    return [name,{type:value.type,nullable:value.nullable??false}];
  }));
  checkDbnomicsColumnTypes(columns,queryColumns(query));
  const dataset={schema:'stellar-forge.csv-dataset.v1',file:'data.csv',name:input.dataset.name,columns,
    filters:input.dataset.filters??[],ranges:input.dataset.ranges??[],sorts:input.dataset.sorts??[],
    maxBytes:extraction.maxBytes,maxRows:extraction.maxRows,maxCellChars:input.dataset.maxCellChars??65536,
    defaultLimit:input.dataset.defaultLimit??50,maxLimit:input.dataset.maxLimit??250,maxPageBytes:input.dataset.maxPageBytes??921600};
  await createFile(join(directory,'schema.csv'),csvLine(Object.keys(columns)));await loadCsvDataset({...dataset,file:join(directory,'schema.csv')});
  await privateDirectory(join(directory,'capture'),true);
  await createFile(join(directory,'capture','capture.json'),retained.captureBytes);
  const originalResponses=[];
  for(const [index,response] of retained.capture.responses.entries()){
    const file='source-'+String(index+1).padStart(4,'0')+'.json',body=Buffer.from(response.contentBase64,'base64');
    await createFile(join(directory,'capture',file),body);
    originalResponses.push({file:'capture/'+file,sha256:hash(body),bytes:body.length,url:response.receipt.url});
  }
  await syncDirectory(join(directory,'capture'));
  const runtime={schema:SOURCE_SCHEMA,captures:{[query.captureId]:{file:'capture/capture.json',sha256:retained.captureSha256}},
    queries:{[input.query]:query}},runtimeBytes=bytes(runtime);
  await createFile(join(directory,'original-source.json'),selected.original);await createFile(join(directory,'source.json'),runtimeBytes);
  const guide=await readOriginalFile(fileURLToPath(new URL('./RECEIVING.md',import.meta.url)),128*1024);
  await createFile(join(directory,'RECEIVING.md'),guide);
  const plan={schema:'stellar-forge.dbnomics-dataset-plan.v1',title:input.title.trim(),
    ...(input.operationId===undefined?{}:{operationId:operationId(input.operationId)}),originalInputHash:identity(input),query:input.query,input:{},dataset,extraction,
    sourceGuide:{file:'RECEIVING.md',bytes:guide.length,sha256:hash(guide)},
    sourceHash:selected.hash,sourceBytes:selected.bytes,runtimeSourceHash:digest(runtimeBytes),queryHash:identity(query),sourceQuery:query,
    retainedCapture:{captureId:query.captureId,manifestSha256:retained.captureSha256,file:'capture/capture.json',originalResponses,
      sourceMode:retained.capture.sourceMode,terms:retained.capture.terms}};
  plan.digest=identity(plan);await createFile(join(directory,'plan.json'),bytes(plan));return plan;
}
export const dbnomicsPublisherDriver=Object.freeze({
  sourceName:'DBnomics',workspaceSchema:'stellar-forge.dbnomics-publisher-workspace.v1',
  statusSchema:'stellar-forge.dbnomics-publisher-status.v1',candidateSchema:'stellar-forge.dbnomics-dataset-candidate.v1',
  capturePlan:captureDbnomicsPlan,inspectSource:inspectDbnomicsSource,openSource:openDbnomicsSourceFile,
  checkColumnTypes:checkDbnomicsColumnTypes,encodeRow:encodeDbnomicsRow,
  validateExtraction:value=>value?.schema==='stellar-forge.dbnomics-extraction.v1'&&HASH.test(value.captureId??'')&&
    HASH.test(value.captureSha256??'')&&Array.isArray(value.responseSha256s)&&value.responseSha256s.every(v=>HASH.test(v))&&
    value.valueEncoding==='original-json-number-lexeme'&&value.missingEncoding==='original-token-and-explicit-state'&&
    value.tieBreak==='original-response-series-period-order'&&Number.isSafeInteger(value.rowCount)&&value.rowCount>=0&&
    Array.isArray(value.columnTypes)&&Array.isArray(value.columns)&&Array.isArray(value.order)
});
