#!/usr/bin/env node
// MIT. One retained companion-set/Application/backup receiving course; no CI registration.
import { constants } from 'node:fs';
import { mkdir, readFile, open, lstat, rename, link, unlink } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createRuntimeWorkspace, openRuntimeWorkspace } from '../model.mjs';
import { startRuntimeWorkspace } from '../server.mjs';
import { readJSON, saveJSON, privateDirectory, operationLease } from '../storage.mjs';
import { receiveOperationHistory } from './OPERATION_HISTORY_RECEIVE.mjs';
import { APPLICATION_INPUT_CHUNK_BYTES } from '../application-inputs.mjs';
import { readApplicationInputSetDirectory,runApplicationInputSetCommand } from '../application-input-sets-cli.mjs';
import { applicationInputSetJSON,applicationInputSetPath } from '../public/application-input-set-format.mjs';

const options={};
for(let i=2;i<process.argv.length;i+=2) {
  if(!['--operation','--directory','--member','--runtime','--chromium','--playwright-root'].includes(process.argv[i])||!process.argv[i+1])
    throw Error('Use --operation PRIVATE_CASE --directory COMPLETE_ORIGINAL_FOLDER --member RELATIVE_GRANT_SCENARIO --runtime EXISTING_READY_RUNTIME --chromium EXISTING_CHROME --playwright-root NODE_MODULES.');
  options[process.argv[i]]=process.argv[i]==='--member'?applicationInputSetPath(process.argv[i+1]):resolve(process.argv[i+1]);
}
for(const name of ['--operation','--directory','--member','--runtime','--chromium','--playwright-root'])
  if(!options[name])throw Error('Missing '+name);
const root=options['--operation'],sourceRoot=fileURLToPath(new URL('../',import.meta.url));
await mkdir(root,{recursive:true,mode:0o700});await privateDirectory(root);
const lease=await operationLease(join(root,'receiving.lock'));
const paths={journal:join(root,'RECEIVING.json'),original:join(root,'original-set'),
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
  const selected=await readApplicationInputSetDirectory({directory:options['--directory']});
  check(selected.manifest.files.length>=2&&selected.manifest.files.some(f=>f.path===options['--member']),
    'Select the complete original companion folder and its actual Grant scenario member.');
  state={schema:'stellar-forge.runtime-application-input-sets.receiving.v1',operationId:'SCF-RUNTIME-COMPANION-INPUTS-C57E-20261013',
    directory:root,sourceRoot,options,source:selected.manifest,ids:{
      selection:randomUUID(),backupReview:randomUUID(),backupCreate:randomUUID(),restore:randomUUID()},
    label:'Companion file receiving '+randomUUID(),steps:{},attempts:[]};
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
    await mkdir(paths.original,{recursive:true,mode:0o700});
    for(const path of state.source.directories)await mkdir(join(paths.original,path),{recursive:true,mode:0o700});
    for(const file of state.source.files) {
      const original=await readFile(join(options['--directory'],file.path));
      check(original.length===file.bytes&&sha(original)===file.sha256,'Selected original member changed: '+file.path);
      await publishBytes(join(paths.original,file.path),original);
    }
    const retained=await readApplicationInputSetDirectory({directory:paths.original,name:state.source.name});
    check(applicationInputSetJSON(retained.manifest)===applicationInputSetJSON(state.source),'Complete retained folder differs.');
    JSON.parse(await readFile(join(paths.original,options['--member']),'utf8'));
    return {setId:sha(applicationInputSetJSON(state.source)),manifest:retained.manifest};
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
    const result=await model.applicationInputSetBegin({manifest:state.source});
    const member=result.files.find(f=>f.bytes>0)??result.files[0];
    if(member.phase!=='READY'&&member.chunkSha256.length&&!member.receivedChunks.includes(0)) {
      const bytes=await readFile(join(paths.original,member.path));
      await model.applicationInputChunk({uploadId:member.uploadId,index:0,
        body:Readable.from([bytes.subarray(0,APPLICATION_INPUT_CHUNK_BYTES)])});
    }
    return {setId:result.setId,firstMember:member.path,firstUploadId:member.uploadId};
  });
  await step('reopen_same_partial_upload',async()=>{
    await model.close();model=await openRuntimeWorkspace({directory:paths.workspace});
    const result=await model.applicationInputSetInspect({setId:begun.setId});
    const member=result.files.find(f=>f.path===begun.firstMember);
    check(member&&(member.bytes===0||member.receivedChunks.includes(0)||member.phase==='READY'),'Original upload was lost on reopen.');
    return result;
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
      const shelf=page.locator('#application-input-sets');
      await shelf.evaluate(node=>{node.open=true;});
      const inferred=new Set();
      for(const file of state.source.files){const parts=file.path.split('/');for(let i=1;i<parts.length;i++)inferred.add(parts.slice(0,i).join('/'));}
      if(state.source.directories.some(path=>!inferred.has(path))) {
        // Browser FileList omits empty directories. The original CLI retains those
        // directories; the browser then chooses the exact same complete source set.
        await runApplicationInputSetCommand(model,'input-set-import',{'--directory':paths.original,'--name':state.source.name});
        await shelf.getByRole('button',{name:'Refresh source sets',exact:true}).click();
      } else {
        await shelf.getByLabel('Choose a source folder',{exact:true}).setInputFiles(paths.original);
        await shelf.getByLabel('Source set name',{exact:true}).fill(state.source.name);
        const response=page.waitForResponse(r=>r.url().endsWith('/api/application-input-sets/complete')&&r.request().method()==='POST');
        await shelf.getByRole('button',{name:'Save complete source set',exact:true}).click();
        check((await response).ok(),'Browser companion upload failed.');
      }
      const result=await model.applicationInputSetInspect({setId:begun.setId});
      check(result.phase==='READY'&&result.files.length===state.source.files.length,'Browser/CLI did not complete the same source set.');
      for(const file of state.source.files) {
        const actual=result.files.find(f=>f.path===file.path);
        check(actual?.bytes===file.bytes&&actual.sha256===file.sha256,'Original companion changed: '+file.path);
      }
      return {setId:result.setId,manifest:result.manifest,files:result.files};
    });
    const selected=await step('prepare_original_working_copy',()=>model.applicationInputSetPrepare({
      requestId:state.ids.selection,setId:begun.setId,kind:'grant-workspace',field:'scenarioFile',memberPath:options['--member']}));
    await step('retain_edited_working_copy',async()=>{
      for(const file of state.source.files)if(file.path!==options['--member']) {
        const actual=await identity(join(selected.directory,file.path));
        check(actual.bytes===file.bytes&&actual.sha256===file.sha256,'Companion path/body differs: '+file.path);
      }
      const original=await readFile(join(paths.original,options['--member'])),edited=Buffer.concat([original,Buffer.from('\n')]);
      const actual=await readFile(selected.path);
      if(actual.equals(original))await publishBytes(selected.path,edited,{replace:true});
      else check(actual.equals(edited),'Working member contains a different native edit; retain it for the operator.');
      const replay=await model.applicationInputSetPrepare({requestId:state.ids.selection,setId:begun.setId,
        kind:'grant-workspace',field:'scenarioFile',memberPath:options['--member']});
      const current=replay.current.find(f=>f.path===options['--member']);
      check(current?.sha256===sha(edited)&&current.changed,'Original set replay replaced the native working edit.');
      return {path:selected.path,directory:selected.directory,bytes:edited.length,sha256:sha(edited),requestId:state.ids.selection};
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
        const row=page.locator('#application-input-sets article').filter({hasText:selected.path});
        await row.getByRole('button',{name:'Use current working set',exact:true}).click();
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
      await page.locator('#application-input-sets').evaluate(node=>{node.open=true;});
      await page.screenshot({path:join(outputs,'desktop-companion-files.png'),fullPage:true});
      await page.setViewportSize({width:320,height:780});
      await page.screenshot({path:join(outputs,'phone-companion-files.png'),fullPage:true});
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Application file shelf overflows at 320 pixels.');
      check(errors.length===0,'Browser errors: '+errors.join('; '));
      return {applicationId,revision:current.revision,selectionPath:selected.path,screenshots:outputs,browserErrors:errors};
    });
    await browser.close();browser=null;await server.close();server=null;
  }
  await step('cli_reopen_and_original_download',async()=>{
    const value=await runApplicationInputSetCommand(model,'input-set-import',{'--directory':paths.original,'--name':state.source.name});
    check(value.setId===begun.setId,'CLI re-import created a different source set.');
    const result=await runApplicationInputSetCommand(model,'input-set-export',{'--set-id':begun.setId,'--output':join(root,'exported-original-set')});
    const received=await readApplicationInputSetDirectory({directory:result.originalsDirectory,name:state.source.name});
    check(applicationInputSetJSON(received.manifest)===applicationInputSetJSON(state.source),'CLI export changed original companion bytes or paths.');
    return {directory:result.directory,setId:result.setId,manifest:received.manifest};
  });
  const review=await step('review_backup',()=>model.workspaceBackupReview({
    requestId:state.ids.backupReview,label:'Complete original companion set, working edits and application',storageDirectory:paths.backups}));
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
    const original=await model.applicationInputSetInspect({setId:begun.setId});
    check(original.phase==='READY'&&applicationInputSetJSON(original.manifest)===applicationInputSetJSON(state.source),'Restored complete source set differs.');
    for(const file of original.files) {
      const download=await model.applicationInputDownload({uploadId:file.uploadId}),digest=createHash('sha256');let bytes=0;
      try {for await(const part of download.stream){bytes+=part.length;digest.update(part);}}
      finally {download.stream.destroy();await download.close();}
      check(bytes===file.bytes&&digest.digest('hex')===file.sha256,'Restored original companion differs: '+file.path);
    }
    const selected=await model.applicationInputSetSelection({requestId:state.ids.selection}),edited=state.steps.retain_edited_working_copy.result;
    check(!selected.error&&selected.current.length===state.source.files.length,'Restored working set is incomplete.');
    for(const file of state.source.files) {
      const actual=selected.current.find(f=>f.path===file.path),expected=file.path===options['--member']?edited:file;
      check(actual?.bytes===expected.bytes&&actual.sha256===expected.sha256,'Restored working member changed: '+file.path);
    }
    const app=(await model.applicationsState({historyLimit:1})).applications.find(x=>x.id===state.steps.browser_application.result.applicationId);
    check(app?.settings.scenarioFile===selected.path&&app.revision===state.steps.browser_application.result.revision,
      'Restored application lost the selected input or original revision.');
    return {workspaceId:state.workspaceId,setId:begun.setId,original:state.source,
      selected,applicationId:app.id,revision:app.revision,backup:completed.result,restore:restored.result};
  });
  await step('receive_original_operation_history',async()=>{
    const {chromium}=await import(pathToFileURL(join(options['--playwright-root'],'playwright','index.mjs')));
    server=await startRuntimeWorkspace({directory:paths.workspace,port:0});
    const tmp=join(root,'browser-tmp');await mkdir(tmp,{recursive:true,mode:0o700});
    browser=await chromium.launch({executablePath:options['--chromium'],headless:true,
      env:{...process.env,TMPDIR:tmp},args:['--no-sandbox','--disable-dev-shm-usage']});
    try {
      const context=await browser.newContext({viewport:{width:1360,height:950},acceptDownloads:true});
      const page=await context.newPage();await page.goto(server.url);
      await page.locator('#workspace-location').filter({hasText:paths.workspace}).waitFor();
      return await receiveOperationHistory({page,model,outputDirectory:outputs});
    } finally {
      await browser.close();browser=null;await server.close();server=null;
    }
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
