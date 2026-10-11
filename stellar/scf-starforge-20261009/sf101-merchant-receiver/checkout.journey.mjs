// MIT. One actual original-services order lifecycle; controlled local facilitator.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, readdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile as execCallback, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { Asset, Networks, Keypair } from '@stellar/stellar-sdk';
import { compileCheckout, validateHandoff, sha } from './checkout-config.mjs';
import { initializeMerchant, prepareHandoff, inspectOrder, startCheckout } from './checkout.mjs';
import { preparePurchase, retrieveFile } from './purchase.mjs';
import { operation } from '../sf88-operator-buyer-cli/config.mjs';
import { initializeQueue, openQueue } from '../sf88-operator-buyer-cli/queue.mjs';
import { initializeWorkspace } from '../sf88-operator-buyer-cli/workspace.mjs';
import { X402BuyerClient } from '../sf31-buyer-client/buyer.mjs';
import { createNativeSellerServer } from '../sf30-seller-sdk/native-factory.mjs';
import { drainOnce, sendSignedWebhook } from '../sf98-merchant-delivery/deliver.mjs';
import {initializeIncidentStore} from '../sf93-seller-support-bundle/incident-store.mjs';
import {incidentStatus} from '../sf93-seller-support-bundle/incident-operator.mjs';
import {runIncidentWatch} from '../sf93-seller-support-bundle/watch.mjs';
import {setTimeout as delay} from 'node:timers/promises';

const execFile = promisify(execCallback), here = dirname(fileURLToPath(import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'sf101-checkout-'));
let merchant, receiver, browser, watcher, watchError;
let watchAbort=new AbortController();
const incidentDirectory=join(root,'incidents');
const wrongSecretEnv='SF101_JOURNEY_REPAIR_WRONG_SECRET',correctSecretEnv='SF101_JOURNEY_REPAIR_CORRECT_SECRET';
const originalEnvironment=new Map([wrongSecretEnv,correctSecretEnv].map(name=>[name,process.env[name]]));
async function until(read,predicate,message) {
  const deadline=Date.now()+15000;
  while(Date.now()<deadline) {
    if(watchError)throw watchError;
    const value=await read();if(predicate(value))return value;
    await delay(100);
  }
  throw new Error(message);
}
const stopReceiver = async () => { if (receiver && receiver.exitCode === null) { receiver.kill('SIGTERM'); await once(receiver, 'exit'); } receiver = null; };
async function startReceiver(state, secret) {
  const code = "import sys\nfrom pathlib import Path\nfrom http.server import ThreadingHTTPServer\nimport receiver\ns=ThreadingHTTPServer(('127.0.0.1',0),receiver.make_handler(Path(sys.argv[1]),sys.argv[2]))\nprint(s.server_address[1],flush=True)\ns.serve_forever()\n";
  const child = spawn('python3', ['-u','-c',code,state,secret], {cwd:here, stdio:['ignore','pipe','pipe']});
  const port = await new Promise((done, fail) => {
    let text = '';
    child.stdout.on('data', b => { text += b.toString(); if (text.includes('\n')) done(Number(text.trim())); });
    child.once('error', fail); child.once('exit', code => fail(new Error('receiver exit ' + code)));
  });
  assert(port > 0); return {child, url:'http://127.0.0.1:' + port};
}
try {
  const payment = JSON.parse(await readFile(new URL('../sf30-seller-sdk/python/example-merchant.json', import.meta.url))).functions.summarize.payment;
  payment.asset = Asset.native().contractId(Networks.TESTNET);
  payment.payTo = Keypair.random().publicKey();
  const compiled = compileCheckout({schema:'stellar-forge.sf101.checkout-service.v1',
    publicOrigin:'https://merchant.example', path:'/purchase/report', routeId:'paid_report',
    description:'Existing approved private report', payment, state:join(root,'receiver'), outbox:join(root,'outbox')});
  await initializeMerchant(compiled);
  const source = Buffer.from('sku,quantity\nA-17,5\nB-23,11\n');
  const file = join(root,'report.csv'), handoffPath = join(root,'handoff.json');
  await writeFile(file, source, {mode:0o600});
  const token = randomBytes(32).toString('hex'), secret = randomBytes(32).toString('hex');
  await prepareHandoff(compiled, {ref:'approved-order-482', file, output:handoffPath, env:{...process.env,SF101_CLAIM_TOKEN:token}});
  const handoff = validateHandoff(JSON.parse(await readFile(handoffPath)));
  assert.deepEqual(handoff.file, {sha256:sha(source),bytes:source.length});
  assert.equal((await stat(handoffPath)).mode & 0o777, 0o600);
  await assert.rejects(prepareHandoff(compiled, {ref:handoff.orderReference,file,output:handoffPath,env:process.env}));

  const evidence = join(root,'evidence'); await mkdir(evidence,{mode:0o700});
  const signer = join(root,'operator.mjs'), policy = join(root,'policy.json');
  await writeFile(signer,'export const sign = () => { throw new Error("NOT_INVOKED_BY_QUEUE_INTAKE"); };',{mode:0o600});
  await writeFile(policy,'{}',{mode:0o600});
  const cfg = {operation:{intentId:'approved-file-482',url:'https://merchant.example/purchase/report',method:'GET',
    expect:{scheme:'exact',network:payment.network,asset:payment.asset,payTo:payment.payTo,maxAtomic:payment.amount}},
    operator:{python:'/usr/bin/python3',actor:'local-order-operator',service:'local-file-merchant',policy,ledger:join(root,'original-ledger.sqlite3')},
    signerModule:signer,evidenceDir:evidence};
  const prepared = join(root,'prepared.json');
  await preparePurchase({handoff,configuration:cfg,output:prepared});
  const normalized = operation(JSON.parse(await readFile(prepared)).operation);
  assert.equal(normalized.headers['X-SF98-Order-ID'], handoff.orderReference);
  assert.throws(() => operation({...normalized,url:'https://merchant.example/purchase/report?sf98_order=another-order'}), {code:'ORDER_REFERENCE_MUST_MATCH_APPROVED_RESOURCE'});
  const queueRoot = join(root,'inbox'); await initializeQueue(queueRoot);
  const queue = await openQueue(queueRoot), queued = await queue.enqueue(prepared);
  assert.equal(queued.operation.orderReference, handoff.orderReference);
  assert.equal((await (await openQueue(queueRoot)).show(cfg.operation.intentId)).operation.headers['X-SF98-Order-ID'],handoff.orderReference);
  const review = await execFile(process.execPath,[join(here,'../sf88-operator-buyer-cli/cli.mjs'),'--review','--config',prepared]);
  assert.equal(JSON.parse(review.stdout).headers['X-SF98-Order-ID'],handoff.orderReference);

  let verifies=0, settlements=0;
  const facilitator = {
    async getSupported() { return {kinds:[{x402Version:2,scheme:'exact',network:payment.network}],extensions:['bazaar'],signers:{}}; },
    async verify() { verifies++; return {isValid:true,payer:'local-controlled-payer'}; },
    async settle() { settlements++; return {success:true,transaction:sha('LOCAL_CONTROLLED_NOT_A_TRANSACTION_'+settlements),network:payment.network}; },
  };
  // The SAME original sender is injected at its existing transport seam. Every
  // HMAC request reaches the actual Python receiver; no second delivery engine.
  const sender = options => sendSignedWebhook({...options,resolver:async()=>[{address:'93.184.216.34',family:4}],
    transport:(_url,requestOptions,callback)=>httpRequest(receive.url+'/sf98/events',{...requestOptions,lookup:undefined},callback)});
  const nativeFactory=routes=>createNativeSellerServer(routes,{facilitatorClient:facilitator});
  merchant = await startCheckout(compiled,{port:0,operationsPort:0,nativeFactory,
    deliveryWorkspaceDirectory:join(root,'receiver-workspace'),deliveryWorkspaceOptions:{send:sender},
    incidentSource:{directory:incidentDirectory,merchantId:'approved-files'}});
  let receive = await startReceiver(compiled.state,secret); receiver=receive.child;
  await initializeIncidentStore({directory:incidentDirectory,config:{schema:'stellar-forge.seller-watch-config.v1',
    pollMs:250,failurePolls:1,recoveryPolls:1,windowMinutes:1,captureEveryMs:1000,
    httpErrors:null,disconnects:null,notification:null,merchants:[{id:'approved-files',label:'Approved report merchant',
      seller:merchant.seller.url,ops:merchant.operations.url,delivery:{required:true,oldestPendingSeconds:300,exhausted:1}}]}});
  watcher=runIncidentWatch({directory:incidentDirectory,signal:watchAbort.signal});
  watcher.catch(error=>{watchError=error;});
  const readIncidents=()=>incidentStatus({directory:incidentDirectory,details:true});
  const fetchDownload = (url,options) => fetch(receive.url+new URL(url).pathname,options);
  await assert.rejects(retrieveFile({handoff,destination:join(root,'pending.csv'),token,fetchImpl:fetchDownload}), {code:'ENTITLEMENT_NOT_AVAILABLE'});
  let response = await fetch(merchant.seller.url+'/purchase/report?sf98_order='+handoff.orderReference);
  assert.equal(response.status,422); await response.arrayBuffer(); assert.equal(verifies,0);
  response = await fetch(merchant.seller.url+'/purchase/report?sf98_order=unknown',{headers:{'X-SF98-Order-ID':'unknown'}});
  assert.equal(response.status,404); await response.arrayBuffer(); assert.equal(verifies,0);

  const client = new X402BuyerClient({fetchImpl:(url,options)=>fetch(merchant.seller.url+new URL(url).pathname+new URL(url).search,options)});
  let approvedIntent;
  const call = {...normalized, approve:async intent=>{approvedIntent=intent;return true;},
    sign:async ({challenge,accepted})=>({x402Version:2,resource:challenge.resource,accepted,
      extensions:challenge.extensions,payload:{transaction:'LOCAL_CONTROLLED_NOT_A_TRANSACTION'}})};
  const result = await client.call(call);
  assert.equal(result.status,'DELIVERED_REPORTED_SETTLED');
  assert.equal((await result.response.json()).orderReference,handoff.orderReference);
  assert.equal(approvedIntent.url,handoff.purchaseUrl);
  const mapped = await execFile('python3',['-c',
    "import sys,json;sys.path.insert(0,sys.argv[1]);from intent_adapter import buyer_intent_to_governor_request;print(json.dumps(buyer_intent_to_governor_request(json.loads(sys.argv[2]),actor='local-order-operator',service='local-file-merchant')))",
    join(here,'../sf54-buyer-governor-intent'),JSON.stringify(approvedIntent)]);
  assert.equal(JSON.parse(mapped.stdout).resource,handoff.purchaseUrl);
  let rows = await merchant.outbox.rows(); assert.equal(rows.length,1);
  assert.equal(rows[0].event.orderReference,handoff.orderReference);
  // Continue this SAME payment through an actual receiver credential failure.
  // Advance only the native retry clock; each signed HTTP request reaches the
  // original Python receiver with a current timestamp and the wrong HMAC key.
  let retryClock=Date.now(); const wrongSecret=randomBytes(32).toString('hex');
  for(let attempt=0;attempt<8;attempt++) {
    await drainOnce(merchant.outbox,{url:'https://merchant.example/internal/x402-events',allowedHost:'merchant.example',
      secret:wrongSecret,clock:()=>retryClock,send:options=>sender({...options,clock:Date.now})});
    rows=await merchant.outbox.rows();
    retryClock=Date.parse(rows[0].state.nextAt) || retryClock;
  }
  assert.equal(rows[0].state.state,'EXHAUSTED'); assert.equal(rows[0].state.attempt,8);
  const opened=(await until(readIncidents,state=>state.incidents.some(item=>item.kind==='DELIVERY_EXHAUSTED'&&item.status==='OPEN'),
    'Original monitor did not observe the exhausted event')).incidents.find(item=>item.kind==='DELIVERY_EXHAUSTED'&&item.status==='OPEN');
  process.env[wrongSecretEnv]=wrongSecret;process.env[correctSecretEnv]=secret;
  const receiverModel=merchant.operations.deliveryWorkspace;
  const oldProfile=await receiverModel.saveProfile({profile:{name:'Approved report receiver',
    url:'https://merchant.example/internal/x402-events',allowedHost:'merchant.example',secretEnv:wrongSecretEnv,pollMs:100}});
  await receiverModel.start({expectedRevision:(await receiverModel.state()).revision,
    profileId:oldProfile.id,profileRevision:oldProfile.revision,profileSha256:oldProfile.sha256});
  assert.equal((await inspectOrder(compiled,handoff.orderReference)).state,'PENDING');
  const attention=await(await fetch(merchant.operations.url+'/api/delivery/events')).json();
  assert.equal(attention.totalMatching,1); assert.equal(attention.events[0].id,rows[0].event.id);
  const detail=await(await fetch(merchant.operations.url+'/api/delivery/event?id='+rows[0].event.id)).json();
  const recoveryCommand={id:rows[0].event.id,expectedRevision:detail.revision};
  const acknowledgment={id:opened.id,expectedRevision:opened.revision,by:'Merchant operator',notes:'Repair receiver signing profile and recover the original paid report notification.'};
  const controlToken=new URLSearchParams(new URL(merchant.operations.deliveryControlUrl).hash.slice(1)).get('control');
  response=await fetch(merchant.operations.url+'/api/delivery/requeue',{method:'POST',
    headers:{'content-type':'application/json',origin:merchant.operations.url},body:JSON.stringify(recoveryCommand)});
  assert.equal(response.status,403); await response.arrayBuffer();
  let page;
  if(process.env.SF98_BROWSER_MODULE) {
    const {chromium}=createRequire(import.meta.url)(process.env.SF98_BROWSER_MODULE);
    browser=await chromium.launch({headless:true,executablePath:process.env.SF98_BROWSER_EXECUTABLE,
      args:['--no-sandbox','--disable-dev-shm-usage']});
    page=await browser.newPage({viewport:{width:1365,height:900}});
    await page.goto(merchant.operations.deliveryControlUrl);
    await page.locator('#incident-list button').filter({hasText:'Exhausted delivery notifications'}).click();
    await page.locator('#incident-by').fill(acknowledgment.by);
    await page.locator('#incident-notes').fill(acknowledgment.notes);
    // Polling must preserve an operator's note while the original watch runs.
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    assert.equal(await page.locator('#incident-notes').inputValue(),acknowledgment.notes);
    await page.getByRole('button',{name:'Acknowledge incident',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('incident-state')?.textContent==='Acknowledged');
    await page.getByRole('button',{name:'Inspect delivery queue',exact:true}).click();
    await page.getByRole('button',{name:'Inspect '+handoff.orderReference,exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('requeue')?.disabled===false);
    if(process.env.SF98_JOURNEY_OUTPUT) {
      await mkdir(process.env.SF98_JOURNEY_OUTPUT,{recursive:true,mode:0o700});
      await page.screenshot({path:join(process.env.SF98_JOURNEY_OUTPUT,'fulfillment-exhausted-desktop.png'),fullPage:true});
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:join(process.env.SF98_JOURNEY_OUTPUT,'fulfillment-exhausted-mobile.png'),fullPage:true});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
      await page.setViewportSize({width:1365,height:900});
    }
    const workspaceOpened=page.context().waitForEvent('page');
    await page.locator('#receiver-workspace-link').click();
    const receiverPage=await workspaceOpened;
    await receiverPage.waitForURL(merchant.operations.deliveryWorkspaceUrl);
    await receiverPage.getByRole('button',{name:'Receivers',exact:true}).click();
    await receiverPage.locator('.profile-choice').filter({hasText:'Approved report receiver'}).click();
    await receiverPage.locator('#profile-form input[name=secretEnv]').fill(correctSecretEnv);
    await receiverPage.getByRole('button',{name:'Save revision',exact:true}).click();
    await receiverPage.waitForFunction(()=>document.getElementById('profile-identity')?.textContent.includes('revision 2'));
    await receiverPage.getByRole('button',{name:'Use this revision',exact:true}).click();
    await receiverPage.getByRole('button',{name:'Run continuously',exact:true}).click();
    await until(()=>receiverModel.state(),state=>state.selectedProfile?.revision===2&&state.worker.owned?.status==='RUNNING',
      'Repaired profile was not applied to the original owned worker');
    if(process.env.SF98_JOURNEY_OUTPUT)await receiverPage.screenshot({path:join(process.env.SF98_JOURNEY_OUTPUT,'receiver-profile-repaired-desktop.png'),fullPage:true});
    await receiverPage.close();
    await page.bringToFront();
    await page.getByRole('button',{name:'Requeue notification',exact:true}).click();
    await page.waitForFunction(()=>['Requeued','Receiver accepted'].includes(document.getElementById('event-state')?.textContent));
  } else {
    response=await fetch(merchant.operations.url+'/api/delivery/incident/ack',{method:'POST',
      headers:{'content-type':'application/json',origin:merchant.operations.url,'x-delivery-control':controlToken},body:JSON.stringify(acknowledgment)});
    assert.equal(response.status,200);assert.equal((await response.json()).incident.status,'ACKNOWLEDGED');
    const revised=await receiverModel.saveProfile({id:oldProfile.id,expectedRevision:1,profile:{...oldProfile.profile,secretEnv:correctSecretEnv}});
    await receiverModel.start({expectedRevision:(await receiverModel.state()).revision,profileId:revised.id,
      profileRevision:revised.revision,profileSha256:revised.sha256});
    response=await fetch(merchant.operations.url+'/api/delivery/requeue',{method:'POST',
      headers:{'content-type':'application/json',origin:merchant.operations.url,'x-delivery-control':controlToken},
      body:JSON.stringify(recoveryCommand)});
    assert.equal(response.status,200); await response.arrayBuffer();
  }
  // A stale operator cannot replay a successful recovery command.
  response=await fetch(merchant.operations.url+'/api/delivery/requeue',{method:'POST',
    headers:{'content-type':'application/json',origin:merchant.operations.url,'x-delivery-control':controlToken},
    body:JSON.stringify(recoveryCommand)});
  assert.equal(response.status,409); assert.equal((await response.json()).error,'DELIVERY_STATE_CHANGED');
  await until(()=>merchant.outbox.rows(),current=>current[0]?.state?.state==='DELIVERED','Owned receiver worker did not deliver original event');
  const recoveredIncidents=await until(readIncidents,state=>state.incidents.find(item=>item.id===opened.id)?.status==='RECOVERED',
    'Original monitor did not observe the recovered delivery condition');
  const recoveredIncident=recoveredIncidents.incidents.find(item=>item.id===opened.id);
  assert.equal(recoveredIncident.acknowledgment.by,acknowledgment.by);
  assert.equal(recoveredIncident.signal.exhausted,1);assert.equal(recoveredIncident.recoverySignal.exhausted,0);
  const workspaceOutcome=await receiverModel.state();
  assert.equal(workspaceOutcome.selectedProfile.revision,2);assert.equal(workspaceOutcome.desiredMode,'WORKER');
  assert.equal(workspaceOutcome.jobs.length,1);assert.equal(workspaceOutcome.jobs[0].result.result.outcomes[0].id,rows[0].event.id);
  if(page) {
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('event-state')?.textContent==='Receiver accepted');
    await page.waitForFunction(()=>document.getElementById('incident-state')?.textContent==='Recovery observed');
    assert((await page.locator('#recovery-result').textContent()).startsWith('Recovered:'));
    if(process.env.SF98_JOURNEY_OUTPUT) await page.screenshot({path:join(process.env.SF98_JOURNEY_OUTPUT,'fulfillment-recovered-desktop.png'),fullPage:true});
    if(process.env.SF98_JOURNEY_OUTPUT) {
      await page.setViewportSize({width:390,height:844});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
      await page.screenshot({path:join(process.env.SF98_JOURNEY_OUTPUT,'incident-recovered-mobile.png'),fullPage:true});
    }
    await browser.close(); browser=null;
  }
  assert.equal((await inspectOrder(compiled,handoff.orderReference)).state,'ENTITLED');
  const downloaded = join(root,'purchased.csv');
  await assert.rejects(retrieveFile({handoff,destination:join(root,'wrong-token.csv'),token:randomBytes(32).toString('hex'),fetchImpl:fetchDownload}), {code:'ENTITLEMENT_NOT_AVAILABLE'});
  const saved = await retrieveFile({handoff,destination:downloaded,token,fetchImpl:fetchDownload});
  assert.equal(saved.status,'APPROVED_FILE_SAVED'); assert.deepEqual(await readFile(downloaded),source);
  assert.equal(saved.file.sha256,handoff.file.sha256);
  assert.equal((await stat(downloaded)).mode & 0o777,0o600);
  await stopReceiver(); receive = await startReceiver(compiled.state,secret); receiver=receive.child;
  const recovered = await retrieveFile({handoff,destination:downloaded,fetchImpl:()=>{throw new Error('NO_REPEAT_DOWNLOAD');}});
  assert.equal(recovered.httpRequests,0); assert.equal(recovered.receipt.disposition,'EXISTING_MATCH');
  const duplicate = await sender({event:rows[0].event,url:'https://merchant.example/internal/x402-events',allowedHost:'merchant.example',secret});
  assert.equal(duplicate.httpStatus,200);
  assert.deepEqual(await (await fetch(receive.url+'/deliver/'+handoff.orderReference,{headers:{Authorization:'Bearer '+token}})).arrayBuffer(),source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength));
  response=await fetch(merchant.seller.url+'/purchase/report?sf98_order='+handoff.orderReference,{headers:{'X-SF98-Order-ID':handoff.orderReference}});
  assert.equal(response.status,404); await response.arrayBuffer(); assert.equal(verifies,1);
  const badTarget=join(root,'wrong-fingerprint.csv');
  await assert.rejects(retrieveFile({handoff,destination:badTarget,token,fetchImpl:async()=>new Response(Buffer.alloc(source.length,120))}));
  await assert.rejects(stat(badTarget),{code:'ENOENT'});
  assert((await readdir(root)).some(name=>name.endsWith('.partial')));
  response=await fetch(merchant.operations.url+'/api/delivery'); const view=await response.json();
  assert.equal(response.status,200); assert(JSON.stringify(view).includes('DELIVERED'));
  await execFile('python3',[join(here,'receiver.py'),'receipt','--state',compiled.state,'--ref',handoff.orderReference,'--out',join(root,'entitlement.json')]);
  assert.equal(JSON.parse(await readFile(join(root,'entitlement.json'))).fileSha256,handoff.file.sha256);
  // Reopen the SAME merchant listeners and original profile/job history at the
  // registered addresses. The original watcher keeps its incident and captures.
  const sellerPort=Number(new URL(merchant.seller.url).port),operationsPort=Number(new URL(merchant.operations.url).port);
  const priorWatch=(await readIncidents()).worker.instanceId;
  watchAbort.abort();await watcher;
  await merchant.close();
  merchant=await startCheckout(compiled,{port:sellerPort,operationsPort,nativeFactory,
    deliveryWorkspaceDirectory:join(root,'receiver-workspace'),deliveryWorkspaceOptions:{send:sender},
    incidentSource:{directory:incidentDirectory,merchantId:'approved-files'}});
  watchAbort=new AbortController();watcher=runIncidentWatch({directory:incidentDirectory,signal:watchAbort.signal});
  watcher.catch(error=>{watchError=error;});
  await until(readIncidents,state=>state.worker.instanceId!==priorWatch&&state.worker.lastSweepAt,'Original monitor did not reopen');
  const reopenedIncident=await(await fetch(merchant.operations.url+'/api/delivery/incident?id='+opened.id)).json();
  assert.equal(reopenedIncident.incident.id,opened.id);assert.equal(reopenedIncident.incident.status,'RECOVERED');
  const reopenedWorkspace=await merchant.operations.deliveryWorkspace.state();
  assert.equal(reopenedWorkspace.selectedProfile.revision,2);assert.equal(reopenedWorkspace.jobs.length,1);
  assert.equal((await merchant.outbox.rows()).length,1);assert.equal(settlements,1);

  // Continue the SAME real delivered product through the installable Python app.
  // Workspace creation/preparation/review remain offline; the product above has
  // already traversed the actual native seller, signed receiver and file writer.
  const workspace=join(root,'python-workspace'), base=join(root,'python-base.json');
  const localCustomer=Keypair.random();
  const python=(await execFile('python3',['-c','import sys;print(sys.executable)'])).stdout.trim();
  await writeFile(base,JSON.stringify({operation:cfg.operation}),{mode:0o600});
  await initializeWorkspace(['--config',base,'--dir',workspace,'--actor','python-customer',
    '--service','original-paid-files','--payer',localCustomer.publicKey(),'--python',python,
    '--secret-env','SF101_JOURNEY_WALLET_NOT_PROVISIONED']);
  await rename(join(workspace,'operator-keys.json'),join(workspace,'operator-keys.retained.json'));
  const checkout=fileURLToPath(new URL('../../../',import.meta.url));
  const applicationScript=`import json,sys
from pathlib import Path
from stellar_forge_buyer import Buyer,NativeError
checkout,state,workspace,handoff,product=sys.argv[1:]
buyer=Buyer(checkout=checkout,state_dir=state)
op=buyer.from_paid_file(handoff,workspace=workspace,intent_id='python-approved-file-482')
review=op.review()
assert review.file_promise['orderReference']=='approved-order-482'
assert review.native['headers']['X-SF98-Order-ID']=='approved-order-482'
assert json.loads(op.config_path.read_text())['evidenceDir']==str(Path(workspace)/'evidence')
try:
    op.execute(review=review)
    raise AssertionError('missing native setup must fail before attempt')
except NativeError as error:
    assert error.code=='SIGNER_LOCAL_TESTNET_KEY_REQUIRED',error.code
assert not (op.directory/'attempt.json').exists()
delivery=op.retrieve_file(destination=product)
assert delivery.http_requests==0
assert list(delivery.csv_rows())==[{'sku':'A-17','quantity':'5'},{'sku':'B-23','quantity':'11'}]
reopened=Buyer(checkout=checkout,state_dir=state).operation(op.intent_id)
reopened.buyer.runtime.run=lambda *a,**k: (_ for _ in ()).throw(AssertionError('local recovery must not launch Node'))
saved=reopened.recover_file()
assert saved.read_bytes()==Path(product).read_bytes()
assert reopened.inspect()['state']=='PREPARED'
print(json.dumps({'pythonApplication':'PASS','nativeAttemptStarted':False,
                  'productHttpRequests':delivery.http_requests,'rows':2,'configuration':str(op.config_path)}))
`;
  const applicationEnv={...process.env,PYTHONPATH:join(here,'../sf88-operator-buyer-cli/python')};
  delete applicationEnv.SF101_JOURNEY_WALLET_NOT_PROVISIONED;
  delete applicationEnv.SF101_CLAIM_TOKEN;
  const applicationResult=JSON.parse((await execFile(python,['-c',applicationScript,checkout,
    join(root,'python-application'),workspace,handoffPath,downloaded],{env:applicationEnv})).stdout);
  assert.equal(applicationResult.pythonApplication,'PASS');
  await rename(join(workspace,'operator-keys.retained.json'),join(workspace,'operator-keys.json'));
  const ready=JSON.parse((await execFile(process.execPath,[join(here,'../sf88-operator-buyer-cli/python/bridge.mjs'),
    'workspace-check','--dir',workspace,'--config',applicationResult.configuration],
    {env:{...applicationEnv,SF101_JOURNEY_WALLET_NOT_PROVISIONED:localCustomer.secret()}})).stdout);
  assert.equal(ready.mode,'ORIGINAL_PYTHON_WORKSPACE_READY');
  delete applicationResult.configuration;
  applicationResult.nativeWorkspaceBinding='ORIGINAL_HELPER_PASS';
  const summary={result:'PASS',node:process.version,nativeSdk:'2.28.0',verifies,settlements,
    flow:'original enrollment -> SF88 immutable inbox/review -> SF30 Python/native settlement -> eight actual rejected signed HTTP deliveries -> original SF93 incident/acknowledgment -> receiver profile revision repair -> owned pause/requeue/resume -> same SF98 event accepted -> observed recovery -> SF101 exact private file -> same merchant/monitor/workspace restart',
    incident:{id:opened.id,status:recoveredIncident.status,acknowledgedBy:recoveredIncident.acknowledgment.by,
      originalExhausted:recoveredIncident.signal.exhausted,recoveredExhausted:recoveredIncident.recoverySignal.exhausted},
    receiverWorkspace:{profileRevisions:2,retainedMaintenanceJobs:1,reopened:true,monitorReopened:true},
    fulfillmentBrowser:process.env.SF98_BROWSER_MODULE ? 'PASS desktop/mobile incident acknowledgment, profile repair and original HTTP recovery' : 'not requested',
    financialExecution:'controlled local facilitator/approval; no wallet or chain transaction',fileBytes:source.length,
    pythonApplication:applicationResult};
  if(process.env.SF98_JOURNEY_OUTPUT)await writeFile(join(process.env.SF98_JOURNEY_OUTPUT,'journey.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(summary));
} finally {
  watchAbort.abort();await watcher?.catch(()=>{});await browser?.close();await stopReceiver();await merchant?.close();
  for(const [name,value] of originalEnvironment)if(value===undefined)delete process.env[name];else process.env[name]=value;
  await rm(root,{recursive:true,force:true});
}
