#!/usr/bin/env node
// MIT. One original merchant workflow, two named receiving workspaces and complete customer delivery.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { initializeMerchant, readMerchantConfig } from '../config.mjs';
import { startMerchantMcp } from '../serve.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const required=(value,name)=>{if(!value)throw new Error('Supply '+name);return value;};
const sourceFile=name=>fileURLToPath(new URL('../../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/'+name,import.meta.url));
async function optionalJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;return null;}}
function tarFiles(bytes){
  const raw=gunzipSync(bytes),files=[];
  for(let offset=0;offset+512<=raw.length;){
    const header=raw.subarray(offset,offset+512);if(header.every(value=>value===0))break;
    const string=(start,size)=>header.subarray(start,start+size).toString('utf8').split('\0')[0];
    const size=parseInt(string(124,12).trim()||'0',8),name=string(0,100),prefix=string(345,155);
    assert.ok(Number.isSafeInteger(size)&&size>=0&&offset+512+size<=raw.length,'Complete original archive member');
    const body=raw.subarray(offset+512,offset+512+size);
    if(['0',''].includes(string(156,1)))files.push({name:prefix?prefix+'/'+name:name,bytes:body.length,sha256:sha(body)});
    offset+=512+Math.ceil(size/512)*512;
  }
  return files;
}
export async function receiveMerchantWorkflow({directory,chromiumPath,playwrightModule,sourceCommit,openSession=startMerchantMcp}={}){
  directory=resolve(required(directory,'--directory'));
  assert.match(required(sourceCommit,'--source-commit'),/^[a-f0-9]{40}$/);
  if(typeof openSession!=='function')throw new TypeError('Use the original native merchant session factory.');
  await mkdir(directory,{recursive:true,mode:0o700});
  const checkpoint=join(directory,'workflow-receiving-checkpoint.json'),completed=join(directory,'workflow-native-run.json');
  const prior=await optionalJson(completed);
  if(prior?.result==='PASS'){
    for(const file of prior.artifacts){const bytes=await readFile(join(directory,file.name));assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);}
    return {...prior,reused:true};
  }
  const suffix=sha(directory).slice(0,18),profileId='workflow-profile-'+suffix;
  const report=await optionalJson(checkpoint)??{
    schema:'stellar-forge.merchant-workflow-native-receiving.v1',operationId:'ASTRA-24EA-MERCHANT-WORKFLOW-20261012',
    directory,sourceCommit,sourceSelections:[],startedAt:new Date().toISOString(),node:process.version,
    profileId,ports:{},workspaces:{},phases:{},stages:[],requests:{},artifacts:[],browserErrors:[],result:'RUNNING'
  };
  assert.equal(report.directory,directory);assert.equal(report.profileId,profileId);
  if(report.sourceSelections.at(-1)?.commit!==sourceCommit)report.sourceSelections.push({commit:sourceCommit,selectedAt:new Date().toISOString()});
  report.result='RUNNING';delete report.error;
  let writes=Promise.resolve(),source,receiver,context,page,receiverPage;
  const save=()=>{const bytes=JSON.stringify(report,null,2)+'\n';writes=writes.then(async()=>{
    await writeFile(checkpoint+'.tmp',bytes,{mode:0o600});await rename(checkpoint+'.tmp',checkpoint);
  });return writes;};
  const emit=async(stage,detail={})=>{
    report.phases[stage]=true;report.stages.push({stage,completedAt:new Date().toISOString(),...detail});await save();
    process.stdout.write(JSON.stringify({stage,...detail})+'\n');
  };
  const artifact=async(name,bytes)=>{
    await writeFile(join(directory,name),bytes,{mode:0o600});
    const value={name,bytes:bytes.length,sha256:sha(bytes)},index=report.artifacts.findIndex(file=>file.name===name);
    if(index<0)report.artifacts.push(value);else report.artifacts[index]=value;
    await save();return value;
  };
  const tokenFile=join(directory,'native-access-token');
  let token;
  try{token=(await readFile(tokenFile,'utf8')).trim();}
  catch(error){if(error.code!=='ENOENT')throw error;token=randomBytes(32).toString('hex');await writeFile(tokenFile,token+'\n',{mode:0o600,flag:'wx'});}
  const configuration=join(directory,'merchant','merchant-mcp.json');
  const open=async role=>{
    const host=await openSession({configPath:configuration,port:report.ports[role]??0,
      environment:{...process.env,MCP_ACCESS_TOKEN:token},consoleDirectory:join(directory,role+'-console')});
    report.ports[role]=Number(new URL(host.url).port);await save();return host;
  };
  const api=async(host,path,{method='GET',body,expected=200,raw=false}={})=>{
    const response=await fetch(host.url+'/operator/api/'+path,{method,headers:{authorization:'Bearer '+token,
      ...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const bytes=Buffer.from(await response.arrayBuffer());
    if(response.status!==expected){const error=new Error(path+': expected '+expected+', returned '+response.status+' '+bytes.toString());error.status=response.status;throw error;}
    return raw?{bytes,headers:response.headers}:JSON.parse(bytes.toString('utf8'));
  };
  const maybe=async(host,path)=>{try{return await api(host,path);}catch(error){if(error.status!==404)throw error;return null;}};
  const waitUntil=async(fn,label,timeout=180000)=>{
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){const value=await fn();if(value)return value;await sleep(80);}
    throw new Error(label+' is still pending in its original saved operation.');
  };
  const run=async host=>(await api(host,'workflow-run/'+report.requests.start.id)).run;
  const waitRun=async(host,predicate,label)=>waitUntil(async()=>{
    const value=await run(host);
    if(value.state==='WAITING')throw new Error('Original workflow requires its saved native recovery: '+JSON.stringify(value));
    return !value.active&&predicate(value)?value:null;
  },label);
  const response=async(selected,path,action,method='POST')=>{
    const waiting=selected.waitForResponse(value=>new URL(value.url()).pathname==='/operator/api/'+path&&value.request().method()===method);
    await action();const returned=await waiting,value=await returned.json();assert.ok(returned.ok(),JSON.stringify(value));return value;
  };
  const connect=async(selected,host)=>{
    await selected.goto(host.consoleUrl,{waitUntil:'networkidle'});await selected.locator('#access-token').fill(token);
    await response(selected,'profiles',()=>selected.locator('#connect-form button[type=submit]').click(),'GET');
    await selected.locator('#connected').waitFor({state:'visible'});
    await selected.locator('#profiles').selectOption(profileId);
    await selected.locator('[data-page=workflows]').click();
    if(report.requests.definition)await selected.locator('#workflow-list button').first().waitFor({state:'visible'});
  };
  const openRun=async(selected,host)=>{
    await connect(selected,host);
    await selected.locator('#workflow-runs button').filter({hasText:report.requests.start.id}).click();
    await selected.locator('#workflow-run-detail').waitFor({state:'visible'});
  };
  const capture=async(selected,path,key,fn)=>{
    const handler=async route=>{
      assert.equal(route.request().method(),'POST');
      const body=route.request().postDataJSON();
      if(report.requests[key])assert.deepEqual(body,report.requests[key],'Reuse the exact original '+key+' request');
      else{report.requests[key]=body;await save();}
      await route.continue();
    };
    await selected.route('**/operator/api/'+path,handler);
    try{return await fn();}finally{await selected.unroute('**/operator/api/'+path,handler);}
  };
  const exportProfile=async(host,name)=>{
    const original=await api(host,'export/'+profileId,{raw:true});const packet=JSON.parse(original.bytes);
    await artifact(name,original.bytes);return packet;
  };
  const receiveProfile=async(host,packet)=>api(host,'import',{method:'POST',body:{archive:packet,expectedContentSha256:packet.contentSha256}});
  const screenshot=async(selected,name,viewport)=>{
    if(viewport)await selected.setViewportSize(viewport);
    const bytes=await selected.screenshot({fullPage:true,animations:'disabled'});await artifact(name,bytes);
  };
  const handover=async(key,from,to,selected)=>{
    if(report.requests[key])return api(from,'workflow-handover',{method:'POST',body:report.requests[key]});
    const target=await api(to,'host');
    await openRun(selected,from);
    await selected.locator('details').filter({has:selected.locator('#workflow-handover-form')}).locator('summary').click();
    await selected.locator('#workflow-recipient-workspace').fill(target.console.workspaceId);
    await selected.locator('#workflow-recipient-host').fill(target.configurationFingerprint);
    await selected.locator('#workflow-handover-note').fill(key==='outbound'
      ?'Continue this original saved merchant workflow, receive its generated customer, then return its final status step.'
      :'Original seller has stopped and its customer has been received. Finish the original status step and return the completed profile.');
    const downloading=selected.waitForEvent('download');
    const result=await capture(selected,'workflow-handover',key,()=>response(selected,'workflow-handover',
      ()=>selected.locator('#workflow-handover-submit').click()));
    const downloaded=await downloading,name=key==='outbound'?'browser-profile-to-receiver.json':'browser-profile-return-to-source.json';
    await downloaded.saveAs(join(directory,name));await artifact(name,await readFile(join(directory,name)));
    return result;
  };
  const continueRun=async(host,selected,predicate,label)=>{
    let current=await run(host);if(!current.active&&!predicate(current)){
      await openRun(selected,host);
      await response(selected,'workflow-resume',()=>selected.locator('#workflow-continue').click());
    }
    return waitRun(host,predicate,label);
  };
  try{
    const inputs=[];
    for(const name of ['openapi.example.json','service-selections.example.json','service-bindings.example.json']){
      const bytes=await readFile(sourceFile(name));inputs.push({name,bytes:bytes.length,sha256:sha(bytes)});
    }
    if(report.sourceInputs)assert.deepEqual(inputs,report.sourceInputs,'Continue with the original merchant source inputs');
    else{report.sourceInputs=inputs;await save();}
    try{await readFile(configuration);await readMerchantConfig(configuration);}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      assert.equal(Boolean(report.phases.initialized),false,'Restore the original initialized merchant configuration');
      assert.equal(Boolean(report.requests.definition),false,'Restore the original merchant before continuing saved work');
      await rm(join(directory,'merchant'),{recursive:true,force:true});
      await initializeMerchant({directory:join(directory,'merchant'),name:'Saved workflow receiving',
        spec:sourceFile('openapi.example.json'),selections:sourceFile('service-selections.example.json'),
        bindings:sourceFile('service-bindings.example.json'),runtime:{port:0}});
    }
    source=await open('source');receiver=await open('receiver');
    const sourceHost=await api(source,'host'),receiverHost=await api(receiver,'host');
    assert.notEqual(sourceHost.console.workspaceId,receiverHost.console.workspaceId);
    assert.equal(sourceHost.configurationFingerprint,receiverHost.configurationFingerprint);
    for(const [role,host] of [['source',sourceHost],['receiver',receiverHost]]){
      if(report.workspaces[role])assert.equal(host.console.workspaceId,report.workspaces[role]);
      else report.workspaces[role]=host.console.workspaceId;
    }
    if(!await maybe(source,'profile/'+profileId))
      await api(source,'profiles',{method:'POST',body:{id:profileId,name:'Merchant workflow receiving'}});
    await emit('initialized',{sourceWorkspace:report.workspaces.source,receiverWorkspace:report.workspaces.receiver});
    const {chromium}=createRequire(import.meta.url)(required(playwrightModule,'--playwright-module'));
    context=await chromium.launchPersistentContext(join(directory,'browser'),{
      headless:true,executablePath:required(chromiumPath,'--chromium'),args:['--no-sandbox','--disable-dev-shm-usage'],
      viewport:{width:1440,height:1080},acceptDownloads:true});
    page=context.pages()[0]??await context.newPage();receiverPage=await context.newPage();
    for(const selected of [page,receiverPage]){selected.setDefaultTimeout(20000);selected.on('pageerror',error=>report.browserErrors.push(error.message));}
    const releaseId='workflow-release-'+suffix,exportId='workflow-customer-'+suffix;
    const templates=[
      {id:'stage',name:'Stage original merchant',tool:'merchant_stage',arguments:{source:'initial',id:releaseId},bindings:[],expect:[],pauseAfter:true},
      {id:'activate',name:'Select staged merchant',tool:'merchant_activate',
        arguments:{id:releaseId,expectedDigest:'0'.repeat(64),expectedGeneration:0,reason:'Reviewed original saved merchant workflow'},
        bindings:[{target:'/expectedDigest',from:'step',stepId:'stage',pointer:'/release/digest'}],expect:[]},
      {id:'start',name:'Start selected merchant',tool:'merchant_start',
        arguments:{expectedGeneration:1,expectedDigest:'0'.repeat(64)},
        bindings:[{target:'/expectedDigest',from:'step',stepId:'stage',pointer:'/release/digest'}],
        expect:[{pointer:'/runtime/state',equals:'RUNNING'}]},
      {id:'customer',name:'Generate original customer',tool:'merchant_client_export',
        arguments:{instanceId:'selected-instance',id:exportId},
        bindings:[{target:'/instanceId',from:'step',stepId:'start',pointer:'/operator/instanceId'},
          {target:'/id',from:'inputs',pointer:'/customerId'}],
        expect:[{pointer:'/mode',equals:'CHALLENGE_ONLY'}]},
      {id:'manifest',name:'Read original customer manifest',tool:'merchant_client_export_manifest',
        arguments:{exportId},bindings:[{target:'/exportId',from:'inputs',pointer:'/customerId'}],expect:[]},
      {id:'stop',name:'Stop owned merchant',tool:'merchant_stop',arguments:{instanceId:'selected-instance'},
        bindings:[{target:'/instanceId',from:'step',stepId:'start',pointer:'/operator/instanceId'}],expect:[],pauseAfter:true},
      {id:'status',name:'Inspect final original state',tool:'merchant_status',arguments:{},bindings:[],expect:[]}
    ];
    for(const template of templates){
      const id='workflow-template-'+suffix+'-'+template.id;
      let draft=(await maybe(source,'draft/'+id))?.draft;
      if(!draft)draft=(await api(source,'drafts',{method:'POST',body:{id,profileId,name:template.name,tool:template.tool,arguments:template.arguments}})).draft;
      assert.equal(draft.tool,template.tool);assert.deepEqual(JSON.parse(draft.argumentsJson),template.arguments);
      template.draft=draft;
    }
    if(!report.requests.definition){
      await connect(page,source);await page.locator('#new-workflow').click();
      await page.locator('#workflow-name').fill('Original merchant and customer handover');
      const ids=new Map();
      for(const template of templates){
        await page.locator('#workflow-add-draft').selectOption(template.draft.id);
        await page.locator('#workflow-add-step').click();
        const card=page.locator('#workflow-steps [data-step-id]').last(),stepId=await card.getAttribute('data-step-id');
        ids.set(template.id,stepId);
        await card.locator('[data-field=name]').fill(template.name);
        await card.locator('[data-field=bindings]').fill(JSON.stringify(template.bindings.map(binding=>binding.stepId?{...binding,stepId:ids.get(binding.stepId)}:binding)));
        await card.locator('[data-field=expect]').fill(JSON.stringify(template.expect));
        await card.locator('[data-field=pauseAfter]').setChecked(Boolean(template.pauseAfter));
      }
      const value=await capture(page,'workflows','definition',()=>response(page,'workflows',()=>page.locator('#workflow-save').click()));
      report.definition={id:value.definition.id,revision:value.definition.revision,contentSha256:value.definition.contentSha256};
    }else{
      let value=await maybe(source,'workflow/'+report.requests.definition.id);
      if(!value)value=await api(source,'workflows',{method:'POST',body:report.requests.definition});
      report.definition={id:value.definition.id,revision:value.definition.revision,contentSha256:value.definition.contentSha256};
    }
    await emit('definition-saved',{workflow:report.definition,steps:templates.length});
    if(!report.phases['start-recovered']){
      if(!report.requests.start){
        await connect(page,source);await page.locator('#workflow-list button').first().click();
        await page.locator('#workflow-inputs').fill(JSON.stringify({customerId:exportId}));
        const lostRead=route=>route.abort('connectionreset');
        const lostPost=async route=>{
          report.requests.start=route.request().postDataJSON();await save();
          const returned=await route.fetch();assert.equal(returned.status(),202);
          const accepted=await returned.json();assert.equal(accepted.run.id,report.requests.start.id);
          report.lostStartAcceptance={id:accepted.run.id,reused:accepted.reused};await save();
          await route.abort('connectionreset');
        };
        await page.route('**/operator/api/workflow-run/*',lostRead);
        await page.route('**/operator/api/workflow-runs',lostPost);
        try{
          await page.locator('#workflow-start').click();
          await waitUntil(()=>report.lostStartAcceptance,'Original start acceptance',30000);
          await page.waitForFunction(()=>!document.getElementById('workflow-retry-start').disabled&&
            !document.getElementById('workflow-pending').hidden);
          assert.ok((await page.locator('#workflow-pending-start').textContent()).includes(report.requests.start.id));
          await emit('accepted-response-lost',{runId:report.requests.start.id});
        }finally{
          await page.unroute('**/operator/api/workflow-runs',lostPost);await page.unroute('**/operator/api/workflow-run/*',lostRead);
        }
      }
      let original=(await maybe(source,'workflow-run/'+report.requests.start.id))?.run;
      if(!original)original=(await api(source,'workflow-runs',{method:'POST',body:report.requests.start,expected:202})).run;
      if(original.state==='READY'&&!original.active)
        await api(source,'workflow-resume',{method:'POST',body:{id:original.id,expectedRevision:original.revision},expected:202});
      const paused=await waitRun(source,value=>value.state==='PAUSED'&&value.stepsComplete===1,'Original staged pause');
      const before=(await api(source,'profile/'+profileId)).calls.map(call=>call.id).sort();
      await connect(page,source);
      const pending=await page.locator('#workflow-retry-start').isVisible();
      if(pending){
        assert.ok((await page.locator('#workflow-pending-start').textContent()).includes(paused.id));
        const denied=async route=>{const returned=await route.fetch({headers:{...route.request().headers(),authorization:'Bearer revoked-native-journey-token'}});
          assert.equal(returned.status(),401);await route.fulfill({response:returned});};
        await page.route('**/operator/api/workflow-runs',denied);await page.route('**/operator/api/workflow-run/*',denied);
        try{
          const failed=page.waitForResponse(value=>new URL(value.url()).pathname==='/operator/api/workflow-runs'&&value.status()===401);
          await page.locator('#workflow-retry-start').click();await failed;
          await page.waitForFunction(()=>!document.getElementById('workflow-retry-start').disabled);
          assert.ok((await page.locator('#workflow-pending-start').textContent()).includes(paused.id));
          await emit('uncertain-auth-retry-retained',{runId:paused.id});
        }finally{
          await page.unroute('**/operator/api/workflow-runs',denied);await page.unroute('**/operator/api/workflow-run/*',denied);
        }
        const recovered=await response(page,'workflow-runs',()=>page.locator('#workflow-retry-start').click());
        assert.equal(recovered.reused,true);assert.equal(recovered.run.id,paused.id);
        await page.locator('#workflow-pending').waitFor({state:'hidden'});
      }else{
        const recovered=await api(source,'workflow-runs',{method:'POST',body:report.requests.start,expected:202});
        assert.equal(recovered.reused,true);assert.equal(recovered.run.id,paused.id);
      }
      assert.deepEqual((await api(source,'profile/'+profileId)).calls.map(call=>call.id).sort(),before);
      await emit('start-recovered',{runId:paused.id,originalCalls:before});
    }
    if(!report.phases['outbound-received']){
      const review=await exportProfile(source,'profile-review-copy.json');await receiveProfile(receiver,review);
      const reviewRun=await run(receiver);
      if(!report.requests.outbound){
        assert.equal(reviewRun.ownerWorkspaceId,report.workspaces.source);
        await api(receiver,'workflow-resume',{method:'POST',expected:409,body:{id:reviewRun.id,expectedRevision:reviewRun.revision}});
      }
      await handover('outbound',source,receiver,page);
      const packet=await exportProfile(source,'profile-to-receiver.json');await receiveProfile(receiver,packet);
      const received=await run(receiver);assert.equal(received.ownerWorkspaceId,report.workspaces.receiver);
      const released=await run(source);
      await api(source,'workflow-resume',{method:'POST',expected:409,body:{id:released.id,expectedRevision:released.revision}});
      await emit('outbound-received',{runId:received.id,owner:received.ownerWorkspaceId});
    }
    if(!report.phases['merchant-and-customer']){
      const stopped=await continueRun(receiver,receiverPage,value=>value.state==='PAUSED'&&value.stepsComplete===6,'Original merchant/customer workflow');
      const calls=await Promise.all(stopped.steps.slice(0,6).map(step=>api(receiver,'call/'+step.callId)));
      assert.ok(calls.every(call=>call?.state==='COMPLETE'));
      const results=calls.map(call=>{assert.equal(sha(call.resultJson),call.resultSha256);return JSON.parse(call.resultJson);});
      assert.match(results[0].release.digest,/^[a-f0-9]{64}$/);
      assert.equal(results[2].runtime.state,'RUNNING');assert.equal(results[3].files.length,5);
      assert.equal(results[3].mode,'CHALLENGE_ONLY');assert.match(results[4].manifestFile.sha256,/^[a-f0-9]{64}$/);
      report.customerSelection={family:'core',exportId,expectedManifestSha256:results[4].manifestFile.sha256};
      report.originalCalls=calls.map(call=>({id:call.id,tool:call.tool,argumentsSha256:call.argumentsSha256,resultSha256:call.resultSha256}));
      assert.equal((await api(receiver,'host')).operator.managesRunningSeller,false);
      await emit('merchant-and-customer',{runId:stopped.id,releaseDigest:results[0].release.digest,manifestSha256:report.customerSelection.expectedManifestSha256});
    }
    if(!report.phases['customer-received']){
      await openRun(receiverPage,receiver);
      await receiverPage.locator('#workflow-run-steps tr').nth(4).getByRole('button',{name:'Open request'}).click();
      await receiverPage.locator('#use-customer').click();
      assert.equal(await receiverPage.locator('#customer-export').inputValue(),exportId);
      assert.equal(await receiverPage.locator('#customer-sha').inputValue(),report.customerSelection.expectedManifestSha256);
      const accepted=await response(receiverPage,'customers',()=>receiverPage.locator('#customer-form button[type=submit]').click());
      report.customerId=accepted.delivery.id;await save();
      const delivery=await waitUntil(async()=>{
        const found=(await api(receiver,'profile/'+profileId)).deliveries.find(value=>value.id===report.customerId);
        if(found?.state==='FAILED')throw new Error(JSON.stringify(found));return found?.state==='COMPLETE'&&!found.active?found:null;
      },'Original customer receiving');
      assert.equal(delivery.files.length,6);const files=[];
      for(const file of delivery.files){
        const returned=await api(receiver,'customer-file/'+delivery.id+'?file='+encodeURIComponent(file.name),{raw:true});
        assert.equal(returned.bytes.length,file.bytes);assert.equal(sha(returned.bytes),file.sha256);files.push(file);
      }
      const archive=await api(receiver,'customer-archive/'+delivery.id,{raw:true}),members=tarFiles(archive.bytes);
      assert.equal(members.length,6);
      for(const file of files)assert.ok(members.some(member=>member.name.endsWith('/'+file.name)&&member.bytes===file.bytes&&member.sha256===file.sha256),file.name);
      report.customerArchive=await artifact('workflow-original-customer.tar.gz',archive.bytes);report.customerFiles=files;
      await receiverPage.locator('#refresh-customers').click();await receiverPage.locator('#customer-list button').first().click();
      await screenshot(receiverPage,'workflow-customer-desktop.png');
      await emit('customer-received',{deliveryId:delivery.id,files:files.length,archiveSha256:report.customerArchive.sha256});
    }
    if(!report.phases['return-received']){
      await handover('return',receiver,source,receiverPage);
      const packet=await exportProfile(receiver,'profile-return-to-source.json');await receiveProfile(source,packet);
      const returned=await run(source);assert.equal(returned.ownerWorkspaceId,report.workspaces.source);
      assert.equal(returned.stepsComplete,6);assert.equal(returned.id,report.requests.start.id);
      await emit('return-received',{runId:returned.id,owner:returned.ownerWorkspaceId});
    }
    if(!report.phases['workflow-completed']){
      const complete=await continueRun(source,page,value=>value.state==='COMPLETE','Original final status');
      assert.equal(complete.stepsComplete,7);assert.equal(complete.workspaceId,report.workspaces.source);
      assert.equal(complete.ownerWorkspaceId,report.workspaces.source);assert.equal(complete.events.filter(event=>event.kind==='HANDED_OVER').length,2);
      const details=await api(source,'profile/'+profileId);
      assert.equal(details.calls.length,7);assert.equal(new Set(details.calls.map(call=>call.id)).size,7);
      assert.ok(details.calls.every(call=>call.state==='COMPLETE'));
      for(const call of await Promise.all(details.calls.map(value=>api(source,'call/'+value.id))))assert.equal(sha(call.resultJson),call.resultSha256);
      report.run={id:complete.id,workflowId:complete.workflowId,workflowRevision:complete.workflowRevision,
        requestSha256:complete.requestSha256,revision:complete.revision,events:complete.events,steps:complete.steps};
      await openRun(page,source);await screenshot(page,'workflow-complete-desktop.png');
      await screenshot(page,'workflow-complete-mobile.png',{width:390,height:844});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile workflow has no horizontal page overflow');
      await page.setViewportSize({width:1440,height:1080});
      await emit('workflow-completed',{runId:complete.id,originalNativeCalls:details.calls.length});
    }
    const packet=await exportProfile(source,'workflow-complete-profile.json');await receiveProfile(receiver,packet);
    const repeated=await receiveProfile(receiver,packet);assert.equal(repeated.reused,true);
    const localCustomer=(await api(receiver,'profile/'+profileId)).deliveries.find(value=>value.id===report.customerId);
    assert.equal(localCustomer.localFiles,true);
    const retained=await api(receiver,'customer-archive/'+report.customerId,{raw:true});
    assert.equal(sha(retained.bytes),report.customerArchive.sha256);
    const originalState=await run(source),receivedState=await run(receiver);
    assert.equal(receivedState.revision,originalState.revision);assert.deepEqual(receivedState.events,originalState.events);
    await source.close();source=null;await receiver.close();receiver=null;
    source=await open('source');receiver=await open('receiver');
    for(const [role,host] of [['source',source],['receiver',receiver]]){
      const status=await api(host,'host'),saved=await run(host);
      assert.equal(status.console.workspaceId,report.workspaces[role]);
      assert.equal(saved.id,report.requests.start.id);assert.equal(saved.state,'COMPLETE');
      assert.equal(saved.requestSha256,report.run.requestSha256);
      assert.equal(saved.revision,report.run.revision);
      assert.equal((await api(host,'profile/'+profileId)).calls.length,7);
      assert.equal(status.operator.managesRunningSeller,false);
    }
    const reopenedCustomer=await api(receiver,'customer-archive/'+report.customerId,{raw:true});
    assert.equal(sha(reopenedCustomer.bytes),report.customerArchive.sha256);
    await openRun(page,source);await screenshot(page,'workflow-reopened.png');
    await emit('closed-and-reopened',{runId:report.requests.start.id,customerArchiveSha256:report.customerArchive.sha256});
    await source.close();source=null;await receiver.close();receiver=null;await context.close();context=null;
    assert.deepEqual(report.browserErrors,[]);
    report.result='PASS';report.completedAt=new Date().toISOString();await save();
    await writeFile(completed,JSON.stringify(report,null,2)+'\n',{mode:0o600});
    process.stdout.write(JSON.stringify({result:report.result,operationId:report.operationId,runId:report.run.id,artifacts:report.artifacts})+'\n');
    return report;
  }catch(error){
    report.result='FAILED';report.error={code:error.code??'WORKFLOW_RECEIVING_FAILED',message:error.message,stack:error.stack};await save();throw error;
  }finally{
    await Promise.allSettled([source?.close(),receiver?.close(),context?.close()]);
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const flags=new Map();
  for(let index=2;index<process.argv.length;index+=2)flags.set(process.argv[index],process.argv[index+1]);
  receiveMerchantWorkflow({directory:flags.get('--directory'),chromiumPath:flags.get('--chromium')??process.env.STARFORGE_CHROMIUM,
    playwrightModule:flags.get('--playwright-module')??process.env.STARFORGE_PLAYWRIGHT_MODULE,sourceCommit:flags.get('--source-commit')})
    .catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
}
