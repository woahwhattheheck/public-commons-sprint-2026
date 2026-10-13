#!/usr/bin/env node
// MIT. Continue the original companion operation with its actual edited source tree.
import {constants} from 'node:fs';
import {mkdir,open,lstat,readFile,rename,link,unlink} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createRuntimeWorkspace,openRuntimeWorkspace} from '../model.mjs';
import {startRuntimeWorkspace} from '../server.mjs';
import {readJSON,saveJSON,privateDirectory,operationLease} from '../storage.mjs';
import {readApplicationInputSetDirectory,retainApplicationInputSetDirectory} from '../application-input-set-sources.mjs';
import {runApplicationInputEditionCommand} from '../application-input-set-editions-cli.mjs';
import {applicationInputSetJSON} from '../public/application-input-set-format.mjs';
const options={};
for(let i=2;i<process.argv.length;i+=2) {
 const key=process.argv[i],value=process.argv[i+1];
 if(!['--operation','--workspace','--selection-request-id','--chromium','--playwright-root'].includes(key)||!value)throw Error('Use --operation NEW_PRIVATE_DIRECTORY --workspace EXISTING_WORKSPACE --selection-request-id UUID --chromium EXISTING_CHROME --playwright-root NODE_MODULES.');
 options[key]=key==='--selection-request-id'?value:resolve(value);
}
for(const key of ['--operation','--workspace','--selection-request-id','--chromium','--playwright-root'])if(!options[key])throw Error('Missing '+key);
const root=options['--operation'];await mkdir(root,{recursive:true,mode:0o700});await privateDirectory(root);
const lease=await operationLease(join(root,'receiving.lock'));
const sha=value=>createHash('sha256').update(value).digest('hex');
const check=(value,message)=>{if(!value)throw Error(message);};
const exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const paths={journal:join(root,'RECEIVING.json'),parent:join(root,'parent-source'),current:join(root,'selected-working-source'),
 workspace:join(root,'edition-workspace'),retained:join(root,'retained-edition-workspace'),
 receiver:join(root,'independent-receiver'),control:join(root,'restore-control'),
 backup:join(root,'backups'),receiving:join(root,'receiving-backups'),handoff:join(root,'complete-edition-handoff')};
let state=await readJSON(paths.journal,true);
if(!state){state={schema:'stellar-forge.runtime-application-input-editions.receiving.v1',
 operationId:'SCF-RUNTIME-COMPANION-INPUTS-C57E-20261013',options,ids:{
 selection:randomUUID(),receiving:randomUUID(),receivedSelection:randomUUID(),backupReview:randomUUID(),
 backupCreate:randomUUID(),restore:randomUUID()},label:'Edited source '+randomUUID(),steps:{},attempts:[]};await saveJSON(paths.journal,state);}
check(JSON.stringify(state.options)===JSON.stringify(options),'Continue the same original source and receiving paths.');
const checkpoint=()=>saveJSON(paths.journal,state,true);
const attempt={id:randomUUID(),startedAt:new Date().toISOString(),phase:'RUNNING'};
state.attempts.push(attempt);await checkpoint();
const outputs=join(root,'attempts',attempt.id);await mkdir(outputs,{recursive:true,mode:0o700});
async function step(name,fn) {
 if(state.steps[name]?.phase==='COMPLETE')return state.steps[name].result;
 state.steps[name]={phase:'RUNNING',attemptId:attempt.id};await checkpoint();
 try{const result=await fn();state.steps[name]={phase:'COMPLETE',attemptId:attempt.id,result};await checkpoint();
 process.stdout.write(JSON.stringify({step:name,phase:'COMPLETE',result})+'\n');return result;}
 catch(error){state.steps[name]={phase:'INTERRUPTED',attemptId:attempt.id,error:{code:error.code??null,message:error.message}};
 await checkpoint();throw error;}
}
async function publish(path,bytes) {
 await mkdir(dirname(path),{recursive:true,mode:0o700});const temporary=path+'.pending-'+randomUUID(),fd=await open(temporary,'wx',0o600);
 try{await fd.writeFile(bytes);await fd.sync();await fd.close();
   try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;
    check((await readFile(path)).equals(bytes),'Existing retained source differs: '+path);}
   const directory=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY);
   try{await directory.sync();}finally{await directory.close();}
 }finally{await fd.close().catch(()=>{});await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
async function copyTree(from,to,manifest) {
 await mkdir(to,{recursive:true,mode:0o700});
 for(const directory of manifest.directories)await mkdir(join(to,directory),{recursive:true,mode:0o700});
 for(const file of manifest.files){const bytes=await readFile(join(from,file.path));
  check(bytes.length===file.bytes&&sha(bytes)===file.sha256,'Selected original changed: '+file.path);await publish(join(to,file.path),bytes);}
 const actual=await readApplicationInputSetDirectory({directory:to,name:manifest.name});
 check(applicationInputSetJSON(actual.manifest)===applicationInputSetJSON(manifest),'Complete retained source differs.');
}
async function create(path) {return await exists(join(path,'workspace.json'))?readJSON(join(path,'workspace.json')):createRuntimeWorkspace({directory:path});}
async function waitBackup(model,directory,id) {
 const until=Date.now()+180000;
 while(Date.now()<until){const result=(await model.workspaceBackupState({storageDirectory:directory})).operations.find(row=>row.operationId===id);
  if(result?.phase==='COMPLETE')return result;
  if(['FAILED','INTERRUPTED'].includes(result?.phase))throw Object.assign(Error(result.error?.message??'Continue the retained backup operation.'),{operation:result});
  await new Promise(done=>setTimeout(done,100));}
 throw Error('Backup remains active: '+id);
}
let original=null,model=null,receiver=null,control=null,browser=null,server=null;
try{
 original=await openRuntimeWorkspace({directory:options['--workspace']});
 const source=await step('retain_actual_parent_and_working_source',async()=>{
  const selected=await original.applicationInputSetSelection({requestId:options['--selection-request-id']});
  check(selected.phase==='PREPARED','Choose the original completed working-set selection.');
  const actual=await readApplicationInputSetDirectory({directory:selected.directory,name:state.label});
  await original.applicationInputSetExport({setId:selected.setId,directory:paths.parent});
  await copyTree(selected.directory,paths.current,actual.manifest);
  const final=await readApplicationInputSetDirectory({directory:selected.directory,name:state.label});
  check(applicationInputSetJSON(actual.manifest)===applicationInputSetJSON(final.manifest),'Original working tree changed during retention.');
  return {selection:selected,manifest:actual.manifest};
 });
 await original.close();original=null;
 await step('create_isolated_workspace',()=>create(paths.workspace));
 const moved=await exists(paths.retained);
 if(!state.steps.move_original?.result&&!moved) {
   if(await exists(join(paths.workspace,'workspace.json')))model=await openRuntimeWorkspace({directory:paths.workspace});
   else check(await exists(paths.retained),'Original isolated workspace is unavailable.');
 }
 const parent=await step('receive_original_parent',async()=>{
  const value=await retainApplicationInputSetDirectory(model,{directory:join(paths.parent,'originals'),name:source.selection.manifest.name});
  check(value.setId===source.selection.setId,'Original parent identity changed.');return {setId:value.setId};
 });
 const selection=await step('prepare_original_selection',()=>model.applicationInputSetPrepare({
  requestId:state.ids.selection,setId:parent.setId,kind:source.selection.kind,field:source.selection.field,memberPath:source.selection.memberPath}));
 await step('retain_actual_edits_in_isolated_working_tree',async()=>{
  const archived=join(root,'retained-initial-working-tree');
  if(!await exists(archived))await rename(selection.directory,archived);
  await copyTree(paths.current,selection.directory,source.manifest);
  const replay=await model.applicationInputSetPrepare({requestId:state.ids.selection,setId:parent.setId,
    kind:source.selection.kind,field:source.selection.field,memberPath:source.selection.memberPath});
  const actual=await readApplicationInputSetDirectory({directory:replay.directory,name:state.label});
  check(applicationInputSetJSON(actual.manifest)===applicationInputSetJSON(source.manifest),'Prepared replay replaced actual working edits.');
  return {directory:replay.directory,manifest:actual.manifest};
 });
 if(!state.steps.move_original?.result&&!moved) {
  const module=await import(pathToFileURL(join(options['--playwright-root'],'playwright-core','index.mjs')).href);
  server=await startRuntimeWorkspace({directory:paths.workspace,port:0});
  const tmp=join(outputs,'browser-tmp');await mkdir(tmp,{mode:0o700});
  browser=await module.chromium.launch({executablePath:options['--chromium'],headless:true,
    env:{...process.env,TMPDIR:tmp},args:['--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:1360,height:950},acceptDownloads:true});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(server.url);await page.locator('[data-view="applications"]').click();
  const shelf=page.locator('#application-input-sets');await shelf.evaluate(node=>{node.open=true;});
  await step('browser_review_capture_and_reopen',async()=>{
   const row=shelf.locator('article').filter({hasText:selection.path}).first();
   await row.getByRole('button',{name:'Review edited source edition',exact:true}).click();
   const section=shelf.locator('.application-input-set-editions');
   await section.getByLabel('New source edition name',{exact:true}).fill(state.label);
   const response=page.waitForResponse(r=>r.url().endsWith('/api/application-input-set-editions/review')&&r.request().method()==='POST');
   await section.getByRole('button',{name:'Review current working files',exact:true}).click();
   check((await response).ok(),'Browser did not review the actual working source.');
   const reviewed=await model.applicationInputSetEditionReview({selectionRequestId:state.ids.selection,name:state.label});
   check(applicationInputSetJSON(reviewed.manifest)===applicationInputSetJSON(source.manifest),'Review changed actual source members.');
   let existing=(await model.applicationInputSetEditionsState({selectionRequestId:state.ids.selection,limit:100})).items.filter(item=>item.name===state.label);
   check(existing.length<=1,'More than one capture uses this retained native identity.');
   if(existing.length) {
    const saved=await model.applicationInputSetEditionRead({requestId:existing[0].requestId});
    check(saved.intent.review.reviewSha256===reviewed.reviewSha256,'Existing capture retains a different original review.');
    if(saved.phase!=='CAPTURED')await model.applicationInputSetEditionCapture({requestId:saved.requestId,review:saved.intent.review});
   } else {
    const saved=page.waitForResponse(r=>r.url().endsWith('/api/application-input-set-editions/capture')&&r.request().method()==='POST');
    await section.getByRole('button',{name:'Save reviewed source edition',exact:true}).click();
    check((await saved).ok(),'Browser source capture did not complete.');
   }
   existing=(await model.applicationInputSetEditionsState({selectionRequestId:state.ids.selection,limit:100})).items.filter(item=>item.name===state.label);
   check(existing.length===1&&existing[0].phase==='CAPTURED','Original capture is not complete.');
   const saved=await model.applicationInputSetEditionRead({requestId:existing[0].requestId});
   const replay=await model.applicationInputSetEditionCapture({requestId:saved.requestId,review:saved.intent.review});
   check(replay.setId===saved.setId&&replay.complete.intentSha256===saved.complete.intentSha256,'Completed replay changed original capture.');
   await page.reload();await page.locator('[data-view="applications"]').click();await shelf.evaluate(node=>{node.open=true;});
   await shelf.getByRole('button',{name:'Refresh source sets',exact:true}).click();
   await shelf.locator('.application-input-set-editions').getByRole('button',{name:'Open saved source edition',exact:true}).click();
   const downloaded=page.waitForEvent('download');
   await shelf.getByRole('button',{name:'Download source manifest',exact:true}).click();
   const download=await downloaded;await download.saveAs(join(outputs,'captured-source-manifest.json'));
   check(applicationInputSetJSON(JSON.parse(await readFile(join(outputs,'captured-source-manifest.json'),'utf8')))===applicationInputSetJSON(source.manifest),'Actual browser download differs.');
   await page.screenshot({path:join(outputs,'desktop-source-editions.png'),fullPage:true});
   await page.setViewportSize({width:320,height:780});
   await page.screenshot({path:join(outputs,'phone-source-editions.png'),fullPage:true});
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Source edition desk overflows at 320px.');
   check(errors.length===0,'Browser errors: '+errors.join('; '));
   return {requestId:saved.requestId,setId:saved.setId,review:saved.intent.review,complete:saved.complete,outputs};
  });
  await browser.close();browser=null;await server.close();server=null;
 }
 const captured=state.steps.browser_review_capture_and_reopen.result;
 await step('complete_parent_current_cli_export',()=>runApplicationInputEditionCommand(model,'input-set-edition-export',{
  '--request-id':captured.requestId,'--output':paths.handoff}));
 await step('create_independent_receiver',()=>create(paths.receiver));
 receiver=await openRuntimeWorkspace({directory:paths.receiver});
 const received=await step('independent_complete_cli_receive',async()=>{
  const value=await runApplicationInputEditionCommand(receiver,'input-set-edition-receive',{'--request-id':state.ids.receiving,'--directory':paths.handoff});
  check(value.source.setId===captured.setId&&value.origin.capture.requestId===captured.requestId&&
   value.origin.capture.review.parentSetId===parent.setId,'Independent receiver lost source or origin identity.');
  const reopened=await receiver.applicationInputSetEditionReceived({requestId:state.ids.receiving});
  check(reopened.documentSha256===value.documentSha256&&reopened.phase==='RECEIVED','Native receive did not reopen.');
  const member=source.manifest.files.some(file=>file.path===source.selection.memberPath)?source.selection.memberPath:'';
  const chosen=await receiver.applicationInputSetPrepare({requestId:state.ids.receivedSelection,setId:captured.setId,
   kind:source.selection.kind,field:source.selection.field,memberPath:member});
  const tree=await readApplicationInputSetDirectory({directory:chosen.directory,name:state.label});
  check(applicationInputSetJSON(tree.manifest)===applicationInputSetJSON(source.manifest),'Received editable tree differs.');
  return {requestId:state.ids.receiving,source:value.source,documentSha256:value.documentSha256,selection:chosen};
 });
 await receiver.close();receiver=null;
 const review=await step('review_full_workspace_backup',()=>model.workspaceBackupReview({
  requestId:state.ids.backupReview,label:'Original parent, edited source edition and exact capture history',storageDirectory:paths.backup}));
 const backup=await step('start_full_workspace_backup',()=>model.workspaceBackupCreate({requestId:state.ids.backupCreate,
  reviewId:review.reviewId,reviewSha256:review.reviewSha256,storageDirectory:paths.backup}));
 const complete=await step('complete_full_workspace_backup',()=>waitBackup(model,paths.backup,backup.operationId));
 await step('create_restore_control',()=>create(paths.control));control=await openRuntimeWorkspace({directory:paths.control});
 const inspected=await step('inspect_full_workspace_archive',()=>control.workspaceBackupInspect({
  archivePath:complete.result.archivePath,sha256:complete.result.sha256,storageDirectory:paths.receiving}));
 await step('move_original',async()=>{
  if(model){await model.close();model=null;}
  if(await exists(paths.retained))check(!await exists(paths.workspace),'Both restored and retained workspace exist.');
  else await rename(paths.workspace,paths.retained);
  return {retained:paths.retained,directory:paths.workspace};
 });
 const restore=await step('start_original_path_restore',()=>control.workspaceBackupRestore({requestId:state.ids.restore,
  archiveId:inspected.archiveId,manifestSha256:inspected.manifestSha256,directory:paths.workspace,storageDirectory:paths.receiving}));
 const restored=await step('complete_original_path_restore',()=>waitBackup(control,paths.receiving,restore.operationId));
 await step('review_restored_bindings',async()=>{
  const binding=await control.workspaceBackupBindings({receivingId:restored.result.receivingId,storageDirectory:paths.receiving});
  check(binding.canOpen,'Restored source workspace cannot open.');
  return control.workspaceBackupOpen({receivingId:restored.result.receivingId,reviewId:binding.reviewId,reviewSha256:binding.reviewSha256,storageDirectory:paths.receiving});
 });
 model=await openRuntimeWorkspace({directory:paths.workspace});
 const result=await step('reopen_complete_source_and_working_history',async()=>{
  const saved=await model.applicationInputSetEditionRead({requestId:captured.requestId});
  check(saved.complete.intentSha256===captured.complete.intentSha256&&saved.setId===captured.setId,'Restored capture identity changed.');
  for(const setId of [parent.setId,captured.setId])check((await model.applicationInputSetInspect({setId})).phase==='READY','Restored original is incomplete.');
  const selected=await model.applicationInputSetSelection({requestId:state.ids.selection});
  const tree=await readApplicationInputSetDirectory({directory:selected.directory,name:state.label});
  check(applicationInputSetJSON(tree.manifest)===applicationInputSetJSON(source.manifest),'Restored edited tree changed.');
  return {capture:saved,received,source:source.manifest,backup:complete.result,restore:restored.result,
   originalWorkspace:options['--workspace'],originalSelection:options['--selection-request-id']};
 });
 attempt.phase='COMPLETE';attempt.completedAt=new Date().toISOString();await checkpoint();
 await saveJSON(join(outputs,'COMPLETE_RECEIVING.json'),result);
 process.stdout.write(JSON.stringify({phase:'COMPLETE',operationId:state.operationId,journal:paths.journal,outputs})+'\n');
}catch(error){attempt.phase='INTERRUPTED';attempt.error={code:error.code??null,message:error.message};await checkpoint();
 process.stderr.write(JSON.stringify(attempt)+'\n');process.exitCode=1;
}finally{
 if(browser)await browser.close().catch(()=>{});if(server)await server.close().catch(()=>{});
 for(const value of [original,model,receiver,control])if(value)await value.close().catch(()=>{});
 await lease.close();
}
