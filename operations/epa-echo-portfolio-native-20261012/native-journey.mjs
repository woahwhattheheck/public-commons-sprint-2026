// Original EPA_ECHO source, operator console, SF30/SF82 merchant and SF88/SF100 customer journey.
import {readFile,writeFile,mkdir,rename,lstat,open,access} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createServer as createHttpServer,request as httpRequest} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {connect as netConnect} from 'node:net';
import {connect as tlsConnect} from 'node:tls';
import {pathToFileURL} from 'node:url';
const BASE=process.env.EPA_ECHO_JOURNEY_DIRECTORY??'/workspace/scratch/b3909ae247f2/epa-echo-portfolio/native';
const PRODUCT=process.env.EPA_ECHO_PRODUCT_ROOT??join(BASE,'product');
const SCF=join(PRODUCT,'stellar/scf-starforge-20261009');
const SOURCE=join(SCF,'sf30-seller-sdk/epa-echo');
const SOURCE_COMMIT=process.env.EPA_ECHO_SOURCE_COMMIT;
if(!/^[0-9a-f]{40}$/.test(SOURCE_COMMIT??''))throw new Error('Supply the selected complete EPA ECHO product commit.');
const DONOR=process.env.EPA_ECHO_ORIGINAL_SCF_RUNTIME??'/workspace/scratch/b3909ae247f2/stellar-expert-product/stellar/scf-starforge-20261009';
const PRIVATE=join(BASE,'private');
const DIRECTORY=join(BASE,'workspace'),INBOX=join(BASE,'inbox');
const ORIGINAL=process.env.EPA_ECHO_ORIGINAL_OPERATOR_ROOT??'/workspace/scratch/39daa82f3fbd/routescan_native_39da',OPERATOR=process.env.EPA_ECHO_OPERATOR_WORKSPACE??join(ORIGINAL,'operator-workspace');
const HOST=process.env.EPA_ECHO_MERCHANT_HOST??'merchant.routescan39da.scf.test',RESOURCE='https://'+HOST+'/epa-facilities';
const INTENTS=['epa-echo-portfolio-b3909-20261012-p1','epa-echo-portfolio-b3909-20261012-p2'];
const JOURNAL=join(PRIVATE,'native-journey.json'),RUNTIME=join(PRIVATE,'release-runtime.json');
const INPUT=join(SOURCE,'examples/dc-wastewater-source-20261012.json');
const now=()=>new Date().toISOString(),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const exists=async p=>access(p).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
const must=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const log=value=>console.log(JSON.stringify(value));
process.umask(0o077);
await mkdir(PRIVATE,{recursive:true,mode:0o700});await mkdir(join(PRIVATE,'pages'),{recursive:true,mode:0o700});
async function save(path,value){
 const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),tmp=path+'.pending-'+randomUUID(),file=await open(tmp,'wx',0o600);
 try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
 await rename(tmp,path);const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}return value;
}
async function immutable(path,value){
 const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
 if(await exists(path)){must((await readFile(path)).equals(bytes),'ORIGINAL_SAVED_INPUT_CHANGED');return value;}
 const file=await open(path,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}return value;
}
let journey=await exists(JOURNAL)?await read(JOURNAL):{
 schema:'stellar-forge.epa-echo-original-operating-journey.v1',operationId:'epa-echo-portfolio-complete-b3909-20261012',
 sourceCommit:SOURCE_COMMIT,sourceRoot:PRODUCT,workspace:DIRECTORY,inboxDirectory:INBOX,
 originalOperatorWorkspace:OPERATOR,startedAt:now(),intentIds:INTENTS,resource:RESOURCE,steps:{},pages:[],phase:'STARTING'
};
must(journey.schema==='stellar-forge.epa-echo-original-operating-journey.v1'&&journey.operationId==='epa-echo-portfolio-complete-b3909-20261012'&&journey.sourceCommit===SOURCE_COMMIT&&journey.sourceRoot===PRODUCT&&journey.workspace===DIRECTORY&&journey.inboxDirectory===INBOX&&journey.originalOperatorWorkspace===OPERATOR&&journey.resource===RESOURCE&&JSON.stringify(journey.intentIds)===JSON.stringify(INTENTS),'ORIGINAL_EPA_ECHO_OPERATION_IDENTITY_REQUIRED');
must(sha(await readFile(INPUT))==='c737c859126057359c3918e20e4553651b31ab14532060c64aa49f25a7fe24d9','ORIGINAL_EPA_ECHO_SOURCE_PACKAGE_CHANGED');
const sourceBundle=await read(INPUT),SOURCE_FACILITY_IDS=sourceBundle.selection?.facilityIds;
must(Array.isArray(SOURCE_FACILITY_IDS)&&SOURCE_FACILITY_IDS.length===4&&new Set(SOURCE_FACILITY_IDS).size===4,'ORIGINAL_EPA_FACILITY_SELECTION_REQUIRED');
if(journey.phase==='COMPLETE'){log({phase:'COMPLETE',reused:true,result:JOURNAL});process.exit(0);}
const mcpResultFile=join(BASE,'merchant-receiving/result.json');
if(journey.browserCompleted&&await exists(mcpResultFile)){
 const completed=await read(mcpResultFile);
 if(completed.state==='COMPLETE'){
  must(completed.workspaceId===journey.workspaceId&&completed.editionId===journey.editionId&&completed.receiptId===journey.receiptId&&
   completed.sourceCommit===SOURCE_COMMIT&&completed.receivedWorkspaceId===journey.receivedWorkspaceId,'ORIGINAL_EPA_MCP_SELECTION_CHANGED');
  journey.mcp=completed;
 }
}

if(journey.error){journey.priorInterruptions=[...(journey.priorInterruptions??[]),journey.error];delete journey.error;}
journey.continuations=(journey.continuations??0)+1;journey.process={pid:process.pid,startedAt:now()};
const checkpoint=async phase=>{journey.phase=phase;journey.updatedAt=now();await save(JOURNAL,journey);log({phase});};
let server,browser,facilitator,facilitatorServer,tls,proxy,merchantPort,operationError,operatingComplete=false;
const cleanupErrors=[];
const tunnels=new Set(),exchanges=[],transportCounts={merchantConnect:0,rpcConnect:0,refusedConnect:0};
const listen=server=>new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',()=>yes(server.address().port));});
const stop=server=>new Promise((yes,no)=>{if(!server)return yes();server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?no(error):yes());server.closeIdleConnections?.();});
async function bridgeRpc(socket,head,authority){
 const address=process.env.HTTPS_PROXY??process.env.https_proxy??process.env.HTTP_PROXY??process.env.http_proxy;
 must(address,'ORIGINAL_EGRESS_PROXY_REQUIRED');
 const selected=new URL(address);
 must(['http:','https:'].includes(selected.protocol)&&!selected.username&&!selected.password,'ORIGINAL_EGRESS_PROXY_REQUIRED');
 const upstream=selected.protocol==='https:'?tlsConnect({host:selected.hostname,port:Number(selected.port||443),servername:selected.hostname}):netConnect({host:selected.hostname,port:Number(selected.port||80)});
 tunnels.add(upstream);upstream.once('close',()=>tunnels.delete(upstream));
 upstream.once('error',()=>socket.destroy());socket.once('error',()=>upstream.destroy());socket.once('close',()=>upstream.destroy());
 upstream.once(selected.protocol==='https:'?'secureConnect':'connect',()=>upstream.write('CONNECT '+authority+' HTTP/1.1\r\nHost: '+authority+'\r\n\r\n'));
 let pending=Buffer.alloc(0);
 const handshake=data=>{
  pending=Buffer.concat([pending,data]);if(pending.length>16384){upstream.destroy();socket.destroy();return;}
  const end=pending.indexOf('\r\n\r\n');if(end<0)return;upstream.removeListener('data',handshake);
  if(!/^HTTP\/1\.[01] 200(?: |\r)/.test(pending.toString('latin1',0,end))){upstream.destroy();socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');return;}
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  if(pending.length>end+4)socket.write(pending.subarray(end+4));if(head.length)upstream.write(head);
  socket.pipe(upstream);upstream.pipe(socket);
 };
 upstream.on('data',handshake);
}
async function setupTransport(){
 tls=createHttpsServer({key:await readFile(join(ORIGINAL,'tls/server-key.pem')),cert:await readFile(join(ORIGINAL,'tls/server.pem'))},(req,res)=>{
  const event={method:req.method,path:req.url,paidHeaderPresent:!!req.headers['payment-signature']};exchanges.push(event);
  const outbound=httpRequest({hostname:'127.0.0.1',port:merchantPort,path:req.url,method:req.method,headers:req.headers,agent:false},incoming=>{
   event.status=incoming.statusCode;event.snapshot=incoming.headers['x-dataset-snapshot'];res.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(res);
  });
  outbound.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(outbound);
 });
 const tlsPort=await listen(tls);
 proxy=createHttpServer((req,res)=>{res.writeHead(405);res.end();});
 proxy.on('connect',(req,socket,head)=>{
  tunnels.add(socket);socket.once('close',()=>tunnels.delete(socket));
  if(req.url===HOST+':443'&&!head.length){
   transportCounts.merchantConnect++;
   const target=netConnect({host:'127.0.0.1',port:tlsPort},()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');socket.pipe(target);target.pipe(socket);});
   tunnels.add(target);target.once('close',()=>tunnels.delete(target));target.on('error',()=>socket.destroy());socket.on('error',()=>target.destroy());socket.on('close',()=>target.destroy());
  }else if(req.url==='soroban-testnet.stellar.org:443'&&!head.length){
   transportCounts.rpcConnect++;bridgeRpc(socket,head,req.url).catch(()=>socket.destroy());
  }else{transportCounts.refusedConnect++;socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');}
 });
 process.env.SCF_ROUTESCAN_BUYER_PROXY='http://127.0.0.1:'+await listen(proxy);
 journey.transport={publicOrigin:'https://'+HOST,tlsPort,proxyUrl:process.env.SCF_ROUTESCAN_BUYER_PROXY};
 await save(JOURNAL,journey);
}

try{
 const [{startEchoWorkspace},{createEchoBrowser},{runEchoMerchantReceiving},{initializeQueue,openQueue,workspaceConfiguration},
  {readDatasetBuyerOffer,prepareDatasetBuyer},{inspectDatasetPage},{finalizeQueueIntent,summarizeFinalization}]=await Promise.all([
  import(pathToFileURL(join(SOURCE,'workspace.mjs'))),import(new URL('./browser-journey.mjs',import.meta.url)),
  import(new URL('./mcp-receiving.mjs',import.meta.url)),
  import(pathToFileURL(join(SCF,'sf88-operator-buyer-cli/queue.mjs'))),
  import(pathToFileURL(join(SCF,'sf30-seller-sdk/dataset-refresh/buyer-handoff.mjs'))),
  import(pathToFileURL(join(SCF,'sf88-operator-buyer-cli/dataset-page.mjs'))),
  import(pathToFileURL(join(SCF,'sf88-operator-buyer-cli/finalization.mjs')))
 ]);
 let runtime;
 if(journey.browserCompleted)runtime=await read(RUNTIME);
 else{
  await checkpoint('OPENING_ORIGINAL_NATIVE_MERCHANT_CUSTODY');
  const privateAccounts=await read(join(ORIGINAL,'accounts.private.json'));
  process.env.SCF_ROUTESCAN_BUYER_SECRET=privateAccounts.accounts.buyer.secret;
  process.env.SCF_ROUTESCAN_FEE_SECRET=privateAccounts.accounts.fee.secret;
  process.env.SF36_OBSERVER_USE_SYSTEM_CA='1';
  const policy=await read(join(ORIGINAL,'facilitator.json'));
  must(policy.network==='stellar:testnet'&&policy.operations.ownershipDirectory===join(ORIGINAL,'signer-ownership'),'ORIGINAL_SIGNER_CUSTODY_REQUIRED');
  const policySha=sha(await readFile(join(OPERATOR,'policy.json')));
  if(journey.operatorPolicySha256)must(journey.operatorPolicySha256===policySha,'ORIGINAL_OPERATOR_POLICY_CHANGED');
  journey.operatorPolicySha256=policySha;await save(JOURNAL,journey);
  const [{createNativeFacilitator},{startFacilitatorServer}]=await Promise.all([
   import(pathToFileURL(join(DONOR,'native-facilitator/runtime.mjs'))),
   import(pathToFileURL(join(DONOR,'native-facilitator/server.mjs')))
  ]);
  facilitator=await createNativeFacilitator(policy,{environment:process.env});
  facilitatorServer=await startFacilitatorServer({facilitator,port:journey.facilitatorUrl?Number(new URL(journey.facilitatorUrl).port):0});
  journey.facilitatorUrl=facilitatorServer.url;await save(JOURNAL,journey);
  runtime={port:0,facilitator:facilitatorServer.url,allowLocalFacilitator:true};await immutable(RUNTIME,runtime);
  await checkpoint('ORIGINAL_NATIVE_FACILITATOR_READY');
 }
 if(!await exists(join(INBOX,'inbox.json')))await initializeQueue(INBOX,{resume:await exists(INBOX)});
 if(journey.mcp?.state!=='COMPLETE'){
 server=await startEchoWorkspace({directory:DIRECTORY,inboxDirectory:INBOX,releaseRuntime:runtime,port:0,
  userAgent:'StellarForgeECHO/1.0 (+https://github.com/woahwhattheheck/public-commons-sprint-2026)'});
 const initial=await server.app.view();
 if(journey.workspaceId)must(journey.workspaceId===initial.workspaceId,'ORIGINAL_EPA_ECHO_WORKSPACE_CHANGED');
 journey.workspaceId=initial.workspaceId;await save(JOURNAL,journey);
 if(!journey.browserCompleted){
  browser=await createEchoBrowser({getServer:()=>server,sourceCommit:SOURCE_COMMIT,sourcePackageFile:INPUT,artifactDirectory:join(BASE,'browser'),facilityIds:SOURCE_FACILITY_IDS});
  const selection=await browser.source();Object.assign(journey,selection);await checkpoint('SOURCE_REVIEW_DATASET_AND_PORTABLE_HANDOVER_COMPLETE');
  const payment={scheme:'exact',network:'stellar:testnet',asset:'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
   amount:'10000',payTo:process.env.EPA_ECHO_PAY_TO??'GBB37T6QFXSFLVG7FHVVOQOK4YHE4T7ISG3ITPDRS3XNNY6JBWRIYOGC',maxTimeoutSeconds:600};
  const published=await browser.publish({origin:'https://'+HOST,path:'/epa-facilities',payment});
  journey.publisher=published;journey.releaseId=published.releaseId;merchantPort=Number(new URL(published.listener).port);
  await checkpoint('ORIGINAL_EPA_ECHO_MERCHANT_RUNNING');await setupTransport();
  const queue=await openQueue(INBOX);let previous=null,totalAtomic=0n;
  for(let index=0;index<INTENTS.length;index++){
   const intentId=INTENTS[index],stem='page-'+(index+1),file=join(PRIVATE,'pages',stem+'-request.json'),responsePath=join(PRIVATE,'pages',stem+'-response.json');
   let configuration;
   if(await exists(file))configuration=await read(file);
   else{
    const review=await readDatasetBuyerOffer({seller:published.listener,resource:RESOURCE,snapshot:journey.snapshot,query:'limit=2'});
    must(review.mode==='NATIVE_X402'&&review.accepts[0]?.network===payment.network&&review.accepts[0]?.amount===payment.amount&&
     review.accepts[0]?.asset===payment.asset&&review.accepts[0]?.payTo===payment.payTo,'ORIGINAL_ACTUAL_PAYMENT_TERMS_CHANGED');
    if(previous){
     must(previous.nextCursor&&previous.nextOffset===2,'ORIGINAL_EPA_ECHO_PAGE_CURSOR_REQUIRED');
     const selected=new URL(review.url);selected.searchParams.set('cursor',previous.nextCursor);review.url=selected.href;review.query=selected.search.slice(1);
    }
    const prepared=prepareDatasetBuyer(review,{intentId,acceptIndex:0,offerSha256:review.offerSha256});
    configuration=(await workspaceConfiguration(OPERATOR,{configuration:prepared.config})).configuration;
    configuration.responseFile={destination:responsePath,maxBytes:1048576,timeoutMs:30000};configuration.captureBody=false;
    await immutable(file,configuration);await immutable(join(PRIVATE,'pages',stem+'-offer.json'),review);
   }
   must(configuration.operation.intentId===intentId&&configuration.operation.url.startsWith(RESOURCE+'?')&&
    new URL(configuration.operation.url).searchParams.get('snapshot')===journey.snapshot&&configuration.operation.expect.maxAtomic==='10000'&&
    configuration.responseFile.destination===responsePath,'ORIGINAL_EPA_ECHO_PAGE_SELECTION_CHANGED');
   let job;try{job=await queue.show(intentId);}catch(error){if(error.code!=='ENOENT')throw error;}
   if(!job)job=await queue.enqueue(file);
   if(!job.attempt){journey.activeBuyer={intentId,page:index+1,startedAt:now()};await save(JOURNAL,journey);job=await queue.run(intentId,{workspace:OPERATOR});}
   await save(join(PRIVATE,'pages',stem+'-queue.json'),job);
   must(job.attempt?.kind==='EXECUTE','ORIGINAL_BUYER_ATTEMPT_REQUIRED');
   if(!await exists(responsePath)){
    journey.pages[index]={intentId,state:job.state,attemptId:job.attempt.id,outcome:job.outcome??null,terminal:job.terminal??null};await save(JOURNAL,journey);
    throw Object.assign(new Error('ORIGINAL_EPA_ECHO_PAGE_RESPONSE_CONTINUATION_REQUIRED'),{code:'ORIGINAL_EPA_ECHO_PAGE_RESPONSE_CONTINUATION_REQUIRED'});
   }
   const page=inspectDatasetPage(await readFile(responsePath),{url:configuration.operation.url,previous,expectedSnapshot:journey.snapshot,maxRows:4});
   must(page.returned===2&&page.total===4&&page.offset===index*2,'ORIGINAL_COMPLETE_EPA_ECHO_PAGE_REQUIRED');
   const finalized=await finalizeQueueIntent({root:INBOX,intentId,workspace:OPERATOR});await save(join(PRIVATE,'pages',stem+'-finalization.json'),finalized);
   const accounting=summarizeFinalization(finalized.finalization);
   must(['FINALIZED','IDEMPOTENT_FINALIZED'].includes(accounting.outcome)&&BigInt(String(accounting.actualAtomicUnits))===10000n,'ORIGINAL_EPA_ECHO_PAGE_FINALIZATION_REQUIRED');
   totalAtomic+=BigInt(String(accounting.actualAtomicUnits));journey.pages[index]={intentId,state:finalized.state,attemptId:finalized.attempt.id,url:configuration.operation.url,responsePath,...page,accounting};
   previous=page;delete journey.activeBuyer;await checkpoint('ORIGINAL_EPA_ECHO_PAGE_'+(index+1)+'_DELIVERED_AND_FINALIZED');
  }
  must(previous.nextCursor===null&&previous.nextOffset===4&&totalAtomic===20000n,'ORIGINAL_COMPLETE_EPA_ECHO_ACQUISITION_REQUIRED');
  journey.acquisition={rows:4,pages:2,totalAtomic:String(totalAtomic),snapshot:journey.snapshot,intentIds:INTENTS};
  const receipt=await browser.receive(INTENTS);journey.receiptId=receipt.id;journey.customerReceipt=receipt;await checkpoint('ORIGINAL_EPA_ECHO_FIVE_CUSTOMER_FILES_RECEIVED');
  const portable=await browser.portable();Object.assign(journey,portable);await checkpoint('ORIGINAL_EPA_COMPLETE_WORKSPACE_RECEIVED');
  journey.beforeReopen=await server.app.view();await server.close();server=null;
  server=await startEchoWorkspace({directory:DIRECTORY,inboxDirectory:INBOX,releaseRuntime:runtime,port:0,expectedWorkspaceId:journey.workspaceId});
  const reopened=await browser.reopened();journey.reopened={workspaceId:reopened.workspaceId,revision:reopened.revision,receiptId:receipt.id,datasetId:journey.datasetId};
  const result=await browser.close();browser=null;must(result.state==='COMPLETE','ORIGINAL_EPA_ECHO_BROWSER_COMPLETION_REQUIRED');
  journey.browserCompleted={path:join(BASE,'browser/journal.json'),finishedAt:result.finishedAt,files:result.files,steps:result.steps,errors:result.errors};
  await checkpoint('ORIGINAL_EPA_ECHO_BROWSER_AND_REOPEN_COMPLETE');
 }
 must(journey.receiptId&&journey.editionId,'Original EPA_ECHO source and completed customer selection are required.');
 journey.mcp=await runEchoMerchantReceiving({sourceRoot:PRODUCT,sourceCommit:SOURCE_COMMIT,artifactDirectory:join(BASE,'merchant-receiving'),
  workspaceId:journey.workspaceId,consoleUrl:server.url,editionId:journey.editionId,receiptId:journey.receiptId,table:'facilities',
  sourcePackageFile:INPUT,portfolioId:journey.portfolioId,receivedWorkspaceId:journey.receivedWorkspaceId,
  workspacePackageFile:journey.workspacePackageFile,originalCaptureRequest:(await read(join(BASE,'browser/journal.json'))).lostImport.request,
  originalReceiveRequest:(await read(join(BASE,'browser/journal.json'))).lostReceive.request,closeWorkspace:async()=>{await server.close();server=null;}});
 must(journey.mcp.state==='COMPLETE','ORIGINAL_EPA_ECHO_MERCHANT_FILE_RECEIVING_REQUIRED');
 await checkpoint('ORIGINAL_EPA_MCP_AND_ALL_FILES_COMPLETE');
 }
 if(facilitatorServer){
  journey.facilitatorFinal=facilitator.status();journey.facilitatorDrain=await facilitatorServer.close();
  must(journey.facilitatorDrain.drained===true,'ORIGINAL_FACILITATOR_DRAIN_REQUIRED');
  facilitatorServer=null;facilitator=null;
 }
 delete process.env.SCF_ROUTESCAN_BUYER_SECRET;delete process.env.SCF_ROUTESCAN_FEE_SECRET;
 const {runEchoApplications}=await import('./applications-receiving.mjs');
 journey.applications=await runEchoApplications({sourceRoot:PRODUCT,sourceCommit:SOURCE_COMMIT,artifactDirectory:join(BASE,'applications-receiving'),
  runtimeDirectory:process.env.EPA_ECHO_RUNTIME_DIRECTORY,workspace:DIRECTORY,workspaceId:journey.workspaceId,inboxDirectory:INBOX,
  releaseRuntimeFile:RUNTIME,receiptId:journey.receiptId,receivedWorkspaceId:journey.receivedWorkspaceId});
 must(journey.applications.state==='COMPLETE','ORIGINAL_EPA_APPLICATIONS_REQUIRED');
 must(sha(await readFile(join(OPERATOR,'policy.json')))===journey.operatorPolicySha256,'ORIGINAL_OPERATOR_POLICY_CHANGED');
 journey.transportCounts=transportCounts;journey.exchanges=exchanges;
 await checkpoint('OPERATING_WORK_COMPLETE');operatingComplete=true;
}catch(error){
 operationError=error;
 journey.error={code:error.code??'EPA_ECHO_NATIVE_OPERATION_FAILED',message:String(error.message).slice(0,1500),stack:String(error.stack).slice(0,7000),at:now()};
 try{journey.facilitatorAtError=facilitator?.status?.();}catch(statusError){journey.facilitatorStatusError={code:statusError.code,message:statusError.message};}
 journey.transportCounts=transportCounts;journey.exchanges=exchanges;
}finally{
 const cleanup=async(resource,close)=>{
  try{await close();}catch(error){cleanupErrors.push({resource,code:error.code??'EPA_ECHO_NATIVE_CLEANUP_FAILED',message:String(error.message).slice(0,1500),at:now()});}
 };
 await cleanup('browser',()=>browser?.close());
 await cleanup('EPA workspace',()=>server?.close());
 await cleanup('native facilitator',async()=>{
  if(facilitatorServer){const result=await facilitatorServer.close();must(result?.drained===true,'ORIGINAL_FACILITATOR_DRAIN_REQUIRED');}
  else if(facilitator)await facilitator.drain();
 });
 for(const socket of tunnels)await cleanup('transport socket',()=>socket.destroy());
 await cleanup('local proxy',()=>stop(proxy));await cleanup('merchant TLS listener',()=>stop(tls));
 delete process.env.SCF_ROUTESCAN_BUYER_SECRET;delete process.env.SCF_ROUTESCAN_FEE_SECRET;
}
if(operationError||cleanupErrors.length){
 if(!journey.error)journey.error={code:'EPA_ECHO_NATIVE_CLEANUP_FAILED',message:'The original operating resources did not all close.',at:now()};
 journey.error.cleanupErrors=cleanupErrors;journey.phase='CONTINUATION_REQUIRED';journey.updatedAt=now();
 try{await save(JOURNAL,journey);}catch(saveError){log({phase:'JOURNAL_SAVE_REQUIRED',code:saveError.code});}
 log({phase:'CONTINUATION_REQUIRED',code:journey.error.code,message:journey.error.message,cleanupErrors,activeBuyer:journey.activeBuyer??null});
 process.exitCode=1;
}else if(operatingComplete){
 journey.cleanup={state:'CLOSED',resources:['browser','EPA workspace','native facilitator','transport sockets','local proxy','merchant TLS listener']};
 journey.completedAt=now();await checkpoint('COMPLETE');
 log({phase:'COMPLETE',result:JOURNAL,workspaceId:journey.workspaceId,editionId:journey.editionId,receiptId:journey.receiptId,acquisition:journey.acquisition});
}
