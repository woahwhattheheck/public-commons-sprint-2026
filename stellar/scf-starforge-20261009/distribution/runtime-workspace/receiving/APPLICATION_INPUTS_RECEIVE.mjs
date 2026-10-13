#!/usr/bin/env node
// MIT. One retained original-file/Application/backup receiving course; no CI registration.
import { constants } from 'node:fs';
import { mkdir, readFile, open, lstat, rename, link, unlink } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createRuntimeWorkspace, openRuntimeWorkspace } from '../model.mjs';
import { startRuntimeWorkspace } from '../server.mjs';
import { readJSON, saveJSON, privateDirectory, operationLease } from '../storage.mjs';
import { runApplicationInputCommand } from '../application-inputs-cli.mjs';
import { APPLICATION_INPUT_MAX_BYTES, APPLICATION_INPUT_CHUNK_BYTES } from '../application-inputs.mjs';

const options={};
for(let i=2;i<process.argv.length;i+=2) {
  if(!['--operation','--file','--runtime','--chromium','--playwright-root'].includes(process.argv[i])||!process.argv[i+1])
    throw Error('Use --operation PRIVATE_CASE --file ORIGINAL_GRANT_SCENARIO --runtime EXISTING_READY_RUNTIME --chromium EXISTING_CHROME --playwright-root NODE_MODULES.');
  options[process.argv[i]]=resolve(process.argv[i+1]);
}
for(const name of ['--operation','--file','--runtime','--chromium','--playwright-root'])
  if(!options[name])throw Error('Missing '+name);
const root=options['--operation'],sourceRoot=fileURLToPath(new URL('../',import.meta.url));
await mkdir(root,{recursive:true,mode:0o700});await privateDirectory(root);
const lease=await operationLease(join(root,'receiving.lock'));
const paths={journal:join(root,'RECEIVING.json'),original:join(root,'original-file'),
  workspace:join(root,'workspace'),retained:join(root,'retained-workspace'),
  control:join(root,'restore-control'),backups:join(root,'backups'),receiving:join(root,'receiving-backups')};
const exists=async path=>{try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const check=(value,message)=>{if(!value)throw Error(message);};
const sha=value=>createHash('sha256').update(value).digest('hex');
async function publishBytes(path,bytes,{replace=false}={}) {
  const temporary=path+'.pending-'+randomUUID(),h=await open(temporary,'wx',0o600);
  try {
    await h.writeFile(bytes);await h.sync();await h.close();
    if(replace)await rename(temporary,path);
    else {
      try {await link(temporary,path);}
      catch(error){if(error.code!=='EEXIST')throw error;check((await readFile(path)).equals(bytes),'Retained complete bytes differ.');}
    }
    const parent=await open(resolve(path,'..'),constants.O_RDONLY|constants.O_DIRECTORY);
    try {await parent.sync();}finally{await parent.close();}
  } finally {
    await h.close().catch(()=>{});await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
async function identity(path) {
  const h=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)),digest=createHash('sha256');let bytes=0;
  try {
    const before=await h.stat();check(before.isFile(),'Expected a complete regular source file.');
    for await(const part of h.createReadStream({autoClose:false})){digest.update(part);bytes+=part.length;}
    const after=await h.stat();
    check(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&
      before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'Source changed during receiving.');
    return {bytes,sha256:digest.digest('hex')};
  } finally {await h.close();}
}
let state=await readJSON(paths.journal,true);
if(!state) {
  const selected=await identity(options['--file']);
  check(selected.bytes>0&&selected.bytes<=APPLICATION_INPUT_MAX_BYTES,'Select one complete grant scenario within 16 MiB.');
  state={schema:'stellar-forge.runtime-application-inputs.receiving.v1',operationId:'SCF-RUNTIME-ORIGINAL-INPUTS-C57E-20261013',
    directory:root,sourceRoot,options,source:{...selected,name:basename(options['--file'])},ids:{
      selection:randomUUID(),backupReview:randomUUID(),backupCreate:randomUUID(),restore:randomUUID()},
    label:'Original file receiving '+randomUUID(),steps:{},attempts:[]};
  await saveJSON(paths.journal,state);
}
check(JSON.stringify(state.options)===JSON.stringify(options)&&state.directory===root&&state.sourceRoot===sourceRoot,
  'Continue with the exact original receiving paths and inputs.');
const checkpoint=()=>saveJSON(paths.journal,state,true);
const attempt={id:randomUUID(),startedAt:new Date().toISOString(),phase:'RUNNING'};
state.attempts.push(attempt);await checkpoint();
const outputs=join(root,'attempts',attempt.id);await mkdir(outputs,{recursive:true,mode:0o700});
async function step(name,action) {
  if(state.steps[name]?.phase==='COMPLETE')return state.steps[name].result;
  state.steps[name]={...state.steps[name],phase:'RUNNING',attemptId:attempt.id};await checkpoint();
  try {
    const result=await action();state.steps[name]={...state.steps[name],phase:'COMPLETE',result};await checkpoint();
    process.stdout.write(JSON.stringify({step:name,phase:'COMPLETE',result})+'\n');return result;
  } catch(error) {
    state.steps[name]={...state.steps[name],phase:'INTERRUPTED',error:{code:error.code??null,message:error.message}};
    await checkpoint();throw error;
  }
}
async function waitBackup(model,storageDirectory,operationId) {
  const end=Date.now()+180000;
  while(Date.now()<end) {
    const row=(await model.workspaceBackupState({storageDirectory})).operations.find(x=>x.operationId===operationId);
    if(row?.phase==='COMPLETE')return row;
    if(['FAILED','INTERRUPTED'].includes(row?.phase))
      throw Object.assign(Error(row.error?.message??'Continue the original backup operation through Runtime.'),{operation:row});
    await new Promise(done=>setTimeout(done,100));
  }
  throw Error('Original backup operation is still pending: '+operationId);
}
async function waitConnection(model,applicationId) {
  const connection=await model.applicationsConnect({applicationId});
  if(!connection.operationId)return connection;
  const end=Date.now()+180000;
  while(Date.now()<end) {
    const row=await model.operationStatus({operationId:connection.operationId});
    if(row.phase==='COMPLETE'||row.phase==='SUCCEEDED')return row;
    if(['FAILED','INTERRUPTED','CANCELLED'].includes(row.displayPhase??row.phase))
      throw Object.assign(Error('Original application connection needs continuation.'),{operation:row});
    await new Promise(done=>setTimeout(done,100));
  }
  throw Error('Original application connection remains pending: '+connection.operationId);
}
let model=null,control=null,server=null,browser=null;
try {
  await step('retain_complete_original',async()=>{
    if(!await exists(paths.original)) {
      const original=await readFile(options['--file']);
      check(original.length===state.source.bytes&&sha(original)===state.source.sha256,'Selected original bytes changed.');
      await publishBytes(paths.original,original);
    }
    const retained=await identity(paths.original);
    check(retained.sha256===state.source.sha256&&retained.bytes===state.source.bytes,'Retained original input differs.');
    JSON.parse(await readFile(paths.original,'utf8')); // The actual Grant provider performs its full schema review.
    return retained;
  });
  await step('create_original_workspace',async()=>{
    const value=await exists(join(paths.workspace,'workspace.json'))?
      await readJSON(join(paths.workspace,'workspace.json')):await createRuntimeWorkspace({directory:paths.workspace});
    state.workspaceId=value.workspaceId;await checkpoint();return value;
  });
  if(!state.steps.move_original?.result) {
    if(await exists(join(paths.workspace,'workspace.json')))model=await openRuntimeWorkspace({directory:paths.workspace});
    else check(await exists(join(paths.retained,'workspace.json'))&&state.steps.inspect_archive?.phase==='COMPLETE',
      'Original workspace is absent before completed archive inspection.');
  }
  const begun=await step('retain_partial_upload',async()=>{
    const bytes=await readFile(paths.original),chunks=[];
    for(let i=0;i<bytes.length;i+=APPLICATION_INPUT_CHUNK_BYTES)
      chunks.push(sha(bytes.subarray(i,i+APPLICATION_INPUT_CHUNK_BYTES)));
    const result=await model.applicationInputBegin({manifest:{
      schema:'stellar-forge.sf88.collection-input-upload.v1',kind:'body',name:state.source.name,
      bytes:bytes.length,chunkSha256:chunks}});
    if(result.phase!=='READY'&&!result.receivedChunks.includes(0))
      await model.applicationInputChunk({uploadId:result.uploadId,index:0,
        body:Readable.from([bytes.subarray(0,APPLICATION_INPUT_CHUNK_BYTES)])});
    return {uploadId:result.uploadId,manifest:{name:state.source.name,bytes:bytes.length,chunkSha256:chunks}};
  });
  await step('reopen_same_partial_upload',async()=>{
    await model.close();model=await openRuntimeWorkspace({directory:paths.workspace});
    const result=await model.applicationInputInspect({uploadId:begun.uploadId});
    check(result.receivedChunks.includes(0)||result.phase==='READY','Original uploaded chunk was lost on reopen.');return result;
  });
  const attached=await step('attach_existing_ready_runtime',()=>model.attach({
    directory:options['--runtime'],label:'Existing receiving runtime'}));
  check(attached.status==='READY','The original selected runtime must be READY.');
  if(state.steps.browser_application?.phase!=='COMPLETE') {
    const {chromium}=await import(pathToFileURL(join(options['--playwright-root'],'playwright','index.mjs')));
    server=await startRuntimeWorkspace({directory:paths.workspace,port:0});
    const tmp=join(root,'browser-tmp');await mkdir(tmp,{recursive:true,mode:0o700});
    browser=await chromium.launch({executablePath:options['--chromium'],headless:true,
      env:{...process.env,TMPDIR:tmp},args:['--disable-dev-shm-usage']});
    const context=await browser.newContext({viewport:{width:1360,height:950},acceptDownloads:true});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(server.url);await page.locator('[data-view="applications"]').click();
    await step('browser_complete_original_upload',async()=>{
      const shelf=page.locator('#application-input-library');
      await shelf.evaluate(node=>{node.open=true;});
      await page.locator('#application-input-file').setInputFiles(paths.original);
      await shelf.getByLabel('Saved filename',{exact:true}).fill(state.source.name);
      const before=await model.applicationInputInspect({uploadId:begun.uploadId});
      const completion=before.phase==='READY'?null:page.waitForResponse(response=>response.url().endsWith('/api/application-inputs/complete')&&response.request().method()==='POST');
      await shelf.getByRole('button',{name:'Save complete original',exact:true}).click();
      if(completion)check((await completion).ok(),'Original browser upload failed.');
      await shelf.getByRole('button',{name:'Prepare working copy',exact:true}).first().waitFor();
      const result=await model.applicationInputInspect({uploadId:begun.uploadId});
      check(result.phase==='READY'&&result.input.bytes===state.source.bytes,'Browser did not complete the same original upload.');
      return result;
    });
    const selected=await step('prepare_original_working_copy',()=>model.applicationInputPrepare({
      requestId:state.ids.selection,uploadId:begun.uploadId,kind:'grant-workspace',field:'scenarioFile'}));
    await step('retain_edited_working_copy',async()=>{
      const original=await readFile(paths.original),edited=Buffer.concat([original,Buffer.from('\n')]);
      const actual=await readFile(selected.path);
      if(actual.equals(original)) {
        await publishBytes(selected.path,edited,{replace:true});
      } else check(actual.equals(edited),'Working copy contains a different native edit; retain it for the operator.');
      const replay=await model.applicationInputPrepare({requestId:state.ids.selection,uploadId:begun.uploadId,
        kind:'grant-workspace',field:'scenarioFile'});
      check(replay.current.sha256===sha(edited)&&replay.current.changed,'Original selection replay replaced the native working edit.');
      return {path:selected.path,bytes:edited.length,sha256:sha(edited),requestId:state.ids.selection};
    });
    await step('browser_application',async()=>{
      const existing=(await model.applicationsState({historyLimit:1})).applications.filter(x=>x.label===state.label);
      check(existing.length<=1,'More than one application uses the retained receiving identity.');
      let applicationId=existing[0]?.id;
      if(!applicationId) {
        await page.locator('#application-label').fill(state.label);
        await page.locator('#application-runtime').selectOption(attached.runtimeId);
        await page.locator('#application-kind').selectOption('grant-workspace');
        await page.locator('#application-setting-workspaceDirectory').fill(join(paths.workspace,'grant-application'));
        const setting=page.locator('#application-setting-scenarioFile');
        await setting.locator('..').getByRole('button',{name:'Use saved file',exact:true}).click();
        const row=page.locator('#application-input-library article').filter({hasText:selected.path});
        await row.getByRole('button',{name:'Use this working copy',exact:true}).click();
        check(await setting.inputValue()===selected.path,'Browser did not retain the exact prepared path.');
        await page.getByRole('button',{name:'Review application',exact:true}).click();
        const savedResponse=page.waitForResponse(r=>r.url().endsWith('/api/applications/save')&&r.request().method()==='POST');
        await page.getByRole('button',{name:'Save application',exact:true}).click();
        const response=await savedResponse,value=await response.json();
        check(response.ok()&&value.saved,'Native application save did not complete.');applicationId=value.applicationId;
      }
      const current=(await model.applicationsState({historyLimit:1})).applications.find(x=>x.id===applicationId);
      check(current?.kind==='grant-workspace'&&current.settings.scenarioFile===selected.path&&current.label===state.label,
        'Saved application changed its original file selection.');
      await waitConnection(model,applicationId);
      await page.locator('#application-input-library').evaluate(node=>{node.open=true;});
      await page.screenshot({path:join(outputs,'desktop-original-files.png'),fullPage:true});
      await page.setViewportSize({width:320,height:780});
      await page.screenshot({path:join(outputs,'phone-original-files.png'),fullPage:true});
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Application file shelf overflows at 320 pixels.');
      check(errors.length===0,'Browser errors: '+errors.join('; '));
      return {applicationId,revision:current.revision,selectionPath:selected.path,screenshots:outputs,browserErrors:errors};
    });
    await browser.close();browser=null;await server.close();server=null;
  }
  await step('cli_reopen_and_original_download',async()=>{
    const value=await runApplicationInputCommand(model,'input-file-import',{'--file':paths.original,'--name':state.source.name});
    check(value.uploadId===begun.uploadId,'CLI re-import created a different original input.');
    const target=join(root,'downloaded-original');
    let result;
    if(await exists(target))result=await identity(target);
    else result=await runApplicationInputCommand(model,'input-file-export',{'--upload-id':begun.uploadId,'--output':target});
    check(result.bytes===state.source.bytes&&result.sha256===state.source.sha256,'CLI download changed original bytes.');
    return {path:target,...result};
  });
  const review=await step('review_backup',()=>model.workspaceBackupReview({
    requestId:state.ids.backupReview,label:'Original application files and complete workspace',storageDirectory:paths.backups}));
  const backup=await step('start_backup',()=>model.workspaceBackupCreate({requestId:state.ids.backupCreate,
    reviewId:review.reviewId,reviewSha256:review.reviewSha256,storageDirectory:paths.backups}));
  const completed=await step('complete_backup',()=>waitBackup(model,paths.backups,backup.operationId));
  await step('create_control',async()=>await exists(join(paths.control,'workspace.json'))?
    readJSON(join(paths.control,'workspace.json')):createRuntimeWorkspace({directory:paths.control}));
  control=await openRuntimeWorkspace({directory:paths.control});
  const inspected=await step('inspect_archive',()=>control.workspaceBackupInspect({
    archivePath:completed.result.archivePath,sha256:completed.result.sha256,storageDirectory:paths.receiving}));
  check(inspected.review.workspaceId===state.workspaceId,'Backup contains a different workspace.');
  await step('move_original',async()=>{
    if(model){await model.close();model=null;}
    if(await exists(paths.retained))check(!await exists(paths.workspace),'Both source and retained destination exist before restore.');
    else await rename(paths.workspace,paths.retained);
    const config=await readJSON(join(paths.retained,'workspace.json'));
    check(config.workspaceId===state.workspaceId&&config.directory===paths.workspace,'Retained workspace identity changed.');
    return {retained:paths.retained,directory:paths.workspace,workspaceId:state.workspaceId};
  });
  const restore=await step('start_restore',()=>control.workspaceBackupRestore({requestId:state.ids.restore,
    archiveId:inspected.archiveId,manifestSha256:inspected.manifestSha256,directory:paths.workspace,storageDirectory:paths.receiving}));
  const restored=await step('complete_restore',()=>waitBackup(control,paths.receiving,restore.operationId));
  await step('review_and_open_restored_workspace',async()=>{
    const binding=await control.workspaceBackupBindings({receivingId:restored.result.receivingId,storageDirectory:paths.receiving});
    check(binding.canOpen,'Original runtime bindings are not ready after restore.');
    return control.workspaceBackupOpen({receivingId:restored.result.receivingId,reviewId:binding.reviewId,
      reviewSha256:binding.reviewSha256,storageDirectory:paths.receiving});
  });
  model=await openRuntimeWorkspace({directory:paths.workspace});
  await step('reopen_full_original_inputs_and_application',async()=>{
    const original=await model.applicationInputDownload({uploadId:begun.uploadId}),digest=createHash('sha256');let bytes=0;
    try {for await(const part of original.stream){bytes+=part.length;digest.update(part);}}
    finally {original.stream.destroy();await original.close();}
    check(bytes===state.source.bytes&&digest.digest('hex')===state.source.sha256,'Restored complete original differs.');
    const selected=await model.applicationInputSelection({requestId:state.ids.selection}),edited=state.steps.retain_edited_working_copy.result;
    check(selected.current.bytes===edited.bytes&&selected.current.sha256===edited.sha256,'Restored working edit or selection changed.');
    const app=(await model.applicationsState({historyLimit:1})).applications.find(x=>x.id===state.steps.browser_application.result.applicationId);
    check(app?.settings.scenarioFile===selected.path&&app.revision===state.steps.browser_application.result.revision,
      'Restored application lost the selected input or original revision.');
    return {workspaceId:state.workspaceId,uploadId:begun.uploadId,original:state.source,
      selected,applicationId:app.id,revision:app.revision,backup:completed.result,restore:restored.result};
  });
  attempt.phase='COMPLETE';attempt.completedAt=new Date().toISOString();await checkpoint();
  await saveJSON(join(outputs,'COMPLETE_RECEIVING.json'),state.steps.reopen_full_original_inputs_and_application.result);
  process.stdout.write(JSON.stringify({phase:'COMPLETE',operationId:state.operationId,journal:paths.journal,outputs})+'\n');
} catch(error) {
  attempt.phase='INTERRUPTED';attempt.error={code:error.code??null,message:error.message};await checkpoint();
  process.stderr.write(JSON.stringify(attempt)+'\n');process.exitCode=1;
} finally {
  if(browser)await browser.close().catch(()=>{});
  if(server)await server.close().catch(()=>{});
  if(model)await model.close().catch(()=>{});
  if(control)await control.close().catch(()=>{});
  await lease.close();
}
