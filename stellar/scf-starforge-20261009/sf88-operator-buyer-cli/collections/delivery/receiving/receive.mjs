// MIT. Whole delivery/recipient programme over existing original saved Inbox jobs.
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { serveCollections } from '../../server.mjs';
import { acquireCollectionLease } from '../../model.mjs';
import { initializationDirectory, initializationBytes, optionalInitializationBytes, retainInitializationFile } from '../../../initialization.mjs';
import { openCustomerDelivery } from '../model.mjs';
import { bytes, need, identity, digest, measure, copyFile, inspectPackage, MAX_PACKAGE } from '../format.mjs';

export async function receiveCustomerDelivery({directory,collections=null,sourceRoot,sourceManifest,collectionId,intentIds,taskPacket,expectedTaskSha256,playwright,chromium,onProgress=()=>{}}){
 const taskOrigin=collections===null;
 need((collections||typeof taskPacket==='string'&&/^[a-f0-9]{64}$/.test(expectedTaskSha256??''))&&playwright?.chromium&&typeof chromium==='string','CUSTOMER_DELIVERY_RECEIVING_INPUT');
 const senderDirectory=taskOrigin?join(directory,'sender'):collections.directory;
 const previewPath='/api/customer-delivery/'+(taskOrigin?'task-preview':'preview'),preparePath='/api/customer-delivery/'+(taskOrigin?'task-prepare':'prepare');
 await initializationDirectory(directory,{create:true});const release=await acquireCollectionLease(directory);
 const statePath=join(directory,'operation.json');let state;
 try{state=JSON.parse((await optionalInitializationBytes(statePath))??'null');}catch(error){await release();throw error;}
 const selection=taskOrigin?{kind:'inbox-task',sourceRoot,sourceManifest,taskPacket,expectedTaskSha256,intentIds,senderDirectory,chromium}:{sourceRoot,sourceManifest,collectionId,intentIds,collectionsDirectory:collections.directory,queueRoot:collections.queueRoot,chromium};
 const save=async()=>{const temporary=join(directory,'.operation-'+randomUUID());await writeFile(temporary,bytes(state),{mode:0o600});const h=await import('node:fs/promises').then(m=>m.open(temporary,'r+'));try{await h.sync();}finally{await h.close();}await rename(temporary,statePath);const d=await import('node:fs/promises').then(m=>m.open(directory,'r'));try{await d.sync();}finally{await d.close();}};
 let sender,recipient,browser,context,desk,receivingDesk;let error=null;
 const files=join(directory,'files');try{await initializationDirectory(files,{create:true});}catch(error){await release();throw error;}
 async function retain(name,raw,kind,metadata={}){
  const candidate=join(files,name+'.candidate');const prior=await optionalInitializationBytes(candidate,20*1024*1024);
  const body=prior??bytes({name,kind,metadata,base64:Buffer.from(raw).toString('base64')});
  if(!prior)await retainInitializationFile(candidate,body,{resume:true});
  const selected=JSON.parse(body);need(selected.name===name&&selected.kind===kind,'CUSTOMER_DELIVERY_ARTIFACT_CHANGED');
  const content=Buffer.from(selected.base64,'base64');need(content.toString('base64')===selected.base64,'CUSTOMER_DELIVERY_ARTIFACT_BYTES');
  await retainInitializationFile(join(files,name),content,{resume:true});
  return{name,kind,bytes:content.length,sha256:digest(content),...selected.metadata};
 }
 async function screenshot(page,name){
  if(state.files.some(row=>row.name===name))return;
  const dimensions=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight}));
  need(dimensions.scrollWidth<=dimensions.width+1,'CUSTOMER_DELIVERY_MOBILE_OVERFLOW');
  const descriptor=await retain(name,await page.screenshot({fullPage:true}),'screenshot',{dimensions});state.files.push(descriptor);await save();
 }
 async function closeBrowser(){
  if(context){try{await context.close();context=null;}catch(cause){if(browser){await browser.close();browser=null;context=null;}else throw cause;}}
  if(browser){await browser.close();browser=null;}
 }
 async function browserOpen(origin,token,width=1440){
  if(context)await closeBrowser();
  if(!browser)browser=await playwright.chromium.launch({executablePath:chromium,headless:true,args:['--no-sandbox']});
  context=await browser.newContext({viewport:{width,height:1000}});const page=await context.newPage();
  page.on('pageerror',e=>{state.pageErrors.push(String(e));});
  await page.goto(origin+'/customer-delivery');await page.locator('#token').fill(token);await page.locator('#login-form button').click();
  await page.waitForFunction(()=>window.customerDelivery?.inspect().storageReady&&!window.customerDelivery.inspect().busy);
  return page;
 }
 try{
  if(!state){const original=taskOrigin?null:await collections.inspect(collectionId);state={schema:'stellar-forge.sf88.customer-delivery-receiving.v1',operationId:'customer-delivery-'+randomUUID(),selection,request:taskOrigin?{kind:'inbox-task',id:'receiving-'+randomUUID(),packetDirectory:taskPacket,expectedTaskSha256,title:'Complete original customer results',note:'Customer delivery from the original received InboxTask; original attempt and recovered response remain separate.',intentIds,sourceRoot,sourceManifest}:{id:'receiving-'+randomUUID(),collectionId,expectedManifestSha256:original.manifestSha256,title:'Complete original customer results',note:'Customer delivery programme over original retained Inbox jobs.',intentIds,sourceRoot,sourceManifest,maxVerifyBytes:1073741824,allowIncomplete:false},steps:{},files:[],pageErrors:[]};await save();}
  need(identity(state.selection)===identity(selection),'CUSTOMER_DELIVERY_RECEIVING_SELECTION_CHANGED');
  if(state.complete){
   for(const row of state.files)await measure(join(files,row.name),row,row.kind==='package'?MAX_PACKAGE:undefined);
   const result=JSON.parse(await initializationBytes(join(directory,'result.json')));need(result.operationId===state.operationId,'CUSTOMER_DELIVERY_RECEIVING_RESULT');return result;
  }
  await initializationDirectory(senderDirectory,{create:true});
  desk=await openCustomerDelivery({collections,directory:join(senderDirectory,'customer-delivery')});
  const receiveRoot=join(directory,'customer');await initializationDirectory(receiveRoot,{create:true});
  receivingDesk=await openCustomerDelivery({directory:join(receiveRoot,'customer-delivery')});
  if(!state.preview){state.preview=await desk[taskOrigin?'previewTask':'preview'](state.request);await save();}
  sender=await serveCollections(collections,{port:state.senderPort??0,approvalMode:'TERMINAL',...(taskOrigin?{receivingDirectory:senderDirectory}:{})});
  if(!state.senderPort){state.senderPort=Number(new URL(sender.origin).port);await save();}
  let page=await browserOpen(sender.origin,sender.token);
  if(taskOrigin)await page.locator('[data-tab="prepare"]').click();
  if(!state.steps.prepared){
   let original;
   try{original=await desk.inspect(state.request.id);}catch(cause){if(cause.code!=='CUSTOMER_DELIVERY_NOT_FOUND')throw cause;}
   if(original){
    need(original.previewSha256===state.preview.previewSha256&&identity(original.request)===identity(state.request),'CUSTOMER_DELIVERY_ORIGINAL_REQUEST_CHANGED');
    const pending={kind:'prepare',path:preparePath,body:{...state.request,expectedPreviewSha256:state.preview.previewSha256}};
    await page.evaluate(async pending=>{
     const scope=window.customerDelivery.inspect().scope;
     const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('sf88-customer-delivery',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
     try{await new Promise((resolve,reject)=>{const tx=database.transaction('states','readwrite'),store=tx.objectStore('states'),read=store.get(scope);let failure;
      read.onsuccess=()=>{const existing=read.result??null;if(existing?.pending&&JSON.stringify(existing.pending)!==JSON.stringify(pending)){failure=new Error('Another retained request owns this browser scope.');tx.abort();return;}store.put({...existing,pending,last:existing?.last??null},scope);};
      tx.oncomplete=resolve;tx.onerror=()=>reject(failure??tx.error);tx.onabort=()=>reject(failure??tx.error);
     });}finally{database.close();}
    },pending);
   }else{
    if(taskOrigin){
     await page.locator('#origin-kind').selectOption('inbox-task');await page.waitForFunction(()=>!window.customerDelivery.inspect().busy);
     await page.locator('#task-packet').fill(taskPacket);await page.locator('#task-sha').fill(expectedTaskSha256);
     const read=page.waitForResponse(response=>response.url().endsWith('/api/customer-delivery/task-inspect')&&response.request().method()==='POST');
     await page.locator('#load-task').click();const observedTask=await(await read).json();need(observedTask.task.taskSha256===expectedTaskSha256,'CUSTOMER_DELIVERY_ORIGINAL_TASK_CHANGED');
     await page.waitForFunction(()=>!window.customerDelivery.inspect().busy&&document.querySelector('[data-intent]'));
    }else{await page.locator('#collection').selectOption(collectionId);await page.waitForFunction(id=>document.querySelector('#collection').value===id&&!window.customerDelivery.inspect().busy,collectionId);}
    for(const [selector,value] of [['#delivery-id',state.request.id],['#title',state.request.title],['#note',state.request.note],['#source-root',sourceRoot],['#source-manifest',sourceManifest],...(taskOrigin?[]:[['#verify-limit',String(state.request.maxVerifyBytes)]])])await page.locator(selector).fill(value);
    for(const checkbox of await page.locator('[data-intent]').all())await checkbox.setChecked(intentIds.includes(await checkbox.getAttribute('value')));
    const previewResponse=page.waitForResponse(response=>response.url().endsWith(previewPath)&&response.request().method()==='POST');
    await page.locator('#review-selection').click();const observedPreview=await (await previewResponse).json();need(observedPreview.previewSha256===state.preview.previewSha256,'CUSTOMER_DELIVERY_ORIGINAL_PREVIEW_CHANGED');
    await page.locator('#preview').waitFor({state:'visible'});
    // Lose only the response after the real original server has completed it.
    let lost=false;
    await page.route('**'+preparePath,async route=>{if(lost)return route.continue();lost=true;const response=await route.fetch();need(response.ok(),'CUSTOMER_DELIVERY_PREPARE_FAILED');await route.abort('failed');});
    await page.locator('#prepare-package').click();await page.waitForFunction(()=>window.customerDelivery.inspect().pending&&!window.customerDelivery.inspect().busy);
    state.steps.originalRequestRetained=true;await save();
    await page.unroute('**'+preparePath);
   }
   await page.reload();await page.locator('#token').fill(sender.token);await page.locator('#login-form button').click();await page.waitForFunction(()=>window.customerDelivery.inspect().storageReady&&!window.customerDelivery.inspect().busy);
   await page.locator('#retry').click();await page.waitForFunction(()=>!window.customerDelivery.inspect().pending&&!window.customerDelivery.inspect().busy);
   const result=await desk.inspect(state.request.id);need(result.manifest.outputsComplete&&result.manifest.rows.length===intentIds.length,'CUSTOMER_DELIVERY_ORIGINAL_OUTPUTS');state.original=result;state.steps.prepared=true;await save();
  }
  await page.locator('[data-tab="deliveries"]').click();await page.locator('#refresh').click();await page.waitForFunction(()=>!window.customerDelivery.inspect().busy);
  await screenshot(page,'sender-desktop.png');
  await page.setViewportSize({width:390,height:900});await screenshot(page,'sender-mobile.png');
  if(!state.steps.downloaded){
   const target=join(files,'customer-delivery.ndjson');
   try{await inspectPackage(target,{expected:state.original.package});}
   catch(cause){
    if(cause.code!=='ENOENT')throw cause;
    const event=page.waitForEvent('download');await page.locator('[data-download="'+state.request.id+'"]').click();const download=await event;need(await download.failure()===null,'CUSTOMER_DELIVERY_DOWNLOAD');const originalFile=await download.path();
    await copyFile(originalFile,target,state.original.package,{maximum:MAX_PACKAGE});
   }
   const inspected=await inspectPackage(target,{expected:state.original.package});
   state.files.push({name:'customer-delivery.ndjson',kind:'package',bytes:inspected.bytes,sha256:inspected.sha256});state.steps.downloaded=true;await save();
  }
  await closeBrowser();await sender.close();sender=null;
  recipient=await serveCollections(null,{receivingDirectory:receiveRoot,port:state.recipientPort??0,approvalMode:'TERMINAL'});
  if(!state.recipientPort){state.recipientPort=Number(new URL(recipient.origin).port);await save();}
  page=await browserOpen(recipient.origin,recipient.token);
  if(!state.steps.received){
   await page.locator('#package-file').setInputFiles(join(files,'customer-delivery.ndjson'));await page.locator('#package-sha').fill(state.original.package.sha256);
   await page.locator('#receive-form button').click();await page.waitForFunction(()=>!window.customerDelivery.inspect().pending&&!window.customerDelivery.inspect().busy&&document.querySelector('#received-view h3'));
   state.received=await receivingDesk.received(state.original.package.sha256);need(state.received.outputsComplete&&identity(state.received.manifest)===identity(state.original.manifest),'CUSTOMER_DELIVERY_RECEIVED_IDENTITY');state.steps.received=true;await save();
  }else{await page.locator('[data-received-open="'+state.original.package.sha256+'"]').click();await page.locator('#received-view h3').waitFor();}
  const history=await receivingDesk.listReceived();
  const historyRow=history.packages.find(row=>row.sha256===state.original.package.sha256&&row.state==='COMPLETE'&&row.manifestSha256===state.original.package.manifestSha256);
  need(historyRow,'CUSTOMER_DELIVERY_RECEIVED_HISTORY');
  if(taskOrigin)need(historyRow.collectionId===null&&historyRow.task?.taskSha256===expectedTaskSha256&&identity(historyRow.task)===identity(state.original.manifest.task),'CUSTOMER_DELIVERY_RECEIVED_TASK_HISTORY');
  else need(historyRow.collectionId===collectionId&&!historyRow.task,'CUSTOMER_DELIVERY_RECEIVED_COLLECTION_HISTORY');
  // The same browser restores its verified selection without re-entering a hash.
  await page.reload();await page.locator('#token').fill(recipient.token);await page.locator('#login-form button').click();
  await page.waitForFunction(sha=>!window.customerDelivery.inspect().busy&&window.customerDelivery.inspect().selectedReceivedSha256===sha&&document.querySelector('#received-view')?.dataset.sha256===sha&&document.querySelector('#received-view h3'),state.original.package.sha256);
  state.steps.selectedReceiptReloaded=true;await save();
  await screenshot(page,'recipient-desktop.png');await page.setViewportSize({width:390,height:900});await screenshot(page,'recipient-mobile.png');
  const first=state.received.manifest.rows.find(row=>row.output.state==='VERIFIED');need(first,'CUSTOMER_DELIVERY_OUTPUT_REQUIRED');
  if(!state.steps.responseDownloaded){
   const target=join(files,'original-response.bin');
   try{await measure(target,first.output);}catch(cause){if(cause.code!=='ENOENT')throw cause;const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download response',exact:true}).first().click();const download=await event;need(await download.failure()===null,'CUSTOMER_DELIVERY_RESPONSE_DOWNLOAD');await copyFile(await download.path(),target,first.output);}
   state.files.push({name:'original-response.bin',kind:'response',bytes:first.output.bytes,sha256:first.output.sha256});state.steps.responseDownloaded=true;await save();
  }
  await closeBrowser();await recipient.close();recipient=null;await receivingDesk.close();receivingDesk=null;
  receivingDesk=await openCustomerDelivery({directory:join(receiveRoot,'customer-delivery')});
  const reopened=await receivingDesk.received(state.original.package.sha256);need(identity(reopened)===identity(state.received),'CUSTOMER_DELIVERY_COLD_REOPEN');
  // A fresh server and fresh browser have no IndexedDB selection. Discover the
  // original receipt from the workspace history, then verify/download its bytes.
  recipient=await serveCollections(null,{receivingDirectory:receiveRoot,port:state.recipientPort,approvalMode:'TERMINAL'});
  page=await browserOpen(recipient.origin,recipient.token);
  need(await page.evaluate(()=>window.customerDelivery.inspect().selectedReceivedSha256===null),'CUSTOMER_DELIVERY_FRESH_BROWSER_SELECTION');
  await page.locator('[data-received-open="'+state.original.package.sha256+'"]').click();
  await page.waitForFunction(sha=>!window.customerDelivery.inspect().busy&&window.customerDelivery.inspect().selectedReceivedSha256===sha&&document.querySelector('#received-view')?.dataset.sha256===sha,state.original.package.sha256);
  const originalPackage=await receivingDesk.receivedPackage(state.original.package.sha256);
  need(originalPackage.bytes===state.original.package.bytes&&originalPackage.sha256===state.original.package.sha256,'CUSTOMER_DELIVERY_RECEIVED_PACKAGE_IDENTITY');
  if(!state.steps.receivedPackageDownloaded){
   const target=join(files,'received-original-package.ndjson');
   try{await inspectPackage(target,{expected:state.original.package});}
   catch(cause){if(cause.code!=='ENOENT')throw cause;const event=page.waitForEvent('download');await page.locator('[data-received-download="'+state.original.package.sha256+'"]').click();const download=await event;need(await download.failure()===null,'CUSTOMER_DELIVERY_RECEIVED_PACKAGE_DOWNLOAD');await copyFile(await download.path(),target,state.original.package,{maximum:MAX_PACKAGE});}
   state.files.push({name:'received-original-package.ndjson',kind:'package',bytes:state.original.package.bytes,sha256:state.original.package.sha256});state.steps.receivedPackageDownloaded=true;await save();
  }
  await screenshot(page,'recipient-history-cold-reopen.png');state.steps.recipientHistoryColdReopened=true;await save();
  const repeated=await receivingDesk.receive({file:join(files,'customer-delivery.ndjson'),expectedSha256:state.original.package.sha256});const {directory:ignored,...exact}=repeated;need(identity(exact)===identity(state.received),'CUSTOMER_DELIVERY_SAME_RECEIVE');
  const replay=await desk[taskOrigin?'prepareTask':'prepare']({...state.request,expectedPreviewSha256:state.preview.previewSha256});need(identity(replay)===identity(state.original),'CUSTOMER_DELIVERY_ORIGINAL_REQUEST_REPLAY');
  need(state.pageErrors.length===0,'CUSTOMER_DELIVERY_BROWSER_ERRORS');
  state.steps.coldReopened=true;await save();
 }catch(cause){error=cause;}
 finally{
  let closeAttempts=0;
  while(context||browser||recipient||sender||receivingDesk||desk){
   const failures=[];
   try{await closeBrowser();}catch(cause){failures.push(cause);}
   for(const name of ['recipient','sender','receivingDesk','desk']){
    const owner=name==='recipient'?recipient:name==='sender'?sender:name==='receivingDesk'?receivingDesk:desk;
    if(!owner)continue;
    try{await owner.close();if(name==='recipient')recipient=null;else if(name==='sender')sender=null;else if(name==='receivingDesk')receivingDesk=null;else desk=null;}
    catch(cause){failures.push(cause);}
   }
   if(failures.length){
    closeAttempts++;try{await onProgress({stage:'waiting-for-original-owner-closure',operationId:state?.operationId??null,attempt:closeAttempts,codes:failures.map(cause=>typeof cause.code==='string'?cause.code:'OWNER_CLOSE_FAILED')});}catch{}
    if(state){state.closureWait={attempt:closeAttempts,owners:[browser?'browser':null,context?'context':null,recipient?'recipient':null,sender?'sender':null,receivingDesk?'receivingDesk':null,desk?'desk':null].filter(Boolean)};try{await save();}catch{}}
    await new Promise(resolve=>setTimeout(resolve,1000));
   }
  }
  try{if(!error&&state&&!state.complete){
   for(const row of state.files)await measure(join(files,row.name),row,row.kind==='package'?MAX_PACKAGE:undefined);
   const candidate={schema:state.schema+'.result',operationId:state.operationId,selection:state.selection,originalIntents:state.request.intentIds,package:state.original.package,manifestSha256:identity(state.original.manifest),files:state.files,steps:state.steps,ownersClosed:true};
   const candidatePath=join(directory,'final-candidate.json'),saved=await optionalInitializationBytes(candidatePath);
   if(saved)need(identity(JSON.parse(saved))===identity(candidate),'CUSTOMER_DELIVERY_FINAL_CANDIDATE_CHANGED');else await retainInitializationFile(candidatePath,bytes(candidate),{resume:true});
   await retainInitializationFile(join(directory,'result.json'),saved??bytes(candidate),{resume:true});state.complete=true;await save();try{await onProgress({stage:'complete',operationId:state.operationId,package:state.original.package});}catch{}
  }
  }finally{await release();}
 }
 if(error)throw error;
 return JSON.parse(await initializationBytes(join(directory,'result.json')));
}
