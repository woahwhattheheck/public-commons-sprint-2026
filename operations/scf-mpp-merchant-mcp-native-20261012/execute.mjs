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
for(let index=1;index<32;index++)profile.routes.push({...structuredClone(profile.routes[0]),
 id:'report-'+index,path:'/report-'+index,description:('Regional customer report '+index+'. ').repeat(30)});
const environment={MPP_JOURNEY_HMAC:'b'.repeat(64),MPP_CONSOLE_TOKEN:'c'.repeat(64),
 MCP_ACCESS_TOKEN:'d'.repeat(64)},merchantDirectory=join(directory,'merchant');
let workspace=await openWorkspace(merchantDirectory,{create:true});
await workspace.configure('merchant',profile,0);
let merchant=await serveMerchant({workspace,profile,port:0,environment}),consoleApp,mcpApp;
const mcpBase=join(root,'stellar-forge/mcp-merchant-operator');
const {initializeMppMerchant}=await import(pathToFileURL(join(mcpBase,'config.mjs')));
const {startMerchantMcp}=await import(pathToFileURL(join(mcpBase,'serve.mjs')));
const {openMerchantFileClient}=await import(pathToFileURL(join(mcpBase,'retained-download.mjs')));
const {downloadMppExport,inspectMppDownload}=await import(pathToFileURL(join(mcpBase,'mpp-download.mjs')));
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
 const documentBytes=Buffer.byteLength(JSON.stringify(bundle));
 assert(documentBytes>128*1024 && documentBytes<2*1024*1024,'Exercise a complete native bundle beyond the default MCP envelope');
 const customerDirectory=join(directory,'customer');
 const initial=await openWorkspace(customerDirectory,{create:true});await initial.close();
 consoleApp=await serveWorkspace({directory:customerDirectory,port:0,environment,tokenEnv:'MPP_CONSOLE_TOKEN'});
 const consolePort=new URL(consoleApp.origin).port;
 const consoleRequest=async(path,body)=>{
  const response=await fetch(consoleApp.origin+path,{method:body===undefined?'GET':'POST',
   headers:{authorization:'Bearer '+environment.MPP_CONSOLE_TOKEN,origin:consoleApp.origin,
    ...(body===undefined?{}:{'content-type':'application/json'})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result=await response.json();assert(response.ok,JSON.stringify(result));return result;
 };
 const identity=await consoleRequest('/api/identity');
 assert.equal(identity.schema,'stellar-forge.mpp-console-identity.v1');
 assert.equal(identity.pid,process.pid);assert.equal(identity.ppid,process.ppid);
 assert.equal(identity.workspace,customerDirectory);assert.equal(identity.origin,consoleApp.origin);
 assert.equal(consoleApp.readiness.schema,'stellar-forge.mpp-console-ready.v1');
 assert.equal(Object.keys(consoleApp.readiness)[0],'schema');
 assert.equal(consoleApp.readiness.pid,identity.pid);assert.equal(consoleApp.readiness.ppid,identity.ppid);
 assert.equal(consoleApp.readiness.createdAt,identity.createdAt);
 assert.equal(consoleApp.readiness.privateUrl,consoleApp.origin+'/#'+environment.MPP_CONSOLE_TOKEN);
 assert.equal((await fetch(consoleApp.origin+'/api/identity')).status,401);
 const configuration=api.customerConfiguration({...api.customerConfigurationTemplate(contract),
  workspace:customerDirectory,dependencyRoot:runtime,
  operator:{python:'/usr/bin/python3',ledger:join(directory,'original-ledger.json'),
   policy:join(directory,'original-policy.json'),actor:'native-mcp-journey',service:'report'},
  signer:{payer,keyEnv:'MPP_JOURNEY_SIGNER'},
  rpcUrl:'https://rpc.example.com/path/private-fixture-key?token=private-fixture-token',
  transport:{mode:'explicit-connect',origin,proxyUrl:'http://127.0.0.1:'+proxy.address().port}},contract);
 const customerFile=join(directory,'customer-private.json'),connectionFile=join(directory,'mpp-connection.json');
 await writeFile(customerFile,JSON.stringify(configuration,null,2)+'\n',{mode:0o600});
 await writeFile(connectionFile,JSON.stringify({schema:'stellar-forge.merchant-mpp-connection.v1',
  consoles:{research:{label:'Native report console',origin:consoleApp.origin,tokenEnv:'MPP_CONSOLE_TOKEN',
   workspace:customerDirectory,customers:{standard:{configuration:customerFile}}}}},null,2)+'\n',{mode:0o600});
 const initialized=await initializeMppMerchant({directory:join(directory,'merchant-mcp'),connection:connectionFile});
 mcpApp=await startMerchantMcp({configPath:initialized.configuration,port:0,environment});
 const mcpPort=Number(new URL(mcpApp.url).port),mcpUrl=mcpApp.url;
 const mppTools=mcpApp.operator.tools.filter(tool=>tool.name.startsWith('merchant_mpp_'));
 assert.equal(mppTools.length,23);assert.equal(mcpApp.operator.maximumRequestBytes,3*1024*1024);
 let client=await openMerchantFileClient({url:mcpUrl,environment,errorPrefix:'MPP'});
 const call=(name,args)=>client.call('merchant_mpp_'+name,args);
 const waitJob=async(jobId,purchaseId,expected='COMPLETE')=>{
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
   const job=await call('job',{console:'research',jobId,purchaseId});
   if(job.state!=='RUNNING'){assert.equal(job.state,expected,JSON.stringify(job));return job;}
   await new Promise(resolve=>setTimeout(resolve,40));
  }
  throw new Error('Original native MCP job did not finish');
 };
 const declared=await call('consoles',{});
 assert.equal(declared.consoles[0].customers[0].configuration.rpcConfigured,true);
 assert.equal(declared.consoles[0].customers[0].configuration.rpcOrigin,'https://rpc.example.com');
 assert(!JSON.stringify(declared).includes('private-fixture'));
 assert(!JSON.stringify(declared).includes(environment.MPP_CONSOLE_TOKEN));
 const fetched=await call('contract',{console:'research',customer:'standard',origin});
 assert.equal(fetched.contract.sha256,contract.sha256);
 const reviewArgs={console:'research',customer:'standard',reviewId:'mcp-review-original',document:bundle};
 const reviewed=await call('customer_review',reviewArgs);
 assert.equal(reviewed.contractSha256,contract.sha256);
 assert.equal((await call('customer_review',reviewArgs)).reviewSha256,reviewed.reviewSha256);
 const selected=await call('customer_configure',{console:'research',reviewId:reviewed.reviewId,
  expectedReviewSha256:reviewed.reviewSha256});
 assert.equal(selected.profileId,reviewed.profileId);assert.equal(selected.state,'SELECTED');
 const already=await call('customer_configure',{console:'research',reviewId:reviewed.reviewId,
  expectedReviewSha256:reviewed.reviewSha256});assert.equal(already.recovered,true);
 const options={purchaseId:'mpp-mcp-original-001',query:{edition:'2026-10',tag:['north','south'],hold:'1'},
  json:{groupBy:'region',name:'München'}};
 const preview=await call('preview',{console:'research',profileId:selected.profileId,offerId:'report',
  inputs:{query:options.query,json:options.json}});
 assert.equal(preview.request.url,origin+'/report?edition=2026-10&hold=1&tag=north&tag=south');
 assert.equal(preview.binding.bodySha256,bindingFacts(api.buildCustomerRequest(contract,'report',options)).bodySha256);
 const queued=await call('prepare',{console:'research',profileId:selected.profileId,offerId:'report',...options});
 await holdSeen;
 const pending=await call('status',{console:'research'});
 assert.equal(pending.purchases.items.find(row=>row.id===options.purchaseId).phase,'PREPARATION_INCOMPLETE');
 assert.equal((await call('purchase',{console:'research',purchaseId:options.purchaseId})).phase,'PREPARATION_INCOMPLETE');
 await mcpApp.close();mcpApp=null;
 assert.equal((await consoleApp.workspace.metadata()).customer,selected.profileId);
 mcpApp=await startMerchantMcp({configPath:initialized.configuration,port:mcpPort,environment});
 client=await openMerchantFileClient({url:mcpUrl,environment,errorPrefix:'MPP'});
 assert.equal((await call('customer_review_status',{console:'research',reviewId:reviewed.reviewId})).state,'SELECTED');
 releaseHeld();
 const first=(await waitJob(queued.job.id,options.purchaseId)).result;
 assert.equal(first.phase,'REVIEW_READY');
 assert.equal(first.customer.contractSha256,contract.sha256);
 const firstChallenge=first.challenge.id;
 assert.equal(received.filter(row=>row.url===preview.request.url.slice(origin.length)).length,1);
 await assert.rejects(call('response_preview',{console:'research',purchaseId:options.purchaseId}),
  error=>error.code==='MPP_CUSTOMER_RESPONSE_NOT_READY');
 failNext=true;
 const interruptedId='mpp-mcp-retry-001';
 const interrupted=await call('prepare',{console:'research',profileId:selected.profileId,offerId:'report',
  purchaseId:interruptedId,query:{edition:'retry'},json:{retain:'original'}});
 assert.equal((await waitJob(interrupted.job.id,interruptedId,'FAILED')).error,'MPP_NATIVE_CHALLENGE_REQUIRED');
 const changedProfile=structuredClone(profile);changedProfile.routes[0].resource.value.rows=4;
 const changedContract=api.merchantContract(changedProfile);
 const pendingReview=await call('customer_review',{console:'research',customer:'standard',
  reviewId:'mcp-review-revision',document:changedContract});
 await consoleRequest('/api/profile',{kind:'merchant',profile,revision:(await consoleApp.workspace.metadata()).revision});
 assert.equal((await call('customer_review_status',{console:'research',reviewId:pendingReview.reviewId})).state,'REVISION_CHANGED');
 await assert.rejects(call('customer_configure',{console:'research',reviewId:pendingReview.reviewId,
  expectedReviewSha256:pendingReview.reviewSha256}),error=>error.code==='MPP_PROFILE_REVISION_CHANGED');
 const newReview=await call('customer_review',{console:'research',customer:'standard',
  reviewId:'mcp-review-current',document:changedContract});
 await call('customer_configure',{console:'research',reviewId:newReview.reviewId,expectedReviewSha256:newReview.reviewSha256});
 assert.equal((await call('purchase',{console:'research',purchaseId:options.purchaseId})).challenge.id,firstChallenge);
 const catalog=await call('catalog',{console:'research'});
 assert.equal(catalog.contract.sha256,contract.sha256);
 const firstChunk=await call('handoff_file',{console:'research',kind:'package',profileId:contract.profileId,limit:4096});
 assert(firstChunk.bytes>128*1024);assert.equal(firstChunk.complete,false);
 const exportArgs={console:'research',exportId:'mpp-native-customer-package',kind:'package',
  profileId:contract.profileId,expectedSha256:firstChunk.sha256};
 const exported=await call('export',exportArgs);
 assert.equal(exported.state,'MANIFEST_RETAINED');assert.equal(exported.manifest.files[0].name,'mpp-package.json');
 assert.equal((await call('export',exportArgs)).recovered,true);
 const originalCreatedAt=consoleApp.readiness.createdAt;
 const closeOne=consoleApp.close(),closeTwo=consoleApp.close();assert.equal(closeOne,closeTwo);
 await closeTwo;consoleApp=null;
 assert.equal((await call('customer_review_status',{console:'research',reviewId:reviewed.reviewId})).state,'CONSOLE_UNAVAILABLE');
 assert.equal((await call('export',exportArgs)).manifestFile.sha256,exported.manifestFile.sha256);
 const inspected=await inspectMppDownload({url:mcpUrl,exportId:exportArgs.exportId,environment});
 assert.equal(inspected.manifestSha256,exported.manifestFile.sha256);
 let interruptedBytes=0;
 const receivedDirectory=join(directory,'retained-download');
 await assert.rejects(downloadMppExport({url:mcpUrl,exportId:exportArgs.exportId,
  directory:receivedDirectory,environment,chunkSize:16384,expectedManifestSha256:inspected.manifestSha256,
  onProgress:({bytes})=>{interruptedBytes=bytes;throw Object.assign(new Error('Original receiver interrupted after a durable chunk'),{code:'JOURNEY_RECEIVER_INTERRUPTED'});}}),
  error=>error.code==='JOURNEY_RECEIVER_INTERRUPTED');
 assert.equal(interruptedBytes,16384);
 await mcpApp.close();mcpApp=null;
 mcpApp=await startMerchantMcp({configPath:initialized.configuration,port:mcpPort,environment});
 client=await openMerchantFileClient({url:mcpUrl,environment,errorPrefix:'MPP'});
 const resumed=await downloadMppExport({url:mcpUrl,exportId:exportArgs.exportId,
  directory:receivedDirectory,environment,chunkSize:16384,expectedManifestSha256:inspected.manifestSha256});
 assert.equal(resumed.state,'COMPLETE');assert.equal(resumed.resumed,true);assert.equal(resumed.resumedBytes,interruptedBytes);
 const originalBytes=await readFile(join(receivedDirectory,'mpp-package.json'));
 assert.equal(hash(originalBytes),firstChunk.sha256);
 const customerBundle=JSON.parse(originalBytes.toString('utf8'));
 assert.equal(customerBundle.sha256,bundle.sha256);
 const receiver=join(directory,'native-customer');
 const receivedPackage=await api.receiveCustomerBundle({bundle:customerBundle,directory:receiver});
 assert.equal(receivedPackage.state,'COMPLETE');assert.equal(receivedPackage.files.length,12);
 assert(receivedPackage.files.every(file=>file.state==='MATCH'));
 for(const path of ['examples/node.mjs','examples/python.py'])
  assert.equal(hash(await readFile(join(receiver,path))),customerBundle.files.find(file=>file.name===path).sha256);
 assert.equal((await api.resumeCustomerExport(receiver)).state,'COMPLETE');
 consoleApp=await serveWorkspace({directory:customerDirectory,port:Number(consolePort),environment,tokenEnv:'MPP_CONSOLE_TOKEN'});
 assert.equal(consoleApp.readiness.createdAt,originalCreatedAt);
 const recoveredJob=await call('job',{console:'research',jobId:queued.job.id,purchaseId:options.purchaseId});
 assert.equal(recoveredJob.state,'JOB_NOT_RETAINED');assert.equal(recoveredJob.purchase.challenge.id,firstChallenge);
 const retry=await call('retry_prepare',{console:'research',purchaseId:interruptedId});
 const retried=(await waitJob(retry.job.id,interruptedId)).result;
 assert.equal(retried.phase,'REVIEW_READY');assert.equal(retried.customer.contractSha256,contract.sha256);
 assert.equal(retried.request.bodySha256,bindingFacts(api.buildCustomerRequest(contract,'report',
  {query:{edition:'retry'},json:{retain:'original'}})).bodySha256);
 await merchant.close();merchant=await serveMerchant({workspace,profile:changedProfile,port:0,environment});
 assert.equal((await call('contract',{console:'research',customer:'standard',origin})).contract.sha256,changedContract.sha256);
 const observed={source:'native merchant MCP product4',runtime:native.versions,
  transport:{factory:'initializeMppMerchant/startMerchantMcp',protocol:'2025-11-25',nativeTools:mppTools.length},
  identity:'authenticated original workspace, createdAt, pid and ppid; schema-first readiness and shared close promise',
  customerReview:{bundleBytes:documentBytes,originalReviewReopened:true,selectedRevisionRecovered:true,
   interveningRevisionObserved:true,privateRpcOriginOnly:true},
  nativePrepare:'REVIEW_READY through actual published SDK and TLS-verified original merchant',
  lifecycle:'MCP restart during original pending preparation preserves the borrowed console workspace and original job',
  recovery:{originalPurchases:2,sameOriginalChallenge:true,originalPreparationAfterActiveContractChangeAndConsoleRestart:true},
  receiving:{exportId:exportArgs.exportId,sha256:firstChunk.sha256,bytes:originalBytes.length,
   interruptedBytes,resumedBytes:resumed.resumedBytes,consoleOffline:true,mcpRestart:true,
   nativeFiles:receivedPackage.files.length,nestedExamples:['examples/node.mjs','examples/python.py']},
  merchantRequests:received.length};
 await writeFile(join(directory,'result.json'),JSON.stringify(observed,null,2)+'\n');
 console.log(JSON.stringify(observed));
} finally {
 releaseHeld();
 await mcpApp?.close().catch(()=>{});
 await consoleApp?.close().catch(()=>{});
 await merchant?.close().catch(()=>{});await workspace?.close().catch(()=>{});
 for(const socket of sockets)socket.destroy();
 await Promise.all([tlsServer,proxy].map(server=>new Promise(resolve=>server.close(resolve))));
}
