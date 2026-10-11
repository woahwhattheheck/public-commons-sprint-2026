import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, unlink, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect as netConnect } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SourceTextModule } from 'node:vm';
import { createRequire } from 'node:module';
const run=promisify(execFile),root=process.argv[2],directory=process.argv[3];
const runtime=join(directory,'runtime'),base=join(root,'stellar/scf-starforge-20261009/mpp-charge');
const native=await (await import(pathToFileURL(join(base,'runtime.mjs')))).loadNative(runtime);
const {hash,stable,openWorkspace}=await import(pathToFileURL(join(base,'storage.mjs')));
const api=await import(pathToFileURL(join(base,'customer/index.mjs')));
const {serveMerchant,serveWorkspace}=await import(pathToFileURL(join(base,'server.mjs')));
const {bindingFacts}=await import(pathToFileURL(join(base,'config.mjs')));
const origin='https://merchant.example.com',payer=native.sdk.Keypair.random().publicKey();
const recipient=native.sdk.Keypair.random().publicKey(),asset=native.sdk.StrKey.encodeContract(Buffer.alloc(32,23));
const profile={title:'Native customer report service',publicOrigin:origin,secretEnv:'MPP_JOURNEY_HMAC',
 dependencyRoot:runtime,lifetimeSeconds:300,routes:[{id:'report',method:'POST',path:'/report',
 description:'Customer integration report',payment:{network:'stellar:testnet',currency:asset,recipient,
 amountAtomic:'7',decimals:7},resource:{kind:'json',value:{rows:3,privateMarker:'private-merchant-resource'}}}]};
const environment={MPP_JOURNEY_HMAC:'b'.repeat(64)},merchantDirectory=join(directory,'merchant');
let workspace=await openWorkspace(merchantDirectory,{create:true});
await workspace.configure('merchant',profile,0);
let merchant=await serveMerchant({workspace,profile,port:0,environment}),consoleApp,browser,page;
let browserObservation='served and parsed original browser modules';
let releaseHeld,holdSeenResolve,failNext=false;
const holdSeen=new Promise(resolve=>{holdSeenResolve=resolve;}),hold=new Promise(resolve=>{releaseHeld=resolve;});
const received=[],sockets=new Set();
const tlsServer=httpsServer({key:await readFile(join(directory,'tls.key')),
 cert:await readFile(join(directory,'tls.crt'))},async(request,response)=>{
 if(request.url.includes('hold=1')){holdSeenResolve();await hold;}
 if(failNext){failNext=false;response.writeHead(503,{'content-type':'text/plain'});response.end('Resource temporarily unavailable');return;}
 const pieces=[];request.on('data',part=>pieces.push(part));
 request.on('end',()=>received.push({method:request.method,url:request.url,body:hash(Buffer.concat(pieces))}));
 const upstream=httpRequest({hostname:'127.0.0.1',port:merchant.port,path:request.url,
 method:request.method,headers:{...request.headers,host:'merchant.example.com'}},incoming=>{
  response.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(response);
 });
 upstream.on('error',error=>response.destroy(error));request.pipe(upstream);
});
const proxy=httpServer();
for(const server of [tlsServer,proxy])server.on('connection',socket=>{
 sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
});
proxy.on('connect',(request,socket,head)=>{
 if(request.url!=='merchant.example.com:443'||head.length){socket.destroy();return;}
 const upstream=netConnect(tlsServer.address().port,'127.0.0.1',()=>{
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');socket.pipe(upstream);upstream.pipe(socket);
 });
 upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
 socket.on('close',()=>upstream.destroy());
});
const listen=server=>new Promise((resolve,reject)=>{
 server.once('error',reject);server.listen(0,'127.0.0.1',resolve);
});
await listen(tlsServer);await listen(proxy);
try {
 const contract=api.merchantContract(profile),bundle=await api.createCustomerBundle({contract});
 const customerDirectory=join(directory,'customer');
 const initial=await openWorkspace(customerDirectory,{create:true});await initial.close();
 consoleApp=await serveWorkspace({directory:customerDirectory,port:0,environment});
 let consoleToken=new URL(consoleApp.url).hash.slice(1);
 const consoleRequest=async(path,body,expectedStatus)=>{
  const response=await fetch(consoleApp.origin+path,{method:body===undefined?'GET':'POST',
   headers:{authorization:'Bearer '+consoleToken,...(body===undefined?{}:{'content-type':'application/json'})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result=await response.json();
  if(expectedStatus!==undefined)assert.equal(response.status,expectedStatus,JSON.stringify(result));
  else assert(response.ok,JSON.stringify(result));
  return result;
 };
 const waitJob=async(id,expected='COMPLETE')=>{
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
   const state=await consoleRequest('/api/state'),job=state.jobs.find(row=>row.id===id);
   assert(job,'Console job disappeared');
   if(job.state!=='RUNNING'){assert.equal(job.state,expected,JSON.stringify(job));return job;}
   await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('Customer operation did not finish');
 };
 const html=await fetch(consoleApp.origin).then(response=>response.text());
 assert(html.includes('Customer workbench'));assert(html.includes('cw-configuration-fields'));
 const browserModule=await fetch(consoleApp.origin+'/customer-workbench.js');
 assert.equal(browserModule.status,200);
 new SourceTextModule(await browserModule.text());
 new SourceTextModule(await readFile(join(base,'public/app.js'),'utf8'));
 assert.equal((await fetch(consoleApp.origin+'/api/customer-workbench')).status,401);
 const wrongOrigin=await fetch(consoleApp.origin+'/api/customer-workbench',
  {headers:{authorization:'Bearer '+consoleToken,origin:'https://other.example.com'}});
 assert.equal(wrongOrigin.status,403);
 const receivedDraft=await consoleRequest('/api/customer-workbench/intake',{document:bundle});
 assert.equal(receivedDraft.draft.contract.sha256,contract.sha256);
 const configuration={...receivedDraft.draft.configuration,dependencyRoot:runtime,
  operator:{python:'/usr/bin/python3',ledger:join(directory,'original-ledger.json'),
   policy:join(directory,'original-policy.json'),actor:'journey',service:'report'},
  signer:{payer,keyEnv:'MPP_JOURNEY_SIGNER'},transport:{mode:'explicit-connect',origin,
   proxyUrl:'http://127.0.0.1:'+proxy.address().port}};
 const customerProfile={...receivedDraft.draft,configuration};
 let selected;
 if(process.env.MPP_PLAYWRIGHT_PACKAGE) {
  const require=createRequire(process.env.MPP_PLAYWRIGHT_PACKAGE+'/');
  const {chromium}=require(process.env.MPP_PLAYWRIGHT_PACKAGE);
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  page=await browser.newPage({viewport:{width:1440,height:1200}});
  await page.goto(consoleApp.url);
  await page.locator('[data-tab="customer-workbench"]').click();
  await page.locator('#cw-document-file').setInputFiles({name:'customer-package.json',mimeType:'application/json',
   buffer:Buffer.from(JSON.stringify(bundle))});
  await page.locator('#cw-document').waitFor();
  await page.waitForFunction(()=>document.querySelector('#cw-document').value.length>1000 &&
   !document.querySelector('#cw-intake-fields').disabled);
  await page.locator('#cw-intake-form button[type="submit"]').click();
  await page.waitForFunction(()=>!document.querySelector('#cw-draft').hidden &&
   !document.querySelector('#cw-configuration-fields').disabled);
  const values={...configuration.operator,...configuration.signer,dependencyRoot:runtime,
   proxyUrl:configuration.transport.proxyUrl};
  for(const [name,value]of Object.entries(values))
   await page.locator('#cw-configuration-form [name="'+name+'"]').fill(value);
  await page.locator('#cw-configuration-form button[type="submit"]').click();
  await page.waitForFunction(()=>!document.querySelector('#cw-purchase-fields').disabled &&
   document.querySelector('#cw-offer').value==='report');
  const state=await consoleRequest('/api/customer-workbench');
  assert.equal(state.profile.configuration.operator.ledger,configuration.operator.ledger);
  assert.equal(state.profile.configuration.transport.proxyUrl,configuration.transport.proxyUrl);
  selected={kind:'customer',profileId:state.profileId,revision:state.revision};
  browserObservation='actual Chromium file intake, configuration fields, native request preview/preparation and retained purchase history';
 } else selected=await consoleRequest('/api/customer-workbench/configure',
  {profile:customerProfile,revision:receivedDraft.revision});
 assert.equal(selected.kind,'customer');
 await consoleRequest('/api/customer-workbench/configure',
  {profile:customerProfile,revision:receivedDraft.revision},409);
 const options={purchaseId:'workbench-native-001',query:{edition:'2026-10',tag:['north','south'],hold:'1'},
  json:{groupBy:'region',name:'München'}};
 const selectedInputs={profileId:selected.profileId,offerId:'report',
  inputs:{query:options.query,json:options.json}};
 const preview=await consoleRequest('/api/customer-workbench/preview',selectedInputs);
 assert.equal(preview.request.url,origin+'/report?edition=2026-10&hold=1&tag=north&tag=south');
 assert.equal(preview.binding.bodySha256,bindingFacts(api.buildCustomerRequest(contract,'report',selectedInputs.inputs)).bodySha256);
 let first;
 if(page) {
  await page.locator('#cw-purchase-id').fill(options.purchaseId);
  await page.locator('#cw-query').fill(JSON.stringify(options.query));
  await page.locator('#cw-body').fill(JSON.stringify(options.json));
  await page.locator('#cw-preview').click();
  await page.waitForFunction(()=>document.querySelector('#cw-request-preview').textContent.includes('bodySha256') &&
   !document.querySelector('#cw-purchase-fields').disabled);
  assert.equal(JSON.parse(await page.locator('#cw-request-preview').innerText()).binding.bodySha256,
   preview.binding.bodySha256);
  await page.locator('#cw-purchase-form button[type="submit"]').click();
  await holdSeen;
  const state=await consoleRequest('/api/state');
  first=state.jobs.find(job=>job.kind==='Prepare customer purchase');
 } else {
  first=await consoleRequest('/api/customer-workbench/prepare',
   {profileId:selected.profileId,offerId:'report',options});
  await holdSeen;
 }
 const live=await consoleRequest('/api/state');
 assert.equal(live.jobs.find(row=>row.id===first.id).state,'RUNNING');
 assert.equal(live.customerWorkbench.purchases.items[0].phase,'PREPARATION_INCOMPLETE');
 assert.equal((await consoleApp.workspace.metadata()).customer,selected.profileId);
 const duplicate=await consoleRequest('/api/customer-workbench/prepare',
  {profileId:selected.profileId,offerId:'report',options});
 releaseHeld();
 const firstResult=(await waitJob(first.id)).result;
 const duplicateResult=(await waitJob(duplicate.id)).result;
 assert.equal(firstResult.phase,'REVIEW_READY');
 assert.equal(firstResult.challenge.id,duplicateResult.challenge.id);
 assert.equal(received.filter(row=>row.url===preview.request.url.slice(origin.length)).length,1);
 await consoleRequest('/api/customer-workbench/purchases/'+options.purchaseId+'/preview',undefined,409);
 const borrowed=await api.attachCustomer({workspace:consoleApp.workspace,contract,configuration});
 assert.equal((await borrowed.purchase(options.purchaseId).inspect()).challenge.id,firstResult.challenge.id);
 await borrowed.close();
 assert.equal((await consoleApp.workspace.metadata()).customer,selected.profileId);
 failNext=true;
 const retryOptions={purchaseId:'workbench-retry-001',query:{edition:'retry'},json:{retain:'original'}};
 const interrupted=await consoleRequest('/api/customer-workbench/prepare',
  {profileId:selected.profileId,offerId:'report',options:retryOptions});
 const failed=await waitJob(interrupted.id,'FAILED');
 assert.equal(failed.error,'MPP_NATIVE_CHALLENGE_REQUIRED');
 let history=await consoleRequest('/api/customer-workbench');
 assert.equal(history.purchases.items.find(row=>row.id===retryOptions.purchaseId).retryPreparation,true);
 const changedProfile=structuredClone(profile);changedProfile.routes[0].resource.value.rows=4;
 const changedContract=api.merchantContract(changedProfile);
 const changedDraft=await consoleRequest('/api/customer-workbench/intake',{document:changedContract});
 assert.equal(changedDraft.difference.profileChanged,true);
 const changedSelected=await consoleRequest('/api/customer-workbench/configure',
  {profile:changedDraft.draft,revision:changedDraft.revision});
 const retry=await consoleRequest('/api/customer-workbench/retry-prepare',{id:retryOptions.purchaseId});
 const recovered=(await waitJob(retry.id)).result;
 assert.equal(recovered.phase,'REVIEW_READY');
 assert.equal(recovered.customer.contractSha256,contract.sha256);
 assert.equal(recovered.request.bodySha256,bindingFacts(api.buildCustomerRequest(contract,'report',
  {query:retryOptions.query,json:retryOptions.json})).bodySha256);
 await consoleRequest('/api/customer-workbench/preview',selectedInputs,409);
 history=await consoleRequest('/api/customer-workbench');
 assert.equal(history.purchases.items.find(row=>row.id===options.purchaseId).customer.activeContractChanged,true);
 assert.equal((await api.createCustomerWorkbench({workspace:consoleApp.workspace}).action(options.purchaseId,'inspect')).challenge.id,
  firstResult.challenge.id);
 await merchant.close();merchant=await serveMerchant({workspace,profile:changedProfile,port:0,environment});
 const fresh=await consoleRequest('/api/customer-workbench/prepare',{profileId:changedSelected.profileId,
  offerId:'report',options:{purchaseId:'workbench-revised-001',query:{edition:'new'},json:{retain:'current'}}});
 assert.equal((await waitJob(fresh.id)).result.phase,'REVIEW_READY');
 const update=await consoleRequest('/api/customer-workbench/refresh',{profileId:changedSelected.profileId});
 assert.equal(update.difference.changed,false);
 await consoleApp.close();consoleApp=null;
 consoleApp=await serveWorkspace({directory:customerDirectory,port:0,environment});
 consoleToken=new URL(consoleApp.url).hash.slice(1);
 const reopened=await consoleRequest('/api/customer-workbench');
 assert.equal(reopened.purchases.total,3);
 assert.equal(reopened.purchases.items.find(row=>row.id===options.purchaseId).challenge.id,firstResult.challenge.id);
 if(page) {
  await page.goto(consoleApp.url);
  await page.locator('[data-tab="customer-workbench"]').click();
  await page.waitForFunction(()=>document.querySelector('#cw-purchases').textContent.includes('workbench-native-001'));
  await page.locator('#cw-intake').evaluate(element=>{element.open=false;});
  await page.screenshot({path:join(root,'operations/scf-mpp-workbench-native-20261011/workbench.png'),fullPage:true});
 }
 const retryAfterRestart=await consoleRequest('/api/customer-workbench/retry-prepare',{id:retryOptions.purchaseId});
 assert.equal((await waitJob(retryAfterRestart.id)).result.challenge.id,recovered.challenge.id);
 const page=await consoleRequest('/api/customer-workbench?offset=1&limit=1');
 assert.equal(page.purchases.items.length,1);assert.equal(page.purchases.nextOffset,2);
 const observed={runtime:native.versions,
  console:'authenticated contract/package intake, revision save, exact offer preview and original native preparation',
  nativePrepare:'REVIEW_READY',
  concurrentPreparation:{requests:2,merchantCalls:1,sameNativeChallenge:true},
  workspace:'borrowed customer close preserves the host lease; state remains readable during a pending native request',
  recovery:'original query/body/profile retained across a failed HTTP preparation, changed active contract and console restart',
  history:{originalPurchases:3,paginated:true,originalChallengesReopened:true},
  browser:browserObservation,
  requestCount:received.length};
 await writeFile(join(directory,'result.json'),JSON.stringify(observed,null,2)+'\n');
 console.log(JSON.stringify(observed));
} finally {
 releaseHeld();
 await browser?.close().catch(()=>{});
 await consoleApp?.close().catch(()=>{});
 await merchant?.close().catch(()=>{});await workspace?.close().catch(()=>{});
 for(const socket of sockets)socket.destroy();
 await Promise.all([tlsServer,proxy].map(server=>new Promise(resolve=>server.close(resolve))));
}
