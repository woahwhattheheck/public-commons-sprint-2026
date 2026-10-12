#!/usr/bin/env node
// MIT. Real browser + retained console + original seller/customer receiving.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { initializeMerchant } from '../config.mjs';
import { startMerchantMcp } from '../serve.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const sourceFile=name=>fileURLToPath(new URL('../../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/'+name,import.meta.url));
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const required=(value,name)=>{if(!value)throw new Error('Supply '+name);return value;};
function tarFiles(bytes){
  const raw=gunzipSync(bytes),files=[];
  for(let offset=0;offset+512<=raw.length;){
    const header=raw.subarray(offset,offset+512);
    if(header.every(value=>value===0))break;
    const string=(start,size)=>header.subarray(start,start+size).toString('utf8').split('\0')[0];
    const size=parseInt(string(124,12).trim()||'0',8),name=string(0,100);
    assert.ok(Number.isSafeInteger(size)&&size>=0,'Original archive member size');
    const body=raw.subarray(offset+512,offset+512+size);
    if(string(156,1)==='0'||string(156,1)==='')files.push({name,bytes:body.length,sha256:sha(body)});
    offset+=512+Math.ceil(size/512)*512;
  }
  return files;
}
export async function receiveConsole({directory,chromiumPath,playwrightModule,sourceCommit,openSession=startMerchantMcp}={}){
  if(typeof openSession!=='function')throw new TypeError('Use the original merchant session factory.');
  directory=resolve(required(directory,'--directory'));
  await mkdir(directory,{recursive:true,mode:0o700});
  const completed=join(directory,'console-native-run.json');
  try{
    const prior=JSON.parse(await readFile(completed,'utf8'));
    if(prior.result==='PASS')return {...prior,reused:true};
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const token='merchant-console-native-receiving-'+sha(directory).slice(0,40);
  const {chromium}=createRequire(import.meta.url)(required(playwrightModule,'--playwright-module'));
  const stages=[],calls=[],screenshots=[],browserErrors=[],customerFiles=[];
  const report={schema:'stellar-forge.merchant-operator-console-native-receiving.v1',
    operationId:'ASTRA-EE290-MERCHANT-OPERATOR-CONSOLE-20261012',sourceCommit,
    startedAt:new Date().toISOString(),node:process.version,stages,calls,screenshots,
    browserErrors,customerFiles,sourceInputs:[],result:'RUNNING'};
  let merchant,browser,page,instanceId,profile,consoleDirectory=join(directory,'console'),importedMerchant;
  const emit=async(stage,extra={})=>{
    stages.push({stage,completedAt:new Date().toISOString(),...extra});
    await writeFile(join(directory,'console-receiving-checkpoint.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
    process.stdout.write(JSON.stringify({stage,...extra})+'\n');
  };
  const open=async(configPath,selectedConsole=consoleDirectory)=>{
    const opened=await openSession({configPath,port:0,environment:{...process.env,MCP_ACCESS_TOKEN:token},consoleDirectory:selectedConsole});
    assert.ok(opened.consoleUrl.endsWith('/operator/'));
    return opened;
  };
  const api=async(path,{method='GET',body,expected=200,host=merchant,raw=false}={})=>{
    const response=await fetch(host.url+'/operator/api/'+path,{method,headers:{authorization:'Bearer '+token,
      ...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const bytes=Buffer.from(await response.arrayBuffer());
    assert.equal(response.status,expected,bytes.toString('utf8'));
    return raw?{bytes,headers:response.headers}:JSON.parse(bytes.toString('utf8'));
  };
  const observedResponse=async(path,fn,method='POST')=>{
    const waiting=page.waitForResponse(response=>new URL(response.url()).pathname==='/operator/api/'+path&&response.request().method()===method);
    await fn();const response=await waiting;
    const packet=await response.json();
    assert.ok(response.ok(),JSON.stringify(packet));
    return packet;
  };
  const connect=async(url)=>{
    await page.goto(url,{waitUntil:'networkidle'});
    await page.locator('#access-token').fill(token);
    await observedResponse('host',()=>page.locator('#connect-form button[type=submit]').click(),'GET');
    await page.locator('#connected').waitFor({state:'visible'});
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
  };
  const choose=async(tool,args,name)=>{
    await page.locator('[data-page=tools]').click();
    await page.locator('#tool-search').fill(tool);
    await observedResponse('tools',()=>page.locator('#tool-filter button[type=submit]').click(),'GET');
    const button=page.locator('#tool-list button').filter({has:page.locator('strong',{hasText:tool})});
    await button.first().click();
    await page.locator('#tool-detail').waitFor({state:'visible'});
    assert.equal(await page.locator('#tool-title').textContent(),tool);
    await page.locator('#draft-name').fill(name??tool);
    await page.locator('#native-arguments').fill(JSON.stringify(args,null,2));
    const saved=await observedResponse('drafts',()=>page.locator('#draft-form button[type=submit]').click());
    assert.equal(saved.draft.tool,tool);
    assert.deepEqual(JSON.parse(saved.draft.argumentsJson),args);
    return saved.draft;
  };
  const waitCall=async(id)=>{
    const deadline=Date.now()+90000;
    while(Date.now()<deadline){
      const value=await api('call/'+encodeURIComponent(id));
      if(value.state!=='RUNNING')return value;
      await sleep(60);
    }
    throw new Error('Original console call is still running: '+id);
  };
  const run=async(tool,args,name)=>{
    const draft=await choose(tool,args,name);
    const accepted=await observedResponse('calls',()=>page.locator('#run-draft').click());
    const retained=await waitCall(accepted.call.id);
    assert.equal(retained.state,'COMPLETE',JSON.stringify(retained));
    assert.equal(sha(retained.resultJson),retained.resultSha256);
    const result=JSON.parse(retained.resultJson);
    const download=await api('result/'+encodeURIComponent(retained.id),{raw:true});
    assert.equal(download.bytes.toString(),retained.resultJson);
    assert.equal(download.headers.get('x-content-sha256'),retained.resultSha256);
    calls.push({id:retained.id,tool,draftId:draft.id,draftRevision:draft.revision,
      argumentsSha256:retained.argumentsSha256,resultSha256:retained.resultSha256,result});
    await page.locator('#refresh-requests').click();
    return {draft,accepted,retained,result};
  };
  const screenshot=async(name,viewport)=>{
    if(viewport)await page.setViewportSize(viewport);
    const path=join(directory,name);
    await page.screenshot({path,fullPage:true,animations:'disabled'});
    const bytes=await readFile(path);screenshots.push({name,bytes:bytes.length,sha256:sha(bytes)});
  };
  try{
    for(const name of ['openapi.example.json','service-selections.example.json','service-bindings.example.json']){
      const bytes=await readFile(sourceFile(name));
      report.sourceInputs.push({name,bytes:bytes.length,sha256:sha(bytes)});
    }
    const initialized=await initializeMerchant({directory:join(directory,'merchant'),name:'Native operator receiving',
      spec:sourceFile('openapi.example.json'),selections:sourceFile('service-selections.example.json'),
      bindings:sourceFile('service-bindings.example.json'),runtime:{port:0}});
    report.configuration=initialized.configuration;
    merchant=await open(initialized.configuration);
    const initial=await api('host');
    assert.ok(initial.capabilities.tools>=30);
    assert.equal(initial.operator.activeCalls,0);
    assert.ok(initial.providers.every(value=>value.state==='UNLOADED'),JSON.stringify(initial.providers));
    report.coldHost=initial;
    const denied=await fetch(merchant.url+'/operator/api/host');assert.equal(denied.status,401);
    const cross=await fetch(merchant.url+'/operator/api/host',{headers:{authorization:'Bearer '+token,origin:'https://other.example'}});
    assert.equal(cross.status,403);
    browser=await chromium.launch({headless:true,executablePath:required(chromiumPath,'--chromium'),args:['--no-sandbox','--disable-dev-shm-usage']});
    page=await browser.newPage({viewport:{width:1440,height:1080},acceptDownloads:true});
    page.setDefaultTimeout(15000);
    page.on('pageerror',error=>browserErrors.push(error.message));
    await connect(merchant.consoleUrl);
    await page.locator('#new-profile').click();
    await page.locator('#profile-name').fill('Native customer operations');
    profile=(await observedResponse('profiles',()=>page.locator('#profile-form button[type=submit]').click())).profile;
    assert.equal(profile.hostFingerprint,initial.configurationFingerprint);
    await screenshot('console-host-desktop.png');
    await emit('same-host authorization, pure capabilities and browser profile',{configuredTools:initial.capabilities.tools});

    const described=await run('merchant_sources',{source:'initial'},'Review original merchant source');
    assert.equal(described.result.routes[0].accepts[0].amount,'20000');
    await page.locator('#reopen-draft').click();
    assert.equal(await page.locator('#native-arguments').inputValue(),JSON.stringify({source:'initial'},null,2));
    await page.locator('#draft-name').fill('Review original source — revision two');
    const revised=(await observedResponse('drafts',()=>page.locator('#draft-form button[type=submit]').click())).draft;
    assert.equal(revised.id,described.draft.id);assert.equal(revised.revision,2);
    await api('drafts',{method:'POST',expected:409,body:{id:revised.id,profileId:profile.id,name:'Stale save',
      tool:'merchant_sources',arguments:{source:'initial'},expectedRevision:1}});
    const original=(await api('draft/'+revised.id+'?revision=1')).draft;
    assert.equal(original.name,'Review original merchant source');
    const replay=await api('calls',{method:'POST',expected:202,body:{id:described.retained.id,profileId:profile.id,
      draftId:described.draft.id,draftRevision:1,expectedHostFingerprint:initial.configurationFingerprint}});
    assert.equal(replay.reused,true);assert.equal(replay.call.resultSha256,described.retained.resultSha256);
    await page.locator('#favorite-tool').click();
    const favorite=(await api('profile/'+profile.id)).profile;
    assert.ok(favorite.favorites.includes('merchant_sources'));
    const recovery=await api('recovery/'+described.retained.id);
    assert.ok(recovery.items.some(value=>value.definition.name==='merchant_status'));
    await emit('immutable revisions, revision conflict, retained exact return and same-call replay',{originalCall:described.retained.id});

    const staged=await run('merchant_stage',{source:'initial',id:'console-first'},'Stage original merchant');
    const release=staged.result.release;assert.match(release.digest,/^[a-f0-9]{64}$/);
    await run('merchant_activate',{id:'console-first',expectedDigest:release.digest,expectedGeneration:0,reason:'Reviewed native console receiving'},'Select reviewed merchant');
    const started=await run('merchant_start',{expectedGeneration:1,expectedDigest:release.digest},'Start selected merchant');
    assert.equal(started.result.runtime.state,'RUNNING');instanceId=started.result.operator.instanceId;
    const exported=await run('merchant_client_export',{instanceId,id:'console-native-customer'},'Generate customer from running seller');
    assert.equal(exported.result.files.length,5);assert.equal(exported.result.mode,'CHALLENGE_ONLY');
    const manifest=await run('merchant_client_export_manifest',{exportId:'console-native-customer'},'Review original customer manifest');
    const manifestSha=manifest.result.manifestFile.sha256;
    assert.match(manifestSha,/^[a-f0-9]{64}$/);
    await screenshot('console-native-return-desktop.png');
    await emit('original stage, selection, seller and five-file generated customer',{instanceId,releaseDigest:release.digest,manifestSha256:manifestSha});

    await page.locator('#use-customer').click();
    assert.equal(await page.locator('#customer-export').inputValue(),'console-native-customer');
    assert.equal(await page.locator('#customer-sha').inputValue(),manifestSha);
    const receiving=(await observedResponse('customers',()=>page.locator('#customer-form button[type=submit]').click())).delivery;
    const pause=await api('customer-pause',{method:'POST',body:{id:receiving.id}});
    const deliveryById=async()=> (await api('profile/'+profile.id)).deliveries.find(value=>value.id===receiving.id);
    let delivered=await deliveryById(),pauseDeadline=Date.now()+30000;
    while(delivered.active&&Date.now()<pauseDeadline){await sleep(50);delivered=await deliveryById();}
    report.customerPause={requestedState:pause.delivery.state,returnedState:delivered.state};
    if(delivered.state!=='COMPLETE'){
      assert.equal(delivered.state,'PAUSED',JSON.stringify(delivered));
      await page.locator('#refresh-customers').click();
      await observedResponse('customers',()=>page.locator('#resume-customer').click());
    }
    const deadline=Date.now()+60000;
    while(delivered.state!=='COMPLETE'&&Date.now()<deadline){
      await sleep(80);delivered=await deliveryById();
      if(delivered.state==='FAILED')throw new Error(JSON.stringify(delivered));
    }
    assert.equal(delivered.state,'COMPLETE',JSON.stringify(delivered));
    assert.equal(delivered.files.length,6);
    for(const file of delivered.files){
      const value=await api('customer-file/'+delivered.id+'?file='+encodeURIComponent(file.name),{raw:true});
      assert.equal(value.bytes.length,file.bytes);assert.equal(sha(value.bytes),file.sha256);
      customerFiles.push({name:file.name,bytes:file.bytes,sha256:file.sha256});
    }
    const archive=await api('customer-archive/'+delivered.id,{raw:true});
    const members=tarFiles(archive.bytes);
    for(const file of customerFiles)assert.ok(members.some(value=>value.name.endsWith('/'+file.name)&&value.bytes===file.bytes&&value.sha256===file.sha256),
      'Original archive includes exact '+file.name);
    await writeFile(join(directory,'console-native-customer.tar.gz'),archive.bytes,{mode:0o600});
    report.customer={id:delivered.id,exportId:'console-native-customer',manifestSha256:manifestSha,
      archiveBytes:archive.bytes.length,archiveSha256:sha(archive.bytes),members};
    await page.locator('#refresh-customers').click();
    await page.locator('#customer-list button').first().click();
    await page.locator('#download-customer').waitFor({state:'visible'});
    await screenshot('console-customer-desktop.png');
    await screenshot('console-customer-mobile.png',{width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile viewport has no horizontal page overflow');
    await emit('original customer transfer, checkpoint resume, exact files and native archive',{deliveryId:delivered.id,pause:report.customerPause,files:customerFiles.length});
    await page.setViewportSize({width:1440,height:1080});
    await run('merchant_stop',{instanceId},'Stop owned seller');instanceId=null;
    const beforeClose=await api('host');assert.equal(beforeClose.operator.managesRunningSeller,false);
    const workspaceId=beforeClose.console.workspaceId,oldPort=new URL(merchant.url).port;
    await merchant.close();merchant=null;
    merchant=await open(initialized.configuration);
    const reopened=await api('host');
    assert.equal(reopened.console.workspaceId,workspaceId);
    assert.equal(reopened.configurationFingerprint,initial.configurationFingerprint);
    assert.ok(reopened.providers.every(value=>value.state==='UNLOADED'));
    const reopenedProfile=await api('profile/'+profile.id);
    assert.equal(reopenedProfile.calls.length,calls.length);
    assert.ok(reopenedProfile.calls.every(value=>value.state==='COMPLETE'&&value.receiving==='RETAINED'&&value.custody==='LOCAL'));
    const retainedCustomer=await api('customer-archive/'+delivered.id,{raw:true});
    assert.equal(sha(retainedCustomer.bytes),report.customer.archiveSha256);
    await connect(merchant.consoleUrl);
    await page.locator('#profiles').selectOption(profile.id);
    await page.locator('[data-page=requests]').click();
    await screenshot('console-reopened-requests.png');
    await emit('closed original seller and cold host reopen with retained requests/customer',{workspaceId,oldPort,newPort:new URL(merchant.url).port});

    const exportedProfile=await api('export/'+profile.id,{raw:true}),packet=JSON.parse(exportedProfile.bytes);
    assert.equal(packet.calls.length,calls.length);assert.equal(packet.deliveries.length,1);
    await writeFile(join(directory,'console-profile.json'),exportedProfile.bytes,{mode:0o600});
    await merchant.close();merchant=null;
    importedMerchant=await open(initialized.configuration,join(directory,'imported-console'));
    const imported=await api('import',{host:importedMerchant,method:'POST',body:{archive:packet,expectedContentSha256:packet.contentSha256}});
    const importedProfile=await api('profile/'+profile.id,{host:importedMerchant});
    assert.equal(importedProfile.calls.length,calls.length);
    assert.ok(importedProfile.calls.every(value=>value.custody==='IMPORTED'&&value.state==='COMPLETE'));
    const same=await api('import',{host:importedMerchant,method:'POST',body:{archive:packet,expectedContentSha256:packet.contentSha256}});
    assert.equal(same.reused,true);
    const importedHost=await api('host',{host:importedMerchant});
    assert.ok(importedHost.providers.every(value=>value.state==='UNLOADED'));
    report.profileArchive={bytes:exportedProfile.bytes.length,sha256:sha(exportedProfile.bytes),contentSha256:packet.contentSha256,
      imported,duplicateReused:same.reused};
    await connect(importedMerchant.consoleUrl);
    await page.locator('#profiles').selectOption(profile.id);
    await page.locator('[data-page=requests]').click();
    await screenshot('console-imported-history.png');
    await emit('portable profile import, exact custody and duplicate archive reuse',{calls:packet.calls.length,drafts:packet.drafts.length});
    assert.deepEqual(browserErrors,[]);
    await importedMerchant.close();importedMerchant=null;
    await browser.close();browser=null;
    report.result='PASS';report.completedAt=new Date().toISOString();
    await writeFile(completed,JSON.stringify(report,null,2)+'\n',{mode:0o600});
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
    return report;
  }catch(error){
    report.result='FAILED';report.error={code:error.code??'RECEIVING_FAILED',message:error.message,stack:error.stack};
    await writeFile(join(directory,'console-receiving-checkpoint.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600}).catch(()=>{});
    throw error;
  }finally{
    await Promise.allSettled([merchant?.close(),importedMerchant?.close(),browser?.close()]);
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const flags=new Map();
  for(let index=2;index<process.argv.length;index+=2)flags.set(process.argv[index],process.argv[index+1]);
  receiveConsole({directory:flags.get('--directory'),chromiumPath:flags.get('--chromium')??process.env.STARFORGE_CHROMIUM,
    playwrightModule:flags.get('--playwright-module')??process.env.STARFORGE_PLAYWRIGHT_MODULE,
    sourceCommit:flags.get('--source-commit')})
    .catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
}
