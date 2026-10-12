// One original self-hosted Partition -> native SF66 buyer -> research receiving operation.
// Provider output comes from the pinned running API. RPC/Horizon use the retained
// native SDK fixture; the buyer, signer, verifier, settlement and receiving code are original.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createServer,request as httpRequest} from 'node:http';
import {createServer as createTlsServer} from 'node:https';
import {connect} from 'node:net';
import {once} from 'node:events';
import {fixture,readOnlyRpc} from './linkup-native-fixture.mjs';

const output=resolve(process.env.UNSTRUCTURED_NATIVE_OUTPUT);
const scratch=resolve(process.env.LINKUP_FIXTURE_ROOT);
const source=resolve(process.env.UNSTRUCTURED_NATIVE_SOURCE);
const providerOrigin=new URL(process.env.UNSTRUCTURED_NATIVE_PROVIDER_ORIGIN);
assert.equal(providerOrigin.hostname,'127.0.0.1');
assert.equal(providerOrigin.protocol,'http:');
const scf=join(source,'stellar/scf-starforge-20261009');
const runtime=join(scf,'sf88-operator-buyer-cli');
const load=relative=>import(pathToFileURL(join(scf,relative)).href);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const {writeBytes:writeOriginalBytes}=await load('sf88-operator-buyer-cli/node/store.mjs');
let saving=Promise.resolve();
const save=(path,value)=>{const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
 const work=saving.then(()=>writeOriginalBytes(path,bytes));saving=work.catch(()=>{});return work;};
const exists=async path=>access(path).then(()=>true,()=>false);
const [{prepareUnstructuredMerchant},{prepareUnstructuredCommerce,inspectUnstructuredCommerce},
 {openCommerce},{startCommerceConsole},{openSavedDocumentBuyerSource},
 {startDossierWorkspace},{openDossierStore},{createPartitionEditionProvider}]=await Promise.all([
  load('partners/unstructured/merchant.mjs'),load('partners/unstructured/commerce.mjs'),
  load('sf66-demo-launcher/commerce.mjs'),load('sf66-demo-launcher/commerce-console.mjs'),
  load('sf88-operator-buyer-cli/research-dossiers/unstructured-workspace.mjs'),
  load('sf88-operator-buyer-cli/research-dossiers/server.mjs'),
  load('sf88-operator-buyer-cli/research-dossiers/dossier.mjs'),
  load('sf88-operator-buyer-cli/node/unstructured/dossier.mjs')]);
const reportPath=join(output,'native-receiving-result.json');
const report=await exists(reportPath)?JSON.parse(await readFile(reportPath,'utf8')):{
 schema:'stellar-forge.unstructured-native-receiving.v1',
 operationId:'SCF-UNSTRUCTURED-DOCUMENT-RECEIVING-20261012-B9D2',
 sourceCommit:process.env.UNSTRUCTURED_NATIVE_SOURCE_COMMIT,
 providerSource:'Unstructured-IO/unstructured-api@448352104eefd2e5b8fa2dc32282fc1cd3db31ae',
 status:'PREPARED',providerTransport:'Actual pinned self-hosted Partition API',
 chainTransport:'Controlled RPC/Horizon with original @x402/stellar@2.28 signing, verification and settlement',
 checkpoints:[],purchases:[],receiving:[],providerRequests:[],merchantRequests:[]};
assert.equal(report.operationId,'SCF-UNSTRUCTURED-DOCUMENT-RECEIVING-20261012-B9D2');
if(report.status==='PASS'){console.log(JSON.stringify({status:'REOPENED_COMPLETE',result:reportPath}));process.exit(0);}
const receiveOnly=process.argv.includes('--receive-only');
const errors=[],peers=new Set();
let capture,tls,proxy,commerce,consoleApp,research,coldResearch,browser;
let selectedProfile,pageToken;
const profiles=[
 {id:'fast',file:'layout-parser-paper-fast.pdf',parameters:{strategy:'fast',pdf_infer_table_structure:false}},
 {id:'auto',file:'embedded-images-tables.pdf',parameters:{strategy:'auto',languages:['eng']}},
 {id:'layout-tables',file:'embedded-images-tables.pdf',parameters:{strategy:'hi_res',languages:['eng'],pdf_infer_table_structure:true}}
];
const preparedDir=join(output,'customer-session'),merchantDir=join(output,'merchant');
const dossierDir=join(output,'research-dossiers');
async function checkpoint(name,data={}){
 report.checkpoints.push({name,at:new Date().toISOString(),...data});
 await save(reportPath,report);console.log(JSON.stringify({phase:name,...data}));
}
async function listen(server,port=0){server.listen(port,'127.0.0.1');await once(server,'listening');return server.address().port;}
async function stop(server){if(!server)return;server.closeAllConnections?.();await new Promise(ok=>server.close(ok));}
async function bytes(req,max=16777216){const parts=[];let n=0;for await(const p of req){n+=p.length;assert(n<=max);parts.push(p);}return Buffer.concat(parts);}
async function waitFor(check,{timeout=300000,message='Original operation did not reach its next state'}={}){
 const end=Date.now()+timeout;while(Date.now()<end){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,200));}throw Error(message);
}
async function browserClick(page,selector){await page.locator(selector).click({timeout:30000});}
async function pageJson(page,path,options={}){
 assert(typeof pageToken==='string'&&pageToken.length===64,'Original authenticated page token is required');
 return page.evaluate(async({path,options,token})=>{
  const res=await fetch(path,{method:options.method??'GET',headers:{Authorization:'Bearer '+token,
   ...(options.body?{'Content-Type':'application/json'}:{})},body:options.body?JSON.stringify(options.body):undefined});
  return {status:res.status,body:await res.json()};
 },{path,options,token:pageToken});
}
async function originalSession(page,intent){
 const value=await pageJson(page,'/api/session?intent='+encodeURIComponent(intent));assert.equal(value.status,200);return value.body;
}
async function originalDossier(page,id){
 const value=await pageJson(page,'/api/dossiers/'+encodeURIComponent(id));assert.equal(value.status,200);return value.body;
}
async function dossierId(page){
 const response=await pageJson(page,'/api/state');assert.equal(response.status,200);
 const rows=response.body.dossiers??[];const row=rows.find(x=>x.title==='Unstructured document operations');
 return row?.id;
}
async function selectDossier(page,id){
 const state=await pageJson(page,'/api/state');assert.equal(state.status,200);
 const title=state.body.dossiers.find(x=>x.id===id)?.title;assert(title);
 await page.locator('#dossier-list button').filter({hasText:title}).first().click();
 await page.locator('#dossier-title').filter({hasText:title}).waitFor();
}
async function exportFromBrowser(page,format,destination){
 await browserClick(page,'#export-open');await page.locator('#export-format').selectOption(format);
 const download=page.waitForEvent('download');await browserClick(page,'#export-form button[type="submit"]');
 await (await download).saveAs(destination);return {bytes:(await readFile(destination)).length,sha256:sha(await readFile(destination))};
}
async function documentDownload(page,kind,destination){
 const download=page.waitForEvent('download');await page.locator('[data-document-download="'+kind+'"]').click();
 await(await download).saveAs(destination);return sha(await readFile(destination));
}
try {
 await mkdir(output,{recursive:true,mode:0o700});
 await mkdir(join(output,'provider-captures'),{recursive:true,mode:0o700});
 const providerIdentity=JSON.parse(await readFile(process.env.UNSTRUCTURED_NATIVE_PROVIDER_IDENTITY,'utf8'));
 assert.equal(providerIdentity.apiCommit,'448352104eefd2e5b8fa2dc32282fc1cd3db31ae');
 report.providerRuntime=providerIdentity;
 const {chromium}=await import(pathToFileURL(process.env.UNSTRUCTURED_NATIVE_PLAYWRIGHT).href);
 browser=await chromium.launch({executablePath:process.env.UNSTRUCTURED_NATIVE_BROWSER,headless:true,
  args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server'],env:{...process.env,TMPDIR:scratch}});
 const context=await browser.newContext({viewport:{width:1360,height:1000},acceptDownloads:true});
 context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 const page=await context.newPage();
 if(!receiveOnly){
  assert(report.purchases.length===0,'Paid requests are retained; use --receive-only instead of executing another payment');
  const key=await readFile(join(scratch,'test.key')),cert=await readFile(join(scratch,'test.crt'));
  capture=createServer((req,res)=>void(async()=>{
   assert.equal(req.method,'POST');assert.equal(req.url,'/general/v0/general');assert(selectedProfile);
   assert(!req.headers['payment-signature']);
   const original=await bytes(req),index=report.providerRequests.length;
   const requestFile=join(output,'provider-captures',String(index+1).padStart(2,'0')+'-request.bin');
   await writeFile(requestFile,original,{mode:0o600});
   const row={profile:selectedProfile,method:req.method,path:req.url,
    requestFile,requestBytes:original.length,requestSha256:sha(original),
    contentType:req.headers['content-type'],receivedAt:Date.now(),
    nativeSubmissionsBeforeResponse:fixture.state.submissions.length};
   report.providerRequests.push(row);await save(reportPath,report);
   const target=new URL(req.url,providerOrigin);let incoming;
   const forwarded=httpRequest(target,{method:req.method,headers:{...req.headers,host:target.host}},upstream=>{
    incoming=upstream;void(async()=>{
     const raw=await bytes(upstream,67108864);
     row.status=upstream.statusCode;row.responseHeaders=Object.fromEntries(Object.entries(upstream.headers)
      .filter(([name])=>['content-type','content-length','content-disposition'].includes(name)));
     row.responseFile=join(output,'provider-captures',String(index+1).padStart(2,'0')+'-response.bin');
     await writeFile(row.responseFile,raw,{mode:0o600});
     row.responseBytes=raw.length;row.responseSha256=sha(raw);row.completedAt=Date.now();
     await save(reportPath,report);
     res.writeHead(upstream.statusCode,upstream.headers);res.end(raw);
    })().catch(error=>{errors.push(error.stack);res.destroy(error);});
   });
   forwarded.on('error',error=>{errors.push(error.stack);res.destroy(error);});
   res.once('close',()=>{if(!res.writableEnded){incoming?.destroy();forwarded.destroy();}});
   forwarded.end(original);
  })().catch(error=>{errors.push(error.stack);if(!res.headersSent)res.writeHead(500);res.end();}));
  const capturePort=await listen(capture);
  process.env.LINKUP_FIXTURE_PAYER_SECRET=fixture.payer.secret();
  process.env.LINKUP_FIXTURE_FACILITATOR_SECRET=fixture.facilitator.secret();
  // TLS carries the existing merchant requests and independent original RPC observer.
  tls=createTlsServer({key,cert},(req,res)=>{
   if(req.headers.host?.split(':')[0]==='soroban-testnet.stellar.org'){
    void(async()=>{const message=JSON.parse(await bytes(req,65536));res.writeHead(200,{'content-type':'application/json'});
     res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result:readOnlyRpc(message.method,message.params)}));
    })().catch(error=>{errors.push(error.stack);if(!res.headersSent)res.writeHead(500);res.end();});return;
   }
   if(!commerce){res.writeHead(503);res.end();return;}
   const retained={method:req.method,path:req.url,signed:Boolean(req.headers['payment-signature']),at:Date.now()};
   report.merchantRequests.push(retained);const chunks=[];
   req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{retained.bodySha256=sha(Buffer.concat(chunks));});
   let incoming;const forward=httpRequest(new URL(req.url,commerce.seller.url),{
    method:req.method,headers:{...req.headers,host:new URL(commerce.seller.url).host}},got=>{
     incoming=got;res.writeHead(got.statusCode,got.headers);got.pipe(res);
    });
   res.once('close',()=>{if(!res.writableEnded){incoming?.destroy();forward.destroy();}});
   forward.on('error',error=>res.destroy(error));req.pipe(forward);
  });
  const tlsPort=await listen(tls);
  proxy=createServer((_req,res)=>res.writeHead(405).end());
  proxy.on('connect',(req,socket,head)=>{
   if(!['merchant.example:443','soroban-testnet.stellar.org:443'].includes(req.url)||head.length){
    errors.push('Unexpected CONNECT '+req.url);socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;
   }
   const peer=connect(tlsPort,'127.0.0.1',()=>{
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');socket.pipe(peer);peer.pipe(socket);
   });
   for(const side of[socket,peer]){peers.add(side);side.once('close',()=>peers.delete(side));}
   peer.on('error',()=>socket.destroy());socket.on('error',()=>peer.destroy());
   socket.once('close',()=>peer.destroy());peer.once('close',()=>socket.destroy());
  });
  process.env.LINKUP_FIXTURE_PROXY='http://127.0.0.1:'+await listen(proxy);
  const configuration={
   schema:'stellar-forge.unstructured-partition.v1',publicOrigin:'https://merchant.example',
   upstream:{origin:'http://127.0.0.1:'+capturePort,apiKeyEnv:'UNSTRUCTURED_API_KEY',timeoutMs:240000,maxInFlight:1},
   requestTimeoutMs:300000,handlerTimeoutMs:245000,admissionTimeoutMs:2000,
   profiles:profiles.map(p=>({id:p.id,title:'Original '+p.id+' document partition',
    description:'Pinned self-hosted Partition with the declared document profile.',parameters:p.parameters,
    maxDocumentBytes:8388608,maxResponseBytes:1048576,paymentOptions:[{
     scheme:'exact',network:'stellar:testnet',asset:fixture.asset,payTo:fixture.merchant.publicKey(),
     amount:'10000',maxTimeoutSeconds:300,extra:{paymentFlow:'authorization'}}]}))
  };
  const configFile=join(output,'partition-input.json');await save(configFile,configuration);
  const merchant=await prepareUnstructuredMerchant({configurationFile:configFile,directory:merchantDir,
   python:process.env.UNSTRUCTURED_NATIVE_PYTHON,allowLoopbackUpstream:true});
  const nativeProfile={schema:'stellar-forge.native-facilitator.v1',network:'stellar:testnet',
   rpcUrl:'https://native-unstructured.invalid',
   signers:[{address:fixture.facilitator.publicKey(),secretEnv:'LINKUP_FIXTURE_FACILITATOR_SECRET'}],
   payments:{assets:[fixture.asset],recipients:[fixture.merchant.publicKey()],maxAtomic:'10000',paymentFlows:['authorization']},
   limits:{maxTransactionFeeStroops:50000,drainGraceMs:1000},
   operations:{ownershipDirectory:join(output,'facilitator-ownership')}};
  const facilitatorConfig=join(output,'facilitator.json');await save(facilitatorConfig,nativeProfile);
  const selection={schema:'stellar-forge.unstructured-commerce.v1',merchantDirectory:merchant.directory,
   facilitatorConfig,operator:{actor:'document-customer',service:'unstructured-document-review',
    python:process.env.UNSTRUCTURED_NATIVE_PYTHON,payer:fixture.payer.publicKey(),secretEnv:'LINKUP_FIXTURE_PAYER_SECRET',
    httpsProxyEnv:'LINKUP_FIXTURE_PROXY',totalAtomic:'30000',dailyAtomic:'30000'},
   workspaceId:'unstructured-native-documents',runtimeDirectory:runtime,sellerPort:0,operationsPort:0,
   documents:profiles.map(p=>({profile:p.id,file:join(process.env.UNSTRUCTURED_NATIVE_CORPUS,p.file),
    filename:p.file,mediaType:'application/pdf',intentId:'unstructured-document-'+p.id,maxAtomic:'10000',acceptIndex:0}))};
  const selectionFile=join(output,'customer-input.json');await save(selectionFile,selection);
  const prepared=await prepareUnstructuredCommerce({configFile:selectionFile,directory:preparedDir});
  assert.equal(prepared.documents.length,3);
  commerce=await openCommerce(prepared.originalCommerce.session.directory,{environment:process.env});
  consoleApp=await startCommerceConsole(commerce,{port:0,environment:process.env,approvalMode:'BROWSER'});
  pageToken=consoleApp.token;await page.goto(consoleApp.operatorUrl);
  await checkpoint('original-merchant-and-three-customer-requests-prepared',{documents:prepared.documents.map(x=>({
   intent:x.intentId,profile:x.profileId,document:x.document,bodySha256:x.bodySha256,bodyBytes:x.bodyBytes})),
   sourceFile:prepared.documentSourceFile});
  for(const[index,p]of profiles.entries()){
   const intent='unstructured-document-'+p.id;selectedProfile=p.id;process.env.LINKUP_FIXTURE_NONCE=String(17+index);
   await page.locator('#operation-select').selectOption(intent);
   await browserClick(page,'#review');
   await waitFor(async()=>!(await page.locator('#execute').isDisabled()),{timeout:30000});
   assert.equal(report.providerRequests.length,index);assert.equal(fixture.state.submissions.length,index);
   await browserClick(page,'#execute');
   const approval=await waitFor(async()=>{
    const current=await originalSession(page,intent);
    return current.approval?.state==='AWAITING_OPERATOR'?current.approval:null;
   },{timeout:90000,message:'Original browser signer did not request approval'});
   assert.equal(approval.intentId,intent);
   assert.equal(approval.review.max_atomic_units_to_reserve,'10000');
   assert.equal(approval.review.body_sha256,prepared.documents[index].bodySha256);
   assert.equal(approval.review.body_bytes,prepared.documents[index].bodyBytes);
   assert.equal(approval.review.complete_original_accepted_terms.extra.paymentFlow,'authorization');
   await page.locator('#operator-approval .approval-approve').waitFor({state:'visible',timeout:30000});
   await page.locator('#operator-approval .approval-approve').click();
   await checkpoint('original-browser-approved-'+p.id,{intent,requestSha256:approval.review.request_sha256,
    bodySha256:approval.review.body_sha256,maximumAtomic:approval.review.max_atomic_units_to_reserve});
   await waitFor(async()=>{
    const current=await originalSession(page,intent);
    if(current.activeIntent===intent||!current.attempt||current.attempt.state==='RUNNING')return null;
    assert(!current.attempt.error,'Original buyer failed: '+JSON.stringify(current.attempt));
    assert.equal(current.operation?.state,'ATTEMPT_RECORDED',JSON.stringify(current));
    return current;
   },{timeout:300000,message:'Original paid document request did not finish'});
   const originalSource=await openSavedDocumentBuyerSource(prepared.documentSourceFile);
   const provider=createPartitionEditionProvider(originalSource.buyer,originalSource);
   const envelope=await provider.envelope(intent);
   assert(envelope?.originalPurchase,'Original native purchase envelope missing');
   const raw=Buffer.from(envelope.originalPurchase.response.bodyBase64,'base64');
   const actual=report.providerRequests[index];
   assert.equal(actual.status,200);assert.equal(sha(raw),actual.responseSha256);
   const payload=JSON.parse(raw);assert(Array.isArray(payload)&&payload.length>0);
   assert.equal(fixture.state.submissions.length,index+1);assert.equal(actual.nativeSubmissionsBeforeResponse,index);
   assert(fixture.state.submissions[index].at>=actual.completedAt);
   const originalDocument=await readFile(selection.documents[index].file);
   const signed=report.merchantRequests.filter(x=>x.path==='/documents/unstructured/'+p.id&&x.signed);
   assert.equal(signed.length,1);assert.equal(signed[0].bodySha256,prepared.documents[index].bodySha256);
   const saved={intent,profile:p.id,elementCount:payload.length,responseBytes:raw.length,responseSha256:sha(raw),
    documentSha256:sha(originalDocument),bodySha256:prepared.documents[index].bodySha256,
    nativeSubmission:fixture.state.submissions[index],envelopeFile:join(output,p.id+'-envelope.json')};
   await save(saved.envelopeFile,envelope);report.purchases.push(saved);
   report.native=fixture.state;await checkpoint('original-'+p.id+'-paid-and-retained',saved);
  }
  await page.screenshot({path:join(output,'original-commerce-console.png'),fullPage:true});
  await consoleApp.close();consoleApp=null;await commerce.close();commerce=null;
  for(const peer of peers)peer.destroy();await stop(proxy);proxy=null;await stop(tls);tls=null;await stop(capture);capture=null;
  await checkpoint('merchant-stopped-with-three-original-purchases',{nativeSubmissions:fixture.state.submissions.length});
 }
 assert.equal(report.purchases.length,3,'Receiving requires the retained three original purchases');
 const reopened=await inspectUnstructuredCommerce(preparedDir);
 const documentSource=await openSavedDocumentBuyerSource(reopened.documentSourceFile);
 research=await startDossierWorkspace({directory:dossierDir,documentSource});
 pageToken=research.token;await page.goto(research.url);
 if(!report.dossierId){
  await browserClick(page,'#new-dossier');await page.locator('#form-title').fill('Unstructured document operations');
  await page.locator('#form-description').fill('Original paid document input, partition output, evidence selection and receiving recovery.');
  await browserClick(page,'#dossier-form button[type="submit"]');
  report.dossierId=await waitFor(()=>dossierId(page),{timeout:30000});
  await browserClick(page,'[data-tab="questions"]');await browserClick(page,'#add-question');
  await page.locator('#form-question').fill('What text, page and table elements does each configured profile retain from the original documents?');
  await browserClick(page,'#question-submit');
  await checkpoint('original-research-dossier-and-question-saved',{dossierId:report.dossierId});
 }else await selectDossier(page,report.dossierId);
 let current=await originalDossier(page,report.dossierId);
 const dossier=current.dossier??current;
 const questionId=dossier.questions[0].id;assert(questionId);
 for(const[index,purchase]of report.purchases.entries()){
  if(report.receiving.some(x=>x.intent===purchase.intent))continue;
  await browserClick(page,'[data-tab="documents"]');await browserClick(page,'#document-refresh');
  await page.locator('#document-purchases .document-item').filter({hasText:purchase.intent}).click();
  await page.locator('#document-current').waitFor({state:'visible'});
  await page.locator('#document-question').selectOption(questionId);
  await page.locator('#document-label').fill('Original '+purchase.profile+' document edition');
  await waitFor(async()=>!(await page.locator('#document-receive').isDisabled()),{timeout:30000});
  if(index===1){
   const target='**/api/dossiers/'+report.dossierId+'/unstructured/receive';
   let committed=false;
   await page.route(target,async route=>{
    await page.unroute(target);
    const response=await route.fetch();assert.equal(response.status(),200);
    committed=true;await route.abort('connectionreset');
   });
   await browserClick(page,'#document-receive');
   await waitFor(async()=>committed,{timeout:30000});
   const pending=await page.evaluate(id=>localStorage.getItem('unstructured-receive:'+id),report.dossierId);
   assert(pending,'Lost receiving reply must retain the original action');
   const before=await originalDossier(page,report.dossierId);
   const beforeView=before.dossier??before;
   const oldPort=new URL(research.url).port,oldToken=research.token;
   await research.close();research=await startDossierWorkspace({directory:dossierDir,port:Number(oldPort),documentSource});
   assert.notEqual(research.token,oldToken);
   // Retry the same retained decision in the still-open page; its original token receives a real 401.
   const unauthorized=page.waitForResponse(response=>response.url().endsWith('/unstructured/receive')&&response.status()===401);
   await browserClick(page,'#document-receive');await unauthorized;
   await page.locator('#session-dialog').waitFor({state:'visible'});
   assert.equal(await page.evaluate(id=>localStorage.getItem('unstructured-receive:'+id),report.dossierId),pending);
   await page.locator('#session-url').fill(research.url);
   await browserClick(page,'#session-form button[type="submit"]');
   await page.locator('#session-dialog').waitFor({state:'hidden'});
   pageToken=research.token;
   await waitFor(async()=>!(await page.locator('#document-receive').isDisabled()),{timeout:30000});
   await browserClick(page,'#document-receive');
   await waitFor(async()=>!(await page.evaluate(id=>localStorage.getItem('unstructured-receive:'+id),report.dossierId)),{timeout:30000});
   const after=await originalDossier(page,report.dossierId),afterView=after.dossier??after;
   assert.equal(afterView.revision,beforeView.revision);
   await checkpoint('lost-reply-token-rotation-same-receiving-action-recovered',{intent:purchase.intent,
    revision:afterView.revision,pendingActionSha256:sha(Buffer.from(pending))});
  }else{
   await browserClick(page,'#document-receive');
   await waitFor(async()=>!(await page.evaluate(id=>localStorage.getItem('unstructured-receive:'+id),report.dossierId)),{timeout:30000});
  }
  const fresh=await originalDossier(page,report.dossierId),view=fresh.dossier??fresh;
  const edition=view.editions.find(x=>x.label==='Original '+purchase.profile+' document edition');
  assert(edition,'Committed original edition missing');
  const documentHash=await documentDownload(page,'document',join(output,purchase.profile+'-received.pdf'));
  const responseHash=await documentDownload(page,'response',join(output,purchase.profile+'-received.json'));
  assert.equal(documentHash,purchase.documentSha256);assert.equal(responseHash,purchase.responseSha256);
  report.receiving.push({intent:purchase.intent,editionId:edition.id,revision:view.revision,
   documentSha256:documentHash,responseSha256:responseHash});
  await checkpoint('received-original-'+purchase.profile,{editionId:edition.id,sourceCount:view.sources.length});
 }
 // Use the original evidence UI and finding editor on an actual retained occurrence.
 await browserClick(page,'[data-tab="sources"]');
 await page.locator('#source-rows button').first().click();
 await page.locator('#detail-note').fill('Retained from the exact paid Partition response; the original document and page metadata remain available in Documents.');
 await browserClick(page,'#save-note');
 await waitFor(async()=>await page.locator('#save-note').isDisabled(),{timeout:30000});
 await page.locator('#detail-selected').check();
 await waitFor(async()=>await page.locator('#save-note').isDisabled(),{timeout:30000});
 await page.locator('#detail-classification').selectOption('background');
 await browserClick(page,'[data-tab="findings"]');await browserClick(page,'#add-finding');
 await page.locator('#finding-question').selectOption(questionId);
 await page.locator('#finding-title').fill('Original document content is retained with its processing profile');
 const firstResponse=JSON.parse(await readFile(join(output,report.purchases[0].profile+'-received.json'),'utf8'));
 const firstText=firstResponse.find(x=>typeof x.text==='string'&&x.text.trim())?.text.trim().slice(0,180);
 assert(firstText);
 await page.locator('#finding-text').fill('The retained fast-profile output begins with: '+firstText+
  '\nThe Documents pane also retains the auto and layout/table editions, with each complete source response and original document.');
 await page.locator('#finding-sources input[name="findingSource"]').first().check();
 await browserClick(page,'#finding-form button[type="submit"]');
 await waitFor(async()=>!(await page.locator('#finding-dialog').isVisible()),{timeout:30000});
 const portableFile=join(output,'unstructured-document-dossier.json');
 report.portable=await exportFromBrowser(page,'json',portableFile);
 report.html=await exportFromBrowser(page,'html',join(output,'unstructured-document-report.html'));
 const retainedState=await originalDossier(page,report.dossierId),retained=retainedState.dossier??retainedState;
 report.dossier={id:retained.id,revision:retained.revision,editions:retained.editions.length,
  sources:retained.sources.length,findings:retained.findings.length};
 assert.equal(report.dossier.editions,3);assert.equal(report.dossier.findings,1);
 await browserClick(page,'[data-tab="documents"]');
 await page.locator('#document-editions .document-item').first().click();
 await page.screenshot({path:join(output,'document-receiving-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 await page.screenshot({path:join(output,'document-receiving-mobile.png'),fullPage:true});
 await research.close();research=null;
 // Cold original workspace has no buyer/provider configuration or merchant process.
 coldResearch=await startDossierWorkspace({directory:join(output,'cold-restored-dossier')});
 pageToken=coldResearch.token;await page.goto(coldResearch.url);await page.locator('#portable-file').setInputFiles(portableFile);
 await waitFor(async()=>await page.locator('#dossier-title').textContent()==='Unstructured document operations',{timeout:30000});
 const cold=await originalDossier(page,report.dossierId),coldView=cold.dossier??cold;
 assert.equal(coldView.revision,retained.revision);
 assert.deepEqual(coldView.editions,retained.editions);assert.deepEqual(coldView.sources,retained.sources);
 assert.deepEqual(coldView.findings,retained.findings);
 await browserClick(page,'[data-tab="documents"]');
 for(const purchase of report.purchases){
  await page.locator('#document-editions .document-item').filter({hasText:'Original '+purchase.profile+' document edition'}).click();
  assert.equal(await documentDownload(page,'document',join(output,purchase.profile+'-cold-restored.pdf')),purchase.documentSha256);
  assert.equal(await documentDownload(page,'response',join(output,purchase.profile+'-cold-restored.json')),purchase.responseSha256);
 }
 report.status='PASS';report.browser={pageErrors:errors,desktopWidth:1360,mobileWidth:390};
 assert.deepEqual(errors,[]);
 await checkpoint('complete-original-dossier-cold-reopened-with-original-bytes',{...report.dossier,
  providerCalls:report.providerRequests.length,nativeSubmissions:report.native?.submissions?.length});
}catch(error){
 report.status='INTERRUPTED';report.error={code:error.code??error.name,message:error.message,stack:error.stack};
 if(!receiveOnly)report.native=fixture.state;report.pageErrors=errors;await save(reportPath,report);throw error;
}finally{
 await browser?.close();await research?.close();await coldResearch?.close();
 await consoleApp?.close();await commerce?.close();for(const peer of peers)peer.destroy();
 await stop(proxy);await stop(tls);await stop(capture);
}
