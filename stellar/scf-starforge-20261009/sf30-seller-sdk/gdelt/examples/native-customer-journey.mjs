// One original GDELT customer case; existing SF30/SF36/SF81/SF88/SF100 engines.
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {readFile,writeFile,readdir,mkdir,lstat,open,rename,rm,copyFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const SOURCE=resolve(process.env.GDELT_NATIVE_SOURCE);
const GD=join(SOURCE,'stellar/scf-starforge-20261009/sf30-seller-sdk/gdelt');
const SCF=join(SOURCE,'stellar/scf-starforge-20261009');
const importFile=path=>import(pathToFileURL(path).href);
const {withPrivateLock,atomicJson}=await importFile(join(SCF,'sf30-seller-sdk/routescan/quota.mjs'));
const {initializeGdeltProject,readGdeltProject,getGdeltCapture,getGdeltReview,receiveGdeltProject,reviewGdeltCapture}=await importFile(join(GD,'project.mjs'));
const {optionalJson,durableDirectory,exactFile}=await importFile(join(GD,'source.mjs'));
const {openGdeltApplication}=await importFile(join(GD,'application.mjs'));
const {startGdeltWorkspace}=await importFile(join(GD,'workspace.mjs'));
const {createNativeHttpFactory}=await importFile(join(SCF,'sf30-seller-sdk/native-http-factory.mjs'));
const {Buyer}=await importFile(join(SCF,'sf88-operator-buyer-cli/node/client.mjs'));
const {initializeMerchantProvider}=await importFile(join(SOURCE,'stellar-forge/mcp-merchant-operator/providers.mjs'));
const {inspectMerchantProvider}=await importFile(join(SOURCE,'stellar-forge/mcp-merchant-operator/provider-cli.mjs'));
const {startMerchantMcp}=await importFile(join(SOURCE,'stellar-forge/mcp-merchant-operator/serve.mjs'));
const {openMerchantFileClient}=await importFile(join(SOURCE,'stellar-forge/mcp-merchant-operator/retained-download.mjs'));
const {localFacilitator,localMerchantTransport,PAYMENT,MODE}=await importFile(join(SCF,'sf30-seller-sdk/stac/examples/gdelt-native-fixture-exports.mjs'));
const {gdeltLoopbackJson}=await importFile(join(GD,'loopback.mjs'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const schema='stellar-forge.gdelt-native-customer.v1';
const OP='SCF-GDELT-EVENT-DESK-7DE2-20261012';
const ORIGIN='https://gdelt-journey.example';
const flags=Object.create(null);
for(let i=2;i<process.argv.length;i++){
  const key=process.argv[i];
  if(key==='--fixture-tty-child'){flags.child=true;continue;}
  if(!['--directory','--python'].includes(key)||!process.argv[i+1])throw Error('Use the retained directory and Python executable.');
  flags[key.slice(2)]=process.argv[++i];
}
const ROOT=resolve(flags.directory),PYTHON=flags.python??process.env.CODEX_PRIMARY_RUNTIME_PYTHON??'python3';
await durableDirectory(ROOT);
async function save(name,value){const p=join(ROOT,name);await durableDirectory(dirname(p));await atomicJson(dirname(p),p.slice(dirname(p).length+1),value);return value;}
async function retained(name,make){let v=await optionalJson(join(ROOT,name),4*1024*1024);if(v)return v;v=await make();await exactFile(await durableDirectory(dirname(join(ROOT,name))),name.split('/').at(-1),Buffer.from(json(v)));return v;}
async function port(){const s=createServer();await new Promise((done,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',done)});const p=s.address().port;await new Promise(done=>s.close(done));return p;}
async function auditFiles(root){
  const rows=[];
  async function visit(path,relative=''){for(const e of(await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const p=join(path,e.name),r=relative?relative+'/'+e.name:e.name;if(e.isSymbolicLink())continue;
    if(e.isDirectory())await visit(p,r);else if(e.isFile()){const b=await readFile(p);rows.push({path:r,bytes:b.length,sha256:hash(b)});}
  }}await visit(root);return rows;
}
async function run(){
 return withPrivateLock(ROOT,'journey.lock',async()=>{
  const old=await optionalJson(join(ROOT,'result.json'),16*1024*1024);
  if(old?.state==='COMPLETE'){
    assert.equal(old.schema,schema);assert.equal(old.operation,OP);
    for(const file of old.deliverables){const b=await readFile(join(ROOT,'outputs',file.path));assert.equal(b.length,file.bytes);assert.equal(hash(b),file.sha256);}
    await readGdeltProject(old.receivedProject);
    console.log(JSON.stringify({operation:OP,state:'COMPLETE',reused:true,result:join(ROOT,'result.json')}));
    return old;
  }
  const started=await retained('intent.json',async()=>({schema,operation:OP,mode:MODE,createdAt:new Date().toISOString(),source:SOURCE}));
  assert.equal(started.operation,OP);
  const project=join(ROOT,'event-desk'),fixture=await durableDirectory(join(ROOT,'local-fixture'));
  const outputs=await durableDirectory(join(ROOT,'outputs'));
  const settings=await retained('runtime-selection.json',async()=>({merchantPort:await port(),origin:ORIGIN}));
  assert.equal(settings.origin,ORIGIN);
  const projectState=await initializeGdeltProject({directory:project,title:'GDELT native customer event desk'});
  let facilitator,transport,app,browser,mcp,client,playwrightBrowser,configuration,operationFailure;
  let gateResolve;
  const gate=new Promise(done=>{gateResolve=done});
  let pauseMention=!await optionalJson(join(ROOT,'capture-cancelled.json'));
  const sourceRequests=await optionalJson(join(ROOT,'source-requests-current.json'),4*1024*1024)??[];
  assert(Array.isArray(sourceRequests));
  const fetchImpl=async(url,options)=>{
    if(pauseMention&&String(url).endsWith('.mentions.CSV.zip')){
      pauseMention=false;gateResolve({url:String(url)});
      await new Promise((done,reject)=>{if(options.signal.aborted)return reject(options.signal.reason);options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});
    }
    const response=await fetch(url,options);
    sourceRequests.push({url:String(url),status:response.status,at:new Date().toISOString()});
    try{await save('source-requests-current.json',sourceRequests);}
    catch(error){try{await response.body?.cancel();}catch{}throw error;}
    return response;
  };
  const step=async(name,value)=>{await save('steps/'+name+'.json',{at:new Date().toISOString(),...value});console.log(JSON.stringify({operation:OP,step:name,...value}));};
  const environment={...process.env,GDELT_NATIVE_MCP_TOKEN:randomBytes(32).toString('hex'),MCP_OAUTH_CONFIG:undefined,MCP_CLIENT_ORIGINS:''};
  const restartMcp=async()=>{
    await client?.close();client=null;if(mcp){await mcp.close();mcp=null;}
    mcp=await startMerchantMcp({configPath:configuration,port:0,tokenEnv:'GDELT_NATIVE_MCP_TOKEN',environment});
    client=await openMerchantFileClient({url:mcp.url,tokenEnv:'GDELT_NATIVE_MCP_TOKEN',environment,errorPrefix:'GDELT',clientName:'original-gdelt-native-customer'});
  };
  const call=(name,args={})=>client.call('merchant_gdelt_'+name,{workspace:'desk',...args});
  const mutation=async(name,id,body)=>{
    const request=await retained('requests/'+id+'.json',async()=>({workspace:'desk',id,expectedRevision:(await call('status')).project.revision,...body}));
    return client.call('merchant_gdelt_'+name,request);
  };
  const dataset=(action,id,body={})=>call('dataset',{action,id,...body});
  try{
    facilitator=await localFacilitator();
    transport=await localMerchantTransport(fixture,'http://127.0.0.1:'+settings.merchantPort);
    const keys=await retained('local-fixture/operator-keys.json',async()=>Object.fromEntries(['SF36_CONSENT_KEY_B64','SF36_AUDIT_KEY_B64','SF36_OPERATOR_KEY_B64'].map(k=>[k,randomBytes(32).toString('base64')])));
    const buyer=await new Buyer({runtimeDirectory:join(SCF,'sf88-operator-buyer-cli'),stateDirectory:join(ROOT,'buyer'),
      operatorProfile:join(fixture,'operator-profile.json'),environment:{...process.env,...keys,NODE_EXTRA_CA_CERTS:transport.certFile},timeoutMs:180000}).ready();
    const nativeFactory=await createNativeHttpFactory({facilitator:facilitator.url,allowLocalFacilitator:true});
    app=await openGdeltApplication({directory:project,python:PYTHON,buyer,nativeFactory,merchantPort:settings.merchantPort,fetchImpl});
    browser=await startGdeltWorkspace({application:app,port:0,connectionFile:join(ROOT,'browser-connection.json')});
    await save('browser-startup.json',browser.startup);
    const host={schema:'stellar-forge.gdelt-workspace-host.v1',workspaces:{desk:{label:'Original GDELT event desk',
      connectionFile:join(ROOT,'browser-connection.json'),projectId:projectState.id,expectedBindingSha256:browser.startup.binding.sha256,
      timeoutMs:1800000,inputs:{},merchantProfiles:{native:{label:'Original local protocol',origin:ORIGIN,path:'/gdelt',payment:PAYMENT}}}}};
    await retained('host-connection.json',async()=>host);
    const registered=inspectMerchantProvider('gdelt-workspaces').providers[0];
    assert.equal(registered.family,'gdeltWorkspaces');assert(registered.tools.some(t=>t.name==='merchant_gdelt_cancel'));
    const initialized=await initializeMerchantProvider('gdelt-workspaces',{directory:join(ROOT,'merchant-mcp'),connection:join(ROOT,'host-connection.json'),name:'GDELT original receiving'});
    configuration=initialized.configuration;await restartMcp();
    await step('registered-owner',{provider:registered.id,tools:registered.toolCount,projectId:projectState.id,bindingSha256:browser.startup.binding.sha256});
    let discovery=await optionalJson(join(ROOT,'selected-discovery.json'),1024*1024);
    if(!discovery){
      let names=[];try{names=(await readdir(join(project,'discoveries'))).filter(n=>/^[a-f0-9]{64}\.json$/.test(n));}catch(e){if(e.code!=='ENOENT')throw e;}
      if(names.length===1)discovery=await call('discovery',{id:names[0].slice(0,-5)});
      else{assert.equal(names.length,0);discovery=await call('discover',{history:true});}
      await save('selected-discovery.json',discovery);
    }
    const batches=discovery.availableBatches.slice(-2);assert.equal(batches.length,2);
    const captures=[];
    for(let index=0;index<batches.length;index++){
      const id='gdelt-capture-'+index,body={batch:batches[index],discoveryId:discovery.discoveryId};
      const request=await retained('requests/'+id+'.json',async()=>({workspace:'desk',id,expectedRevision:(await call('status')).project.revision,...body}));
      if(index===0&&!await optionalJson(join(ROOT,'capture-cancelled.json'))){
        const task=client.call('merchant_gdelt_capture',request).then(value=>({value}),error=>({error:{code:error.code??error.name,message:String(error.message)}}));
        const boundary=await Promise.race([gate.then(value=>({gate:value})),task]);
        if(boundary.gate){
          const interrupted=await call('cancel',{id});
          const outcome=await task;assert(outcome.error);
          const progress=await optionalJson(join(project,'acquisitions',id,'progress.json'),192*1024*1024);
          assert.equal(progress.sources.length,1);assert.equal(progress.sources[0].kind,'events');assert.equal(progress.state,'INTERRUPTED');
          await save('capture-cancelled.json',{id,request,interrupted,outcome,eventZipSha256:progress.sources[0].sha256,
            eventZipBytes:progress.sources[0].bytes,at:new Date().toISOString()});
          await step('native-cancel-retains-original-event-zip',{id,eventZipSha256:progress.sources[0].sha256,eventZipBytes:progress.sources[0].bytes});
        }else if(boundary.error)throw Object.assign(Error(boundary.error.message),{code:boundary.error.code});
      }
      const captured=await client.call('merchant_gdelt_capture',request);
      const retry=await client.call('merchant_gdelt_capture',request);assert.equal(retry.captureId,captured.captureId);assert.equal(retry.replayed,true);
      captures.push(captured.captureId);
      const original=await getGdeltCapture(project,captured.captureId);
      if(index===0){const interrupted=await optionalJson(join(ROOT,'capture-cancelled.json'));if(interrupted)assert.equal(original.sources.find(s=>s.kind==='events').sha256,interrupted.eventZipSha256);}
      await step('capture-'+index,{captureId:captured.captureId,batch:captured.batch,counts:captured.counts,
        sources:original.sources.map(s=>({kind:s.kind,url:s.url,bytes:s.bytes,sha256:s.sha256,tableBytes:s.table.bytes,tableSha256:s.table.sha256}))});
    }
    const eventPolicy=JSON.parse(await readFile(join(GD,'examples/event-policy.json'),'utf8'));
    const mentionPolicy=JSON.parse(await readFile(join(GD,'examples/mention-policy.json'),'utf8'));
    const reviewed=await mutation('review','gdelt-event-review',{captureIds:captures,policy:eventPolicy,name:'GDELT event desk — original two updates',
      note:'Original official Events and Mentions batch coverage, precise source identifiers and decimal text.'});
    const mentionReview=await mutation('review','gdelt-mention-review',{captureIds:captures,policy:mentionPolicy,name:'GDELT mention coverage',
      note:'Original EventTimeDate and DATEADDED joining; unrepresented earlier events remain visible.'});
    const rows=await call('query',{kind:'rows',input:{captureIds:captures,policy:eventPolicy,offset:0,limit:3}});
    const related=await call('query',{kind:'rows',input:{captureIds:captures,policy:mentionPolicy,offset:0,limit:3}});
    const comparison=await call('query',{kind:'compare',input:{before:captures[0],after:captures[1]}});
    await save('outputs/batch-comparison.json',comparison);
    await step('complete-source-review',{events:reviewed.rowCount,mentions:mentionReview.rowCount,coverage:mentionReview.coverage,
      firstEventId:rows.rows[0]?.GlobalEventID,firstEventDecimal:rows.rows[0]?.GoldsteinScale,mentionMatch:related.rows[0]?.event_match});
    const publication=await mutation('publish','gdelt-native-publication',{reviewId:reviewed.reviewId,profile:'native'});
    const publicationId=publication.publicationId;
    const published=await call('query',{kind:'publication',input:{publicationId}}),edition=published.edition;
    const pageSize=Math.min(500,Math.max(1,Math.ceil(edition.rowCount/3))),sourcePageSize=4;
    const rowPages=Math.max(1,Math.ceil(edition.rowCount/pageSize)),sourcePages=Math.max(1,Math.ceil(edition.sourceFileRows/sourcePageSize));
    const maxPages=rowPages+sourcePages+1;assert(maxPages<=1024);
    const totalAtomic=(BigInt(PAYMENT.amount)*BigInt(maxPages)).toString();
    const policy={schema:'stellar-spend-governor/v1',assets:[{network:PAYMENT.network,asset:PAYMENT.asset,
      max_single:PAYMENT.amount,max_total:totalAtomic,max_per_utc_day:totalAtomic,max_per_actor_utc_day:totalAtomic,max_per_service_utc_day:totalAtomic}]};
    await retained('local-fixture/policy.json',async()=>policy);
    await exactFile(fixture,'signer.mjs',Buffer.from('export async function sign({challenge,accepted}) { return {x402Version:2,resource:challenge.resource,accepted,payload:{transaction:"LOCAL_CONTROLLED_NOT_A_TRANSACTION"},extensions:challenge.extensions}; }\n'));
    const profile={operator:{python:PYTHON,actor:'gdelt-native-customer',service:'gdelt-event-desk',policy:join(fixture,'policy.json'),ledger:join(fixture,'ledger.sqlite')},
      signerModule:join(fixture,'signer.mjs'),buyerTransport:transport.buyerTransport};
    await retained('local-fixture/operator-profile.json',async()=>profile);
    await retained('approval-limit.json',async()=>({plannedRequests:maxPages,amount:PAYMENT.amount,maxTotalAtomic:totalAtomic}));
    const serving=await call('merchant',{action:'start',publicationId});assert.equal(serving.mode,'NATIVE_SELLER');
    const resource=new URL(published.plan.resource),unsigned=await fetch(serving.url+resource.pathname+'?limit='+pageSize);
    const challenge=unsigned.headers.get('payment-required');await unsigned.arrayBuffer();assert.equal(unsigned.status,402);assert(challenge);
    await save('outputs/unsigned-offer.json',{status:unsigned.status,challenge:JSON.parse(Buffer.from(challenge,'base64'))});
    const intentId='gdelt-original-first-page';
    await call('purchase',{action:'prepare',publicationId,intentId,query:'limit='+Math.min(3,pageSize)});
    const single=await call('purchase',{action:'buy',publicationId,intentId});
    const recovered=await call('purchase',{action:'recover',publicationId,intentId});assert.equal(single.sha256,recovered.sha256);
    await step('original-single-customer-recovery',{intentId,bytes:recovered.bytes,sha256:recovered.sha256,state:recovered.state});
    const acquisitions=[];
    for(const kind of ['rows','sources']){
      const id='gdelt-complete-'+kind,number=kind==='rows'?rowPages:sourcePages,limit=kind==='rows'?pageSize:sourcePageSize;
      const input={publicationId,kind,query:'limit='+limit,maxPages:number,maxRows:kind==='rows'?Math.max(1,edition.rowCount):edition.sourceFileRows,
        maxTotalAtomic:(BigInt(PAYMENT.amount)*BigInt(number)).toString()};
      await dataset('prepare',id,input);await dataset('create',id,{publicationId});
      await dataset('run',id,{publicationId});
      const accounting=await dataset('accounting',id,{publicationId});
      const inspected=await dataset('inspect',id,{publicationId});
      const delivered=await dataset('deliver',id,{publicationId});
      const again=await dataset('recover',id,{publicationId});
      assert.equal(delivered.manifest.dataset.snapshot,kind==='rows'?edition.snapshot:edition.sourceSnapshot);
      const file=await app.download('dataset',{publicationId,id,file:'dataset.csv'});
      await exactFile(outputs,kind+'.csv',file.bytes);
      await save('outputs/'+kind+'-acquisition.json',{id,accounting,inspected,delivered,again});
      acquisitions.push({id,kind,delivery:delivered.report,manifest:delivered.manifest,bytes:file.bytes.length,sha256:hash(file.bytes)});
      await step('original-complete-'+kind,{id,bytes:file.bytes.length,sha256:hash(file.bytes),snapshot:delivered.manifest.dataset.snapshot});
    }
    const sourceId='gdelt-complete-sources';
    const received=await dataset('receive',sourceId,{publicationId});
    const receivingBefore=await auditFiles(received.directory);
    const receiveAgain=await dataset('receive',sourceId,{publicationId});
    assert.equal(receiveAgain.captureManifestSha256,received.captureManifestSha256);assert.deepEqual(await auditFiles(received.directory),receivingBefore);
    const reopened=await dataset('reopen',sourceId,{publicationId});
    const sourceReview=await getGdeltReview(project,reviewed.reviewId),receivedReview=await getGdeltReview(reopened.directory,reviewed.reviewId);
    assert.equal(receivedReview.id,sourceReview.id);assert.equal(receivedReview.rowCount,sourceReview.rowCount);
    const originalWindow=await dataset('open',sourceId,{publicationId});
    const customerState=await gdeltLoopbackJson({url:originalWindow.url,path:'/api/state'});
    assert.equal(customerState.project.id,reopened.projectId);assert.equal(customerState.project.captures.length,2);
    await step('original-customer-receive-and-offline-open',{captureManifestSha256:received.captureManifestSha256,
      sourceSetId:received.sourceSetId,reviewId:received.reviewId,rows:reopened.rows,captures:reopened.captures,projectId:reopened.projectId});
    // Complete retained project transfer crosses one actual MCP-host restart.
    const selection={workspace:'desk',kind:'project'},parts=[],first=await client.call('merchant_gdelt_file_read',{...selection,limit:65536});
    assert.equal(first.offset,0);parts.push(Buffer.from(first.data,'base64'));
    const fileIdentity=first.file;let offset=first.nextOffset,chunks=1,readId;
    await restartMcp();
    while(offset!==null){
      const chunk=await client.call('merchant_gdelt_file_read',{...selection,expectedSha256:fileIdentity.sha256,offset,limit:65536,...(readId?{readId}:{})});
      readId=chunk.readId;
      assert.equal(chunk.file.sha256,fileIdentity.sha256);assert.equal(chunk.offset,offset);
      const bytes=Buffer.from(chunk.data,'base64');assert.equal(bytes.length,chunk.bytesRead);parts.push(bytes);offset=chunk.nextOffset;chunks++;
    }
    const bundleBytes=Buffer.concat(parts);assert.equal(bundleBytes.length,fileIdentity.bytes);assert.equal(hash(bundleBytes),fileIdentity.sha256);
    await exactFile(outputs,'gdelt-event-desk.json',bundleBytes);
    const bundle=JSON.parse(bundleBytes),copy=join(ROOT,'received-whole-project');
    const receivedProject=await receiveGdeltProject({directory:copy,bundle,python:PYTHON});
    const copyState=await readGdeltProject(copy);
    await reviewGdeltCapture({directory:copy,id:'receiving-customer-next-review',expectedRevision:copyState.revision,
      captureIds:captures,policy:mentionPolicy,note:'Customer local follow-on review after complete receiving.',name:'Customer mention coverage'});
    const changed=await readGdeltProject(copy);
    const receivingReplay=await receiveGdeltProject({directory:copy,bundle,python:PYTHON});
    assert.deepEqual(await readGdeltProject(copy),changed);
    await step('mcp-restart-complete-transfer-and-customer-revision',{bytes:bundleBytes.length,sha256:hash(bundleBytes),chunks,
      projectId:changed.id,originalSourceProject:projectState.id,retainedRevision:changed.revision});
    // Actual browser consumes the same operating and received customer applications.
    const require=createRequire(import.meta.url);
    let playwright;
    for(const path of [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES&&join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'),
      join(SOURCE,'node_modules/playwright')].filter(Boolean)){
      try{playwright=require(path);break;}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
    }
    if(!playwright)throw Error('Use the existing installed Playwright runtime for the same customer browser.');
    playwrightBrowser=await playwright.chromium.launch({headless:true,
      ...(process.env.GDELT_NATIVE_CHROMIUM_EXECUTABLE?{executablePath:process.env.GDELT_NATIVE_CHROMIUM_EXECUTABLE}:{}),
      args:['--disable-dev-shm-usage']});
    const page=await playwrightBrowser.newPage({viewport:{width:1440,height:1000}});
    const browserErrors=[];page.on('pageerror',e=>browserErrors.push(String(e)));
    await page.goto(browser.url,{waitUntil:'networkidle'});await page.waitForFunction(()=>document.getElementById('projectTitle').textContent.includes('GDELT'));
    for(const tab of ['sources','review','merchant','customer','history']){
      await page.locator('[data-tab="'+tab+'"]').click();
      await page.screenshot({path:join(outputs,'merchant-'+tab+'.png'),fullPage:true});
    }
    await page.goto(originalWindow.url,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>document.getElementById('projectTitle').textContent.includes('Received'));
    await page.locator('[data-tab="review"]').click();
    await page.screenshot({path:join(outputs,'customer-review-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:join(outputs,'customer-review-mobile.png'),fullPage:true});
    const width=await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth}));
    assert(width.document<=width.viewport);assert.deepEqual(browserErrors,[]);
    await playwrightBrowser.close();playwrightBrowser=null;
    await step('actual-merchant-and-received-customer-browser',{screenshots:7,desktop:1440,mobile:width,browserErrors});
    await call('merchant',{action:'stop',publicationId});
    await client.close();client=null;await mcp.close();mcp=null;
    await browser.close();browser=null;await app.close();app=null;
    const closedProject=await readGdeltProject(copy);assert.equal(closedProject.revision,changed.revision);
    const deliverables=await auditFiles(outputs);
    const result={schema,operation:OP,state:'COMPLETE',mode:MODE,startedAt:started.createdAt,completedAt:new Date().toISOString(),
      projectId:projectState.id,captures,discoveryId:discovery.discoveryId,sourceManifestSha256:discovery.manifest.sha256,
      reviewId:reviewed.reviewId,mentionReviewId:mentionReview.reviewId,publicationId,editionId:edition.editionId,
      events:reviewed.rowCount,mentions:mentionReview.rowCount,coverage:mentionReview.coverage,acquisitions,
      sourceReceiving:received,customerReopen:reopened,receivedProject:copy,
      completeTransfer:{bytes:bundleBytes.length,sha256:hash(bundleBytes),chunks},
      fixtureCalls:facilitator.counts,transport:transport.counts,deliverables};
    await save('result.json',result);
    console.log(JSON.stringify({operation:OP,state:'COMPLETE',mode:MODE,result:join(ROOT,'result.json'),events:result.events,mentions:result.mentions,deliverables:deliverables.length}));
    return result;
  }catch(error){
    operationFailure=error;
    await save('last-outcome.json',{schema,operation:OP,state:'INTERRUPTED',at:new Date().toISOString(),
      code:error.code??error.name,message:String(error.message),stack:String(error.stack).slice(0,12000)});
    throw error;
  }finally{
    const closeErrors=[];
    for(const resource of [playwrightBrowser,client,mcp,browser,app,transport,facilitator]){
      if(resource)try{await resource.close();}catch(error){closeErrors.push(error);}
    }
    if(closeErrors.length&&!operationFailure)throw closeErrors[0];
  }
 });
}
if(flags.child)await run();
else{
 const PY=String.raw`
import json,os,pty,re,select,signal,sys,time
node,script,directory=sys.argv[1:4]
pid,fd=pty.fork()
if pid==0:os.execve(node,[node,'--max-old-space-size=384',script,'--fixture-tty-child','--directory',directory,'--python',sys.executable],os.environ.copy())
transcript=bytearray();scanned=0;approvals=0;status=None
prompt=re.compile(rb'To authorize ONE fresh reservation, type exactly: (APPROVE [0-9a-f]{16})')
def stop(number,frame):raise InterruptedError('Original local protocol journey interrupted')
signal.signal(signal.SIGTERM,stop)
try:
 deadline=time.monotonic()+1800
 while time.monotonic()<deadline:
  ready,_,_=select.select([fd],[],[],0.1)
  if ready:
   try:chunk=os.read(fd,65536)
   except OSError:break
   if not chunk:break
   transcript.extend(chunk)
   if len(transcript)>2097152:raise RuntimeError('Original local transcript capacity exceeded')
   for match in prompt.finditer(transcript,scanned):
    with open(os.path.join(directory,'approval-limit.json')) as f:limit=json.load(f)['plannedRequests']
    if approvals>=limit:raise RuntimeError('Unexpected additional local reservation')
    os.write(fd,match.group(1)+b'\n');approvals+=1;scanned=match.end()
  ended,value=os.waitpid(pid,os.WNOHANG)
  if ended:status=value;break
finally:
 if status is None:
  ended,value=os.waitpid(pid,os.WNOHANG)
  if ended:status=value
  else:
   signal.signal(signal.SIGTERM,signal.SIG_IGN);signal.signal(signal.SIGINT,signal.SIG_IGN)
   try:os.killpg(pid,signal.SIGTERM)
   except ProcessLookupError:pass
   grace=time.monotonic()+15
   while status is None and time.monotonic()<grace:
    ended,value=os.waitpid(pid,os.WNOHANG)
    if ended:status=value;break
    time.sleep(0.05)
   if status is None:
    try:os.killpg(pid,signal.SIGKILL)
    except ProcessLookupError:pass
    _,status=os.waitpid(pid,0)
 os.close(fd)
 descriptor=os.open(os.path.join(directory,'local-fixture-transcript.log'),os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
 with os.fdopen(descriptor,'wb') as f:f.write(transcript);f.flush();os.fsync(f.fileno())
sys.exit(os.waitstatus_to_exitcode(status))
`;
 const child=spawn(PYTHON,['-I','-B','-c',PY,process.execPath,fileURLToPath(import.meta.url),ROOT],{stdio:['ignore','inherit','inherit'],env:process.env});
 const stop=()=>child.kill('SIGTERM');process.once('SIGTERM',stop);process.once('SIGINT',stop);
 let code;try{code=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',done);});}
 finally{process.off('SIGTERM',stop);process.off('SIGINT',stop);}
 if(code!==0){const failed=await optionalJson(join(ROOT,'last-outcome.json'));console.error(JSON.stringify({operation:OP,state:'INTERRUPTED',code,failed}));process.exitCode=1;}
 else{const result=await optionalJson(join(ROOT,'result.json'),32*1024*1024);assert.equal(result?.state,'COMPLETE');console.log(JSON.stringify({operation:OP,state:'COMPLETE',result:join(ROOT,'result.json'),events:result.events,mentions:result.mentions}));}
}
