#!/usr/bin/env node
// MIT. The original reviewer operation continued through the maintained Merchant Console.
import assert from 'node:assert/strict';
import {mkdir,readFile,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {startMerchantMcp} from '../serve.mjs';
import {startReviewerWorkbench} from '../../../stellar/scf_2026/presentation/reviewer/workbench.mjs';
import {readSourceFile,writeSourceFile} from '../../../stellar/scf_2026/presentation/reviewer/workspace.mjs';
import {operationLease} from '../../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import {digest,encode,decode,canonical} from '../../../stellar/scf_2026/presentation/reviewer/merchant/contracts.mjs';

const options={};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i];assert(['--operation','--playwright','--chromium'].includes(key),'Unknown receiving option.');
  assert(process.argv[i+1]&&!options[key.slice(2)],'Supply each original option once.');
  options[key.slice(2)]=resolve(process.argv[i+1]);
}
assert(options.operation&&options.playwright&&options.chromium,
  'Use --operation ABS_ORIGINAL_OPERATION --playwright EXISTING_MODULE --chromium EXISTING_EXECUTABLE.');
assert(Number(process.versions.node.split('.')[0])>=22,'Use the selected maintained Node22 or later.');
const operation=options.operation,root=join(operation,'customer-console'),
  sourceRoot=fileURLToPath(new URL('../../../',import.meta.url)),
  senderDirectory=join(operation,'workbenches','sender'),
  merchantConfiguration=join(operation,'merchant-client','host','merchant-mcp.json'),
  stateFile=join(root,'CONSOLE-STATE.json'),resultFile=join(root,'CONSOLE-RESULT.json');
await mkdir(root,{recursive:true,mode:0o700});
for(const name of ['source','downloads','screenshots','browser-temp'])
  await mkdir(join(root,name),{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
const lease=await operationLease(join(operation,'controller.lock'));
let journal,original,merchantResult,saving=Promise.resolve(),sender=null,host=null,browser=null,page=null,
  stopping=false,activePhase='setup',failure=null;
const abort=new AbortController(),now=()=>new Date().toISOString();
const stop=()=>{stopping=true;abort.abort(new Error('Original Console receiving cancelled.'));
  browser?.close().catch(()=>{});};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
const check=()=>{assert(!stopping,'Original Console receiving was cancelled.');abort.signal.throwIfAborted();};
const save=()=>{
  const bytes=encode(journal);
  saving=saving.catch(()=>{}).then(()=>writeSourceFile(stateFile,bytes,{replace:true}));return saving;
};
async function exact(path,bytes){
  try{await writeSourceFile(path,bytes);}
  catch(error){if(error.code!=='EEXIST')throw error;assert.deepEqual(
    await readSourceFile(path,{privateFile:true,maxBytes:128*1024*1024}),bytes,'Retain original published bytes.');}
  return {path,bytes:bytes.length,sha256:digest(bytes)};
}
async function phase(name,fn){
  activePhase=name;if(journal.phases[name])return journal.phases[name];
  check();journal.activePhase=name;await save();
  const result=await fn();journal.phases[name]={...result,completedAt:now()};await save();
  process.stdout.write(JSON.stringify({phase:name,state:'COMPLETE'})+'\n');return journal.phases[name];
}
const delay=ms=>new Promise((yes,no)=>{
  check();const timer=setTimeout(done,ms);
  function done(){abort.signal.removeEventListener('abort',cancel);yes();}
  function cancel(){clearTimeout(timer);abort.signal.removeEventListener('abort',cancel);no(abort.signal.reason);}
  abort.signal.addEventListener('abort',cancel,{once:true});
});
async function until(fn,label,timeout=120000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){check();const value=await fn();if(value)return value;await delay(120);}
  throw new Error('Continue the original '+label+'; its observed completion is not yet available.');
}
async function opening(directory){
  if(host){assert.equal(host.directory,directory);return host;}
  check();
  if(!sender)sender=await startReviewerWorkbench({directory:senderDirectory,sourceRoot});
  check();
  const token=randomBytes(32).toString('base64url'),session=await startMerchantMcp({
    configPath:merchantConfiguration,port:0,consoleDirectory:directory,
    tokenEnv:'ORIGINAL_REVIEWER_CONSOLE_CODE',environment:{ORIGINAL_REVIEWER_CONSOLE_CODE:token}});
  host={session,token,directory,generation:randomUUID()};
  journal.openings.push({generation:host.generation,directory,at:now()});await save();return host;
}
async function closeHost(){
  if(!host)return;
  const own=host;await own.session.close();if(host===own)host=null;
}
async function closeBrowser(){
  if(!browser)return;
  const own=browser;await own.close();if(browser===own){browser=null;page=null;}
}
async function request(route,{method='GET',body,missing=false,bytes=false}={}){
  check();assert(host,'Open the original Console before sending a request.');
  const response=await fetch(host.session.url+'/operator/api/'+route,{method,redirect:'error',
    signal:AbortSignal.any([abort.signal,AbortSignal.timeout(150000)]),
    headers:{authorization:'Bearer '+host.token,accept:'application/json',
      ...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=Buffer.from(await response.arrayBuffer());
  if(missing&&response.status===404)return null;
  if(!response.ok){
    let value;try{value=decode(data);}catch{}
    throw Object.assign(new Error(value?.error?.message??'Original Console HTTP '+response.status),
      {code:value?.error?.code,status:response.status});
  }
  return bytes?{bytes:data,headers:response.headers}:decode(data);
}
async function profile(){
  const current=await request('profile/'+journal.profileId,{missing:true});
  if(current)return current.profile;
  return (await request('profiles',{method:'POST',body:{id:journal.profileId,
    name:'Original reviewer receiving '+journal.id}})).profile;
}
async function action(key,name,args){
  let record=journal.actions[key];
  if(record){assert.equal(record.name,name);assert.deepEqual(record.args,args);}
  else{record={name,args,createdAt:now(),attempts:[]};journal.actions[key]=record;await save();}
  let attempt=record.attempts.at(-1),call;
  if(attempt)call=await request('call/'+attempt.callId,{missing:true});
  if(call?.receiving==='RETURN_PENDING'){
    // The Console marks the prior process's unresolved return. Retain its exact native
    // UUID/arguments in a linked recovery call; never fabricate an accepted result.
    attempt={draftId:randomUUID(),callId:randomUUID(),recoveryOf:call.id,createdAt:now()};
    record.attempts.push(attempt);await save();call=null;
  }
  if(!attempt){attempt={draftId:randomUUID(),callId:randomUUID(),createdAt:now()};
    record.attempts.push(attempt);await save();}
  let draft=await request('draft/'+attempt.draftId,{missing:true});
  if(draft){draft=draft.draft;assert.equal(draft.tool,'merchant_grant_reviewer_'+name);
    assert.deepEqual(JSON.parse(draft.argumentsJson),args);}
  else draft=(await request('drafts',{method:'POST',body:{id:attempt.draftId,profileId:journal.profileId,
    name:key.slice(0,175),tool:'merchant_grant_reviewer_'+name,arguments:args,
    ...(attempt.recoveryOf?{recoveryOf:attempt.recoveryOf}:{})}})).draft;
  if(!call){
    const current=await request('host');
    const input={id:attempt.callId,profileId:journal.profileId,draftId:draft.id,draftRevision:draft.revision,
      expectedHostFingerprint:current.configurationFingerprint};
    try{await request('calls',{method:'POST',body:input});}
    catch(error){call=await request('call/'+attempt.callId,{missing:true});if(!call)throw error;}
  }
  call=await until(async()=>{
    const value=await request('call/'+attempt.callId);
    if(value.receiving==='ACTIVE')return false;
    assert.equal(value.state,'COMPLETE',JSON.stringify({state:value.state,error:value.error}));
    return value;
  },'native Console request');
  const value=await request('reviewer-value/'+call.id);
  assert.equal(value.callId,call.id);return {call,...value};
}
async function fresh(name,args){
  const key='observed-'+host.generation+'-'+(++journal.sequence);await save();
  return action(key,name,args);
}
async function ensureBuyer(workspace,selectionId){
  await fresh('workbench_open',{workspace});
  const current=(await fresh('state',{workspace})).native;
  if(current.buyer.active){assert.equal(current.buyer.selectionId,selectionId);return current.buyer;}
  const selected=current.selections.find(value=>value.id===selectionId);assert(selected);
  const input={workspace,selectionId,expectedRevision:selected.revision,requestId:randomUUID()};
  const key='open-after-observed-close-'+input.requestId;
  journal.liveActions.push({key,input,observedAt:now(),workbenchId:current.id});await save();
  const opened=(await action(key,'buyer_open',input)).native;
  assert.equal(opened.buyer.active,true);return opened.buyer;
}
async function closeBuyer(workspace){
  await fresh('workbench_open',{workspace});
  const current=(await fresh('state',{workspace})).native;
  if(!current.buyer.active)return;
  const input={workspace,requestId:randomUUID()},key='close-observed-instance-'+input.requestId;
  journal.liveActions.push({key,input,observedAt:now(),instanceId:current.buyer.instanceId});await save();
  assert.equal((await action(key,'buyer_close',input)).native.buyer.active,false);
}
async function transfer(retained){
  assert.equal(retained.retention.state,'COMPLETE');
  const input={profileId:journal.profileId,family:'grant-reviewer',workspace:retained.workspace,
    exportId:retained.exportId,expectedManifestSha256:retained.manifestSha256,
    expectedHostFingerprint:(await request('host')).configurationFingerprint};
  const result=await request('customers',{method:'POST',body:input});
  const record=await until(async()=>{
    const current=await request('profile/'+journal.profileId),
      item=current.deliveries.find(value=>value.id===result.delivery.id);
    assert(item,'Keep the original customer record.');
    if(item.active)return false;
    assert.equal(item.state,'COMPLETE',JSON.stringify(item.error));assert.equal(item.localFiles,true);
    return item;
  },'complete original files');
  for(const file of record.files){
    const data=await request('customer-file/'+record.id+'?'+new URLSearchParams({file:file.name}),{bytes:true});
    assert.equal(data.bytes.length,file.bytes);assert.equal(digest(data.bytes),file.sha256);
  }
  return record;
}
function sourceRequest(phaseName,path){
  const rows=Object.values(original.requests).filter(value=>value.phase===phaseName&&value.path===path);
  assert.equal(rows.length,1);return rows[0];
}
async function screenshot(name,width){
  await page.setViewportSize({width,height:960});
  await page.locator('#connected').waitFor({state:'visible'});
  const overflow=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
  assert(overflow.scroll<=overflow.client+1,name+' must fit the original viewport.');
  const path=join(root,'screenshots',name+'-'+width+'.png');
  await page.screenshot({path,fullPage:true});await chmod(path,0o600);
  const bytes=await readFile(path);return {name,width,path,bytes:bytes.length,sha256:digest(bytes)};
}
async function connectBrowser(){
  if(browser)return page;
  check();
  const {chromium}=await import(pathToFileURL(options.playwright).href);
  check();
  browser=await chromium.launchPersistentContext(join(root,'browser'),{
    executablePath:options.chromium,headless:true,viewport:{width:1440,height:960},
    acceptDownloads:true,env:{...process.env,TMPDIR:join(root,'browser-temp')},
    args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--single-process']});
  check();page=browser.pages()[0]??await browser.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',error=>{journal.consoleErrors.push({at:now(),message:error.message});});
  page.on('console',message=>{if(message.type()==='error')journal.consoleErrors.push({at:now(),message:message.text()});});
  await page.goto(host.session.consoleUrl,{waitUntil:'domcontentloaded'});
  await page.locator('#access-token').fill(host.token);
  await page.locator('#connect-form button[type="submit"]').click();
  await page.locator('#connected').waitFor({state:'visible'});
  await page.locator('#profiles').selectOption(journal.profileId);
  await page.locator('#page-host').waitFor({state:'visible'});
  return page;
}
async function reviewerClick(selector){
  await page.locator(selector).click();
  await page.locator('#reviewer-customer[aria-busy="false"]').waitFor();
}
async function sourcePanel(){
  await connectBrowser();await page.locator('[data-page="customers"]').click();
  await reviewerClick('#reviewer-list-workspaces');
  await page.locator('#reviewer-workspace').selectOption('original');
  await reviewerClick('#reviewer-open-workbench');
  await page.locator('#reviewer-selections [data-selection-id="'+original.phases.original_packet_review.selectionId+'"]').click();
  await page.locator('#reviewer-customer[aria-busy="false"]').waitFor();
  await page.locator('#reviewer-quote').selectOption(original.phases.complete_primary_result.quoteId);
}
async function download(button,path){
  const pending=page.waitForEvent('download');await page.locator(button).click();
  const result=await pending;assert.equal(await result.failure(),null);
  const bytes=await readFile(await result.path());return exact(path,bytes);
}

async function recipeInstallation(){
  const listed=await request('workflow-recipes?'+new URLSearchParams({profile:journal.profileId}));
  const matching=[];
  for(const entry of listed.installations){
    const value=await request('workflow-recipe-install/'+entry.id);
    if(value.installation.request.name===journal.recipe.name)matching.push(value);
  }
  assert(matching.length<=1,'Keep the single original recipe installation.');
  if(matching.length){assert.deepEqual(matching[0].runInputs,journal.recipe.inputs);return matching[0];}
  return null;
}
async function currentWorkflow(){
  const listed=await request('workflows?'+new URLSearchParams({profile:journal.profileId}));
  const runs=(listed.runs??[]).filter(value=>value.workflowId===journal.installationId);
  assert(runs.length<=1,'Continue the same original workflow run.');
  if(!runs.length)return null;
  if(journal.workflowRunId)assert.equal(runs[0].id,journal.workflowRunId);
  return (await request('workflow-run/'+runs[0].id)).run;
}
async function viewWorkflow(){
  await connectBrowser();await page.locator('[data-page="workflows"]').click();
  await page.locator('#refresh-workflows').click();
  await page.locator('#workflow-runs button').filter({hasText:journal.workflowRunId}).click();
}
async function finishWorkflow(){
  let run=await currentWorkflow();assert(run,'Keep the original Console run.');
  for(;;){
    check();
    if(run.state==='COMPLETE'){assert.equal(run.stepsComplete,run.stepCount);return run;}
    if(run.active){await delay(180);run=(await request('workflow-run/'+run.id)).run;continue;}
    assert.notEqual(run.state,'WAITING','Reconcile the displayed original native return before continuing this workflow.');
    const next=run.steps.find(value=>!['COMPLETE','RECOVERED'].includes(value.state));
    if(next&&['source-history','source-result'].includes(next.id))
      await ensureBuyer('original',original.phases.original_packet_review.selectionId);
    if(next?.id==='receiver-history')
      await ensureBuyer('receiver',original.phases.second_operator_packet_intake.selectionId);
    if(!journal.pauseReopen&&run.steps.some(value=>value.id==='source-export'&&['COMPLETE','RECOVERED'].includes(value.state))){
      // Reopen the original Console at its actual pause after the accepted closed export.
      // The same workflow ID, native action UUIDs, source packet and files remain selected.
      journal.pauseReopen={runId:run.id,revision:run.revision,preparedAt:now()};await save();
      await closeBrowser();await closeHost();
      await opening(join(root,'operator'));await profile();
      const reopened=await currentWorkflow();assert.equal(reopened.id,run.id);
      journal.pauseReopen={...journal.pauseReopen,workspaceId:(await request('host')).console.workspaceId,
        reopenedAt:now(),stepsComplete:reopened.stepsComplete};await save();run=reopened;
    }
    await viewWorkflow();
    await page.locator('#workflow-continue').click();
    run=await until(async()=>{
      const nextRun=(await request('workflow-run/'+run.id)).run;
      return nextRun.revision!==run.revision||nextRun.active?nextRun:false;
    },'original saved workflow continuation');
  }
}
async function run(){
  const originalBytes=await readSourceFile(join(operation,'WORKBENCH-RESULT.json'),{privateFile:true}),
    merchantBytes=await readSourceFile(join(operation,'merchant-client','MERCHANT-RESULT.json'),{privateFile:true});
  original=decode(originalBytes);merchantResult=decode(merchantBytes);
  assert.equal(original.state,'COMPLETE');assert.equal(original.ownedWorkbenchesClosed,true);
  assert.equal(merchantResult.state,'COMPLETE');assert.equal(merchantResult.ownedMerchantClosed,true);
  assert.equal(merchantResult.ownedWorkbenchesClosed,true);
  assert.equal(original.newPaymentTransactions,0);assert.equal(merchantResult.newPaymentTransactions,0);
  assert.equal(merchantResult.original.runId,original.runId);
  try{journal=decode(await readSourceFile(stateFile,{privateFile:true,maxBytes:16*1024*1024}));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(journal){
    assert.equal(journal.operation,operation);assert.equal(journal.original.sha256,digest(originalBytes));
    assert.equal(journal.merchant.sha256,digest(merchantBytes));
    if(journal.state==='COMPLETE'){
      const result=await readSourceFile(resultFile,{privateFile:true,maxBytes:32*1024*1024});
      process.stdout.write(JSON.stringify({state:'REUSED_COMPLETE',resultFile,sha256:digest(result),newPaymentTransactions:0})+'\n');
      return {reused:true};
    }
  }else{
    journal={schema:'stellar-forge.grant-reviewer-console-receiving.v1',id:randomUUID(),operation,
      original:await exact(join(root,'source','WORKBENCH-RESULT.json'),originalBytes),
      merchant:await exact(join(root,'source','MERCHANT-RESULT.json'),merchantBytes),
      profileId:randomUUID(),createdAt:now(),state:'CONTINUING',sequence:0,
      phases:{},actions:{},liveActions:[],openings:[],consoleErrors:[],sourceGenerations:[]};
  }
  const sources={};
  for(const file of ['customer-reviewer.mjs','reviewer-recipes.mjs','public/customer-reviewer.mjs',
    'customers.mjs','service.mjs','store.mjs','public/app.mjs','public/index.html',
    'public/workflow-recipes.mjs','public/workflows.mjs','REVIEWER_RECEIVING.mjs'])
    sources[file]=digest(await readFile(new URL(file,import.meta.url)));
  journal.sourceGenerations.push({at:now(),files:sources,node:process.versions.node});
  journal.original.runId=original.runId;journal.state='CONTINUING';await save();
  await opening(join(root,'operator'));await profile();
  await phase('configured_original_profile',async()=>{
    const current=await request('host'),tools=await request('tools?'+new URLSearchParams({q:'merchant_grant_reviewer_',offset:'0'})),
      workspaces=await action('configured-workspaces','workspaces',{});
    assert.equal(tools.items.filter(value=>value.name.startsWith('merchant_grant_reviewer_')).length,20);
    assert(workspaces.native.workspaces.some(value=>value.workspace==='original'));
    assert(workspaces.native.workspaces.some(value=>value.workspace==='receiver'));
    const denied=await fetch(host.session.url+'/operator/api/profiles',{signal:AbortSignal.timeout(10000)});
    assert.equal(denied.status,401);
    return {profileId:journal.profileId,workspaceId:current.console.workspaceId,
      hostFingerprint:current.configurationFingerprint,reviewerTools:20,privateAccessRequired:true};
  });
  await phase('native_source_and_original_intake',async()=>{
    await action('original-workbench','workbench_open',{workspace:'original'});
    const selected=await action('original-selection','selection',{
      workspace:'original',selectionId:original.phases.original_packet_review.selectionId});
    assert.equal(selected.native.selection.packet.packetId,original.phases.original_packet_review.packetId);
    assert.equal(selected.native.selection.state,'RECEIVED');
    const request=sourceRequest('original_native_receive','/api/receive');
    const replay=await action('original-native-receive-replay','receive',{workspace:'original',
      selectionId:request.selectionId,expectedRevision:request.expectedRevision,requestId:request.id});
    assert.equal(replay.native.replayed,true);assert.equal(replay.native.receipt.newPayments,0);
    return {selectionId:selected.native.selection.id,selectionRevision:selected.native.selection.revision,
      packetId:selected.native.selection.packet.packetId,originalReceiveAction:request.id,replayed:true};
  });
  await phase('complete_original_results',async()=>{
    await ensureBuyer('original',original.phases.original_packet_review.selectionId);
    const result={};
    for(const name of ['primary','earlier']){
      const expected=original.phases['complete_'+name+'_result'],
        called=await action('complete-'+name,'buyer_result',{workspace:'original',quoteId:expected.quoteId}),
        received=await transfer(called.retained),
        file=received.files.find(value=>value.name==='saved-result.json');
      assert(file);assert.equal(file.bytes,expected.bytes);assert.equal(file.sha256,expected.sha256);
      const data=await request('customer-archive/'+received.id,{bytes:true});
      assert.equal(data.bytes.length,expected.bytes);assert.equal(digest(data.bytes),expected.sha256);
      assert(data.headers.get('content-type')?.startsWith('application/json'));
      result[name]={quoteId:expected.quoteId,deliveryId:received.id,exportId:received.identity.exportId,
        manifestSha256:received.identity.expectedManifestSha256,
        ...await exact(join(root,'downloads',name+'-original-result.json'),data.bytes)};
      const status=await action('status-'+name,'buyer_read',{
        workspace:'original',tool:'bazaar_status',arguments:{quoteId:expected.quoteId}});
      assert.equal(status.native.status,expected.status);assert.equal(status.native.attempts,1);
      result[name].status=status.native.status;result[name].attempts=status.native.attempts;
    }
    return result;
  });
  await phase('complete_source_document',async()=>{
    const selected=(await action('original-selection','selection',{
      workspace:'original',selectionId:original.phases.original_packet_review.selectionId})).native,
      source=selected.packet.documents[0];assert(source);
    const result=await action('complete-source-document','document',{
      workspace:'original',selectionId:selected.selection.id,index:0}),received=await transfer(result.retained),
      file=received.files[0];
    assert.equal(file.sha256,source.sha256);assert.equal(file.bytes,source.bytes);
    const data=await request('customer-file/'+received.id+'?'+new URLSearchParams({file:file.name}),{bytes:true});
    return {originalPath:source.path,deliveryId:received.id,
      ...await exact(join(root,'downloads','original-source-document.bin'),data.bytes)};
  });
  await phase('closed_original_packet_export',async()=>{
    await closeBuyer('original');
    const exported=original.phases.closed_native_export,
      result=await action('accepted-original-export','export',{workspace:'original',
        selectionId:original.phases.original_packet_review.selectionId,
        expectedRevision:original.phases.original_native_receive.revision,requestId:exported.actionId});
    assert.equal(result.native.replayed,true);assert.equal(result.native.export.sha256,exported.export.sha256);
    const received=await transfer(result.retained),data=await request('customer-archive/'+received.id,{bytes:true});
    assert.equal(data.bytes.length,exported.export.bytes);assert.equal(digest(data.bytes),exported.export.sha256);
    assert(data.headers.get('content-disposition')?.includes('grant-reviewer-packet.json'));
    assert.equal((await fresh('state',{workspace:'original'})).native.buyer.active,false);
    return {descriptor:result.retained,deliveryId:received.id,acceptedActionId:exported.actionId,
      packetId:exported.export.packetId,...await exact(join(root,'downloads','grant-reviewer-packet.json'),data.bytes)};
  });
  await phase('console_browser_and_complete_download',async()=>{
    await ensureBuyer('original',original.phases.original_packet_review.selectionId);
    await sourcePanel();await reviewerClick('#reviewer-history');
    await reviewerClick('#reviewer-result');await reviewerClick('#reviewer-receive-files');
    const expected=original.phases.complete_primary_result,
      saved=await download('#download-customer',join(root,'downloads','browser-primary-result.json'));
    assert.equal(saved.bytes,expected.bytes);assert.equal(saved.sha256,expected.sha256);
    const views=[];
    for(const width of [1440,390]){
      for(const name of ['host','tools','requests','workflows','customers']){
        await page.locator('[data-page="'+name+'"]').click();
        views.push(await screenshot(name,width));
      }
    }
    assert.equal(journal.consoleErrors.length,0,JSON.stringify(journal.consoleErrors));
    return {views,completeResult:saved,desktopViews:5,mobileViews:5};
  });
  await phase('review_and_install_native_recipe',async()=>{
    await fresh('workbench_open',{workspace:'receiver'});
    const receiving=(await fresh('selection',{workspace:'receiver',
      selectionId:original.phases.second_operator_packet_intake.selectionId})).native.selection;
    if(!journal.recipe){
      const receive=sourceRequest('second_operator_native_receive','/api/receive');
      journal.recipe={name:'Original reviewer delivery '+journal.id,inputs:{
        sourceWorkspace:'original',destinationWorkspace:'receiver',title:receiving.title,
        selectionId:original.phases.original_packet_review.selectionId,
        selectionRevision:original.phases.original_native_receive.revision,
        quoteId:original.phases.complete_primary_result.quoteId,
        actions:{sourceOpen:randomUUID(),sourceClose:randomUUID(),sourceExport:original.phases.closed_native_export.actionId,
          review:receiving.id,receive:receive.id,receivingOpen:randomUUID(),receivingClose:randomUUID()}}};await save();
    }
    let installed=await recipeInstallation();
    if(!installed){
      await sourcePanel();await page.locator('#reviewer-destination').selectOption('receiver');
      await reviewerClick('#reviewer-delivery-recipe');
      await page.locator('#workflow-recipe-name').fill(journal.recipe.name);
      await page.locator('#workflow-recipe-inputs').fill(JSON.stringify(journal.recipe.inputs,null,2));
      await page.locator('#workflow-recipe-review').click();
      await page.locator('#workflow-recipe-install').waitFor({state:'visible'});
      await page.locator('#workflow-recipe-install').click();
      installed=await until(recipeInstallation,'original recipe installation');
    }
    assert.equal(installed.definition.steps.length,14);
    assert.deepEqual(installed.runInputs,journal.recipe.inputs);
    journal.installationId=installed.installation.id;journal.recipeSha256=installed.installation.recipe.contentSha256;await save();
    return {installationId:installed.installation.id,definitionId:installed.definition.id,
      definitionRevision:installed.definition.revision,recipeSha256:journal.recipeSha256,
      steps:installed.definition.steps.length,originalExportActionId:journal.recipe.inputs.actions.sourceExport};
  });
  await phase('complete_original_saved_workflow',async()=>{
    let run=await currentWorkflow();
    if(!run){
      await connectBrowser();await page.locator('[data-page="workflows"]').click();
      await page.locator('#refresh-workflows').click();
      await page.locator('#workflow-list button').filter({hasText:journal.recipe.name}).click();
      await page.locator('#workflow-inputs').fill(JSON.stringify(journal.recipe.inputs,null,2));
      if(journal.runIntentStartedAt){
        assert(await page.locator('#workflow-retry-start').isEnabled(),
          'Recover the original browser-retained start; do not issue a replacement run.');
        await page.locator('#workflow-retry-start').click();
      }else{
        journal.runIntentStartedAt=now();await save();await page.locator('#workflow-start').click();
      }
      run=await until(currentWorkflow,'original workflow start');
    }
    journal.workflowRunId=run.id;await save();
    run=await finishWorkflow();
    assert.equal(run.stepCount,14);
    const originalState=(await fresh('state',{workspace:'original'})).native,
      receivingState=(await fresh('state',{workspace:'receiver'})).native;
    assert.equal(originalState.buyer.active,false);assert.equal(receivingState.buyer.active,false);
    const packet=journal.phases.closed_original_packet_export;
    const data=await request('customer-archive/'+packet.deliveryId,{bytes:true});
    assert.equal(digest(data.bytes),packet.sha256);
    return {runId:run.id,revision:run.revision,state:run.state,stepsComplete:run.stepsComplete,
      originalActionIds:journal.recipe.inputs.actions,pauseReopen:journal.pauseReopen,
      originalBuyerClosed:true,receivingBuyerClosed:true,packetSha256:packet.sha256};
  });
  await phase('complete_profile_handoff',async()=>{
    await connectBrowser();await page.locator('[data-page="workflows"]').click();
    const saved=await download('#export-profile',join(root,'downloads','original-operator-profile.json')),
      archive=decode(await readSourceFile(saved.path,{privateFile:true,maxBytes:128*1024*1024}));
    assert.equal(archive.profile.id,journal.profileId);
    assert(archive.calls.length>0);assert(archive.deliveries.length>=4);
    const workflowRows=JSON.stringify(archive);
    assert(workflowRows.includes(journal.workflowRunId));assert(workflowRows.includes(journal.installationId));
    journal.archive={...saved,contentSha256:archive.contentSha256};await save();
    return {...saved,contentSha256:archive.contentSha256,profileId:archive.profile.id,
      calls:archive.calls.length,deliveries:archive.deliveries.length,originalRunId:journal.workflowRunId};
  });
  await phase('same_console_cold_reopen',async()=>{
    await closeBrowser();await closeHost();await opening(join(root,'operator'));
    const current=await request('host');assert.equal(current.console.workspaceId,journal.phases.configured_original_profile.workspaceId);
    const calls=await request('profile/'+journal.profileId);
    assert(calls.calls.some(value=>value.id===journal.actions['accepted-original-export'].attempts.at(-1).callId));
    const packet=journal.phases.closed_original_packet_export,
      data=await request('customer-archive/'+packet.deliveryId,{bytes:true});
    assert.equal(digest(data.bytes),packet.sha256);
    return {workspaceId:current.console.workspaceId,originalWorkflowId:(await currentWorkflow()).id,
      originalProfileId:journal.profileId,packetSha256:packet.sha256};
  });
  await phase('independent_operator_profile_and_files',async()=>{
    await closeBrowser();await closeHost();await opening(join(root,'receiving-operator'));
    const archive=decode(await readSourceFile(journal.archive.path,{privateFile:true,maxBytes:128*1024*1024})),
      input={archive,expectedContentSha256:journal.archive.contentSha256},
      first=await request('import',{method:'POST',body:input}),
      replay=await request('import',{method:'POST',body:input});
    assert.equal(first.profile.id,journal.profileId);assert.equal(replay.profile.id,journal.profileId);
    assert.equal(replay.reused,true);
    const current=await request('host');assert.notEqual(current.console.workspaceId,journal.phases.configured_original_profile.workspaceId);
    const copied=(await request('workflow-run/'+journal.workflowRunId)).run;
    assert.equal(copied.state,'COMPLETE');assert.equal(copied.custody,'RECEIVED_COPY');
    const packet=journal.phases.closed_original_packet_export,received=await transfer(packet.descriptor),
      bytes=await request('customer-archive/'+received.id,{bytes:true});
    assert.equal(received.id,packet.deliveryId);assert.equal(digest(bytes.bytes),packet.sha256);
    await connectBrowser();await page.locator('[data-page="customers"]').click();
    await page.locator('#customer-list button').filter({hasText:received.identity.exportId}).click();
    const saved=await download('#download-customer',join(root,'downloads','second-operator-original-packet.json'));
    assert.equal(saved.sha256,packet.sha256);
    return {workspaceId:current.console.workspaceId,profileId:journal.profileId,
      originalWorkflowId:copied.id,workflowCustody:copied.custody,originalDeliveryId:received.id,
      packet:saved,archiveReplay:true,screenshot:await screenshot('independent-receiving',1440)};
  });
  await phase('independent_cold_reopen',async()=>{
    await closeBrowser();await closeHost();await opening(join(root,'receiving-operator'));
    const current=await request('host'),expected=journal.phases.independent_operator_profile_and_files;
    assert.equal(current.console.workspaceId,expected.workspaceId);
    const packet=await request('customer-archive/'+expected.originalDeliveryId,{bytes:true});
    assert.equal(digest(packet.bytes),expected.packet.sha256);
    const run=(await request('workflow-run/'+journal.workflowRunId)).run;
    assert.equal(run.state,'COMPLETE');assert.equal(run.custody,'RECEIVED_COPY');
    await connectBrowser();await page.locator('[data-page="workflows"]').click();
    await page.locator('#workflow-runs button').filter({hasText:journal.workflowRunId}).click();
    await page.locator('#workflow-run-state').filter({hasText:'COMPLETE'}).waitFor();
    assert.equal(journal.consoleErrors.length,0,JSON.stringify(journal.consoleErrors));
    return {workspaceId:current.console.workspaceId,originalRunId:run.id,packetSha256:expected.packet.sha256,
      screenshot:await screenshot('cold-receiving',390)};
  });
  return {reused:false};
}
let outcome;
try{outcome=await run();}
catch(error){
  failure=error;
  if(journal){journal.state='CONTINUATION_REQUIRED';journal.error={
    phase:activePhase,code:error.code??error.name,message:error.message};await save().catch(()=>{});}
}finally{
  // All three original owners are attempted even if a preceding close fails.
  const closed=await Promise.allSettled([closeBrowser(),closeHost()]);
  for(const value of closed)if(value.status==='rejected')failure??=value.reason;
  try{if(sender){await sender.close();sender=null;}}catch(error){failure??=error;}
  if(journal&&!outcome?.reused){
    journal.ownedBrowserClosed=browser===null;journal.ownedMerchantClosed=host===null;
    journal.ownedWorkbenchesClosed=sender===null&&host===null;journal.closedAt=now();
    await save().catch(error=>{failure??=error;});
  }
  process.off('SIGINT',stop);process.off('SIGTERM',stop);
}
try{
  if(failure)throw failure;
  if(!outcome.reused){
    assert(journal.ownedBrowserClosed&&journal.ownedMerchantClosed&&journal.ownedWorkbenchesClosed);
    journal.state='COMPLETE';journal.completedAt=now();delete journal.error;
    const result={...journal,schema:'stellar-forge.grant-reviewer-console-receiving-result.v1',
      originalPurchaseTransactions:original.originalPurchaseTransactions,
      originalQuoteAttempts:original.originalQuoteAttempts,newPaymentTransactions:0};
    await writeSourceFile(resultFile,encode(result),{replace:true});await save();
    process.stdout.write(JSON.stringify({state:'COMPLETE',resultFile,sha256:digest(await readFile(resultFile)),
      phases:Object.keys(journal.phases).length,ownedBrowserClosed:true,ownedMerchantClosed:true,
      ownedWorkbenchesClosed:true,newPaymentTransactions:0})+'\n');
  }
}finally{await lease.close();}
