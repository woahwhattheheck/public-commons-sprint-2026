// MIT. Reviewed RisingWave plans for the original complete dataset publisher.
import { join } from 'node:path';
import { loadCsvDataset } from '../../dataset-handler.mjs';
import { readPrivate,bytes,digest,identity,createFile,fault } from '../../postgres/publisher/files.mjs';
import { validateRisingWaveSource } from '../config.mjs';
import { compileRisingWaveQueries,describeRisingWaveQueries,bindRisingWaveParameters } from '../declaration.mjs';
import { risingWaveDatasetExtractionOptions } from '../capture.mjs';
import { fail,exact,object,canonicalCsvLine } from '../common.mjs';
import { compareDecimal,integerText } from '../scalars.mjs';
function parse(original){
  let config;try{config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original));}catch{throw fail('RISINGWAVE_SOURCE_JSON_INVALID');}
  validateRisingWaveSource(config);return {config,queries:compileRisingWaveQueries(config.queries)};
}
export async function inspectRisingWavePublicationSource(path){
  const original=await readPrivate(path,1048576),{config,queries}=parse(original);
  return {hash:digest(original),bytes:original.length,connectionStringEnv:config.connectionStringEnv,
    authentication:'pgwire-environment',queries:describeRisingWaveQueries(queries),
    extraction:{order:'native-subscription',modes:['auto','full','changes'],onGap:['error','rebuild'],
      defaults:risingWaveDatasetExtractionOptions(null,{})}};
}
export function risingWavePublicationTemplate(source,queryName){
  const query=source.queries[queryName];if(!query)throw fail('QUERY_NOT_FOUND');
  return {title:queryName+' complete edition',query:queryName,input:structuredClone(query.probe??{}),sourceHash:source.hash,
    dataset:{name:queryName,columns:Object.fromEntries(Object.entries(query.columns).map(([alias,spec])=>[alias,
      {type:['integer','number','boolean'].includes(spec.type)?spec.type:'string',nullable:spec.nullable??false}])),
      filters:[],ranges:[],sorts:[],defaultLimit:50,maxLimit:250},
    extraction:structuredClone(source.extraction.defaults)};
}
export async function captureRisingWavePublicationPlan(sourceFile,directory,input){
  exact(input,['title','query','input','dataset','extraction','sourceHash'],'INVALID_PUBLICATION_PLAN');
  if(typeof input.title!=='string'||!input.title.trim()||input.title.length>128)throw fail('PLAN_TITLE_REQUIRED');
  const original=await readPrivate(sourceFile,1048576);
  if(digest(original)!==input.sourceHash)throw fault('SOURCE_REVIEW_CHANGED','Reload the source before saving this plan.',409);
  const {config,queries}=parse(original),query=queries[input.query];if(!query)throw fail('QUERY_NOT_FOUND');
  const normalized=bindRisingWaveParameters(query,input.input??{}),extraction=risingWaveDatasetExtractionOptions(query,input.extraction??{});
  exact(input.dataset,['name','columns','filters','ranges','sorts','maxCellChars','defaultLimit','maxLimit','maxPageBytes'],'INVALID_DATASET_PLAN');
  if(!object(input.dataset.columns)||!Object.keys(input.dataset.columns).length||Object.keys(input.dataset.columns).some(name=>!Object.hasOwn(query.columns,name)))
    throw fail('DATASET_COLUMN_NOT_IN_QUERY');
  const columns=Object.fromEntries(Object.entries(input.dataset.columns).map(([name,supplied])=>{
    const value=typeof supplied==='string'?{type:supplied,nullable:false}:supplied;
    exact(value,['type','nullable'],'INVALID_DATASET_COLUMN');
    if(!['string','integer','number','boolean'].includes(value.type)||value.nullable!==undefined&&typeof value.nullable!=='boolean')
      throw fail('INVALID_DATASET_COLUMN');
    return [name,{type:value.type,nullable:value.nullable??false}];
  }));
  const dataset={schema:'stellar-forge.csv-dataset.v1',file:'data.csv',name:input.dataset.name,columns,nullEncoding:'unquoted-empty',
    filters:input.dataset.filters??[],ranges:input.dataset.ranges??[],sorts:input.dataset.sorts??[],
    maxBytes:extraction.maxBytes,maxRows:extraction.maxRows,maxCellChars:input.dataset.maxCellChars??65536,
    defaultLimit:input.dataset.defaultLimit??50,maxLimit:input.dataset.maxLimit??250,maxPageBytes:input.dataset.maxPageBytes??921600};
  await createFile(join(directory,'schema.csv'),canonicalCsvLine(Object.keys(columns)));
  await loadCsvDataset({...dataset,file:join(directory,'schema.csv')});
  await createFile(join(directory,'original-source.json'),original);
  const runtime=bytes(config);await createFile(join(directory,'source.json'),runtime);
  const sourceQuery=describeRisingWaveQueries({query}).query;
  const plan={schema:'stellar-forge.risingwave-dataset-plan.v1',title:input.title.trim(),query:input.query,
    input:normalized,dataset,extraction,sourceHash:digest(original),sourceBytes:original.length,
    caHash:null,runtimeSourceHash:digest(runtime),queryHash:identity(sourceQuery),sourceQuery};
  plan.digest=identity(plan);await createFile(join(directory,'plan.json'),bytes(plan));return plan;
}
export function checkRisingWaveDatasetColumnTypes(columns,types){
  if(!Array.isArray(types)||new Set(types.map(type=>type.name)).size!==types.length)throw fail('DATASET_COLUMN_TYPE_MISMATCH');
  const byName=new Map(types.map(type=>[type.name,type]));
  for(const [name,spec]of Object.entries(columns)){
    const source=byName.get(name);
    if(!source||!object(source.counts)||!['string','integer','number','boolean'].includes(spec.type)||
        spec.type==='boolean'&&source.type!=='boolean'||
        ['integer','number'].includes(spec.type)&&!['integer','number','bigint','decimal'].includes(source.type))
      throw fail('DATASET_COLUMN_TYPE_MISMATCH');
    if(!spec.nullable&&source.counts.null)throw fail('DATASET_NULL_NOT_ALLOWED');
  }
}
export function encodeRisingWaveDatasetRow(row,dataset){
  return canonicalCsvLine(Object.entries(dataset.columns).map(([name,spec])=>{
    if(!Object.hasOwn(row,name))throw fail('DATASET_SOURCE_FIELD_MISSING');
    const value=row[name];if(value===null){if(!spec.nullable)throw fail('DATASET_NULL_NOT_ALLOWED');return null;}
    let text;
    if(spec.type==='string'){
      if(!['string','boolean','number'].includes(typeof value))throw fail('DATASET_SOURCE_ENCODING_INVALID');
      if(typeof value==='number'&&!Number.isFinite(value))throw fail('DATASET_NUMBER_NOT_FINITE');
      text=String(value);
    }else if(spec.type==='boolean'){
      if(typeof value!=='boolean')throw fail('DATASET_BOOLEAN_INVALID');text=String(value);
    }else{
      if(!['number','string'].includes(typeof value))throw fail('DATASET_NUMBER_INVALID');
      const number=Number(value);if(!Number.isFinite(number))throw fail('DATASET_NUMBER_NOT_FINITE');
      if(spec.type==='integer'){
        let integral;try{integral=integerText(value);}catch{throw fail('DATASET_INTEGER_INVALID');}
        if(!Number.isSafeInteger(number)||compareDecimal(String(number),integral)!==0)throw fail('DATASET_INTEGER_REQUIRES_EXACT_STRING');
      }else if(Number.isInteger(number)&&!Number.isSafeInteger(number))throw fail('DATASET_NUMBER_REQUIRES_EXACT_STRING');
      text=Object.is(number,-0)?'-0':String(number);
      if(compareDecimal(text,String(value))!==0)throw fail('DATASET_NUMBER_REQUIRES_EXACT_STRING');
    }
    if(text.length>dataset.maxCellChars)throw fail('DATASET_CELL_TOO_LARGE');
    return text;
  }));
}
export function validateRisingWaveExtraction(value){
  const capture=value?.capture,hash=/^[a-f0-9]{64}$/;
  if(value?.schema!=='stellar-forge.risingwave-dataset-extraction.v1'||value.complete!==true||value.readOnly!==true||
      value.snapshot!=='native-subscription-complete-boundary'||value.nullEncoding!=='unquoted-empty'||
      !Number.isSafeInteger(value.rowCount)||value.rowCount<0||!Array.isArray(value.columns)||!Array.isArray(value.columnTypes)||
      value.columns.length!==value.columnTypes.length||capture?.schema!=='stellar-forge.risingwave-capture.v1'||
      capture.complete!==true||capture.rowCount!==value.rowCount||!hash.test(capture.manifestSha256)||
      !hash.test(capture.orderedRowsSha256)||capture.checkpoint?.complete!==true||
      capture.checkpoint.pendingDeltas!==0||capture.barrier?.state?.kind!=='InitLogStoreQuery')return false;
  for(const key of ['json','ndjson','csv','events','checkpoint','state','manifest']){
    const file=capture.files?.[key];if(!object(file)||!hash.test(file.sha256)||!Number.isSafeInteger(file.bytes)||file.bytes<0)return false;
  }
  return value.columnTypes.every((type,index)=>type.name===value.columns[index]&&typeof type.type==='string'&&object(type.counts)&&
    Number.isSafeInteger(type.counts.null)&&type.counts.null>=0&&Number.isSafeInteger(type.counts.value)&&type.counts.value>=0&&
    type.counts.null+type.counts.value===value.rowCount);
}
