// SPDX-License-Identifier: MIT
// Typed operations and complete receiving over the existing native buyer tool.
import {createHash} from 'node:crypto';
import {openMerchantFileClient,createRetainedDownload} from '../mcp-merchant-operator/retained-download.mjs';

const SCHEMA='stellar-forge.duckdb-reconciliation.v1';
const TOOL='sf43_discover_review_and_pay';
const MAX_FILE=8*1024*1024*1024,MAX_MANIFEST=16*1024*1024;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const id=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
function fail(code){const error=new Error(code);error.code=code;throw error;}
const need=(value,code)=>{if(!value)fail(code);};
function name(value){
 need(typeof value==='string'&&value.length>0&&value.length<=1024&&!value.startsWith('/')&&
  !/[\\:\u0000-\u001f\u007f]/.test(value)&&value.split('/').every(p=>p&&p!=='.'&&p!=='..')&&
  value.split('/').length<=32,'DUCKDB_RECONCILIATION_FILE_NAME_INVALID');return value;
}
export function parseReconciliationManifest(bytes,exportId){
 let result;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
 catch{fail('DUCKDB_RECONCILIATION_MANIFEST_INVALID');}
 need(bytes.length<=MAX_MANIFEST&&plain(result)&&result.schema===SCHEMA+'.export'&&
  result.export_id===exportId&&sha(exportId)&&result.complete===true&&result.state==='COMPLETE'&&
  id(result.workspace_id)&&id(result.request_id)&&sha(result.report_id)&&sha(result.report_digest)&&
  Array.isArray(result.files)&&result.files.length<=100000,'DUCKDB_RECONCILIATION_MANIFEST_INVALID');
 const names=new Set();
 for(const file of result.files){
  need(plain(file)&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=MAX_FILE&&sha(file.sha256),
   'DUCKDB_RECONCILIATION_MANIFEST_INVALID');
  name(file.name);need(file.name!=='manifest.json'&&!names.has(file.name),'DUCKDB_RECONCILIATION_MANIFEST_INVALID');names.add(file.name);
 }
 for(const required of ['report.json','reconciliation-request.json','OPERATING.md',
  'warehouse/warehouse.duckdb','warehouse/handoff-request.json','warehouse/handoff.json'])
  need(names.has(required),'DUCKDB_RECONCILIATION_PACKAGE_INCOMPLETE');
 need(Array.isArray(result.queries)&&Array.isArray(result.sources),'DUCKDB_RECONCILIATION_MANIFEST_INVALID');
 const kinds=new Set();
 for(const query of result.queries){
  need(plain(query)&&['rows','groups','decisions','changes','fields','normalizations'].includes(query.kind)&&!kinds.has(query.kind)&&
   sha(query.query_id)&&sha(query.export_id)&&Number.isSafeInteger(query.revision)&&query.revision>0&&
   Number.isSafeInteger(query.rows)&&query.rows>=0&&query.directory==='queries/'+query.kind,
   'DUCKDB_RECONCILIATION_MANIFEST_INVALID');
  kinds.add(query.kind);
  for(const file of ['manifest.json','request.json','execution.json','result.parquet','result.csv'])
   need(names.has(query.directory+'/'+file),'DUCKDB_RECONCILIATION_PACKAGE_INCOMPLETE');
 }
 need(['rows','groups','decisions'].every(kind=>kinds.has(kind)),'DUCKDB_RECONCILIATION_PACKAGE_INCOMPLETE');
 if(result.comparison_rules!==undefined){
  need(plain(result.comparison_rules)&&result.comparison_rules.schema==='stellar-forge.duckdb-reconciliation.numeric-rules.v1'&&
   Array.isArray(result.comparison_rules.columns)&&result.comparison_rules.columns.length>0&&kinds.has('fields'),
   'DUCKDB_RECONCILIATION_COMPARISON_RULES_CHANGED');
 }
 if(result.normalizations!==undefined){
  need(plain(result.normalizations)&&result.normalizations.schema==='stellar-forge.duckdb-reconciliation.normalizations.v1'&&
   Array.isArray(result.normalizations.columns)&&result.normalizations.columns.length>0&&kinds.has('normalizations'),
   'DUCKDB_RECONCILIATION_NORMALIZATIONS_CHANGED');
 }else need(!kinds.has('normalizations'),'DUCKDB_RECONCILIATION_NORMALIZATIONS_CHANGED');
 need(kinds.has('fields')===(result.comparison_rules!==undefined||result.normalizations!==undefined),
  'DUCKDB_RECONCILIATION_COMPARISON_FIELDS_CHANGED');
 const editions=new Set();
 for(const source of result.sources){
  need(plain(source)&&sha(source.edition_id)&&!editions.has(source.edition_id)&&
   source.directory==='sources/'+source.edition_id&&Array.isArray(source.files)&&source.files.length>0,
   'DUCKDB_RECONCILIATION_MANIFEST_INVALID');
  editions.add(source.edition_id);
  for(const file of source.files)need(names.has(source.directory+'/'+name(file)),'DUCKDB_RECONCILIATION_PACKAGE_INCOMPLETE');
 }
 need(editions.size>=1&&editions.size<=2,'DUCKDB_RECONCILIATION_MANIFEST_INVALID');
 return result;
}

/**
 * @param {{url?:string,client?:{endpoint:string,call:Function},workspace:string,
 * expectedWorkspaceId?:string,tokenEnv?:string,environment?:Object,signal?:AbortSignal}} options
 * The supplied client is the existing MCP tools client. Its owner remains external.
 * This adapter closes only its own requests; it never stops Python or a warehouse.
 */
export async function openDuckDBReconciliationClient({url,client:provided,workspace,
 expectedWorkspaceId,tokenEnv='MCP_ACCESS_TOKEN',environment=process.env,signal}={}){
 need(typeof workspace==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(workspace),'DUCKDB_RECONCILIATION_ALIAS_REQUIRED');
 need(expectedWorkspaceId===undefined||id(expectedWorkspaceId),'DUCKDB_RECONCILIATION_WORKSPACE_ID_REQUIRED');
 need(!(provided&&url),'DUCKDB_RECONCILIATION_ONE_CLIENT_REQUIRED');
 const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 const transport=provided??await openMerchantFileClient({url,tokenEnv,environment,signal:combined,
  errorPrefix:'DUCKDB_RECONCILIATION',clientName:'starforge-duckdb-reconciliation',maximumResponseBytes:2*1024*1024});
 need(transport&&typeof transport.call==='function'&&typeof transport.endpoint==='string'&&transport.endpoint.length>0,
  'DUCKDB_RECONCILIATION_CLIENT_REQUIRED');
 let closed=false,closing,workspaceId=expectedWorkspaceId;const pending=new Set();
 function tracked(action){
  need(!closed,'DUCKDB_RECONCILIATION_CLIENT_CLOSED');
  const promise=Promise.resolve().then(action);pending.add(promise);
  promise.finally(()=>pending.delete(promise)).catch(()=>{});return promise;
 }
 async function native(operation,body={}){
  combined.throwIfAborted();
  const response=await transport.call(TOOL,{action:'duckdb',duckdbWorkspace:workspace,
   duckdbOperation:operation,duckdbRequest:body},{requestSignal:combined});
  need(response?.schema==='stellar-forge.mcp-native-duckdb.v1'&&response.duckdbWorkspace===workspace&&
   response.operation===operation&&plain(response.result),'DUCKDB_RECONCILIATION_REPLY_CHANGED');
  return response.result;
 }
 const initial=await native('reconcile-status');
 need(initial.schema===SCHEMA&&id(initial.workspace_id)&&
  (workspaceId===undefined||workspaceId===initial.workspace_id),'DUCKDB_RECONCILIATION_WORKSPACE_CHANGED');
 workspaceId=initial.workspace_id;
 const call=(operation,body)=>tracked(()=>native(operation,body));
 const exports=new Map();
 async function exported(exportId){
  need(sha(exportId),'DUCKDB_RECONCILIATION_EXPORT_ID_REQUIRED');
  let value=exports.get(exportId);
  if(!value){
   value=await native('reconcile-export-manifest',{export_id:exportId});
   need(value.schema===SCHEMA+'.export'&&value.export_id===exportId&&value.workspace_id===workspaceId&&
    value.state==='COMPLETE'&&plain(value.manifest_file),'DUCKDB_RECONCILIATION_EXPORT_CHANGED');
   exports.set(exportId,value);
  }
  return value;
 }
 const fileClient={endpoint:transport.endpoint+'#duckdb='+encodeURIComponent(workspace)+':'+workspaceId,
  async call(tool,args){
   combined.throwIfAborted();
   const record=await exported(args.exportId),manifest=record.manifest_file;
   need(manifest&&Number.isSafeInteger(manifest.bytes)&&manifest.bytes>0&&manifest.bytes<=MAX_MANIFEST&&sha(manifest.sha256),
    'DUCKDB_RECONCILIATION_MANIFEST_INVALID');
   if(tool==='duckdb_reconciliation_manifest')return {state:'MANIFEST_RETAINED',exportId:args.exportId,manifestFile:manifest};
   need(tool==='duckdb_reconciliation_file'&&args.expectedManifestSha256===manifest.sha256&&
    Number.isSafeInteger(args.offset)&&args.offset>=0&&Number.isSafeInteger(args.limit)&&args.limit>0&&args.limit<=65536&&
    args.readId===undefined,'DUCKDB_RECONCILIATION_RANGE_INVALID');
   const file=args.file==='manifest.json'?manifest:record.manifest?.files.find(file=>file.name===args.file);
   need(file&&file.sha256===args.expectedSha256,'DUCKDB_RECONCILIATION_FILE_CHANGED');
   const reply=await native('file',{export_id:args.exportId,filename:args.file,sha256:args.expectedSha256,
    byteOffset:args.offset,maxBytes:args.limit}),chunk=reply.file;
   need(reply.workspaceId===workspaceId&&reply.exportId===args.exportId&&reply.filename===args.file&&
    chunk?.verifiedSavedFile===true&&chunk.bytes===file.bytes&&chunk.sha256===file.sha256&&
    chunk.byteOffset===args.offset,'DUCKDB_RECONCILIATION_FILE_CHANGED');
   return {exportId:args.exportId,manifestSha256:manifest.sha256,file,
    offset:chunk.byteOffset,bytesRead:chunk.returnedBytes,nextOffset:chunk.nextByteOffset,encoding:chunk.encoding,data:chunk.data};
  }};
 const receiver=createRetainedDownload({manifestName:'manifest.json',
  parseManifest:(bytes,exportId)=>{const manifest=parseReconciliationManifest(bytes,exportId);
   need(manifest.workspace_id===workspaceId,'DUCKDB_RECONCILIATION_WORKSPACE_CHANGED');
   const entry=exports.get(exportId);
   need(entry&&hash(bytes)===entry.manifest_file.sha256,'DUCKDB_RECONCILIATION_MANIFEST_CHANGED');
   entry.manifest=manifest;return manifest;},
  maximumBytes:MAX_FILE,maximumManifestBytes:MAX_MANIFEST,maximumCheckpointBytes:64*1024*1024,
  stateSchema:SCHEMA+'.download-state',resultSchema:SCHEMA+'.download-result',
  toolPrefix:'duckdb_reconciliation',errorPrefix:'DUCKDB_RECONCILIATION',clientName:'starforge-duckdb-reconciliation',
  nestedFiles:true,readLease:false,validateExportId:exportId=>need(sha(exportId),'DUCKDB_RECONCILIATION_EXPORT_ID_REQUIRED'),
  describe:manifest=>({workspaceId,reportId:manifest.report_id,queryCount:manifest.queries.length,sourceCount:manifest.sources.length})});
 const api={
  workspace,workspaceId,endpoint:transport.endpoint,
  status:()=>call('reconcile-status'),
  review:definition=>call('reconcile-review',{definition}),
  normalizationPreview:(definition,options)=>call('reconcile-normalization-preview',{definition,...options}),
  pairs:options=>call('reconcile-pairs',options),
  pair:(pair_id,revision)=>call('reconcile-pair',{pair_id,...(revision===undefined?{}:{revision})}),
  savePair:request=>call('reconcile-save-pair',request),
  runs:options=>call('reconcile-runs',options),
  run:run_id=>call('reconcile-run',{run_id}),
  execute:request=>call('reconcile-execute',request),
  groups:(run_id,options={})=>call('reconcile-groups',{run_id,...options}),
  rows:(run_id,options={})=>call('reconcile-rows',{run_id,...options}),
  fields:(run_id,options={})=>call('reconcile-fields',{run_id,...options}),
  normalizations:(run_id,options={})=>call('reconcile-normalizations',{run_id,...options}),
  row:(run_id,side,row)=>call('reconcile-row',{run_id,side,row}),
  decisions:(run_id,options={})=>call('reconcile-decisions',{run_id,...options}),
  decide:request=>call('reconcile-decide',request),
  reports:options=>call('reconcile-reports',options),
  report:report_id=>call('reconcile-report',{report_id}),
  saveReport:request=>call('reconcile-save-report',request),
  changes:(report_id,options={})=>call('reconcile-changes',{report_id,...options}),
  operations:options=>call('reconcile-operations',options),
  request:request_id=>call('reconcile-request',{request_id}),
  resume:request_id=>call('reconcile-resume',{request_id}),
  exportReport:request=>call('reconcile-export',request),
  exportRequest:request_id=>call('operation',{request_id}),
  resumeExport:request_id=>call('resume',{request_id}),
  inspectExport:exportId=>tracked(()=>receiver.inspect({client:fileClient,exportId,signal:combined})),
  download:({exportId,directory,expectedManifestSha256,chunkSize=65536,onProgress,signal:downloadSignal}={})=>tracked(()=>{
   need(Number.isSafeInteger(chunkSize)&&chunkSize>=1&&chunkSize<=65536,'DUCKDB_RECONCILIATION_CHUNK_SIZE_INVALID');
   return receiver.download({client:fileClient,exportId,directory,expectedManifestSha256,chunkSize,onProgress,
    signal:downloadSignal?AbortSignal.any([combined,downloadSignal]):combined});}),
  close(){
   if(closing)return closing;closed=true;controller.abort();
   closing=Promise.allSettled([...pending]).then(()=>{});return closing;
  }
 };
 return Object.freeze(api);
}
