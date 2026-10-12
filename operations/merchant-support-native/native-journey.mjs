// Native managed Merchant support installation, original incidents, case receiving and lifecycle.
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const selected=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const sourceRoot=join(selected.sourceRoot,'stellar/scf-starforge-20261009');
const original=async p=>import(pathToFileURL(join(sourceRoot,p)).href);
const {startSellerService}=await original('sf30-seller-sdk/serve.mjs');
const {observeSellerTraffic,trafficPrometheus}=await original('sf30-seller-sdk/operations/traffic.mjs');
const {initializeIncidentStore,openIncidentStore}=await original('sf93-seller-support-bundle/incident-store.mjs');
const {CONFIG_SCHEMA}=await original('sf93-seller-support-bundle/incident-config.mjs');
const {importRuntimeHandoff}=await original('sf74-merchant-support-console/runtime-support.mjs');
const {createRuntimeWorkspace,openRuntimeWorkspace}=await original('distribution/runtime-workspace/model.mjs');
const {startRuntimeWorkspace}=await original('distribution/runtime-workspace/server.mjs');
const require=createRequire(import.meta.url);
const playwright=selected.playwright?require(selected.playwright):require(require.resolve('playwright',{
  paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,selected.nodeModules,process.cwd()].filter(Boolean)}));
const {chromium}=playwright;
let previous;
try{previous=JSON.parse(await fs.readFile(join(selected.stage,'native-result.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const resumeGrant=!!(selected.grantReceiving&&previous?.savedSupportDirectory&&previous?.handoff&&previous?.caseId&&previous?.incidentId);
const root=join(selected.work,(resumeGrant?'grant-resume-':'customer-')+randomUUID());
await fs.mkdir(root,{mode:0o700});
const liveRoot=join(selected.stage,'native-live',root.slice(root.lastIndexOf('/')+1));
await fs.mkdir(liveRoot,{recursive:true,mode:0o700});
const workspace=join(root,'managed-workspace');
const report=resumeGrant?{...previous,status:'RUNNING',resumedAt:new Date().toISOString(),currentSourcePin:selected.sourceCommit}:
  {schema:'stellar-forge.merchant-support-applications-operation.v1',sourcePin:selected.sourceCommit,status:'RUNNING',
    startedAt:new Date().toISOString(),stages:[],browserErrors:[],receiving:[]};
if(resumeGrant){
  assert.equal(report.schema,'stellar-forge.merchant-support-applications-operation.v1');
  if(previous.currentSourcePin!==selected.sourceCommit&&previous.sourcePin!==selected.sourceCommit)
    report.sourceRevisions=[...(previous.sourceRevisions||[]),{sourcePin:selected.sourceCommit,at:report.resumedAt}];
  delete report.error;delete report.cleanupError;
}
const save=async()=>{const path=join(selected.stage,'native-result.json'),temporary=path+'.saving-'+randomUUID();
  await fs.writeFile(temporary,JSON.stringify(report,null,2)+'\n',{mode:0o600});await fs.rename(temporary,path);};
const note=async(stage,detail={})=>{report.stages.push({stage,at:new Date().toISOString(),...detail});await save();console.log(JSON.stringify({stage,...detail}));};
const wait=async(fn,label,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,150));}throw Error('Timed out: '+label);};
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const listen=async server=>{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return 'http://127.0.0.1:'+server.address().port;};
const closeServer=async server=>{if(!server?.listening)return;await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});};
let seller,observer,ops,receiver,browser,context,page,supportPage,stateStore,model,host,applicationId;
let receiverStatus=503,closing=false;
const app=async()=>(await model.applicationsState()).applications.find(x=>x.id===applicationId);
async function selectApplication() {
  await page.locator('[data-view="applications"]').click();
  await page.locator('[data-application-id="'+applicationId+'"]').click();
}
async function openHost() {
  host=await startRuntimeWorkspace({directory:workspace,port:0});
  await page.goto(host.url);
  await page.locator('[data-view="applications"]').click();
}
async function startApplication() {
  const before=await app();
  await selectApplication();
  await page.getByRole('button',{name:'Review start',exact:true}).click();
  // The original UI renders its accepted review before enabling start.
  await page.getByRole('button',{name:'Start reviewed application',exact:true}).waitFor();
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/applications/start'));
  await page.getByRole('button',{name:'Start reviewed application',exact:true}).click();
  const accepted=await response;assert.equal(accepted.status(),200,await accepted.text());
  return wait(async()=>{const value=await app();if(value.current?.id===before.current?.id)return false;
    if(value.current?.phase==='FAILED'||value.phase==='FAILED')throw Error('Original application start failed: '+JSON.stringify(value.current?.result??value));
    return value.current?.active&&value.current.privateUrl?value:false;},'original managed support listener',90000);
}
async function openSupport(current) {
  await selectApplication();
  const popup=context.waitForEvent('page');
  await page.getByRole('link',{name:'Open application',exact:true}).click();
  supportPage=await popup;supportPage.on('pageerror',error=>report.browserErrors.push(error.message));
  await supportPage.waitForLoadState('domcontentloaded');
  await supportPage.locator('#incident-source').waitFor({state:'visible'});
  const operation=join(workspace,'operations',current.current.id);
  const launch=await read(join(operation,'application-url.json'));
  const request=await read(join(operation,'request.json'));
  const command=await read(join(operation,'command-launch.json'));
  assert.equal(launch.url,current.current.privateUrl);
  assert.equal(launch.original.schema,'stellar-forge.support-console-launch.v1');
  assert.ok(request.releaseDirectory&&!request.releaseDirectory.startsWith(selected.runtime+'/package/source'));
  assert.ok(command.args.includes(join(request.releaseDirectory,'forge.mjs')));
  const listener=await fetch(new URL('/api/support-launch',current.current.privateUrl),{signal:AbortSignal.timeout(7000)});
  assert.equal(listener.status,200);
  const identity=await listener.json();
  assert.equal(identity.instanceId,launch.original.instanceId);
  assert.equal(identity.selectionSha256,launch.original.selectionSha256);
  assert.equal(identity.pid,launch.original.pid);
  return {url:current.current.privateUrl,launch:launch.original,operationId:current.current.id,
    api:async(path,body)=>{const r=await fetch(new URL(path,current.current.privateUrl),{method:body?'POST':'GET',
      headers:body?{Origin:new URL(current.current.privateUrl).origin,'content-type':'application/json'}:{},
      body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(7000)});return{status:r.status,body:await r.json()};}};
}
async function stopApplication(browserAction=true) {
  const current=await app();if(!current?.current?.active)return current;
  if(browserAction) {
    await selectApplication();
    const stopping=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/applications/stop'));
    await page.getByRole('button',{name:'Stop application',exact:true}).click();
    const response=await stopping;assert.equal(response.status(),200,await response.text());
  } else await model.applicationsStop({applicationId,operationId:current.current.id});
  return wait(async()=>{const value=await app();return value&&!value.current.active&&
    !['PENDING','QUEUED','RUNNING'].includes(value.current.phase)?value:false;},'managed support drain',45000);
}
async function openBrowser(){
  const chromeRoot=join(root,'chrome');await fs.mkdir(chromeRoot,{mode:0o700});
  browser=await chromium.launch({executablePath:selected.browser,headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--in-process-gpu','--no-zygote','--single-process','--renderer-process-limit=1','--js-flags=--max-old-space-size=128'],
    env:{...process.env,TMPDIR:chromeRoot},downloadsPath:join(chromeRoot,'downloads')});
  context=await browser.newContext({viewport:{width:1440,height:1024}});context.setDefaultTimeout(30000);
}
async function closeAll() {
  if(closing)return;closing=true;
  try {if(applicationId&&model)await stopApplication(false);}catch(error){report.cleanupError=error.message;}
  await browser?.close().catch(()=>{});
  await host?.close().catch(()=>{});
  await model?.close().catch(()=>{});
  observer?.detach();
  await closeServer(ops);await closeServer(receiver);await seller?.close().catch(()=>{});
}
const watchdog=setTimeout(()=>{report.error='Native managed journey deadline reached';report.status='FAILED';
  closeAll().finally(()=>save()).finally(()=>process.exit(2));},360000);
try {
  if(resumeGrant){
    const raw=await fs.readFile(report.handoff.path);
    assert.equal(raw.length,report.handoff.bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),report.handoff.sha256);
    assert.equal((await fs.stat(report.savedSupportDirectory)).isDirectory(),true);
    await openBrowser();page=await context.newPage();
    const {receiveGrantSupport}=await import(pathToFileURL(join(selected.stage,'grant-receiving.mjs')).href);
    report.grantReceiving=await receiveGrantSupport({selected,context,handoffPath:report.handoff.path,
      merchantCaseId:report.caseId,incidentId:report.incidentId,note});
    report.status='COMPLETE';report.completedAt=new Date().toISOString();
    await note('continued the same saved Support handoff and original grant case through receiving',
      {caseId:report.caseId,incidentId:report.incidentId,handoffSha256:report.handoff.sha256});
  }else{
  const config=JSON.parse(await fs.readFile(join(sourceRoot,'sf30-seller-sdk/examples/service.json'),'utf8'));
  seller=await startSellerService({config,port:0,drainGraceMs:1000});
  observer=observeSellerTraffic(seller);
  ops=createServer((req,res)=>{const snapshot=observer.snapshot();
    if(req.url==='/api/snapshot'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(snapshot));}
    else if(req.url==='/metrics'){res.writeHead(200,{'content-type':'text/plain'});res.end(trafficPrometheus(snapshot));}
    else{res.writeHead(404);res.end();}});
  const opsURL=await listen(ops);
  receiver=createServer(async(req,res)=>{let bytes='';for await(const chunk of req)bytes+=chunk;
    report.receiving.push({status:receiverStatus,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:Buffer.byteLength(bytes)});
    res.writeHead(receiverStatus);res.end();});
  const receiverURL=await listen(receiver);
  const statePath=join(liveRoot,'state'),casePath=join(liveRoot,'cases'),configPath=join(liveRoot,'sources.json'),environmentPath=join(liveRoot,'environment.json');
  report.liveDirectory=liveRoot;report.scratchDirectory=root;report.managedWorkspace=workspace;await save();
  await initializeIncidentStore({directory:statePath,config:{schema:CONFIG_SCHEMA,pollMs:250,failurePolls:1,recoveryPolls:1,windowMinutes:1,captureEveryMs:1000,
    merchants:[{id:'native-merchant',label:'Native merchant',seller:seller.url,ops:opsURL}],
    notification:{id:'receiving',urlEnv:'SF74_RECEIVING_URL',secretEnv:'SF74_RECEIVING_SECRET',allowLoopback:true,
      timeoutMs:1000,maxAttempts:1,retryMs:100,maxRetryMs:1000}}});
  stateStore=await openIncidentStore(statePath);
  await fs.writeFile(configPath,JSON.stringify({schema:'stellar-forge.support-incident-sources.v1',
    sources:[{id:'native',label:'Native merchant source',directory:statePath}]}),{mode:0o600});
  await fs.writeFile(environmentPath,JSON.stringify({SF74_RECEIVING_URL:receiverURL,SF74_RECEIVING_SECRET:'local-native-receiver-secret-24ead3'}),{mode:0o600});
  await createRuntimeWorkspace({directory:workspace});model=await openRuntimeWorkspace({directory:workspace});
  const attached=await model.attach({directory:selected.runtime,label:'Native merchant support runtime'});
  await openBrowser();
  page=await context.newPage();page.on('pageerror',error=>report.browserErrors.push(error.message));
  await openHost();
  await page.getByRole('button',{name:'New application',exact:true}).click();
  await page.locator('#application-label').fill('Merchant incident operations');
  await page.locator('#application-runtime').selectOption(attached.runtimeId);
  await page.locator('#application-kind').selectOption('merchant-support');
  for(const[name,value]of Object.entries({workspaceDirectory:casePath,incidentSources:configPath,environmentFile:environmentPath,port:'0'}))
    await page.locator('#application-setting-'+name).fill(value);
  await page.locator('#application-setting-allowLoopback').check();
  await page.getByRole('button',{name:'Review application',exact:true}).click();
  const saving=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/applications/save'));
  await page.getByRole('button',{name:'Save application',exact:true}).click();
  const saveResponse=await saving;const saved=await saveResponse.json();assert.equal(saveResponse.status(),200,JSON.stringify(saved));
  assert.ok(saved.applicationId);applicationId=saved.applicationId;
  await wait(async()=>{const value=await app();if(value.adoption?.phase==='FAILED')throw Error('Original runtime adoption failed: '+JSON.stringify(value.adoption));
    return value.release?value:false;},'original runtime adoption',90000);
  await note('original Applications reviewed and saved support source',{applicationId,runtimeId:attached.runtimeId});
  const first=await startApplication();const opened=await openSupport(first);
  await note('verified adopted native support listener',{operationId:first.current.id,instanceId:opened.launch.instanceId,selectionSha256:opened.launch.selectionSha256});
  for(const[name,value]of Object.entries({resource:'https://merchant.example/dataset',catalog:'https://facilitator.example/discovery/resources',
    origin:'https://buyer.example',payTo:config.routes[0].definition.payment.payTo}))
    await supportPage.locator('#intake-form [name="'+name+'"]').fill(value);
  await supportPage.locator('#case-name').fill('Managed native incident receiving');
  await supportPage.locator('#case-merchant').fill('Native merchant');
  await supportPage.locator('#case-owner').fill('SF74 managed operator');
  const seedResponse=supportPage.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/cases'));
  await supportPage.locator('#case-save').click();assert.equal((await seedResponse).status(),200);
  await supportPage.locator('#incident-worker-start').click();
  await wait(async()=>{const s=await stateStore.read();return s.merchants['native-merchant'].lastCapture;},'first original capture',18000);
  const challenge=await fetch(seller.url+'/dataset');assert.equal(challenge.status,402);await challenge.arrayBuffer();
  observer.detach();
  const incident=await wait(async()=>{const s=await stateStore.read();return s.incidents.find(i=>i.kind==='OBSERVER_INCOMPLETE'&&
    s.notifications.some(n=>n.incidentId===i.id&&n.status==='EXHAUSTED'));},'native observer incident and exhausted delivery',18000);
  await supportPage.locator('#incident-refresh').click();
  await supportPage.locator('table[aria-label="Merchant incidents"]').getByRole('button',{name:'Native merchant',exact:true}).click();
  await supportPage.locator('#incident-operator').fill('Native managed support operator');
  await supportPage.locator('#incident-notes').fill('Restore the original traffic observer and retain the before and after captures.');
  receiverStatus=204;
  await supportPage.getByRole('button',{name:'Retry delivery',exact:true}).click();
  const delivered=await wait(async()=>{const s=await stateStore.read();return s.notifications.find(n=>n.incidentId===incident.id&&n.status==='DELIVERED'&&n.attempts===2);},'retained original delivery retry',18000);
  assert.equal(report.receiving[0].sha256,report.receiving[1].sha256);
  await supportPage.locator('#incident-refresh').click();await supportPage.locator('#incident-ack').click();
  await wait(async()=>{const s=await stateStore.read();return s.incidents.find(i=>i.id===incident.id&&i.status==='ACKNOWLEDGED');},'native acknowledgment',18000);
  observer=observeSellerTraffic(seller);
  const recovered=await wait(async()=>{const s=await stateStore.read();return s.incidents.find(i=>i.id===incident.id&&i.status==='RECOVERED'&&i.afterCapture);},'actual recovery capture',18000);
  await note('managed product operated original incident and delivery',{incidentId:incident.id,attempts:delivered.attempts,receivingSha256:report.receiving[1].sha256});
  await supportPage.locator('#incident-refresh').click();await supportPage.locator('#incident-case-route').fill('dataset');
  const preparing=supportPage.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/'+incident.id+'/case'));
  await supportPage.locator('#incident-case-prepare').click();
  const preparedResponse=await preparing;const prepared=await preparedResponse.json();assert.equal(preparedResponse.status(),200,JSON.stringify(prepared));
  const handoff=await importRuntimeHandoff(prepared.handoff);assert.ok(handoff.supportText.length>100);assert.ok(handoff.metadata.notes.includes(incident.id));
  const handoffSha=createHash('sha256').update(prepared.handoff).digest('hex');
  const supportCustody=join(selected.stage,'native-support',handoffSha);await fs.mkdir(supportCustody,{recursive:true,mode:0o700});
  const handoffPath=join(supportCustody,'merchant-support-handoff.json');
  try{await fs.writeFile(handoffPath,prepared.handoff,{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;assert.equal(await fs.readFile(handoffPath,'utf8'),prepared.handoff);}
  report.handoff={path:handoffPath,bytes:Buffer.byteLength(prepared.handoff),sha256:handoffSha};
  await save();
  await supportPage.locator('#incident-case-open').click();
  await wait(async()=>!(await supportPage.locator('#case-save').isDisabled()),'prepared original case editable');
  const caseSaving=supportPage.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/cases'));
  await supportPage.locator('#case-save').click();const caseSavedResponse=await caseSaving;const caseSaved=await caseSavedResponse.json();
  assert.equal(caseSavedResponse.status(),200,JSON.stringify(caseSaved));const caseId=caseSaved.case.id;assert.ok(caseId);
  report.caseId=caseId;report.incidentId=incident.id;report.applicationId=applicationId;
  await note('original retained captures received as a saved merchant case',{caseId,incidentId:incident.id,handoffBytes:Buffer.byteLength(prepared.handoff)});
  const beforeStop=(await stateStore.read()).incidents.find(i=>i.id===incident.id);
  await stopApplication();
  const stopped=await wait(async()=>{const state=await stateStore.read();return state.worker?.status==='STOPPED'?state:false;},'managed Stop drained original watcher',18000);
  assert.deepEqual(stopped.incidents.find(i=>i.id===incident.id).beforeCapture,beforeStop.beforeCapture);
  assert.deepEqual(stopped.incidents.find(i=>i.id===incident.id).afterCapture,beforeStop.afterCapture);
  await supportPage.close();supportPage=null;
  await host.close();host=null;await model.close();model=await openRuntimeWorkspace({directory:workspace});
  await openHost();assert.equal((await app()).id,applicationId);
  await selectApplication();assert.equal(await page.getByRole('link',{name:'Open application',exact:true}).isVisible(),false);
  await note('managed Stop drained its watcher and reopened saved Applications state',{applicationId,workerStatus:stopped.worker.status});
  const second=await startApplication();assert.notEqual(second.current.id,first.current.id);
  const reopened=await openSupport(second);assert.notEqual(reopened.launch.instanceId,opened.launch.instanceId);
  const retained=await reopened.api('/api/cases/'+caseId);assert.equal(retained.status,200);
  assert.deepEqual(JSON.parse(retained.body.supportText),JSON.parse(handoff.supportText));
  assert.ok((retained.body.case?.metadata??retained.body.metadata).notes.includes(incident.id));
  await supportPage.locator('table[aria-label="Saved merchant cases"] .case-link').first().click();
  await wait(async()=>String(await supportPage.locator('#case-notes').inputValue()).includes(incident.id),'same saved case opened in managed support');
  const profiles=(await reopened.api('/api/incidents/profiles')).body;assert.equal(profiles.sources[0].id,'native');
  const state=await stateStore.read();const retainedIncident=state.incidents.find(i=>i.id===incident.id);
  assert.deepEqual(retainedIncident.beforeCapture,beforeStop.beforeCapture);assert.deepEqual(retainedIncident.afterCapture,beforeStop.afterCapture);
  assert.ok(state.notifications.some(n=>n.id===delivered.id&&n.status==='DELIVERED'&&n.attempts===2));
  await supportPage.locator('#incident-worker-start').click();
  await wait(async()=>{const s=await stateStore.read();return s.worker?.status==='RUNNING';},'reopened watcher owns original lease',18000);
  await stopApplication();
  await wait(async()=>{const s=await stateStore.read();return s.worker?.status==='STOPPED';},'reopened managed Stop drained original watcher',18000);
  assert.deepEqual(report.browserErrors,[]);
  await fs.cp(casePath,join(supportCustody,'cases'),{recursive:true,force:false,errorOnExist:true});
  await fs.cp(statePath,join(supportCustody,'incidents'),{recursive:true,force:false,errorOnExist:true});
  await fs.writeFile(join(supportCustody,'source-profiles.json'),await fs.readFile(configPath),{flag:'wx',mode:0o600});
  await fs.writeFile(join(supportCustody,'environment.json'),await fs.readFile(environmentPath),{flag:'wx',mode:0o600});
  await fs.writeFile(join(supportCustody,'managed-application.json'),JSON.stringify(await app(),null,2)+'\n',{flag:'wx',mode:0o600});
  report.savedSupportDirectory=supportCustody;
  report.firstOperationId=first.current.id;report.reopenedOperationId=second.current.id;
  report.caseSupportSha256=createHash('sha256').update(handoff.supportText).digest('hex');
  await note('original handoff, saved case and incident captures retained',{caseId,incidentId:incident.id,handoffPath,handoffSha256:handoffSha});
  await supportPage.close();supportPage=null;
  if(selected.grantReceiving){
    const {receiveGrantSupport}=await import(pathToFileURL(join(selected.stage,'grant-receiving.mjs')).href);
    report.grantReceiving=await receiveGrantSupport({selected,context,handoffPath,merchantCaseId:caseId,incidentId:incident.id,note});
  }
  report.status='COMPLETE';report.completedAt=new Date().toISOString();
  report.firstOperationId=first.current.id;report.reopenedOperationId=second.current.id;
  report.caseSupportSha256=createHash('sha256').update(handoff.supportText).digest('hex');
  await note('same retained case and captures received after managed Stop and reopen',{caseId,incidentId:incident.id,
    firstOperationId:first.current.id,reopenedOperationId:second.current.id,browserErrors:report.browserErrors.length});
  await page.screenshot({path:join(selected.stage,'native-managed-applications.png')}).catch(error=>{report.screenshotError=error.message;});
  }
} catch(error) {
  report.status='FAILED';report.error=String(error.stack).slice(0,5000);process.exitCode=1;
  if(page)try{report.applicationsUI=(await page.locator('body').innerText()).slice(-16000);}catch{}
  if(supportPage)try{report.supportUI=(await supportPage.locator('body').innerText()).slice(-10000);}catch{}
  if(applicationId&&model)try{const value=await app();report.currentApplication=value;}catch{}
  if(stateStore)try{const s=await stateStore.read();report.state={worker:s.worker,incidents:s.incidents.map(i=>({id:i.id,kind:i.kind,status:i.status,revision:i.revision,
    beforeCapture:i.beforeCapture,afterCapture:i.afterCapture})),notifications:s.notifications.map(n=>({id:n.id,status:n.status,attempts:n.attempts,lastReason:n.lastReason}))};}catch{}
} finally {
  clearTimeout(watchdog);await closeAll();await save();
  console.log('NATIVE_RESULT '+JSON.stringify(report));
}
