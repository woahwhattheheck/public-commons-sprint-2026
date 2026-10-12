#!/usr/bin/env node
// MIT. Continue the completed original console/customer through a host review.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename, open, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMerchantMcp } from '../serve.mjs';
import { canonical, digest } from '../console/store.mjs';
import { validateHostComposition } from '../host-profile.mjs';

const OPERATION='merchant-operator-host-review-native-ee290-20261012';
const SCHEMA='stellar-forge.merchant-host-review-native-receiving.v1';
const now=()=>new Date().toISOString();
const requireValue=(value,name)=>{if(typeof value!=='string'||!value)throw new TypeError('Supply '+name);return value;};
const sha=value=>createHash('sha256').update(value).digest('hex');
const gitBlob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const paths=[
  'host-profile.mjs','operator.mjs','config.mjs','providers.mjs','provider-registry.mjs','catalog.mjs','serve.mjs',
  'console/store.mjs','console/service.mjs','console/customers.mjs',
  'console/public/app.mjs','console/public/index.html','console/public/style.css','receiving/host-review.mjs'
];
async function packet(path) {
  const bytes=await readFile(path);return {bytes,value:JSON.parse(bytes),sha256:sha(bytes)};
}
async function privateDirectory(path) {
  await mkdir(path,{recursive:true,mode:0o700});
  const info=await lstat(path);
  assert.ok(info.isDirectory()&&!info.isSymbolicLink(),'Use an original real receiving directory.');
  assert.equal(await realpath(path),path,'Use its canonical receiving path.');
  if(process.platform!=='win32'){
    assert.equal(info.mode&0o077,0,'Keep the receiving directory private.');
    if(process.getuid)assert.equal(info.uid,process.getuid(),'Keep the original directory owner.');
  }
}
async function atomicJSON(path,value) {
  const temporary=path+'.writing-'+process.pid;
  const file=await open(temporary,'w',0o600);
  try {await file.writeFile(JSON.stringify(value,null,2)+'\n');await file.sync();}
  finally {await file.close();}
  await rename(temporary,path);
}
function content(packet) {
  const {contentSha256,...body}=packet;
  assert.equal(digest(canonical(body)),contentSha256,'Retained packet content digest.');
  return body;
}
function collections(value) {
  return {drafts:value.drafts,calls:value.calls,deliveries:value.deliveries};
}
function noChanges(value) {return value.added.length+value.removed.length+value.changed.length===0;}

export async function receiveHostReview({consoleReceiving,directory,chromiumPath,playwrightModule,sourceCommit,sourceManifest}={}) {
  const originalDirectory=resolve(requireValue(consoleReceiving,'--console-receiving'));
  directory=resolve(requireValue(directory,'--directory'));
  assert.notEqual(directory,originalDirectory,'Retain the following output in its own directory.');
  assert.match(requireValue(sourceCommit,'--source-commit'),/^[a-f0-9]{40}$/);
  await privateDirectory(directory);
  const original=await packet(join(originalDirectory,'console-native-run.json'));
  assert.equal(original.value.result,'PASS','Continue the completed original native console receiving.');
  const archived=await packet(join(originalDirectory,'console-profile.json'));
  content(archived.value);
  assert.equal(archived.sha256,original.value.profileArchive.sha256,'Original complete profile bytes.');
  assert.equal(archived.value.contentSha256,original.value.profileArchive.contentSha256);
  const originalCustomer=await readFile(join(originalDirectory,'console-native-customer.tar.gz'));
  assert.equal(originalCustomer.length,original.value.customer.archiveBytes);
  assert.equal(sha(originalCustomer),original.value.customer.archiveSha256,'Original populated customer bytes.');
  const configPath=requireValue(original.value.configuration,'the original configuration in the completed report');
  assert.ok(isAbsolute(configPath),'Retain the original absolute configuration identity.');
  const originalConfig=await readFile(configPath),rawConfig=JSON.parse(originalConfig);
  assert.ok(rawConfig.sources?.initial,'Retain the original SF61 source alias.');
  assert.ok(!Object.hasOwn(rawConfig.sources,'reviewed_source'),'Reserve a new review alias alongside the original source.');
  const profileId=archived.value.profile.id,consoleDirectory=join(originalDirectory,'console');
  assert.equal(archived.value.sourceWorkspaceId,original.value.coldHost.console.workspaceId);

  const checkpointPath=join(directory,'host-review-checkpoint.json'),completedPath=join(directory,'host-review-native-run.json');
  const input={directory:originalDirectory,reportSha256:original.sha256,profileSha256:archived.sha256,
    profileContentSha256:archived.value.contentSha256,customerSha256:sha(originalCustomer),
    configurationSha256:sha(originalConfig),profileId,workspaceId:archived.value.sourceWorkspaceId};
  let report;
  try {report=(await packet(completedPath)).value;
    assert.equal(report.schema,SCHEMA);assert.equal(report.operationId,OPERATION);assert.deepEqual(report.input,input);
    if(report.result==='PASS')return {...report,reused:true};
  }catch(error){if(error.code!=='ENOENT')throw error;}
  try {report=(await packet(checkpointPath)).value;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(report) {
    assert.equal(report.schema,SCHEMA);assert.equal(report.operationId,OPERATION);assert.deepEqual(report.input,input);
    if(report.sourceCommit!==sourceCommit){
      report.sourceHistory??=[];report.sourceHistory.push({sourceCommit:report.sourceCommit,continuedAt:now()});
      report.sourceCommit=sourceCommit;
    }
  } else report={schema:SCHEMA,operationId:OPERATION,sourceCommit,input,startedAt:now(),node:process.version,
    sourceHistory:[],stages:[],phases:{},bindingSteps:{},screenshots:[],browserErrors:[],sourceFiles:[]};
  report.attempts??=[];
  report.attempts.push({startedAt:now(),sourceCommit,priorState:report.result??null,
    ...(report.error?{priorError:report.error}:{}),priorBrowserErrors:report.browserErrors??[]});
  report.browserErrors=[];report.result='RUNNING';delete report.error;
  const manifest=sourceManifest?(await packet(resolve(sourceManifest))).value:null;
  const expected=manifest?.manifest??manifest;
  if(expected)assert.equal(expected.commit,sourceCommit,'Use the selected source manifest.');
  const root=new URL('../',import.meta.url);
  report.sourceFiles=[];
  for(const path of paths){
    const bytes=await readFile(new URL(path,root)),repositoryPath='stellar-forge/mcp-merchant-operator/'+path;
    const value={path:repositoryPath,bytes:bytes.length,sha256:sha(bytes),gitBlob:gitBlob(bytes)};
    if(expected){assert.equal(expected.files[repositoryPath],value.gitBlob,'Original source: '+repositoryPath);}
    report.sourceFiles.push(value);
  }
  const persist=()=>atomicJSON(checkpointPath,report);
  const phase=async(name,value={})=>{
    report.phases[name]={completedAt:now(),sourceCommit,...value};report.stages.push({stage:name,...report.phases[name]});
    await persist();process.stdout.write(JSON.stringify({stage:name,...value})+'\n');
  };
  await persist();

  const token='merchant-host-review-'+sha(directory).slice(0,44);
  const {chromium}=createRequire(import.meta.url)(requireValue(playwrightModule,'--playwright-module'));
  let host,importedHost,browser,page;
  const openHost=async(configuration,selectedConsole=consoleDirectory)=>startMerchantMcp({
    configPath:configuration,consoleDirectory:selectedConsole,port:0,environment:{...process.env,MCP_ACCESS_TOKEN:token}
  });
  const api=async(path,{method='GET',body,expectedStatus=200,selected=host,raw=false}={})=>{
    const response=await fetch(selected.url+'/operator/api/'+path,{method,headers:{
      authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})
    },...(body===undefined?{}:{body:JSON.stringify(body)})});
    const bytes=Buffer.from(await response.arrayBuffer());
    assert.equal(response.status,expectedStatus,bytes.toString());
    if(raw)return {bytes,headers:response.headers};
    return JSON.parse(bytes);
  };
  const profile=()=>api('profile/'+encodeURIComponent(profileId));
  const observe=async(path,action,method='POST')=>{
    const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/operator/api/'+path&&response.request().method()===method);
    await action();const response=await pending,value=await response.json();
    assert.ok(response.ok(),JSON.stringify(value));return value;
  };
  const connect=async(selected=host)=>{
    await page.goto(selected.consoleUrl,{waitUntil:'networkidle'});
    await page.locator('#access-token').fill(token);
    await observe('profiles',()=>page.locator('#connect-form button[type=submit]').click(),'GET');
    await page.locator('#connected').waitFor({state:'visible'});
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
    if(await page.locator('#profiles').inputValue()!==profileId)
      await observe('profile/'+encodeURIComponent(profileId),()=>page.locator('#profiles').selectOption(profileId),'GET');
    await page.locator('#review-host').waitFor({state:'visible'});
  };
  const compare=async(revision=null)=>{
    if(revision!==null){
      await observe('host-review/'+encodeURIComponent(profileId),()=>page.locator('#review-binding').selectOption(String(revision)),'GET');
    }else await observe('host-review/'+encodeURIComponent(profileId),()=>page.locator('#review-host').click(),'GET');
    await page.locator('#host-review-content').waitFor({state:'visible'});
    return api('host-review/'+encodeURIComponent(profileId)+(revision===null?'':'?revision='+revision));
  };
  const screenshot=async(name,viewport)=>{
    if(viewport)await page.setViewportSize(viewport);
    const path=join(directory,name);
    await page.screenshot({path,fullPage:true,animations:'disabled'});
    const bytes=await readFile(path),value={name,bytes:bytes.length,sha256:sha(bytes)};
    report.screenshots=report.screenshots.filter(item=>item.name!==name).concat(value);
  };
  const downloadReview=async(name)=>{
    const pending=page.waitForEvent('download');
    await page.locator('#export-host-review').click();
    const download=await pending,path=join(directory,name);await download.saveAs(path);
    const saved=await packet(path);content(saved.value);
    return {name,bytes:saved.bytes.length,sha256:saved.sha256,contentSha256:saved.value.contentSha256,
      state:saved.value.state,complete:saved.value.complete};
  };
  const sameOriginalWork=async()=>{
    const returned=await api('export/'+encodeURIComponent(profileId),{raw:true}),value=JSON.parse(returned.bytes);
    content(value);
    assert.equal(value.sourceWorkspaceId,input.workspaceId);
    assert.deepEqual(collections(value),collections(archived.value),'Every original draft, call and customer record remains exact.');
    return {bytes:returned.bytes,value};
  };
  const bindStep=async(name)=>{
    let current=await profile(),snapshot=await api('host'),step=report.bindingSteps[name];
    validateHostComposition(snapshot.composition,digest);
    if(!step) {
      step={intent:{id:profileId,expectedRevision:current.profile.revision,
        expectedHostFingerprint:snapshot.configurationFingerprint,
        expectedCompositionFingerprint:snapshot.composition.fingerprint},
        beforeBindings:current.bindings,recordedAt:now(),sourceCommit};
      report.bindingSteps[name]=step;await persist();
    }
    const intent=step.intent;
    assert.equal(snapshot.configurationFingerprint,intent.expectedHostFingerprint,'Retain the exact reviewed target configuration.');
    assert.equal(snapshot.composition.fingerprint,intent.expectedCompositionFingerprint,'Retain the exact reviewed target composition.');
    if(current.profile.revision===intent.expectedRevision) {
      assert.deepEqual(current.bindings,step.beforeBindings,'The original history is unchanged before its reserved rebind.');
      const returned=await observe('bind',()=>page.locator('#adopt-host-snapshot').click());
      assert.equal(returned.profile.revision,intent.expectedRevision+1);
      current=await profile();
    }else{
      assert.equal(current.profile.revision,intent.expectedRevision+1,'Reconcile this exact original rebind before another profile edit.');
      assert.equal(current.profile.bindingRevision,intent.expectedRevision+1);
      assert.equal(current.profile.hostFingerprint,intent.expectedHostFingerprint);
      assert.equal(current.profile.host.composition.fingerprint,intent.expectedCompositionFingerprint);
      step.reused=true;
    }
    const retained=(await api('host-binding/'+encodeURIComponent(profileId)+'?revision='+current.profile.bindingRevision)).binding;
    const {bindingSha256,...binding}=retained;
    assert.equal(digest(canonical(binding)),bindingSha256);
    assert.deepEqual(retained.host,current.profile.host);
    assert.equal(retained.origin,'PROFILE_BOUND');
    const count=step.beforeBindings.length?step.beforeBindings.length+1:2;
    assert.equal(current.bindings.length,count,'Each original bind retains exactly one new revision and a legacy baseline when needed.');
    const stale=await api('bind',{method:'POST',body:intent,expectedStatus:409});
    assert.equal(stale.error.code,'CONSOLE_REVISION_CONFLICT');
    assert.equal((await profile()).bindings.length,count);
    step.binding={revision:retained.revision,bindingSha256,configurationFingerprint:retained.hostFingerprint,
      compositionFingerprint:retained.host.composition.fingerprint};
    await phase(name,{revision:retained.revision,retainedBindings:count,reused:Boolean(step.reused)});
    return current;
  };
  const inspectQuiet=async()=>{
    const value=await api('host');
    assert.equal(value.console.workspaceId,input.workspaceId);
    assert.equal(value.operator.activeCalls,0);
    assert.equal(value.operator.managesRunningSeller,false);
    assert.ok(value.providers.every(provider=>provider.state==='UNLOADED'),'Host metadata leaves original provider runtimes unopened.');
    return value;
  };

  try {
    browser=await chromium.launch({headless:true,executablePath:requireValue(chromiumPath,'--chromium'),
      args:['--no-sandbox','--disable-dev-shm-usage']});
    page=await browser.newPage({viewport:{width:1440,height:1080},acceptDownloads:true});
    page.setDefaultTimeout(20000);
    page.on('pageerror',error=>report.browserErrors.push({at:now(),message:error.message}));
    if(!report.phases.baseReviewed) {
      host=await openHost(configPath);await inspectQuiet();await connect();
      const before=await profile();
      if(!report.bindingSteps.baseBinding){
        const untouched=await sameOriginalWork();
        assert.equal(untouched.value.contentSha256,archived.value.contentSha256,'Upgrade opens the saved original profile unchanged.');
        report.originalBindingWasLegacy=!before.profile.host.composition;
      }
      if(!report.bindingSteps.baseBinding){
        const review=await compare();content(review);
        if(report.originalBindingWasLegacy){
          assert.equal(review.complete,false);
          assert.equal(review.tools.coverage,'TOOL_SNAPSHOT_UNAVAILABLE');
        }
        report.originalComparison=await downloadReview('host-review-original.json');
      }
      if(!report.phases.baseBinding)await bindStep('baseBinding');
      const current=await compare();assert.equal(current.state,'UNCHANGED');assert.equal(current.complete,true);
      const bound=await profile();
      if(report.originalBindingWasLegacy){
        const legacy=bound.bindings.find(value=>value.origin==='LEGACY_PROFILE');
        assert.ok(legacy,'The actual legacy host is retained.');
        const originalBinding=(await api('host-binding/'+profileId+'?revision='+legacy.revision)).binding;
        assert.deepEqual(originalBinding.host,archived.value.profile.host);
        report.legacyBinding={revision:legacy.revision,bindingSha256:legacy.bindingSha256};
      }
      await sameOriginalWork();await inspectQuiet();
      await phase('baseReviewed',{bindingRevision:bound.profile.bindingRevision,retainedBindings:bound.bindings.length,
        legacyRetained:Boolean(report.legacyBinding)});
      await host.close();host=null;
    }

    const changedConfig={...rawConfig,name:rawConfig.name+' / reviewed source',
      sources:{...rawConfig.sources,reviewed_source:{...rawConfig.sources.initial,label:'Reviewed alias for the original SF61 source'}}};
    const changedPath=join(dirname(configPath),'merchant-host-review.json'),changedBytes=Buffer.from(JSON.stringify(changedConfig,null,2)+'\n');
    try {await writeFile(changedPath,changedBytes,{flag:'wx',mode:0o600});}
    catch(error){if(error.code!=='EEXIST')throw error;assert.equal(sha(await readFile(changedPath)),sha(changedBytes),'Reuse this exact original configuration copy.');}
    assert.equal(sha(await readFile(configPath)),input.configurationSha256,'Original configuration bytes remain exact.');
    report.reviewedConfiguration={path:changedPath,sha256:sha(changedBytes),sourceAlias:'reviewed_source'};
    await persist();
    host=await openHost(changedPath);const changedHost=await inspectQuiet();await connect();
    const baseRevision=report.bindingSteps.baseBinding.binding.revision;
    const changedReview=await compare(baseRevision);content(changedReview);
    assert.equal(changedReview.complete,true);assert.equal(changedReview.state,'CHANGED');
    assert.equal(changedReview.configurationChanged,true);
    assert.ok(noChanges(changedReview.tools));assert.ok(noChanges(changedReview.providers));
    assert.equal(changedReview.requestCapacity.changed,false);
    assert.deepEqual(changedReview.sourceBindings.added.map(value=>value.source),['reviewed_source']);
    assert.ok(noChanges({...changedReview.sourceBindings,added:[]}));
    if(!report.phases.changedReview){
      report.changedComparison=await downloadReview('host-review-changed.json');
      await page.locator('#review-category').selectOption('Sources');
      await page.locator('#review-filter button[type=submit]').click();
      assert.equal(await page.locator('#review-changes tr').count(),1);
      assert.ok((await page.locator('#review-changes').textContent()).includes('reviewed_source'));
      await screenshot('host-review-change-desktop.png');
      await screenshot('host-review-change-mobile.png',{width:390,height:844});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'The host review fits the mobile viewport.');
      await page.setViewportSize({width:1440,height:1080});
      await page.locator('#review-category').selectOption('');
      await page.locator('#review-filter button[type=submit]').click();
      await phase('changedReview',{originalBindingRevision:baseRevision,
        configurationFingerprint:changedHost.configurationFingerprint,compositionFingerprint:changedHost.composition.fingerprint,
        addedSource:'reviewed_source'});
    }
    if(!report.phases.changedBinding)await bindStep('changedBinding');
    const liveProfile=await profile();
    assert.equal(liveProfile.profile.hostFingerprint,changedHost.configurationFingerprint);
    assert.equal(liveProfile.profile.host.composition.fingerprint,changedHost.composition.fingerprint);
    await connect();const matching=await compare();
    assert.equal(matching.state,'UNCHANGED');assert.equal(matching.complete,true);
    if(!await page.locator('#binding-history-count').evaluate(element=>element.parentElement.open))
      await page.locator('#binding-history-count').click();
    assert.equal(await page.locator('#binding-history tr').count(),liveProfile.bindings.length);
    await screenshot('host-review-retained-bindings.png');
    const exported=await sameOriginalWork();
    assert.deepEqual(exported.value.bindings.map(value=>value.bindingSha256),liveProfile.bindings.map(value=>value.bindingSha256));
    await writeFile(join(directory,'host-review-profile.json'),exported.bytes,{mode:0o600});
    report.profileArchive={name:'host-review-profile.json',bytes:exported.bytes.length,sha256:sha(exported.bytes),
      contentSha256:exported.value.contentSha256,bindingCount:exported.value.bindings.length};
    if(!report.phases.originalCustomer){
      const customer=await api('customer-archive/'+original.value.customer.id,{raw:true});
      assert.equal(customer.bytes.length,originalCustomer.length);assert.equal(sha(customer.bytes),input.customerSha256);
      await writeFile(join(directory,'host-review-customer.tar.gz'),customer.bytes,{mode:0o600});
      await phase('originalCustomer',{id:original.value.customer.id,exportId:original.value.customer.exportId,
        bytes:customer.bytes.length,sha256:sha(customer.bytes)});
    }else assert.equal(sha(await readFile(join(directory,'host-review-customer.tar.gz'))),input.customerSha256);
    await host.close();host=null;

    host=await openHost(changedPath);const reopenedHost=await inspectQuiet();
    const reopened=await profile();
    assert.deepEqual(reopened.bindings,liveProfile.bindings);
    const reopenedExport=await sameOriginalWork();assert.deepEqual(reopenedExport.value.bindings,exported.value.bindings);
    const reopenedComparison=await api('host-review/'+profileId);
    assert.equal(reopenedComparison.state,'UNCHANGED');assert.equal(reopenedComparison.complete,true);
    for(const binding of reopened.bindings){
      const value=(await api('host-binding/'+profileId+'?revision='+binding.revision)).binding;
      assert.equal(value.bindingSha256,binding.bindingSha256);
    }
    await phase('coldReopen',{workspaceId:reopenedHost.console.workspaceId,bindings:reopened.bindings.length,
      calls:reopened.calls.length,drafts:exported.value.drafts.length,customers:reopened.deliveries.length});
    await host.close();host=null;

    importedHost=await openHost(changedPath,join(directory,'imported-console'));
    const imported=await api('import',{selected:importedHost,method:'POST',
      body:{archive:exported.value,expectedContentSha256:exported.value.contentSha256}});
    const duplicate=await api('import',{selected:importedHost,method:'POST',
      body:{archive:exported.value,expectedContentSha256:exported.value.contentSha256}});
    assert.equal(duplicate.reused,true);
    const importedView=await api('profile/'+profileId,{selected:importedHost});
    assert.deepEqual(importedView.bindings,reopened.bindings);
    assert.ok(importedView.calls.every(value=>value.custody==='IMPORTED'&&value.state==='COMPLETE'));
    const importedArchive=await api('export/'+profileId,{selected:importedHost,raw:true}),importedPacket=JSON.parse(importedArchive.bytes);
    content(importedPacket);assert.deepEqual(collections(importedPacket),collections(archived.value));
    assert.deepEqual(importedPacket.bindings,exported.value.bindings);
    assert.deepEqual(importedPacket.profile,exported.value.profile);
    const importedComparison=await api('host-review/'+profileId,{selected:importedHost});
    assert.equal(importedComparison.state,'UNCHANGED');
    await connect(importedHost);
    await observe('host-review/'+profileId,()=>page.locator('#review-host').click(),'GET');
    if(!await page.locator('#binding-history-count').evaluate(element=>element.parentElement.open))
      await page.locator('#binding-history-count').click();
    await screenshot('host-review-imported-bindings.png');
    assert.equal(await page.locator('#binding-history tr').count(),reopened.bindings.length);
    report.imported={workspaceId:(await api('host',{selected:importedHost})).console.workspaceId,
      reused:imported.reused,duplicateReused:duplicate.reused,bindingDigests:importedView.bindings.map(value=>value.bindingSha256)};
    await phase('portableHistory',{bindings:importedView.bindings.length,calls:importedView.calls.length,
      customers:importedView.deliveries.length,duplicateReused:true});
    await importedHost.close();importedHost=null;await browser.close();browser=null;
    assert.deepEqual(report.browserErrors,[]);
    report.originalNativeWork={callIds:archived.value.calls.map(value=>value.id),
      draftRevisions:archived.value.drafts.map(value=>({id:value.id,revision:value.revision})),
      customerIds:archived.value.deliveries.map(value=>value.id)};
    report.result='PASS';report.completedAt=now();await persist();await atomicJSON(completedPath,report);
    process.stdout.write(JSON.stringify(report,null,2)+'\n');return report;
  }catch(error){
    report.result='FAILED';report.error={code:error.code??'HOST_REVIEW_RECEIVING_FAILED',message:error.message,stack:error.stack};
    await persist().catch(()=>{});throw error;
  }finally{
    await Promise.allSettled([host?.close(),importedHost?.close(),browser?.close()]);
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=new Map();
  for(let index=2;index<process.argv.length;index+=2)args.set(process.argv[index],process.argv[index+1]);
  receiveHostReview({consoleReceiving:args.get('--console-receiving'),directory:args.get('--directory'),
    chromiumPath:args.get('--chromium')??process.env.STARFORGE_CHROMIUM,
    playwrightModule:args.get('--playwright-module')??process.env.STARFORGE_PLAYWRIGHT_MODULE,
    sourceCommit:args.get('--source-commit'),sourceManifest:args.get('--source-manifest')})
    .catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
}
