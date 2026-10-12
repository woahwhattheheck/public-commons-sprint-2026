// SPDX-License-Identifier: MIT
// Native MCP customer use of the ORIGINAL, separately owned AnalysisWorkspace HTTP service.
import {createHash} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {initializationDirectory as directory, initializationBytes as bytes,
  optionalInitializationBytes as optionalBytes, retainInitializationRecord as retainRecord}
  from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {need,InputError} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';
import {createSavedFileReader} from './native-file.mjs';
import {createNativeWorkbookActions} from './native-analysis-workbooks.mjs';
import {createNativeSourceActions} from './native-analysis-sources.mjs';
import {createNativeArchiveActions} from './native-analysis-archives.mjs';

const SCHEMA='stellar-forge.mcp-native-analysis.v1';
const CUSTOMER='stellar-forge.customer-analysis.v1';
const NAME=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ID=/^[a-f0-9]{32}$/;
const HASH=/^[a-f0-9]{64}$/;
const MAX_JSON=32*1024*1024,MAX_TOOL=256*1024,MAX_REQUEST=1024*1024;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=code=>{throw new InputError(code);};
const sha=value=>createHash('sha256').update(value).digest('hex');
const enc=value=>Buffer.from(JSON.stringify(value));
const name=value=>{need(typeof value==='string'&&NAME.test(value),'MCP_ANALYSIS_NAME_REQUIRED');return value;};
const id=value=>{need(typeof value==='string'&&ID.test(value),'MCP_ANALYSIS_ORIGINAL_ID_REQUIRED');return value;};
const hash=value=>{need(typeof value==='string'&&HASH.test(value),'MCP_ANALYSIS_HASH_REQUIRED');return value;};
const positive=(value,zero=false)=>{
  need(Number.isSafeInteger(value)&&value>=(zero?0:1),'MCP_ANALYSIS_INTEGER_INVALID');return value;
};
import {nativeAnalysisOperations,nativeAnalysisActions,nativeAnalysisSchema} from './native-analysis-schema.mjs';
export {nativeAnalysisActions,nativeAnalysisSchema};
const fields=Object.fromEntries(Object.entries(nativeAnalysisOperations).map(([name,spec])=>[name,Object.keys(spec.properties)]));

// Preserve raw integers which JSON.parse would otherwise round in discovery/source metadata.
// Ordinary SQL cells are already typed text by the original customer API.
function parse(raw) {
  let text;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{fail('MCP_ANALYSIS_RESPONSE_JSON_INVALID');}
  let out='',quoted=false,escaped=false;
  for(let i=0;i<text.length;){
    const c=text[i];
    if(quoted){out+=c;i++;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"'){quoted=true;out+=c;i++;continue;}
    if(c==='-'||c>='0'&&c<='9'){
      const match=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(i));
      if(!match)fail('MCP_ANALYSIS_RESPONSE_JSON_INVALID');
      const token=match[0];i+=token.length;
      if(/^-?[0-9]+$/.test(token)&&!Number.isSafeInteger(Number(token)))
        out+='{"encoding":"json-integer","text":'+JSON.stringify(token)+'}';
      else out+=token;
      continue;
    }
    out+=c;i++;
  }
  try{return JSON.parse(out);}catch{fail('MCP_ANALYSIS_RESPONSE_JSON_INVALID');}
}
async function json(path,maximum=65536){return parse(await bytes(path,maximum));}
function localPath(value){
  need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&value!=='/'&&!value.includes('\0'),
    'MCP_ANALYSIS_PRIVATE_PATH_REQUIRED');return value;
}
function launchURL(control){
  need(control?.schema===CUSTOMER&&ID.test(control.workspace_id??''),'MCP_ANALYSIS_LAUNCH_INVALID');
  let url;try{url=new URL(control.url);}catch{fail('MCP_ANALYSIS_LAUNCH_INVALID');}
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port&&url.pathname==='/'&&
    !url.search&&!url.username&&!url.password&&/^[A-Za-z0-9_-]{24,128}$/.test(url.hash.slice(1)),
    'MCP_ANALYSIS_LOCAL_SERVICE_REQUIRED');
  const capability=url.hash.slice(1);url.hash='';return {url,capability};
}
async function readResponse(response,maximum){
  const length=response.headers.get('content-length');
  if(length!==null)need(/^[0-9]+$/.test(length)&&Number(length)<=maximum,'MCP_ANALYSIS_RESPONSE_TOO_LARGE');
  const chunks=[];let size=0;
  try{
    for await(const chunk of response.body??[]){size+=chunk.length;need(size<=maximum,'MCP_ANALYSIS_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(chunk));}
  }catch(error){await response.body?.cancel().catch(()=>{});throw error;}
  if(length!==null)need(size===Number(length),'MCP_ANALYSIS_RESPONSE_INCOMPLETE');
  return Buffer.concat(chunks,size);
}
function publicSource(source){
  if(!object(source))return source;
  const {session,room,paths,config,result,manifest,stream,stream_export,sourceDirectory,...record}=source;
  if(object(record.input)){const {config,result,manifest,stream,...input}=record.input;record.input=input;}
  return record;
}
function publicVersion(version){
  if(!object(version))return version;
  const {sourceDirectory,...record}=version;return record;
}
function publicJob(job){
  const result={...job};
  if(object(result.request?.source))result.request={...result.request,source:publicSource(result.request.source)};
  if(object(result.result)){
    result.result={...result.result};
    delete result.result.path;delete result.result.directory;
    if(result.result.version)result.result.version=publicVersion(result.result.version);
    if(Array.isArray(result.result.source_versions))result.result.source_versions=result.result.source_versions.map(publicVersion);
  }
  return result;
}
function queryString(values){
  const pairs=Object.entries(values).filter(([,v])=>v!==undefined);
  return pairs.length?'?'+new URLSearchParams(pairs.map(([key,value])=>[key,String(value)])):'';
}
function pageRows(record,args,key='rows'){
  const limit=args.limit??25;need(Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'MCP_ANALYSIS_PAGE_INVALID');
  if(!Array.isArray(record?.[key]))return record;
  const all=record[key],kept=all.slice(0,limit),start=record.offset??args.offset??0;
  if(kept.length<all.length)return {...record,[key]:kept,next_offset:start+kept.length};
  return record;
}

/** The host registers a real running original service; no launch URL/token is retained here. */
export function createNativeAnalysis({manifest,completedDataset,completedObject,completedResponse,isClosed=()=>false}={}){
  need(object(manifest),'MCP_ANALYSIS_NATIVE_WORKSPACE_REQUIRED');
  const root=join(localPath(manifest.directory),'analysis'),aliases=join(root,'workspaces');
  const shutdown=new AbortController(),reads=createSavedFileReader(),pending=new Set();
  const workbooks=createNativeWorkbookActions({reads,parse});
  const sources=createNativeSourceActions({manifest,completedObject,completedResponse});
  const archives=createNativeArchiveActions({reads,parse});
  let closed=false;
  const available=()=>need(!closed&&!isClosed(),'MCP_NATIVE_WORKSPACE_CLOSING');
  async function roots(create=false){
    if(!create&&(await optionalBytes(join(root,'format.json'),1024))===null)return false;
    await directory(root,{create});await directory(aliases,{create});
    if(create)await retainRecord(join(root,'format.json'),{schema:SCHEMA},{resume:true});
    need((await json(join(root,'format.json'))).schema===SCHEMA,'MCP_ANALYSIS_FORMAT_CHANGED');
    return true;
  }
  async function request(connection,route,body,signal){
    available();
    const options={method:body===undefined?'GET':'POST',redirect:'error',cache:'no-store',
      headers:{'X-Analysis-Capability':connection.capability,'Origin':connection.url.origin},
      signal:AbortSignal.any([shutdown.signal,AbortSignal.timeout(30000),...(signal?[signal]:[])])};
    if(body!==undefined){const raw=enc(body);need(raw.length<=MAX_REQUEST,'MCP_ANALYSIS_REQUEST_TOO_LARGE');options.body=raw;options.headers['Content-Type']='application/json';}
    let response;
    try{response=await fetch(new URL(route,connection.url),options);}
    catch(error){
      if(shutdown.signal.aborted||signal?.aborted)fail('MCP_ANALYSIS_CALL_INTERRUPTED_REOPEN_ORIGINAL_JOB');
      fail(body===undefined?'MCP_ANALYSIS_SERVICE_UNAVAILABLE':'MCP_ANALYSIS_REPLY_UNCERTAIN_REOPEN_ORIGINAL_JOB');
    }
    const raw=await readResponse(response,MAX_JSON),value=parse(raw);
    if(!response.ok){
      const code=/^[A-Z0-9_]{1,180}$/.test(value?.error??'')?value.error:'MCP_ANALYSIS_HTTP_'+response.status;
      fail(code);
    }
    return value;
  }
  async function connect(record,signal){
    await directory(record.database);
    const control=await json(join(record.database,'analysis-launch.json')),connection=launchURL(control);
    need(control.workspace_id===record.workspaceId,'MCP_ANALYSIS_WORKSPACE_ID_CHANGED');
    const state=await request(connection,'/api/state',undefined,signal);
    need(state.schema===CUSTOMER&&state.workspace_id===record.workspaceId&&
      state.database===join(record.database,'datasets.sqlite3'),'MCP_ANALYSIS_WORKSPACE_ID_CHANGED');
    return {...connection,state};
  }
  async function registered(alias){
    await roots();const record=await json(join(aliases,name(alias)+'.json'));
    need(record.schema===SCHEMA&&record.name===alias&&ID.test(record.workspaceId??'')&&
      record.nativeWorkspace===manifest.directory,'MCP_ANALYSIS_REGISTRATION_CHANGED');
    localPath(record.database);return record;
  }
  async function register({name:alias,database}={}){
    available();name(alias);localPath(database);await directory(database);
    const control=await json(join(database,'analysis-launch.json'));
    const record={schema:SCHEMA,name:alias,database,workspaceId:control.workspace_id,nativeWorkspace:manifest.directory};
    await connect(record);await roots(true);
    await retainRecord(join(aliases,alias+'.json'),record,{resume:true});
    return {schema:SCHEMA,name:alias,workspaceId:record.workspaceId,database,status:'ORIGINAL_ANALYSIS_REGISTERED'};
  }
  async function workspaces(){
    if(!await roots())return {workspaces:[]};
    const names=(await readdir(aliases)).filter(n=>/^[A-Za-z][A-Za-z0-9_-]{0,63}\.json$/.test(n)).sort();
    need(names.length<=1000,'MCP_ANALYSIS_WORKSPACE_LIST_LIMIT');
    const list=[];
    for(const file of names){const record=await registered(file.slice(0,-5));list.push({name:record.name,workspaceId:record.workspaceId});}
    return {workspaces:list};
  }
  function finish(alias,operation,value){
    const result={schema:SCHEMA,analysisWorkspace:alias??null,operation,result:value,
      integerEncoding:'Unsafe raw JSON integer tokens use {encoding:"json-integer",text}; original SQL cells retain their native typed-text encoding.'};
    need(enc(result).length<=MAX_TOOL,'MCP_ANALYSIS_PAGE_TOO_LARGE_USE_SMALLER_PAGE_OR_FILE');
    return result;
  }
  async function file(record,connection,args,signal){
    const identifier=id(args.id),job=await request(connection,'/api/jobs/'+identifier,undefined,signal);
    need(job.id===identifier&&job.status==='COMPLETE'&&['report-export','change-export','backup'].includes(job.kind)&&
      object(job.result),'MCP_ANALYSIS_COMPLETE_FILE_JOB_REQUIRED');
    const file=job.result;let root,path;
    // Original jobs retain producer provenance. Resolve only below this host's
    // currently selected customer database, including after portable receiving.
    if(job.kind==='backup'){
      root=join(record.database,'analysis-backups');await directory(root);
      const folder=join(root,identifier);await directory(folder);path=join(folder,'datasets.sqlite3');
    }else{
      const pattern=job.kind==='report-export'?/^report-[a-f0-9]{64}\.(?:html|json|zip)$/:/^changes-[a-f0-9]{64}\.(?:json|csv)$/;
      need(typeof file.filename==='string'&&pattern.test(file.filename),'MCP_ANALYSIS_FILE_PATH_INVALID');
      root=join(record.database,'analysis-exports');await directory(root);path=join(root,file.filename);
    }
    hash(file.sha256);positive(file.bytes,true);
    if(args.sha256!==undefined)need(hash(args.sha256)===file.sha256,'MCP_ANALYSIS_FILE_IDENTITY_CHANGED');
    return {id:job.id,kind:job.kind,originalResultSha256:job.result.sha256,
      file:await reads({destination:path,bytes:file.bytes,sha256:file.sha256,
        contentType:file.mime??(job.kind==='backup'?'application/vnd.sqlite3':null)},args)};
  }
  async function queryExportFile(record,connection,args,signal){
    const identifier=id(args.id),job=await request(connection,'/api/jobs/'+identifier,undefined,signal);
    need(job.id===identifier&&job.status==='COMPLETE'&&job.kind==='query-export'&&object(job.result),
      'MCP_ANALYSIS_COMPLETE_QUERY_EXPORT_REQUIRED');
    need(['rows.jsonl','rows.csv','rows.sqlite3','manifest.json'].includes(args.filename),
      'MCP_ANALYSIS_FILE_NAME_INVALID');
    const native=job.result,expected=join(record.database,'analysis-query-exports',identifier);
    // A received workspace keeps the producer location in its original result.
    // Resolve only this host's selected database and the original validated ID.
    need(native.schema==='stellar-forge.analysis-query-export.v1'&&typeof native.directory==='string'&&
      native.source_query?.id===job.request?.query_id&&
      native.source_query?.result_sha256===job.request?.result_sha256,
      'MCP_ANALYSIS_EXPORT_BELONGS_TO_OTHER_WORKSPACE');
    await directory(join(record.database,'analysis-query-exports'));await directory(expected);
    const manifest=native.files?.find(file=>file.name==='manifest.json');
    const file=native.files?.find(file=>file.name===args.filename);
    need(object(manifest)&&object(file)&&manifest.sha256===native.manifest_sha256,
      'MCP_ANALYSIS_QUERY_EXPORT_OUTPUT_NOT_SELECTED');
    hash(manifest.sha256);positive(manifest.bytes,true);hash(file.sha256);positive(file.bytes,true);
    if(args.filename!=='manifest.json'){
      const original=native.manifest?.outputs?.[args.filename];
      need(original?.sha256===file.sha256&&original.bytes===file.bytes,
        'MCP_ANALYSIS_QUERY_EXPORT_MANIFEST_CHANGED');
    }
    if(args.sha256!==undefined)need(hash(args.sha256)===file.sha256,'MCP_ANALYSIS_FILE_IDENTITY_CHANGED');
    // Reuse the original shared native descriptor/hash cache. No archive copy,
    // SQL replay, repeated HTTP whole-file read, or new export implementation.
    await reads({destination:join(expected,'manifest.json'),bytes:manifest.bytes,
      sha256:manifest.sha256,contentType:manifest.mime},{maxBytes:1});
    return {id:job.id,filename:args.filename,manifestSha256:native.manifest_sha256,
      sourceQuery:native.source_query,
      file:await reads({destination:join(expected,args.filename),bytes:file.bytes,
        sha256:file.sha256,contentType:file.mime},args)};
  }
  async function dispatch(args={},context={}){
    available();need(object(args)&&Object.keys(args).every(k=>['action','analysisWorkspace','analysisOperation','analysisRequest'].includes(k))&&
      args.action==='analysis'&&object(context)&&(context.signal===undefined||context.signal instanceof AbortSignal),
      'MCP_ANALYSIS_ARGUMENTS_INVALID');
    const op=args.analysisOperation,body=args.analysisRequest??{};
    need(Object.hasOwn(fields,op)&&object(body)&&Object.keys(body).every(k=>fields[op].includes(k))&&
      nativeAnalysisOperations[op].required.every(k=>Object.hasOwn(body,k)),'MCP_ANALYSIS_OPERATION_ARGUMENTS_INVALID');
    if(op==='workspaces')return finish(null,op,await workspaces());
    const alias=name(args.analysisWorkspace),record=await registered(alias),connection=await connect(record,context.signal);
    const get=route=>request(connection,route,undefined,context.signal);
    const post=(route,value)=>request(connection,route,value,context.signal);
    let value;
    if(op==='state')value={...connection.state,database:undefined,sources:connection.state.sources.map(publicSource)};
    else if(op==='sources'){
      const offset=body.offset??0,limit=body.limit??25;positive(offset,true);need(Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'MCP_ANALYSIS_PAGE_INVALID');
      const all=connection.state.sources;need(offset<=all.length,'MCP_ANALYSIS_PAGE_INVALID');
      value={sources:all.slice(offset,offset+limit).map(publicSource),total:all.length,nextOffset:offset+limit<all.length?offset+limit:null};
    }else if(op==='attach-dataset'){
      need(typeof completedDataset==='function','MCP_ANALYSIS_ORIGINAL_DATASET_ADAPTER_REQUIRED');
      name(body.name);positive(body.expected_revision,true);
      need(typeof body.acquisition_id==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(body.acquisition_id),'MCP_ANALYSIS_ACQUISITION_ID_REQUIRED');
      const original=await completedDataset(body.acquisition_id);
      need(original.acquisitionId===body.acquisition_id&&HASH.test(original.configurationSha256??'')&&
        HASH.test(original.sourceBindingSha256??'')&&typeof original.sessionId==='string','MCP_ANALYSIS_COMPLETED_DATASET_REQUIRED');
      value=publicSource(await post('/api/native-dataset-source',{name:body.name,expected_revision:body.expected_revision,
        session:original.session,room:original.room,expected_native:{sessionId:original.sessionId,
          configurationSha256:original.configurationSha256,sourceBindingSha256:original.sourceBindingSha256}}));
    }else if(op==='response-source'){
      name(body.name);positive(body.revision);
      value=await get('/api/response-source/'+encodeURIComponent(body.name)+queryString({revision:body.revision,collection:body.collection,sse_data:body.sse_data}));
    }else if(op==='versions'){if(body.before!==undefined)positive(body.before);value=await get('/api/versions'+queryString(body));value.versions=value.versions.map(publicVersion);}
    else if(op==='version')value=publicVersion(await get('/api/version/'+hash(body.version_id)));
    else if(op==='manifest')value=await get('/api/manifest/'+hash(body.version_id));
    else if(['import','response-preview','response-import','query','compare','change-export','report','report-export','backup','query-export'].includes(op)){
      id(body.id);value=publicJob(await post('/api/start/'+op,body));
    }else if(op==='activate'){name(body.name);hash(body.version_id);positive(body.expected_revision,true);value=await post('/api/activate',body);value.version=publicVersion(value.version);}
    else if(op==='save-query'){name(body.name);positive(body.expected_revision,true);const {name:ignored,...spec}=body;value=await post('/api/queries/'+encodeURIComponent(body.name),spec);}
    else if(op==='saved-query'){name(body.name);if(body.revision!==undefined)positive(body.revision);value=await get('/api/queries/'+encodeURIComponent(body.name)+queryString({revision:body.revision}));}
    else if(op==='job'){id(body.id);if(body.offset!==undefined)positive(body.offset,true);value=publicJob(await get('/api/jobs/'+body.id+queryString({offset:body.offset})));if(value.kind==='query'&&value.result)value.result=pageRows(value.result,body);}
    else if(op==='comparisons'){if(body.before!==undefined)positive(body.before);value=await get('/api/changes'+queryString(body));}
    else if(op==='comparison'){id(body.id);if(body.after!==undefined)positive(body.after,true);value=await get('/api/changes/'+body.id+queryString({after:body.after,kind:body.kind}));
      const limit=body.limit??25;need(Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'MCP_ANALYSIS_PAGE_INVALID');
      if(value.rows.length>limit)value={...value,rows:value.rows.slice(0,limit),next_after:value.rows[limit-1].ordinal};}
    else if(op==='select'){const {comparison_id,...spec}=body;id(comparison_id);id(spec.id);value=await post('/api/changes/'+comparison_id+'/select',spec);}
    else if(op==='save-report'){name(body.name);id(body.id);const {name:ignored,...spec}=body;value=await post('/api/reports/'+encodeURIComponent(body.name),spec);}
    else if(op==='report-definition'){name(body.name);if(body.revision!==undefined)positive(body.revision);value=await get('/api/reports/'+encodeURIComponent(body.name)+queryString({revision:body.revision}));}
    else if(op==='report-runs'||op==='publications'){if(body.name!==undefined)name(body.name);if(body.before!==undefined)positive(body.before);value=await get((op==='report-runs'?'/api/report-runs':'/api/report-publications')+queryString(body));}
    else if(op==='report-read'){id(body.id);if(body.section!==undefined)positive(body.section,true);if(body.offset!==undefined)positive(body.offset,true);value=pageRows(await get('/api/report-runs/'+body.id+queryString({section:body.section,offset:body.offset})),body);}
    else if(op==='publish'){const {report_id,...spec}=body;id(report_id);id(spec.id);value=await post('/api/report-runs/'+report_id+'/publish',spec);}
    else if(op==='query-exports'){if(body.before!==undefined)positive(body.before);value=await get('/api/query-exports'+queryString(body));}
    else if(op==='cancel-query-export')value=publicJob(await post('/api/query-exports/'+id(body.id)+'/cancel',{}));
    else if(op==='query-export-file')value=await queryExportFile(record,connection,body,context.signal);
    else if(op==='file')value=await file(record,connection,body,context.signal);
    else if(sources.handles(op))value=await sources.call({operation:op,body,post});
    else if(workbooks.handles(op))value=await workbooks.call({operation:op,body,record,state:connection.state,get,post});
    else if(archives.handles(op))value=await archives.call({operation:op,body,record,state:connection.state,get,post});
    else fail('MCP_ANALYSIS_OPERATION_UNKNOWN');
    return finish(alias,op,value);
  }
  return {register,async call(args,context){
    const task=dispatch(args,context);pending.add(task);try{return await task;}finally{pending.delete(task);}
  },async close(){
    if(closed)return;closed=true;shutdown.abort();await Promise.allSettled([...pending]);
    workbooks.close();
    archives.close();
    // The original analysis service belongs to its host/browser. It keeps its own jobs and lease.
  }};
}

