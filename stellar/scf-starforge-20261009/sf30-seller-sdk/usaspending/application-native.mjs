#!/usr/bin/env node
// MIT. Continue the original award receiving operation through saved Applications.
import { mkdir, readFile, writeFile, lstat, open, realpath } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AwardWorkspace } from './workspace.mjs';
import { prepareUSASpendingSelection, USASPENDING_SOURCE_PREFIX } from './application.mjs';
import { canonical, sha, requireThat } from './core.mjs';

const OPERATION='SCF-USASPENDING-AWARD-TRANSACTIONS-64B7-20261012';
const SOURCE_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const DISTRIBUTION='stellar/scf-starforge-20261009/distribution';
const help='node usaspending/application-native.mjs --received ORIGINAL_NATIVE_OUTPUT --out NEW_PRIVATE_DIRECTORY [--runtime ORIGINAL_READY_RUNTIME] [--operation '+OPERATION+']';
function options(args) {
  const value={};
  for(let i=0;i<args.length;i+=2) {
    requireThat(['--received','--out','--runtime','--operation'].includes(args[i])&&
      typeof args[i+1]==='string'&&!Object.hasOwn(value,args[i]),'APPLICATION_RECEIVING_ARGUMENT_INVALID',help);
    value[args[i]]=args[i+1];
  }
  requireThat(value['--received']&&value['--out'],'APPLICATION_RECEIVING_ARGUMENT_REQUIRED',help);
  return {received:resolve(value['--received']),out:resolve(value['--out']),
    runtime:value['--runtime']?resolve(value['--runtime']):null,operation:value['--operation']??OPERATION};
}
async function jsonFile(path) { return JSON.parse(await readFile(path,'utf8')); }
async function privateDirectory(path) {
  const info=await lstat(path);
  requireThat(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===path&&
    (info.mode&0o077)===0&&(!process.getuid||info.uid===process.getuid()),
  'APPLICATION_RECEIVING_PRIVATE_DIRECTORY_REQUIRED',path);
}
async function waitFor(read,{milliseconds=120000,description='original operation'}={}) {
  const deadline=Date.now()+milliseconds;
  for(;;) {
    const value=await read();if(value)return value;
    requireThat(Date.now()<deadline,'APPLICATION_RECEIVING_WAIT_EXPIRED',description);
    await delay(200);
  }
}
async function put(path,value) {
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
  await writeFile(path,bytes,{flag:'wx',mode:0o600});
  return {path,bytes:bytes.length,sha256:sha(bytes)};
}
function client(link) {
  const url=new URL(link),token=url.hash.slice(1);
  requireThat(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&/^[A-Za-z0-9_-]{43}$/.test(token),
    'APPLICATION_RECEIVING_SESSION_REQUIRED');
  return async(path,body) => {
    const response=await fetch(url.origin+path,{
      method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{'x-research-token':token,...(body===undefined?{}:{'content-type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    requireThat(response.ok,'APPLICATION_RECEIVING_HTTP_FAILED',path+' '+response.status+
      (response.ok?'':' '+(await response.text()).slice(0,2000)));
    return response;
  };
}
async function inspectSession({link,original,capture,portable,save,prefix,empty=false}) {
  const http=client(link.url),identity=await (await http('/api/identity')).json();
  requireThat(identity.workspaceId===link.workspaceId&&identity.instanceId===link.original.instanceId&&
    identity.pid===link.original.pid,'APPLICATION_RECEIVING_IDENTITY_CHANGED');
  const state=await (await http('/api/state')).json();
  requireThat(state.id===identity.workspaceId,'APPLICATION_RECEIVING_WORKSPACE_CHANGED');
  for(const path of ['/','/transactions.html','/transactions.js','/transactions.css']) {
    const response=await http(path);
    requireThat((await response.arrayBuffer()).byteLength>0,'APPLICATION_RECEIVING_BROWSER_ASSET_MISSING',path);
  }
  if(empty) {
    requireThat(state.editions.length===0&&state.captures.length===0,'APPLICATION_RECEIVING_NEW_WORKSPACE_CHANGED');
    await save(prefix+'-empty-workspace.json',state);
    return {identity,empty:true};
  }
  const query='?capture='+encodeURIComponent(capture);
  const summary=await (await http('/api/transactions/summary'+query)).json();
  const rows=await (await http('/api/transactions/rows'+query)).json();
  const retained=await (await http('/api/transactions/export'+query+'&reviews=true')).json();
  requireThat(summary.capture.status==='complete'&&summary.analysis.unique_transactions===original.transactions&&
    summary.analysis.net_obligation_usd===original.netObligationUsd&&summary.review?.revision===1&&
    canonical(retained.rows)===canonical(portable.rows),'APPLICATION_RECEIVING_PERSISTENCE_CHANGED');
  const source=Buffer.from(await (await http('/api/transactions/source'+query+'&page=1')).arrayBuffer());
  requireThat(sha(source)===original.originalResponseSha256,'APPLICATION_RECEIVING_ORIGINAL_BYTES_CHANGED');
  await save(prefix+'-summary.json',summary);
  await save(prefix+'-transaction-capture.json',retained);
  await save(prefix+'-transactions.csv',Buffer.from(await (await http('/api/transactions/export'+query+'&format=csv')).arrayBuffer()));
  await save(prefix+'-workshare.md',Buffer.from(await (await http('/api/transactions/brief'+query)).arrayBuffer()));
  await save(prefix+'-workspace.json',await (await http('/api/backup')).json());
  return {identity,captureId:capture,transactions:rows.total,netObligationUsd:summary.analysis.net_obligation_usd,
    reviewRevision:summary.review.revision,originalResponseSha256:sha(source)};
}
async function sourceLaunch({sourceRoot,workspaceDirectory,receivingRoot,directory,applicationId,operator}) {
  const {readApplicationProvider}=await import(pathToFileURL(join(sourceRoot,DISTRIBUTION,'runtime-workspace/application-providers.mjs')).href);
  const selected=await readApplicationProvider({id:'usaspending',kind:'usaspending',sourceRoot});
  requireThat(selected.entry.command==='usaspending-application','APPLICATION_RECEIVING_PROVIDER_CHANGED');
  const selection=await prepareUSASpendingSelection({workspaceDirectory,receivingRoot,operator,sourceRoot});
  const args=['serve','--workspace',workspaceDirectory,'--operator',operator,'--port','0',
    '--managed-selection',JSON.stringify(selection),'--receiving-root',receivingRoot];
  const request={applicationId,command:'usaspending-application',args,releaseDirectory:dirname(sourceRoot),
    applicationProvider:selected.binding};
  requireThat(join(request.releaseDirectory,'source')===sourceRoot,
    'APPLICATION_RECEIVING_SOURCE_LAYOUT_REQUIRED','Materialize the original source under NEWDIR/source.');
  await mkdir(directory,{mode:0o700});
  await put(join(directory,'request.json'),request);
  const stdout=await open(join(directory,'stdout.log'),'wx',0o600);
  const stderr=await open(join(directory,'stderr.log'),'wx',0o600);
  let child,observer,outcome,ended=null,writes=Promise.resolve();
  try {
    child=spawn(process.execPath,[join(sourceRoot,USASPENDING_SOURCE_PREFIX,'application.mjs'),...args],{
      shell:false,cwd:dirname(sourceRoot),stdio:['ignore','pipe','pipe'],
    });
    observer=selected.provider.createObserver(request,directory,{pid:child.pid});
    child.stdout.on('data',bytes=>{writes=writes.then(()=>stdout.writeFile(bytes));observer.write(bytes);});
    child.stderr.on('data',bytes=>{writes=writes.then(()=>stderr.writeFile(bytes));});
    outcome=new Promise((accept,reject)=>{
      child.once('error',reject);child.once('close',(code,signal)=>{ended={code,signal};accept(ended);});
    });
    outcome.catch(()=>{});
    await new Promise((accept,reject)=>{child.once('spawn',accept);child.once('error',reject);});
    const link=await waitFor(async()=>{
      if(ended)throw Object.assign(new Error('Original application exited before its private URL. Inspect '+directory),{code:'APPLICATION_RECEIVING_STARTUP_FAILED'});
      try{return await jsonFile(join(directory,'application-url.json'));}
      catch(error){if(error.code!=='ENOENT')throw error;return null;}
    },{description:'original native application startup'});
    await observer.close();
    requireThat(link.operationId===directory.split('/').at(-1)&&
      link.applicationId===applicationId&&link.original.pid===child.pid,
      'APPLICATION_RECEIVING_ORIGINAL_PROCESS_CHANGED');
    let closed=false;
    async function close() {
      if(closed)return ended;closed=true;
      if(!ended)child.kill('SIGTERM');
      let completed;
      try{completed=await Promise.race([outcome,delay(20000,undefined,{ref:false}).then(()=>{throw new Error('Original application did not close after SIGTERM');})]);}
      catch(error){if(!ended)child.kill('SIGKILL');await outcome.catch(()=>{});throw error;}
      finally{await observer.close();await writes;await stdout.close();await stderr.close();}
      requireThat(completed.code===0&&completed.signal===null,'APPLICATION_RECEIVING_CLOSE_FAILED');
      await put(join(directory,'completed.json'),{completedAt:new Date().toISOString(),...completed,stopped:true});
      return completed;
    }
    return {link,selection,close};
  }catch(error){
    if(child&&!ended)child.kill('SIGTERM');
    if(outcome)await Promise.race([outcome.catch(()=>{}),delay(20000,undefined,{ref:false})]).then(()=>{if(!ended)child.kill('SIGKILL');});
    if(observer)await observer.close().catch(()=>{});
    await writes.catch(()=>{});await stdout.close().catch(()=>{});await stderr.close().catch(()=>{});throw error;
  }
}
async function sourceReceiving(context) {
  const {received,out,original,portable,save}=context;
  const receivingRoot=join(out,'customer-deliveries');await mkdir(receivingRoot,{mode:0o700});
  const rounds=[];
  const open=async(workspaceDirectory,prefix,empty=false)=>{
    const run=await sourceLaunch({sourceRoot:SOURCE_ROOT,workspaceDirectory,receivingRoot,
      directory:join(out,prefix+'-operation'),applicationId:'64b7-usaspending-source',operator:'Federal award receiving'});
    try {
      await save(prefix+'-application-url.json',run.link);
      const result=await inspectSession({link:run.link,original,capture:original.captureId,portable,save,prefix,empty});
      rounds.push({prefix,...result});return result;
    }finally{await run.close();}
  };
  await open(join(received,'workspace'),'original');
  await open(join(received,'workspace'),'reopened');
  requireThat(rounds[0].identity.workspaceId===rounds[1].identity.workspaceId&&
    rounds[0].identity.instanceId!==rounds[1].identity.instanceId,
    'APPLICATION_RECEIVING_REOPEN_CHANGED');
  const newWorkspace=join(out,'new-award-workspace');
  await open(newWorkspace,'first-launch',true);
  const restored=new AwardWorkspace(newWorkspace,{operator:'Federal award receiving'});
  try{restored.restorePacket(await jsonFile(join(received,'complete-workspace.json')));}finally{restored.close();}
  await open(newWorkspace,'restored-reopened');
  return {mode:'original-source-application',sourceRoot:SOURCE_ROOT,rounds,
    workflow:['source_owned_registry','original_cli_process','authenticated_browser_startup','original_award_workspace',
      'retained_application_url','transaction_and_review_persistence','original_sigterm_close',
      'same_workspace_reopen','new_workspace_first_launch','original_workspace_restore','restored_workspace_reopen']};
}
async function managedReceiving(context,runtimeDirectory) {
  const {received,out,original,portable,save}=context;
  await privateDirectory(runtimeDirectory);
  const runtimeSource=join(runtimeDirectory,'package','source');
  const native=await import(pathToFileURL(join(runtimeSource,USASPENDING_SOURCE_PREFIX,'application.mjs')).href);
  const {inspectMerchantRuntime}=await import(pathToFileURL(join(runtimeSource,'stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs')).href);
  const runtime=await inspectMerchantRuntime(runtimeDirectory,{load:false});
  requireThat(runtime.sourceRoot===runtimeSource,'APPLICATION_RECEIVING_RUNTIME_CHANGED');
  const {createRuntimeWorkspace,openRuntimeWorkspace}=await import(pathToFileURL(join(runtimeSource,DISTRIBUTION,'runtime-workspace/model.mjs')).href);
  const directory=join(out,'applications-workspace');await createRuntimeWorkspace({directory});
  let model=await openRuntimeWorkspace({directory});
  const attached=await model.attach({directory:runtimeDirectory,label:'Federal awards receiving'});
  requireThat(attached.status==='READY','APPLICATION_RECEIVING_READY_RUNTIME_REQUIRED');
  await save('managed-runtime.json',{runtime,attached});
  const rounds=[],applications=[],active=new Map();
  async function completed(id) {
    return waitFor(async()=>{
      const state=await model.state(),job=state.operations.find(item=>item.id===id);
      if(job?.phase==='FAILED')throw Object.assign(new Error(JSON.stringify(job.error)),{code:'APPLICATION_RECEIVING_MANAGED_FAILED'});
      return job?.phase==='SUCCEEDED'?job:null;
    },{description:'original managed operation '+id});
  }
  async function saveApplication(workspaceDirectory,receivingRoot,label,prefix,expectNew=false) {
    const review=await model.applicationsReview({runtimeId:attached.runtimeId,kind:'usaspending',providerId:'usaspending',
      label,settings:{workspaceDirectory,receivingRoot,operator:'Federal award receiving',port:0}});
    if(expectNew)requireThat(review.command.createDirectories.includes(workspaceDirectory)&&
      review.command.createDirectories.includes(receivingRoot),'APPLICATION_RECEIVING_NEW_SELECTION_REQUIRED');
    await save(prefix+'-review.json',review);
    const saved=await model.applicationsSave({requestId:randomUUID(),reviewId:review.id});
    requireThat(saved.saved&&!saved.connectionError,'APPLICATION_RECEIVING_SAVE_FAILED',
      saved.connectionError?JSON.stringify(saved.connectionError):undefined);
    if(saved.connection)await completed(saved.connection.operationId);
    await privateDirectory(workspaceDirectory);await privateDirectory(receivingRoot);
    applications.push({prefix,...saved});await save(prefix+'-saved.json',saved);return saved.applicationId;
  }
  async function start(applicationId,prefix,{empty=false,expectFirst=false}={}) {
    const reviewed=await model.applicationsStartReview({applicationId});
    const selectionIndex=reviewed.command.args.indexOf('--managed-selection');
    requireThat(selectionIndex>=0,'APPLICATION_RECEIVING_SELECTION_MISSING');
    const selection=JSON.parse(reviewed.command.args[selectionIndex+1]);
    if(expectFirst)requireThat(selection.workspace.directory.exists&&selection.workspace.workspaceId===null&&
      selection.receiving.exists,'APPLICATION_RECEIVING_CREATED_SELECTION_CHANGED');
    await save(prefix+'-start-review.json',reviewed);
    const begun=await model.applicationsStart({applicationId,requestId:randomUUID(),reviewId:reviewed.id});
    const operationId=begun.operationId;active.set(operationId,applicationId);
    const operationDirectory=join(directory,'operations',operationId);
    try {
      const link=await waitFor(async()=>{
        try{return await jsonFile(join(operationDirectory,'application-url.json'));}
        catch(error){if(error.code!=='ENOENT')throw error;}
        const output=await model.applicationsOutput({applicationId,operationId});
        requireThat(!['FAILED','SUCCEEDED'].includes(output.phase),'APPLICATION_RECEIVING_STARTUP_FAILED',JSON.stringify(output.result));
        return null;
      },{description:'original managed browser startup '+operationId});
      requireThat(link.applicationId===applicationId&&link.operationId===operationId&&
        link.command==='usaspending-application','APPLICATION_RECEIVING_SAVED_LINK_CHANGED');
      await save(prefix+'-application-url.json',link);
      const result=await inspectSession({link,original,capture:original.captureId,portable,save,prefix,empty});
      const bound=await native.inspectUSASpendingWorkspace(link.original.workspace);
      requireThat(bound.workspaceId===link.workspaceId,'APPLICATION_RECEIVING_MANAGED_WORKSPACE_CHANGED');
      rounds.push({prefix,applicationId,operationId,...result});return result;
    }finally {
      await model.applicationsStop({applicationId,operationId});
      const result=await completed(operationId);active.delete(operationId);
      requireThat(result.result?.state==='STOPPED'&&result.result?.launched===true,
        'APPLICATION_RECEIVING_MANAGED_STOP_CHANGED');
      await save(prefix+'-stopped.json',await model.applicationsOutput({applicationId,operationId}));
    }
  }
  try {
    const existing=await saveApplication(join(received,'workspace'),join(out,'existing-deliveries'),
      'Original federal award workshare','existing');
    await start(existing,'managed-original');
    await model.close();model=await openRuntimeWorkspace({directory});
    await start(existing,'managed-reopened');
    requireThat(rounds[0].identity.workspaceId===rounds[1].identity.workspaceId&&
      rounds[0].identity.instanceId!==rounds[1].identity.instanceId,'APPLICATION_RECEIVING_MANAGED_REOPEN_CHANGED');
    const newDirectory=join(out,'new-managed-award-workspace');
    const fresh=await saveApplication(newDirectory,join(out,'new-managed-deliveries'),
      'New federal award workspace','new',true);
    await start(fresh,'managed-first-launch',{empty:true,expectFirst:true});
    const restored=new AwardWorkspace(newDirectory,{operator:'Federal award receiving'});
    try{restored.restorePacket(await jsonFile(join(received,'complete-workspace.json')));}finally{restored.close();}
    await model.close();model=await openRuntimeWorkspace({directory});
    await start(fresh,'managed-restored-reopened');
    return {mode:'original-managed-applications',runtime,directory,applications,rounds,
      workflow:['original_ready_runtime','retained_runtime_attachment','source_owned_provider','original_application_review',
        'original_application_save','original_runtime_adoption','fresh_start_preparation','original_managed_worker',
        'authenticated_browser_startup','retained_application_url','transaction_and_review_persistence',
        'original_managed_stop','saved_application_reopen','new_selected_directory','authorized_private_creation',
        'fresh_created_selection','original_workspace_restore','cold_managed_reopen']};
  }finally {
    for(const [operationId,applicationId] of active) {
      await model.applicationsStop({applicationId,operationId}).catch(()=>{});
      await completed(operationId).catch(()=>{});
    }
    await model.close();
  }
}
export async function receiveUSASpendingApplication({received,out,runtime=null,operation=OPERATION}) {
  requireThat(operation===OPERATION,'APPLICATION_RECEIVING_OPERATION_CHANGED');
  received=resolve(received);out=resolve(out);if(runtime)runtime=resolve(runtime);
  await privateDirectory(received);
  const original=await jsonFile(join(received,'receiving-result.json'));
  requireThat(original.schema==='usaspending-transactions.native-receiving.v1'&&original.transactions>0&&
    /^[a-f0-9]{64}$/.test(original.originalResponseSha256),'APPLICATION_RECEIVING_ORIGINAL_RESULT_REQUIRED');
  const portable=await jsonFile(join(received,'transaction-capture.json'));
  requireThat(portable.sha256===original.portableCaptureSha256,'APPLICATION_RECEIVING_ORIGINAL_CAPTURE_CHANGED');
  await mkdir(out,{mode:0o700});await privateDirectory(out);
  const artifacts=[],save=async(name,value)=>{
    const item=await put(join(out,name),value);artifacts.push(item);return item;
  };
  await save('original-receiving-result.json',original);
  const context={received,out,original,portable,save};
  const result=runtime?await managedReceiving(context,runtime):await sourceReceiving(context);
  const value={schema:'usaspending.application-native-receiving.v1',operation,completedAt:new Date().toISOString(),
    originalReceivingDirectory:received,originalCaptureId:original.captureId,awardKey:original.awardKey,
    originalResponseSha256:original.originalResponseSha256,...result,artifacts};
  await put(join(out,'application-receiving-result.json'),value);
  process.stdout.write(JSON.stringify(value,null,2)+'\n');return value;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  receiveUSASpendingApplication(options(process.argv.slice(2))).catch(error=>{
    process.stderr.write(JSON.stringify({error:error.code??'APPLICATION_RECEIVING_FAILED',message:error.message})+'\n');
    process.exitCode=1;
  });
}
