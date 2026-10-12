// SPDX-License-Identifier: MIT
// Agent operations over the ORIGINAL customer workbook HTTP/store/worker.
// The existing AnalysisWorkspace remains the sole database and job owner.
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {initializationDirectory as directory,initializationBytes as bytes}
  from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {need} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';
import {nativeWorkbookOperations} from './native-analysis-workbooks-schema.mjs';

const WORKBOOK='stellar-forge.customer-workbook.v1';
const MAX_MANIFEST=4*1024*1024;
const NAME=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/,ID=/^[a-f0-9]{32}$/,HASH=/^[a-f0-9]{64}$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const digest=value=>createHash('sha256').update(value).digest('hex');
const name=value=>{need(typeof value==='string'&&NAME.test(value),'MCP_ANALYSIS_WORKBOOK_NAME_REQUIRED');return value;};
const id=value=>{need(typeof value==='string'&&ID.test(value),'MCP_ANALYSIS_ORIGINAL_ID_REQUIRED');return value;};
const hash=value=>{need(typeof value==='string'&&HASH.test(value),'MCP_ANALYSIS_HASH_REQUIRED');return value;};
const integer=(value,minimum=0)=>{need(Number.isSafeInteger(value)&&value>=minimum,'MCP_ANALYSIS_INTEGER_INVALID');return value;};
const page=body=>{
  if(body.before!==undefined)integer(body.before,1);
  if(body.offset!==undefined)integer(body.offset);
  if(body.limit!==undefined)need(Number.isSafeInteger(body.limit)&&body.limit>=1&&body.limit<=100,'MCP_ANALYSIS_PAGE_INVALID');
};
const query=values=>{
  const selected=Object.entries(values).filter(([,value])=>value!==undefined);
  return selected.length?'?'+new URLSearchParams(selected.map(([key,value])=>[key,String(value)])):'';
};
function boundSources(definition){
  need(object(definition)&&Array.isArray(definition.sheets)&&definition.sheets.length>=1&&definition.sheets.length<=32,
    'MCP_ANALYSIS_WORKBOOK_DEFINITION_REQUIRED');
  for(const sheet of definition.sheets){
    need(object(sheet)&&object(sheet.source)&&['query-export','report'].includes(sheet.source.kind),
      'MCP_ANALYSIS_WORKBOOK_SOURCE_REQUIRED');
    id(sheet.source.id);hash(sheet.source.sha256);
    if(sheet.source.kind==='report')integer(sheet.source.section);
    need(Array.isArray(sheet.columns)&&sheet.columns.length>=1&&sheet.columns.length<=16384,
      'MCP_ANALYSIS_WORKBOOK_COLUMNS_REQUIRED');
    // Original compose() validates every label, ordinal and cell projection;
    // repeated report labels require their original explicit source position.
    for(const column of sheet.columns){
      need(object(column)&&typeof column.source==='string','MCP_ANALYSIS_WORKBOOK_COLUMN_REQUIRED');
      if(column.source_index!==undefined)integer(column.source_index);
    }
  }
}
function publicLineage(value){
  if(!object(value))return value;
  return {...value,...(Array.isArray(value.source_versions)?{
    source_versions:value.source_versions.map(version=>{
      if(!object(version))return version;
      const {sourceDirectory,...rest}=version;return rest;
    })}:{})};
}
function publicReview(value){
  return {...value,
    ...(value.current_lineage?{current_lineage:publicLineage(value.current_lineage)}:{}),
    ...(Array.isArray(value.items)?{items:value.items.map(item=>({...item,
      ...(item.lineage?{lineage:publicLineage(item.lineage)}:{})}))}:{}),
    ...(Array.isArray(value.sheets)?{sheets:value.sheets.map(sheet=>({...sheet,
      ...(sheet.lineage_before?{lineage_before:publicLineage(sheet.lineage_before)}:{}),
      ...(sheet.lineage_after?{lineage_after:publicLineage(sheet.lineage_after)}:{})}))}:{})};
}
function publicJob(job){
  if(!object(job.result))return job;
  const {directory,path,...result}=job.result;return {...job,result};
}

/** Share the native helper's file verifier/cache and lossless JSON parser. */
export function createNativeWorkbookActions({reads,parse}={}){
  need(typeof reads==='function'&&typeof parse==='function','MCP_ANALYSIS_NATIVE_FILE_READER_REQUIRED');
  const manifests=new Map();
  const handles=operation=>Object.hasOwn(nativeWorkbookOperations,operation);

  async function workbookFile(record,get,body){
    const identifier=id(body.id),job=await get('/api/jobs/'+identifier);
    need(job.id===identifier&&job.kind==='workbook'&&job.status==='COMPLETE'&&object(job.result),
      'MCP_ANALYSIS_COMPLETE_WORKBOOK_REQUIRED');
    const native=job.result,expected=join(record.database,'analysis-workbooks',identifier);
    // The original result retains its producer directory after a customer copy.
    // Only this host-selected database plus the validated job ID selects files.
    need(native.schema===WORKBOOK&&native.id===identifier&&typeof native.directory==='string'&&
      native.name===job.request?.name&&native.revision===job.request?.revision&&
      native.definition_sha256===job.request?.definition_sha256,
      'MCP_ANALYSIS_WORKBOOK_BELONGS_TO_OTHER_BUILD');
    need(hash(body.manifest_sha256)===hash(native.manifest_sha256),
      'MCP_ANALYSIS_WORKBOOK_MANIFEST_CHANGED');
    need(['workbook.xlsx','handoff.zip','manifest.json'].includes(body.filename)&&Array.isArray(native.files),
      'MCP_ANALYSIS_WORKBOOK_FILE_INVALID');
    const select=filename=>{
      const matching=native.files.filter(file=>file?.name===filename);
      need(matching.length===1&&object(matching[0]),'MCP_ANALYSIS_WORKBOOK_FILE_INVALID');
      const file=matching[0];hash(file.sha256);integer(file.bytes);
      return file;
    };
    const manifestRecord=select('manifest.json'),file=select(body.filename);
    need(manifestRecord.sha256===native.manifest_sha256&&manifestRecord.bytes<=MAX_MANIFEST,
      'MCP_ANALYSIS_WORKBOOK_MANIFEST_CHANGED');
    need(hash(body.sha256)===file.sha256,'MCP_ANALYSIS_FILE_IDENTITY_CHANGED');
    await directory(join(record.database,'analysis-workbooks'));await directory(expected);
    const manifestPath=join(expected,'manifest.json');
    // Verify the current original file stamp on every operation. The shared
    // reader hashes a changed descriptor once, then reads only the chosen range.
    await reads({destination:manifestPath,bytes:manifestRecord.bytes,sha256:manifestRecord.sha256,
      contentType:manifestRecord.mime},{maxBytes:1});
    const cacheKey=manifestPath+':'+manifestRecord.sha256;
    let manifest=manifests.get(cacheKey);
    if(!manifest){
      const raw=await bytes(manifestPath,MAX_MANIFEST);
      need(raw.length===manifestRecord.bytes&&digest(raw)===manifestRecord.sha256,
        'MCP_ANALYSIS_WORKBOOK_MANIFEST_CHANGED');
      manifest=parse(raw);manifests.set(cacheKey,manifest);
      while(manifests.size>8)manifests.delete(manifests.keys().next().value);
    }
    need(manifest.schema===WORKBOOK&&manifest.complete===true&&manifest.id===identifier&&
      manifest.workspace_id===record.workspaceId&&manifest.definition_sha256===native.definition_sha256&&
      manifest.name===native.name&&manifest.revision===native.revision&&object(manifest.files),
      'MCP_ANALYSIS_WORKBOOK_MANIFEST_CHANGED');
    if(body.filename==='workbook.xlsx'){
      const original=manifest.files['workbook.xlsx'];
      need(original?.sha256===file.sha256&&original.bytes===file.bytes,
        'MCP_ANALYSIS_WORKBOOK_MANIFEST_CHANGED');
    }
    // The ZIP hash is in the original completed build record. It cannot be in
    // its own member manifest. The original engine produced/verified that ZIP.
    return {id:identifier,name:native.name,revision:native.revision,
      definitionSha256:native.definition_sha256,manifestSha256:native.manifest_sha256,
      filename:body.filename,
      file:await reads({destination:join(expected,body.filename),bytes:file.bytes,
        sha256:file.sha256,contentType:file.mime},body)};
  }

  async function call({operation,body,record,state,get,post}){
    need(handles(operation)&&object(body)&&object(record)&&object(state)&&
      typeof get==='function'&&typeof post==='function','MCP_ANALYSIS_WORKBOOK_CONTEXT_REQUIRED');
    if(operation==='workbooks'){
      page(body);const offset=body.offset??0,limit=body.limit??25;
      need(Array.isArray(state.workbooks),'MCP_ANALYSIS_ORIGINAL_WORKBOOK_APPLICATION_REQUIRED');
      need(offset<=state.workbooks.length,'MCP_ANALYSIS_PAGE_INVALID');
      return {items:state.workbooks.slice(offset,offset+limit),total:state.workbooks.length,
        nextOffset:offset+limit<state.workbooks.length?offset+limit:null};
    }
    if(operation==='workbook-sources'){
      page(body);return get('/api/workbook-sources'+query(body));
    }
    if(operation==='workbook-definition'){
      name(body.name);if(body.revision!==undefined)integer(body.revision,1);
      return get('/api/workbooks/'+body.name+query({revision:body.revision}));
    }
    if(operation==='save-workbook'){
      name(body.name);id(body.id);integer(body.expected_revision);boundSources(body);
      const {name:ignored,...request}=body;
      return post('/api/workbooks/'+body.name,request);
    }
    if(operation==='workbook-preview'){
      name(body.name);integer(body.revision,1);hash(body.definition_sha256);page(body);
      if(body.sheet!==undefined)integer(body.sheet);
      const result=await get('/api/workbooks/'+body.name+'/preview'+query({
        revision:body.revision,sheet:body.sheet,limit:body.limit}));
      need(result.definition_sha256===body.definition_sha256,'MCP_ANALYSIS_WORKBOOK_REVIEW_CHANGED');
      return result;
    }
    if(operation==='workbook'){
      id(body.id);name(body.name);integer(body.revision,1);hash(body.definition_sha256);
      return publicJob(await post('/api/start/workbook',body));
    }
    if(operation==='workbook-runs'){
      page(body);return get('/api/workbook-runs'+query(body));
    }
    if(operation==='cancel-workbook'){
      const identifier=id(body.id),job=await get('/api/jobs/'+identifier);
      need(job.id===identifier&&job.kind==='workbook','MCP_ANALYSIS_ORIGINAL_WORKBOOK_JOB_REQUIRED');
      return {id:identifier,progress:await post('/api/workbook-runs/'+identifier+'/cancel',{})};
    }
    if(operation==='workbook-file')return workbookFile(record,get,body);
    if(operation==='workbook-candidates'){
      name(body.name);integer(body.revision,1);hash(body.definition_sha256);page(body);
      if(body.sheet!==undefined)integer(body.sheet);
      const result=await get('/api/workbooks/'+body.name+'/refresh'+query({
        revision:body.revision,sheet:body.sheet,before:body.before,limit:body.limit}));
      need(result.definition_sha256===body.definition_sha256&&result.name===body.name&&
        result.revision===body.revision,'MCP_ANALYSIS_WORKBOOK_REVIEW_CHANGED');
      return publicReview(result);
    }
    name(body.name);integer(body.base_revision,1);integer(body.expected_revision,1);
    hash(body.definition_sha256);boundSources(body.definition);
    need(body.definition.name===body.name,'MCP_ANALYSIS_WORKBOOK_NAME_CHANGED');
    const {name:ignored,...request}=body;
    if(operation==='workbook-refresh-review'){
      return publicReview(await post('/api/workbooks/'+body.name+'/refresh-review',request));
    }
    id(body.id);hash(body.review_sha256);
    return post('/api/workbooks/'+body.name+'/refresh',request);
  }
  return {handles,call,close(){manifests.clear();}};
}
