// SPDX-License-Identifier: MIT
// Typed intake and full report receiving over the existing native buyer client.
import {createHash} from 'node:crypto';
import {openMerchantFileClient,createRetainedDownload} from '../mcp-merchant-operator/retained-download.mjs';
import {openDuckDBReconciliationClient} from './duckdb-reconciliation-client.mjs';

const SCHEMA='stellar-forge.duckdb-timescale-intake.v1';
const TOOL='sf43_discover_review_and_pay';
const MAX_REPORT=256000000,MAX_MANIFEST=2*1024*1024;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const id=x=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function fail(code){const error=new Error(code);error.code=code;throw error;}
const need=(value,code)=>{if(!value)fail(code);};

/** Parse the original retained receiving manifest; do not create delivery semantics. */
export function parseTimescaleIntakeManifest(bytes,reportId){
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
 catch{fail('DUCKDB_TIMESCALE_MANIFEST_INVALID');}
 need(bytes.length<=MAX_MANIFEST&&plain(value)&&value.schema===SCHEMA+'.download-manifest'&&
  value.complete===true&&value.source_format==='TIMESCALE_COMMISSIONING'&&
  value.report_id===reportId&&sha(reportId)&&id(value.workspace_id)&&
  typeof value.filename==='string'&&value.filename.length>0&&Array.isArray(value.files)&&value.files.length===2,
  'DUCKDB_TIMESCALE_MANIFEST_INVALID');
 const names=new Set();
 for(const file of value.files){
  need(plain(file)&&['original-commissioning.json','TIMESCALE_INTAKE.md'].includes(file.name)&&
   !names.has(file.name)&&Number.isSafeInteger(file.bytes)&&file.bytes>0&&
   file.bytes<=(file.name==='original-commissioning.json'?MAX_REPORT:MAX_MANIFEST)&&sha(file.sha256),
   'DUCKDB_TIMESCALE_MANIFEST_INVALID');
  if(file.name==='original-commissioning.json')need(file.sha256===reportId,'DUCKDB_TIMESCALE_MANIFEST_INVALID');
  names.add(file.name);
 }
 return value;
}

/**
 * @param {import('./duckdb-timescale-client.mjs').ClientOptions} options
 * One existing MCP transport and one separately owned Python service.
 * This client closes only its own pending calls and borrowed reconciliation client.
 */
export async function openDuckDBTimescaleClient({url,client:provided,workspace,expectedWorkspaceId,
 tokenEnv='MCP_ACCESS_TOKEN',environment=process.env,signal}={}){
 need(typeof workspace==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(workspace),'DUCKDB_TIMESCALE_ALIAS_REQUIRED');
 need(expectedWorkspaceId===undefined||id(expectedWorkspaceId),'DUCKDB_TIMESCALE_WORKSPACE_ID_REQUIRED');
 need(!(provided&&url),'DUCKDB_TIMESCALE_ONE_CLIENT_REQUIRED');
 const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 const transport=provided??await openMerchantFileClient({url,tokenEnv,environment,signal:combined,
  errorPrefix:'DUCKDB_TIMESCALE',clientName:'starforge-duckdb-timescale',maximumResponseBytes:2*1024*1024});
 need(plain(transport)&&typeof transport.call==='function'&&typeof transport.endpoint==='string'&&transport.endpoint.length>0,
  'DUCKDB_TIMESCALE_CLIENT_REQUIRED');
 let closed=false,closing,reconciliation=null,workspaceId=expectedWorkspaceId;
 const pending=new Set(),manifests=new Map();
 function tracked(action){
  need(!closed,'DUCKDB_TIMESCALE_CLIENT_CLOSED');
  const running=Promise.resolve().then(action);pending.add(running);
  running.finally(()=>pending.delete(running)).catch(()=>{});return running;
 }
 async function native(operation,body={}){
  combined.throwIfAborted();
  const reply=await transport.call(TOOL,{action:'duckdb',duckdbWorkspace:workspace,
   duckdbOperation:operation,duckdbRequest:body},{requestSignal:combined});
  need(reply?.schema==='stellar-forge.mcp-native-duckdb.v1'&&reply.duckdbWorkspace===workspace&&
   reply.operation===operation&&plain(reply.result),'DUCKDB_TIMESCALE_REPLY_CHANGED');
  return reply.result;
 }
 let initial;
 try{
  initial=await native('timescale-intake-status');
  need(initial.schema===SCHEMA&&id(initial.workspace_id)&&
   (workspaceId===undefined||workspaceId===initial.workspace_id),'DUCKDB_TIMESCALE_WORKSPACE_CHANGED');
  workspaceId=initial.workspace_id;
  reconciliation=await openDuckDBReconciliationClient({client:transport,workspace,
   expectedWorkspaceId:workspaceId,signal:combined});
 }catch(error){controller.abort();await reconciliation?.close();throw error;}
 const call=(operation,body)=>tracked(()=>native('timescale-intake-'+operation,body));
 async function manifest(reportId){
  need(sha(reportId),'DUCKDB_TIMESCALE_REPORT_ID_REQUIRED');
  let value=manifests.get(reportId);
  if(!value){
   value=await native('timescale-intake-manifest',{report_id:reportId});
   need(value.schema===SCHEMA&&value.report_id===reportId&&value.workspace_id===workspaceId&&
    plain(value.manifest_file)&&value.manifest_file.name==='intake-receiving.json'&&
    Number.isSafeInteger(value.manifest_file.bytes)&&value.manifest_file.bytes>0&&
    value.manifest_file.bytes<=MAX_MANIFEST&&sha(value.manifest_file.sha256),'DUCKDB_TIMESCALE_MANIFEST_CHANGED');
   manifests.set(reportId,value);
  }
  return value;
 }
 const fileClient={endpoint:transport.endpoint+'#duckdb-timescale='+encodeURIComponent(workspace)+':'+workspaceId,
  async call(tool,args){
   combined.throwIfAborted();
   const original=await manifest(args.exportId),descriptor=original.manifest_file;
   if(tool==='duckdb_timescale_intake_manifest')return {state:'MANIFEST_RETAINED',exportId:args.exportId,manifestFile:descriptor};
   need(tool==='duckdb_timescale_intake_file'&&args.expectedManifestSha256===descriptor.sha256&&
    Number.isSafeInteger(args.offset)&&args.offset>=0&&Number.isSafeInteger(args.limit)&&args.limit>0&&
    args.limit<=65536&&args.readId===undefined,'DUCKDB_TIMESCALE_RANGE_INVALID');
   const file=args.file==='intake-receiving.json'?descriptor:original.manifest?.files.find(file=>file.name===args.file);
   need(file&&file.sha256===args.expectedSha256,'DUCKDB_TIMESCALE_FILE_CHANGED');
   const reply=await native('timescale-intake-file',{report_id:args.exportId,filename:args.file,sha256:file.sha256,
    byteOffset:args.offset,maxBytes:args.limit}),chunk=reply.file;
   need(reply.workspaceId===workspaceId&&reply.reportId===args.exportId&&reply.filename===args.file&&
    chunk?.verifiedRetainedFile===true&&chunk.transport==='original-authenticated-http-range'&&
    chunk.bytes===file.bytes&&chunk.sha256===file.sha256&&chunk.byteOffset===args.offset,
    'DUCKDB_TIMESCALE_FILE_CHANGED');
   return {exportId:args.exportId,manifestSha256:descriptor.sha256,file,offset:chunk.byteOffset,
    bytesRead:chunk.returnedBytes,nextOffset:chunk.nextByteOffset,encoding:chunk.encoding,data:chunk.data};
  }};
 const receiver=createRetainedDownload({manifestName:'intake-receiving.json',
  parseManifest:(bytes,reportId)=>{
   const value=parseTimescaleIntakeManifest(bytes,reportId),original=manifests.get(reportId);
   need(value.workspace_id===workspaceId&&original&&digest(bytes)===original.manifest_file.sha256,
    'DUCKDB_TIMESCALE_MANIFEST_CHANGED');
   original.manifest=value;return value;
  },maximumBytes:MAX_REPORT,maximumManifestBytes:MAX_MANIFEST,maximumCheckpointBytes:1024*1024,
  stateSchema:SCHEMA+'.download-state',resultSchema:SCHEMA+'.download-result',
  toolPrefix:'duckdb_timescale_intake',errorPrefix:'DUCKDB_TIMESCALE',clientName:'starforge-duckdb-timescale',
  nestedFiles:false,readLease:false,validateExportId:value=>need(sha(value),'DUCKDB_TIMESCALE_REPORT_ID_REQUIRED'),
  describe:value=>({workspaceId,reportId:value.report_id,originalFilename:value.filename,sourceFormat:value.source_format})});
 return Object.freeze({
  workspace,workspaceId,endpoint:transport.endpoint,reconciliation,
  status:()=>call('status'),
  registeredReports:options=>call('registered-reports',options),
  reports:options=>call('reports',options),
  report:report_id=>call('report',{report_id}),
  source:(report_id,source_id,options={})=>call('source',{report_id,source_id,...options}),
  retain:request=>call('retain',request),
  review:request=>call('review',request),
  import:request=>call('import',request),
  reviews:options=>call('reviews',options),
  operations:options=>call('operations',options),
  request:request_id=>call('request',{request_id}),
  resume:request_id=>call('resume',{request_id}),
  reviewPair:definition=>call('pair-review',{definition}),
  savePair:request=>call('save-pair',request),
  inspectReport:reportId=>tracked(()=>receiver.inspect({client:fileClient,exportId:reportId,signal:combined})),
  downloadReport:({reportId,directory,expectedManifestSha256,chunkSize=65536,onProgress,signal:downloadSignal}={})=>tracked(()=>{
   need(Number.isSafeInteger(chunkSize)&&chunkSize>=1&&chunkSize<=65536,'DUCKDB_TIMESCALE_CHUNK_SIZE_INVALID');
   return receiver.download({client:fileClient,exportId:reportId,directory,expectedManifestSha256,chunkSize,onProgress,
    signal:downloadSignal?AbortSignal.any([combined,downloadSignal]):combined});
  }),
  close(){
   if(closing)return closing;closed=true;controller.abort();
   closing=Promise.allSettled([...pending,reconciliation.close()]).then(()=>{});return closing;
  }
 });
}
