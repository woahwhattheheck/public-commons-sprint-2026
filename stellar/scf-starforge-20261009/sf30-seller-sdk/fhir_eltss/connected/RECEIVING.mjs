#!/usr/bin/env node
// MIT. Operate the actual saved eLTSS care-plan workspace through the original merchant host.
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {absolute,privateDirectory,readJSON,saveJSON,digest,operationLease,need,now}
  from '../../../distribution/runtime-workspace/storage.mjs';
import {startMerchantMcp} from '../../../../../stellar-forge/mcp-merchant-operator/serve.mjs';
import {readEltssConfiguration,EltssConnection} from './connection.mjs';
import {readSourceFile,fileIdentity,immutable} from './files.mjs';
import {CONNECTION_SCHEMA,OPERATOR_SCHEMA,WORKSPACE_SCHEMA,SHA,UUID,canonical}
  from './contracts.mjs';
import {initializeEltssMerchant} from './setup.mjs';
import {openEltssMerchantClient,readEltssValue,downloadEltssExport,inspectEltssExport,reopenEltssExport}
  from './client.mjs';

const SCHEMA='stellar-forge.eltss-connected-receiving.v1';
const OPERATION='SCF-ELTSS-CONNECTED-OPERATIONS-450E-20261012';
const ACTOR='Commons eLTSS connected receiving operator';
const HERE=dirname(fileURLToPath(import.meta.url)),ELTSS=resolve(HERE,'..'),REPO=resolve(HERE,'../../../../..');
const CLI=join(ELTSS,'cli.py'),options={};
for(let i=2;i<process.argv.length;i+=2){
  const flag=process.argv[i],value=process.argv[i+1];
  need(['--receiving','--out','--workspace','--original-bundle','--chromium','--playwright','--credentials-file'].includes(flag) &&
    value && !value.startsWith('--') && !Object.hasOwn(options,flag),
  'ELTSS_CONNECTED_RECEIVING_ARGUMENTS','Use --receiving ABS/OPERATED_ELTSS.json --out ABS/PRIVATE_OUTPUT [--workspace ABS/RESTORED_WORKSPACE] [--original-bundle ABS/PUBLISHED_BUNDLE.json] [--chromium ABS] [--playwright ABS].');
  options[flag]=absolute(value);
}
for(const key of ['--receiving','--out'])need(options[key],'ELTSS_CONNECTED_RECEIVING_ARGUMENT_REQUIRED',key);
need(Number(process.versions.node.split('.')[0])>=22,'ELTSS_CONNECTED_NODE_REQUIRED','Use Node 22 or newer.');
const output=options['--out'];
await mkdir(output,{mode:0o700,recursive:true});await privateDirectory(output);
let lease,journal,merchant,client,browser,page,configuration;
const owners=[],browserErrors=[],pendingCaptures=new Set();
let captureFailure=null,writes=Promise.resolve();
const journalPath=join(output,'CONNECTED_JOURNEY.json');
const nativeBytes=await readSourceFile(options['--receiving'],{maxBytes:64*1024*1024}),
  native=JSON.parse(nativeBytes.toString('utf8'));
need(native.schema==='stellar-forge.eltss-operated.v1' &&
  native.operation==='SCF-ELTSS-CAREPLAN-WORKBENCH-450E-20261012' &&
  typeof native.completedAt==='string' && typeof native.workspace==='string' &&
  new RegExp(UUID).test(native.workspaceId??'') &&
  ['sourceIds','editionIds','reviewSetIds','assessmentIds','graphIds','buildIds','handoffIds','receivingIds','artifactIds']
    .every(key=>Array.isArray(native[key])&&native[key].length&&native[key].every(id=>new RegExp(SHA).test(id))) &&
  ['baseSourceId','baseEditionId','baseAssessmentId','correctedSourceId','correctedEditionId','correctedAssessmentId','planId']
    .every(key=>new RegExp(SHA).test(native[key]??'')) &&
  native.originalBundle?.bytes===128055 &&
  native.originalBundle?.sha256==='b1bfe61134b7f18c8d8831b9d253f64df7d37e8bb4e457a00ab472e0aa1b4de2',
'ELTSS_CONNECTED_COMPLETE_NATIVE_REQUIRED','Select the completed genuine STU2 source, all-field review, correction, native dataset and whole receiving result.');
const originalBundleFile=absolute(options['--original-bundle']??native.originalBundle.file);
const binding={receiving:options['--receiving'],receivingSha256:digest(nativeBytes),
  workspace:absolute(options['--workspace']??native.workspace),workspaceId:native.workspaceId,sourceRoot:ELTSS,
  credentialsFile:options['--credentials-file']??null,
  ...(options['--workspace']?{nativeWorkspace:absolute(native.workspace)}:{}),
  ...(options['--original-bundle']?{originalBundleFile}: {})};
const paths={original:binding.workspace,restored:join(output,'restored-workspace'),customer:join(output,'customer-workspace')};
function same(left,right){return JSON.stringify(canonical(left))===JSON.stringify(canonical(right));}
async function checkpoint(){
  writes=writes.then(async()=>{journal.updatedAt=now();await saveJSON(journalPath,journal,true);});
  return writes;
}
async function privateJSON(name,value){
  const path=join(output,name);await saveJSON(path,value,true);
  return {file:path,...await fileIdentity(path,{maxBytes:64*1024*1024})};
}
async function checkedJSON(selected){
  const bytes=await readSourceFile(selected.file,{privateFile:true,maxBytes:64*1024*1024});
  need(bytes.length===selected.bytes&&digest(bytes)===selected.sha256,'ELTSS_CONNECTED_RECEIVING_FILE_CHANGED',selected.file);
  return JSON.parse(bytes.toString('utf8'));
}
async function sourceIdentities(){
  const relative=[
    ...['contracts.mjs','files.mjs','connection.mjs','catalog.mjs','runtime.mjs','provider.mjs','client.mjs',
      'client.d.mts','setup.mjs','cli.mjs','README.md','RECEIVING.mjs'].map(name=>'connected/'+name),
    'eltss_acquisition.py','eltss_source.py','eltss_runtime.py','eltss_workspace.py','eltss_server.py',
    'eltss_graph.py','eltss_validation.py','eltss_review.py','eltss_correction.py','eltss_receiving.py','cli.py',
    'catalogue.json','field-profile.json','HTTP_API.md','README.md','SOURCE_NOTICE.md'
  ];
  const selected={};
  for(const name of relative)selected[name]=await fileIdentity(join(ELTSS,name),{maxBytes:4*1024*1024});
  for(const name of ['stellar-forge/mcp-merchant-operator/serve.mjs',
    'stellar-forge/mcp-merchant-operator/retained-download.mjs',
    'stellar-forge/mcp-merchant-operator/retained-file-reads.mjs',
    'stellar-forge/mcp-merchant-operator/host-files.mjs',
    'stellar/scf-starforge-20261009/distribution/contributions/eltss-careplans.json'])
    selected['repository/'+name]=await fileIdentity(join(REPO,name),{maxBytes:4*1024*1024});
  return selected;
}
async function initializeWorkspace(alias){
  const directory=paths[alias],marker=join(directory,'eltss','identity.json');
  try{return JSON.parse((await readSourceFile(marker,{privateFile:true,maxBytes:4096})).toString('utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  need(alias!=='original','ELTSS_CONNECTED_ORIGINAL_REQUIRED');
  const python=process.env.SF30_ELTSS_PYTHON??process.env.SF30_XML_PYTHON??
    process.env.CODEX_PRIMARY_RUNTIME_PYTHON??'python3';
  const child=spawn(python,['-B',CLI,'init','--workspace',directory],{
    stdio:['ignore','pipe','pipe'],env:{...process.env,SF30_ELTSS_NODE:process.execPath,SF30_XML_NODE:process.execPath}});
  let stdout='',stderr='',overflow=false;
  child.stdout.on('data',bytes=>{stdout+=bytes.toString('utf8');if(Buffer.byteLength(stdout)>8*1024*1024){overflow=true;child.kill('SIGTERM');}});
  child.stderr.on('data',bytes=>{stderr=(stderr+bytes.toString('utf8')).slice(-65536);});
  const timer=setTimeout(()=>child.kill('SIGTERM'),60000);let exit;
  try{exit=await new Promise((accept,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>accept({code,signal}));});}
  finally{clearTimeout(timer);}
  const record=await privateJSON(alias+'-native-initialization.json',{exit,stdout,stderr,overflow});
  need(exit.code===0&&!overflow,'ELTSS_CONNECTED_NATIVE_INIT_FAILED',record.file);
  const result=JSON.parse((await readSourceFile(marker,{privateFile:true,maxBytes:4096})).toString('utf8'));
  need(result.schema===WORKSPACE_SCHEMA&&new RegExp(UUID).test(result.workspaceId??''),'ELTSS_CONNECTED_TARGET_IDENTITY');
  return result;
}
async function saveConfiguration(name,inputs={}){
  const path=join(output,name),value={schema:CONNECTION_SCHEMA,workspaces:{
    original:{directory:paths.original,label:'Original published-source care-plan workspace',allowStart:true,
      ...(options['--credentials-file']?{credentialsFile:options['--credentials-file']}:{})},
    restored:{directory:paths.restored,label:'Received original editable care-plan workspace',allowStart:true},
    customer:{directory:paths.customer,label:'Received original care-plan handoff and dataset',allowStart:true},
  }};
  for(const [alias,selected] of Object.entries(inputs))value.workspaces[alias].inputs=selected;
  try{const current=JSON.parse((await readSourceFile(path,{privateFile:true,maxBytes:1024*1024})).toString('utf8'));
    need(same(current,value),'ELTSS_CONNECTED_CONFIGURATION_CHANGED');}
  catch(error){if(error.code!=='ENOENT')throw error;await saveJSON(path,value,true);}
  return path;
}
async function operatorIdentity(alias){
  const saved=JSON.parse((await readSourceFile(join(paths[alias],'eltss','operator-connection.json'),
    {privateFile:true,maxBytes:65536})).toString('utf8'));
  need(saved.schema===OPERATOR_SCHEMA && saved.active && saved.workspace===paths[alias],
    'ELTSS_CONNECTED_ORIGINAL_OPERATOR_REQUIRED');
  const response=await fetch(new URL('/api/operator',saved.url),{
    headers:{Authorization:'Bearer '+saved.accessToken},redirect:'error',signal:AbortSignal.timeout(30000)});
  need(response.ok,'ELTSS_CONNECTED_OPERATOR_READ_FAILED');
  const identity=await response.json();
  need(identity.instanceId===saved.instanceId && identity.workspaceId===saved.workspaceId &&
    identity.processId===saved.processId,'ELTSS_CONNECTED_OPERATOR_CHANGED');
  return {identity,url:saved.url+'#'+saved.accessToken};
}
async function readOriginal(path){
  const saved=JSON.parse((await readSourceFile(join(paths.original,'eltss','operator-connection.json'),
    {privateFile:true,maxBytes:65536})).toString('utf8'));
  need(saved.active&&saved.workspaceId===native.workspaceId,'ELTSS_CONNECTED_ORIGINAL_OPERATOR_REQUIRED');
  const response=await fetch(new URL(path,saved.url),{redirect:'error',signal:AbortSignal.timeout(600000),
    headers:{Authorization:'Bearer '+saved.accessToken,Accept:'application/json'}});
  need(response.ok,'ELTSS_CONNECTED_ORIGINAL_READ_FAILED',path);
  return response.json();
}
async function prepareInputs(){
  const actual=await fileIdentity(originalBundleFile,{maxBytes:256*1024*1024});
  need(actual.bytes===native.originalBundle.bytes&&actual.sha256===native.originalBundle.sha256,
    'ELTSS_CONNECTED_PUBLISHED_SOURCE_CHANGED');
  const assessment=await readOriginal('/api/assessments/'+native.baseAssessmentId),
    review=await readOriginal('/api/review-sets/'+assessment.reviewSetId);
  need(review.fields?.length===56&&review.id===assessment.reviewSetId,'ELTSS_CONNECTED_COMPLETE_REVIEW_REQUIRED');
  const value={label:'Complete source-selected field review received through connected client',
    profileId:review.profileId,predecessorId:review.id,fields:review.fields,actor:ACTOR,
    note:'Receives every original selector, status, applicability and conversion from the operated source review through the declared complete host-file input.'};
  const file=join(output,'complete-native-review-input.json');
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
  await immutable(file,bytes);
  const identity=await fileIdentity(file,{maxBytes:4*1024*1024});
  // The selected JSON is fully retained before the native POST and stays bound
  // to the exact host input alias throughout a resumed operation.
  journal.reviewInput={file,...identity,predecessorId:review.id};await checkpoint();
  return {original:{full_review:{file,sha256:identity.sha256,label:'Complete original56-field review'}},
    customer:{published_bundle:{file:originalBundleFile,sha256:actual.sha256,label:'Unchanged published STU2 Bundle JSON'}}};
}
async function startMerchant(){
  const token=randomBytes(32).toString('base64url'),tokenEnv='ELTSS_CONNECTED_RECEIVING_MCP_CODE',
    environment={...process.env,[tokenEnv]:token};
  merchant=await startMerchantMcp({configPath:configuration,port:0,tokenEnv,environment});
  client=await openEltssMerchantClient({url:merchant.url,tokenEnv,environment});
  journal.merchantRuns.push({startedAt:now(),url:merchant.url,configuration});await checkpoint();
}
async function closeMerchant(){
  if(client){await client.close();client=null;}
  if(merchant){await merchant.close();merchant=null;journal.merchantRuns.at(-1).closedAt=now();await checkpoint();}
}
async function call(action,args={},label=action,{once=false}={}){
  let request=once?journal.actions[label]:null;
  if(request){
    need(request.action===action&&same(request.arguments,args),'ELTSS_CONNECTED_REQUEST_CHANGED',label);
    if(request.state==='COMPLETE')return checkedJSON(request.original);
    // Read the actual native state before replaying the exact original
    // content-addressed input, archive hash or retained receiving UUID.
    const current=await client.state({workspace:args.workspace});
    need(current.retention?.state==='COMPLETE'&&current.native?.ok,'ELTSS_CONNECTED_RECOVERY_READ_REQUIRED');
    request.reconciliation=current;await checkpoint();
  }else{
    request={key:label,action,arguments:args,startedAt:now(),state:'REQUESTED',attempts:[]};
    if(once)journal.actions[label]=request;
    journal.calls.push(request);await checkpoint();
  }
  const attempt={startedAt:now()};request.attempts.push(attempt);await checkpoint();
  try{
    const result=await client.call(action,args,{timeoutMs:600000});
    attempt.result=result;attempt.returnedAt=now();await checkpoint();
    need(result.state==='COMPLETED'&&result.retention?.state==='COMPLETE'&&result.native?.ok,
      'ELTSS_CONNECTED_NATIVE_ACTION_FAILED',action+' returned '+JSON.stringify(result));
    const value=await readEltssValue({client,result});
    request.original=await privateJSON('call-'+String(journal.calls.indexOf(request)+1).padStart(4,'0')+'.json',{result,value});
    request.state='COMPLETE';await checkpoint();return {result,value};
  }catch(error){
    request.state='INTERRUPTED';attempt.error={code:error.code??null,message:error.message};
    await checkpoint();throw error;
  }
}
async function readPages(action,args,label){
  let offset=0,total=null;const rows=[];
  for(;;){
    const {value}=await call(action,{...args,offset,limit:100},label+'-'+offset);
    const counted=action!=='comparison_changes';
    need(Array.isArray(value.rows)&&value.offset===offset&&
      (counted?Number.isSafeInteger(value.total):value.total===undefined||Number.isSafeInteger(value.total))&&
      (total===null||value.total===undefined||value.total===total),'ELTSS_CONNECTED_PAGE_CHANGED',label);
    if(value.total!==undefined)total=value.total;
    rows.push(...value.rows);
    if(value.nextOffset===null){need(total===null||rows.length===total,'ELTSS_CONNECTED_PAGE_INCOMPLETE',label);return rows;}
    need(Number.isSafeInteger(value.nextOffset)&&value.nextOffset===offset+value.rows.length&&value.nextOffset>offset,
      'ELTSS_CONNECTED_PAGE_NOT_ADVANCING',label);
    offset=value.nextOffset;
  }
}
async function retainedExport(key,action,args){
  if(journal.exports[key]){
    const retained=journal.exports[key],info=await client.manifest({workspace:retained.workspace,exportId:retained.exportId});
    need(info.manifestFile?.sha256===retained.manifestSha256,'ELTSS_CONNECTED_EXPORT_CHANGED',key);return retained;
  }
  const retained=await client.call(action,args,{timeoutMs:600000});
  need(retained.state==='COMPLETED'&&retained.retention?.state==='COMPLETE'&&retained.native?.ok,
    'ELTSS_CONNECTED_COMPLETE_EXPORT_REQUIRED',key);
  journal.exports[key]=retained;await checkpoint();return retained;
}
async function download(key,retained,{pause=false}={}){
  const directory=join(output,'downloads',key);
  await mkdir(dirname(directory),{recursive:true,mode:0o700});await privateDirectory(dirname(directory));
  const selected={client,workspace:retained.workspace,exportId:retained.exportId,
    expectedManifestSha256:retained.manifestSha256,directory};
  if(pause&&!journal.partialDownloads[key]){
    try{
      await downloadEltssExport({...selected,chunkSize:32768,onProgress:async progress=>{
        if(progress.bytes>0&&progress.bytes<progress.total&&!journal.partialDownloads[key]){
          journal.partialDownloads[key]={state:'PAUSED',at:now(),...progress};await checkpoint();
          throw Object.assign(new Error('Operator paused after a durably saved original file prefix.'),{code:'ELTSS_RECEIVING_PAUSE'});
        }
      }});
    }catch(error){if(error.code!=='ELTSS_RECEIVING_PAUSE')throw error;}
    need(journal.partialDownloads[key]?.bytes>0,'ELTSS_CONNECTED_ORIGINAL_PREFIX_REQUIRED',key);
  }
  const received=await downloadEltssExport(selected),inspected=await inspectEltssExport(selected),
    reopened=await reopenEltssExport(selected),files=[];
  if(pause)need(received.resumed&&received.resumedBytes>=journal.partialDownloads[key].bytes,
    'ELTSS_CONNECTED_ORIGINAL_PREFIX_NOT_RESUMED',key);
  for(const original of retained.files){
    const path=join(directory,original.name),actual=await fileIdentity(path,{maxBytes:576*1024*1024});
    need(actual.bytes===original.bytes&&actual.sha256===original.sha256,'ELTSS_CONNECTED_RECEIVED_FILE_CHANGED',original.name);
    files.push({file:path,...original});
  }
  journal.downloads[key]={received,inspected,reopened,files};await checkpoint();return journal.downloads[key];
}
function includesRecords(state,{workspaceId=native.workspaceId,additional={}}={}){
  need(state.schema===WORKSPACE_SCHEMA&&state.workspaceId===workspaceId,'ELTSS_CONNECTED_WORKSPACE_CHANGED');
  const required={sources:native.sourceIds,editions:native.editionIds,reviewSets:native.reviewSetIds,
    assessments:native.assessmentIds,builds:native.buildIds,plans:[native.planId],decisions:native.decisionIds,
    corrections:native.correctionIds,editionComparisons:native.editionComparisonIds,handoffs:native.handoffIds,
    artifacts:native.artifactIds,receivings:native.receivingIds,...additional};
  for(const [key,ids] of Object.entries(required))
    need(Array.isArray(state[key])&&ids.every(id=>state[key].some(item=>item.id===id)),
      'ELTSS_CONNECTED_ORIGINAL_RECORD_MISSING',key);
  return state;
}
async function queryBuild(workspace,buildId,expectedRows,label){
  let query={limit:'1'},seen=0,total=null;const pages=[];
  for(;;){
    const {value}=await call('build_query',{workspace,buildId,query},label+'-'+seen);
    const body=value.response?.body;
    need(value.response?.status===200&&body?.page?.total===expectedRows,'ELTSS_CONNECTED_ORIGINAL_QUERY_CHANGED',label);
    const rows=body.rows??body.data;
    need(Array.isArray(rows),'ELTSS_CONNECTED_NATIVE_QUERY_ROWS',label);
    total=body.page.total;seen+=rows.length;pages.push(value);
    const cursor=body.page.nextCursor??body.page.next_cursor??body.nextCursor;
    if(!cursor){need(seen===total,'ELTSS_CONNECTED_QUERY_INCOMPLETE',label);break;}
    need(typeof cursor==='string'&&rows.length>0,'ELTSS_CONNECTED_QUERY_CURSOR',label);query={limit:'1',cursor};
  }
  return pages;
}
async function ready(){
  await page.waitForFunction(()=>document.querySelector('#content')?.getAttribute('aria-busy')!=='true'&&
    document.querySelector('#connection-state')?.textContent==='Private workspace connected',null,{timeout:60000});
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
    const promise=(async()=>{
      journal.browserRequests.push({at:now(),method:request.method(),path,
        query:new URL(response.url()).search,status:response.status(),response:await response.json()});
      await checkpoint();
    })().catch(error=>{captureFailure=error;});
    pendingCaptures.add(promise);promise.finally(()=>pendingCaptures.delete(promise));
  });
}
async function captures(){await Promise.all([...pendingCaptures]);if(captureFailure)throw captureFailure;}
async function browserRun(label,expectedRows){
  const original=await operatorIdentity('original');await page.goto(original.url);await ready();
  await page.locator('[data-view="datasets"]').click();await ready();
  const buildId=native.buildIds.at(-1);
  await page.locator('select[data-select="build"]').selectOption(buildId);await ready();
  await page.locator('form[data-submit="native-query"] input[data-type="integer"]').fill('1');
  const target='/api/builds/'+encodeURIComponent(buildId)+'/query';
  const [response]=await Promise.all([
    page.waitForResponse(value=>new URL(value.url()).pathname===target,{timeout:120000}),
    page.getByRole('button',{name:'Run native query',exact:true}).click()
  ]);
  const value=await response.json();
  need(response.ok()&&value.response?.status===200&&value.response.body?.page?.total===expectedRows,
    'ELTSS_CONNECTED_BROWSER_QUERY_CHANGED');
  await ready();await captures();
  const result={at:now(),operator:original.identity,buildId,query:value,screen:await screen(label)};
  journal.browserRuns.push(result);await checkpoint();return result;
}

try{
  lease=await operationLease(join(output,'connected-receiving.lock'));
  const sources=await sourceIdentities();
  try{journal=await readJSON(journalPath);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(journal){
    need(journal.schema===SCHEMA&&journal.operation===OPERATION&&same(journal.binding,binding),
      'ELTSS_CONNECTED_RECEIVING_IDENTITY_CHANGED','Continue this exact original receiving and private destination.');
    if(!same(journal.sourceFiles,sources)){
      journal.sourceEditions.push({at:now(),files:sources});journal.sourceFiles=sources;
    }
  }else{
    journal={schema:SCHEMA,operation:OPERATION,createdAt:now(),binding,sourceFiles:sources,
      sourceEditions:[{at:now(),files:sources}],calls:[],actions:{},exports:{},downloads:{},partialDownloads:{},
      merchantRuns:[],operatorRuns:[],browserRuns:[],browserRequests:[],failures:[]};
  }
  await checkpoint();
  for(const alias of ['restored','customer'])await initializeWorkspace(alias);
  const bootstrap=await saveConfiguration('native-operator-bindings.json'),
    originalBindings=await readEltssConfiguration(bootstrap);
  need(originalBindings.workspaces.original.workspaceId===native.workspaceId,'ELTSS_CONNECTED_ORIGINAL_WORKSPACE_CHANGED');
  // This outer owner keeps the original native servers alive across MCP host
  // close/reopen. Existing Applications servers are borrowed and remain owned there.
  for(const [alias,bound] of Object.entries(originalBindings.workspaces)){
    const owner=new EltssConnection(bound);owners.push(owner);
    const opened=await owner.open();journal.operatorRuns.push({alias,at:now(),...opened});await checkpoint();
  }
  const beforeOperator=(await operatorIdentity('original')).identity,
    inputs=await prepareInputs(),configPath=await saveConfiguration('eltss-connections.json',inputs);
  const setup=await initializeEltssMerchant({directory:join(output,'merchant'),connection:configPath,
    name:'Original eLTSS care-plan connected receiving'});
  configuration=setup.configuration;journal.setup=setup;await checkpoint();
  let playwright;
  if(options['--playwright'])playwright=await import(pathToFileURL(options['--playwright']).href);
  else{
    try{playwright=await import('playwright');}
    catch(error){
      need(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'ELTSS_CONNECTED_PLAYWRIGHT_REQUIRED');
      playwright=createRequire(import.meta.url)(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'));
    }
  }
  browser=await playwright.chromium.launchPersistentContext(join(output,'browser-profile'),{
    headless:true,acceptDownloads:true,viewport:{width:1440,height:1080},
    ...(options['--chromium']?{executablePath:options['--chromium']}:{})});
  page=browser.pages()[0]??await browser.newPage();watchPage();
  await startMerchant();
  const catalogue=await client.schema();
  need(catalogue.tools?.length===77,'ELTSS_CONNECTED_COMPLETE_CATALOGUE_REQUIRED');
  journal.connectedCatalogue=await privateJSON('CONNECTED_CATALOGUE.json',catalogue);
  const before=includesRecords((await call('state',{workspace:'original'},'original-before')).value);
  journal.originalBefore=await privateJSON('ORIGINAL_BEFORE.json',before);await checkpoint();
  const finalBuild=native.buildIds.at(-1),expectedRows=before.builds.find(item=>item.id===finalBuild)?.rowCount;
  need(expectedRows===2,'ELTSS_CONNECTED_ORIGINAL_BUILD_REQUIRED');
  await browserRun('01-original-operator',expectedRows);
  await call('catalogue',{workspace:'original'},'native-field-and-source-catalogue');
  await call('auth_profiles',{workspace:'original'},'native-configured-profile-metadata');

  // The genuine published example remains exactly the original39 resources.
  // Every source packet and member is received whole, including the unchanged
  // predecessor inside the authored successor.
  const retainedSources={};
  for(const [sourceIndex,sourceId] of native.sourceIds.entries()){
    const {value:source}=await call('source',{workspace:'original',sourceId},'original-source-'+sourceId);
    retainedSources[sourceId]=source;
    const {value:members}=await call('source_members',{workspace:'original',sourceId},'original-members-'+sourceId);
    need(Array.isArray(members)&&members.length,'ELTSS_CONNECTED_SOURCE_MEMBERS_REQUIRED');
    const rows=await readPages('source_rows',{workspace:'original',sourceId},'original-resources-'+sourceId);
    need(rows.length===39,'ELTSS_CONNECTED_PUBLISHED_RESOURCE_SET_CHANGED');
    for(const row of rows.filter(item=>item.resourceType==='CarePlan')){
      const full=(await call('source_row',{workspace:'original',sourceId,recordId:row.recordId},'original-careplan-'+row.recordId)).value;
      need(full.recordId===row.recordId&&full.resourceSha256===row.resourceSha256&&full.jsonText===row.jsonText,
        'ELTSS_CONNECTED_ORIGINAL_RESOURCE_CHANGED');
    }
    for(const [memberIndex,member] of members.entries()){
      const key='source-'+sourceIndex+'-member-'+memberIndex;
      const exported=await retainedExport(key,'source_file',{workspace:'original',sourceId,member:member.name});
      const original=exported.files.find(file=>file.name===exported.source.payloadFile);
      need(original?.bytes===member.bytes&&(!member.sha256||original.sha256===member.sha256),
        'ELTSS_CONNECTED_ORIGINAL_MEMBER_CHANGED',member.name);
      await download(key,exported);
    }
    const key='source-'+sourceIndex+'-packet';
    await download(key,await retainedExport(key,'source_packet',{workspace:'original',sourceId}));
  }
  for(const graphId of native.graphIds){
    const graph=(await call('graph',{workspace:'original',graphId},'original-graph-'+graphId)).value;
    const nodes=await readPages('graph_nodes',{workspace:'original',graphId},'original-nodes-'+graphId),
      edges=await readPages('graph_edges',{workspace:'original',graphId},'original-edges-'+graphId),
      literal=edges.filter(edge=>edge.kind==='literal');
    need(nodes.length===39&&graph.carePlans?.length===2&&literal.length===98&&literal.every(edge=>edge.status==='resolved'),
      'ELTSS_CONNECTED_ORIGINAL_REFERENCE_GRAPH_CHANGED');
    for(const plan of graph.carePlans){
      const node=(await call('graph_node',{workspace:'original',graphId,recordId:plan.recordId},'original-careplan-graph-'+plan.recordId)).value;
      need(node.resource?.recordId===plan.recordId&&Array.isArray(node.incoming)&&Array.isArray(node.outgoing),
        'ELTSS_CONNECTED_ORIGINAL_CAREPLAN_NODE_CHANGED');
    }
  }
  for(const editionId of native.editionIds)
    await call('edition',{workspace:'original',editionId},'original-edition-'+editionId);
  for(const reviewSetId of native.reviewSetIds){
    const review=(await call('review_set',{workspace:'original',reviewSetId},'original-field-review-'+reviewSetId)).value;
    need(review.fields?.length===56,'ELTSS_CONNECTED_ALL56_REVIEW_REQUIRED');
  }
  for(const assessmentId of native.assessmentIds){
    const assessment=(await call('assessment',{workspace:'original',assessmentId},'original-assessment-'+assessmentId)).value,
      cells=await readPages('assessment_cells',{workspace:'original',assessmentId},'original-field-cells-'+assessmentId);
    need(cells.length===112&&new Set(cells.map(cell=>cell.fieldKey)).size===56&&
      new Set(cells.map(cell=>cell.carePlanId)).size===2,'ELTSS_CONNECTED_COMPLETE_FIELD_OBSERVATIONS_REQUIRED');
    const exported=await retainedExport('assessment-'+assessmentId,'assessment_file',{workspace:'original',assessmentId});
    const file=exported.files.find(item=>item.name===exported.source.payloadFile);
    need(file?.bytes===assessment.cellsFile.bytes&&file.sha256===assessment.cellsFile.sha256,
      'ELTSS_CONNECTED_ORIGINAL_ASSESSMENT_FILE_CHANGED');
    await download('assessment-'+assessmentId,exported);
  }
  for(const decisionId of native.decisionIds)await call('decision',{workspace:'original',decisionId},'original-decision-'+decisionId);
  for(const receivingId of native.receivingIds)await call('receiving',{workspace:'original',receivingId},'original-receiving-'+receivingId);

  // Read the exact saved correction input from its original source context.
  // The native preview and apply return their existing IDs on this replay.
  const correction=retainedSources[native.correctedSourceId].inventory?.sourceContext;
  need(correction?.request&&correction.schema==='stellar-forge.eltss-correction.v1',
    'ELTSS_CONNECTED_ORIGINAL_CORRECTION_REQUIRED');
  const preview=(await call('correction_preview',{workspace:'original',correction:correction.request},
    'receive-original-correction-preview',{once:true})).value;
  need(preview.id===correction.previewId&&preview.requestSha256===correction.requestSha256,
    'ELTSS_CONNECTED_CORRECTION_PREVIEW_CHANGED');
  const applied=(await call('correction_apply',{workspace:'original',apply:{
    previewId:preview.id,expectedRequestSha256:preview.requestSha256}},'receive-original-correction',{once:true})).value;
  need(native.correctionIds.includes(applied.id)&&applied.sourceId===native.correctedSourceId,
    'ELTSS_CONNECTED_CORRECTION_ID_CHANGED');
  for(const comparisonId of native.editionComparisonIds){
    const comparison=(await call('edition_comparison',{workspace:'original',comparisonId},
      'original-edition-comparison-'+comparisonId)).value,
      rows=await readPages('edition_changes',{workspace:'original',comparisonId},'original-resource-changes-'+comparisonId);
    need(comparison.counts.changed===1&&comparison.counts.unchanged===38&&rows.length===39,
      'ELTSS_CONNECTED_ORIGINAL_EDITION_COMPARISON_CHANGED');
    await download('resource-changes-'+comparisonId,await retainedExport('resource-changes-'+comparisonId,
      'edition_changes_file',{workspace:'original',comparisonId}));
  }

  // Full review input crosses the small MCP envelope through its declared host
  // alias. Its unchanged original JSON file is part of the completed export.
  const reviewCall=await call('input_apply',{workspace:'original',input:'full_review',
    expectedSha256:journal.reviewInput.sha256,action:'review_save'},'complete-field-review-input',{once:true}),
    connectedReview=reviewCall.value;
  need(connectedReview.fields?.length===56&&connectedReview.predecessorId===journal.reviewInput.predecessorId&&
    reviewCall.result.files.some(file=>file.name==='original-input.json'&&file.sha256===journal.reviewInput.sha256&&
      file.bytes===journal.reviewInput.bytes),'ELTSS_CONNECTED_ORIGINAL_REVIEW_INPUT_CHANGED');
  journal.exports['complete-native-review-input']=reviewCall.result;await checkpoint();
  await download('complete-native-review-input',reviewCall.result);
  const profile=(await call('profile',{workspace:'original',profileId:connectedReview.profileId},'original56-field-profile')).value;
  need(profile.fields?.length===56,'ELTSS_CONNECTED_SOURCE_PROFILE_CHANGED');
  const connectedAssessment=(await call('assessment_create',{workspace:'original',assessment:{
    editionId:native.correctedEditionId,reviewSetId:connectedReview.id,label:'Complete original fields in connected receiving'}},
    'connected-complete-assessment',{once:true})).value;
  need(connectedAssessment.carePlanIds.length===2,'ELTSS_CONNECTED_CAREPLAN_SELECTION_CHANGED');
  const connectedCells=await readPages('assessment_cells',{workspace:'original',assessmentId:connectedAssessment.id},
    'connected-complete-field-cells');
  need(connectedCells.length===112&&new Set(connectedCells.map(cell=>cell.fieldKey)).size===56,
    'ELTSS_CONNECTED_ALL56_CELLS_REQUIRED');
  await download('connected-assessment',await retainedExport('connected-assessment','assessment_file',
    {workspace:'original',assessmentId:connectedAssessment.id}));
  const connectedHandoff=(await call('handoff_prepare',{workspace:'original',handoff:{
    editionId:native.correctedEditionId,reviewSetId:connectedReview.id,assessmentId:connectedAssessment.id,
    label:'Complete original care-plan connected receiving',scope:'edition',receiver:'Connected local customer workspace',
    decisionIds:native.decisionIds,actor:ACTOR,reason:'Receive the selected original care-plan graph, all56 fields, source predecessors and native datasets through the installed connected operator.'}},
    'connected-complete-handoff',{once:true})).value;
  await call('handoff',{workspace:'original',handoffId:connectedHandoff.id},'connected-handoff-readback');

  // The published raw JSON path is exercised separately from its native source
  // packet. No provider request is made; these are the already-retained128055 bytes.
  const raw=(await call('source_import',{workspace:'customer',input:'published_bundle',
    expectedSha256:native.originalBundle.sha256,label:'Unchanged published STU2 Bundle JSON'},
    'receive-published-raw-bundle',{once:true})).value;
  need(raw.id===native.originalBundle.sha256,'ELTSS_CONNECTED_RAW_SOURCE_BYTES_CHANGED');
  const rawExport=await retainedExport('published-raw-bundle','source_packet',{workspace:'customer',sourceId:raw.id}),
    rawFile=rawExport.files.find(file=>file.name===rawExport.source.payloadFile);
  need(rawExport.kind==='source-packet'&&rawFile?.bytes===128055&&rawFile.sha256===native.originalBundle.sha256,
    'ELTSS_CONNECTED_RAW_JSON_FILE_KIND_CHANGED');
  await download('published-raw-bundle',rawExport,{pause:true});
  journal.rawSourceReceiving=await call('receive_export',{workspace:'original',sourceWorkspace:'customer',
    exportId:rawExport.exportId,expectedManifestSha256:rawExport.manifestSha256,kind:'source',
    label:'Unchanged published Bundle received through the original connected file protocol'},
    'roundtrip-original-json-source',{once:true});
  need(journal.rawSourceReceiving.value.id===raw.id,'ELTSS_CONNECTED_RAW_SOURCE_RECEIVING_CHANGED');

  const {value:savedPlan}=await call('plan',{workspace:'original',planId:native.planId},'original-native-mapping');
  need(savedPlan.id===native.planId&&savedPlan.plan?.schema==='stellar-forge.eltss-mapping.v1',
    'ELTSS_CONNECTED_ORIGINAL_MAPPING_CHANGED');
  await call('mapping_default',{workspace:'original',sourceId:native.correctedSourceId,resourceType:'CarePlan'},
    'original-careplan-mapping-default');
  const projection=(await call('mapping_preview',{workspace:'original',sourceId:native.correctedSourceId,
    plan:savedPlan.plan,limit:2},'original-careplan-mapping-preview')).value;
  need(projection.totalRows===2,'ELTSS_CONNECTED_NATIVE_PROJECTION_CHANGED');
  for(const buildId of native.buildIds){
    const build=(await call('build',{workspace:'original',buildId},'original-native-build-'+buildId)).value;
    need(build.id===buildId&&build.rowCount===2,'ELTSS_CONNECTED_ORIGINAL_BUILD_CHANGED');
    await queryBuild('original',buildId,2,'original-native-pages-'+buildId);
  }
  const comparisonId=native.nativeProjections.comparisonId,
    savedComparison=before.comparisons.find(row=>row.id===comparisonId);
  need(savedComparison?.counts?.changed===1&&savedComparison.counts.unchanged===1,
    'ELTSS_CONNECTED_ORIGINAL_NATIVE_COMPARISON_CHANGED');
  const nativeChanges=await readPages('comparison_changes',{workspace:'original',comparisonId},'native-dataset-edition-changes');
  need(nativeChanges.length===savedComparison.counts.added+savedComparison.counts.removed+savedComparison.counts.changed,
    'ELTSS_CONNECTED_COMPLETE_NATIVE_CHANGES_REQUIRED');
  await download('native-dataset-changes',await retainedExport('native-dataset-changes','comparison_file',
    {workspace:'original',comparisonId}));
  await download('complete-native-dataset',await retainedExport('complete-native-dataset','build_dataset',
    {workspace:'original',buildId:finalBuild}));
  const packet=await retainedExport('customer-packet','build_packet',{workspace:'original',buildId:finalBuild});
  await download('customer-packet',packet);
  const handoff=await retainedExport('connected-handoff','handoff_packet',{workspace:'original',handoffId:connectedHandoff.id});
  await download('connected-handoff',handoff);
  const base=journal.exports['source-'+native.sourceIds.indexOf(native.baseSourceId)+'-packet'];
  journal.sourceReceiving=await call('receive_export',{workspace:'customer',sourceWorkspace:'original',
    exportId:base.exportId,expectedManifestSha256:base.manifestSha256,kind:'source',
    label:'Original source-selected published example'},'receive-original-source-packet',{once:true});
  journal.customerReceiving=await call('receive_export',{workspace:'customer',sourceWorkspace:'original',
    exportId:packet.exportId,expectedManifestSha256:packet.manifestSha256,kind:'packet'},
    'receive-original-customer-packet',{once:true});
  journal.handoffReceiving=await call('receive_export',{workspace:'customer',sourceWorkspace:'original',
    exportId:handoff.exportId,expectedManifestSha256:handoff.manifestSha256,kind:'handoff'},
    'receive-complete-careplan-handoff',{once:true});
  need(journal.handoffReceiving.value.handoffId===connectedHandoff.id&&journal.handoffReceiving.value.reconstructed,
    'ELTSS_CONNECTED_COMPLETE_HANDOFF_RECEIVING_CHANGED');
  journal.artifactReceiving??={};
  for(const artifactId of native.artifactIds){
    const artifact=await retainedExport('original-artifact-'+artifactId,'artifact_file',{workspace:'original',artifactId}),
      info=artifact.source.artifact,original=before.artifacts.find(row=>row.id===artifactId);
    need(artifact.kind==='artifact-file'&&same(info,original)&&
      artifact.files.some(file=>file.name==='original-artifact.json'),'ELTSS_CONNECTED_ORIGINAL_ARTIFACT_METADATA_CHANGED');
    await download('original-artifact-'+artifactId,artifact);
    journal.artifactReceiving[artifactId]=await call('receive_export',{
      workspace:'customer',sourceWorkspace:'original',exportId:artifact.exportId,
      expectedManifestSha256:artifact.manifestSha256,kind:'artifact'},'receive-original-artifact-'+artifactId,{once:true});
    const received=journal.artifactReceiving[artifactId].value,
      payload=artifact.files.find(file=>file.name===artifact.source.payloadFile);
    need(received.name===original.name&&received.contentType===original.contentType&&received.label===original.label&&
      received.file?.sha256===payload.sha256&&received.file.bytes===payload.bytes,
      'ELTSS_CONNECTED_ORIGINAL_JSON_ARTIFACT_CHANGED');
  }
  journal.receivingOperationId??=randomUUID();journal.receivingObservedAt??=now();await checkpoint();
  const observed=(await call('receiving_save',{workspace:'original',receiving:{
    handoffId:connectedHandoff.id,operationId:journal.receivingOperationId,receiver:'Connected local customer workspace',
    state:'received',receivedAt:journal.receivingObservedAt,actor:ACTOR,
    destinationObjectId:journal.handoffReceiving.value.workspaceId+':'+connectedHandoff.id,
    sourceRefs:[{sourceId:native.correctedSourceId,recordId:connectedAssessment.carePlanIds[0]}],
    note:'The complete retained handoff was received by the original local editable receiver. The connected journal and exact retained manifest identify its complete result.'}},
    'record-observed-native-handoff-receiving',{once:true})).value;
  journal.connected={reviewSetId:connectedReview.id,assessmentId:connectedAssessment.id,
    handoffId:connectedHandoff.id,receivingId:observed.id,receivingOperationId:observed.operationId,
    rawSourceId:raw.id};await checkpoint();

  // Freeze after the actual receiving record, then use the native complete
  // archive transaction and original UUID adoption on an empty destination.
  const editable=await retainedExport('editable-workspace','workspace_packet',{workspace:'original'});
  await download('editable-workspace',editable);
  journal.workspaceReceiving=await call('receive_export',{workspace:'restored',sourceWorkspace:'original',
    exportId:editable.exportId,expectedManifestSha256:editable.manifestSha256,kind:'workspace'},
    'receive-original-editable-workspace',{once:true});
  const additional={reviewSets:[...native.reviewSetIds,connectedReview.id],
    assessments:[...native.assessmentIds,connectedAssessment.id],handoffs:[...native.handoffIds,connectedHandoff.id],
    receivings:[...native.receivingIds,observed.id],sources:[...native.sourceIds,raw.id]};
  const restored=includesRecords((await call('state',{workspace:'restored'},'restored-complete-state')).value,{additional}),
    editableFile=editable.files.find(file=>file.name===editable.source.payloadFile);
  need(restored.receives.some(record=>record.state==='complete'&&record.archiveSha256===editableFile.sha256&&
    record.workspaceId===native.workspaceId),'ELTSS_CONNECTED_ORIGINAL_WORKSPACE_RECEIVE_MISSING');
  const customer=(await call('state',{workspace:'customer'},'customer-complete-state')).value;
  need(customer.sources.some(row=>row.id===native.baseSourceId)&&customer.sources.some(row=>row.id===native.correctedSourceId)&&
    customer.plans.some(row=>row.id===native.planId)&&customer.builds.some(row=>row.id===finalBuild)&&
    customer.handoffs.some(row=>row.id===connectedHandoff.id),'ELTSS_CONNECTED_COMPLETE_CUSTOMER_RECEIVING_MISSING');
  await queryBuild('restored',finalBuild,2,'restored-native-cursor');
  await queryBuild('customer',finalBuild,2,'customer-native-cursor');
  const receivedCells=await readPages('assessment_cells',{workspace:'restored',assessmentId:connectedAssessment.id},'restored-all56-fields');
  need(same(receivedCells,connectedCells),'ELTSS_CONNECTED_FIELD_VALUES_CHANGED_AFTER_RESTORE');
  journal.receivedStates=await privateJSON('RECEIVED_STATES.json',{restored,customer});await checkpoint();

  // Closing the MCP host releases only its borrowed connections. The actual
  // native operator and its browser query continue on the exact same instance.
  await closeMerchant();
  need((await operatorIdentity('original')).identity.instanceId===beforeOperator.instanceId,
    'ELTSS_CONNECTED_BORROWED_OPERATOR_CLOSED');
  await browserRun('02-merchant-closed-native-open',2);
  await startMerchant();
  const reopened=includesRecords((await call('state',{workspace:'original'},'original-reopened')).value,{additional});
  need((await operatorIdentity('original')).identity.instanceId===beforeOperator.instanceId,
    'ELTSS_CONNECTED_ORIGINAL_OPERATOR_RESTARTED');
  for(const [key,exported] of Object.entries(journal.exports)){
    const selected={client,workspace:exported.workspace,exportId:exported.exportId,
      expectedManifestSha256:exported.manifestSha256,directory:join(output,'downloads',key)};
    journal.downloads[key].afterMerchantReopen={inspected:await inspectEltssExport(selected),
      local:await reopenEltssExport(selected)};await checkpoint();
  }
  const restoredReopened=includesRecords((await call('state',{workspace:'restored'},'restored-reopened')).value,{additional});
  await queryBuild('restored',finalBuild,2,'restored-reopened-native-cursor');
  await browserRun('03-merchant-reopened-same-native',2);
  await captures();need(browserErrors.length===0,'ELTSS_CONNECTED_BROWSER_ERRORS',JSON.stringify(browserErrors));
  await browser.close();browser=null;
  await closeMerchant();
  journal.operatorClosures=[];
  for(const owner of owners)journal.operatorClosures.push(await owner.release());
  await checkpoint();
  const result={schema:SCHEMA,operation:OPERATION,completedAt:now(),nativeReceiving:binding,
    sourceFiles:journal.sourceFiles,sourceEditions:journal.sourceEditions,
    workspace:paths.original,workspaceId:native.workspaceId,originalOperator:beforeOperator,
    sourceIds:native.sourceIds,editionIds:native.editionIds,reviewSetIds:native.reviewSetIds,
    assessmentIds:native.assessmentIds,graphIds:native.graphIds,carePlanIds:native.carePlanIds,
    planId:native.planId,buildIds:native.buildIds,editionComparisonIds:native.editionComparisonIds,
    connected:journal.connected,completeFieldCells:connectedCells.length,configuration,
    merchantRuns:journal.merchantRuns,operatorRuns:journal.operatorRuns,operatorClosures:journal.operatorClosures,
    exports:journal.exports,downloads:journal.downloads,partialDownloads:journal.partialDownloads,receiving:{
      rawSource:journal.rawSourceReceiving,source:journal.sourceReceiving,customer:journal.customerReceiving,
      handoff:journal.handoffReceiving,artifacts:journal.artifactReceiving,workspace:journal.workspaceReceiving,
      customerDirectory:paths.customer,restoredDirectory:paths.restored},
    originalReopened:await privateJSON('ORIGINAL_REOPENED.json',reopened),
    restoredReopened:await privateJSON('RESTORED_REOPENED.json',restoredReopened),
    browserRuns:journal.browserRuns,browserRequests:journal.browserRequests,browserErrors,journey:journalPath};
  const completed=await privateJSON('OPERATED_CONNECTED_ELTSS.json',result);
  journal.completedAt=result.completedAt;journal.result=completed;await checkpoint();
  process.stdout.write(JSON.stringify({state:'complete',operation:OPERATION,result:completed,
    workspaceId:native.workspaceId,buildId:finalBuild,fieldCells:connectedCells.length,
    completeDownloads:Object.keys(journal.downloads).length})+'\n');
}catch(error){
  if(journal){journal.failures.push({at:now(),code:error.code??null,message:error.message});await checkpoint().catch(()=>{});}
  throw error;
}finally{
  await captures().catch(()=>{});
  if(browser)await browser.close().catch(()=>{});
  await closeMerchant().catch(()=>{});
  for(const owner of owners.reverse())await owner.close().catch(()=>{});
  if(lease)await lease.close();
}
