// MIT. Sequential direct-store receiving on the completed original managed fixture.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, writeFile, open, rename, unlink, mkdir, chmod, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCT='76ae7734c737b2eae5f909c3fef4312d28d3c455';
const OPERATION='SCF-MANAGED-SF98-DELIVERY-E49D-20261012';
const EXPECTED_SOURCE_FILES=[
  {
    "path": "stellar/scf-starforge-20261009/sf82-seller-pilot/release-delivery-console.mjs",
    "bytes": 12989,
    "sha256": "03281a53c208bd54357e9a75d39c7f381f701fcffd4b8b95cbe5adf2e3fd7547"
  },
  {
    "path": "stellar-forge/mcp-merchant-operator/delivery-download.mjs",
    "bytes": 14448,
    "sha256": "14ae789734054dd31baf2deff328123da2fe924e8d7fbae10d01ef38050e6e88"
  },
  {
    "path": "stellar-forge/mcp-merchant-operator/delivery.mjs",
    "bytes": 1541,
    "sha256": "16ec585e6445f6b732b9a9852e703fd100f5a334af07ef6fc236cae817aac763"
  },
  {
    "path": "stellar-forge/mcp-merchant-operator/catalog/delivery.mjs",
    "bytes": 5285,
    "sha256": "5ed805405c13871a25b76db57b85ecf161178effea48fcf67f5d3cde4f972181"
  },
  {
    "path": "stellar-forge/mcp-merchant-operator/providers/delivery.mjs",
    "bytes": 1332,
    "sha256": "caa633984272472237351796c48086d615064e4e65f1272f79545c80cced484c"
  },
  {
    "path": "stellar/scf-starforge-20261009/distribution/contributions/merchant-provider-delivery.json",
    "bytes": 524,
    "sha256": "d1da6f858c0885aac75474721f043d657e2a50f1ada5d13ef50391db883b83d8"
  },
  {
    "path": "stellar/scf-starforge-20261009/sf82-seller-pilot/release-delivery-cli.mjs",
    "bytes": 7761,
    "sha256": "94c7c8040cdf45130faeb8f366330badc73d8e98a36a71ab5db5e3dc55726df3"
  },
  {
    "path": "stellar/scf-starforge-20261009/sf82-seller-pilot/release-ui/delivery.mjs",
    "bytes": 19652,
    "sha256": "315ebfb98bbc9dd2eb4b0ddd66f77a19d6910a878af5f13b0cf4dd4859436438"
  },
  {
    "path": "stellar/scf-starforge-20261009/sf82-seller-pilot/release-console.mjs",
    "bytes": 23338,
    "sha256": "0693f806fb8cb589761dde1db5b693cbb9177683305f67282e7a956083bbcc2d"
  },
  {
    "path": "stellar/scf-starforge-20261009/sf82-seller-pilot/release-ui/browser-assets.json",
    "bytes": 1100,
    "sha256": "6b47f4fbb5214a0d5dee38e6fb287923438f68f14dbbbc7d94b654160d72a0a2"
  },
  {
    "path": "stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs",
    "bytes": 17891,
    "sha256": "c7f75093edda14749fd00dac10a1ffb4d0805537f63a0ff74b10e012d3aa52e7"
  },
  {
    "path": "stellar/scf-starforge-20261009/sf82-seller-pilot/release-ui/app.mjs",
    "bytes": 33545,
    "sha256": "ab0a662b5c2946224b59154fac949e78af1b2bdd433e8c71469e48ebd00bbf00"
  },
  {
    "path": "stellar/scf-starforge-20261009/sf82-seller-pilot/release-ui/index.html",
    "bytes": 17004,
    "sha256": "dcb31d68f3bf673c25306b6bb62f271bd6e5a5c672878066109305d3021d13cc"
  },
  {
    "path": "stellar/scf-starforge-20261009/sf82-seller-pilot/release-ui/style.css",
    "bytes": 12514,
    "sha256": "3f76af76fa08b3f29033be81fefcda9d43e99ca89ccbc242a8d58dfaeb10d508"
  },
  {
    "path": "stellar/scf-starforge-20261009/distribution/contributions/release-delivery-console.json",
    "bytes": 992,
    "sha256": "98010fc963a9ba11f9eed757e08a4ac04c36b81f86bf0d6491c821a2ecd6beff"
  },
  {
    "path": "stellar/scf-starforge-20261009/sf82-seller-pilot/DELIVERY.md",
    "bytes": 10427,
    "sha256": "c0dd40b8726262536c43f073355c0fcbc2bd5dc79942664aab684cd728f5e09a"
  }
];
const here=dirname(fileURLToPath(import.meta.url));
const source=resolve(process.env.SINGLE_DELIVERY_SOURCE??join(here,'../..'));
const managedRoot=resolve(process.env.SF98_DELIVERY_OUTPUT??join(source,'experiments/managed-settlement-delivery-acceptance/run-native'));
const root=resolve(process.env.SINGLE_DELIVERY_OUTPUT??join(managedRoot,'single-release-receiving'));
const sdk=join(source,'stellar/scf-starforge-20261009'),seller=join(sdk,'sf82-seller-pilot');
const python=process.env.SF98_DELIVERY_PYTHON??process.env.CODEX_PRIMARY_RUNTIME_PYTHON??'python3';
const execute=promisify(execFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const managedBytes=await readFile(join(managedRoot,'receipt.json'));
const managed=JSON.parse(managedBytes);
assert.equal(managed.operation,OPERATION);
assert.equal(managed.state,'PASS');
for(const key of ['nativeComplete','browserComplete','mcpComplete','ownedProcessesClosed'])assert.equal(managed[key],true,key);
assert.equal(typeof managed.stores?.blue,'string');
const store=managed.stores.blue;
await mkdir(root,{recursive:true,mode:0o700});await chmod(root,0o700);
const receiptFile=join(root,'receipt.json');
let receipt;
try{receipt=JSON.parse(await readFile(receiptFile,'utf8'));}
catch(error){if(error.code!=='ENOENT')throw error;receipt={schema:'scratch.single-release-delivery-receiving.v1',
 operation:OPERATION,phase:'DIRECT_SINGLE_RELEASE',product:PRODUCT,managedReceiptSha256:sha(managedBytes),
 managedDirectory:managedRoot,releaseStore:store,state:'RUNNING',milestones:[],browserErrors:[]};}
assert.equal(receipt.operation,OPERATION);assert.equal(receipt.product,PRODUCT);
assert.equal(receipt.releaseStore,store);assert.equal(receipt.managedReceiptSha256,sha(managedBytes));
async function save(){
 const path=receiptFile+'.'+randomUUID()+'.tmp';let handle;
 try{handle=await open(path,'wx',0o600);await handle.writeFile(json(receipt));await handle.sync();await handle.close();handle=null;
  await rename(path,receiptFile);const parent=await open(root,'r');try{await parent.sync();}finally{await parent.close();}}
 finally{await handle?.close();await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function mark(name,details={}){receipt.milestones.push({name,at:new Date().toISOString(),...details});await save();process.stdout.write(JSON.stringify({phase:name,...details})+'\n');}
async function present(path){try{await stat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function fixedFile(path,bytes){
 if(await present(path)){assert.equal(sha(await readFile(path)),sha(bytes));return;}
 await writeFile(path,bytes,{flag:'wx',mode:0o600});
}
const observedSource=[];
for(const expected of EXPECTED_SOURCE_FILES){
 const bytes=await readFile(join(source,expected.path)),digest=sha(bytes);
 assert.equal(bytes.length,expected.bytes,'Selected original product size: '+expected.path);
 assert.equal(digest,expected.sha256,'Selected original product bytes: '+expected.path);
 observedSource.push({path:expected.path,bytes:bytes.length,sha256:digest});
}
receipt.sourceFiles=observedSource;receipt.sourceDirectory=source;await save();
const secrets=JSON.parse(await readFile(join(managedRoot,'private-environment.json'),'utf8'));
for(const [name,value]of Object.entries(secrets)){assert(/^[A-Z][A-Z0-9_]+$/.test(name));process.env[name]=value;}
const {startReleaseConsole}=await import(join(seller,'release-console.mjs'));
const {createReleaseDeliveryConsole}=await import(join(seller,'release-delivery-console.mjs'));
const {downloadDeliveryExchange,reopenDeliveryDownload}=await import(join(source,'stellar-forge/mcp-merchant-operator/delivery-download.mjs'));
const {openDestinationWorkspace}=await import(join(sdk,'sf98-merchant-delivery/destinations/model.mjs'));
const {readMerchantConfig,CONFIG_SCHEMA}=await import(join(source,'stellar-forge/mcp-merchant-operator/config.mjs'));
const {startMerchantMcp}=await import(join(source,'stellar-forge/mcp-merchant-operator/serve.mjs'));
let consoleApp,browser,facilitator,mcp,desk;
const token=randomBytes(32).toString('hex');
process.env.E49_SINGLE_DELIVERY_MCP_TOKEN=token;
const pause=ms=>new Promise(done=>setTimeout(done,ms));
async function until(read,condition,title){
 const deadline=Date.now()+30000;let value;
 while(Date.now()<deadline){value=await read();if(condition(value))return value;await pause(80);}
 throw Error(title+': '+JSON.stringify(value));
}
const closeServer=server=>new Promise((done,fail)=>{
 if(!server?.listening)return done();
 server.close(error=>error?fail(error):done());server.closeIdleConnections?.();
});
async function retainMcpPort(){
 if(receipt.mcpPort!==undefined){
  assert(Number.isSafeInteger(receipt.mcpPort)&&receipt.mcpPort>0&&receipt.mcpPort<=65535);
  return receipt.mcpPort;
 }
 const reservation=createServer();
 try{
  await new Promise((done,fail)=>{reservation.once('error',fail);reservation.listen(0,'127.0.0.1',done);});
  receipt.mcpPort=reservation.address().port;
 }finally{await closeServer(reservation);}
 // The original downloader binds this exact endpoint. Keep it through any
 // interrupted download/CLI continuation instead of silently selecting a new URL.
 await save();return receipt.mcpPort;
}
async function consoleApi(path,input){
 const response=await fetch(consoleApp.url+path,{method:input===undefined?'GET':'POST',
  headers:{'x-release-token':consoleApp.token,...(input===undefined?{}:{'content-type':'application/json'})},
  ...(input===undefined?{}:{body:JSON.stringify(input)}),signal:AbortSignal.timeout(30000)});
 const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;
}
async function cli(args){
 const result=await execute(process.execPath,[join(seller,'release-cli.mjs'),'delivery',...args],
  {env:{...process.env},maxBuffer:4*1024*1024,timeout:45000});
 return JSON.parse(result.stdout);
}
async function startFacilitator(){
 facilitator=createServer((request,response)=>{
  receipt.facilitatorReads=(receipt.facilitatorReads??0)+1;
  const value=request.url==='/supported'?{kinds:[{x402Version:2,scheme:'exact',network:'stellar:testnet'}],extensions:['bazaar'],signers:{}}:null;
  response.writeHead(value?200:404,{'content-type':'application/json'});response.end(JSON.stringify(value??{}));
 });
 await new Promise((done,fail)=>{facilitator.once('error',fail);facilitator.listen(managed.portStart+6,'127.0.0.1',done);});
}
async function browserPhase(){
 await startFacilitator();
 consoleApp=await startReleaseConsole(store,{port:0,env:{...process.env}});
 const originalRequire=createRequire(join(resolve(process.env.SF98_DELIVERY_NODE_MODULES??process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES??join(source,'node_modules')),'runtime-loader.cjs'));
 const {chromium}=originalRequire('playwright');
 browser=await chromium.launch({headless:true,...(process.env.SF98_DELIVERY_CHROMIUM?{executablePath:process.env.SF98_DELIVERY_CHROMIUM}:{}),
  args:['--no-sandbox','--disable-gpu','--disable-background-networking','--renderer-process-limit=1']});
 const context=await browser.newContext({viewport:{width:1380,height:1000},acceptDownloads:true});
 await context.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
 const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>receipt.browserErrors.push(error.message));
 await page.goto(consoleApp.operatorUrl);
 await page.waitForFunction(()=>document.querySelector('#delivery-refresh')&&!document.querySelector('#delivery-refresh').disabled);
 let state=await consoleApi('/api/delivery/status');
 assert.equal(state.releaseStore,store);assert.equal(state.originalSource.uniqueNativeReceipts,2);
 assert.equal(state.destinations.destinations.length,3);
 const started=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/run');
 await page.locator('#start').click();assert.equal((await started).status(),200);
 state=await until(()=>consoleApi('/api/delivery/status'),value=>value.producer?.owned===true,'Original direct console producer ownership');
 assert.equal(state.originalSource.uniqueNativeReceipts,2);
 const stopped=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/stop');
 await page.locator('#stop').click();assert.equal((await stopped).status(),200);
 await until(()=>consoleApi('/api/status'),value=>value.console.managesRunningSeller===false,'Original seller close');
 const popupPromise=page.waitForEvent('popup');await page.locator('#delivery-controls').click();
 const controls=await popupPromise;controls.on('pageerror',error=>receipt.browserErrors.push(error.message));
 await controls.waitForFunction(()=>document.querySelector('#source-count')?.textContent==='2');
 await controls.getByRole('button',{name:'Original new-event audit',exact:true}).click();
 assert.equal(await controls.locator('#toggle-pause').textContent(),'Resume receiver');
 await controls.screenshot({path:join(root,'original-destination-controls.png'),fullPage:true});
 await controls.close();
 const worker=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/delivery/control');
 await page.locator('#delivery-start').click();assert.equal((await worker).status(),200);
 await until(()=>consoleApi('/api/delivery/status'),value=>value.destinations.worker.run?.cycles>=1,'Direct original worker cycle');
 await page.locator('#delivery-refresh').click();
 await page.waitForFunction(()=>!document.querySelector('#delivery-stop').disabled);
 const workerStop=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/delivery/control');
 await page.locator('#delivery-stop').click();assert.equal((await workerStop).status(),200);
 await page.waitForFunction(()=>!document.querySelector('#delivery-create-transfer').disabled||!document.querySelector('#delivery-refresh').disabled);
 const id='single-store-receiving',routeUrl=consoleApp.url+'/api/delivery/transfer';
 await page.locator('#delivery-transfer-id').fill(id);
 if(!receipt.lostCaptureResponse){
  await page.route(routeUrl,async route=>{
   if(route.request().method()!=='POST')return route.continue();
   const exact=route.request().postDataJSON(),response=await route.fetch();assert.equal(response.status(),200);
   const captured=await response.json();
   receipt.capture={id,fingerprint:captured.fingerprint,sourceFingerprint:captured.source.fingerprint};
   receipt.captureRequest=exact;receipt.lostCaptureResponse=true;await save();await route.abort('failed');
  });
  await page.locator('#delivery-create-transfer').click();
  await until(async()=>receipt.lostCaptureResponse,Boolean,'Committed original capture response');
  await page.waitForFunction(()=>!document.querySelector('#delivery-refresh').disabled);
  await page.unroute(routeUrl);
  await page.goto(consoleApp.operatorUrl);
  await page.waitForFunction(()=>document.querySelector('#delivery-create-transfer')?.textContent==='Resume saved capture');
  assert.equal(await page.locator('#delivery-transfer-id').inputValue(),id);
  const replay=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/delivery/transfer');
  await page.locator('#delivery-create-transfer').click();const replayed=await replay;
  assert.equal(replayed.status(),200);assert.equal((await replayed.json()).retained,true);
  receipt.captureReplayed=true;await save();
 }else if(!receipt.captureReplayed){
  // A process restart creates a new browser context. Submit the actual retained
  // request again through this same native form before recording replay success.
  await page.route(routeUrl,async route=>{
   if(route.request().method()!=='POST')return route.continue();
   assert.deepEqual(route.request().postDataJSON(),receipt.captureRequest);
   await route.continue();
  });
  const replay=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/delivery/transfer');
  await page.locator('#delivery-create-transfer').click();const replayed=await replay;
  assert.equal(replayed.status(),200);assert.equal((await replayed.json()).retained,true);
  receipt.captureReplayed=true;await save();await page.unroute(routeUrl);
 }else{
  await page.locator('#delivery-inspect').click();
 }
 await page.waitForFunction(()=>!document.querySelector('#delivery-review').hidden&&!document.querySelector('#delivery-download').disabled);
 const manifest=await consoleApi('/api/delivery/manifest?'+new URLSearchParams({id,expectedFingerprint:receipt.capture.fingerprint}));
 assert.equal(manifest.source.events,2);assert.equal(manifest.destinations.length,3);
 assert.deepEqual(receipt.captureRequest,{id,expectedSourceFingerprint:manifest.source.fingerprint});
 const downloadEvent=page.waitForEvent('download');await page.locator('#delivery-download').click();
 const download=await downloadEvent,archive=join(root,'single-store-delivery.tar.gz');await download.saveAs(archive);
 const extracted=join(root,'browser-exchange');await mkdir(extracted,{recursive:true,mode:0o700});await chmod(extracted,0o700);
 await execute(python,['-B','-c',
  'import tarfile,pathlib,sys\nroot=pathlib.Path(sys.argv[2])\nwith tarfile.open(sys.argv[1]) as t:\n members=t.getmembers()\n assert all((m.isfile() or m.isdir()) and not pathlib.PurePosixPath(m.name).is_absolute() and ".." not in pathlib.PurePosixPath(m.name).parts for m in members)\n t.extractall(root,filter="data")',archive,extracted]);
 for(const file of manifest.files){const bytes=await readFile(join(extracted,file.name));assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);}
 await page.screenshot({path:join(root,'single-release-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
 await page.screenshot({path:join(root,'single-release-mobile.png'),fullPage:true});
 assert.deepEqual(receipt.browserErrors,[]);
 await browser.close();browser=null;await consoleApp.close();consoleApp=null;await closeServer(facilitator);facilitator=null;
 receipt.browserComplete=true;receipt.manifest=manifest;
 await mark('Original release console, mounted destinations, owned seller, worker and saved capture replay completed',
  {sourceEvents:2,destinations:3,files:manifest.files.length,fingerprint:manifest.fingerprint,browserErrors:0,mobileWidth:390});
}
async function localPhase(){
 const current=await cli(['status','--store',store]);
 assert.equal(current.originalSource.uniqueNativeReceipts,2);assert.equal(current.destinations.worker.owner.active,false);
 const listed=await cli(['transfers','--store',store]);assert(listed.transfers.some(row=>row.id===receipt.capture.id));
 const manifest=await cli(['manifest','--store',store,'--id',receipt.capture.id,'--fingerprint',receipt.capture.fingerprint]);
 assert.equal(manifest.fingerprint,receipt.manifest.fingerprint);
 const directory=join(root,'local-download');
 const result=await cli(['download','--store',store,'--id',receipt.capture.id,'--fingerprint',receipt.capture.fingerprint,'--directory',directory,'--chunk-size','128']);
 assert.equal(result.state,'COMPLETE');assert.equal(result.exchangeDirectory,join(directory,'exchange'));
 const reopened=await cli(['reopen','--directory',directory,'--id',receipt.capture.id,'--fingerprint',receipt.capture.fingerprint]);
 assert.equal(reopened.fingerprint,receipt.capture.fingerprint);
 receipt.localComplete=true;
 await mark('Original release CLI completed the exact nested exchange and reopened the verified local files',
  {files:manifest.files.length,directory:result.directory,exchangeDirectory:result.exchangeDirectory});
}
async function rpc(method,params={}){
 const response=await fetch(mcp.url,{method:'POST',headers:{authorization:'Bearer '+token,
  'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'},
  body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method,params}),signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,200);const value=await response.json();assert.equal(value.error,undefined);return value.result;
}
async function call(name,args={}){const result=await rpc('tools/call',{name,arguments:args});assert.equal(Boolean(result.isError),false,JSON.stringify(result.structuredContent));return result.structuredContent;}
async function mcpPhase(){
 const configRoot=join(root,'merchant-mcp');await mkdir(configRoot,{recursive:true,mode:0o700});await chmod(configRoot,0o700);
 const exports=join(configRoot,'customer-exports');await mkdir(exports,{recursive:true,mode:0o700});await chmod(exports,0o700);
 const configPath=join(configRoot,'merchant-mcp.json');
 await fixedFile(configPath,Buffer.from(json({schema:CONFIG_SCHEMA,name:'Original direct-store delivery receiving',
  releaseStore:store,exportsDirectory:exports,sources:{}})));
 await readMerchantConfig(configPath);
 mcp=await startMerchantMcp({configPath,port:await retainMcpPort(),environment:{...process.env,MCP_ACCESS_TOKEN:token}});
 assert.equal(Number(new URL(mcp.url).port),receipt.mcpPort);
 await rpc('initialize');
 const tools=(await rpc('tools/list')).tools.filter(row=>row.name.startsWith('merchant_delivery_'));
 assert.equal(tools.length,10);
 const status=await call('merchant_delivery_status');
 assert.equal(status.releaseStore,store);assert.equal(status.originalSource.uniqueNativeReceipts,2);
 const manifest=await call('merchant_delivery_manifest',{id:receipt.capture.id,expectedFingerprint:receipt.capture.fingerprint});
 const file=manifest.files.find(row=>row.name==='source/events.ndjson');
 const block=await call('merchant_delivery_file',{id:manifest.id,expectedFingerprint:manifest.fingerprint,name:file.name,expectedSha256:file.sha256,offset:0,limit:128});
 assert.equal(block.bytesRead,128);
 await call('merchant_delivery_file_release',{id:manifest.id,readId:block.readId});
 const options={url:mcp.url,tokenEnv:'E49_SINGLE_DELIVERY_MCP_TOKEN',environment:{...process.env},
  id:manifest.id,expectedFingerprint:manifest.fingerprint,directory:join(root,'remote-download'),chunkSize:128};
 if(!receipt.interruptedDownload){
  const controller=new AbortController();let observed=false;
  await assert.rejects(downloadDeliveryExchange({...options,signal:controller.signal,onProgress:async progress=>{
   if(observed)return;observed=true;
   receipt.interruptedDownload={file:progress.file,bytes:progress.bytes,state:progress.state};await save();
   controller.abort(new Error('ORIGINAL_RETAINED_DOWNLOAD_CONTINUATION'));
  }}));
  assert(observed);assert.equal(receipt.interruptedDownload.bytes,128);
 }
 const completed=await cli(['download','--url',mcp.url,'--token-env','E49_SINGLE_DELIVERY_MCP_TOKEN',
  '--id',manifest.id,'--fingerprint',manifest.fingerprint,'--directory',options.directory,'--chunk-size','128']);
 assert.equal(completed.state,'COMPLETE');assert.equal(completed.resumed,true);assert(completed.resumedBytes>=128);
 const receiving=join(root,'received-customer');
 const receiveArgs=['receive','--directory',options.directory,'--id',manifest.id,'--fingerprint',manifest.fingerprint,'--workspace',receiving];
 const received=await cli(receiveArgs);assert.equal(received.fingerprint,manifest.fingerprint);
 const model=await openDestinationWorkspace({directory:join(receiving,'workspace'),sourceDirectory:join(receiving,'source')});
 try{
  const state=await model.state();assert.equal(state.source.events,2);assert.equal(state.destinations.length,3);
  for(const id of ['accounting','fulfillment'])assert.equal(state.destinations.find(row=>row.id===id).outbox.delivered,2);
  const audit=state.destinations.find(row=>row.id==='audit');
  if(audit.paused)await model.setPaused({id:'audit',paused:false,expectedRevision:audit.revision});
 }finally{await model.close();}
 const replay=await cli(receiveArgs);assert.equal(replay.retained,true);
 assert.equal(replay.current.destinations.find(row=>row.id==='audit').paused,false);
 await call('merchant_delivery_control',{action:'start',input:{pollMs:100}});
 await call('merchant_delivery_stop');
 await mcp.close();mcp=null;
 const independent=await reopenDeliveryDownload({directory:options.directory,id:manifest.id,expectedFingerprint:manifest.fingerprint});
 assert.equal(independent.state,'COMPLETE');
 desk=createReleaseDeliveryConsole(store);
 const retained=await desk.transferManifest({id:manifest.id,expectedFingerprint:manifest.fingerprint});
 assert.equal(retained.fingerprint,manifest.fingerprint);await desk.close();desk=null;
 receipt.mcpComplete=true;receipt.receivedDirectory=join(receiving,'workspace');
 await mark('Ten original MCP tools, interrupted native download, CLI resume and same-customer receive replay completed',
  {tools:tools.map(row=>row.name),resumedBytes:completed.resumedBytes,sourceEvents:2,destinations:3,
   originalDeliveredHistories:2,currentCustomerEditPreserved:true,receivedDirectory:receipt.receivedDirectory});
}
async function cleanup(){
 const failures=[];
 for(const value of [browser,consoleApp,mcp,desk])try{await value?.close();}catch(error){failures.push(error.message);}
 try{await closeServer(facilitator);}catch(error){failures.push(error.message);}
 receipt.ownedProcessesClosed=failures.length===0;receipt.cleanupErrors=failures;
 if(failures.length){receipt.state='FAILED';process.exitCode=1;}
 assert.equal(sha(await readFile(join(managedRoot,'receipt.json'))),receipt.managedReceiptSha256,'The original managed receipt remains unchanged');
 receipt.finishedAt=new Date().toISOString();await save();
}
try{
 const phase=process.argv[2]??'all';assert(['all','browser','cli','mcp'].includes(phase));
 if((phase==='all'||phase==='browser')&&!receipt.browserComplete)await browserPhase();
 if(phase==='all'||phase==='cli'){assert(receipt.browserComplete);if(!receipt.localComplete)await localPhase();}
 if(phase==='all'||phase==='mcp'){assert(receipt.localComplete);if(!receipt.mcpComplete)await mcpPhase();}
 if(receipt.browserComplete&&receipt.localComplete&&receipt.mcpComplete){receipt.state='PASS';delete receipt.error;}
}catch(error){receipt.state='FAILED';receipt.error={message:error.message,stack:String(error.stack).slice(0,6000)};
 process.stderr.write(json(receipt.error));process.exitCode=1;}
finally{await cleanup();}
