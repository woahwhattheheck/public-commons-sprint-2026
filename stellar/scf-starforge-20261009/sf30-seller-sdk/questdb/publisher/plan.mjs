// MIT. Original durable publication plans with native QuestDB capture completeness.
import { join } from 'node:path';
import { loadCsvDataset } from '../../dataset-handler.mjs';
import { csvLine } from '../../postgres/publisher/plan.mjs';
import { readPrivate, bytes, digest, identity, createFile, fault } from '../../postgres/publisher/files.mjs';
import { validateQuestDbSource } from '../config.mjs';
import { compileQuestDbQueries, describeQuestDbQueries, bindQuestDbParameters } from '../declaration.mjs';
import { questDbDatasetExtractionOptions } from '../source.mjs';
import { fail, exact, object, compareDecimal, integralDecimal } from '../common.mjs';

function parse(original){
  let config;try{config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original));}catch{throw fail('QUESTDB_SOURCE_JSON_INVALID');}
  validateQuestDbSource(config);return{config,queries:compileQuestDbQueries(config.queries)};
}
export async function inspectQuestDbPublicationSource(path){
  const original=await readPrivate(path,1048576),{config,queries}=parse(original);
  return{hash:digest(original),bytes:original.length,endpointEnv:config.endpointEnv,
    authentication:config.tokenEnv?'bearer':config.userEnv?'basic':'none',queries:describeQuestDbQueries(queries)};
}
export async function captureQuestDbPublicationPlan(sourceFile,directory,input){
  exact(input,['title','query','input','dataset','extraction','sourceHash'],'INVALID_PUBLICATION_PLAN');
  if(typeof input.title!=='string'||!input.title.trim()||input.title.length>128)throw fail('PLAN_TITLE_REQUIRED');
  const original=await readPrivate(sourceFile,1048576);
  if(digest(original)!==input.sourceHash)throw fault('SOURCE_REVIEW_CHANGED','Reload the source before saving this plan.',409);
  const{config,queries}=parse(original),query=queries[input.query];
  if(!query)throw fail('QUERY_NOT_FOUND');
  bindQuestDbParameters(query,input.input??{});
  const extraction=questDbDatasetExtractionOptions(query,input.extraction??{});
  exact(input.dataset,['name','columns','filters','ranges','sorts','maxCellChars','defaultLimit','maxLimit','maxPageBytes'],'INVALID_DATASET_PLAN');
  if(!object(input.dataset.columns)||!Object.keys(input.dataset.columns).length||
      Object.keys(input.dataset.columns).some(name=>!query.columns.includes(name)))throw fail('DATASET_COLUMN_NOT_IN_QUERY');
  const columns=Object.fromEntries(Object.entries(input.dataset.columns).map(([name,supplied])=>{
    const value=typeof supplied==='string'?{type:supplied,nullable:false}:supplied;
    exact(value,['type','nullable'],'INVALID_DATASET_COLUMN');
    if(!['string','integer','number','boolean'].includes(value.type)||value.nullable!==undefined&&typeof value.nullable!=='boolean')throw fail('INVALID_DATASET_COLUMN');
    return[name,{type:value.type,nullable:value.nullable??false}];
  }));
  const dataset={schema:'stellar-forge.csv-dataset.v1',file:'data.csv',name:input.dataset.name,columns,
    filters:input.dataset.filters??[],ranges:input.dataset.ranges??[],sorts:input.dataset.sorts??[],
    maxBytes:extraction.maxBytes,maxRows:extraction.maxRows,maxCellChars:input.dataset.maxCellChars??65536,
    defaultLimit:input.dataset.defaultLimit??50,maxLimit:input.dataset.maxLimit??250,maxPageBytes:input.dataset.maxPageBytes??921600};
  await createFile(join(directory,'schema.csv'),csvLine(Object.keys(columns)));
  await loadCsvDataset({...dataset,file:join(directory,'schema.csv')});
  await createFile(join(directory,'original-source.json'),original);
  const runtime=bytes(config);await createFile(join(directory,'source.json'),runtime);
  const sourceQuery=describeQuestDbQueries({query}).query;
  const plan={schema:'stellar-forge.questdb-dataset-plan.v1',title:input.title.trim(),query:input.query,
    input:structuredClone(input.input??{}),dataset,extraction,sourceHash:digest(original),sourceBytes:original.length,
    caHash:null,runtimeSourceHash:digest(runtime),queryHash:identity(sourceQuery),sourceQuery};
  plan.digest=identity(plan);await createFile(join(directory,'plan.json'),bytes(plan));return plan;
}
const numeric=type=>/^(?:BYTE|SHORT|INT|LONG|FLOAT|DOUBLE|DECIMAL(?:\b|\())/.test(type.toUpperCase());
export function checkQuestDbDatasetColumnTypes(columns,types){
  if(!Array.isArray(types)||new Set(types.map(type=>type.name)).size!==types.length)throw fail('DATASET_COLUMN_TYPE_MISMATCH');
  const byName=new Map(types.map(type=>[type.name,type]));
  for(const[name,spec]of Object.entries(columns)){
    const source=byName.get(name);
    if(!source||typeof source.type!=='string'||!object(source.counts)||!['string','integer','number','boolean'].includes(spec.type)||
        spec.type==='boolean'&&!['BOOLEAN','NULL'].includes(source.type.toUpperCase())||
        ['integer','number'].includes(spec.type)&&source.type.toUpperCase()!=='NULL'&&!numeric(source.type))throw fail('DATASET_COLUMN_TYPE_MISMATCH');
    if(!spec.nullable&&source.counts.null)throw fail('DATASET_NULL_NOT_ALLOWED');
  }
}
export function encodeQuestDbDatasetRow(row,dataset){
  return csvLine(Object.entries(dataset.columns).map(([name,spec])=>{
    if(!Object.hasOwn(row,name))throw fail('DATASET_SOURCE_FIELD_MISSING');
    const value=row[name];if(value===null){if(!spec.nullable)throw fail('DATASET_NULL_NOT_ALLOWED');return'';}
    let text;
    if(spec.type==='string'){
      if(!['string','boolean'].includes(typeof value))throw fail('DATASET_SOURCE_ENCODING_INVALID');text=String(value);
    }else if(spec.type==='boolean'){
      if(typeof value!=='boolean')throw fail('DATASET_BOOLEAN_INVALID');text=String(value);
    }else{
      if(typeof value!=='string')throw fail('DATASET_NUMBER_TEXT_REQUIRED');
      let integral;try{integral=integralDecimal(value);}catch{throw fail('DATASET_NUMBER_INVALID');}
      const number=Number(value);
      if(!Number.isFinite(number))throw fail('DATASET_NUMBER_NOT_FINITE');
      if(spec.type==='integer'&&(!integral||!Number.isSafeInteger(number)))throw fail('DATASET_INTEGER_REQUIRES_EXACT_STRING');
      if(integral&&!Number.isSafeInteger(number))throw fail('DATASET_NUMBER_REQUIRES_EXACT_STRING');
      text=Object.is(number,-0)?'-0':String(number);
      if(compareDecimal(text,value)!==0)throw fail('DATASET_NUMBER_REQUIRES_EXACT_STRING');
    }
    if(text.length>dataset.maxCellChars)throw fail('DATASET_CELL_TOO_LARGE');
    if(text===''&&spec.nullable)throw fail('DATASET_EMPTY_NULL_CONFLICT',
      'The paid CSV loader uses empty nullable cells for NULL. Keep this field non-nullable when appropriate, or review an explicit SQL projection; the native capture preserves both values.');
    return text;
  }));
}
export function validateQuestDbExtraction(value){
  const capture=value?.capture,request=value?.request,hash=/^[a-f0-9]{64}$/;
  if(value?.schema!=='stellar-forge.questdb-dataset-extraction.v1'||value.complete!==true||value.readOnly!==true||
      !Number.isSafeInteger(value.rowCount)||value.rowCount<0||value.valueEncoding!=='questdb-json-source-text'||
      value.snapshot!=='single-native-http-response'||capture?.schema!=='stellar-forge.questdb-capture.v1'||
      capture.complete!==true||capture.rowCount!==value.rowCount||capture.reportedCount!==String(value.rowCount)||
      !hash.test(capture.manifestSha256)||!hash.test(capture.orderedRowsSha256)||!object(capture.files)||
      request?.complete!==true||request.httpStatus!==200||request.countRequested!==true||
      !Array.isArray(value.columns)||!Array.isArray(value.columnTypes)||value.columns.length!==value.columnTypes.length)return false;
  for(const key of ['json','ndjson','csv','manifest']){
    const file=capture.files[key];if(!object(file)||!hash.test(file.sha256)||!Number.isSafeInteger(file.bytes)||file.bytes<0)return false;
  }
  return value.columnTypes.every((type,index)=>type.name===value.columns[index]&&typeof type.type==='string'&&object(type.counts)&&
    Number.isSafeInteger(type.counts.null)&&type.counts.null>=0&&Number.isSafeInteger(type.counts.value)&&type.counts.value>=0&&
    type.counts.null+type.counts.value===value.rowCount);
}
