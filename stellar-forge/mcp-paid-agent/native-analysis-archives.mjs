// SPDX-License-Identifier: MIT
// Portable archives over the ORIGINAL AnalysisWorkspace job/export service.
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {initializationDirectory as directory,initializationBytes as bytes}
  from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {need} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';
import {nativeArchiveOperations} from './native-analysis-archives-schema.mjs';

const EXPORT='stellar-forge.analysis-workspace-export.v1';
const MANIFEST='stellar-forge.analysis-workspace-archive.v1';
const HISTORY='stellar-forge.analysis-workspace-export-history.v1';
const PLAN='stellar-forge.analysis-workspace-export-plan.v1';
const ID=/^[a-f0-9]{32}$/,HASH=/^[a-f0-9]{64}$/;
const MAX_MANIFEST=64*1024*1024;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
const id=value=>{need(typeof value==='string'&&ID.test(value),'MCP_ANALYSIS_ORIGINAL_ID_REQUIRED');return value;};
const hash=value=>{need(typeof value==='string'&&HASH.test(value),'MCP_ANALYSIS_HASH_REQUIRED');return value;};
const integer=(value,minimum=0)=>{need(Number.isSafeInteger(value)&&value>=minimum,'MCP_ANALYSIS_INTEGER_INVALID');return value;};
const query=values=>{
  const selected=Object.entries(values).filter(([,value])=>value!==undefined);
  return selected.length?'?'+new URLSearchParams(selected.map(([key,value])=>[key,String(value)])):'';
};
function page(body){
  if(body.before!==undefined)integer(body.before,1);
  if(body.offset!==undefined)integer(body.offset);
  if(body.limit!==undefined)need(Number.isSafeInteger(body.limit)&&body.limit>=1&&body.limit<=100,'MCP_ANALYSIS_PAGE_INVALID');
}
function include(body){
  need(body.include_previous_backups===undefined||typeof body.include_previous_backups==='boolean',
    'MCP_ANALYSIS_ARCHIVE_BACKUP_SELECTION_INVALID');
  return body.include_previous_backups??false;
}
function publicJob(job){
  if(!object(job.result))return job;
  const {directory,path,...result}=job.result;return {...job,result};
}
function output(value){
  if(!object(value))return value;
  const {producer_directory,source_directory,directory,path,...rest}=value;return rest;
}
function publicPlan(value,body,record){
  need(value?.schema===PLAN&&value.workspace_id===record.workspaceId&&
    typeof value.ready==='boolean','MCP_ANALYSIS_ARCHIVE_REVIEW_CHANGED');
  const result={...value},pages={},offset=body.offset??0,limit=body.limit??25;
  for(const key of ['outputs','exclusions','missing']){
    need(Array.isArray(value[key]),'MCP_ANALYSIS_ARCHIVE_REVIEW_CHANGED');
    const all=value[key];result[key]=all.slice(offset,offset+limit).map(item=>key==='outputs'?output(item):item);
    pages[key]={total:all.length,nextOffset:offset+limit<all.length?offset+limit:null};
  }
  return {...result,pages};
}

/** Reuse the original native SavedFileReader cache and lossless JSON parser. */
export function createNativeArchiveActions({reads,parse}={}){
  need(typeof reads==='function'&&typeof parse==='function','MCP_ANALYSIS_NATIVE_FILE_READER_REQUIRED');
  const manifests=new Map(),handles=operation=>Object.hasOwn(nativeArchiveOperations,operation);
  async function archiveFile(record,get,body){
    const identifier=id(body.id),job=await get('/api/jobs/'+identifier);
    need(job.id===identifier&&job.kind==='workspace-export'&&job.status==='COMPLETE'&&object(job.result),
      'MCP_ANALYSIS_COMPLETE_WORKSPACE_ARCHIVE_REQUIRED');
    const result=job.result;
    need(result.schema===EXPORT&&result.id===identifier&&result.workspace_id===record.workspaceId,
      'MCP_ANALYSIS_ARCHIVE_BELONGS_TO_OTHER_WORKSPACE');
    need(Array.isArray(result.files)&&result.files.length===2&&
      new Set(result.files.map(file=>file?.name)).size===2,'MCP_ANALYSIS_ARCHIVE_FILES_CHANGED');
    const select=filename=>{
      const file=result.files.find(item=>item?.name===filename);
      need(object(file),'MCP_ANALYSIS_ARCHIVE_FILE_INVALID');
      hash(file.sha256);integer(file.bytes,1);
      need(file.mime===(filename==='workspace.zip'?'application/zip':'application/json'),
        'MCP_ANALYSIS_ARCHIVE_FILE_INVALID');
      return file;
    };
    const manifestFile=select('archive-manifest.json');select('workspace.zip');
    need(['workspace.zip','archive-manifest.json'].includes(body.filename),'MCP_ANALYSIS_ARCHIVE_FILE_INVALID');
    const selected=select(body.filename);
    need(hash(body.manifest_sha256)===manifestFile.sha256&&manifestFile.bytes<=MAX_MANIFEST,
      'MCP_ANALYSIS_ARCHIVE_MANIFEST_CHANGED');
    need(hash(body.sha256)===selected.sha256,'MCP_ANALYSIS_FILE_IDENTITY_CHANGED');
    const root=join(record.database,'analysis-workspace-archives'),folder=join(root,identifier);
    await directory(root);await directory(folder);
    const path=join(folder,'archive-manifest.json');
    // Check the current file descriptor every call. Hashing is shared/cached;
    // large subsequent ranges read only their requested bytes.
    await reads({destination:path,bytes:manifestFile.bytes,sha256:manifestFile.sha256,
      contentType:manifestFile.mime},{maxBytes:1});
    const key=path+':'+manifestFile.sha256;let manifest=manifests.get(key);
    if(!manifest){
      const raw=await bytes(path,MAX_MANIFEST);
      need(raw.length===manifestFile.bytes&&sha(raw)===manifestFile.sha256,'MCP_ANALYSIS_ARCHIVE_MANIFEST_CHANGED');
      manifest=parse(raw);
      need(manifest?.schema===MANIFEST&&manifest.id===identifier&&manifest.workspace_id===record.workspaceId&&
        Array.isArray(manifest.files)&&manifest.files.length>=1&&object(manifest.database)&&
        manifest.database.path==='datasets.sqlite3','MCP_ANALYSIS_ARCHIVE_MANIFEST_CHANGED');
      const originals=manifest.files.filter(file=>file?.path==='datasets.sqlite3');
      need(originals.length===1&&originals[0].bytes===manifest.database.bytes&&
        originals[0].sha256===manifest.database.sha256,'MCP_ANALYSIS_ARCHIVE_DATABASE_CHANGED');
      hash(manifest.database.sha256);integer(manifest.database.bytes,1);
      // Retain only the verified identity, not millions of original file rows.
      manifest={id:manifest.id,workspace_id:manifest.workspace_id};
      manifests.set(key,manifest);
      while(manifests.size>8)manifests.delete(manifests.keys().next().value);
    }
    need(manifest.id===identifier&&manifest.workspace_id===record.workspaceId,'MCP_ANALYSIS_ARCHIVE_MANIFEST_CHANGED');
    return {id:identifier,workspaceId:record.workspaceId,manifestSha256:manifestFile.sha256,filename:body.filename,
      file:await reads({destination:join(folder,body.filename),bytes:selected.bytes,
        sha256:selected.sha256,contentType:selected.mime},body)};
  }
  async function call({operation,body,record,state,get,post}){
    need(handles(operation)&&object(body)&&object(record)&&object(state)&&
      typeof get==='function'&&typeof post==='function','MCP_ANALYSIS_ARCHIVE_CONTEXT_REQUIRED');
    if(operation==='workspace-archive-review'){
      page(body);return publicPlan(await get('/api/workspace-archive-review'+query({
        include_previous_backups:include(body)})),body,record);
    }
    if(operation==='workspace-export'){
      id(body.id);include(body);return publicJob(await post('/api/start/workspace-export',body));
    }
    if(operation==='workspace-archives'){
      page(body);const value=await get('/api/workspace-archives'+query(body));
      need(value?.schema===HISTORY&&Array.isArray(value.items),'MCP_ANALYSIS_ARCHIVE_HISTORY_CHANGED');
      if(value.next_before!==null)integer(value.next_before,1);
      for(const job of value.items)need(object(job)&&ID.test(job.id??'')&&job.kind==='workspace-export',
        'MCP_ANALYSIS_ARCHIVE_HISTORY_CHANGED');
      return {...value,items:value.items.map(publicJob)};
    }
    if(operation==='cancel-workspace-export'){
      const identifier=id(body.id),job=await get('/api/jobs/'+identifier);
      need(job.id===identifier&&job.kind==='workspace-export','MCP_ANALYSIS_ORIGINAL_ARCHIVE_JOB_REQUIRED');
      return post('/api/workspace-archives/'+identifier+'/cancel',{});
    }
    return archiveFile(record,get,body);
  }
  return {handles,call,close(){manifests.clear();}};
}
