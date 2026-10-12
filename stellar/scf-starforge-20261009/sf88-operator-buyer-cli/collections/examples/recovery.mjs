// Run: node collections/examples/recovery.mjs /ABS/OWNED_RUN
// Reuses existing Playwright/Chromium selected by PLAYWRIGHT_MODULE and CHROME_EXECUTABLE.
// This labeled operating example initializes a real native ledger but dispatches no provider/payment call.
// One native operating recovery/receiving journey. No paid request is dispatched.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { initializeWorkspace } from '../../workspace.mjs';
import { initializeQueue, openQueue } from '../../queue.mjs';
import { openCollections } from '../model.mjs';
import { startCollectionsWorkspace } from '../server.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ?? '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root = process.argv[2];
assert.ok(typeof root === 'string' && isAbsolute(root) && resolve(root) === root && root !== '/');
const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
const output = join(root,'native-run'), stateRoot=join(output,'original-state'), storeRoot=join(stateRoot,'collections'), inbox=join(stateRoot,'inbox');
const journal=join(output,'receiver'), bundle=join(output,'encrypted-backup');
const checkpoint=join(output,'checkpoint.json'), resultFile=join(output,'result.json');
const sha = value=>createHash('sha256').update(value).digest('hex');
const json = value=>JSON.stringify(value,null,2)+'\n';
await mkdir(output,{recursive:true,mode:0o700});
let saved=await readFile(checkpoint,'utf8').then(JSON.parse,e=>{if(e.code==='ENOENT')return {phases:[],schema:'scf.collection-recovery-native-example.v1'};throw e;});
const retain=async(path,value)=>{const tmp=path+'.pending';await writeFile(tmp,json(value),{mode:0o600});await rename(tmp,path);};
const phase=async(name,fn)=>{if(saved.phases.includes(name))return;console.log('PHASE '+name);await fn();saved.phases.push(name);await retain(checkpoint,saved);console.log('PASS '+name);};
let model,workspace,browser,context,page;
const failures=[];
const passEnv='SF88_BACKUP_PASSPHRASE';
const secretFile=join(output,'native-environment.json');
let privateEnvironment=await readFile(secretFile,'utf8').then(JSON.parse,e=>{if(e.code==='ENOENT')return null;throw e;});
if(!privateEnvironment){privateEnvironment={[passEnv]:randomBytes(32).toString('hex')};await writeFile(secretFile,json(privateEnvironment),{mode:0o600,flag:'wx'});}
const environment={...process.env,...privateEnvironment};
async function api(path,body){
 const response=await fetch(workspace.origin+path,{method:body===undefined?'GET':'POST',
  headers:{Authorization:'Bearer '+workspace.token,...(body===undefined?{}:{'Content-Type':'application/json'})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error),{code:data.error,status:response.status});return data;
}
async function waitOriginal(id){for(let n=0;n<240;n++){const v=await api('/api/recovery/'+id);if(!['RUNNING','CANCELLING'].includes(v.state))return v;await new Promise(r=>setTimeout(r,250));}throw Error('ORIGINAL_OPERATION_DID_NOT_FINISH');}
async function browserOpen(){
 if(!browser)browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE ?? '/workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 context=await browser.newContext({viewport:{width:1360,height:1000}});
 page=await context.newPage();page.on('pageerror',e=>failures.push(String(e)));
 await page.goto(workspace.url);await page.getByRole('button',{name:'Backup and receiving',exact:true}).click();
 await page.getByRole('heading',{name:'Backup and receiving',exact:true}).waitFor();
}
async function closeHost(){await context?.close();context=null;page=null;await workspace?.close();workspace=null;await model?.close();model=null;}
async function cli(args){
 const child=spawn(process.execPath,[join(sourceRoot,'collections/cli.mjs'),...args],{env:environment,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',done);});
 assert.equal(code,0,stderr);return JSON.parse(stdout);
}
try{
 await phase('native-operator-and-original-collection',async()=>{
  await mkdir(stateRoot,{mode:0o700});const inputs=join(stateRoot,'inputs');await mkdir(inputs,{mode:0o700});
  const body=await readFile(join(sourceRoot,'collections/README.md'));
  await writeFile(join(inputs,'source-description.md'),body,{mode:0o600,flag:'wx'});
  const terms={scheme:'exact',network:'stellar:testnet',asset:'C'+'A'.repeat(55),payTo:'G'+'B'.repeat(55),maxAtomic:'100'};
  const source=join(inputs,'review.json');
  await writeFile(source,json({operation:{intentId:'collection.recovery.source',method:'POST',
   url:'https://example.com/scf-recovery-source',headers:{'Content-Type':'text/markdown'},expect:terms,
   bodyFile:join(inputs,'source-description.md'),bodyBytes:body.length,bodySha256:sha(body)},
   responseFile:{destination:join(stateRoot,'source-response.bin'),maxBytes:1048576}}),{mode:0o600,flag:'wx'});
  const owner=await initializeWorkspace(['--config',source,'--dir',join(stateRoot,'operator'),
   '--actor','recovery-example','--service','collection-receiving','--payer','G'+'C'.repeat(55),
   '--python','/usr/bin/python3','--total-atomic','1000','--daily-atomic','1000'],{environment});
  saved.originalOperator=owner.directory;
  const cfg=JSON.parse(await readFile(owner.config,'utf8'));
  const empty={...cfg,operation:{...cfg.operation,intentId:'collection.recovery.empty',method:'POST',
   bodyFile:join(inputs,'empty.bin'),bodyBytes:0,bodySha256:sha(Buffer.alloc(0))},
   responseFile:{destination:join(stateRoot,'empty-response.bin'),maxBytes:1048576}};
  await writeFile(join(inputs,'empty.bin'),Buffer.alloc(0),{mode:0o600,flag:'wx'});
  const second=join(inputs,'empty.json');await writeFile(second,json(empty),{mode:0o600,flag:'wx'});
  await initializeQueue(inbox);model=await openCollections({directory:storeRoot,queueRoot:inbox});
  const preview=await model.preview({configFiles:[owner.config,second]});
  const collection=await model.create({id:'original-recovery-customer',name:'Original recovery customer · native example',
   configFiles:[owner.config,second],expectedPreviewSha256:preview.previewSha256});
  const pin={id:collection.id,expectedManifestSha256:collection.manifestSha256};
  await model.enqueue(pin);
  const cancel=await model.cancel({...pin,intentIds:['collection.recovery.source']});
  saved.collectionId=collection.id;saved.manifestSha256=collection.manifestSha256;
  saved.cancelledAttempt=cancel.items.find(x=>x.intentId==='collection.recovery.source').job.attempt.id;
  assert.equal(cancel.items.find(x=>x.intentId==='collection.recovery.empty').state,'QUEUED');
  const exportDir=join(stateRoot,'results-index');const exported=await model.export({...pin,directory:exportDir});
  saved.originalResultFiles=exported.files;saved.exampleMode='ORIGINAL_NATIVE_OPERATOR_PREPARATION_AND_CANCELLED_ATTEMPT_NO_PAYMENT';
  saved.originalJobSha256=sha(json(await (await openQueue(inbox)).list()));
  await model.close();model=null;
 });
 if(!saved.phases.includes('source-host-closed-before-receiving')){
  workspace=await startCollectionsWorkspace({directory:storeRoot,port:0,environment});await browserOpen();
  await phase('browser-source-review',async()=>{
   await page.getByLabel('Original private state root',{exact:true}).fill(stateRoot);
   await page.getByLabel('New encrypted backup directory',{exact:true}).fill(bundle);
   await page.getByRole('button',{name:'Review original workspace',exact:true}).click();
   await page.getByText('Review the actual source, saved attempts and runtime requirements, then create its encrypted backup.',{exact:true}).waitFor();
   assert.ok(await page.locator('#recovery-panel').getByText(saved.cancelledAttempt,{exact:true}).count());
   const reviewed=await api('/api/recovery/review',{stateRoot});saved.reviewSha256=reviewed.profile.reviewSha256;
   assert.equal(reviewed.profile.jobs.length,2);assert.equal(reviewed.profile.operators.length,1);
  });
  await phase('browser-capture-and-exact-encrypted-download',async()=>{
   // A resumed controller reestablishes only its read review before this uncompleted capture.
   await page.getByLabel('Original private state root',{exact:true}).fill(stateRoot);
   await page.getByLabel('New encrypted backup directory',{exact:true}).fill(bundle);
   await page.getByRole('button',{name:'Review original workspace',exact:true}).click();
   await page.getByText('Review the actual source, saved attempts and runtime requirements, then create its encrypted backup.',{exact:true}).waitFor();
   await page.getByLabel('Other writers to this original inbox and its operator workspaces are stopped',{exact:true}).check();
   await page.getByRole('button',{name:'Create encrypted backup',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('#recovery-panel')?.textContent.includes('Retained snapshot operation started.'));
   const history=await api('/api/recovery');saved.captureId=history.rows.find(x=>x.kind==='SNAPSHOT').requestId;
   await retain(checkpoint,saved);
   const complete=await waitOriginal(saved.captureId);assert.equal(complete.state,'COMPLETED',json(complete));
   assert.equal(complete.result.application.profile.jobs[0].state==='CANCELLED'||complete.result.application.profile.jobs[1].state==='CANCELLED',true);
   saved.backupRecordSha256=complete.result.recordSha256;
   const descriptors=await api('/api/recovery/'+saved.captureId+'/files',{});
   assert.ok(descriptors.files.length>10);
   for(const file of descriptors.files){
    const response=await fetch(workspace.origin+file.downloadUrl,{headers:{Authorization:'Bearer '+workspace.token}});
    assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);
   }
   saved.encryptedMemberCount=descriptors.files.length;saved.encryptedBytes=descriptors.files.reduce((s,x)=>s+x.bytes,0);
  });
  await phase('source-cli-retained-result',async()=>{
   const read=await cli(['backup-show','--directory',storeRoot,'--request-id',saved.captureId]);
   assert.equal(read.result.recordSha256,saved.backupRecordSha256);assert.equal(read.state,'COMPLETED');
  });
  await phase('source-host-closed-before-receiving',async()=>{await closeHost();});
 }
 await phase('owned-original-state-retained-aside',async()=>{
  assert.equal(sha(json(await(await openQueue(inbox)).list())),saved.originalJobSha256);
  await rename(stateRoot,join(output,'retained-original-state'));
  saved.retainedOriginalState=join(output,'retained-original-state');
 });
 workspace=await startCollectionsWorkspace({receivingDirectory:journal,port:0,environment});await browserOpen();
 await phase('receiver-verifies-original-backup',async()=>{
  await page.getByLabel('Retained encrypted backup directory',{exact:true}).fill(bundle);
  await page.getByRole('button',{name:'Verify and inspect backup',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#recovery-panel')?.textContent.includes('Retained verify operation started.'));
  const h=await api('/api/recovery');saved.verifyId=h.rows.find(x=>x.kind==='VERIFY').requestId;await retain(checkpoint,saved);
  const verified=await waitOriginal(saved.verifyId);assert.equal(verified.state,'COMPLETED',json(verified));
  assert.equal(verified.result.recordSha256,saved.backupRecordSha256);assert.equal(verified.result.target.state,'ABSENT');
  // A verified archive alone cannot initialize an absent original target through Open.
  await assert.rejects(()=>api('/api/recovery/'+saved.verifyId+'/open',{}),e=>e.code==='COLLECTION_RECOVERY_VERIFIED_BACKUP_REQUIRED');
  await assert.rejects(()=>stat(stateRoot),{code:'ENOENT'});
 });
 await phase('receiver-restores-and-opens-original-work',async()=>{
  // Select the exact retained verification when resuming this same browser case.
  await page.getByRole('button',{name:saved.verifyId,exact:true}).click();
  await page.getByRole('button',{name:'Restore original state',exact:true}).waitFor();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Restore original state',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#recovery-panel')?.textContent.includes('Retained restore operation started.'));
  const h=await api('/api/recovery');saved.restoreId=h.rows.find(x=>x.kind==='RESTORE').requestId;await retain(checkpoint,saved);
  const received=await waitOriginal(saved.restoreId);assert.equal(received.state,'COMPLETED',json(received));
  assert.equal(received.result.reopenError,null);assert.equal(received.result.reopened.requests,2);
  assert.equal(received.result.executionStarted,false);
  await page.getByRole('button',{name:'Refresh operation',exact:true}).click();
  await page.getByRole('button',{name:'Open restored collections',exact:true}).click();
  await page.getByText('Original collection and attempt history opened. No request was started.',{exact:true}).waitFor();
  const collection=await api('/api/collections/'+saved.collectionId);
  assert.equal(collection.manifestSha256,saved.manifestSha256);
  assert.equal(collection.items.find(x=>x.intentId==='collection.recovery.source').job.attempt.id,saved.cancelledAttempt);
  assert.equal(collection.items.find(x=>x.intentId==='collection.recovery.empty').state,'QUEUED');
  assert.equal(sha(json(await(await openQueue(inbox)).list())),saved.originalJobSha256);
  for(const file of saved.originalResultFiles)assert.equal(sha(await readFile(join(stateRoot,'results-index',file.name))),file.sha256);
 });
 await phase('retained-operation-reopen-and-no-duplicate-restore',async()=>{
  const show=await cli(['backup-show','--receiving-directory',journal,'--request-id',saved.restoreId]);
  assert.equal(show.state,'COMPLETED');
  const repeated=await cli(['backup-resume','--receiving-directory',journal,'--request-id',saved.restoreId]);
  assert.equal(repeated.result.recordSha256,saved.backupRecordSha256);
  const retry=await api('/api/recovery/start',{requestId:randomUUID(),kind:'RESTORE',options:{
    bundle,expected:saved.backupRecordSha256,expectedStateRoot:stateRoot}});
  const refused=await waitOriginal(retry.requestId);assert.equal(refused.state,'FAILED');
  assert.ok(/NOT_EMPTY|EXISTS|TARGET/.test(refused.error.code),json(refused));
  assert.equal(sha(json(await(await openQueue(inbox)).list())),saved.originalJobSha256);
 });
 await phase('browser-restart-mobile-and-owned-close',async()=>{
  await closeHost();workspace=await startCollectionsWorkspace({receivingDirectory:journal,port:0,environment});await browserOpen();
  await page.getByRole('button',{name:saved.restoreId,exact:true}).click();
  await page.getByRole('button',{name:'Open restored collections',exact:true}).click();
  await page.getByText('Original collection and attempt history opened. No request was started.',{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  await page.screenshot({path:join(output,'receiving-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'Backup and receiving',exact:true}).focus();
  assert.equal(await page.getByRole('button',{name:'Backup and receiving',exact:true}).evaluate(e=>e===document.activeElement),true);
  assert.deepEqual(failures,[]);await closeHost();await browser.close();browser=null;
 });
 await retain(resultFile,{...saved,status:'COMPLETED',completedAt:new Date().toISOString(),closed:true,
  pageErrors:failures,providerRequests:0,payments:0,automaticRetries:0});
 console.log('COMPLETE '+resultFile);
}finally{await closeHost();await browser?.close();}
