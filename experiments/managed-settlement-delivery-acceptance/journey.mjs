// MIT. Original managed merchant → SF98 destination → accounting/fulfillment receiving.
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, chmod, stat, open, rename, unlink } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const repo=resolve(process.env.SF98_DELIVERY_SOURCE??join(here,'../..'));
const base=resolve(process.env.SF98_DELIVERY_OUTPUT??join(here,'run-native'));
const sdk=join(repo,'stellar/scf-starforge-20261009'),fleet=join(sdk,'merchant-fleet-gateway');
const python=process.env.SF98_DELIVERY_PYTHON??process.env.CODEX_PRIMARY_RUNTIME_PYTHON??'python3';
const run=promisify(execFile),sha=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n',query=value=>new URLSearchParams(value).toString();
const {bootstrapFleet}=await import(join(fleet,'release-bootstrap.mjs'));
const {readFleetReleasePlan,openFleetReleaseOperator}=await import(join(fleet,'release-operator.mjs'));
const {dispatchFleetCommand}=await import(join(fleet,'release-cli.mjs'));
const {startFleetWorkspace}=await import(join(fleet,'workspace/server.mjs'));
const {createFleetDeliveryDesk}=await import(join(fleet,'release-delivery.mjs'));
const {openOutbox}=await import(join(sdk,'sf98-merchant-delivery/outbox.mjs'));
const {openDestinationWorkspace}=await import(join(sdk,'sf98-merchant-delivery/destinations/model.mjs'));
const {sendSignedWebhook,drainOnce,nativeWebhookPayload}=await import(join(sdk,'sf98-merchant-delivery/deliver.mjs'));
const {main:destinationMain}=await import(join(sdk,'sf98-merchant-delivery/destinations/cli.mjs'));
const {startAccountingWorkspace}=await import(join(sdk,'merchant-settlement-accounting/workspace/server.mjs'));
const {main:mcpMain,startMerchantMcp}=await import(join(repo,'stellar-forge/mcp-merchant-operator/serve.mjs'));
const originalRequire=createRequire(join(repo,'package.json'));
const {StrKey}=originalRequire('@stellar/stellar-sdk');
const {encodePaymentSignatureHeader}=originalRequire('@x402/core/http');
const receiptFile=join(base,'receipt.json'),directory=join(base,'fleet');
await mkdir(base,{recursive:true,mode:0o700});await chmod(base,0o700);
let receipt;
try{receipt=JSON.parse(await readFile(receiptFile,'utf8'));}
catch(error){if(error.code!=='ENOENT')throw error;receipt={schema:'scratch.managed-settlement-delivery.v1',
 operation:'SCF-MANAGED-SF98-DELIVERY-E49D-20261012',source:repo,state:'RUNNING',milestones:[],payments:[],webhooks:[],browserErrors:[]};}
assert.equal(receipt.operation,'SCF-MANAGED-SF98-DELIVERY-E49D-20261012');
async function save(path,value){
 const tmp=path+'.'+randomUUID()+'.tmp';let f;
 try{f=await open(tmp,'wx',0o600);await f.writeFile(json(value));await f.sync();await f.close();f=null;await rename(tmp,path);
  const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}}
 finally{await f?.close();await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
async function mark(name,value={}){
 receipt.milestones.push({name,at:new Date().toISOString(),...value});await save(receiptFile,receipt);
 process.stdout.write(JSON.stringify({phase:name,...value})+'\n');
}
async function onceFile(path,bytes){
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 try{assert.equal(sha(await readFile(path)),sha(bytes),'Continue the same retained fixture: '+path);}
 catch(error){if(error.code!=='ENOENT')throw error;await writeFile(path,bytes,{flag:'wx',mode:0o600});}
}
async function exists(path){try{await stat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
const nap=ms=>new Promise(done=>setTimeout(done,ms));
async function until(work,predicate,label,ms=20000){
 const deadline=Date.now()+ms;let value;
 while(Date.now()<deadline){value=await work();if(predicate(value))return value;await nap(60);}
 throw Error(label+': '+JSON.stringify(value));
}
const closeServer=server=>new Promise((done,fail)=>{
 if(!server?.listening)return done();server.close(error=>error?fail(error):done());server.closeIdleConnections?.();
});
async function findPorts(){
 for(let attempt=0;attempt<40;attempt++){
  const first=21000+Math.floor(Math.random()*30000),held=[];
  try{for(let i=0;i<8;i++){const s=createServer();held.push(s);await new Promise((done,fail)=>{s.once('error',fail);s.listen(first+i,'127.0.0.1',done);});}return first;}
  catch{}finally{await Promise.all(held.map(closeServer));}
 }throw Error('Eight original loopback ports unavailable');
}
const publicHost='delivery.fleet.example',referenceHost='reference.delivery.fleet.example',scope={tenant:'python',slot:'blue'};
let workspace,accounting,receiver,browser,mcp,operator,sessionKey,wireId=0;
let closed=false,facilitator,receiverSpawnError;
function receiverExited(child){
 return child.exitCode!==null||child.signalCode!==null;
}
async function waitForReceiverExit(child,milliseconds){
 if(receiverExited(child))return true;
 return new Promise(done=>{
  let timer;
  const finish=value=>{clearTimeout(timer);child.removeListener('exit',onExit);done(value);};
  const onExit=()=>finish(true);
  child.once('exit',onExit);
  timer=setTimeout(()=>finish(receiverExited(child)),milliseconds);
  if(receiverExited(child))finish(true);
 });
}
async function stopReceiver(){
 const child=receiver;if(!child)return;
 // A failed spawn has no operating-system child. A successfully spawned child
 // remains owned until its actual exit is observed, including after escalation.
 if(receiverSpawnError&&child.pid===undefined){receiver=null;return;}
 if(!receiverExited(child)){
  child.kill('SIGTERM');
  if(!await waitForReceiverExit(child,3000)){
   child.kill('SIGKILL');
   if(!await waitForReceiverExit(child,3000))throw Error('Owned SF101 receiver did not exit after SIGKILL');
  }
 }
 assert(receiverExited(child),'Owned SF101 receiver exit was not observed');
 receiver=null;
}
async function loadSecrets(){
 const path=join(base,'private-environment.json');let values;
 try{values=JSON.parse(await readFile(path,'utf8'));}
 catch(error){if(error.code!=='ENOENT')throw error;values=Object.fromEntries(
  ['E49_SF98_FULFILLMENT_SECRET','E49_SF98_ACCOUNTING_SECRET','E49_SF98_CLAIM','E49_SF98_BACKUP']
   .map(name=>[name,randomBytes(32).toString('hex')]));await save(path,values);}
 for(const [name,value]of Object.entries(values)){assert.equal(typeof value,'string');assert(value.length>=32);process.env[name]=value;}
 return values;
}
const secrets=await loadSecrets(),token=randomBytes(32).toString('hex');
function paymentExchange(url,path,{body,headers={}}={}){
 const bytes=body===undefined?undefined:Buffer.from(JSON.stringify(body));
 return new Promise((done,fail)=>{
  const req=httpRequest({hostname:'127.0.0.1',port:Number(new URL(url).port),path,method:body===undefined?'GET':'POST',
   headers:{host:publicHost,...headers,...(bytes?{'content-type':'application/json','content-length':bytes.length}:{})}},
   res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('error',fail);res.on('end',()=>done({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});
  req.on('error',fail);req.setTimeout(45000,()=>req.destroy(Error('Original merchant response timeout')));req.end(bytes);
 });
}
async function pay(order,amount){
 const old=receipt.payments.find(row=>row.order===order);if(old)return old;
 const body={values:[2,4,6,8],window:2};
 const unpaid=await paymentExchange(workspace.publicURL,'/summary',{body});assert.equal(unpaid.status,402,unpaid.body.toString());
 const challenge=JSON.parse(Buffer.from(unpaid.headers['payment-required'],'base64'));assert.equal(challenge.accepts[0].amount,amount);
 const paid=await paymentExchange(workspace.publicURL,'/summary',{body,headers:{'x-sf98-order-id':order,
  'payment-signature':encodePaymentSignatureHeader({x402Version:2,resource:challenge.resource,accepted:challenge.accepts[0],
   extensions:challenge.extensions,payload:{managedSf98Fixture:order}})}});
 assert.equal(paid.status,200,paid.body.toString());assert(paid.headers['payment-response']);
 const result=JSON.parse(paid.body);assert.equal(result.count,4);assert.equal(result.mean,5);assert.deepEqual(result.rollingMean,[2,3,5,7]);
 const value={order,amount,bytes:paid.body.length,sha256:sha(paid.body),
  nativeReceipt:JSON.parse(Buffer.from(paid.headers['payment-response'],'base64')),
  execution:'Original x402 SDK and original Python application; local facilitator fixture responses'};
 receipt.payments.push(value);await save(receiptFile,receipt);return value;
}
async function api(path,input,expected=200){
 const res=await fetch(workspace.url+'/api/'+path,{method:input===undefined?'GET':'POST',
  headers:{'x-fleet-workspace':sessionKey,...(input===undefined?{}:{'content-type':'application/json'})},
  ...(input===undefined?{}:{body:JSON.stringify(input)}),signal:AbortSignal.timeout(45000)});
 const value=await res.json();assert.equal(res.status,expected,JSON.stringify(value));return value;
}
async function openWorkspace(){
 workspace=await startFleetWorkspace({releasePlan:receipt.planFile,releaseDirectory:directory,port:0});
 sessionKey=(await(await fetch(workspace.url+'/api/session')).json()).session;
 return api('status');
}
const selected=(status,name='blue')=>status.releaseStatus.tenants.find(row=>row.id==='python').slots.find(row=>row.name===name);
async function control(action,input={},selectedScope=scope){return api('releases/delivery/control',{...selectedScope,action,input});}
async function delivery(selectedScope=scope){return api('releases/delivery?'+query(selectedScope));}
async function startFacilitator(){
 if(facilitator)return;
 facilitator=createServer(async(req,res)=>{
  try{
   const chunks=[];for await(const c of req)chunks.push(c);
   const input=chunks.length?JSON.parse(Buffer.concat(chunks)):{};
   let value;
   if(req.url==='/supported')value={kinds:[{x402Version:2,scheme:'exact',network:'stellar:testnet'}],extensions:['bazaar'],signers:{}};
   if(req.url==='/verify')value={isValid:true,payer:'ORIGINAL_E49_LOCAL_FACILITATOR_FIXTURE'};
   if(req.url==='/settle'){
    receipt.settleCalls=(receipt.settleCalls??0)+1;
    value={success:true,network:'stellar:testnet',transaction:sha('LOCAL_FIXTURE\n'+JSON.stringify(input)),
     payer:'ORIGINAL_E49_LOCAL_FACILITATOR_FIXTURE'};
   }
   res.writeHead(value?200:404,{'content-type':'application/json'});res.end(JSON.stringify(value??{}));
  }catch{res.writeHead(500);res.end();}
 });
 await new Promise((done,fail)=>{facilitator.once('error',fail);facilitator.listen(receipt.portStart+6,'127.0.0.1',done);});
}
async function prepare(){
 if(!receipt.portStart){receipt.portStart=await findPorts();await save(receiptFile,receipt);}
 await startFacilitator();
 if(receipt.planFile)return;
 const originalDeclaration=await readFile(join(sdk,'sf30-seller-sdk/python/example-merchant.json'));
 const application=await readFile(join(sdk,'sf30-seller-sdk/python/example-application.py'));
 const payment={scheme:'exact',network:'stellar:testnet',asset:StrKey.encodeContract(Buffer.alloc(32,7)),
  payTo:StrKey.encodeEd25519PublicKey(Buffer.alloc(32,8)),amount:'20000',maxTimeoutSeconds:60};
 const packages={};
 for(const [name,amount]of [['current','20000'],['updated','25000']]){
  const root=join(base,'python-'+name),declaration={...JSON.parse(originalDeclaration),publicOrigin:'https://'+publicHost,python,workerCount:1};
  for(const f of Object.values(declaration.functions))f.payment={...payment,amount};
  await onceFile(join(root,declaration.application),application);await onceFile(join(root,'merchant.json'),Buffer.from(json(declaration)));
  packages[name]={python:join(root,'merchant.json'),pythonRoot:root,runtime:{
   facilitator:'http://127.0.0.1:'+(receipt.portStart+6),allowLocalFacilitator:true}};
 }
 const referenceRoot=join(base,'python-reference');
 const referenceDeclaration={...JSON.parse(originalDeclaration),publicOrigin:'https://'+referenceHost,python,workerCount:1};
 for(const f of Object.values(referenceDeclaration.functions))f.payment={...payment};
 await onceFile(join(referenceRoot,referenceDeclaration.application),application);
 await onceFile(join(referenceRoot,'merchant.json'),Buffer.from(json(referenceDeclaration)));
 const referenceSource={python:join(referenceRoot,'merchant.json'),pythonRoot:referenceRoot,
  runtime:{facilitator:'http://127.0.0.1:'+(receipt.portStart+6),allowLocalFacilitator:true}};
 const declaration={schema:'stellar-forge.fleet-bootstrap.v1',gateway:{port:receipt.portStart,adminPort:receipt.portStart+1},
  merchantPortStart:receipt.portStart+2,slots:['blue','green'],
  tenants:[{id:'python',host:publicHost,packages,initial:{package:'current',releaseId:'python-v1'}},
   {id:'reference',host:referenceHost,packages:{current:referenceSource},initial:{package:'current',releaseId:'reference-v1'}}]};
 const declarationFile=join(base,'fleet-setup.json');await onceFile(declarationFile,Buffer.from(json(declaration)));
 const prepared=await bootstrapFleet({declarationFile,directory});
 receipt.planFile=prepared.planFile;receipt.payment=payment;receipt.originalInputs={
  merchantSha256:sha(originalDeclaration),applicationSha256:sha(application)};
 receipt.packageIdentities=Object.fromEntries(await Promise.all(Object.entries({...packages,reference:referenceSource}).map(async([name,p])=>
  [name,{directory:p.pythonRoot,files:{'merchant.json':sha(await readFile(p.python)),
   'example-application.py':sha(application)}}])));
 const plan=await readFleetReleasePlan(receipt.planFile);
 receipt.stores=Object.fromEntries(Object.entries(plan.tenants.find(row=>row.id==='python').slots).map(([name,slot])=>[name,slot.store]));
 receipt.referenceStores=Object.fromEntries(Object.entries(plan.tenants.find(row=>row.id==='reference').slots).map(([name,slot])=>[name,slot.store]));
 assert.equal(plan.tenants.length,2);assert.equal(Object.keys(receipt.stores).length+Object.keys(receipt.referenceStores).length,4);
 await mark('Original bootstrap prepared two merchants, four native release stores and the explicit local-facilitator runtime',{planFile:receipt.planFile});
}
async function enrollDestinations(){
 const state=await delivery();
 for(const id of ['fulfillment','accounting']){
  if(state.destinations.destinations.some(row=>row.id===id))continue;
  await control('enroll',{id,label:'Original '+id+' receiver',
   url:'https://'+id+'.native-e49.example/'+(id==='accounting'?'sf98/accounting-events':'events'),
   allowedHost:id+'.native-e49.example',secretEnv:id==='accounting'?'E49_SF98_ACCOUNTING_SECRET':'E49_SF98_FULFILLMENT_SECRET',
   routeIds:['summarize'],networks:['stellar:testnet'],history:'all'});
 }
 await control('sync');
}
async function receiverCommand(args){return JSON.parse((await run(python,['-B',join(sdk,'sf101-merchant-receiver/receiver.py'),...args],
 {env:{...process.env},maxBuffer:1024*1024})).stdout);}
async function startReceivers(){
 const state=await delivery(),blue=receipt.stores.blue;
 const sourceDir=state.originalSource.directory;
 const originalEvents=await(await openOutbox(sourceDir)).rows();
 assert(originalEvents.length>=1);
 const receiveState=join(base,'fulfillment');
 if(!await exists(join(receiveState,'merchant.sqlite3')))await receiverCommand(['init','--state',receiveState]);
 const payload=Buffer.from('Original SF101 fulfilled file\n東京 retained delivery\n','utf8');
 await onceFile(join(base,'fulfilled.txt'),payload);
 receipt.fulfilledFile={bytes:payload.length,sha256:sha(payload)};
 for(const order of ['e49-delivery-first','e49-delivery-reopened']){
  // Enrollment is keyed by its original stable order reference; inspect the
  // original database after an interrupted enrollment before attempting it.
  const lookup=JSON.parse((await run(python,['-B','-c',
   'import sqlite3,json,sys\nc=sqlite3.connect(sys.argv[1]);c.row_factory=sqlite3.Row\nr=c.execute("SELECT order_ref FROM orders WHERE order_ref=?",(sys.argv[2],)).fetchone()\nprint(json.dumps(dict(r) if r else None))',
   join(receiveState,'merchant.sqlite3'),order])).stdout);
  if(!lookup)await receiverCommand(['enroll','--state',receiveState,'--ref',order,'--route','summarize','--method','POST',
   '--network','stellar:testnet','--amount','20000','--asset-digest',sha(receipt.payment.asset),
   '--recipient-digest',sha(receipt.payment.payTo),'--file',join(base,'fulfilled.txt'),'--claim-env','E49_SF98_CLAIM']);
 }
 receiverSpawnError=null;
 receiver=spawn(python,['-B',join(sdk,'sf101-merchant-receiver/receiver.py'),'serve','--state',receiveState,
  '--port',String(receipt.portStart+7),'--secret-env','E49_SF98_FULFILLMENT_SECRET'],
  {env:{...process.env},stdio:['ignore','ignore','pipe']});
 receiver.on('error',error=>{receiverSpawnError=error;});
 receiver.stderr.setEncoding('utf8');receiver.stderr.on('data',value=>{receipt.receiverLog=(receipt.receiverLog??'')+value.slice(0,4000);});
 await until(async()=>{
  if(receiverSpawnError)throw receiverSpawnError;
  if(receiverExited(receiver))throw Error('Original SF101 receiver exited before readiness: '+String(receipt.receiverLog??'').slice(-4000));
  try{return(await fetch('http://127.0.0.1:'+(receipt.portStart+7)+'/health')).ok;}catch{return false;}
 },Boolean,'Original SF101 receiver did not start');
 await mkdir(join(base,'proofs'),{recursive:true,mode:0o700});
 const terms={schema:'stellar-forge.merchant-accounting-terms.v1',routes:[{
  routeId:'summarize',method:'POST',network:'stellar:testnet',amountAtomic:'20000',
  asset:receipt.payment.asset,payTo:receipt.payment.payTo,priceBasis:'Original native fixture terms',unitPriceUsd:null,unitCostUsd:null}]};
 await onceFile(join(base,'terms.json'),Buffer.from(json(terms)));
 accounting=await startAccountingWorkspace({directory:join(base,'accounting'),
  outboxDir:join(blue,'settlement-delivery/destinations/destinations/accounting'),proofDir:join(base,'proofs'),
  termsFile:join(base,'terms.json'),deliverySecretEnv:'E49_SF98_ACCOUNTING_SECRET',port:0});
 return originalEvents;
}
function sender(id){
 return args=>sendSignedWebhook({...args,resolver:async()=>[{address:'8.8.8.8',family:4}],
  transport:(endpoint,options,callback)=>{
   assert.equal(endpoint.hostname,id+'.native-e49.example');
   const target=new URL(id==='accounting'?accounting.url:'http://127.0.0.1:'+(receipt.portStart+7));
   target.pathname=endpoint.pathname;
   return httpRequest(target,{...options,lookup:undefined},response=>{
    receipt.webhooks.push({destination:id,status:response.statusCode,eventId:args.event.id,
     transport:'Original sendSignedWebhook with the accepted7E23 loopback transport fixture'});
    callback(response);
   });
  }});
}
async function deliverOriginal(id,{wrongSecret=false,clock=Date.now}={}){
 const state=await delivery(),destination=state.destinations.destinations.find(row=>row.id===id);
 return drainOnce(await openOutbox(join(receipt.stores.blue,'settlement-delivery/destinations/destinations',id)),{
  url:destination.url,allowedHost:destination.allowedHost,
  secret:wrongSecret?'different-original-fixture-signing-key-0000':secrets[destination.secretEnv],
  send:sender(id),clock,limit:10,concurrency:1});
}
async function accountingApi(path,input){
 const response=await fetch(accounting.url+path,{...(input===undefined?{}:{method:'POST',headers:{
  'content-type':'application/json','x-workspace-request':'1',origin:accounting.url},body:JSON.stringify(input)})});
 const result=await response.json();assert(response.ok,JSON.stringify(result));return result;
}
async function captureAccounting(event){
 const notice=await accountingApi('/api/delivery-notices/'+event.id);
 let capture=notice.captures.find(row=>row.status==='complete');
 if(!capture){
  const path=join(base,'capture-'+event.id+'.json');let request;
  try{request=JSON.parse(await readFile(path,'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;request={revision:(await accountingApi('/api/state')).revision,
   actor:'E49 managed settlement delivery',requestId:randomUUID(),name:'Original managed SF98 receiving'};await save(path,request);}
  const first=await accountingApi('/api/delivery-notices/'+event.id+'/capture',request);
  const replay=await accountingApi('/api/delivery-notices/'+event.id+'/capture',request);assert.equal(first.run.id,replay.run.id);
  const run=await until(()=>accountingApi('/api/runs/'+first.run.id),value=>!['queued','running'].includes(value.run.status),'Original accounting capture');
  assert.equal(run.run.status,'complete',run.run.error);capture={runId:first.run.id};
 }
 const response=await fetch(accounting.url+'/api/runs/'+capture.runId+'/download/report.json');assert(response.ok);
 const bytes=Buffer.from(await response.arrayBuffer()),report=JSON.parse(bytes);
 assert(report.ledger.some(row=>row.eventId===event.id&&row.amountAtomic===event.amountAtomic));
 receipt.accountingReports??=[];if(!receipt.accountingReports.some(row=>row.runId===capture.runId))
  receipt.accountingReports.push({runId:capture.runId,ledgerRows:report.ledger.length,sha256:sha(bytes)});
}
async function nativePhase(){
 await prepare();await openWorkspace();
 await pay('e49-delivery-first','20000');
 let state=await delivery();
 assert.equal(state.producer.mode,'NATIVE_X402');assert.equal(state.producer.journalWarnings,0);
 if(!receipt.boundSource)assert.equal(state.producer.owned,true);
 assert.equal(state.originalSource.directory,join(receipt.stores.blue,'settlement-delivery/outbox'));
 receipt.boundSource=state.originalSource.directory;await save(receiptFile,receipt);
 await enrollDestinations();const events=await startReceivers();
 const first=events.find(row=>row.event.orderReference==='e49-delivery-first').event;
 if(!receipt.independentRetry){
  const fulfillment=await deliverOriginal('fulfillment');assert.equal(fulfillment.pending,0);
  const accountRows=await api('releases/delivery/events?'+query({...scope,id:'accounting'}));
  if(accountRows.rows[0].delivery?.state!=='DELIVERED'){
   if(!accountRows.rows[0].delivery){const rejected=await deliverOriginal('accounting',{wrongSecret:true,clock:()=>Date.now()-60000});assert.equal(rejected.pending,1);}
   const separate=await delivery();
   assert.equal(separate.destinations.destinations.find(row=>row.id==='fulfillment').outbox.delivered,1);
   assert.equal(separate.destinations.destinations.find(row=>row.id==='accounting').outbox.pending,1);
   const recovered=await deliverOriginal('accounting');assert.equal(recovered.pending,0);
  }
  const payload=nativeWebhookPayload(first),timestamp=String(Math.floor(Date.now()/1000));
  const res=await fetch(accounting.url+'/sf98/accounting-events',{method:'POST',headers:{
   'content-type':'application/json','content-length':String(Buffer.byteLength(payload)),'idempotency-key':first.id,
   'x-sf98-timestamp':timestamp,'x-sf98-signature':'sha256='+createHmac('sha256',secrets.E49_SF98_ACCOUNTING_SECRET).update(timestamp+'.'+payload).digest('hex')},body:payload});
  const duplicate=await res.json();assert.equal(res.status,200);assert.equal(duplicate.duplicate,true);
  receipt.independentRetry=true;await mark('Original native success delivered to SF101 while accounting retained and recovered its independent signed retry',
   {eventId:first.id,accountingReplay:duplicate.status});
 }
 await captureAccounting(first);
 const file=await fetch('http://127.0.0.1:'+(receipt.portStart+7)+'/deliver/e49-delivery-first',{
  headers:{authorization:'Bearer '+secrets.E49_SF98_CLAIM}});
 const body=Buffer.from(await file.arrayBuffer());assert.equal(file.status,200);assert.equal(sha(body),receipt.fulfilledFile.sha256);
 if(!receipt.upgradeComplete){
  let status=await api('status');
  if(status.status.revision===1){
   const pending=status.releaseStatus.pending;
   if(pending?.phase==='PREPARED'&&pending.candidateId===status.status.candidate?.id){
    await api('activate',{candidateId:pending.candidateId,expectedRevision:pending.baseRevision});
   }else{
    await api('releases/stage',{tenant:'python',slot:'green',package:'updated',releaseId:'python-v2'});
    const review=(await api('releases/review',{tenant:'python',slot:'green',releaseId:'python-v2'})).result;
    const prepared=(await api('releases/prepare',{reviewId:review.reviewId})).result;
    await api('activate',{candidateId:prepared.candidateId,expectedRevision:prepared.expectedRevision});
   }
  }
  status=await api('status');assert([2,3].includes(status.status.revision));
  if(status.status.revision===2){
   await pay('e49-delivery-green','25000');
   const green=await delivery({tenant:'python',slot:'green'});
   assert.notEqual(green.originalSource.directory,receipt.boundSource);assert.equal(green.originalSource.uniqueNativeReceipts,1);
   assert.equal((await delivery()).originalSource.uniqueNativeReceipts,1);
   const blue=selected(await api('status'));
   if(blue.owned)await api('releases/retire',{...scope,instanceId:blue.instanceId,expectedRevision:2});
   const review=(await api('releases/review-rollback',{targetRevision:1})).result;
   await api('releases/rollback',{reviewId:review.reviewId});
  }
  status=await api('status');assert.equal(status.status.revision,3);
  receipt.upgradeComplete=true;await save(receiptFile,receipt);
 }
 await pay('e49-delivery-reopened','20000');
 state=await delivery();assert.equal(state.originalSource.directory,receipt.boundSource);assert.equal(state.originalSource.uniqueNativeReceipts,2);
 await control('sync');await deliverOriginal('fulfillment');await deliverOriginal('accounting');
 const all=await(await openOutbox(receipt.boundSource)).rows();
 await captureAccounting(all.find(row=>row.event.orderReference==='e49-delivery-reopened').event);
 state=await delivery();assert(state.destinations.destinations.every(row=>row.outbox.delivered===2&&row.cursor.count===2));
 const reference=await delivery({tenant:'reference',slot:'blue'});
 assert.notEqual(reference.originalSource.directory,receipt.boundSource);
 assert.equal(reference.originalSource.directory,join(receipt.referenceStores.blue,'settlement-delivery/outbox'));
 assert.equal(reference.originalSource.uniqueNativeReceipts,0);
 assert.equal((await(await openOutbox(reference.originalSource.directory)).rows()).length,0);
 receipt.tenantIsolation={tenants:2,stores:4,referenceEvents:0,referenceSource:reference.originalSource.directory};
 await mark('Original release upgrade, retired child and rollback preserved per-store source identity, exact prices and two completed receiver histories',
  {prices:['20000','25000','20000'],revision:3,blueEvents:2,greenEvents:1,fulfilledFile:receipt.fulfilledFile});
 await accounting.close();accounting=null;
 await stopReceiver();
 await workspace.close();workspace=null;
 receipt.nativeComplete=true;await save(receiptFile,receipt);
}
async function browserPhase(){
 await prepare();await openWorkspace();
 const require=createRequire(join(resolve(process.env.SF98_DELIVERY_NODE_MODULES??process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES??join(repo,'node_modules')),'runtime-loader.cjs'));
 const {chromium}=require('playwright');
 browser=await chromium.launch({headless:true,...(process.env.SF98_DELIVERY_CHROMIUM?{executablePath:process.env.SF98_DELIVERY_CHROMIUM}:{}),
  args:['--no-sandbox','--disable-gpu','--disable-background-networking','--renderer-process-limit=1']});
 const context=await browser.newContext({viewport:{width:1380,height:1000},acceptDownloads:true});
 // Exercise the supported browser-download fallback without a platform file picker.
 await context.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
 const page=await context.newPage();page.on('pageerror',e=>receipt.browserErrors.push(e.message));page.setDefaultTimeout(30000);
 await page.goto(workspace.url);await page.waitForFunction(()=>document.querySelector('#connection')?.textContent==='Connected');
 await page.waitForFunction(()=>!document.querySelector('#delivery-refresh').disabled);
 assert.equal(await page.locator('#delivery-tenant').inputValue(),'python');
 const popupPromise=page.waitForEvent('popup');await page.locator('#delivery-controls').click();const destination=await popupPromise;
 destination.on('pageerror',e=>receipt.browserErrors.push(e.message));
 await destination.waitForFunction(()=>document.querySelector('#source-count')?.textContent==='2');
 let state=await delivery();
 if(!state.destinations.destinations.some(row=>row.id==='audit')){
  const form=destination.locator('#enroll-form');
  for(const [name,value]of Object.entries({id:'audit',label:'Original new-event audit',
   url:'https://audit.native-e49.example/events',allowedHost:'audit.native-e49.example',
   secretEnv:'E49_SF98_ACCOUNTING_SECRET',routeIds:'summarize',networks:'stellar:testnet'}))
   await form.locator('[name="'+name+'"]').fill(value);
  await form.locator('[name="history"]').selectOption('new');
  const submitted=destination.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/api/enroll'));
  await form.getByRole('button',{name:'Enroll receiver',exact:true}).click();assert.equal((await submitted).status(),200);
 }
 await destination.getByRole('button',{name:'Original new-event audit',exact:true}).click();
 if(await destination.locator('#toggle-pause').textContent()==='Pause receiver'){
  const paused=destination.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/api/pause'));
  await destination.locator('#toggle-pause').click();assert.equal((await paused).status(),200);
 }
 await destination.screenshot({path:join(base,'original-destination-controls.png'),fullPage:true});await destination.close();
 await page.locator('#delivery-refresh').click();await page.waitForFunction(()=>!document.querySelector('#delivery-refresh').disabled);
 state=await delivery();assert.equal(state.destinations.destinations.find(row=>row.id==='audit').enrollment.count,2);
 const started=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/api/releases/delivery/control'));
 await page.locator('#delivery-start').click();assert.equal((await started).status(),200);
 await until(()=>delivery(),value=>value.destinations.worker.run?.cycles>=1,'Original delivery worker cycle');
 await page.locator('#delivery-refresh').click();await page.waitForFunction(()=>!document.querySelector('#delivery-stop').disabled);
 const stopped=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/api/releases/delivery/control'));
 await page.locator('#delivery-stop').click();assert.equal((await stopped).status(),200);
 await page.waitForFunction(()=>!document.querySelector('#delivery-refresh').disabled);
 const transferId='customer-delivery',url=workspace.url+'/api/releases/delivery/transfer';
 let manifest;
 if(!receipt.transfer){
  await page.locator('#delivery-transfer-id').fill(transferId);
  let dropped=false;
  await page.route(url,async route=>{
   if(route.request().method()!=='POST'||dropped)return route.continue();
   dropped=true;const response=await route.fetch();assert.equal(response.status(),200);
   await route.abort('failed');
  });
  await page.locator('#delivery-create-transfer').click();
  await page.waitForFunction(()=>!document.querySelector('#delivery-refresh').disabled);
  await page.unroute(url);
  manifest=await api('releases/delivery/transfer?'+query({...scope,id:transferId}));
  assert.equal(manifest.source.events,2);assert.equal(manifest.destinations.length,3);
  receipt.transfer={id:transferId,fingerprint:manifest.fingerprint};await save(receiptFile,receipt);
  await page.locator('#delivery-create-transfer').click();
  await page.waitForFunction(()=>!document.querySelector('#delivery-review').hidden&&!document.querySelector('#delivery-download').disabled);
 }else{
  await page.locator('#delivery-transfer-list tr').filter({hasText:transferId}).getByRole('button',{name:'Inspect'}).click();
  await page.waitForFunction(()=>!document.querySelector('#delivery-review').hidden&&!document.querySelector('#delivery-download').disabled);
  manifest=await api('releases/delivery/transfer?'+query({...scope,id:transferId,expectedFingerprint:receipt.transfer.fingerprint}));
 }
 const download=page.waitForEvent('download');await page.locator('#delivery-download').click();
 const archive=await download,archivePath=join(base,'customer-delivery.tar.gz');await archive.saveAs(archivePath);
 const extracted=join(base,'received-exchange');await mkdir(extracted,{recursive:true,mode:0o700});await chmod(extracted,0o700);
 await run(python,['-B','-c',
  'import tarfile,pathlib,sys\nroot=pathlib.Path(sys.argv[2])\nwith tarfile.open(sys.argv[1]) as t:\n members=t.getmembers()\n assert all((m.isfile() or m.isdir()) and not pathlib.PurePosixPath(m.name).is_absolute() and ".." not in pathlib.PurePosixPath(m.name).parts for m in members)\n t.extractall(root,filter="data")',archivePath,extracted]);
 for(const file of manifest.files){const b=await readFile(join(extracted,file.name));assert.equal(b.length,file.bytes);assert.equal(sha(b),file.sha256);}
 const inspected=await destinationMain(['inspect','--workspace',extracted]);assert.equal(inspected.fingerprint,manifest.fingerprint);
 const receiveTarget=join(base,'received-destinations');let received;
 if(await exists(receiveTarget)){
  received=JSON.parse(await readFile(join(receiveTarget,'received.json'),'utf8'));
  assert.equal(received.schema,'stellar-forge.sf98.destinations-received.v1');
  assert.equal(received.fingerprint,manifest.fingerprint);
  assert.equal(received.workspaceDirectory,join(receiveTarget,'workspace'));
  assert.equal(received.sourceDirectory,join(receiveTarget,'source'));
 }else received=await destinationMain(['receive','--workspace',receiveTarget,'--from',extracted,'--fingerprint',manifest.fingerprint]);
 const original=await openDestinationWorkspace({directory:received.workspaceDirectory});
 try{const state=await original.state();assert.equal(state.source.events,2);assert.equal(state.destinations.length,3);
  assert.equal(state.worker.owner.active,false);
  for(const id of ['fulfillment','accounting']){const row=state.destinations.find(x=>x.id===id);assert.equal(row.outbox.delivered,2);assert.equal(row.cursor.count,2);}}
 finally{await original.close();}
 await page.screenshot({path:join(base,'managed-delivery-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
 await page.screenshot({path:join(base,'managed-delivery-mobile.png'),fullPage:true});
 assert.deepEqual(receipt.browserErrors,[]);
 await browser.close();browser=null;await workspace.close();workspace=null;
 receipt.receivedDirectory=received.workspaceDirectory;receipt.browserComplete=true;
 await mark('Original destination browser, worker, lost transfer response and exact archived receiving completed',
  {transferFingerprint:manifest.fingerprint,files:manifest.files.length,archiveBytes:(await stat(archivePath)).size,sourceEvents:2,destinations:3,browserErrors:0,mobileWidth:390});
}
async function relocateSources(){
 for(const [name,identity]of Object.entries(receipt.packageIdentities)){
  const old=identity.directory,moved=old+'-moved',hasOld=await exists(old),hasMoved=await exists(moved);
  assert.notEqual(hasOld,hasMoved,'Exactly one retained Python source location must exist');
  const selected=hasOld?old:moved;
  for(const [file,digest]of Object.entries(identity.files))assert.equal(sha(await readFile(join(selected,file))),digest);
  if(hasOld)await rename(old,moved);
  receipt.relocated??={};receipt.relocated[name]=moved;await save(receiptFile,receipt);
 }
}
async function wire(method,params={}){
 const response=await fetch(mcp.url,{method:'POST',headers:{authorization:'Bearer '+token,
  'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25'},
  body:JSON.stringify({jsonrpc:'2.0',id:++wireId,method,params}),signal:AbortSignal.timeout(45000)});
 assert.equal(response.status,200);const value=await response.json();assert.equal(value.error,undefined);return value.result;
}
async function call(name,args={},error=false){
 const result=await wire('tools/call',{name,arguments:args});assert.equal(Boolean(result.isError),error,JSON.stringify(result.structuredContent));return result.structuredContent;
}
async function restoreUnavailableProbe(){
 const probe=receipt.sourceUnavailableProbe;if(!probe||probe.restored)return;
 assert.equal(probe.source,receipt.boundSource);
 assert.equal(probe.moved,probe.source+'-temporarily-unavailable');
 const original=await exists(probe.source),moved=await exists(probe.moved);
 assert.notEqual(original,moved,'Exactly one retained source-probe journal must exist');
 for(const [name,digest]of Object.entries(probe.files)){
  const file=join(original?probe.source:probe.moved,name);
  if(digest===null)assert.equal(await exists(file),false);
  else assert.equal(sha(await readFile(file)),digest);
 }
 if(moved)await rename(probe.moved,probe.source);
 probe.restored=true;await save(receiptFile,receipt);
}
async function mcpPhase(){
 await restoreUnavailableProbe();await prepare();await relocateSources();
 if(!receipt.mcpConfiguration){
  const created=await mcpMain(['init-fleet','--dir',join(base,'merchant-mcp'),'--plan',receipt.planFile,'--fleet-directory',directory]);
  receipt.mcpConfiguration=created.configuration;await save(receiptFile,receipt);
 }
 mcp=await startMerchantMcp({configPath:receipt.mcpConfiguration,port:0,environment:{...process.env,MCP_ACCESS_TOKEN:token}});
 await wire('initialize');const plan=await call('merchant_fleet_plan');
 let running=await call('merchant_fleet_start',{expectedPlanDigest:plan.digest});assert.equal(running.fleet.native.revision,3);
 const definitions=(await wire('tools/list')).tools.filter(row=>row.name.startsWith('merchant_fleet_delivery_'));assert.equal(definitions.length,8);
 const status=await call('merchant_fleet_delivery_status',scope);assert.equal(status.originalSource.uniqueNativeReceipts,2);
 const manifest=await call('merchant_fleet_delivery_manifest',{...scope,id:receipt.transfer.id,expectedFingerprint:receipt.transfer.fingerprint});
 const file=manifest.files.find(row=>row.name==='source/events.ndjson'),chunks=[];let readId,offset=0;
 for(;;){
  const block=await call('merchant_fleet_delivery_file',{...scope,id:receipt.transfer.id,expectedFingerprint:manifest.fingerprint,
   name:file.name,expectedSha256:file.sha256,offset,limit:128,...(readId?{readId}:{})});
  const bytes=Buffer.from(block.data,'base64');assert.equal(block.offset,offset);assert.equal(block.bytesRead,bytes.length);
  chunks.push(bytes);offset+=bytes.length;readId=block.readId;if(block.nextOffset===null)break;
 }
 assert.equal(offset,file.bytes);assert.equal(sha(Buffer.concat(chunks)),file.sha256);
 await call('merchant_fleet_delivery_file_release',{...scope,id:receipt.transfer.id,readId});
 await call('merchant_fleet_delivery_manifest',{tenant:'python',slot:'green',id:receipt.transfer.id},true);
 const history=await call('merchant_fleet_delivery_events',{...scope,id:'accounting',limit:1});
 assert.equal(history.total,2);assert.equal(history.nextOffset,1);
 const next=await call('merchant_fleet_delivery_events',{...scope,id:'accounting',offset:1,limit:1});assert.notEqual(next.rows[0].event.id,history.rows[0].event.id);
 await call('merchant_fleet_delivery_control',{...scope,action:'start',input:{pollMs:100}});
 await call('merchant_fleet_stop',{managerId:running.managerId});await mcp.close();mcp=null;
 operator=await openFleetReleaseOperator({planFile:receipt.planFile,directory});
 const terminal=await dispatchFleetCommand(operator,'delivery-status python blue');assert.equal(terminal.originalSource.uniqueNativeReceipts,2);
 const listed=await dispatchFleetCommand(operator,'delivery-transfers python blue');assert(listed.transfers.some(row=>row.id===receipt.transfer.id));
 const reopened=await dispatchFleetCommand(operator,'delivery-manifest python blue '+receipt.transfer.id+' '+receipt.transfer.fingerprint);
 assert.equal(reopened.fingerprint,manifest.fingerprint);assert.equal(terminal.destinations.worker.owner.active,false);
 await operator.close();operator=null;
 const source=receipt.boundSource,moved=source+'-temporarily-unavailable';
 assert.equal(await exists(moved),false);
 const journalFiles={};
 for(const name of ['events.ndjson','deliveries.ndjson'])
  journalFiles[name]=await exists(join(source,name))?sha(await readFile(join(source,name))):null;
 receipt.sourceUnavailableProbe={source,moved,files:journalFiles,restored:false};
 await save(receiptFile,receipt);await rename(source,moved);
 let desk;
 try{
  desk=createFleetDeliveryDesk({planDigest:plan.digest,locate:()=>({key:'python/blue',tenant:{host:publicHost},slot:{store:receipt.stores.blue}}),getManaged:()=>null});
  const saved=await desk.transferManifest({...scope,id:receipt.transfer.id,expectedFingerprint:manifest.fingerprint});
  assert.equal(saved.fingerprint,manifest.fingerprint);
  const value=await desk.file({...scope,id:receipt.transfer.id,expectedFingerprint:manifest.fingerprint,name:file.name,expectedSha256:file.sha256});
  assert.equal(sha(Buffer.from(value.data,'base64')),file.sha256);
 }finally{await desk?.close();await restoreUnavailableProbe();}
 receipt.mcpComplete=true;
 await mark('Authenticated MCP, original fleet CLI and source-independent retained-file receiving reopened the same managed stores',
  {tools:definitions.map(row=>row.name),readBytes:offset,transferFingerprint:manifest.fingerprint,revision:3,sourcesRelocated:Object.keys(receipt.relocated)});
}
async function cleanup(){
 if(closed)return;closed=true;const errors=[];
 for(const handle of [browser,workspace,mcp,operator,accounting])try{await handle?.close();}catch(e){errors.push(e.message);}
 try{await stopReceiver();}catch(e){errors.push(e.message);}
 try{await closeServer(facilitator);}catch(e){errors.push(e.message);}
 receipt.ownedProcessesClosed=errors.length===0;receipt.cleanupErrors=errors;
 if(errors.length){receipt.state='FAILED';process.exitCode=1;}
 const paths=[
 'sf30-seller-sdk/native-delivery.mjs','sf30-seller-sdk/resource-server.mjs','sf98-merchant-delivery/outbox.mjs',
 'sf98-merchant-delivery/destinations/server.mjs','sf82-seller-pilot/release-delivery.mjs','sf82-seller-pilot/release-child.mjs',
 'sf82-seller-pilot/releases.mjs','sf82-seller-pilot/release-client.mjs','merchant-fleet-gateway/release-delivery.mjs',
 'merchant-fleet-gateway/release-operator.mjs','merchant-fleet-gateway/release-cli.mjs','merchant-fleet-gateway/workspace/server.mjs',
 'merchant-fleet-gateway/workspace/browser.mjs','merchant-fleet-gateway/workspace/delivery.mjs'];
 receipt.sourceHashes=Object.fromEntries(await Promise.all(paths.map(async path=>[path,sha(await readFile(join(sdk,path)))])));
 for(const path of ['fleet.mjs','operator.mjs','retained-download.mjs'])receipt.sourceHashes['mcp/'+path]=sha(await readFile(join(repo,'stellar-forge/mcp-merchant-operator',path)));
 receipt.finishedAt=new Date().toISOString();await save(receiptFile,receipt);
}
try{
 const phase=process.argv[2]??'all';
 assert(['all','native','browser','mcp'].includes(phase));
 if((phase==='all'||phase==='native')&&!receipt.nativeComplete)await nativePhase();
 if(phase==='all'||phase==='browser'){assert(receipt.nativeComplete);if(!receipt.browserComplete)await browserPhase();}
 if(phase==='all'||phase==='mcp'){assert(receipt.browserComplete);if(!receipt.mcpComplete)await mcpPhase();}
 if(receipt.nativeComplete&&receipt.browserComplete&&receipt.mcpComplete){receipt.state='PASS';delete receipt.error;}
}catch(error){receipt.state='FAILED';receipt.error={message:error.message,stack:String(error.stack).slice(0,8000)};process.stderr.write(json(receipt.error));process.exitCode=1;}
finally{await cleanup();}
