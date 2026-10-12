#!/usr/bin/env node
// MIT. Operate the actual saved Gravity referral workspace through the original merchant host.
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {absolute,privateDirectory,readJSON,saveJSON,digest,operationLease,need,now}
  from '../../../distribution/runtime-workspace/storage.mjs';
import {startMerchantMcp} from '../../../../../stellar-forge/mcp-merchant-operator/serve.mjs';
import {readGravityReferralConfiguration,GravityReferralConnection} from './connection.mjs';
import {readSourceFile,fileIdentity,immutable} from './files.mjs';
import {CONNECTION_SCHEMA,OPERATOR_SCHEMA,WORKSPACE_SCHEMA,SHA,UUID,OPERATION_ID,canonical}
  from './contracts.mjs';
import {initializeGravityReferralMerchant} from './setup.mjs';
import {openGravityReferralMerchantClient,readGravityReferralValue,downloadGravityReferralExport,inspectGravityReferralExport,reopenGravityReferralExport}
  from './client.mjs';
import {gravityReferralMerchantTools,referralCollections} from './catalog.mjs';

const SCHEMA='stellar-forge.gravity-referral-connected-receiving.v1';
const OPERATION='SCF-GRAVITY-REFERRAL-CONNECTED-450E-20261012';
const ACTOR='Commons Gravity connected receiving operator';
const HERE=dirname(fileURLToPath(import.meta.url)),REFERRAL=resolve(HERE,'..'),REPO=resolve(HERE,'../../../../..');
const CLI=join(REFERRAL,'cli.py'),options={};
for(let i=2;i<process.argv.length;i+=2){
  const flag=process.argv[i],value=process.argv[i+1];
  need(['--receiving','--out','--workspace','--original-examples','--original-definitions','--chromium','--playwright','--credentials-file'].includes(flag) &&
    value && !value.startsWith('--') && !Object.hasOwn(options,flag),
  'GRAVITY_REFERRAL_CONNECTED_RECEIVING_ARGUMENTS','Use --receiving ABS/OPERATED_GRAVITY_REFERRAL.json --out ABS/PRIVATE_OUTPUT [--workspace ABS/RESTORED_WORKSPACE] [--original-examples ABS/EXAMPLES.zip] [--original-definitions ABS/DEFINITIONS.zip] [--chromium ABS] [--playwright ABS].');
  options[flag]=absolute(value);
}
for(const key of ['--receiving','--out'])need(options[key],'GRAVITY_REFERRAL_CONNECTED_RECEIVING_ARGUMENT_REQUIRED',key);
need(Number(process.versions.node.split('.')[0])>=22,'GRAVITY_REFERRAL_CONNECTED_NODE_REQUIRED','Use Node 22 or newer.');
const output=options['--out'];
await mkdir(output,{mode:0o700,recursive:true});await privateDirectory(output);
let lease,journal,merchant,client,browser,page,configuration;
const owners=[],browserErrors=[],pendingCaptures=new Set();
let captureFailure=null,writes=Promise.resolve();
const journalPath=join(output,'CONNECTED_JOURNEY.json');
const nativeBytes=await readSourceFile(options['--receiving'],{maxBytes:64*1024*1024}),
  native=JSON.parse(nativeBytes.toString('utf8'));
const SHA_RE=new RegExp(SHA),UUID_RE=new RegExp(UUID);
const nativeCollections={
  configurations:'configurationIds',editions:'editionIds',reviews:'reviewIds',assessments:'assessmentIds',
  decisions:'decisionIds',corrections:'correctionIds',comparisons:'comparisonIds',
  handoffs:'handoffIds',receivings:'receivingIds',exchangeRequests:'exchangeRequestIds',
  exchangeOperations:'exchangeOperationIds',monitoring:'monitoringIds'
};
need(native.schema==='stellar-forge.gravity-referral-operated.v1' &&
  native.operation==='SCF-GRAVITY-REFERRAL-WORKSPACE-450E-20261012' &&
  typeof native.completedAt==='string' && typeof native.workspace==='string' && UUID_RE.test(native.workspaceId??'') &&
  ['sourceIds','configurationIds','editionIds','reviewIds','assessmentIds','decisionIds','correctionIds',
    'comparisonIds','handoffIds','receivingIds','exchangeRequestIds','exchangeOperationIds','monitoringIds',
    'acquisitionOperationIds','buildIds','artifactIds'].every(key=>Array.isArray(native[key]) &&
      native[key].every(id=>key.endsWith('OperationIds')?typeof id==='string'&&new RegExp(OPERATION_ID).test(id):SHA_RE.test(id))) &&
  ['sourceIds','editionIds','reviewIds','assessmentIds','correctionIds','buildIds','handoffIds'].every(key=>native[key].length) &&
  ['baseSourceId','baseEditionId','baseAssessmentId','correctedSourceId','correctedEditionId','correctedAssessmentId','planId']
    .every(key=>SHA_RE.test(native[key]??'')) &&
  ['originalExamples','originalDefinitions'].every(key=>native[key]&&typeof native[key].file==='string' &&
    Number.isSafeInteger(native[key].bytes)&&native[key].bytes>0&&native[key].bytes<=256*1024*1024&&
    SHA_RE.test(native[key].sha256??'')&&typeof native[key].url==='string'),
'GRAVITY_REFERRAL_CONNECTED_COMPLETE_NATIVE_REQUIRED',
'Select the complete original published Gravity source, original review, correction, native dataset and receiving result.');
const originalExamplesFile=absolute(options['--original-examples']??native.originalExamples.file),
  originalDefinitionsFile=absolute(options['--original-definitions']??native.originalDefinitions.file);
const binding={receiving:options['--receiving'],receivingSha256:digest(nativeBytes),
  workspace:absolute(options['--workspace']??native.workspace),workspaceId:native.workspaceId,sourceRoot:REFERRAL,
  credentialsFile:options['--credentials-file']??null,
  ...(options['--workspace']?{nativeWorkspace:absolute(native.workspace)}:{}),
  ...(options['--original-examples']?{originalExamplesFile}:{}),
  ...(options['--original-definitions']?{originalDefinitionsFile}:{})};
const paths={original:binding.workspace,customer:join(output,'customer-workspace'),
  handed:join(output,'handoff-workspace'),restored:join(output,'restored-workspace')};
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
  need(bytes.length===selected.bytes&&digest(bytes)===selected.sha256,'GRAVITY_REFERRAL_CONNECTED_RECEIVING_FILE_CHANGED',selected.file);
  return JSON.parse(bytes.toString('utf8'));
}
async function sourceIdentities(){
  const relative=[
    ...['contracts.mjs','files.mjs','connection.mjs','catalog.mjs','runtime.mjs','provider.mjs','client.mjs',
      'client.d.mts','setup.mjs','cli.mjs','README.md','RECEIVING.mjs'].map(name=>'connected/'+name),
    'referral_runtime.py','referral_schema.py','referral_domain.py','referral_workspace.py',
    'referral_exchange.py','referral_receiving.py','referral_server.py','referral-schema.json',
    'referral-profile.json','gravity-source.json','cli.py','cli.mjs','HTTP_API.md',
    'public/index.html','public/app.js','public/style.css'
  ];
  const selected={};
  for(const name of relative)selected[name]=await fileIdentity(join(REFERRAL,name),{maxBytes:8*1024*1024});
  for(const name of ['stellar-forge/mcp-merchant-operator/serve.mjs',
    'stellar-forge/mcp-merchant-operator/retained-download.mjs',
    'stellar-forge/mcp-merchant-operator/retained-file-reads.mjs',
    'stellar-forge/mcp-merchant-operator/host-files.mjs',
    'stellar/scf-starforge-20261009/distribution/contributions/gravity-referrals.json',
    'stellar/scf-starforge-20261009/distribution/contributions/gravity-referrals-connected.json',
    ...['contracts.mjs','connection.mjs','runtime.mjs'].map(file=>
      'stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_eltss/connected/'+file)])
    selected['repository/'+name]=await fileIdentity(join(REPO,name),{maxBytes:4*1024*1024});
  return selected;
}
async function initializeWorkspace(alias){
  const directory=paths[alias],marker=join(directory,'eltss','identity.json');
  try{return JSON.parse((await readSourceFile(marker,{privateFile:true,maxBytes:4096})).toString('utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  need(alias!=='original','GRAVITY_REFERRAL_CONNECTED_ORIGINAL_REQUIRED');
  const python=process.env.SF30_REFERRAL_PYTHON??process.env.SF30_XML_PYTHON??
    process.env.CODEX_PRIMARY_RUNTIME_PYTHON??'python3';
  const child=spawn(python,['-B',CLI,'init','--workspace',directory],{
    stdio:['ignore','pipe','pipe'],env:{...process.env,SF30_REFERRAL_NODE:process.execPath,SF30_XML_NODE:process.execPath}});
  let stdout='',stderr='',overflow=false;
  child.stdout.on('data',bytes=>{stdout+=bytes.toString('utf8');if(Buffer.byteLength(stdout)>8*1024*1024){overflow=true;child.kill('SIGTERM');}});
  child.stderr.on('data',bytes=>{stderr=(stderr+bytes.toString('utf8')).slice(-65536);});
  const timer=setTimeout(()=>child.kill('SIGTERM'),60000);let exit;
  try{exit=await new Promise((accept,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>accept({code,signal}));});}
  finally{clearTimeout(timer);}
  const record=await privateJSON(alias+'-native-initialization.json',{exit,stdout,stderr,overflow});
  need(exit.code===0&&!overflow,'GRAVITY_REFERRAL_CONNECTED_NATIVE_INIT_FAILED',record.file);
  const result=JSON.parse((await readSourceFile(marker,{privateFile:true,maxBytes:4096})).toString('utf8'));
  need(result.schema===WORKSPACE_SCHEMA&&new RegExp(UUID).test(result.workspaceId??''),'GRAVITY_REFERRAL_CONNECTED_TARGET_IDENTITY');
  return result;
}
async function saveConfiguration(name,inputs={}){
  const path=join(output,name),value={schema:CONNECTION_SCHEMA,workspaces:{
    original:{directory:paths.original,label:'Original published-source Gravity referral workspace',allowStart:true,
      ...(options['--credentials-file']?{credentialsFile:options['--credentials-file']}:{})},
    customer:{directory:paths.customer,label:'Received original referral source and native dataset',allowStart:true},
    handed:{directory:paths.handed,label:'Received complete original Gravity handoff',allowStart:true},
    restored:{directory:paths.restored,label:'Received original editable Gravity workspace',allowStart:true}
  }};
  for(const [alias,selected] of Object.entries(inputs))value.workspaces[alias].inputs=selected;
  try{const current=JSON.parse((await readSourceFile(path,{privateFile:true,maxBytes:1024*1024})).toString('utf8'));
    need(same(current,value),'GRAVITY_REFERRAL_CONNECTED_CONFIGURATION_CHANGED');}
  catch(error){if(error.code!=='ENOENT')throw error;await saveJSON(path,value,true);}
  return path;
}
async function operatorIdentity(alias){
  const saved=JSON.parse((await readSourceFile(join(paths[alias],'referral','operator-connection.json'),
    {privateFile:true,maxBytes:65536})).toString('utf8'));
  need(saved.schema===OPERATOR_SCHEMA && saved.active && saved.workspace===paths[alias],
    'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_OPERATOR_REQUIRED');
  const response=await fetch(new URL('/api/operator',saved.url),{
    headers:{Authorization:'Bearer '+saved.accessToken},redirect:'error',signal:AbortSignal.timeout(30000)});
  need(response.ok,'GRAVITY_REFERRAL_CONNECTED_OPERATOR_READ_FAILED');
  const identity=await response.json();
  need(identity.instanceId===saved.instanceId && identity.workspaceId===saved.workspaceId &&
    identity.processId===saved.processId,'GRAVITY_REFERRAL_CONNECTED_OPERATOR_CHANGED');
  return {identity,url:saved.url+'#'+saved.accessToken};
}
async function readOriginal(path){
  const saved=JSON.parse((await readSourceFile(join(paths.original,'referral','operator-connection.json'),
    {privateFile:true,maxBytes:65536})).toString('utf8'));
  need(saved.active&&saved.workspaceId===native.workspaceId,'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_OPERATOR_REQUIRED');
  const response=await fetch(new URL(path,saved.url),{redirect:'error',signal:AbortSignal.timeout(600000),
    headers:{Authorization:'Bearer '+saved.accessToken,Accept:'application/json'}});
  need(response.ok,'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_READ_FAILED',path);
  return response.json();
}
async function prepareInputs(){
  const inputs={};
  for(const [key,file] of [['originalExamples',originalExamplesFile],['originalDefinitions',originalDefinitionsFile]]){
    const actual=await fileIdentity(file,{maxBytes:256*1024*1024});
    need(actual.bytes===native[key].bytes&&actual.sha256===native[key].sha256,
      'GRAVITY_REFERRAL_CONNECTED_PUBLISHED_SOURCE_CHANGED',key);
    inputs[key]={file,...actual};
  }
  const assessment=await readOriginal('/api/referrals/records/assessments/'+native.correctedAssessmentId),
    review=await readOriginal('/api/referrals/records/reviews/'+assessment.reviewId),
    original=await readOriginal('/api/sources/'+native.baseSourceId),
    context=original.inventory?.sourceContext;
  need(review.requirements?.length===57&&review.fields?.length===24&&review.id===assessment.reviewId,
    'GRAVITY_REFERRAL_CONNECTED_COMPLETE_REVIEW_REQUIRED');
  need(context?.schema==='stellar-forge.gravity-published-example-context.v1' &&
    context.archiveSha256===native.originalExamples.sha256 && context.classification==='published_example',
    'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_CONTEXT_REQUIRED');
  const selection=Object.fromEntries(['label','actor','note','publicationUrl','referenceBase'].filter(k=>Object.hasOwn(context,k))
    .map(k=>[k,context[k]]));
  const value={label:'Complete source-selected requirement and field review through connected receiving',
    profileId:review.profileId,predecessorId:review.id,requirements:review.requirements,fields:review.fields,actor:ACTOR,
    note:'Retains every original requirement and field disposition, owner, source reference and target mapping from the operated review. This connected receiving records the same selected source semantics.'};
  const file=join(output,'complete-native-referral-review-input.json'),bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
  await immutable(file,bytes);
  journal.reviewInput={file,...await fileIdentity(file,{maxBytes:4*1024*1024}),predecessorId:review.id};
  journal.publishedSelection=selection;journal.originalFiles=inputs;
  journal.connectedAsOf??=assessment.asOf;
  need(typeof journal.connectedAsOf==='string','GRAVITY_REFERRAL_CONNECTED_ORIGINAL_AS_OF_REQUIRED');
  await checkpoint();
  return {original:{full_review:{file,sha256:journal.reviewInput.sha256,label:'Complete original57-requirement and24-field review'}},
    customer:{published_examples:{file:originalExamplesFile,sha256:inputs.originalExamples.sha256,label:'Complete unchanged published Gravity examples ZIP'},
      published_definitions:{file:originalDefinitionsFile,sha256:inputs.originalDefinitions.sha256,label:'Complete unchanged published Gravity definitions ZIP'}}};
}
async function startMerchant(){
  const token=randomBytes(32).toString('base64url'),tokenEnv='GRAVITY_REFERRAL_CONNECTED_RECEIVING_MCP_CODE',
    environment={...process.env,[tokenEnv]:token};
  merchant=await startMerchantMcp({configPath:configuration,port:0,tokenEnv,environment});
  client=await openGravityReferralMerchantClient({url:merchant.url,tokenEnv,environment});
  journal.merchantRuns.push({startedAt:now(),url:merchant.url,configuration});await checkpoint();
}
async function closeMerchant(){
  if(client){await client.close();client=null;}
  if(merchant){await merchant.close();merchant=null;journal.merchantRuns.at(-1).closedAt=now();await checkpoint();}
}
async function call(action,args={},label=action,{once=false}={}){
  let request=once?journal.actions[label]:null;
  if(request){
    need(request.action===action&&same(request.arguments,args),'GRAVITY_REFERRAL_CONNECTED_REQUEST_CHANGED',label);
    const index=journal.calls.findIndex(row=>row.sequence===request.sequence);
    if(index>=0)request=journal.calls[index];
    else{request.sequence=journal.calls.length+1;journal.calls.push(request);}
    journal.actions[label]=request;
    if(request.state==='COMPLETE')return checkedJSON(request.original);
    const current=await client.state({workspace:args.workspace});
    need(current.retention?.state==='COMPLETE'&&current.native?.ok,'GRAVITY_REFERRAL_CONNECTED_RECOVERY_READ_REQUIRED');
    request.reconciliation=current;await checkpoint();
  }else{
    request={sequence:journal.calls.length+1,key:label,action,arguments:args,startedAt:now(),state:'REQUESTED',attempts:[]};
    if(once)journal.actions[label]=request;
    journal.calls.push(request);await checkpoint();
  }
  const attempt={startedAt:now()};request.attempts.push(attempt);await checkpoint();
  try{
    const result=await client.call(action,args,{timeoutMs:600000});
    attempt.result=result;attempt.returnedAt=now();await checkpoint();
    need(result.state==='COMPLETED'&&result.retention?.state==='COMPLETE'&&result.native?.ok,
      'GRAVITY_REFERRAL_CONNECTED_NATIVE_ACTION_FAILED',action+' returned '+JSON.stringify(result));
    const value=await readGravityReferralValue({client,result});
    request.original=await privateJSON('call-'+String(request.sequence).padStart(5,'0')+'.json',{result,value});
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
      (total===null||value.total===undefined||value.total===total),'GRAVITY_REFERRAL_CONNECTED_PAGE_CHANGED',label);
    if(value.total!==undefined)total=value.total;
    rows.push(...value.rows);
    if(value.nextOffset===null){need(total===null||rows.length===total,'GRAVITY_REFERRAL_CONNECTED_PAGE_INCOMPLETE',label);return rows;}
    need(Number.isSafeInteger(value.nextOffset)&&value.nextOffset===offset+value.rows.length&&value.nextOffset>offset,
      'GRAVITY_REFERRAL_CONNECTED_PAGE_NOT_ADVANCING',label);
    offset=value.nextOffset;
  }
}
async function retainedExport(key,action,args){
  if(journal.exports[key]){
    const retained=journal.exports[key],info=await client.manifest({workspace:retained.workspace,exportId:retained.exportId});
    need(info.manifestFile?.sha256===retained.manifestSha256,'GRAVITY_REFERRAL_CONNECTED_EXPORT_CHANGED',key);return retained;
  }
  const retained=await client.call(action,args,{timeoutMs:600000});
  need(retained.state==='COMPLETED'&&retained.retention?.state==='COMPLETE'&&retained.native?.ok,
    'GRAVITY_REFERRAL_CONNECTED_COMPLETE_EXPORT_REQUIRED',key);
  journal.exports[key]=retained;await checkpoint();return retained;
}
async function download(key,retained,{pause=false}={}){
  const directory=join(output,'downloads',key);
  await mkdir(dirname(directory),{recursive:true,mode:0o700});await privateDirectory(dirname(directory));
  const selected={client,workspace:retained.workspace,exportId:retained.exportId,
    expectedManifestSha256:retained.manifestSha256,directory};
  if(pause&&!journal.partialDownloads[key]){
    try{
      await downloadGravityReferralExport({...selected,chunkSize:32768,onProgress:async progress=>{
        if(progress.bytes>0&&progress.bytes<progress.total&&!journal.partialDownloads[key]){
          journal.partialDownloads[key]={state:'PAUSED',at:now(),...progress};await checkpoint();
          throw Object.assign(new Error('Operator paused after a durably saved original file prefix.'),{code:'GRAVITY_REFERRAL_RECEIVING_PAUSE'});
        }
      }});
    }catch(error){if(error.code!=='GRAVITY_REFERRAL_RECEIVING_PAUSE')throw error;}
    need(journal.partialDownloads[key]?.bytes>0,'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_PREFIX_REQUIRED',key);
  }
  const received=await downloadGravityReferralExport(selected),inspected=await inspectGravityReferralExport(selected),
    reopened=await reopenGravityReferralExport(selected),files=[];
  if(pause)need(received.resumed&&received.resumedBytes>=journal.partialDownloads[key].bytes,
    'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_PREFIX_NOT_RESUMED',key);
  for(const original of retained.files){
    const path=join(directory,original.name),actual=await fileIdentity(path,{maxBytes:576*1024*1024});
    need(actual.bytes===original.bytes&&actual.sha256===original.sha256,'GRAVITY_REFERRAL_CONNECTED_RECEIVED_FILE_CHANGED',original.name);
    files.push({file:path,...original});
  }
  journal.downloads[key]={received,inspected,reopened,files};await checkpoint();return journal.downloads[key];
}
function includesRecords(state,{workspaceId=native.workspaceId,additional={},referralAdditional={}}={}){
  need(state.schema===WORKSPACE_SCHEMA&&state.workspaceId===workspaceId &&
    state.referral?.schema==='stellar-forge.gravity-referral.v1'&&state.referral.workspaceId===workspaceId,
    'GRAVITY_REFERRAL_CONNECTED_WORKSPACE_CHANGED');
  const required={sources:native.sourceIds,builds:native.buildIds,plans:[native.planId],
    artifacts:native.artifactIds,...additional};
  for(const [key,ids] of Object.entries(required))
    need(Array.isArray(state[key])&&ids.every(id=>state[key].some(item=>item.id===id)),
      'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_RECORD_MISSING',key);
  const referrals={...Object.fromEntries(Object.entries(nativeCollections).map(([collection,key])=>[collection,native[key]])),
    ...referralAdditional};
  for(const [key,ids] of Object.entries(referrals))
    need(Array.isArray(state.referral[key])&&ids.every(id=>state.referral[key].some(item=>item.id===id)),
      'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_RECORD_MISSING','referral.'+key);
  return state;
}
async function queryBuild(workspace,buildId,expectedRows,label){
  let query={limit:'1'},seen=0,total=null;const pages=[];
  for(;;){
    const {value}=await call('build_query',{workspace,buildId,query},label+'-'+seen);
    const body=value.response?.body;
    need(value.response?.status===200&&body?.page?.total===expectedRows,'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_QUERY_CHANGED',label);
    const rows=body.rows??body.data;
    need(Array.isArray(rows),'GRAVITY_REFERRAL_CONNECTED_NATIVE_QUERY_ROWS',label);
    total=body.page.total;seen+=rows.length;pages.push(value);
    const cursor=body.page.nextCursor??body.page.next_cursor??body.nextCursor;
    if(!cursor){need(seen===total,'GRAVITY_REFERRAL_CONNECTED_QUERY_INCOMPLETE',label);break;}
    need(typeof cursor==='string'&&rows.length>0,'GRAVITY_REFERRAL_CONNECTED_QUERY_CURSOR',label);query={limit:'1',cursor};
  }
  return pages;
}
async function ready(){
  await page.waitForFunction(()=>document.body.dataset.ready==='true' &&
    document.querySelector('#content')?.getAttribute('aria-busy')==='false' &&
    document.body.getAttribute('aria-busy')!=='true',null,{timeout:60000});
  const error=await page.locator('#notice[data-kind="error"]').count()?await page.locator('#notice[data-kind="error"]').textContent():null;
  need(!error,'GRAVITY_REFERRAL_CONNECTED_BROWSER_NATIVE_ERROR',error??'');
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
  await page.locator('[data-nav="queue"]').click();await ready();
  await page.locator('[data-nav="datasets"]').click();await ready();
  const buildId=native.buildIds.at(-1),form=page.locator('#dataset-query-form');
  await form.locator('select[name="buildId"]').selectOption(buildId);
  await form.locator('textarea[name="query"]').fill(JSON.stringify({limit:'1'}));
  const target='/api/builds/'+encodeURIComponent(buildId)+'/query';
  const [response]=await Promise.all([
    page.waitForResponse(value=>new URL(value.url()).pathname===target,{timeout:120000}),
    form.getByRole('button',{name:'Run native query',exact:true}).click()
  ]);
  const value=await response.json();
  need(response.ok()&&value.response?.status===200&&value.response.body?.page?.total===expectedRows,
    'GRAVITY_REFERRAL_CONNECTED_BROWSER_QUERY_CHANGED');
  await ready();await captures();await page.locator('#detail-body').waitFor({state:'visible'});
  const queryScreen=await screen(label);
  await page.locator('#close-detail').click();
  await page.locator('[data-nav="receiving"]').click();await ready();
  const result={at:now(),operator:original.identity,buildId,query:value,screen:queryScreen};
  journal.browserRuns.push(result);await checkpoint();return result;
}
function payload(retained){
  const selected=retained.files.filter(file=>file.name===retained.source.payloadFile);
  need(selected.length===1,'GRAVITY_REFERRAL_CONNECTED_COMPLETE_PAYLOAD_REQUIRED');return selected[0];
}
async function downloadedJSON(key,retained){
  const received=await download(key,retained),file=received.files.find(row=>row.name===retained.source.payloadFile);
  return checkedJSON(file);
}
async function assessmentView(workspace,assessmentId,label){
  const assessment=(await call('referral_record',{workspace,collection:'assessments',recordId:assessmentId},label+'-record')).value,
    edition=(await call('referral_record',{workspace,collection:'editions',recordId:assessment.editionId},label+'-edition')).value,
    review=(await call('referral_record',{workspace,collection:'reviews',recordId:assessment.reviewId},label+'-review')).value;
  const groups={};
  for(const kind of ['tasks','findings','cells','decisions'])
    groups[kind]=await readPages('referral_assessment_'+kind,{workspace,assessmentId},label+'-'+kind);
  need(groups.tasks.length===edition.taskIds.length&&same(groups.tasks.map(row=>row.taskId),edition.taskIds) &&
    review.requirements.length===57&&review.fields.length===24 &&
    groups.cells.length===edition.taskIds.length*review.fields.length,
    'GRAVITY_REFERRAL_CONNECTED_COMPLETE_ASSESSMENT_REQUIRED',label);
  const pairs=new Set(groups.cells.map(row=>row.taskId+':'+(row.fieldKey??row.key)));
  need(pairs.size===groups.cells.length&&edition.taskIds.every(id=>review.fields.every(field=>pairs.has(id+':'+field.key))),
    'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_FIELD_SELECTION_CHANGED',label);
  const retained=await retainedExport(label+'-complete-file','referral_assessment_file',{workspace,assessmentId}),
    original=payload(retained);
  need(retained.kind==='referral-assessment-file'&&original.bytes===assessment.reportFile.bytes &&
    original.sha256===assessment.reportFile.sha256,'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_ASSESSMENT_FILE_CHANGED');
  const full=await downloadedJSON(label+'-complete-file',retained);
  need(full.editionId===edition.id&&full.reviewId===review.id&&Object.entries(groups).every(([key,rows])=>same(full[key],rows)),
    'GRAVITY_REFERRAL_CONNECTED_ASSESSMENT_PAGE_FILE_CHANGED');
  return {assessment,edition,review,...groups};
}

try{
  lease=await operationLease(join(output,'connected-receiving.lock'));
  const sources=await sourceIdentities();
  try{journal=await readJSON(journalPath);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(journal){
    need(journal.schema===SCHEMA&&journal.operation===OPERATION&&same(journal.binding,binding),
      'GRAVITY_REFERRAL_CONNECTED_RECEIVING_IDENTITY_CHANGED','Continue this exact original receiving and private destination.');
    if(!same(journal.sourceFiles,sources)){
      journal.sourceEditions.push({at:now(),files:sources});journal.sourceFiles=sources;
    }
  }else{
    journal={schema:SCHEMA,operation:OPERATION,createdAt:now(),binding,sourceFiles:sources,
      sourceEditions:[{at:now(),files:sources}],calls:[],actions:{},exports:{},downloads:{},partialDownloads:{},
      merchantRuns:[],operatorRuns:[],browserRuns:[],browserRequests:[],failures:[]};
  }
  await checkpoint();
  for(const alias of ['customer','handed','restored'])await initializeWorkspace(alias);
  const bootstrap=await saveConfiguration('native-operator-bindings.json'),
    originalBindings=await readGravityReferralConfiguration(bootstrap);
  need(originalBindings.workspaces.original.workspaceId===native.workspaceId,
    'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_WORKSPACE_CHANGED');
  // The outer owners keep these same native servers alive across Merchant
  // restart. An already-owned Applications server is borrowed without takeover.
  for(const [alias,bound] of Object.entries(originalBindings.workspaces)){
    const owner=new GravityReferralConnection(bound);owners.push(owner);
    const opened=await owner.open();journal.operatorRuns.push({alias,at:now(),...opened});await checkpoint();
  }
  const beforeOperator=(await operatorIdentity('original')).identity,
    inputs=await prepareInputs(),configPath=await saveConfiguration('gravity-referral-connections.json',inputs);
  const setup=await initializeGravityReferralMerchant({directory:join(output,'merchant'),connection:configPath,
    name:'Original Gravity referral connected receiving'});
  configuration=setup.configuration;journal.setup=setup;await checkpoint();
  let playwright;
  if(options['--playwright'])playwright=await import(pathToFileURL(options['--playwright']).href);
  else{
    try{playwright=await import('playwright');}
    catch(error){
      need(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'GRAVITY_REFERRAL_CONNECTED_PLAYWRIGHT_REQUIRED');
      playwright=createRequire(import.meta.url)(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'));
    }
  }
  browser=await playwright.chromium.launchPersistentContext(join(output,'browser-profile'),{
    headless:true,acceptDownloads:true,viewport:{width:1440,height:1080},
    ...(options['--chromium']?{executablePath:options['--chromium']}:{})});
  page=browser.pages()[0]??await browser.newPage();watchPage();
  await startMerchant();
  const catalogue=await client.schema();
  need(catalogue.tools?.length===gravityReferralMerchantTools.length&&
    catalogue.inheritedActionCount===77&&catalogue.referralInputSchemas&&
    new Set(catalogue.tools.map(row=>row.name)).size===gravityReferralMerchantTools.length&&
    gravityReferralMerchantTools.every(tool=>catalogue.tools.some(row=>row.name===tool.name)),
    'GRAVITY_REFERRAL_CONNECTED_COMPLETE_CATALOGUE_REQUIRED');
  journal.connectedCatalogue=await privateJSON('CONNECTED_CATALOGUE.json',catalogue);
  const before=includesRecords((await call('state',{workspace:'original'},'original-before')).value);
  journal.originalBefore=await privateJSON('ORIGINAL_BEFORE.json',before);await checkpoint();
  const finalBuild=native.buildIds.at(-1),expectedRows=before.builds.find(item=>item.id===finalBuild)?.rowCount;
  need(Number.isSafeInteger(expectedRows)&&expectedRows>0,'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_BUILD_REQUIRED');
  await browserRun('01-original-referral-operator',expectedRows);
  await call('catalogue',{workspace:'original'},'inherited-native-source-catalogue');
  await call('referral_catalogue',{workspace:'original'},'native-referral-catalogue');
  await call('auth_profiles',{workspace:'original'},'native-auth-profile-metadata');
  const profile=(await call('referral_profile',{workspace:'original'},'complete-original-referral-profile')).value;
  need(profile.requirements?.length===57&&profile.fields?.length===24,
    'GRAVITY_REFERRAL_CONNECTED_COMPLETE_PROFILE_REQUIRED');

  // The complete installed original guidance travels as its unchanged source
  // envelope. Selected original filenames remain usable FSH/JSON/text files.
  const guidance=(await call('referral_guidance',{workspace:'original'},'complete-original-guidance-index')).value;
  need(Array.isArray(guidance.files)&&guidance.files.length,'GRAVITY_REFERRAL_CONNECTED_GUIDANCE_REQUIRED');
  const guideExport=await retainedExport('original-guidance','referral_guidance_packet',{workspace:'original'});
  need(guideExport.kind==='referral-guidance-packet','GRAVITY_REFERRAL_CONNECTED_JSON_FILE_KIND_CHANGED');
  const guideDownload=await download('original-guidance',guideExport,{pause:true}),
    guideFile=guideDownload.files.find(row=>row.name===guideExport.source.payloadFile),
    guideOriginal=await checkedJSON(guideFile);
  need(Array.isArray(guideOriginal.files)&&guideOriginal.files.length===guidance.files.length,
    'GRAVITY_REFERRAL_CONNECTED_GUIDANCE_MEMBER_COUNT_CHANGED');
  for(const file of guideOriginal.files){
    const declared=guidance.files.find(row=>row.path===file.path),bytes=Buffer.from(file.content,'utf8');
    need(declared&&bytes.length===declared.bytes&&digest(bytes)===declared.sha256,
      'GRAVITY_REFERRAL_CONNECTED_GUIDANCE_BYTES_CHANGED',file.path);
  }
  const guidanceMembers=[guidance.files.find(row=>row.path.endsWith('.fsh')),
    guidance.files.find(row=>row.path.endsWith('.json')),
    guidance.files.find(row=>/\.md$|\.txt$/.test(row.path))].filter(Boolean);
  for(const [i,member] of guidanceMembers.entries()){
    const key='original-guidance-member-'+i,
      retained=await retainedExport(key,'referral_guidance_file',{workspace:'original',member:member.path}),
      original=payload(retained);
    need(retained.kind==='referral-guidance-file'&&original.name===member.path.split('/').at(-1)&&
      original.bytes===member.bytes&&original.sha256===member.sha256,
      'GRAVITY_REFERRAL_CONNECTED_GUIDANCE_FILENAME_OR_BYTES_CHANGED',member.path);
    await download(key,retained);
  }

  // Read every original resource and complete source packet. The packet
  // preserves every original archive member; selected files exercise the same
  // streaming route independently, including JSON and the complete source ZIP.
  const retainedSources={},sourceRows={},sourceExports={};
  for(const [sourceIndex,sourceId] of native.sourceIds.entries()){
    const sourceRecord=(await call('source',{workspace:'original',sourceId},'original-source-'+sourceId)).value;
    retainedSources[sourceId]=sourceRecord;
    const members=(await call('source_members',{workspace:'original',sourceId},'original-members-'+sourceId)).value,
      rows=await readPages('source_rows',{workspace:'original',sourceId},'original-resources-'+sourceId);
    need(Array.isArray(members)&&members.length&&rows.length===sourceRecord.inventory.resources,
      'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_RESOURCE_SET_CHANGED',sourceId);
    sourceRows[sourceId]=rows;
    for(const row of rows.filter(row=>['Task','ServiceRequest','Consent','Procedure'].includes(row.resourceType))){
      const original=(await call('source_row',{workspace:'original',sourceId,recordId:row.recordId},
        'original-referral-resource-'+sourceId+'-'+row.recordId)).value;
      need(original.recordId===row.recordId&&original.resourceSha256===row.resourceSha256&&original.jsonText===row.jsonText,
        'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_RESOURCE_CHANGED');
    }
    const choices=[members.find(row=>row.name==='protocol/reviewed-context.json'),
      members.find(row=>row.name==='protocol/correction.json'),
      members.find(row=>row.name==='documents/reviewed-example-collection.json'),
      members.find(row=>row.name.startsWith('originals/members/')&&row.name.endsWith('.json')),
      members.find(row=>row.name==='originals/complete-examples.zip')].filter(Boolean);
    for(const [memberIndex,member] of choices.entries()){
      const key='source-'+sourceIndex+'-member-'+memberIndex,
        retained=await retainedExport(key,'source_file',{workspace:'original',sourceId,member:member.name}),
        original=payload(retained);
      need(retained.kind==='source-file'&&original.bytes===member.bytes&&
        (!member.sha256||original.sha256===member.sha256)&&original.name===member.name.split('/').at(-1),
        'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_MEMBER_CHANGED',member.name);
      if(sourceId===native.baseSourceId&&member.name==='documents/reviewed-example-collection.json'){
        const document=await downloadedJSON(key,retained);
        need(document.resourceType==='Bundle'&&document.type==='collection'&&Array.isArray(document.entry),
          'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_COLLECTION_REQUIRED');
        journal.publishedResourceDocuments=document.entry.length;await checkpoint();
      }else await download(key,retained);
    }
    const key='source-'+sourceIndex+'-packet',packet=await retainedExport(key,'source_packet',{workspace:'original',sourceId}),
      original=payload(packet);
    need(packet.kind==='source-packet'&&original.bytes===sourceRecord.bytes&&original.sha256===sourceId,
      'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_PACKET_CHANGED');
    sourceExports[sourceId]=packet;await download(key,packet);
  }
  // Follow every native page, including mutable operation records. Full
  // response exports preserve fields omitted from the small state descriptors.
  const records={};
  for(const collection of referralCollections){
    const rows=await readPages('referral_records',{workspace:'original',collection},'original-referral-'+collection);
    records[collection]=rows;
    need(rows.length>=before.referral[collection].length&&
      before.referral[collection].every(row=>rows.some(full=>full.id===row.id)),
      'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_COLLECTION_CHANGED',collection);
  }
  const editions=records.editions.filter(row=>native.editionIds.includes(row.id)),
    graphIds=[...new Set(editions.map(row=>row.graphId))],graphViews={};
  for(const graphId of graphIds){
    const graph=(await call('graph',{workspace:'original',graphId},'original-referral-graph-'+graphId)).value,
      nodes=await readPages('graph_nodes',{workspace:'original',graphId},'original-referral-nodes-'+graphId),
      edges=await readPages('graph_edges',{workspace:'original',graphId},'original-referral-edges-'+graphId),
      selected=editions.filter(row=>row.graphId===graphId);
    need(selected.every(edition=>nodes.length===retainedSources[edition.sourceId].inventory.resources &&
      edition.taskIds.every(id=>nodes.some(node=>node.recordId===id))),
      'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_GRAPH_SELECTION_CHANGED');
    for(const edition of selected)for(const taskId of edition.taskIds){
      const node=(await call('graph_node',{workspace:'original',graphId,recordId:taskId},'original-task-node-'+taskId)).value;
      need(node.resource?.recordId===taskId&&Array.isArray(node.incoming)&&Array.isArray(node.outgoing),
        'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_TASK_NODE_CHANGED');
    }
    graphViews[graphId]={graph,nodes,edges};
  }
  const assessments={};
  for(const assessmentId of native.assessmentIds)
    assessments[assessmentId]=await assessmentView('original',assessmentId,'native-assessment-'+assessmentId);
  journal.originalGraphAndAssessments=await privateJSON('ORIGINAL_GRAPH_AND_ASSESSMENTS.json',{graphViews,assessments});
  await checkpoint();

  // Corrections reuse the saved native preview and original complete request.
  // No additional clinical value is authored by this receiving operation.
  for(const correctionId of native.correctionIds){
    const correction=records.corrections.find(row=>row.id===correctionId),
      originalPreview=records.correctionPreviews.find(row=>row.id===correction?.previewId);
    need(correction&&originalPreview?.request&&originalPreview.requestSha256===correction.requestSha256,
      'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_CORRECTION_REQUIRED');
    const preview=(await call('referral_correction_preview',{workspace:'original',correction:originalPreview.request},
      'same-native-correction-preview-'+correctionId,{once:true})).value;
    need(preview.id===originalPreview.id&&preview.requestSha256===originalPreview.requestSha256,
      'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_PREVIEW_CHANGED');
    const applied=(await call('referral_correction_apply',{workspace:'original',apply:{
      previewId:preview.id,expectedRequestSha256:preview.requestSha256}},'same-native-correction-apply-'+correctionId,{once:true})).value;
    need(same(applied,correction),'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_CORRECTION_CHANGED');
  }
  for(const comparisonId of native.comparisonIds){
    const comparison=records.comparisons.find(row=>row.id===comparisonId),
      rows=await readPages('referral_edition_changes',{workspace:'original',comparisonId},'original-referral-changes-'+comparisonId),
      exported=await retainedExport('referral-changes-'+comparisonId,'referral_edition_changes_file',
        {workspace:'original',comparisonId}),original=payload(exported);
    need(comparison&&original.bytes===comparison.changesFile.bytes&&original.sha256===comparison.changesFile.sha256,
      'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_COMPARISON_CHANGED');
    const complete=await downloadedJSON('referral-changes-'+comparisonId,exported);
    need(same(complete,rows),'GRAVITY_REFERRAL_CONNECTED_COMPARISON_PAGE_FILE_CHANGED');
  }
  // GET-only receiving of actual saved discovery/acquisition history. A
  // completed conditional exchange may replay only its original operation;
  // the native complete branch returns that retained result without HTTP.
  const selectedConnectionIds=new Set(),selectedDiscoveryIds=new Set();
  for(const request of records.exchangeRequests.filter(row=>native.exchangeRequestIds.includes(row.id))){
    selectedConnectionIds.add(request.connectionId);selectedDiscoveryIds.add(request.discoveryId);
  }
  for(const connectionId of selectedConnectionIds)
    await call('connection',{workspace:'original',connectionId},'original-selected-connection-'+connectionId);
  for(const discoveryId of selectedDiscoveryIds)
    await call('discovery',{workspace:'original',discoveryId},'original-selected-discovery-'+discoveryId);
  journal.exchangeReceiving=[];
  for(const operationId of native.exchangeOperationIds){
    const operation=(await call('referral_exchange_operation',{workspace:'original',operationId},
      'original-exchange-'+operationId)).value,
      request=records.exchangeRequests.find(row=>row.id===operation.requestId);
    need(request&&operation.requestSha256===request.requestSha256,
      'GRAVITY_REFERRAL_CONNECTED_EXCHANGE_REQUEST_CHANGED');
    const file=await retainedExport('exchange-operation-'+operationId,'referral_exchange_operation_file',
      {workspace:'original',operationId}),whole=await downloadedJSON('exchange-operation-'+operationId,file);
    need(same(whole,operation),'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_OPERATION_FILE_CHANGED');
    await download('exchange-packet-'+operationId,await retainedExport('exchange-packet-'+operationId,
      'referral_exchange_operation_packet',{workspace:'original',operationId}));
    let continuation=null;
    if(operation.state==='complete'){
      continuation=(await call('referral_exchange_advance',{workspace:'original',requestId:operation.requestId,operationId},
        'same-complete-exchange-'+operationId,{once:true})).value;
      need(same(continuation,operation),'GRAVITY_REFERRAL_CONNECTED_COMPLETE_EXCHANGE_CHANGED');
    }
    journal.exchangeReceiving.push({operationId,requestId:operation.requestId,
      requestSha256:request.requestSha256,state:operation.state,continuation});await checkpoint();
  }
  for(const operationId of native.acquisitionOperationIds)
    await call('operation',{workspace:'original',operationId},'original-monitoring-acquisition-'+operationId);
  for(const handoffId of native.handoffIds)
    await download('native-handoff-'+handoffId,await retainedExport('native-handoff-'+handoffId,
      'referral_handoff_packet',{workspace:'original',handoffId}));

  // All source-selected review rows cross the small tool envelope through
  // one declared, hashed host input. Native field semantics remain unchanged.
  const reviewCall=await call('input_apply',{workspace:'original',input:'full_review',
    expectedSha256:journal.reviewInput.sha256,action:'referral_review_save'},
    'complete-referral-review-input',{once:true}),connectedReview=reviewCall.value;
  need(connectedReview.requirements?.length===57&&connectedReview.fields?.length===24&&
    connectedReview.predecessorId===journal.reviewInput.predecessorId&&
    reviewCall.result.files.some(file=>file.name==='original-input.json'&&
      file.sha256===journal.reviewInput.sha256&&file.bytes===journal.reviewInput.bytes),
    'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_REVIEW_INPUT_CHANGED');
  journal.exports['complete-native-review-input']=reviewCall.result;await checkpoint();
  await download('complete-native-review-input',reviewCall.result);
  const connectedAssessment=(await call('referral_assessment_create',{workspace:'original',assessment:{
    editionId:native.correctedEditionId,reviewId:connectedReview.id,label:'Original referral edition through connected receiving',
    actor:ACTOR,asOf:journal.connectedAsOf,
    note:'Complete saved original source and review at the original assessment time; status, findings and outcome references retain their native meanings.'}},
    'connected-complete-assessment',{once:true})).value;
  const connectedView=await assessmentView('original',connectedAssessment.id,'connected-assessment'),
    originalView=assessments[native.correctedAssessmentId];
  need(same(connectedView.cells,originalView.cells)&&same(connectedView.tasks,originalView.tasks)&&
    connectedAssessment.editionId===native.correctedEditionId,
    'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_TASK_AND_FIELD_VALUES_CHANGED');

  // This produces a real JSON delivery artifact and exercises native artifact
  // metadata, complete-file streaming, receiving and byte-for-byte reopen.
  const prepared=(await call('referral_export_prepare',{workspace:'original',selection:{
    kind:'assessment',id:connectedAssessment.id,label:'Complete original connected referral assessment'}},
    'prepare-connected-assessment-artifact',{once:true})).value;
  need(prepared.artifact?.id&&prepared.file?.route==='/api/artifacts/'+prepared.artifact.id+'/file'&&
    prepared.file.contentType==='application/json'&&
    prepared.file.sha256===connectedAssessment.reportFile.sha256,
    'GRAVITY_REFERRAL_CONNECTED_NATIVE_EXPORT_CHANGED');
  journal.preparedAssessmentArtifact=prepared;await checkpoint();

  const {value:savedPlan}=await call('plan',{workspace:'original',planId:native.planId},'original-native-mapping');
  need(savedPlan.id===native.planId&&savedPlan.plan?.schema==='stellar-forge.eltss-mapping.v1',
    'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_MAPPING_CHANGED');
  await call('mapping_default',{workspace:'original',sourceId:native.correctedSourceId,
    resourceType:savedPlan.plan.resourceType},'original-native-mapping-default');
  const projection=(await call('mapping_preview',{workspace:'original',sourceId:native.correctedSourceId,
    plan:savedPlan.plan,limit:5},'original-native-mapping-preview')).value;
  need(projection.totalRows===sourceRows[native.correctedSourceId].filter(row=>row.resourceType===savedPlan.plan.resourceType).length,
    'GRAVITY_REFERRAL_CONNECTED_NATIVE_PROJECTION_CHANGED');
  const builds={};
  for(const buildId of native.buildIds){
    const build=(await call('build',{workspace:'original',buildId},'original-native-build-'+buildId)).value;
    need(build.id===buildId&&Number.isSafeInteger(build.rowCount),
      'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_BUILD_CHANGED');
    builds[buildId]=build;
    await queryBuild('original',buildId,build.rowCount,'original-native-pages-'+buildId);
  }
  let datasetComparison=null;
  if(native.buildIds.length>1){
    datasetComparison=(await call('comparison_create',{workspace:'original',
      beforeId:native.buildIds[0],afterId:finalBuild},'original-native-dataset-comparison',{once:true})).value;
    const changes=await readPages('comparison_changes',{workspace:'original',comparisonId:datasetComparison.id},
      'original-native-dataset-changes');
    need(changes.length===datasetComparison.counts.added+datasetComparison.counts.removed+datasetComparison.counts.changed,
      'GRAVITY_REFERRAL_CONNECTED_COMPLETE_NATIVE_CHANGES_REQUIRED');
    await download('native-dataset-changes',await retainedExport('native-dataset-changes','comparison_file',
      {workspace:'original',comparisonId:datasetComparison.id}));
  }
  await download('complete-native-dataset',await retainedExport('complete-native-dataset','build_dataset',
    {workspace:'original',buildId:finalBuild}));
  const customerPacket=await retainedExport('customer-packet','build_packet',{workspace:'original',buildId:finalBuild});
  await download('customer-packet',customerPacket);

  // The complete original published ZIP is selected by a declared host input;
  // its reviewed fullUrl assignments come from the original saved context.
  const published=(await call('referral_published_examples_import',{workspace:'customer',input:'published_examples',
    expectedSha256:native.originalExamples.sha256,selection:journal.publishedSelection},
    'receive-complete-published-examples',{once:true})).value;
  need(published.source?.id&&published.archiveSha256===native.originalExamples.sha256&&
    Number.isSafeInteger(journal.publishedResourceDocuments)&&published.resourceDocuments===journal.publishedResourceDocuments&&
    same(published.referenceAssignments,retainedSources[native.baseSourceId].inventory.sourceContext.referenceAssignments),
    'GRAVITY_REFERRAL_CONNECTED_PUBLISHED_CONTEXT_CHANGED');
  const publishedRows=await readPages('source_rows',{workspace:'customer',sourceId:published.source.id},
    'received-original-published-resources');
  const contentRows=rows=>rows.map(row=>({resourceType:row.resourceType,fullUrl:row.fullUrl,
    id:row.id,resourceSha256:row.resourceSha256,jsonText:row.jsonText}));
  need(same(contentRows(publishedRows),contentRows(sourceRows[native.baseSourceId])),
    'GRAVITY_REFERRAL_CONNECTED_PUBLISHED_RESOURCE_VALUES_CHANGED');
  const receivedOriginalArchive=await retainedExport('received-original-examples','source_file',{
    workspace:'customer',sourceId:published.source.id,member:'originals/complete-examples.zip'});
  need(payload(receivedOriginalArchive).bytes===native.originalExamples.bytes&&
    payload(receivedOriginalArchive).sha256===native.originalExamples.sha256,
    'GRAVITY_REFERRAL_CONNECTED_COMPLETE_PUBLISHED_ARCHIVE_CHANGED');
  await download('received-original-examples',receivedOriginalArchive);
  journal.publishedExamplesReceiving=published;
  journal.definitionsReceiving=await call('artifact_import',{workspace:'customer',input:'published_definitions',
    expectedSha256:native.originalDefinitions.sha256,label:'Complete unchanged published Gravity definitions',
    contentType:'application/zip'},'receive-complete-published-definitions',{once:true});
  need(journal.definitionsReceiving.value.file?.sha256===native.originalDefinitions.sha256&&
    journal.definitionsReceiving.value.bytes===native.originalDefinitions.bytes,
    'GRAVITY_REFERRAL_CONNECTED_COMPLETE_DEFINITIONS_CHANGED');
  const receivedDefinitions=await retainedExport('received-original-definitions','artifact_file',{
    workspace:'customer',artifactId:journal.definitionsReceiving.value.id});
  await download('received-original-definitions',receivedDefinitions);
  const base=sourceExports[native.baseSourceId];
  journal.sourceReceiving=await call('receive_export',{workspace:'customer',sourceWorkspace:'original',
    exportId:base.exportId,expectedManifestSha256:base.manifestSha256,kind:'source',
    label:'Complete original selected Gravity example source'},'receive-original-source-packet',{once:true});
  journal.customerReceiving=await call('receive_export',{workspace:'customer',sourceWorkspace:'original',
    exportId:customerPacket.exportId,expectedManifestSha256:customerPacket.manifestSha256,kind:'packet'},
    'receive-original-native-customer-packet',{once:true});
  journal.artifactReceiving??={};
  const artifacts=[...new Map([...before.artifacts.filter(row=>native.artifactIds.includes(row.id)),prepared.artifact]
    .map(row=>[row.id,row])).values()];
  for(const original of artifacts){
    const artifactId=original.id,retained=await retainedExport('original-artifact-'+artifactId,'artifact_file',
      {workspace:'original',artifactId}),file=payload(retained);
    need(retained.kind==='artifact-file'&&same(retained.source.artifact,original)&&
      file.bytes===original.bytes&&file.sha256===original.file.sha256&&
      retained.files.some(row=>row.name==='original-artifact.json'),
      'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_ARTIFACT_METADATA_CHANGED');
    await download('original-artifact-'+artifactId,retained);
    journal.artifactReceiving[artifactId]=await call('receive_export',{workspace:'customer',sourceWorkspace:'original',
      exportId:retained.exportId,expectedManifestSha256:retained.manifestSha256,kind:'artifact'},
      'receive-original-artifact-'+artifactId,{once:true});
    const received=journal.artifactReceiving[artifactId].value;
    need(received.name===original.name&&received.contentType===original.contentType&&received.label===original.label&&
      received.file?.sha256===file.sha256&&received.bytes===file.bytes,
      'GRAVITY_REFERRAL_CONNECTED_JSON_ARTIFACT_CHANGED');
  }

  const handoffInput={editionId:native.correctedEditionId,assessmentId:connectedAssessment.id,
    label:'Complete original Gravity connected receiving',scope:'complete-workspace',
    receiver:'Connected local complete handoff workspace',actor:ACTOR,
    purpose:'Receive the complete original referral graph, every requirement and field review, selected topology, native datasets and original conditional exchange history.',
    note:'The same source-selected operational content is handed to the original full editable receiver.',
    sourceRefs:[{sourceId:native.correctedSourceId,recordId:connectedView.edition.taskIds[0]}]};
  const connectedHandoff=(await call('referral_handoff_prepare',{workspace:'original',handoff:handoffInput},
    'connected-complete-referral-handoff',{once:true})).value;
  need(connectedHandoff.assessmentId===connectedAssessment.id&&connectedHandoff.reviewId===connectedReview.id,
    'GRAVITY_REFERRAL_CONNECTED_COMPLETE_HANDOFF_CHANGED');
  const handoff=await retainedExport('connected-handoff','referral_handoff_packet',
    {workspace:'original',handoffId:connectedHandoff.id});
  await download('connected-handoff',handoff);
  journal.handoffReceiving=await call('receive_export',{workspace:'handed',sourceWorkspace:'original',
    exportId:handoff.exportId,expectedManifestSha256:handoff.manifestSha256,kind:'referral-handoff'},
    'receive-complete-referral-handoff',{once:true});
  const handoffResult=journal.handoffReceiving.value;
  need(handoffResult.reconstructed&&handoffResult.workspaceId===native.workspaceId&&
    handoffResult.archiveSha256===payload(handoff).sha256,
    'GRAVITY_REFERRAL_CONNECTED_COMPLETE_HANDOFF_RECEIVING_CHANGED');
  const addedReviewIds=[...native.reviewIds,connectedReview.id],
    addedAssessmentIds=[...native.assessmentIds,connectedAssessment.id],
    addedHandoffIds=[...native.handoffIds,connectedHandoff.id];
  const handed=includesRecords((await call('state',{workspace:'handed'},'received-complete-handoff-state')).value,{
    additional:{artifacts:[...native.artifactIds,prepared.artifact.id]},
    referralAdditional:{reviews:addedReviewIds,assessments:addedAssessmentIds,handoffs:addedHandoffIds}});
  need(handed.referral.receives.some(row=>row.state==='complete'&&row.archiveSha256===payload(handoff).sha256&&
    row.workspaceId===native.workspaceId&&row.kind==='handoff'),'GRAVITY_REFERRAL_CONNECTED_OUTER_HANDOFF_RECEIVE_MISSING');
  const handedView=await assessmentView('handed',connectedAssessment.id,'received-handoff-assessment');
  need(same(handedView.cells,connectedView.cells)&&same(handedView.tasks,connectedView.tasks),
    'GRAVITY_REFERRAL_CONNECTED_HANDOFF_FIELD_VALUES_CHANGED');
  await queryBuild('handed',finalBuild,expectedRows,'received-handoff-native-cursor');

  // The receiving observation uses the actual native archive operation ID and
  // receiver UUID, after the complete handoff and all native rows reopen.
  journal.receivingObservedAt??=now();await checkpoint();
  const observed=(await call('referral_receiving_save',{workspace:'original',receiving:{
    label:'Complete connected local handoff received',actor:ACTOR,handoffId:connectedHandoff.id,
    receiver:'Connected local complete handoff workspace',state:'received',
    operationId:handoffResult.archiveSha256,receivedAt:journal.receivingObservedAt,
    destinationObjectId:handoffResult.workspaceId+':'+connectedHandoff.id,
    sourceRefs:[{sourceId:native.correctedSourceId,recordId:connectedView.edition.taskIds[0]}],
    note:'Actual complete original archive '+handoffResult.archiveSha256+
      ' was received into '+paths.handed+'; all selected Tasks, all24 cells per Task and the native dataset reopened.'}},
    'record-observed-referral-receiving',{once:true})).value;
  journal.connected={reviewId:connectedReview.id,assessmentId:connectedAssessment.id,handoffId:connectedHandoff.id,
    receivingId:observed.id,receivingOperationId:observed.operationId,assessmentArtifactId:prepared.artifact.id,
    publishedSourceId:published.source.id,definitionsArtifactId:journal.definitionsReceiving.value.id,
    datasetComparisonId:datasetComparison?.id??null};await checkpoint();

  // Freeze after that actual observation. The original native and referral
  // registries travel together, and the outer archive drives UUID recovery.
  const editable=await retainedExport('editable-workspace','referral_workspace_packet',{workspace:'original'});
  await download('editable-workspace',editable);
  journal.workspaceReceiving=await call('receive_export',{workspace:'restored',sourceWorkspace:'original',
    exportId:editable.exportId,expectedManifestSha256:editable.manifestSha256,kind:'workspace'},
    'receive-original-editable-workspace',{once:true});
  const additional={artifacts:[...native.artifactIds,prepared.artifact.id]},
    referralAdditional={reviews:addedReviewIds,assessments:addedAssessmentIds,handoffs:addedHandoffIds,
      receivings:[...native.receivingIds,observed.id]};
  const restored=includesRecords((await call('state',{workspace:'restored'},'restored-complete-state')).value,
    {additional,referralAdditional}),editableFile=payload(editable);
  need(restored.referral.receives.some(record=>record.state==='complete'&&record.archiveSha256===editableFile.sha256&&
    record.workspaceId===native.workspaceId&&record.kind==='workspace'),
    'GRAVITY_REFERRAL_CONNECTED_OUTER_WORKSPACE_RECEIVE_MISSING');
  const customer=(await call('state',{workspace:'customer'},'customer-complete-state')).value;
  need(customer.sources.some(row=>row.id===native.baseSourceId)&&
    customer.sources.some(row=>row.id===native.correctedSourceId)&&
    customer.plans.some(row=>row.id===native.planId)&&customer.builds.some(row=>row.id===finalBuild),
    'GRAVITY_REFERRAL_CONNECTED_COMPLETE_CUSTOMER_RECEIVING_MISSING');
  await queryBuild('restored',finalBuild,expectedRows,'restored-native-cursor');
  await queryBuild('customer',finalBuild,expectedRows,'customer-native-cursor');
  const restoredView=await assessmentView('restored',connectedAssessment.id,'restored-complete-assessment');
  need(same(restoredView.cells,connectedView.cells)&&same(restoredView.tasks,connectedView.tasks)&&
    same(restoredView.findings,connectedView.findings)&&same(restoredView.decisions,connectedView.decisions),
    'GRAVITY_REFERRAL_CONNECTED_SOURCE_MEANINGS_CHANGED_AFTER_RESTORE');
  journal.receivedStates=await privateJSON('RECEIVED_STATES.json',{handed,restored,customer});await checkpoint();

  // Merchant close/reopen borrows the same original server. The rendered
  // referral workspace and its actual native query remain usable throughout.
  await closeMerchant();
  need((await operatorIdentity('original')).identity.instanceId===beforeOperator.instanceId,
    'GRAVITY_REFERRAL_CONNECTED_BORROWED_OPERATOR_CLOSED');
  await browserRun('02-merchant-closed-native-referrals-open',expectedRows);
  await startMerchant();
  const reopened=includesRecords((await call('state',{workspace:'original'},'original-reopened')).value,
    {additional,referralAdditional});
  need((await operatorIdentity('original')).identity.instanceId===beforeOperator.instanceId,
    'GRAVITY_REFERRAL_CONNECTED_ORIGINAL_OPERATOR_RESTARTED');
  for(const [key,retained] of Object.entries(journal.exports)){
    const selected={client,workspace:retained.workspace,exportId:retained.exportId,
      expectedManifestSha256:retained.manifestSha256,directory:join(output,'downloads',key)};
    need(journal.downloads[key],'GRAVITY_REFERRAL_CONNECTED_COMPLETE_DOWNLOAD_REQUIRED',key);
    journal.downloads[key].afterMerchantReopen={inspected:await inspectGravityReferralExport(selected),
      local:await reopenGravityReferralExport(selected)};await checkpoint();
  }
  const restoredReopened=includesRecords((await call('state',{workspace:'restored'},'restored-reopened')).value,
    {additional,referralAdditional});
  await queryBuild('restored',finalBuild,expectedRows,'restored-reopened-native-cursor');
  await browserRun('03-merchant-reopened-same-native-referrals',expectedRows);
  await captures();need(browserErrors.length===0,'GRAVITY_REFERRAL_CONNECTED_BROWSER_ERRORS',JSON.stringify(browserErrors));
  await browser.close();browser=null;await closeMerchant();
  journal.operatorClosures=[];
  for(const owner of owners)journal.operatorClosures.push(await owner.release());
  await checkpoint();
  const result={schema:SCHEMA,operation:OPERATION,completedAt:now(),nativeReceiving:binding,
    sourceFiles:journal.sourceFiles,sourceEditions:journal.sourceEditions,
    workspace:paths.original,workspaceId:native.workspaceId,originalOperator:beforeOperator,
    originalExamples:{...native.originalExamples,file:originalExamplesFile},
    originalDefinitions:{...native.originalDefinitions,file:originalDefinitionsFile},
    sourceIds:native.sourceIds,configurationIds:native.configurationIds,editionIds:native.editionIds,
    reviewIds:native.reviewIds,assessmentIds:native.assessmentIds,decisionIds:native.decisionIds,
    correctionIds:native.correctionIds,comparisonIds:native.comparisonIds,graphIds,
    exchangeRequestIds:native.exchangeRequestIds,exchangeOperationIds:native.exchangeOperationIds,
    acquisitionOperationIds:native.acquisitionOperationIds,monitoringIds:native.monitoringIds,
    planId:native.planId,buildIds:native.buildIds,connected:journal.connected,
    completeTasks:connectedView.tasks.length,completeRequirementReviews:connectedReview.requirements.length,
    completeFieldReviews:connectedReview.fields.length,completeFieldCells:connectedView.cells.length,configuration,
    merchantRuns:journal.merchantRuns,operatorRuns:journal.operatorRuns,operatorClosures:journal.operatorClosures,
    exports:journal.exports,downloads:journal.downloads,partialDownloads:journal.partialDownloads,
    exchangeReceiving:journal.exchangeReceiving,receiving:{
      publishedExamples:journal.publishedExamplesReceiving,definitions:journal.definitionsReceiving,
      source:journal.sourceReceiving,customer:journal.customerReceiving,handoff:journal.handoffReceiving,
      artifacts:journal.artifactReceiving,workspace:journal.workspaceReceiving,
      customerDirectory:paths.customer,handoffDirectory:paths.handed,restoredDirectory:paths.restored},
    originalReopened:await privateJSON('ORIGINAL_REOPENED.json',reopened),
    restoredReopened:await privateJSON('RESTORED_REOPENED.json',restoredReopened),
    browserRuns:journal.browserRuns,browserRequests:journal.browserRequests,browserErrors,journey:journalPath};
  const completed=await privateJSON('OPERATED_CONNECTED_GRAVITY_REFERRAL.json',result);
  journal.completedAt=result.completedAt;journal.result=completed;await checkpoint();
  process.stdout.write(JSON.stringify({state:'complete',operation:OPERATION,result:completed,workspaceId:native.workspaceId,
    buildId:finalBuild,tasks:connectedView.tasks.length,requirements:connectedReview.requirements.length,
    fieldCells:connectedView.cells.length,completeDownloads:Object.keys(journal.downloads).length})+'\n');
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
