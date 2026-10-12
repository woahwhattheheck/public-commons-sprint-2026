// SPDX-License-Identifier: MIT
// Agent access to the ORIGINAL, separately owned DuckDB customer service.
import {createHash} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import {join,resolve,isAbsolute,dirname,relative} from 'node:path';
import {
 initializationDirectory as directory, initializationBytes as bytes,
 optionalInitializationBytes as optionalBytes, retainInitializationRecord as retainRecord
} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {need,InputError} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';
import {createSavedFileReader} from './native-file.mjs';
import {nativeDuckDBOperations,nativeDuckDBActions,nativeDuckDBSchema} from './native-duckdb-schema.mjs';
export {nativeDuckDBActions,nativeDuckDBSchema};

const SCHEMA='stellar-forge.mcp-native-duckdb.v1';
const CUSTOMER='stellar-forge.sf100.duckdb-workspace.v1';
const LAUNCH='stellar-forge.duckdb-operator-launch.v1';
const NAME=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const HASH=/^[a-f0-9]{64}$/;
const ID=/^[a-f0-9]{32}$/;
const EXPORT=/^(?:[a-f0-9]{64}|handoff-[a-f0-9]{32})$/;
const MAX_JSON=32*1024*1024, MAX_TOOL=256*1024, MAX_REQUEST=1024*1024;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const sha=x=>createHash('sha256').update(x).digest('hex');
const enc=x=>Buffer.from(JSON.stringify(x));
const fail=code=>{throw new InputError(code);};
const name=x=>{need(typeof x==='string'&&NAME.test(x),'MCP_DUCKDB_ALIAS_REQUIRED');return x;};
const hash=x=>{need(typeof x==='string'&&HASH.test(x),'MCP_DUCKDB_HASH_REQUIRED');return x;};
const id=x=>{need(typeof x==='string'&&ID.test(x),'MCP_DUCKDB_REQUEST_ID_REQUIRED');return x;};
const positive=(x,zero=false)=>{need(Number.isSafeInteger(x)&&x>=(zero?0:1),'MCP_DUCKDB_INTEGER_INVALID');return x;};
function localPath(x){
 need(typeof x==='string'&&isAbsolute(x)&&resolve(x)===x&&x!=='/'&&!x.includes('\0'),'MCP_DUCKDB_PRIVATE_PATH_REQUIRED');
 return x;
}
function parse(raw){
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{fail('MCP_DUCKDB_RESPONSE_JSON_INVALID');}
 let out='',quoted=false,escaped=false;
 for(let i=0;i<text.length;){
  const c=text[i];
  if(quoted){out+=c;i++;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
  if(c==='"'){quoted=true;out+=c;i++;continue;}
  if(c==='-'||c>='0'&&c<='9'){
   const match=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(i));
   if(!match)fail('MCP_DUCKDB_RESPONSE_JSON_INVALID');
   const token=match[0];i+=token.length;
   out+=/^-?[0-9]+$/.test(token)&&!Number.isSafeInteger(Number(token))
    ?'{"encoding":"json-integer","text":'+JSON.stringify(token)+'}':token;
   continue;
  }
  out+=c;i++;
 }
 try{return JSON.parse(out);}catch{fail('MCP_DUCKDB_RESPONSE_JSON_INVALID');}
}
const json=async(path,max=65536)=>parse(await bytes(path,max));
function launch(control){
 need(control?.schema===LAUNCH&&ID.test(control.workspace_id??''),'MCP_DUCKDB_IDENTITY_SERVICE_REQUIRED');
 let url;try{url=new URL(control.url);}catch{fail('MCP_DUCKDB_LAUNCH_INVALID');}
 need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port&&url.pathname==='/'&&!url.search&&
  !url.username&&!url.password&&/^[A-Za-z0-9_-]{24,128}$/.test(url.hash.slice(1)),'MCP_DUCKDB_LOCAL_SERVICE_REQUIRED');
 const browserUrl=url.href,capability=url.hash.slice(1);url.hash='';
 return {url,capability,browserUrl,workspaceId:control.workspace_id};
}
async function responseBytes(response,maximum){
 const length=response.headers.get('content-length');
 if(length!==null)need(/^[0-9]+$/.test(length)&&Number(length)<=maximum,'MCP_DUCKDB_RESPONSE_TOO_LARGE');
 const chunks=[];let count=0;
 try{
  for await(const part of response.body??[]){count+=part.length;need(count<=maximum,'MCP_DUCKDB_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(part));}
 }catch(error){await response.body?.cancel().catch(()=>{});throw error;}
 if(length!==null)need(count===Number(length),'MCP_DUCKDB_RESPONSE_INCOMPLETE');
 return Buffer.concat(chunks,count);
}
function requestBytes(value,parametersText){
 if(parametersText===undefined)return enc(value);
 need(typeof parametersText==='string'&&Buffer.byteLength(parametersText)<=524288,'MCP_DUCKDB_PARAMETERS_TEXT_REQUIRED');
 let parsed;try{parsed=JSON.parse(parametersText);}catch{fail('MCP_DUCKDB_PARAMETERS_JSON_INVALID');}
 need(plain(parsed)||Array.isArray(parsed),'MCP_DUCKDB_PARAMETERS_CONTAINER_REQUIRED');
 // Validation never round-trips the original numeric tokens through JavaScript.
 const prefix=JSON.stringify(value);
 return Buffer.from(prefix.slice(0,-1)+(Object.keys(value).length?',':'')+'"parameters":'+parametersText+'}');
}
function publicFile(file){
 if(!plain(file))return file;const {path,destination,...result}=file;return result;
}
function publicNative(native){
 if(!plain(native))return native;
 const {directory,config,result,report_path,...record}=native;
 for(const group of ['outputs','archives']){
  if(plain(record[group]))record[group]=Object.fromEntries(Object.entries(record[group]).map(([k,v])=>[k,publicFile(v)]));
 }
 return record;
}
function publicSource(source){
 if(!plain(source))return source;
 const {report_path,...record}=source;
 if(plain(record.native))record.native=publicNative(record.native);
 return record;
}
function publicRecord(value){
 if(!plain(value))return value;
 const {directory,workspace,source_directory,report_path,...record}=value;
 if(plain(record.source))record.source=publicSource(record.source);
 if(plain(record.native))record.native=publicNative(record.native);
 if(Array.isArray(record.files))record.files=record.files.map(publicFile);
 if(plain(record.edition))record.edition=publicRecord(record.edition);
 if(plain(record.body)){const {report_path,...body}=record.body;record.body=body;}
 return record;
}
function queryString(value){
 const entries=Object.entries(value).filter(([,x])=>x!==undefined);
 return entries.length?'?'+new URLSearchParams(entries.map(([k,v])=>[k,String(v)])):'';
}
function checkViews(value){
 need(Array.isArray(value)&&value.length<=4096,'MCP_DUCKDB_EXPECTED_VIEWS_REQUIRED');
 const names=new Set();
 for(const item of value){
  need(plain(item)&&Object.keys(item).length===3&&typeof item.name==='string'&&
   /^[A-Za-z][A-Za-z0-9_]{0,119}$/.test(item.name)&&!names.has(item.name),'MCP_DUCKDB_EXPECTED_VIEWS_INVALID');
  hash(item.edition_id);positive(item.revision);names.add(item.name);
 }
 return value;
}

/** The existing native buyer host registers services; no tool starts a warehouse. */
export function createNativeDuckDB({manifest,isClosed=()=>false}={}){
 need(plain(manifest),'MCP_DUCKDB_NATIVE_WORKSPACE_REQUIRED');
 const nativeRoot=localPath(manifest.directory),root=join(nativeRoot,'duckdb'),aliases=join(root,'workspaces');
 const shutdown=new AbortController(),pending=new Set(),readSaved=createSavedFileReader();
 let closed=false,closing;
 const available=()=>need(!closed&&!isClosed(),'MCP_NATIVE_WORKSPACE_CLOSING');
 async function roots(create=false){
  if(!create&&(await optionalBytes(join(root,'format.json'),1024))===null)return false;
  await directory(root,{create});await directory(aliases,{create});
  if(create)await retainRecord(join(root,'format.json'),{schema:SCHEMA},{resume:true});
  need((await json(join(root,'format.json'))).schema===SCHEMA,'MCP_DUCKDB_REGISTRY_CHANGED');return true;
 }
 async function request(connection,route,body,signal,{parametersText,sourceSha256}={}){
  available();
  const options={method:body===undefined?'GET':'POST',redirect:'error',cache:'no-store',
   headers:{'X-DuckDB-Capability':connection.capability,'X-DuckDB-Workspace-ID':connection.workspaceId,
    Origin:connection.url.origin},
   signal:AbortSignal.any([shutdown.signal,AbortSignal.timeout(30000),...(signal?[signal]:[])])};
  if(body!==undefined){
   const raw=requestBytes(body,parametersText);need(raw.length<=MAX_REQUEST,'MCP_DUCKDB_REQUEST_TOO_LARGE');
   options.body=raw;options.headers['Content-Type']='application/json';
  }
  if(sourceSha256!==undefined)options.headers['X-DuckDB-Source-Sha256']=hash(sourceSha256);
  let response;
  try{response=await fetch(new URL(route,connection.url),options);}
  catch{
   fail(body===undefined?'MCP_DUCKDB_SERVICE_UNAVAILABLE':'MCP_DUCKDB_REPLY_UNCERTAIN_INSPECT_ORIGINAL_OPERATION');
  }
  let raw,value;
  try{raw=await responseBytes(response,MAX_JSON);value=parse(raw);}
  catch(error){
   if(body!==undefined)fail('MCP_DUCKDB_REPLY_UNCERTAIN_INSPECT_ORIGINAL_OPERATION');
   throw error;
  }
  if(!response.ok){
   const code=/^[A-Z0-9_]{1,180}$/.test(value?.error??'')?value.error:'MCP_DUCKDB_HTTP_'+response.status;
   fail(code);
  }
  return value;
 }
 async function connect(record,signal){
  await directory(record.database);
  const control=await json(join(record.database,'duckdb-launch.json')),connection=launch(control);
  need(control.directory===record.database&&connection.workspaceId===record.workspaceId,'MCP_DUCKDB_WORKSPACE_ID_CHANGED');
  const identity=await request(connection,'/api/identity',undefined,signal);
  need(identity.schema===CUSTOMER&&identity.workspace_id===record.workspaceId&&
   identity.directory===record.database&&identity.engine==='DuckDB','MCP_DUCKDB_WORKSPACE_ID_CHANGED');
  localPath(identity.export_root);localPath(identity.handoff_root);
  if(record.exportRoot!==undefined)need(record.exportRoot===identity.export_root&&
   record.handoffRoot===identity.handoff_root,'MCP_DUCKDB_EXPORT_CONFIGURATION_CHANGED');
  return {...connection,identity};
 }
 async function registered(alias){
  need(await roots(),'MCP_DUCKDB_REGISTRATION_REQUIRED');
  const record=await json(join(aliases,name(alias)+'.json'),1024*1024);
  need(record.schema===SCHEMA&&record.name===alias&&record.nativeWorkspace===nativeRoot&&
   ID.test(record.workspaceId??'')&&Array.isArray(record.sources),'MCP_DUCKDB_REGISTRATION_CHANGED');
  localPath(record.database);localPath(record.exportRoot);localPath(record.handoffRoot);return record;
 }
 async function inspectRegistration({name:alias,database,sources=[]}={}){
  available();name(alias);localPath(database);await directory(database);
  need(Array.isArray(sources)&&sources.length<=256,'MCP_DUCKDB_SOURCES_INVALID');
  const control=await json(join(database,'duckdb-launch.json'));
  const record={schema:SCHEMA,name:alias,database,workspaceId:control.workspace_id,nativeWorkspace:nativeRoot};
  const connection=await connect(record),seen=new Set(),selected=[];
  for(const source of sources){
   need(plain(source)&&Object.keys(source).every(k=>['name','reportPath','sha256'].includes(k)),'MCP_DUCKDB_SOURCE_INVALID');
   name(source.name);need(!seen.has(source.name),'MCP_DUCKDB_SOURCE_ALIAS_DUPLICATED');seen.add(source.name);
   localPath(source.reportPath);hash(source.sha256);
   const raw=await bytes(source.reportPath,8*1024*1024);
   need(sha(raw)===source.sha256,'MCP_DUCKDB_ORIGINAL_REPORT_CHANGED');
   const original=await request(connection,'/api/inspect-delivery',{report_path:source.reportPath},undefined,{sourceSha256:source.sha256});
   need(original.input_report_sha256===source.sha256,'MCP_DUCKDB_ORIGINAL_REPORT_CHANGED');
   selected.push({...source,manifestSha256:hash(original.manifest_sha256),
    sourceBindingSha256:hash(original.source_binding_sha256),rows:positive(original.row_count,true)});
  }
  Object.assign(record,{exportRoot:connection.identity.export_root,handoffRoot:connection.identity.handoff_root,sources:selected});
  return {record,connection};
 }
 function hostBinding(record,connection,status){
  return {schema:SCHEMA,name:record.name,workspaceId:record.workspaceId,database:record.database,
   browserUrl:connection.browserUrl,sources:record.sources.map(({reportPath,...source})=>source),status};
 }
 async function register(description){
  const {record,connection}=await inspectRegistration(description);
  await roots(true);await retainRecord(join(aliases,record.name+'.json'),record,{resume:true});
  // Only trusted host registration/inspection returns an operator capability URL.
  return hostBinding(record,connection,'ORIGINAL_DUCKDB_REGISTERED');
 }
 async function source(record,connection,alias,expected,signal){
  name(alias);const selected=record.sources.find(x=>x.name===alias);
  need(selected,'MCP_DUCKDB_SOURCE_NOT_REGISTERED');
  if(expected!==undefined)need(hash(expected)===selected.sha256,'MCP_DUCKDB_REVIEWED_SOURCE_CHANGED');
  need(sha(await bytes(localPath(selected.reportPath),8*1024*1024))===selected.sha256,'MCP_DUCKDB_ORIGINAL_REPORT_CHANGED');
  return selected;
 }
 function finish(alias,operation,value){
  const result={schema:SCHEMA,duckdbWorkspace:alias??null,operation,result:value,
   integerEncoding:'Original DuckDB cells keep native typed string/hex encoding. Unsafe raw metadata integers use {encoding:"json-integer",text}. Exact input parameters_text is sent unchanged.'};
  need(enc(result).length<=MAX_TOOL,'MCP_DUCKDB_RESULT_TOO_LARGE_USE_SMALLER_PAGE_OR_FILE');return result;
 }
 async function workspaces(){
  if(!await roots())return {workspaces:[]};
  const names=(await readdir(aliases)).filter(x=>/^[A-Za-z][A-Za-z0-9_-]{0,63}\.json$/.test(x)).sort();
  need(names.length<=1000,'MCP_DUCKDB_REGISTRY_LIST_LIMIT');
  const values=[];for(const item of names){const r=await registered(item.slice(0,-5));values.push({name:r.name,workspaceId:r.workspaceId});}
  return {workspaces:values};
 }
 async function file(record,connection,args,signal){
  need(typeof args.export_id==='string'&&EXPORT.test(args.export_id),'MCP_DUCKDB_EXPORT_ID_REQUIRED');
  const original=await request(connection,'/api/exports/'+args.export_id,undefined,signal);
  need(original.export_id===args.export_id&&Array.isArray(original.files),'MCP_DUCKDB_EXPORT_RECORD_CHANGED');
  const handoff=args.export_id.startsWith('handoff-');
  if(handoff){
   need(['edition-source','source-handoff'].includes(original.kind),'MCP_DUCKDB_COMPLETE_HANDOFF_REQUIRED');
   const req=await request(connection,'/api/requests/'+id(args.export_id.slice(8)),undefined,signal);
   need(req.state==='COMPLETE'&&req.export_id===original.export_id&&req.directory===original.directory&&
    ['/api/source-handoffs','/api/handoffs'].includes(req.route),'MCP_DUCKDB_COMPLETE_HANDOFF_REQUIRED');
   need(dirname(localPath(original.directory))===record.handoffRoot,'MCP_DUCKDB_HANDOFF_FROM_OTHER_WORKSPACE');
  }else{
   need(original.state==='COMPLETE'&&original.workspace===record.database,'MCP_DUCKDB_EXPORT_FROM_OTHER_WORKSPACE');
  }
  const exportDirectory=localPath(original.directory);await directory(exportDirectory);
  need(typeof args.filename==='string'&&args.filename.length<=1024&&!args.filename.includes('\\')&&
   args.filename.split('/').every(x=>x&&x!=='.'&&x!=='..')&&!isAbsolute(args.filename),'MCP_DUCKDB_FILE_NAME_INVALID');
  const selected=original.files.find(x=>x.name===args.filename);
  need(selected&&hash(selected.sha256)===hash(args.sha256),'MCP_DUCKDB_FILE_IDENTITY_CHANGED');
  positive(selected.bytes??selected.size,true);
  const path=join(exportDirectory,args.filename);
  const selectedPath=selected.path?resolve(exportDirectory,selected.path):path;
  need(selectedPath===path&&!relative(exportDirectory,path).startsWith('..'),'MCP_DUCKDB_FILE_OUTSIDE_EXPORT');
  let parent=dirname(path);
  while(parent!==exportDirectory){await directory(parent);parent=dirname(parent);}
  if(!handoff){
   const manifest=original.files.find(x=>x.name==='manifest.json');
   need(manifest&&HASH.test(manifest.sha256??'')&&Number.isSafeInteger(manifest.bytes),'MCP_DUCKDB_COMPLETE_MANIFEST_REQUIRED');
   await readSaved({destination:join(exportDirectory,'manifest.json'),bytes:manifest.bytes,sha256:manifest.sha256,
    contentType:'application/json'},{maxBytes:1});
  }
  return {exportId:original.export_id,filename:args.filename,workspaceId:record.workspaceId,
   file:await readSaved({destination:path,bytes:selected.bytes??selected.size,sha256:selected.sha256,
    contentType:selected.mime??null},args)};
 }
 async function dispatch(args={},context={}){
  available();need(plain(args)&&Object.keys(args).every(k=>['action','duckdbWorkspace','duckdbOperation','duckdbRequest'].includes(k))&&
   args.action==='duckdb'&&plain(context)&&(context.signal===undefined||context.signal instanceof AbortSignal),'MCP_DUCKDB_ARGUMENTS_INVALID');
  const op=args.duckdbOperation,body=args.duckdbRequest??{},spec=nativeDuckDBOperations[op];
  need(Object.hasOwn(nativeDuckDBOperations,op)&&plain(body)&&Object.keys(body).every(k=>Object.hasOwn(spec.properties,k))&&
   spec.required.every(k=>Object.hasOwn(body,k)),'MCP_DUCKDB_OPERATION_ARGUMENTS_INVALID');
  if(op==='workspaces')return finish(null,op,await workspaces());
  const alias=name(args.duckdbWorkspace),record=await registered(alias),connection=await connect(record,context.signal);
  const get=route=>request(connection,route,undefined,context.signal);
  const post=(route,value,options)=>request(connection,route,value,context.signal,options);
  let value;
  if(op==='state'){
   const views=await get('/api/catalog/views?offset=0&limit=100');
   value={workspaceId:record.workspaceId,engine:'DuckDB',schema:CUSTOMER,views:views.views,
    viewsTotal:views.total,nextViewOffset:views.next_offset,sourceCount:record.sources.length,
    ownership:'The original Python service owns the warehouse and browser; this MCP host owns only its adapter calls.'};
  }else if(op==='sources'){
   const offset=body.offset??0,limit=body.limit??25;positive(offset,true);
   need(Number.isSafeInteger(limit)&&limit>=1&&limit<=100&&offset<=record.sources.length,'MCP_DUCKDB_PAGE_INVALID');
   value={sources:record.sources.slice(offset,offset+limit).map(({reportPath,...s})=>s),offset,total:record.sources.length,
    next_offset:offset+limit<record.sources.length?offset+limit:null};
  }else if(op==='inspect-source'||op==='review'){
   const selected=await source(record,connection,body.source,body.source_sha256,context.signal);
   const result=await post(op==='review'?'/api/reviews':'/api/inspect-delivery',
    {report_path:selected.reportPath,...(op==='review'?{columns:body.columns,keys:body.keys}:{})},{sourceSha256:selected.sha256});
   need(result.manifest_sha256===selected.manifestSha256&&result.source_binding_sha256===selected.sourceBindingSha256&&
    (op==='review'||result.input_report_sha256===selected.sha256),'MCP_DUCKDB_REVIEWED_SOURCE_CHANGED');
   value={source:{name:selected.name,sha256:selected.sha256},...publicRecord(result)};
  }else if(['reviews','queries','exports','handoffs','operations','views'].includes(op)){
   const offset=body.offset??0,limit=body.limit??25;positive(offset,true);
   need(Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'MCP_DUCKDB_PAGE_INVALID');
   value=await get('/api/catalog/'+op+queryString({offset,limit}));value[op]=value[op].map(publicRecord);
  }else if(op==='editions'){
   if(body.before!==undefined)positive(body.before);const limit=body.limit??25;
   need(Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'MCP_DUCKDB_PAGE_INVALID');
   value=await get('/api/editions'+queryString({...body,limit}));value.editions=value.editions.map(publicRecord);
  }else if(op==='edition')value=publicRecord(await get('/api/editions/'+hash(body.edition_id)));
  else if(op==='review-read')value=publicRecord(await get('/api/reviews/'+hash(body.review_id)));
  else if(op==='saved-query')value=publicRecord(await get('/api/queries/'+hash(body.query_id)));
  else if(op==='export-read'){
   need(typeof body.export_id==='string'&&EXPORT.test(body.export_id),'MCP_DUCKDB_EXPORT_ID_REQUIRED');
   value=publicRecord(await get('/api/exports/'+body.export_id));
  }else if(op==='operation')value=publicRecord(await get('/api/requests/'+id(body.request_id)));
  else if(op==='resume')value=publicRecord(await post('/api/requests/'+id(body.request_id)+'/resume',{}));
  else if(op==='import')value=publicRecord(await post('/api/import',{review_id:hash(body.review_id)}));
  else if(op==='activate'){
   positive(body.expected_revision,true);hash(body.edition_id);value=publicRecord(await post('/api/activate',body));
  }else if(op==='save-query'||op==='query'){
   const {parameters_text,...requestBody}=body;
   if(op==='save-query')positive(body.expected_revision,true);else checkViews(body.expected_views);
   value=publicRecord(await post(op==='query'?'/api/query':'/api/queries',requestBody,{parametersText:parameters_text}));
  }else if(op==='compare'){
   hash(body.before_id);hash(body.after_id);value=publicRecord(await post('/api/compare',body));
  }else if(op==='export'){
   id(body.request_id);hash(body.query_id);positive(body.expected_revision);checkViews(body.expected_views);
   value=publicRecord(await post('/api/exports',body));
  }else if(op==='source-handoff'){
   id(body.request_id);hash(body.edition_id);value=publicRecord(await post('/api/source-handoffs',body));
  }else if(op==='handoff'){
   id(body.request_id);value=publicRecord(await post('/api/handoffs',body));
  }else if(op==='file')value=await file(record,connection,body,context.signal);
  else fail('MCP_DUCKDB_OPERATION_NOT_FOUND');
  return finish(alias,op,value);
 }
 function tracked(action){
  available();const running=Promise.resolve().then(action);pending.add(running);
  running.finally(()=>pending.delete(running)).catch(()=>{});return running;
 }
 return Object.freeze({
  register:options=>tracked(()=>register(options)),
  inspectRegistration:options=>tracked(async()=>{const {record,connection}=await inspectRegistration(options);
   return hostBinding(record,connection,'ORIGINAL_DUCKDB_INSPECTED');}),
  call:(args,context)=>tracked(()=>dispatch(args,context)),
  close(){
   if(closing)return closing;
   closed=true;shutdown.abort();
   closing=Promise.allSettled([...pending]).then(()=>{});return closing;
  }
 });
}

/** Read-only host inspection; it writes no registry, database or launch file. */
export async function inspectDuckDBRegistration(description){
 need(plain(description),'MCP_DUCKDB_REGISTRATION_REQUIRED');
 const client=createNativeDuckDB({manifest:{directory:localPath(description.database)}});
 try{return await client.inspectRegistration(description);}
 finally{await client.close();}
}

