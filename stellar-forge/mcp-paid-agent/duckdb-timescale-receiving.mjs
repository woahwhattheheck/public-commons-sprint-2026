#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Original commissioning file -> visible intake -> paired reports -> full receiving.
import {createHash,randomBytes} from 'node:crypto';
import {readFile,mkdir,lstat,open,rename,unlink,realpath} from 'node:fs/promises';
import {basename,join,resolve,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openNativeWorkspace} from './native-workspace.mjs';
import {startMcpWorkspace} from './serve.mjs';
import {openDuckDBTimescaleClient} from './duckdb-timescale-client.mjs';
import {openMerchantFileClient} from '../mcp-merchant-operator/retained-download.mjs';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {runTimescaleIntakeBrowserReceiving} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/stellar_forge_buyer/timescale_intake/browser-receiving.mjs';
import {runReconciliationBrowserReceiving} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/stellar_forge_buyer/reconciliation/browser-receiving.mjs';

const SCHEMA='stellar-forge.duckdb-timescale-intake.agent-receiving.v1';
const TOOL='sf43_discover_review_and_pay',HASH=/^[a-f0-9]{64}$/,ID=/^[a-f0-9]{32}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
function need(value,code){if(!value)throw Object.assign(new Error(code),{code:'TIMESCALE_RECEIVING_'+code});}
function absolute(value){
 need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&!value.includes('\0'),'CANONICAL_PATH_REQUIRED');
 return value;
}
function stable(value){
 if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
 if(plain(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
 const result=JSON.stringify(value);need(result!==undefined,'COMPLETE_JSON_REQUIRED');return result;
}
async function json(file,maximum=32*1024*1024){
 const info=await lstat(file);
 need(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1&&!(info.mode&0o077)&&info.size<=maximum,'PRIVATE_FILE_REQUIRED');
 const bytes=await readFile(file);
 need(bytes.length===info.size,'RECORD_CHANGED');
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
async function privateDirectory(directory){
 await mkdir(directory,{recursive:true,mode:0o700});const info=await lstat(directory);
 need(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&await realpath(directory)===directory,
  'PRIVATE_DIRECTORY_REQUIRED');
}
async function syncDirectory(directory){const file=await open(directory,'r');try{await file.sync();}finally{await file.close();}}
const requestId=(input,label)=>sha(input.operation_id+'\0'+input.workspace_id+'\0'+label).slice(0,32);

export async function runDuckDBTimescaleReceiving({input,playwright,chromium}={}){
 need(plain(input)&&typeof input.operation_id==='string'&&input.operation_id.length>0&&
  /^[a-f0-9]{40}$/.test(input.source_commit??'')&&ID.test(input.workspace_id??'')&&
  plain(input.report)&&HASH.test(input.report.sha256??'')&&plain(input.baseline)&&plain(input.observed)&&
  plain(input.pair)&&typeof input.actor==='string'&&input.actor.trim()&&
  typeof input.reason==='string'&&input.reason.trim(),'ORIGINAL_INPUT_REQUIRED');
 need(input.report.filename===basename(absolute(input.report.path)),'ORIGINAL_FILENAME_CHANGED');
 const root=absolute(input.output_directory),launchFile=absolute(input.launch_file);
 const recordPath=join(root,'result.json'),temporary=join(root,'result.next');
 const binding={operation_id:input.operation_id,source_commit:input.source_commit,workspace_id:input.workspace_id,
  workspace:absolute(input.workspace),native_workspace:absolute(input.native_workspace),
  source_root:absolute(input.source_root),report:input.report,baseline:input.baseline,observed:input.observed,
  pair:input.pair,actor:input.actor,reason:input.reason};
 for(const selection of [binding.baseline,binding.observed])
  need(Array.isArray(selection.keys)&&selection.keys.length===0,'DUPLICATE_PRESERVING_IMPORT_REQUIRED');
 const alias='timescale_'+requestId(input,'alias').slice(0,24),sourceAlias='report_'+input.report.sha256.slice(0,24);
 const token=randomBytes(32).toString('hex');
 const environment={...process.env,MCP_ACCESS_TOKEN:token,MCP_OAUTH_CONFIG:undefined,MCP_OPERATOR_MODULE:undefined};
 let state,native,host,transport,client,closingHost,failure,previouslyComplete=false;
 async function save(){
  lease.assertHeld();
  await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  const file=await open(temporary,'wx',0o600);
  try{await file.writeFile(JSON.stringify(state,null,2)+'\n');await file.sync();}finally{await file.close();}
  lease.assertHeld();await rename(temporary,recordPath);await syncDirectory(root);
 }
 async function phase(name,result){state.phases.push({name,at:new Date().toISOString(),result});await save();}
 async function stopHost(){
  if(closingHost)return closingHost;
  closingHost=(async()=>{
   try{await client?.close();}finally{
    client=undefined;transport=undefined;
    if(host){const owned=host,original=native;host=undefined;native=undefined;
     try{await owned.close();}finally{await original?.close();}}
    else if(native){const owned=native;native=undefined;await owned.close();}
   }
  })();
  return closingHost;
 }
 async function nativeCall(operation,body={}){
  const reply=await transport.call(TOOL,{action:'duckdb',duckdbWorkspace:alias,
   duckdbOperation:operation,duckdbRequest:body});
  need(reply?.schema==='stellar-forge.mcp-native-duckdb.v1'&&reply.duckdbWorkspace===alias&&
   reply.operation===operation&&plain(reply.result),'ORIGINAL_REPLY_CHANGED');
  return reply.result;
 }
 async function startHost(){
  closingHost=undefined;
  native=await openNativeWorkspace(binding.native_workspace);
  const catalog=await native.call({action:'duckdb',duckdbOperation:'workspaces',duckdbRequest:{}});
  need(catalog?.schema==='stellar-forge.mcp-native-duckdb.v1'&&Array.isArray(catalog.result?.workspaces),
   'ORIGINAL_REGISTRY_REQUIRED');
  const existing=catalog.result.workspaces.find(record=>record.name===alias);
  if(existing){
   need(existing.workspaceId===binding.workspace_id,'WORKSPACE_CHANGED');
   // This is our existing immutable host registration. Reopen its binding
   // without requiring an already-retained source file to remain at its old path.
   const retained=await json(join(binding.native_workspace,'duckdb','workspaces',alias+'.json'),1024*1024);
   need(retained.name===alias&&retained.database===binding.workspace&&retained.workspaceId===binding.workspace_id&&
    retained.nativeWorkspace===binding.native_workspace&&Array.isArray(retained.sources)&&!retained.sources.length&&
    Array.isArray(retained.timescaleReports)&&retained.timescaleReports.length===1,'REGISTRATION_CHANGED');
   const original=retained.timescaleReports[0];
   need(original.name===sourceAlias&&original.reportPath===binding.report.path&&
    original.filename===binding.report.filename&&original.sha256===binding.report.sha256,'REGISTERED_REPORT_CHANGED');
  }else{
   const registered=await native.registerDuckDB({name:alias,database:binding.workspace,sources:[],
    timescaleReports:[{name:sourceAlias,reportPath:binding.report.path,sha256:binding.report.sha256}]},
    {expectedWorkspaceId:binding.workspace_id});
   need(registered.workspaceId===binding.workspace_id&&registered.timescaleReports?.length===1&&
    registered.timescaleReports[0].sha256===binding.report.sha256,'REGISTERED_REPORT_CHANGED');
  }
  const owned=native;let originalClose;
  const closeNative=()=>originalClose??=owned.close();
  const manifest=native.manifest;
  host=await startMcpWorkspace({environment:{...environment,BAZAAR_DISCOVERY_URL:manifest.catalog.origin,
   PAID_RESOURCE_ORIGINS:manifest.route.origin,MCP_STATE_DIR:join(manifest.directory,'quotes'),
   MCP_PORT:String(state.mcp_port??0)},operatorAdapter:{
    agentCommerce:(args,context)=>owned.call(args,context),approve:async()=>false,
    signPayment:async()=>{throw Object.assign(new Error('NATIVE_TOOL_REQUIRED'),{code:'NATIVE_TOOL_REQUIRED'});},
    close:closeNative}});
  state.mcp_port=Number(new URL(host.address).port);await save();
  transport=await openMerchantFileClient({url:host.address+'/mcp',environment,
   errorPrefix:'TIMESCALE_RECEIVING',maximumResponseBytes:2*1024*1024});
  client=await openDuckDBTimescaleClient({client:transport,workspace:alias,expectedWorkspaceId:binding.workspace_id});
  const reports=await client.registeredReports({offset:0,limit:100});
  need(reports.total===1&&reports.reports[0]?.name===sourceAlias&&
   reports.reports[0].sha256===binding.report.sha256,'REGISTERED_REPORT_CHANGED');
 }
 async function sourceProof(sourceId,role){
  const first=await client.source(binding.report.sha256,sourceId,{offset:0,limit:25});
  need(first.source_id===sourceId&&first.report_id===binding.report.sha256&&first.descriptor?.role===role&&
   first.descriptor.rows===first.source_rows&&first.total===first.source_rows&&Array.isArray(first.columns),
   'SOURCE_BINDING_CHANGED');
  const columns=first.columns,names=columns.map(column=>column.name),descriptor=first.descriptor;
  const checksum=createHash('sha256');checksum.update('{"names":'+JSON.stringify(names)+',"rows":[');
  let page=first,count=0,offset=0,pages=0;
  for(;;){
   need(page.offset===offset&&page.total===first.total&&page.source_rows===first.source_rows&&
    stable(page.columns)===stable(columns)&&stable(page.descriptor)===stable(descriptor)&&
    Array.isArray(page.rows)&&page.rows.length===Math.min(page.limit,page.total-offset),'SOURCE_PAGE_CHANGED');
   for(const row of page.rows){
    need(Array.isArray(row)&&row.length===names.length&&row.every(value=>value===null||typeof value==='string'),
     'NATIVE_TEXT_OR_NULL_REQUIRED');
    if(count)checksum.update(',');checksum.update(JSON.stringify(row));count++;
   }
   pages++;
   if(page.next_offset===null)break;
   need(page.next_offset===count&&page.next_offset>offset,'SOURCE_CURSOR_CHANGED');
   offset=page.next_offset;page=await client.source(binding.report.sha256,sourceId,{offset,limit:25});
  }
  checksum.update(']}');
  need(count===descriptor.rows&&checksum.digest('hex')===descriptor.tableDigest,'COMPLETE_NATIVE_TABLE_CHANGED');
  return {source_id:sourceId,role,rows:count,pages,table_name:descriptor.tableName,
   table_digest:descriptor.tableDigest,filename:descriptor.filename,bytes:descriptor.bytes,
   sha256:descriptor.sha256,columns,provider_completeness:descriptor.provider_completeness};
 }
 async function validateImported(role,selection,editionId){
  const edition=await nativeCall('edition',{edition_id:editionId});
  need(edition.edition_id===editionId&&edition.review_id===editionId,'ORIGINAL_EDITION_CHANGED');
  const review=await nativeCall('review-read',{review_id:editionId});
  need(review.review_id===editionId&&review.manifest_sha256===edition.manifest_sha256&&
   stable(review.columns)===stable(edition.columns)&&stable(review.keys)===stable(edition.keys)&&
   review.row_count===edition.row_count&&stable(review.timescale_source)===stable(edition.timescale_source),
   'REVIEW_EDITION_BINDING_CHANGED');
  const source=edition.timescale_source,descriptor=source?.descriptor;
  need(source?.report_id===binding.report.sha256&&source.source_id===selection.source_id&&source.role===role&&
   descriptor?.schema==='stellar-forge.duckdb-timescale-intake.v1.source'&&
   descriptor.workspace_id===binding.workspace_id&&descriptor.report_id===binding.report.sha256&&
   descriptor.source_id===selection.source_id&&descriptor.report_filename===binding.report.filename,
   'IMPORTED_NATIVE_SOURCE_CHANGED');
  return {edition_id:editionId,review_id:review.review_id,manifest_sha256:edition.manifest_sha256,
   row_count:edition.row_count,columns:edition.columns,keys:edition.keys,timescale_source:source};
 }
 async function reopenIntakeRequests(){
  const records={};
  for(const key of ['retain','baseline_review','baseline_import','observed_review','observed_import']){
   const identity=state.intake.request_ids[key];need(ID.test(identity??''),'ORIGINAL_REQUEST_ID_REQUIRED');
   const original=await client.request(identity);
   need(original.state==='COMPLETE'&&original.body.workspace_id===binding.workspace_id,'ORIGINAL_REQUEST_INCOMPLETE');
   const returned=await client.resume(identity);
   // COMPLETE returns the saved native result, without dispatching the work again.
   need(stable(returned)===stable(original.result),'ORIGINAL_REQUEST_REOPEN_CHANGED');
   records[key]={request_id:identity,kind:original.kind,state:original.state};
  }
  const retained=await client.retain({request_id:state.intake.request_ids.retain,source:sourceAlias,sha256:binding.report.sha256});
  need(retained.report_id===binding.report.sha256&&retained.filename===binding.report.filename,'ORIGINAL_RETAIN_CHANGED');
  return records;
 }
 async function receiveOriginalReport(){
  const wasReceived=Boolean(state.report_download);
  const inspected=await client.inspectReport(binding.report.sha256);
  need(inspected.manifest.report_id===binding.report.sha256&&inspected.manifest.workspace_id===binding.workspace_id,
   'REPORT_RECEIVING_MANIFEST_CHANGED');
  const original=inspected.manifest.files.find(file=>file.name==='original-commissioning.json');
  need(original&&original.sha256===binding.report.sha256&&original.bytes>1,'WHOLE_ORIGINAL_REPORT_REQUIRED');
  state.original_manifest_sha256??=inspected.manifestSha256;
  need(state.original_manifest_sha256===inspected.manifestSha256,'REPORT_RECEIVING_MANIFEST_CHANGED');await save();
  const options={reportId:binding.report.sha256,directory:join(root,'received-original'),
   expectedManifestSha256:state.original_manifest_sha256,chunkSize:Math.min(65536,Math.max(1,Math.floor(original.bytes/3)))};
  if(!state.report_download){
   if(!state.report_pause){
    const interruption=new AbortController();let paused=false;
    try{
     const completed=await client.downloadReport({...options,signal:interruption.signal,
      onProgress:async progress=>{
       if(progress.file==='original-commissioning.json'&&progress.bytes>0&&progress.bytes<progress.total){
        state.report_pause={file:progress.file,bytes:progress.bytes,total:progress.total,at:new Date().toISOString()};
        await save();paused=true;interruption.abort();
       }
      }});
     // A response-lost complete transfer may already be retained. Its exact
     // original helper result remains usable; do not create another download.
     if(completed?.state==='COMPLETE'){state.report_download=completed;await save();}
    }catch(error){if(!paused||!interruption.signal.aborted)throw error;}
    if(paused){
     await phase('original_report_download_interrupted',state.report_pause);
     await stopHost();await phase('original_mcp_owner_closed',{closed:true});
     await startHost();await phase('same_mcp_owner_reopened',{workspace_id:binding.workspace_id,port:state.mcp_port});
    }
   }
   if(!state.report_download){
    state.report_download=await client.downloadReport(options);
    need(state.report_download.state==='COMPLETE'&&state.report_download.resumed===true&&
     state.report_download.resumedBytes>=state.report_pause.bytes,'REPORT_RANGE_RESUME_INCOMPLETE');await save();
   }
   await phase('whole_original_report_and_guide_received',state.report_download);
  }
  if(wasReceived){
   const reopened=await client.downloadReport(options);
   need(reopened.state==='COMPLETE','ORIGINAL_REPORT_REOPEN_INCOMPLETE');
  }
  const bytes=await readFile(join(root,'received-original','original-commissioning.json'));
  need(bytes.length===original.bytes&&sha(bytes)===binding.report.sha256,'RECEIVED_ORIGINAL_REPORT_CHANGED');
 }
 async function receiveCustomerExport(){
  const wasReceived=Boolean(state.download);
  const inspected=await client.reconciliation.inspectExport(state.browser.export_id);
  need(inspected.manifest.report_id===state.browser.report_id&&inspected.manifest.workspace_id===binding.workspace_id&&
   inspected.manifestSha256===state.browser.manifest_sha256,'ORIGINAL_EXPORT_CHANGED');
  state.export_id=state.browser.export_id;state.report_id=state.browser.report_id;
  state.manifest_sha256=inspected.manifestSha256;await save();
  const options={exportId:state.export_id,directory:join(root,'received'),
   expectedManifestSha256:state.manifest_sha256,chunkSize:65536};
  if(!state.download){
   if(!state.warehouse_pause){
    const interruption=new AbortController();let paused=false;
    try{
     const completed=await client.reconciliation.download({...options,signal:interruption.signal,
      onProgress:async progress=>{
       if(progress.file==='warehouse/warehouse.duckdb'&&progress.bytes>0&&progress.bytes<progress.total){
        state.warehouse_pause={file:progress.file,bytes:progress.bytes,total:progress.total,at:new Date().toISOString()};
        await save();paused=true;interruption.abort();
       }
      }});
     if(completed?.state==='COMPLETE'){state.download=completed;await save();}
    }catch(error){if(!paused||!interruption.signal.aborted)throw error;}
    if(paused){
     await phase('customer_warehouse_download_interrupted',state.warehouse_pause);
     await stopHost();await phase('customer_mcp_owner_closed',{closed:true});
     await startHost();await phase('customer_mcp_owner_reopened',{workspace_id:binding.workspace_id,port:state.mcp_port});
    }
   }
   if(!state.download){
    state.download=await client.reconciliation.download(options);
    need(state.download.state==='COMPLETE'&&state.download.resumed===true&&
     state.download.resumedBytes>=state.warehouse_pause.bytes,'WAREHOUSE_RANGE_RESUME_INCOMPLETE');await save();
   }
   await phase('complete_original_customer_package_received',state.download);
  }
  if(wasReceived){
   const reopened=await client.reconciliation.download(options);
   need(reopened.state==='COMPLETE','ORIGINAL_CUSTOMER_REOPEN_INCOMPLETE');
  }
 }
 await privateDirectory(root);
 const lease=await acquireStateLease(root);
 try{
  try{state=await json(recordPath);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(state)need(state.schema===SCHEMA&&stable(state.binding)===stable(binding),'ORIGINAL_RECEIVING_BINDING_CHANGED');
  state??={schema:SCHEMA,binding,workspace_id:binding.workspace_id,created_at:new Date().toISOString(),phases:[]};
  previouslyComplete=state.complete===true;
  await save();await startHost();
  if(state.complete){
   const report=await client.reconciliation.report(state.report_id);
   need(report.report_id===state.report_id,'ORIGINAL_REPORT_CHANGED');
   await receiveOriginalReport();await receiveCustomerExport();await stopHost();
   return {...state,reused:true};
  }
  if(!state.intake){
   const launch=await json(launchFile,65536);
   need(launch.workspace_id===binding.workspace_id&&launch.directory===binding.workspace,'ORIGINAL_BROWSER_CHANGED');
   state.intake=await runTimescaleIntakeBrowserReceiving({url:launch.url,
    input:{operation_id:input.operation_id,source_commit:input.source_commit,workspace_id:binding.workspace_id,
     report:binding.report,baseline:binding.baseline,observed:binding.observed,pair:binding.pair,
     actor:binding.actor,reason:binding.reason},
    outputDirectory:join(root,'intake-browser'),playwright,chromium});
   need(state.intake.complete===true&&state.intake.report_id===binding.report.sha256&&
    HASH.test(state.intake.baseline_edition??'')&&HASH.test(state.intake.observed_edition??'')&&
    HASH.test(state.intake.pair_id??'')&&plain(state.intake.definition)&&plain(state.intake.request_ids),
    'BROWSER_INTAKE_INCOMPLETE');
   await save();await phase('visible_report_mapping_and_immutable_editions',state.intake);
  }
  if(!state.sources){
   state.sources={baseline:await sourceProof(binding.baseline.source_id,'BASELINE'),
    observed:await sourceProof(binding.observed.source_id,'OBSERVED')};
   await save();await phase('every_original_native_source_row_checked',state.sources);
  }
  if(!state.editions){
   state.editions={baseline:await validateImported('BASELINE',binding.baseline,state.intake.baseline_edition),
    observed:await validateImported('OBSERVED',binding.observed,state.intake.observed_edition)};
   await save();await phase('original_review_edition_and_type_bindings',state.editions);
  }
  const originalPair=await client.reconciliation.pair(state.intake.pair_id);
  need(stable(originalPair.definition)===stable(state.intake.definition)&&
   originalPair.definition.source_edition===state.intake.baseline_edition&&
   originalPair.definition.target_edition===state.intake.observed_edition,'ORIGINAL_PAIR_CHANGED');
  state.pair_id=originalPair.pair_id;await save();
  await phase('original_intake_requests_reopened_by_agent',await reopenIntakeRequests());
  await receiveOriginalReport();
  if(!state.browser){
   const launch=await json(launchFile,65536);
   need(launch.workspace_id===binding.workspace_id&&launch.directory===binding.workspace,'ORIGINAL_BROWSER_CHANGED');
   state.browser=await runReconciliationBrowserReceiving({url:launch.url,
    input:{operation_id:input.operation_id,source_commit:input.source_commit,workspace_id:binding.workspace_id,
     definition:state.intake.definition,actor:binding.actor,reason:binding.reason},
    outputDirectory:join(root,'paired-browser'),playwright,chromium});
   need(state.browser.complete===true&&state.browser.pair_id===state.pair_id&&
    state.browser.request_ids.pair===state.intake.request_ids.pair,'ORIGINAL_PAIR_REQUEST_NOT_REUSED');
   await save();await phase('visible_full_reconciliation_decision_report_and_export',state.browser);
  }
  const report=await client.reconciliation.report(state.browser.report_id);
  need(report.summary?.accounting_balanced===true&&report.summary.source.total===state.sources.baseline.rows&&
   report.summary.target.total===state.sources.observed.rows,'COMPLETE_SOURCE_ACCOUNTING_CHANGED');
  await receiveCustomerExport();
  const repeated=await client.reconciliation.exportReport({
   request_id:state.browser.request_ids.export,report_id:state.report_id});
  need(repeated.export_id===state.export_id&&repeated.report_id===state.report_id,'ORIGINAL_EXPORT_REOPEN_CHANGED');
  const saved=await client.reconciliation.request(state.browser.request_ids.report);
  need(saved.state==='COMPLETE'&&saved.result.report_id===state.report_id,'ORIGINAL_REPORT_REQUEST_CHANGED');
  await phase('same_saved_report_and_native_export_reopened',{report_id:state.report_id,export_id:state.export_id,
   request_id:state.browser.request_ids.report});
  await stopHost();
  state.complete=true;state.completed_at=new Date().toISOString();state.all_owned_handles_closed=true;
  state.source_operations=0;state.purchases=0;await save();return state;
 }catch(error){
  failure=error;
  if(state){
   state.complete=previouslyComplete;state.last_error={code:error?.code??error?.name??'ERROR',at:new Date().toISOString()};
   try{await save();}catch{}
  }
  throw error;
 }finally{
  let cleanup;
  try{await stopHost();}catch(error){cleanup=error;}
  try{await lease.close();}catch(error){cleanup??=error;}
  if(!failure&&cleanup)throw cleanup;
 }
}
async function main(argv){
 need(argv.length===6,'ARGUMENTS_REQUIRED');
 const args={};
 for(let index=0;index<argv.length;index+=2){
  need(['--input','--playwright','--chromium'].includes(argv[index])&&!Object.hasOwn(args,argv[index]),'ARGUMENTS_REQUIRED');
  args[argv[index]]=absolute(argv[index+1]);
 }
 const loaded=await import(pathToFileURL(args['--playwright']).href);
 const result=await runDuckDBTimescaleReceiving({input:await json(args['--input'],2*1024*1024),
  playwright:loaded.default??loaded,chromium:args['--chromium']});
 process.stdout.write(JSON.stringify({complete:result.complete,workspace_id:result.workspace_id,
  report_id:result.report_id,export_id:result.export_id})+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main(process.argv.slice(2)).catch(error=>{
  process.stderr.write(JSON.stringify({error:error?.code??'TIMESCALE_RECEIVING_FAILED'})+'\n');process.exitCode=1;
 });
