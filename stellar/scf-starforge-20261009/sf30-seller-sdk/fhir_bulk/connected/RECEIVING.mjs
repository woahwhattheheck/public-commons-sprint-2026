#!/usr/bin/env node
// MIT. Receive the original acquired FHIR workspace through the maintained merchant host and browser.
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {absolute,privateDirectory,readJSON,saveJSON,digest,operationLease,need,now}
  from '../../../distribution/runtime-workspace/storage.mjs';
import {startMerchantMcp} from '../../../../../stellar-forge/mcp-merchant-operator/serve.mjs';
import {readFhirConfiguration,FhirConnection} from './connection.mjs';
import {readSourceFile,fileIdentity} from './files.mjs';
import {CONNECTION_SCHEMA,OPERATOR_SCHEMA,WORKSPACE_SCHEMA,SHA,UUID,canonical}
  from './contracts.mjs';
import {initializeFhirMerchant} from './setup.mjs';
import {openFhirMerchantClient,readFhirValue,downloadFhirExport,inspectFhirExport,reopenFhirExport}
  from './client.mjs';

const SCHEMA='stellar-forge.fhir-bulk-connected-receiving.v1';
const OPERATION='SCF-FHIR-BULK-CONNECTED-450E-20261012';
const HERE=dirname(fileURLToPath(import.meta.url)),FHIR=resolve(HERE,'..'),REPO=resolve(HERE,'../../../../..');
const CLI=join(FHIR,'cli.py'),options={};
for(let i=2;i<process.argv.length;i+=2){
  const flag=process.argv[i],value=process.argv[i+1];
  need(['--receiving','--out','--chromium','--credentials-file'].includes(flag) &&
    value && !value.startsWith('--') && !Object.hasOwn(options,flag),
  'FHIR_CONNECTED_RECEIVING_ARGUMENTS','Use --receiving ABS/OPERATED_FHIR_BULK.json --out ABS/PRIVATE_OUTPUT [--chromium ABS].');
  options[flag]=absolute(value);
}
for(const key of ['--receiving','--out'])need(options[key],'FHIR_CONNECTED_RECEIVING_ARGUMENT_REQUIRED',key);
need(Number(process.versions.node.split('.')[0])>=22,'FHIR_CONNECTED_NODE_REQUIRED','Use Node 22 or newer.');
const output=options['--out'];
await mkdir(output,{mode:0o700,recursive:true});await privateDirectory(output);
let lease;
let journal,merchant,client,browser,page,configuration;
const owners=[],browserErrors=[],pendingCaptures=new Set();
let captureFailure=null,writes=Promise.resolve();
const journalPath=join(output,'CONNECTED_JOURNEY.json');
const nativeBytes=await readSourceFile(options['--receiving'],{maxBytes:64*1024*1024});
const native=JSON.parse(nativeBytes.toString('utf8'));
need(native.operation==='SCF-FHIR-BULK-DATA-WORKBENCH-450E-20261012' &&
  typeof native.completedAt==='string' && typeof native.workspace==='string' &&
  new RegExp(UUID).test(native.workspaceId??'') &&
  ['sourceIds','buildIds','operationIds','exportIds'].every(key=>Array.isArray(native[key])&&native[key].length) &&
  ['baseSourceId','deltaSourceId','composedSourceId','planId','comparisonId','connectionId','discoveryId']
    .every(key=>new RegExp(SHA).test(native[key]??'')) &&
  Array.isArray(native.groupPageIds) && native.groupPageIds.length,
'FHIR_CONNECTED_COMPLETE_NATIVE_REQUIRED','Select the completed original acquisition, composition, build and receiving record.');
const originalDirectory=absolute(native.workspace);
const binding={receiving:options['--receiving'],receivingSha256:digest(nativeBytes),
  workspace:originalDirectory,workspaceId:native.workspaceId,sourceRoot:FHIR,
  credentialsFile:options['--credentials-file']??null};
const paths={original:originalDirectory,restored:join(output,'restored-workspace'),customer:join(output,'customer-workspace')};
async function checkpoint(){
  writes=writes.then(async()=>{journal.updatedAt=now();await saveJSON(journalPath,journal,true);});
  return writes;
}
async function privateJSON(name,value){
  const path=join(output,name);await saveJSON(path,value,true);
  return {file:path,...await fileIdentity(path,{maxBytes:64*1024*1024})};
}
async function sourceIdentities(){
  const relative=[
    ...['contracts.mjs','files.mjs','connection.mjs','catalog.mjs','runtime.mjs','provider.mjs','client.mjs',
      'client.d.mts','setup.mjs','cli.mjs','README.md','RECEIVING.mjs'].map(name=>'connected/'+name),
    'fhir_acquisition.py','fhir_source.py','fhir_runtime.py','fhir_workspace.py','fhir_server.py','cli.py',
    'catalogue.json','HTTP_API.md','README.md',
  ];
  const selected={};
  for(const name of relative)selected[name]=await fileIdentity(join(FHIR,name),{maxBytes:4*1024*1024});
  for(const name of ['stellar-forge/mcp-merchant-operator/serve.mjs',
    'stellar-forge/mcp-merchant-operator/retained-download.mjs',
    'stellar-forge/mcp-merchant-operator/retained-file-reads.mjs',
    'stellar-forge/mcp-merchant-operator/host-files.mjs',
    'stellar/scf-starforge-20261009/distribution/contributions/fhir-bulk.json'])
    selected['repository/'+name]=await fileIdentity(join(REPO,name),{maxBytes:4*1024*1024});
  return selected;
}
function same(left,right){return JSON.stringify(canonical(left))===JSON.stringify(canonical(right));}
async function initializeWorkspace(alias){
  const directory=paths[alias],marker=join(directory,'fhir','identity.json');
  try{return JSON.parse((await readSourceFile(marker,{privateFile:true,maxBytes:4096})).toString('utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  need(alias!=='original','FHIR_CONNECTED_ORIGINAL_REQUIRED');
  const python=process.env.SF30_FHIR_PYTHON??process.env.SF30_XML_PYTHON??
    process.env.CODEX_PRIMARY_RUNTIME_PYTHON??'python3';
  const child=spawn(python,['-B',CLI,'init','--workspace',directory],{
    stdio:['ignore','pipe','pipe'],env:{...process.env,SF30_FHIR_NODE:process.execPath,SF30_XML_NODE:process.execPath}});
  let stdout='',stderr='',overflow=false;
  child.stdout.on('data',bytes=>{stdout+=bytes.toString('utf8');if(Buffer.byteLength(stdout)>8*1024*1024){overflow=true;child.kill('SIGTERM');}});
  child.stderr.on('data',bytes=>{stderr=(stderr+bytes.toString('utf8')).slice(-65536);});
  const timer=setTimeout(()=>child.kill('SIGTERM'),60000);
  let exit;
  try{exit=await new Promise((accept,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>accept({code,signal}));});}
  finally{clearTimeout(timer);}
  const record=await privateJSON(alias+'-native-initialization.json',{exit,stdout,stderr,overflow});
  need(exit.code===0&&!overflow,'FHIR_CONNECTED_NATIVE_INIT_FAILED',record.file);
  const result=JSON.parse((await readSourceFile(marker,{privateFile:true,maxBytes:4096})).toString('utf8'));
  need(result.schema===WORKSPACE_SCHEMA&&new RegExp(UUID).test(result.workspaceId??''),'FHIR_CONNECTED_TARGET_IDENTITY');
  return result;
}
async function privateConfiguration(){
  const path=join(output,'fhir-connections.json'),value={schema:CONNECTION_SCHEMA,workspaces:{
    original:{directory:paths.original,label:'Original acquired FHIR workspace',allowStart:true,
      ...(options['--credentials-file']?{credentialsFile:options['--credentials-file']}:{})},
    restored:{directory:paths.restored,label:'Received original editable workspace',allowStart:true},
    customer:{directory:paths.customer,label:'Received original customer dataset',allowStart:true},
  }};
  try{const current=JSON.parse((await readSourceFile(path,{privateFile:true,maxBytes:1024*1024})).toString('utf8'));
    need(same(current,value),'FHIR_CONNECTED_CONFIGURATION_CHANGED');}
  catch(error){if(error.code!=='ENOENT')throw error;await saveJSON(path,value,true);}
  return path;
}
async function operatorIdentity(alias){
  const saved=JSON.parse((await readSourceFile(join(paths[alias],'fhir','operator-connection.json'),
    {privateFile:true,maxBytes:65536})).toString('utf8'));
  need(saved.schema===OPERATOR_SCHEMA && saved.active && saved.workspace===paths[alias],
    'FHIR_CONNECTED_ORIGINAL_OPERATOR_REQUIRED');
  const response=await fetch(new URL('/api/operator',saved.url),{
    headers:{Authorization:'Bearer '+saved.accessToken},redirect:'error',signal:AbortSignal.timeout(30000)});
  need(response.ok,'FHIR_CONNECTED_OPERATOR_READ_FAILED');
  const identity=await response.json();
  need(identity.instanceId===saved.instanceId && identity.workspaceId===saved.workspaceId &&
    identity.processId===saved.processId,'FHIR_CONNECTED_OPERATOR_CHANGED');
  return {identity,url:saved.url+'#'+saved.accessToken};
}
async function startMerchant(){
  const token=randomBytes(32).toString('base64url'),tokenEnv='FHIR_CONNECTED_RECEIVING_MCP_CODE',
    environment={...process.env,[tokenEnv]:token};
  merchant=await startMerchantMcp({configPath:configuration,port:0,tokenEnv,environment});
  client=await openFhirMerchantClient({url:merchant.url,tokenEnv,environment});
  journal.merchantRuns.push({startedAt:now(),url:merchant.url,configuration});
  await checkpoint();
}
async function closeMerchant(){
  if(client){await client.close();client=null;}
  if(merchant){await merchant.close();merchant=null;journal.merchantRuns.at(-1).closedAt=now();await checkpoint();}
}
async function call(action,args={},label=action){
  const request={key:label,action,arguments:args,startedAt:now(),state:'REQUESTED'};
  journal.calls.push(request);await checkpoint();
  try{
    const result=await client.call(action,args,{timeoutMs:600000});
    request.result=result;request.returnedAt=now();await checkpoint();
    need(result.state==='COMPLETED' && result.retention?.state==='COMPLETE' && result.native?.ok,
      'FHIR_CONNECTED_NATIVE_ACTION_FAILED',action+' returned '+JSON.stringify(result));
    const value=await readFhirValue({client,result});
    request.original=await privateJSON('call-'+String(journal.calls.indexOf(request)+1).padStart(4,'0')+'.json',
      {action,arguments:args,result,value});
    request.state='COMPLETE';await checkpoint();
    return {result,value};
  }catch(error){request.state='INTERRUPTED';request.error={code:error.code??null,message:error.message};await checkpoint();throw error;}
}
async function retainedExport(key,action,args){
  if(journal.exports[key]){
    const retained=journal.exports[key];
    const info=await client.manifest({workspace:retained.workspace,exportId:retained.exportId});
    need(info.manifestFile?.sha256===retained.manifestSha256,'FHIR_CONNECTED_EXPORT_CHANGED',key);
    return retained;
  }
  const retained=await client.call(action,args,{timeoutMs:600000});
  need(retained.state==='COMPLETED'&&retained.retention?.state==='COMPLETE'&&retained.native?.ok,
    'FHIR_CONNECTED_COMPLETE_EXPORT_REQUIRED',key);
  journal.exports[key]=retained;await checkpoint();return retained;
}
async function download(key,retained){
  const directory=join(output,'downloads',key);
  await mkdir(dirname(directory),{recursive:true,mode:0o700});await privateDirectory(dirname(directory));
  const selected={client,workspace:retained.workspace,exportId:retained.exportId,
    expectedManifestSha256:retained.manifestSha256,directory};
  const received=await downloadFhirExport(selected),inspected=await inspectFhirExport(selected);
  const reopened=await reopenFhirExport(selected);
  const files=[];
  for(const original of retained.files){
    const path=join(directory,original.name),actual=await fileIdentity(path,{maxBytes:576*1024*1024});
    need(actual.bytes===original.bytes&&actual.sha256===original.sha256,'FHIR_CONNECTED_RECEIVED_FILE_CHANGED',original.name);
    files.push({file:path,...original});
  }
  journal.downloads[key]={received,inspected,reopened,files};await checkpoint();
  return journal.downloads[key];
}
function includesRecords(state){
  need(state.schema===WORKSPACE_SCHEMA&&state.workspaceId===native.workspaceId,'FHIR_CONNECTED_WORKSPACE_CHANGED');
  for(const [key,ids,field] of [
    ['sources',native.sourceIds,'id'],['builds',native.buildIds,'id'],['operations',native.operationIds,'operationId'],
    ['exports',native.exportIds,'id'],['connections',[native.connectionId],'id'],
    ['discoveries',[native.discoveryId],'id'],['groupPages',native.groupPageIds,'id'],['plans',[native.planId],'id'],
  ])need(Array.isArray(state[key])&&ids.every(id=>state[key].some(item=>item[field]===id)),
    'FHIR_CONNECTED_ORIGINAL_RECORD_MISSING',key);
  for(const id of native.operationIds)need(state.operations.find(item=>item.operationId===id)?.state==='complete',
    'FHIR_CONNECTED_ORIGINAL_ACQUISITION_INCOMPLETE',id);
  return state;
}
async function queryBuild(workspace,buildId,expectedRows,label){
  const {value}=await call('build_query',{workspace,buildId,query:{limit:'5'}},label);
  need(value.response?.status===200&&value.response.body?.page?.total===expectedRows,
    'FHIR_CONNECTED_ORIGINAL_QUERY_CHANGED',workspace+':'+buildId);
  return value;
}
async function fhirReady(){
  await page.waitForFunction(()=>{
    const content=document.querySelector('#content'),status=document.querySelector('#connection-state');
    return content&&content.getAttribute('aria-busy')!=='true'&&status?.textContent==='Private workspace connected';
  },null,{timeout:60000});
}
async function screen(label){
  const file=join(output,label+'.png');await page.screenshot({path:file,fullPage:true});
  return {file,...await fileIdentity(file,{maxBytes:64*1024*1024})};
}
function watchPage(){
  page.on('pageerror',error=>browserErrors.push({at:now(),message:error.message}));
  page.on('response',response=>{
    const request=response.request(),path=new URL(response.url()).pathname;
    if(!path.startsWith('/api/')||!path.endsWith('/query'))return;
    const promise=(async()=>{journal.browserRequests.push({at:now(),method:request.method(),path,
      query:new URL(response.url()).search,status:response.status(),response:await response.json()});await checkpoint();})()
      .catch(error=>{captureFailure=error;});
    pendingCaptures.add(promise);promise.finally(()=>pendingCaptures.delete(promise));
  });
}
async function captures(){await Promise.all([...pendingCaptures]);if(captureFailure)throw captureFailure;}
async function browserRun(label,expectedRows){
  const original=await operatorIdentity('original');
  await page.goto(original.url);await fhirReady();
  const before=await screen(label+'-overview');
  for(const section of ['exports','sources','datasets','query']){
    await page.locator('[data-section="'+section+'"]').click();await fhirReady();
  }
  const buildId=native.buildIds.at(-1);
  await page.locator('[data-field="build-selector"]').selectOption(buildId);await fhirReady();
  await page.getByRole('button',{name:'Clear query',exact:true}).click();await fhirReady();
  await page.locator('[data-field="query-limit"]').fill('5');
  const path='/api/builds/'+encodeURIComponent(buildId)+'/query';
  const [response]=await Promise.all([
    page.waitForResponse(value=>new URL(value.url()).pathname===path,{timeout:120000}),
    page.getByRole('button',{name:'Run native query',exact:true}).click(),
  ]);
  const value=await response.json();
  need(response.ok()&&value.response?.status===200&&value.response.body?.page?.total===expectedRows,
    'FHIR_CONNECTED_BROWSER_QUERY_CHANGED');
  await fhirReady();await captures();
  const result={at:now(),operator:original.identity,buildId,query:value,screens:{overview:before,query:await screen(label+'-query')}};
  journal.browserRuns.push(result);await checkpoint();return result;
}

try{
  lease=await operationLease(join(output,'connected-receiving.lock'));
  const sources=await sourceIdentities();
  try{journal=await readJSON(journalPath);}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(journal){
    need(journal.schema===SCHEMA&&journal.operation===OPERATION&&same(journal.binding,binding),
      'FHIR_CONNECTED_RECEIVING_IDENTITY_CHANGED','Continue this original receiving with its selected native record and private paths.');
    if(!same(journal.sourceFiles,sources)){
      journal.sourceEditions??=[];journal.sourceEditions.push({at:now(),files:sources});journal.sourceFiles=sources;
    }
  }else{
    journal={schema:SCHEMA,operation:OPERATION,createdAt:now(),binding,sourceFiles:sources,
      sourceEditions:[{at:now(),files:sources}],calls:[],exports:{},downloads:{},merchantRuns:[],
      operatorRuns:[],browserRuns:[],browserRequests:[],failures:[]};
  }
  await checkpoint();
  // These are the two declared native receiving destinations. Reopening one
  // keeps its existing identity and original receive journal.
  for(const alias of ['restored','customer'])await initializeWorkspace(alias);
  const configPath=await privateConfiguration(),selected=await readFhirConfiguration(configPath);
  need(selected.workspaces.original.workspaceId===native.workspaceId,'FHIR_CONNECTED_ORIGINAL_WORKSPACE_CHANGED');
  const setup=await initializeFhirMerchant({directory:join(output,'merchant'),connection:configPath,
    name:'Original FHIR Bulk Data connected receiving'});
  configuration=setup.configuration;journal.setup=setup;await checkpoint();

  // The external owners keep native operators alive across merchant reopen.
  // If Applications already owns the original, this only borrows its descriptor.
  for(const [alias,selectedWorkspace] of Object.entries(selected.workspaces)){
    const owner=new FhirConnection(selectedWorkspace);owners.push(owner);
    const opened=await owner.open();journal.operatorRuns.push({alias,at:now(),...opened});await checkpoint();
  }
  const beforeOperator=(await operatorIdentity('original')).identity;
  let playwright;
  try{playwright=await import('playwright');}
  catch(error){
    need(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'FHIR_CONNECTED_PLAYWRIGHT_REQUIRED');
    playwright=createRequire(import.meta.url)(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'));
  }
  browser=await playwright.chromium.launchPersistentContext(join(output,'browser-profile'),{
    headless:true,acceptDownloads:true,viewport:{width:1440,height:1080},
    ...(options['--chromium']?{executablePath:options['--chromium']}:{})});
  page=browser.pages()[0]??await browser.newPage();watchPage();
  await startMerchant();
  const catalogue=await client.schema();
  journal.connectedCatalogue=await privateJSON('CONNECTED_CATALOGUE.json',catalogue);await checkpoint();
  const before=includesRecords((await call('state',{workspace:'original'},'original-before')).value);
  journal.originalBefore=await privateJSON('ORIGINAL_BEFORE.json',before);await checkpoint();
  const finalBuild=native.buildIds.at(-1),expectedRows=before.builds.find(item=>item.id===finalBuild)?.rowCount;
  need(Number.isSafeInteger(expectedRows)&&expectedRows>0,'FHIR_CONNECTED_ORIGINAL_BUILD_REQUIRED');
  await browserRun('01-original',expectedRows);

  // Read the complete accepted requests and provider observations from their
  // original saved identities. Acquisition remains with those operations.
  await call('connection',{workspace:'original',connectionId:native.connectionId},'original-connection');
  await call('discovery',{workspace:'original',discoveryId:native.discoveryId},'original-discovery');
  for(const groupPageId of native.groupPageIds)
    await call('group_page',{workspace:'original',groupPageId},'original-group-'+groupPageId);
  for(const exportId of native.exportIds)
    await call('export',{workspace:'original',exportId},'original-export-'+exportId);
  for(const operationId of native.operationIds){
    const {value}=await call('operation',{workspace:'original',operationId},'original-operation-'+operationId);
    need(value.operationId===operationId&&value.state==='complete','FHIR_CONNECTED_ACQUISITION_CHANGED');
  }

  // Complete source packets and each original member travel through the same
  // retained-file receiver used by remote customers.
  for(const [sourceIndex,sourceId] of native.sourceIds.entries()){
    await call('source',{workspace:'original',sourceId},'original-source-'+sourceId);
    const {value:members}=await call('source_members',{workspace:'original',sourceId},'original-members-'+sourceId);
    need(Array.isArray(members)&&members.length,'FHIR_CONNECTED_SOURCE_MEMBERS_REQUIRED');
    const {value:rows}=await call('source_rows',{workspace:'original',sourceId,kind:'all',limit:5},
      'original-rows-'+sourceId);
    need(rows.sourceId===sourceId&&Array.isArray(rows.rows),'FHIR_CONNECTED_SOURCE_ROWS_REQUIRED');
    if(rows.rows.length){
      const first=rows.rows[0];
      const {value:row}=await call('source_row',{workspace:'original',sourceId,fileId:first.fileId,line:first.line},
        'original-row-'+sourceId);
      need(same(first,row),'FHIR_CONNECTED_ORIGINAL_RESOURCE_CHANGED');
    }
    for(const [memberIndex,member] of members.entries()){
      const key='source-'+sourceIndex+'-member-'+memberIndex;
      const exported=await retainedExport(key,'source_file',{workspace:'original',sourceId,member:member.name});
      const sourceFile=exported.files.find(file=>file.name!=='original-request.json');
      need(sourceFile?.bytes===member.bytes&&(!member.sha256||sourceFile.sha256===member.sha256),
        'FHIR_CONNECTED_ORIGINAL_MEMBER_CHANGED',member.name);
      await download(key,exported);
    }
    const key='source-'+sourceIndex+'-packet';
    await download(key,await retainedExport(key,'source_packet',{workspace:'original',sourceId}));
  }

  const {value:savedPlan}=await call('plan',{workspace:'original',planId:native.planId},'original-plan');
  need(savedPlan.id===native.planId&&savedPlan.plan,'FHIR_CONNECTED_ORIGINAL_PLAN_CHANGED');
  const plan=savedPlan.plan;
  await call('mapping_default',{workspace:'original',sourceId:native.composedSourceId,resourceType:'Patient'},
    'native-patient-default-mapping');
  const {value:preview}=await call('mapping_preview',{
    workspace:'original',sourceId:native.composedSourceId,plan,limit:5},'reviewed-original-projection');
  need(preview.totalRows===expectedRows,'FHIR_CONNECTED_PREVIEW_CHANGED');
  for(const buildId of native.buildIds){
    const {value:build}=await call('build',{workspace:'original',buildId},'original-build-'+buildId);
    const rowCount=before.builds.find(item=>item.id===buildId)?.rowCount;
    need(build.id===buildId&&build.rowCount===rowCount,'FHIR_CONNECTED_ORIGINAL_BUILD_CHANGED');
    await queryBuild('original',buildId,rowCount,'original-query-'+buildId);
  }
  let offset=0;
  for(;;){
    const {value}=await call('comparison_changes',{workspace:'original',comparisonId:native.comparisonId,offset,limit:250},
      'original-comparison-'+offset);
    if(value.nextOffset===null||value.nextOffset===undefined)break;
    need(Number.isSafeInteger(value.nextOffset)&&value.nextOffset>offset,'FHIR_CONNECTED_COMPARISON_PAGE_CHANGED');
    offset=value.nextOffset;
  }
  const changes=await retainedExport('edition-changes','comparison_file',
    {workspace:'original',comparisonId:native.comparisonId});
  await download('edition-changes',changes);
  const dataset=await retainedExport('dataset','build_dataset',{workspace:'original',buildId:finalBuild});
  await download('dataset',dataset);
  const packet=await retainedExport('customer-packet','build_packet',{workspace:'original',buildId:finalBuild});
  await download('customer-packet',packet);
  const editable=await retainedExport('editable-workspace','workspace_packet',{workspace:'original'});
  await download('editable-workspace',editable);

  // Both intakes use complete retained originals, native member validation and
  // the original native receiving transaction. They are safe to continue after
  // a lost reply using the same selected manifest and destination.
  const baseIndex=native.sourceIds.indexOf(native.baseSourceId);
  need(baseIndex>=0,'FHIR_CONNECTED_BASE_SOURCE_CHANGED');
  const base=journal.exports['source-'+baseIndex+'-packet'];
  journal.sourceReceiving=await call('receive_export',{
    workspace:'customer',sourceWorkspace:'original',exportId:base.exportId,
    expectedManifestSha256:base.manifestSha256,kind:'source',label:'Original received base capture'},
    'receive-original-base-capture');
  journal.customerReceiving=await call('receive_export',{
    workspace:'customer',sourceWorkspace:'original',exportId:packet.exportId,
    expectedManifestSha256:packet.manifestSha256,kind:'packet'},'receive-original-customer-packet');
  journal.workspaceReceiving=await call('receive_export',{
    workspace:'restored',sourceWorkspace:'original',exportId:editable.exportId,
    expectedManifestSha256:editable.manifestSha256,kind:'workspace'},'receive-original-editable-workspace');
  await checkpoint();
  const restored=includesRecords((await call('state',{workspace:'restored'},'restored-complete-state')).value);
  const editableFile=editable.files.find(file=>file.name==='fhir-editable-workspace.zip');
  need(restored.receives.some(receive=>receive.state==='complete'&&receive.archiveSha256===editableFile.sha256&&
    receive.workspaceId===native.workspaceId),'FHIR_CONNECTED_WORKSPACE_RECEIVE_MISSING');
  const customer=(await call('state',{workspace:'customer'},'customer-complete-state')).value;
  need(customer.sources.some(source=>source.id===native.baseSourceId)&&
    customer.sources.some(source=>source.id===native.composedSourceId)&&
    customer.plans.some(saved=>saved.id===native.planId)&&customer.builds.some(build=>build.id===finalBuild),
  'FHIR_CONNECTED_CUSTOMER_RECEIVE_MISSING');
  await queryBuild('restored',finalBuild,expectedRows,'restored-native-query');
  await queryBuild('customer',finalBuild,expectedRows,'customer-native-query');
  journal.receivedStates=await privateJSON('RECEIVED_STATES.json',{restored,customer});await checkpoint();

  // Reopen the actual MCP host. The original native operator and browser stay
  // live, and all customer downloads reopen against their complete file hashes.
  await closeMerchant();
  const whileClosed=(await operatorIdentity('original')).identity;
  need(whileClosed.instanceId===beforeOperator.instanceId&&whileClosed.workspaceId===native.workspaceId,
    'FHIR_CONNECTED_BORROWED_OPERATOR_CLOSED');
  await browserRun('02-merchant-closed',expectedRows);
  await startMerchant();
  const reopened=includesRecords((await call('state',{workspace:'original'},'original-reopened')).value);
  need((await operatorIdentity('original')).identity.instanceId===beforeOperator.instanceId,
    'FHIR_CONNECTED_ORIGINAL_OPERATOR_RESTARTED');
  for(const [key,exported] of Object.entries(journal.exports)){
    const directory=join(output,'downloads',key),selected={client,workspace:exported.workspace,
      exportId:exported.exportId,expectedManifestSha256:exported.manifestSha256,directory};
    const inspected=await inspectFhirExport(selected),local=await reopenFhirExport(selected);
    journal.downloads[key].afterMerchantReopen={inspected,local};await checkpoint();
  }
  const restoredReopened=includesRecords((await call('state',{workspace:'restored'},'restored-reopened')).value);
  await queryBuild('restored',finalBuild,expectedRows,'restored-reopened-query');
  await queryBuild('customer',finalBuild,expectedRows,'customer-reopened-query');
  await browserRun('03-merchant-reopened',expectedRows);
  await captures();
  need(browserErrors.length===0,'FHIR_CONNECTED_BROWSER_ERRORS',JSON.stringify(browserErrors));
  const result={schema:SCHEMA,operation:OPERATION,completedAt:now(),nativeReceiving:binding,
    sourceFiles:journal.sourceFiles,sourceEditions:journal.sourceEditions,
    workspace:paths.original,workspaceId:native.workspaceId,originalOperator:beforeOperator,
    connectionId:native.connectionId,discoveryId:native.discoveryId,groupPageIds:native.groupPageIds,
    exportIds:native.exportIds,operationIds:native.operationIds,sourceIds:native.sourceIds,
    planId:native.planId,buildIds:native.buildIds,comparisonId:native.comparisonId,rowCount:expectedRows,
    configuration,merchantRuns:journal.merchantRuns,operatorRuns:journal.operatorRuns,
    exports:journal.exports,downloads:journal.downloads,receiving:{
      source:journal.sourceReceiving,customer:journal.customerReceiving,workspace:journal.workspaceReceiving,
      customerDirectory:paths.customer,restoredDirectory:paths.restored},
    originalReopened:reopened,restoredReopened,browserRuns:journal.browserRuns,
    browserRequests:journal.browserRequests,browserErrors,journey:journalPath};
  const completed=await privateJSON('OPERATED_CONNECTED_FHIR.json',result);
  journal.completedAt=result.completedAt;journal.result=completed;await checkpoint();
  process.stdout.write(JSON.stringify({state:'complete',operation:OPERATION,result:completed,
    workspaceId:native.workspaceId,buildId:finalBuild,rowCount:expectedRows,
    completeDownloads:Object.keys(journal.downloads).length})+'\n');
}catch(error){
  if(journal){journal.failures.push({at:now(),code:error.code??null,message:error.message});
    await checkpoint().catch(()=>{});}
  throw error;
}finally{
  await captures().catch(()=>{});
  if(browser)await browser.close().catch(()=>{});
  await closeMerchant().catch(()=>{});
  for(const owner of owners.reverse())await owner.close().catch(()=>{});
  if(lease)await lease.close();
}
