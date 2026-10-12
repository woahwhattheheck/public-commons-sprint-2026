#!/usr/bin/env node
// MIT. Complete recipe commissioning in the original two-workspace merchant receiving operation.
import assert from 'node:assert/strict';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { startMerchantMcp } from '../serve.mjs';
import { canonical } from '../console/records.mjs';
import { receiveMerchantWorkflow } from './workflow-journey.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
async function optional(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;return null;}}
function members(bytes){
  const raw=gunzipSync(bytes),files=[];
  for(let offset=0;offset+512<=raw.length;){
    const header=raw.subarray(offset,offset+512);if(header.every(value=>value===0))break;
    const string=(start,size)=>header.subarray(start,start+size).toString('utf8').split('\0')[0];
    const size=parseInt(string(124,12).trim()||'0',8),name=string(0,100),prefix=string(345,155);
    assert.ok(Number.isSafeInteger(size)&&size>=0&&offset+512+size<=raw.length);
    if(['0',''].includes(string(156,1)))files.push({name:prefix?prefix+'/'+name:name,bytes:size,sha256:sha(raw.subarray(offset+512,offset+512+size))});
    offset+=512+Math.ceil(size/512)*512;
  }
  return files;
}
export async function receiveMerchantWorkflowRecipes({directory,chromiumPath,playwrightModule,sourceCommit,openSession=startMerchantMcp}={}){
  assert.ok(directory&&chromiumPath&&playwrightModule,'Supply the original directory, Chromium and Playwright module.');
  assert.match(sourceCommit??'',/^[a-f0-9]{40}$/);
  directory=resolve(directory);
  const baseline=await receiveMerchantWorkflow({directory,chromiumPath,playwrightModule,sourceCommit,openSession});
  assert.equal(baseline.result,'PASS');
  const checkpoint=join(directory,'workflow-recipes-receiving-checkpoint.json'),completed=join(directory,'workflow-recipes-native-run.json');
  const prior=await optional(completed);
  if(prior?.result==='PASS'){
    for(const file of prior.artifacts){const bytes=await readFile(join(directory,file.name));assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);}
    return {...prior,reused:true};
  }
  const suffix=sha(directory).slice(0,18),libraryProfile='recipe-library-'+suffix,targetProfile='recipe-target-'+suffix;
  const report=await optional(checkpoint)??{
    schema:'stellar-forge.merchant-workflow-recipe-native-receiving.v1',operationId:baseline.operationId,
    continuation:'reusable-workflow-recipes',directory,sourceSelections:[],startedAt:new Date().toISOString(),node:process.version,
    baseline:{runId:baseline.run.id,profileId:baseline.profileId,customerArchiveSha256:baseline.customerArchive.sha256},
    libraryProfile,targetProfile,ports:{...baseline.ports},workspaces:{...baseline.workspaces},
    phases:{},stages:[],requests:{},artifacts:[],browserErrors:[],result:'RUNNING'
  };
  assert.equal(report.directory,directory);assert.equal(report.libraryProfile,libraryProfile);assert.equal(report.targetProfile,targetProfile);
  assert.equal(report.baseline.runId,baseline.run.id);assert.equal(report.baseline.customerArchiveSha256,baseline.customerArchive.sha256);
  if(report.sourceSelections.at(-1)?.commit!==sourceCommit)report.sourceSelections.push({commit:sourceCommit,selectedAt:new Date().toISOString()});
  report.result='RUNNING';delete report.error;
  let source,receiver,context,sourcePage,targetPage,writes=Promise.resolve();
  const save=()=>{const bytes=JSON.stringify(report,null,2)+'\n';writes=writes.then(async()=>{
    await writeFile(checkpoint+'.tmp',bytes,{mode:0o600});await rename(checkpoint+'.tmp',checkpoint);
  });return writes;};
  const emit=async(stage,detail={})=>{
    report.phases[stage]=true;report.stages.push({stage,completedAt:new Date().toISOString(),...detail});await save();
    process.stdout.write(JSON.stringify({stage,...detail})+'\n');
  };
  const artifact=async(name,bytes)=>{
    await writeFile(join(directory,name),bytes,{mode:0o600});const value={name,bytes:bytes.length,sha256:sha(bytes)};
    const index=report.artifacts.findIndex(file=>file.name===name);if(index<0)report.artifacts.push(value);else report.artifacts[index]=value;
    await save();return value;
  };
  const retained=async name=>{
    const file=report.artifacts.find(file=>file.name===name);assert.ok(file,'Original produced artifact '+name);
    const bytes=await readFile(join(directory,name));assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);return bytes;
  };
  const token=(await readFile(join(directory,'native-access-token'),'utf8')).trim();
  const open=async role=>{
    const host=await openSession({configPath:join(directory,'merchant','merchant-mcp.json'),port:report.ports[role]??0,
      environment:{...process.env,MCP_ACCESS_TOKEN:token},consoleDirectory:join(directory,role+'-console')});
    report.ports[role]=Number(new URL(host.url).port);await save();return host;
  };
  const api=async(host,path,{method='GET',body,expected=200,raw=false}={})=>{
    const response=await fetch(host.url+'/operator/api/'+path,{method,headers:{authorization:'Bearer '+token,
      ...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const bytes=Buffer.from(await response.arrayBuffer());
    if(response.status!==expected){const error=new Error(path+': expected '+expected+', returned '+response.status+' '+bytes.toString());error.status=response.status;throw error;}
    return raw?bytes:JSON.parse(bytes.toString('utf8'));
  };
  const maybe=async(host,path)=>{try{return await api(host,path);}catch(error){if(error.status!==404)throw error;return null;}};
  const waitUntil=async(fn,label,timeout=180000)=>{
    const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await sleep(80);}
    throw new Error(label+' remains in its original saved operation.');
  };
  const response=async(page,path,act,{method='POST',status=200}={})=>{
    const waiting=page.waitForResponse(value=>new URL(value.url()).pathname==='/operator/api/'+path&&value.request().method()===method);
    await act();const returned=await waiting,body=await returned.json();assert.equal(returned.status(),status,JSON.stringify(body));return body;
  };
  const connect=async(page,host,profileId)=>{
    await page.goto(host.consoleUrl,{waitUntil:'networkidle'});await page.locator('#access-token').fill(token);
    await response(page,'profiles',()=>page.locator('#connect-form button[type=submit]').click(),{method:'GET'});
    await page.locator('#connected').waitFor({state:'visible'});
    await page.locator('#profiles').selectOption(profileId);await page.locator('[data-page=workflows]').click();
    await page.waitForFunction(id=>!document.getElementById('workflow-recipes-open').disabled&&
      document.getElementById('workflow-recipe-panel').dataset.intentReady==='true'&&
      document.getElementById('workflow-recipe-panel').dataset.profileId===id,profileId);
  };
  const capture=async(page,path,key,act)=>{
    const handler=async route=>{
      const body=route.request().postDataJSON();
      if(report.requests[key])assert.deepEqual(body,report.requests[key]);else{report.requests[key]=body;await save();}
      await route.continue();
    };
    await page.route('**/operator/api/'+path,handler);
    try{return await act();}finally{await page.unroute('**/operator/api/'+path,handler);}
  };
  const screenshot=async(page,name,viewport)=>{
    if(viewport)await page.setViewportSize(viewport);
    await artifact(name,await page.screenshot({fullPage:true,animations:'disabled'}));
  };
  const exportProfile=async(host,name)=>{
    const bytes=await api(host,'export/'+targetProfile,{raw:true});await artifact(name,bytes);return JSON.parse(bytes);
  };
  const receiveProfile=async(host,archive)=>api(host,'import',{method:'POST',body:{archive,expectedContentSha256:archive.contentSha256}});
  const openInstalled=async()=>{
    await connect(targetPage,receiver,targetProfile);
    const definition=(await api(receiver,'workflow/'+report.requests.install.id)).definition;
    await response(targetPage,'workflow/'+definition.id,
      ()=>targetPage.locator('#workflow-list button').filter({hasText:definition.name}).click(),{method:'GET'});
    await targetPage.waitForFunction(name=>document.getElementById('workflow-name').value===name,definition.name);
    return definition;
  };
  const readRun=async host=>(await api(host,'workflow-run/'+report.requests.start.id)).run;
  const waitRun=async()=>{
    return waitUntil(async()=>{
      const run=await readRun(receiver);
      if(run.state==='WAITING')throw new Error('Open the retained original recipe run and its native recovery request: '+JSON.stringify(run));
      return run.state==='COMPLETE'&&!run.active?run:null;
    },'Original recipe commissioning');
  };
  try{
    source=await open('source');receiver=await open('receiver');
    for(const [role,host]of [['source',source],['receiver',receiver]]){
      const value=await api(host,'host');assert.equal(value.console.workspaceId,report.workspaces[role]);
      assert.equal(value.operator.managesRunningSeller,false);
    }
    for(const [host,id,name]of [[source,libraryProfile,'Reusable merchant commissioning'],[receiver,targetProfile,'Recipe customer receiving']])
      if(!await maybe(host,'profile/'+id))await api(host,'profiles',{method:'POST',body:{id,name}});
    const {chromium}=createRequire(import.meta.url)(playwrightModule);
    context=await chromium.launchPersistentContext(join(directory,'browser'),{headless:true,executablePath:chromiumPath,
      args:['--no-sandbox','--disable-dev-shm-usage'],viewport:{width:1440,height:1080},acceptDownloads:true});
    sourcePage=context.pages()[0]??await context.newPage();targetPage=context.pages()[1]??await context.newPage();
    for(const page of [sourcePage,targetPage]){page.setDefaultTimeout(20000);page.on('pageerror',error=>report.browserErrors.push(error.message));}
    const templates=[
      {id:'before',name:'Read current release generation',tool:'merchant_status',arguments:{},bindings:[],expect:[]},
      {id:'stage',name:'Stage selected merchant source',tool:'merchant_stage',arguments:{source:'initial',id:'selected-release'},
        bindings:[{target:'/source',from:'inputs',pointer:'/sourceAlias'},{target:'/id',from:'inputs',pointer:'/releaseId'}],expect:[]},
      {id:'activate',name:'Activate the staged release',tool:'merchant_activate',
        arguments:{id:'selected-release',expectedDigest:'0'.repeat(64),expectedGeneration:0,reason:'Reviewed recipe commissioning'},
        bindings:[{target:'/id',from:'step',stepId:'stage',pointer:'/release/id'},
          {target:'/expectedDigest',from:'step',stepId:'stage',pointer:'/release/digest'},
          {target:'/expectedGeneration',from:'step',stepId:'before',pointer:'/state/generation'}],expect:[]},
      {id:'start',name:'Start the selected merchant',tool:'merchant_start',arguments:{expectedDigest:'0'.repeat(64),expectedGeneration:0},
        bindings:[{target:'/expectedDigest',from:'step',stepId:'stage',pointer:'/release/digest'},
          {target:'/expectedGeneration',from:'step',stepId:'activate',pointer:'/status/state/generation'}],
        expect:[{pointer:'/runtime/state',equals:'RUNNING'}]},
      {id:'customer',name:'Generate the original customer',tool:'merchant_client_export',arguments:{instanceId:'owned-instance',id:'selected-customer'},
        bindings:[{target:'/instanceId',from:'step',stepId:'start',pointer:'/operator/instanceId'},
          {target:'/id',from:'inputs',pointer:'/customerId'}],expect:[{pointer:'/mode',equals:'CHALLENGE_ONLY'}]},
      {id:'manifest',name:'Read the original customer manifest',tool:'merchant_client_export_manifest',arguments:{exportId:'selected-customer'},
        bindings:[{target:'/exportId',from:'inputs',pointer:'/customerId'}],expect:[]},
      {id:'stop',name:'Stop the owned merchant',tool:'merchant_stop',arguments:{instanceId:'owned-instance'},
        bindings:[{target:'/instanceId',from:'step',stepId:'start',pointer:'/operator/instanceId'}],expect:[]},
      {id:'final',name:'Read final merchant state',tool:'merchant_status',arguments:{},bindings:[],expect:[]}
    ];
    const templateId='recipe-template-'+suffix,steps=[];
    for(const template of templates){
      const id='recipe-template-draft-'+suffix+'-'+template.id;
      let draft=(await maybe(source,'draft/'+id))?.draft;
      if(!draft)draft=(await api(source,'drafts',{method:'POST',body:{id,profileId:libraryProfile,name:template.name,tool:template.tool,arguments:template.arguments}})).draft;
      assert.equal(draft.revision,1);assert.equal(draft.tool,template.tool);assert.deepEqual(JSON.parse(draft.argumentsJson),template.arguments);
      steps.push({id:template.id,name:template.name,draftId:id,draftRevision:1,bindings:template.bindings,expect:template.expect,pauseAfter:false});
    }
    let template=(await maybe(source,'workflow/'+templateId))?.definition;
    if(!template)template=(await api(source,'workflows',{method:'POST',body:{id:templateId,profileId:libraryProfile,name:'Commission merchant and receive customer',steps}})).definition;
    assert.equal(template.revision,1);assert.deepEqual(template.steps,steps);
    report.template={id:template.id,revision:template.revision,contentSha256:template.contentSha256};
    if(!report.phases['recipe-exported']){
      await connect(sourcePage,source,libraryProfile);await sourcePage.locator('#workflow-list button').filter({hasText:template.name}).click();
      await sourcePage.locator('#workflow-recipe-export-current').click();
      await sourcePage.locator('#workflow-recipe-export-name').fill('Commission merchant and receive customer');
      await sourcePage.locator('#workflow-recipe-export-description').fill('Select the configured source and unique release/customer identifiers; run the original merchant, receive its generated customer, and stop its owned instance.');
      await sourcePage.locator('#workflow-recipe-export-section > details > summary').click();
      await sourcePage.locator('#workflow-recipe-export-inputs').fill(JSON.stringify([
        {pointer:'/sourceAlias',label:'Configured source',type:'string',required:true,default:'initial',description:'Source alias reviewed on this merchant host.'},
        {pointer:'/releaseId',label:'New release identifier',type:'string',required:true,description:'A distinct original release for this commissioning.'},
        {pointer:'/customerId',label:'Customer export identifier',type:'string',required:true,description:'The customer generated and received by this workflow.'}
      ]));
      const exported=await response(sourcePage,'workflow-recipe-export',()=>sourcePage.locator('#workflow-recipe-export-prepare').click());
      const downloading=sourcePage.waitForEvent('download');await sourcePage.locator('#workflow-recipe-export-download').click();
      const download=await downloading;await download.saveAs(join(directory,'commissioning-workflow-recipe.json'));
      const bytes=await readFile(join(directory,'commissioning-workflow-recipe.json'));assert.deepEqual(JSON.parse(bytes),exported.recipe);
      const {contentSha256,...body}=exported.recipe;assert.equal(sha(canonical(body)),contentSha256);
      assert.equal(exported.recipe.steps.length,8);assert.equal(exported.recipe.source.workflowSha256,template.contentSha256);
      await artifact('commissioning-workflow-recipe.json',bytes);
      report.recipeSha256=contentSha256;await screenshot(sourcePage,'recipe-source-desktop.png');
      await emit('recipe-exported',{sourceWorkflow:template.id,recipeSha256:contentSha256,steps:8});
    }
    const recipe=JSON.parse(await retained('commissioning-workflow-recipe.json'));
    const inputs={releaseId:'recipe-release-'+suffix,customerId:'recipe-customer-'+suffix};
    if(!report.phases['installation-recovered']){
      await connect(targetPage,receiver,targetProfile);await targetPage.locator('#workflow-recipes-open').click();
      const lostRead=route=>route.abort('connectionreset');
      const lostPost=async route=>{
        const body=route.request().postDataJSON();
        if(report.requests.install)assert.deepEqual(body,report.requests.install);else{report.requests.install=body;await save();}
        const returned=await route.fetch();assert.equal(returned.status(),200);
        const accepted=await returned.json();assert.equal(accepted.installation.id,body.id);
        report.acceptedInstallation={id:accepted.installation.id,requestSha256:accepted.installation.requestSha256,
          definitionSha256:accepted.installation.definitionSha256};await save();await route.abort('connectionreset');
      };
      if(!report.requests.install){
        await targetPage.locator('#workflow-recipe-file').setInputFiles(join(directory,'commissioning-workflow-recipe.json'));
        await targetPage.waitForFunction(value=>document.getElementById('workflow-recipe-source').textContent.includes(value),report.recipeSha256);
        await targetPage.locator('#workflow-recipe-name').fill('Recipe merchant commissioning');
        await targetPage.locator('#workflow-recipe-inputs').fill(JSON.stringify(inputs));
        const reviewed=await response(targetPage,'workflow-recipe-review',()=>targetPage.locator('#workflow-recipe-review').click());
        assert.equal(reviewed.review.canInstall,true);assert.ok(reviewed.review.tools.every(tool=>tool.status==='MATCH'));
        assert.deepEqual(reviewed.review.inputs,{...inputs,sourceAlias:'initial'});report.review=reviewed.review;await save();
        await screenshot(targetPage,'recipe-reviewed-desktop.png');
        await targetPage.route('**/operator/api/workflow-recipe-install/*',lostRead);
        await targetPage.route('**/operator/api/workflow-recipe-install',lostPost);
        try{
          await targetPage.locator('#workflow-recipe-install').click();
          await waitUntil(()=>report.acceptedInstallation,'Original recipe installation acceptance',30000);
          await targetPage.waitForFunction(()=>!document.getElementById('workflow-recipe-recover').disabled&&
            !document.getElementById('workflow-recipe-pending').hidden);
          assert.ok((await targetPage.locator('#workflow-recipe-pending-id').textContent()).includes(report.requests.install.id));
          await connect(targetPage,receiver,targetProfile);
          await targetPage.locator('#workflow-recipe-pending').waitFor({state:'visible'});
          await screenshot(targetPage,'recipe-interrupted-installation.png');
          await emit('installation-response-lost',{workflowId:report.requests.install.id});
        }finally{
          await targetPage.unroute('**/operator/api/workflow-recipe-install',lostPost);
          await targetPage.unroute('**/operator/api/workflow-recipe-install/*',lostRead);
        }
      }
      const pending=await targetPage.locator('#workflow-recipe-pending').isVisible();
      if(pending){
        const denied=async route=>{
          const returned=await route.fetch({headers:{...route.request().headers(),authorization:'Bearer revoked-original-recipe-token'}});
          assert.equal(returned.status(),401);await route.fulfill({response:returned});
        };
        await targetPage.route('**/operator/api/workflow-recipe-install/*',denied);
        try{
          const rejected=targetPage.waitForResponse(value=>new URL(value.url()).pathname==='/operator/api/workflow-recipe-install/'+report.requests.install.id&&value.status()===401);
          await targetPage.locator('#workflow-recipe-recover').click();await rejected;
          await targetPage.waitForFunction(()=>!document.getElementById('workflow-recipe-recover').disabled);
          assert.ok((await targetPage.locator('#workflow-recipe-pending-id').textContent()).includes(report.requests.install.id));
        }finally{await targetPage.unroute('**/operator/api/workflow-recipe-install/*',denied);}
        await targetPage.locator('#workflow-recipe-recover').click();
        await targetPage.locator('#workflow-recipe-pending').waitFor({state:'hidden'});
      }
      let installed=await maybe(receiver,'workflow-recipe-install/'+report.requests.install.id);
      if(!installed)installed=await api(receiver,'workflow-recipe-install',{method:'POST',body:report.requests.install});
      assert.equal(installed.installation.recipeSha256,report.recipeSha256);assert.equal(installed.definition.revision,1);
      assert.deepEqual(installed.runInputs,{...inputs,sourceAlias:'initial'});
      assert.equal((await api(receiver,'profile/'+targetProfile)).calls.length,0);
      report.installation={id:installed.installation.id,requestSha256:installed.installation.requestSha256,
        definitionSha256:installed.installation.definitionSha256,contentSha256:installed.installation.contentSha256};
      await artifact('original-recipe-installation.json',Buffer.from(JSON.stringify(installed,null,2)+'\n'));
      await emit('installation-recovered',{workflowId:installed.installation.id,nativeDrafts:installed.installation.drafts.length});
    }
    if(!report.phases['recipe-commissioned']){
      await openInstalled();
      await targetPage.waitForFunction(expected=>{
        try{const current=JSON.parse(document.getElementById('workflow-inputs').value);
          return Object.keys(current).length===Object.keys(expected).length&&Object.entries(expected).every(([key,value])=>current[key]===value);}
        catch{return false;}
      },{...inputs,sourceAlias:'initial'});
      if(!report.requests.start){
        await capture(targetPage,'workflow-runs','start',()=>response(targetPage,'workflow-runs',()=>targetPage.locator('#workflow-start').click(),{status:202}));
      }else{
        let selected=(await maybe(receiver,'workflow-run/'+report.requests.start.id))?.run;
        if(!selected)selected=(await api(receiver,'workflow-runs',{method:'POST',body:report.requests.start,expected:202})).run;
        if(selected.state==='READY'&&!selected.active)await api(receiver,'workflow-resume',{method:'POST',body:{id:selected.id,expectedRevision:selected.revision},expected:202});
      }
      const run=await waitRun();assert.equal(run.stepsComplete,8);assert.equal(run.ownerWorkspaceId,report.workspaces.receiver);
      const calls=await Promise.all(run.steps.map(step=>api(receiver,'call/'+step.callId)));
      assert.equal((await api(receiver,'profile/'+targetProfile)).calls.length,8);
      assert.ok(calls.every(call=>call.state==='COMPLETE'));
      const results=calls.map(call=>{assert.equal(sha(call.resultJson),call.resultSha256);return JSON.parse(call.resultJson);});
      assert.equal(results[1].release.id,inputs.releaseId);assert.equal(results[3].runtime.state,'RUNNING');
      assert.equal(results[3].state.generation,results[2].status.state.generation);
      assert.equal(results[4].files.length,5);assert.equal(results[4].mode,'CHALLENGE_ONLY');
      assert.equal(results[7].operator.managesRunningSeller,false);
      report.customerSelection={family:'core',exportId:inputs.customerId,expectedManifestSha256:results[5].manifestFile.sha256};
      report.run={id:run.id,requestSha256:run.requestSha256,revision:run.revision,workflowRevision:run.workflowRevision};
      report.nativeCalls=calls.map(call=>({id:call.id,tool:call.tool,argumentsSha256:call.argumentsSha256,resultSha256:call.resultSha256}));
      await emit('recipe-commissioned',{runId:run.id,originalNativeCalls:8,releaseDigest:results[1].release.digest});
    }
    if(!report.phases['recipe-customer-received']){
      const existing=(await api(receiver,'profile/'+targetProfile)).deliveries.find(value=>value.identity.exportId===inputs.customerId);
      if(existing)report.customerId=existing.id;
      if(!report.customerId){
        await connect(targetPage,receiver,targetProfile);
        await targetPage.locator('#workflow-runs button').filter({hasText:report.requests.start.id}).click();
        await targetPage.locator('#workflow-run-steps tr').nth(5).getByRole('button',{name:'Open request'}).click();
        await targetPage.locator('#use-customer').click();
        assert.equal(await targetPage.locator('#customer-export').inputValue(),inputs.customerId);
        assert.equal(await targetPage.locator('#customer-sha').inputValue(),report.customerSelection.expectedManifestSha256);
        const accepted=await response(targetPage,'customers',()=>targetPage.locator('#customer-form button[type=submit]').click(),{status:202});
        report.customerId=accepted.delivery.id;await save();
      }
      const delivery=await waitUntil(async()=>{
        const selected=(await api(receiver,'profile/'+targetProfile)).deliveries.find(value=>value.id===report.customerId);
        if(selected?.state==='FAILED')throw new Error(JSON.stringify(selected));return selected?.state==='COMPLETE'&&!selected.active?selected:null;
      },'Original recipe customer receiving');
      assert.equal(delivery.files.length,6);
      for(const file of delivery.files){
        const bytes=await api(receiver,'customer-file/'+delivery.id+'?file='+encodeURIComponent(file.name),{raw:true});
        assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);
      }
      const archive=await api(receiver,'customer-archive/'+delivery.id,{raw:true}),files=members(archive);
      assert.equal(files.length,6);
      for(const file of delivery.files)assert.ok(files.some(member=>member.name.endsWith('/'+file.name)&&member.bytes===file.bytes&&member.sha256===file.sha256));
      report.customerArchive=await artifact('recipe-original-customer.tar.gz',archive);report.customerFiles=delivery.files;
      await emit('recipe-customer-received',{deliveryId:delivery.id,files:6,archiveSha256:report.customerArchive.sha256});
    }
    if(!report.phases['later-edition-saved']){
      const firstName='recipe-first-edition-profile.json';
      let first;
      if(report.artifacts.some(file=>file.name===firstName))first=JSON.parse(await retained(firstName));
      else{
        assert.equal((await api(receiver,'workflow/'+report.requests.install.id)).definition.revision,1,
          'Retain the original first-edition archive before editing the installed workflow.');
        first=await exportProfile(receiver,firstName);
      }
      const originalEditions=first.workflowData.definitions.filter(value=>value.id===report.requests.install.id);
      assert.equal(originalEditions.length,1);assert.equal(originalEditions[0].revision,1);
      assert.equal(originalEditions[0].contentSha256,report.installation.definitionSha256);
      const current=await openInstalled();
      if(current.revision===1){
        await targetPage.locator('#workflow-name').fill('Commission merchant with receiving checkpoint');
        await targetPage.locator('#workflow-steps [data-step-id="stop"] [data-field=pauseAfter]').setChecked(true);
        await capture(targetPage,'workflows','edition',()=>response(targetPage,'workflows',()=>targetPage.locator('#workflow-save').click()));
      }
      const later=(await api(receiver,'workflow/'+report.requests.install.id)).definition;
      assert.equal(later.revision,2);assert.equal(later.steps.find(step=>step.id==='stop').pauseAfter,true);
      const profile=(await api(receiver,'profile/'+targetProfile)).profile;
      if(profile.name!=='Recipe commissioning operations')await api(receiver,'profiles',{method:'POST',body:{
        id:profile.id,name:'Recipe commissioning operations',expectedRevision:profile.revision,favorites:profile.favorites}});
      const original=await api(receiver,'workflow-recipe-install',{method:'POST',body:report.requests.install});
      assert.equal(original.reused,true);assert.equal(original.definition.revision,1);assert.equal(original.currentDefinitionRevision,2);
      assert.equal(original.installation.contentSha256,report.installation.contentSha256);
      await emit('later-edition-saved',{workflowId:later.id,currentRevision:2,originalInstallationRevision:1});
    }
    const full=await exportProfile(receiver,'recipe-complete-profile.json');
    assert.equal(full.workflowRecipeData.installations.length,1);
    assert.equal(full.workflowData.definitions.filter(value=>value.id===report.requests.install.id).length,2);
    await receiveProfile(source,full);assert.equal((await receiveProfile(source,full)).reused,true);
    const earlier=JSON.parse(await retained('recipe-first-edition-profile.json'));await receiveProfile(source,earlier);
    assert.equal((await api(source,'workflow/'+report.requests.install.id)).definition.revision,2);
    const returned=await exportProfile(source,'recipe-received-profile.json');await receiveProfile(receiver,returned);
    for(const host of [source,receiver]){
      const installed=await api(host,'workflow-recipe-install/'+report.requests.install.id);
      assert.equal(installed.installation.contentSha256,report.installation.contentSha256);assert.equal(installed.definition.revision,1);
      assert.equal(installed.currentDefinitionRevision,2);assert.equal((await readRun(host)).state,'COMPLETE');
      assert.equal((await api(host,'profile/'+targetProfile)).calls.length,8);
    }
    await connect(targetPage,receiver,targetProfile);
    await targetPage.locator('#workflow-list button').filter({hasText:'Commission merchant with receiving checkpoint'}).click();
    await targetPage.locator('#workflow-inputs').fill('{"operatorNote":"Review inputs for the later operating edition"}');
    const selectedInputs=await targetPage.locator('#workflow-inputs').inputValue();
    const originalInputRead=targetPage.waitForResponse(value=>new URL(value.url()).pathname==='/operator/api/workflow-recipe-install/'+report.requests.install.id);
    await targetPage.locator('#workflow-list button').filter({hasText:'Commission merchant with receiving checkpoint'}).click();
    await (await originalInputRead).json();
    await targetPage.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
    assert.equal(await targetPage.locator('#workflow-inputs').inputValue(),selectedInputs);
    await targetPage.locator('#workflow-recipes-open').click();
    await screenshot(targetPage,'recipe-received-desktop.png');
    await screenshot(targetPage,'recipe-received-mobile.png',{width:390,height:844});
    assert.ok(await targetPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Recipe operating page fits the narrow viewport');
    await targetPage.setViewportSize({width:1440,height:1080});
    await source.close();source=null;await receiver.close();receiver=null;
    source=await open('source');receiver=await open('receiver');
    for(const [role,host]of [['source',source],['receiver',receiver]]){
      const status=await api(host,'host');assert.equal(status.console.workspaceId,report.workspaces[role]);
      assert.equal(status.operator.managesRunningSeller,false);
      const installed=await api(host,'workflow-recipe-install/'+report.requests.install.id),run=await readRun(host);
      assert.equal(installed.installation.contentSha256,report.installation.contentSha256);
      assert.equal(installed.definition.revision,1);assert.equal(installed.currentDefinitionRevision,2);
      assert.equal(run.state,'COMPLETE');assert.equal(run.requestSha256,report.run.requestSha256);
      assert.equal((await api(host,'profile/'+targetProfile)).calls.length,8);
      assert.equal((await api(host,'profile/'+baseline.profileId)).calls.length,7);
    }
    assert.equal(sha(await api(receiver,'customer-archive/'+report.customerId,{raw:true})),report.customerArchive.sha256);
    assert.equal(sha(await api(receiver,'customer-archive/'+baseline.customerId,{raw:true})),baseline.customerArchive.sha256);
    await connect(sourcePage,source,targetProfile);await sourcePage.locator('#workflow-recipes-open').click();
    await screenshot(sourcePage,'recipe-reopened-receiver-profile.png');
    await emit('complete-profile-received-and-reopened',{workflowId:report.requests.install.id,runId:report.requests.start.id,
      originalRevision:1,currentRevision:2,originalNativeCalls:8,customerArchiveSha256:report.customerArchive.sha256});
    await source.close();source=null;await receiver.close();receiver=null;await context.close();context=null;
    assert.deepEqual(report.browserErrors,[]);
    report.result='PASS';report.completedAt=new Date().toISOString();await save();
    await writeFile(completed,JSON.stringify(report,null,2)+'\n',{mode:0o600});
    process.stdout.write(JSON.stringify({result:report.result,operationId:report.operationId,continuation:report.continuation,
      workflowId:report.installation.id,runId:report.run.id,artifacts:report.artifacts})+'\n');
    return report;
  }catch(error){
    report.result='FAILED';report.error={code:error.code??'WORKFLOW_RECIPE_RECEIVING_FAILED',message:error.message,stack:error.stack};
    await save();throw error;
  }finally{await Promise.allSettled([source?.close(),receiver?.close(),context?.close()]);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const flags=new Map();for(let index=2;index<process.argv.length;index+=2)flags.set(process.argv[index],process.argv[index+1]);
  receiveMerchantWorkflowRecipes({directory:flags.get('--directory'),chromiumPath:flags.get('--chromium')??process.env.STARFORGE_CHROMIUM,
    playwrightModule:flags.get('--playwright-module')??process.env.STARFORGE_PLAYWRIGHT_MODULE,sourceCommit:flags.get('--source-commit')})
    .catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
}
