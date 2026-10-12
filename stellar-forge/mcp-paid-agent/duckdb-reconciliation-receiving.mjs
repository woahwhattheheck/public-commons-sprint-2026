#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// One real original MCP/browser/customer continuation. No provider or payer call.
import {createHash,randomBytes} from 'node:crypto';
import {readFile,mkdir,stat,open,writeFile,rename,unlink,realpath} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openNativeWorkspace} from './native-workspace.mjs';
import {startMcpWorkspace} from './serve.mjs';
import {openDuckDBReconciliationClient} from './duckdb-reconciliation-client.mjs';
import {openMerchantFileClient} from '../mcp-merchant-operator/retained-download.mjs';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {runReconciliationBrowserReceiving} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/stellar_forge_buyer/reconciliation/browser-receiving.mjs';

const TOOL='sf43_discover_review_and_pay';
const sha=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function need(condition,code){if(!condition)throw Object.assign(new Error(code),{code});}
function absolute(value){need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&!value.includes('\0'),'RECONCILIATION_NATIVE_PATH_REQUIRED');return value;}
async function json(path,maximum=32*1024*1024){
 const bytes=await readFile(path);need(bytes.length<=maximum,'RECONCILIATION_NATIVE_RECORD_SIZE');
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
async function privateDirectory(path){
 await mkdir(path,{recursive:true,mode:0o700});const info=await stat(path);
 need(info.isDirectory()&&!(info.mode&0o077)&&await realpath(path)===path,'RECONCILIATION_NATIVE_PRIVATE_DIRECTORY_REQUIRED');
}
async function syncDirectory(path){const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}
function requestId(input,label){return sha(Buffer.from(input.operation_id+'\0'+input.workspace_id+'\0'+label)).slice(0,32);}

export async function runDuckDBReconciliationReceiving({input,playwright,chromium}){
 need(plain(input)&&/^[a-f0-9]{32}$/.test(input.workspace_id)&&/^[a-f0-9]{40}$/.test(input.source_commit)&&
  typeof input.operation_id==='string'&&plain(input.definition)&&plain(input.scenario),'RECONCILIATION_NATIVE_INPUT_REQUIRED');
 const root=absolute(input.output_directory);await privateDirectory(root);
 const lease=await acquireStateLease(root),recordPath=join(root,'result.json'),temporary=join(root,'result.next');
 let state,host,native,client,transport,closingHost;
 const token=randomBytes(32).toString('hex');
 const environment={...process.env,MCP_ACCESS_TOKEN:token,MCP_OAUTH_CONFIG:undefined,MCP_OPERATOR_MODULE:undefined};
 const alias='paired_'+requestId(input,'alias').slice(0,24);
 let failure;
 try{
  try{state=await json(recordPath);}catch(error){if(error.code!=='ENOENT')throw error;}
  const binding={operation_id:input.operation_id,source_commit:input.source_commit,workspace_id:input.workspace_id,
   workspace:absolute(input.workspace),native_workspace:absolute(input.native_workspace),
   definition:input.definition,scenario:input.scenario};
  if(state)need(JSON.stringify(state.binding)===JSON.stringify(binding),'RECONCILIATION_NATIVE_BINDING_CHANGED');
  state??={schema:'stellar-forge.duckdb-reconciliation-agent-receiving.v1',binding,workspace_id:input.workspace_id,
   created_at:new Date().toISOString(),phases:[],requests:{},results:{}};
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
     if(host){const owned=host;host=undefined;await owned.close();}
     else if(native){const owned=native;native=undefined;await owned.close();}
     native=undefined;
    }
   })();
   return closingHost;
  }
  async function startHost(){
   closingHost=undefined;
   native=await openNativeWorkspace(binding.native_workspace);
   const registration=await native.registerDuckDB({name:alias,database:binding.workspace,sources:[]},
      {expectedWorkspaceId:binding.workspace_id});
   need(registration.workspaceId===binding.workspace_id,'RECONCILIATION_NATIVE_WORKSPACE_CHANGED');
   const ownedNative=native;let nativeClosing;
   const closeNative=()=>nativeClosing??=ownedNative.close();
   const manifest=native.manifest;
   host=await startMcpWorkspace({environment:{...environment,
    BAZAAR_DISCOVERY_URL:manifest.catalog.origin,PAID_RESOURCE_ORIGINS:manifest.route.origin,
    MCP_STATE_DIR:join(manifest.directory,'quotes'),MCP_PORT:String(state.mcp_port??0)},
    operatorAdapter:{agentCommerce:(args,context)=>ownedNative.call(args,context),approve:async()=>false,
     signPayment:async()=>{throw Object.assign(new Error('NATIVE_TOOL_REQUIRED'),{code:'NATIVE_TOOL_REQUIRED'});},
     close:closeNative}});
   state.mcp_port=Number(new URL(host.address).port);
   await save();
   transport=await openMerchantFileClient({url:host.address+'/mcp',environment,
    errorPrefix:'RECONCILIATION_NATIVE',maximumResponseBytes:2*1024*1024});
   client=await openDuckDBReconciliationClient({client:transport,workspace:alias,expectedWorkspaceId:binding.workspace_id});
   return registration;
  }
  async function nativeCall(operation,body){
   const value=await transport.call(TOOL,{action:'duckdb',duckdbWorkspace:alias,duckdbOperation:operation,duckdbRequest:body});
   need(value?.duckdbWorkspace===alias&&value.operation===operation,'RECONCILIATION_NATIVE_REPLY_CHANGED');
   return value.result;
  }
  async function retained(label,body,action){
   const exact={...body,request_id:requestId(input,label)};
   const saved=state.requests[label];
   if(saved)need(JSON.stringify(saved)===JSON.stringify(exact),'RECONCILIATION_NATIVE_ORIGINAL_REQUEST_CHANGED');
   else{state.requests[label]=exact;await save();}
   if(Object.hasOwn(state.results,label))return state.results[label];
   // An explicit invocation resumes this same retained request, whose original
   // native writer handles response-loss reuse. Loading a browser never does so.
   const result=await action(exact);
   state.results[label]=result;await save();return result;
  }
  if(state.complete){
   await startHost();
   const original=await client.report(state.report_id);
   need(original.report_id===state.report_id,'RECONCILIATION_NATIVE_REPORT_CHANGED');
   await stopHost();
   return {...state,reused:true};
  }
  await save();
  await startHost();
  if(!state.browser){
   const launch=await json(absolute(input.launch_file),65536);
   need(launch.workspace_id===binding.workspace_id&&launch.directory===binding.workspace,'RECONCILIATION_NATIVE_BROWSER_CHANGED');
   state.browser=await runReconciliationBrowserReceiving({url:launch.url,
    input:{operation_id:input.operation_id,source_commit:input.source_commit,workspace_id:binding.workspace_id,
     definition:binding.definition,actor:input.actor,reason:input.reason},
    outputDirectory:join(root,'browser'),playwright,chromium});
   need(state.browser.complete===true&&/^[a-f0-9]{64}$/.test(state.browser.pair_id)&&
    /^[a-f0-9]{64}$/.test(state.browser.run_id)&&/^[a-f0-9]{64}$/.test(state.browser.report_id)&&
    /^[a-f0-9]{64}$/.test(state.browser.export_id),'RECONCILIATION_NATIVE_BROWSER_INCOMPLETE');
   await save();await phase('real_browser_workflow',state.browser);
  }
  state.baseline_report??=await client.report(state.browser.report_id);
  state.baseline_pair??=await client.pair(state.browser.pair_id,state.baseline_report.pair_revision);
  await save();
  let previousPair=state.baseline_pair,previousRun=state.browser.run_id,latest;
  for(const [index,label] of [[1,'A'],[2,'B']]){
   const definition=structuredClone(previousPair.definition);
   const column=definition.columns.find(column=>column.name===binding.scenario.column);
   need(column?.role==='value','RECONCILIATION_NATIVE_REAL_VALUE_COLUMN_REQUIRED');
   column.target_map=binding.scenario.target_values.map(original=>({original,
    canonical:original===binding.scenario.selected_original?'Reviewed mapping '+label+': '+original:original}));
   definition.notes=binding.definition.notes+'\nNative mapping scenario '+label+
    ': only this explicit reviewed VARCHAR interpretation changes. Original source/target data and customer meaning remain retained; this is not a plant discrepancy or customer acceptance.';
   const reviewed=await client.review(definition);
   const pair=await retained('pair-'+label,{expected_revision:previousPair.revision,definition,review_sha256:reviewed.review_sha256},
    body=>client.savePair(body));
   const run=await retained('run-'+label,{pair_id:pair.pair_id,expected_revision:pair.revision,definition_sha256:pair.definition_sha256},
    body=>client.execute(body));
   need(run.summary.accounting_balanced===true&&run.summary.source.total===state.baseline_report.summary.source.total&&
    run.summary.target.total===state.baseline_report.summary.target.total,'RECONCILIATION_NATIVE_ACCOUNTING_CHANGED');
   const differing=await client.groups(run.run_id,{offset:0,limit:100,category:'VALUE_DIFFERENCE'});
   need(differing.total>0&&differing.rows.length>0,'RECONCILIATION_NATIVE_MAPPING_DIFFERENCE_REQUIRED');
   const groupIndex=differing.columns.findIndex(column=>column.name==='group_id');
   const selected=differing.rows[0][groupIndex];
   const decision=await retained('decision-'+label,{run_id:run.run_id,expected_revision:run.review_revision,
    subject:{kind:'group',group_id:selected},outcome:index===1?'REQUIRES_CORRECTION':'ACCEPTED_DIFFERENCE',
    actor:input.actor??'Native receiving operator',
    reason:index===1?'Review this explicitly changed mapping interpretation; no source data defect is asserted.':
     'Accept this deliberately different mapping interpretation for the receiving demonstration only; original source records are unchanged.'},
    body=>client.decide(body));
   const report=await retained('report-'+label,{run_id:run.run_id,expected_revision:decision.run.review_revision,before_run_id:previousRun},
    body=>client.saveReport(body));
   const changes=await client.changes(report.report_id,{offset:0,limit:100});
   const changeIndex=changes.columns.findIndex(column=>column.name==='change');
   const contentIndex=changes.columns.findIndex(column=>column.name==='canonical_content_changed');
   const countIndex=changes.columns.findIndex(column=>column.name==='classification_or_counts_changed');
   need(changes.rows.some(row=>row[changeIndex]==='CHANGED'&&row[contentIndex]===true),
    'RECONCILIATION_NATIVE_CONTENT_CHANGE_MISSING');
   if(index===2)need(changes.rows.some(row=>row[changeIndex]==='CHANGED'&&row[contentIndex]===true&&row[countIndex]===false),
    'RECONCILIATION_NATIVE_SAME_COUNTS_CONTENT_CHANGE_MISSING');
   await phase('reviewed_mapping_'+label,{pair_id:pair.pair_id,pair_revision:pair.revision,run_id:run.run_id,
    report_id:report.report_id,summary:run.summary,changes});
   previousPair=pair;previousRun=run.run_id;latest=report;
  }
  state.pair_id=previousPair.pair_id;state.report_id=latest.report_id;
  await save();
  if(!state.recipe_revised){
   const original=latest.queries[0],current=await nativeCall('saved-query',{query_id:original.query_id});
   const sql=original.sql+'\n-- Later native recipe revision; immutable report keeps its original saved SQL.';
   if(current.revision===original.revision){
    state.recipe_revised=await nativeCall('save-query',{name:original.name,sql,parameters_text:original.parameters_text,
     expected_revision:original.revision});
   }else{
    need(current.revision===original.revision+1&&current.sql===sql&&current.parameters_text===original.parameters_text,
     'RECONCILIATION_NATIVE_RECIPE_CHANGED');
    state.recipe_revised=current;
   }
   await save();await phase('original_query_history_retained',{query_id:original.query_id,
    report_revision:original.revision,current_revision:state.recipe_revised.revision});
  }
  const exported=await retained('complete-report-export',{report_id:latest.report_id},body=>client.exportReport(body));
  need(exported.schema==='stellar-forge.duckdb-reconciliation.v1.export'&&exported.state==='COMPLETE'&&
   exported.report_id===latest.report_id&&exported.workspace_id===binding.workspace_id,'RECONCILIATION_NATIVE_EXPORT_CHANGED');
  state.export_id=exported.export_id;await save();
  const inspected=await client.inspectExport(exported.export_id);
  need(inspected.manifest.report_id===latest.report_id,'RECONCILIATION_NATIVE_MANIFEST_CHANGED');
  state.manifest_sha256=inspected.manifestSha256;await save();
  if(!state.download){
   if(!state.download_paused){
    const interruption=new AbortController();let actuallyPaused=false;
    try{
     await client.download({exportId:state.export_id,directory:join(root,'received'),
      expectedManifestSha256:state.manifest_sha256,chunkSize:65536,signal:interruption.signal,
      onProgress:async progress=>{
       if(progress.file==='warehouse/warehouse.duckdb'&&progress.bytes>0&&progress.bytes<progress.total){
        state.download_paused={file:progress.file,bytes:progress.bytes,total:progress.total,at:new Date().toISOString()};
        await save();actuallyPaused=true;interruption.abort();
       }
      }});
    }catch(error){if(!actuallyPaused||!interruption.signal.aborted)throw error;}
    need(actuallyPaused,'RECONCILIATION_NATIVE_INTERRUPTED_PREFIX_REQUIRED');
    await phase('exact_original_download_interrupted',state.download_paused);
    await stopHost();
    await phase('original_mcp_owner_closed',{closed:true});
    await startHost();
    await phase('same_mcp_owner_reopened',{workspace_id:binding.workspace_id,port:state.mcp_port});
   }
   state.download=await client.download({exportId:state.export_id,directory:join(root,'received'),
    expectedManifestSha256:state.manifest_sha256,chunkSize:65536});
   need(state.download.state==='COMPLETE'&&state.download.resumed===true&&
    state.download.resumedBytes>=state.download_paused.bytes,'RECONCILIATION_NATIVE_RESUME_INCOMPLETE');
   await save();await phase('all_original_files_received',state.download);
  }
  const repeated=await client.exportReport(state.requests['complete-report-export']);
  need(repeated.export_id===state.export_id,'RECONCILIATION_NATIVE_EXPORT_REPLAY_CHANGED');
  const recovered=await client.request(state.requests['report-B'].request_id);
  need(recovered.state==='COMPLETE'&&recovered.result.report_id===state.report_id,'RECONCILIATION_NATIVE_REQUEST_REOPEN_FAILED');
  await phase('same_report_and_export_reopened',{report_id:state.report_id,export_id:state.export_id,
   request_id:state.requests['report-B'].request_id});
  await stopHost();
  state.complete=true;state.completed_at=new Date().toISOString();state.all_owned_handles_closed=true;
  state.source_operations=0;state.purchases=0;await save();
  return state;
 }catch(error){
  failure=error;
  if(state){
   state.complete=false;state.last_error={code:error?.code??error?.name??'ERROR',at:new Date().toISOString()};
   try{
    const file=await open(temporary,'w',0o600);
    try{await file.writeFile(JSON.stringify(state,null,2)+'\n');await file.sync();}finally{await file.close();}
    await rename(temporary,recordPath);await syncDirectory(root);
   }catch{}
  }
  throw error;
 }finally{
  let cleanupFailure;
  try{await client?.close();}catch(error){cleanupFailure=error;}
  try{if(host)await host.close();else if(native)await native.close();}
  catch(error){cleanupFailure??=error;}
  try{await lease.close();}catch(error){cleanupFailure??=error;}
  if(!failure&&cleanupFailure)throw cleanupFailure;
 }
}
async function main(argv){
 need(argv.length===6,'RECONCILIATION_NATIVE_ARGUMENTS_REQUIRED');
 const args={};for(let i=0;i<argv.length;i+=2){
  need(['--input','--playwright','--chromium'].includes(argv[i])&&!Object.hasOwn(args,argv[i]),'RECONCILIATION_NATIVE_ARGUMENTS_REQUIRED');
  args[argv[i]]=absolute(argv[i+1]);
 }
 const imported=await import(pathToFileURL(args['--playwright']).href);
 const result=await runDuckDBReconciliationReceiving({input:await json(args['--input'],2*1024*1024),
  playwright:imported.default??imported,chromium:args['--chromium']});
 process.stdout.write(JSON.stringify({complete:result.complete,workspace_id:result.workspace_id,
  report_id:result.report_id,export_id:result.export_id})+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main(process.argv.slice(2)).catch(error=>{
  process.stderr.write(JSON.stringify({error:error?.code??'RECONCILIATION_NATIVE_RECEIVING_FAILED'})+'\n');process.exitCode=1;
 });
