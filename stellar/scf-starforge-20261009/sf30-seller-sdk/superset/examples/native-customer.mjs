#!/usr/bin/env node
// MIT. One installed native Superset/Redis/Celery source through the original merchant and buyer engines.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFile,open,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createConnection} from 'node:net';
import {startSupersetWorkspaceServer} from '../server.mjs';
import {openSupersetWorkspace,receiveSupersetWorkspace} from '../workspace.mjs';
import {startSupersetMerchant,readSupersetMerchant} from '../merchant.mjs';
import {reviewSupersetBuyer,inspectSupersetDelivery} from '../customer.mjs';
import {datasetControl} from '../../dataset-refresh/service.mjs';
import {createDatasetSession,inspectDatasetSession,runDatasetSession} from '../../../sf88-operator-buyer-cli/dataset-session.mjs';
import {X402BuyerClient} from '../../../sf31-buyer-client/buyer.mjs';
import {prepareBuyerResponseFile} from '../../../sf31-buyer-client/response-file.mjs';
import {executeWithEvidence} from '../../../sf82-checkout-evidence/evidence.mjs';
import {createAttemptWireRecorder} from '../../../sf88-operator-buyer-cli/attempt-wire.mjs';
import {saveExact,readJson,privateDirectory,acquireWorkspace,atomicJson,digest,identity} from '../files.mjs';

const HERE=fileURLToPath(new URL('.',import.meta.url));
const COLS=['source_row','topic','lower_meaning','lower_value','upper_meaning','upper_value'];
const ORIGINAL_SOURCE={
  before:{bytes:13138,sha256:'c884b6c56f0951b8fbc28217b00577fbc22e2372dc375686d024e507c4e8d807'},
  after:{bytes:13432,sha256:'14a61938cff58166ef265af9a324b8a6f4cf6040f8630634e5711cb5b07e2cf5'}};
async function exists(path){try{await readFile(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function portAvailable(port){
  const server=createServer();await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});
  const selected=server.address().port;await new Promise((yes,no)=>server.close(error=>error?no(error):yes()));return selected;
}
async function socketReady(port){
  return new Promise(resolve=>{
    const socket=createConnection({host:'127.0.0.1',port});let ended=false;
    const done=value=>{if(ended)return;ended=true;socket.destroy();resolve(value);};
    socket.setTimeout(500,()=>done(false));socket.once('connect',()=>done(true));socket.once('error',()=>done(false));
  });
}
export async function runSupersetNativeCustomer(options={}){
  const directory=resolve(options.directory??'');
  if(!options.directory||!options.python||!options.redis||!options.before||!options.after||
      !options.playwright||!options.chromium)throw new TypeError('Choose the retained directory, official Superset Python, Redis executable, both original Census workbooks and existing Playwright/Chromium.');
  for(const name of ['python','redis','before','after','playwright','chromium'])options[name]=resolve(options[name]);
  await privateDirectory(directory,true);const unlock=await acquireWorkspace(directory);
  const controller=new AbortController(),signal=controller.signal;
  const interrupted=()=>controller.abort(new Error('Native customer interrupted'));
  process.once('SIGTERM',interrupted);process.once('SIGINT',interrupted);
  const fixtureDirectory=join(directory,'superset'),workspaceDirectory=join(directory,'workspace'),operatorDirectory=join(directory,'operator');
  const phases=[],children=[],files=[];
  let operator,merchant,freeServer,browser,received,receivedMerchant;
  let workspace,requests=0,signatures=0;
  async function record(name,result){
    const previous=phases.find(p=>p.name===name);
    if(previous){assert.equal(identity(previous.result),identity(result),'An accepted customer phase changed: '+name);return previous;}
    const entry={name,recordedAt:new Date().toISOString(),result};phases.push(entry);
    await atomicJson(directory,'progress.json',{schema:'stellar-forge.superset-native-customer-progress.v1',phases});
    process.stdout.write(JSON.stringify({phase:name,...result})+'\n');return entry;
  }
  function saved(name){return phases.find(p=>p.name===name)?.result;}
  async function child(name,argv,{environment={},wait=false}={}){
    await privateDirectory(join(directory,'logs'),true);
    const handle=await open(join(directory,'logs',name+'.log'),'a',0o600);
    let processChild;
    try{processChild=spawn(argv[0],argv.slice(1),{cwd:fixtureDirectory,env:{...process.env,...environment},
      stdio:['ignore',handle.fd,handle.fd],detached:false});}
    finally{await handle.close();}
    const entry={name,child:processChild,closed:false,code:null,error:null};
    entry.completion=new Promise(resolve=>{
      processChild.once('error',error=>{entry.error=error;entry.closed=true;resolve(entry);});
      processChild.once('close',(code,sig)=>{entry.code=code;entry.exitSignal=sig;entry.closed=true;resolve(entry);});
    });children.push(entry);
    if(wait){await entry.completion;if(entry.error||entry.code!==0)throw Object.assign(new Error('Original native '+name+' did not complete; read its retained log.'),{code:'SUPERSET_NATIVE_PROCESS_FAILED'});}
    return entry;
  }
  async function stop(entry){
    if(!entry||entry.closed)return;
    entry.child.kill('SIGTERM');
    await Promise.race([entry.completion,delay(15000)]);
    if(!entry.closed){entry.child.kill('SIGKILL');await entry.completion;}
  }
  const cancelNative=()=>{for(const entry of [...children].reverse())void stop(entry).catch(()=>{});if(workspace?.active)workspace.cancel(workspace.active.id);};
  signal.addEventListener('abort',cancelNative,{once:true});
  async function waitFor(label,fn,processEntry,timeout=180000){
    const until=Date.now()+timeout;
    while(Date.now()<until){
      signal.throwIfAborted();
      if(processEntry?.closed)throw new Error('The original '+label+' process ended; inspect its retained log.');
      if(await fn())return;
      await delay(250,undefined,{signal});
    }
    throw new Error('The original '+label+' did not become ready within its declared native startup interval.');
  }
  async function mutate(action,phase,input={}){
    const operationId='native-'+digest(options.operationId+'\n'+phase).slice(0,48);
    let prior;try{prior=workspace.operation(operationId);}catch(error){if(error.code!=='SUPERSET_OPERATION_MISSING')throw error;}
    const selected=prior?.request.input??{...input,recordId:phase,operationId,expectedRevision:workspace.revision()};
    // The retained request supplies the original revision and exact parameters on a resume.
    if(prior)for(const [key,value]of Object.entries(input))assert.equal(identity(selected[key]),identity(value),'Retained request parameter '+key);
    const outcome=await workspace.dispatch(action,{...selected,...(prior&&prior.status!=='COMPLETED'?{retry:true}:{})});
    if(outcome.status!=='COMPLETED')throw Object.assign(new Error(outcome.error?.message??'Native workspace operation did not complete'),
      {code:outcome.error?.code??'SUPERSET_NATIVE_OPERATION_FAILED'});
    return outcome.result.record?workspace.get(outcome.result.kind,outcome.result.record.id):outcome.result;
  }
  async function captureAndEdition(cohort,source,fixture){
    const capture=await mutate('capture','capture-'+cohort,{sourceId:source.id,chartId:fixture.chartId,
      label:'Census JAM '+(cohort==='before'?'2023':'2024')+' native saved report',force:true});
    assert.equal(capture.queries.length,2);
    assert.equal(capture.queries[0].rows,16);assert.equal(capture.queries[1].rows,3);
    assert.ok(capture.entries.some(entry=>entry.status===202),'The installed native async query must return its actual queued job.');
    assert.ok(capture.entries.some(entry=>entry.url.includes('/api/v1/async_event/')),'The original session must consume native event polling.');
    const edition=await mutate('edition','edition-'+cohort,{captureId:capture.id,selection:{
      name:'Census JAM native report',queryOrdinal:0,columns:COLS,key:['source_row'],defaultLimit:4,maxLimit:100}});
    assert.equal(edition.rows,16);
    const review=await mutate('review','review-'+cohort,{editionId:edition.id,editionSha256:edition.sha256,
      decision:'approved',actor:'SCF native customer',note:'Review all six original native fields, their typed value/state columns and both retained result queries.',
      distributionBasis:'Original US Census public JAM workbook values; source_row is the original JamValues worksheet row address. Selected cells, saved values and formula metadata are retained in the private native source bundle.'});
    return {capture,edition,review};
  }
  try{
    if(!/^[A-Za-z0-9_.:-]{8,120}$/.test(options.operationId??''))throw new TypeError('Retain one operationId for the complete native customer.');
    const intent={schema:'stellar-forge.superset-native-customer-intent.v1',operationId:options.operationId,directory,
      python:options.python,redis:options.redis,playwright:options.playwright,chromium:options.chromium,
      before:options.before,after:options.after,source:ORIGINAL_SOURCE};
    await saveExact(join(directory,'customer-intent.json'),intent);
    if(await exists(join(directory,'CUSTOMER_RESULT.json')))return {...await readJson(join(directory,'CUSTOMER_RESULT.json')),replayed:true};
    if(await exists(join(directory,'progress.json')))phases.push(...(await readJson(join(directory,'progress.json'))).phases);
    for(const cohort of ['before','after']){
      const raw=await readFile(options[cohort]);assert.equal(raw.length,ORIGINAL_SOURCE[cohort].bytes);assert.equal(digest(raw),ORIGINAL_SOURCE[cohort].sha256);
    }
    await privateDirectory(fixtureDirectory,true);
    let ports;
    if(await exists(join(directory,'native-ports.json')))ports=await readJson(join(directory,'native-ports.json'));
    else{ports={};for(const [name,requested]of [['superset',options.port??0],['redis',options.redisPort??0],['merchant',0]]){
      let selected=await portAvailable(requested);while(Object.values(ports).includes(selected))selected=await portAvailable(0);ports[name]=selected;}
      await saveExact(join(directory,'native-ports.json'),ports);}
    await portAvailable(ports.redis);await portAvailable(ports.superset);await portAvailable(ports.merchant);
    const redis=await child('redis',[options.redis,'--bind','127.0.0.1','--protected-mode','yes','--port',String(ports.redis),
      '--save','','--appendonly','yes','--dir',fixtureDirectory,'--appendfilename','native-redis.aof']);
    await waitFor('Redis',()=>socketReady(ports.redis),redis,30000);
    const fixtureScript=join(HERE,'native-fixture.py'),environment={
      SUPERSET_CONFIG_PATH:join(fixtureDirectory,'superset_config.py'),SCF_SUPERSET_NATIVE_ROOT:fixtureDirectory,
      SUPERSET_HOME:fixtureDirectory,FLASK_APP:'superset'};
    await child('bootstrap',[options.python,fixtureScript,'bootstrap','--directory',fixtureDirectory,
      '--before',options.before,'--after',options.after,'--redis-port',String(ports.redis)],{environment,wait:true});
    const fixture=await readJson(join(fixtureDirectory,'fixture.json')),privateCredentials=await readJson(join(fixtureDirectory,'secrets.json'));
    assert.equal(fixture.supersetVersion,'6.1.0');assert.equal(fixture.expectedRows,16);assert.equal(fixture.queryCount,2);
    const celery=await child('celery',[options.python,'-m','celery','-A','superset.tasks.celery_app:app','worker',
      '--loglevel=WARNING','--pool=solo','--concurrency=1','--without-gossip','--without-mingle','--without-heartbeat'],{environment});
    const superset=await child('superset',[options.python,fixtureScript,'serve','--directory',fixtureDirectory,'--port',String(ports.superset)],{environment});
    const baseUrl='http://127.0.0.1:'+ports.superset+'/';
    await waitFor('Superset',async()=>{try{const result=await fetch(baseUrl+'health',{signal:AbortSignal.timeout(2000)});await result.body?.cancel();return result.status===200;}catch{return false;}},superset);
    const env={...process.env,SCF_SUPERSET_USERNAME:privateCredentials.username,SCF_SUPERSET_PASSWORD:privateCredentials.password};
    operator=await startSupersetWorkspaceServer({directory:operatorDirectory,workspaceDirectory,env});
    workspace=operator.workspace;
    const source=await mutate('source','native-source',{label:'US Census JAM — original Superset saved report',
      options:{baseUrl,auth:{mode:'login',usernameEnv:'SCF_SUPERSET_USERNAME',passwordEnv:'SCF_SUPERSET_PASSWORD',provider:'db'},
        requestTimeoutMs:60000,asyncTimeoutMs:180000,pollMs:500,maxResponseBytes:16777216,maxCaptureBytes:67108864}});
    const inventory=await workspace.inventory(source.id,{kind:'chart',page:0,pageSize:100});
    assert.ok(inventory.items.some(item=>item.id===fixture.chartId),'The original authenticated chart inventory contains the saved native report.');
    const dashboards=await workspace.inventory(source.id,{kind:'dashboard',page:0,pageSize:100});
    assert.ok(dashboards.items.some(item=>item.id===fixture.dashboardId),'The original native dashboard inventory contains its actual chart container.');
    await record('native-source-ready',{supersetVersion:fixture.supersetVersion,officialCommit:fixture.officialCommit,
      chartId:fixture.chartId,chartUuid:fixture.chartUuid,dashboardId:fixture.dashboardId,datasetId:fixture.datasetId,
      queryContextSha256:fixture.queryContextSha256,queries:2,sourceBefore:ORIGINAL_SOURCE.before,sourceAfter:ORIGINAL_SOURCE.after});
    const initial=await captureAndEdition('before',source,fixture);
    await record('native-async-before',{capture:initial.capture.sha256,edition:initial.edition.sha256,snapshot:initial.edition.snapshot,
      rows:16,limitedNativeQueryRows:3,principal:initial.capture.source.principal,queries:initial.capture.queries});
    await child('promote-source',[options.python,fixtureScript,'promote','--directory',fixtureDirectory],{environment,wait:true});
    const successor=await captureAndEdition('after',source,fixture);
    const compared=await mutate('compare','source-comparison',{beforeId:initial.edition.id,afterId:successor.edition.id});
    assert.equal(compared.counts.changed,1);assert.equal(compared.counts.unchanged,15);assert.equal(compared.counts.added,0);assert.equal(compared.counts.removed,0);
    assert.deepEqual(compared.comparison.changes[0].fields,['upper_value']);
    await record('native-refreshed-edition',{capture:successor.capture.sha256,snapshot:successor.edition.snapshot,
      comparison:compared.counts,changedFields:compared.comparison.changes[0].fields});
    const stellarSDK=options.payment?null:await import('@stellar/stellar-sdk');
    const payment=options.payment??{scheme:'exact',network:'stellar:testnet',asset:stellarSDK.Asset.native().contractId(stellarSDK.Networks.TESTNET),amount:'100',
      payTo:'GBNC56EUO6W5453H2U6RAPZJZS2UJOPFDO2SGIC73BMV3PHCBU52DVAO',maxTimeoutSeconds:60};
    const prepared=await mutate('prepare-merchant','merchant-before',{editionId:initial.edition.id,label:'Census native report 2023',
      publicOrigin:'https://superset-customer.example',path:'/census-report',payment});
    const refreshed=await mutate('prepare-merchant','merchant-after',{editionId:successor.edition.id,label:'Census native report 2024',
      targetMerchantId:prepared.id,publicOrigin:prepared.definition.publicOrigin,path:prepared.definition.path,payment});
    await workspace.materializeMerchant(prepared.id);
    merchant=await startSupersetMerchant({directory:join(workspaceDirectory,prepared.preparedRelative),
      stageDirectory:join(directory,'merchant-stage'),runtime:{port:ports.merchant}});
    const offer=await reviewSupersetBuyer({directory:join(workspaceDirectory,prepared.preparedRelative),seller:merchant.url,query:{limit:'4'}});
    const buyerRecord=await mutate('prepare-buyer','buyer-before',{merchantId:prepared.id,seller:merchant.url,query:{limit:'4'},
      intentId:'superset-'+digest(options.operationId).slice(0,32),acceptIndex:0,offerSha256:offer.offerSha256});
    const buyerRoot=join(workspaceDirectory,buyerRecord.relative),session=join(buyerRoot,'session');
    const buyerConfig=await readJson(join(buyerRoot,'buyer.json'));
    const nativeConfig={...buyerConfig,operator:{python:options.python,actor:'SCF native customer',service:'superset-native-customer',
      policy:join(buyerRoot,'free-source-policy.json'),ledger:join(buyerRoot,'free-source-ledger.sqlite')},
      signerModule:join(buyerRoot,'free-source-signer.mjs'),evidenceDir:join(buyerRoot,'evidence'),captureBody:false};
    await saveExact(join(buyerRoot,'native-buyer.json'),nativeConfig);
    if(!await exists(join(session,'session.json')))await createDatasetSession({directory:session,configPath:join(buyerRoot,'native-buyer.json'),
      maxPages:6,maxRows:1000,maxTotalAtomic:'1000',maxPageBytes:16777216,expectedSnapshot:initial.edition.snapshot});
    freeServer=createServer(merchant.versions.wrapRequest(async(req,res)=>{
      try{
        requests++;const url=new URL(req.url,'http://127.0.0.1'),context={url,query:url.searchParams};
        const admitted=await merchant.versions.admit(context,{allowSnapshot:true});
        const response=admitted===true?await merchant.versions.handle(context,{allowSnapshot:true}):admitted;
        res.writeHead(response.status,response.headers);res.end(JSON.stringify(response.body));
      }catch(error){if(!res.headersSent)res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.code??'NATIVE_DATASET_FAILED'}));}
    }));
    freeServer.listen(0,'127.0.0.1');await once(freeServer,'listening');
    const local='http://127.0.0.1:'+freeServer.address().port;
    async function executePage(cfg,{signal}={}){
      const transport=async(url,options)=>{
        const selected=new URL(url),response=await fetch(local+selected.pathname+selected.search,options);
        return new Response(response.body,{status:response.status,statusText:response.statusText,headers:response.headers});
      };
      const wire=await createAttemptWireRecorder({cfg,body:undefined,fetchImpl:transport,signal});
      const nativeBuyer=new X402BuyerClient({fetchImpl:wire.fetch});
      const responseWriter=await prepareBuyerResponseFile(cfg.responseFile);let responseFile,evidence;
      const nativeExecutor={async call(options){
        const result=await nativeBuyer.call({...options,approve:async()=>{throw new Error('The original free response has no payment approval.');},
          sign:async()=>{signatures++;throw new Error('The original free response has no signing operation.');}});
        responseFile=await responseWriter.save(result,{signal});return result;
      }};
      try{evidence=await executeWithEvidence({buyer:nativeExecutor,call:{...cfg.operation,signal},outputDir:cfg.evidenceDir,captureBody:false});}
      finally{try{await responseWriter.abort();}finally{await wire.close();}}
      assert.equal(evidence.error,null);
      return{mode:'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT',intentId:cfg.operation.intentId,status:evidence.result.status,
        httpStatus:evidence.result.httpStatus,sellerReportedSettlement:evidence.result.settlement,evidencePath:evidence.evidencePath,
        originalOutcomeReport:evidence.report,operatorReservation:null,responseFile:{status:'SAVED',...responseFile},
        interrupted:false,retry:'NO_AUTOMATIC_RETRY'};
    }
    let acquired=await inspectDatasetSession(session);
    if(!acquired.completedPages){
      const prefixAbort=new AbortController();
      await runDatasetSession(session,{executePage,signal:AbortSignal.any([signal,prefixAbort.signal]),emitPageSummaries:false,
        onPage:page=>{if(page.completedPages>=1)prefixAbort.abort();}});
      acquired=await inspectDatasetSession(session);
    }
    const firstPage=await readFile(acquired.pages[0].responsePath),firstPageSha256=digest(firstPage);
    const publicationRecordId='publish-after';
    let publication;
    try{publication=workspace.get('publications',publicationRecordId);}catch(error){if(error.code!=='SUPERSET_RECORD_MISSING')throw error;}
    if(!publication){
      let activation;
      const activationFile=join(directory,'publication-intent.json');
      if(await exists(activationFile))activation=await readJson(activationFile);
      else{
        const status=await datasetControl(join(workspaceDirectory,'versions',prepared.versionGroup),'status');
        activation={schema:'stellar-forge.superset-native-publication-intent.v1',before:initial.edition.snapshot,after:successor.edition.snapshot,
          expectedSnapshot:status.current,expectedNativeRevision:status.revision};
        assert.equal(status.current,initial.edition.snapshot);await saveExact(activationFile,activation);
      }
      publication=await mutate('publish',publicationRecordId,{merchantId:refreshed.id,
        expectedSnapshot:activation.expectedSnapshot,expectedNativeRevision:activation.expectedNativeRevision});
    }
    const current=await datasetControl(join(workspaceDirectory,'versions',prepared.versionGroup),'status');
    assert.equal(current.current,successor.edition.snapshot);
    acquired=await runDatasetSession(session,{executePage,emitPageSummaries:false,signal});
    assert.equal(acquired.status,'COMPLETE');assert.equal(acquired.acquiredRows,16);assert.equal(acquired.completedPages,4);
    assert.equal(acquired.snapshot,initial.edition.snapshot);assert.equal(digest(await readFile(acquired.pages[0].responsePath)),firstPageSha256);
    assert.deepEqual([...new Set(acquired.pages.map(page=>page.nativeBuyerStatus))],['NO_PAYMENT_REQUIRED']);
    assert.equal(signatures,0);
    const delivered=await mutate('receive-buyer','original-delivery',{buyerId:buyerRecord.id,includeSourceCaptures:true});
    const delivery=await workspace.materializeDelivery(delivered.id);
    await record('original-buyer-through-published-refresh',{sessionId:acquired.sessionId,configurationSha256:acquired.configurationSha256,
      snapshot:acquired.snapshot,currentSnapshot:current.current,nativeRevision:current.revision,pages:4,rows:16,
      firstPageSha256,deliverySha256:delivered.deliverySha256,paymentStatus:'NO_PAYMENT_REQUIRED',signatureCount:signatures});
    await new Promise((yes,no)=>freeServer.close(error=>error?no(error):yes()));freeServer=null;
    await merchant.close();merchant=null;
    // The actual installed browser reads retained native state and exercises the operator's own controls.
    const archive=join(directory,'received-project.sqlite3');
    let browserExport=saved('browser-export');
    if(!browserExport){
    const require=createRequire(import.meta.url),playwright=require(options.playwright);
    browser=await playwright.chromium.launch({executablePath:options.chromium,headless:true,
      args:['--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(operator.sessionUrl,{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'Captured queries',exact:true}).click();
    await page.getByLabel('Retained capture',{exact:true}).selectOption(initial.capture.id);
    await page.getByLabel('Native result query',{exact:true}).selectOption('1');
    await page.waitForFunction(()=>document.querySelector('.table-scroll.data tbody')?.children.length===3);
    await page.getByLabel('Native result query',{exact:true}).selectOption('0');
    await page.waitForFunction(()=>document.querySelector('.table-scroll.data tbody')?.children.length===16);
    await page.getByRole('button',{name:'Editions & review',exact:true}).click();
    await page.getByRole('button',{name:'Open original dataset page',exact:true}).click();
    await page.getByRole('button',{name:'Replay original source',exact:true}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll('main button')].some(button=>button.textContent==='Replay original source'&&!button.disabled));
    await page.getByRole('button',{name:'Comparison',exact:true}).click();
    await page.getByLabel('Retained comparison',{exact:true}).selectOption(compared.id);
    await page.getByRole('button',{name:'Open comparison',exact:true}).click();
    await page.getByText('upper_value',{exact:true}).first().waitFor();
    const desktop=join(directory,'superset-native-desktop.png');
    await page.screenshot({path:desktop,fullPage:true});files.push(desktop);
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const mobileLayout=await page.evaluate(()=>{
      const table=[...document.querySelectorAll('table')].find(table=>table.textContent.includes('upper_value'));
      return{viewport:innerWidth,document:document.documentElement.scrollWidth,table:table?.getBoundingClientRect().width??null,
        container:table?.parentElement.getBoundingClientRect().width??null};
    });
    assert.ok(mobileLayout.document<=mobileLayout.viewport+1,'The operator viewport remains usable at 390 pixels.');
    assert.ok(mobileLayout.table>mobileLayout.container,'The comparison keeps readable columns in its native horizontal scroller.');
    const mobile=join(directory,'superset-native-mobile.png');await page.screenshot({path:mobile,fullPage:true});files.push(mobile);
    await page.getByRole('button',{name:'Buyer & receiving',exact:true}).click();
    await page.getByLabel('Prepared buyer',{exact:true}).selectOption(buyerRecord.id);
    await page.getByRole('button',{name:'Read original acquisition status',exact:true}).click();
    await page.getByText('COMPLETE',{exact:false}).first().waitFor();
    await page.getByLabel('Retained delivery',{exact:true}).selectOption(delivered.id);
    await page.getByRole('button',{name:'Verify and reopen delivery',exact:true}).click();
    await page.getByText(delivered.deliverySha256,{exact:false}).first().waitFor();
    const downloaded=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download complete workspace',exact:true}).first().click();
    const download=await downloaded;
    await download.saveAs(archive);
    assert.equal(await download.failure(),null);assert.deepEqual(errors,[]);
    await browser.close();browser=null;
    const archiveRaw=await readFile(archive);
    browserExport={desktop:desktop.split('/').pop(),mobile:mobile.split('/').pop(),mobileLayout,javascriptErrors:errors,
      archive:{bytes:archiveRaw.length,sha256:digest(archiveRaw)},screenshots:await Promise.all(files.map(async file=>({name:file.split('/').pop(),sha256:digest(await readFile(file))})))};
    await record('browser-export',browserExport);
    }else{
      const archiveRaw=await readFile(archive);assert.equal(archiveRaw.length,browserExport.archive.bytes);assert.equal(digest(archiveRaw),browserExport.archive.sha256);
      for(const file of browserExport.screenshots)assert.equal(digest(await readFile(join(directory,file.name))),file.sha256);
    }
    await operator.close();operator=null;workspace=null;
    // Drain the original external service and worker before the offline receiving exercise.
    await stop(superset);await stop(celery);await stop(redis);
    const receivingDirectory=join(directory,'received-workspace');
    const receivedResult=await receiveSupersetWorkspace({file:archive,directory:receivingDirectory});
    received=await openSupersetWorkspace({directory:receivingDirectory,env:{},fetchImpl:async()=>{throw new Error('Offline receiving attempted a network read');}});
    const movedBuyer=received.get('buyers',buyerRecord.id);
    const movedSession=await inspectDatasetSession(join(receivingDirectory,movedBuyer.relative,'session'));
    assert.equal(movedSession.status,'COMPLETE');assert.equal(movedSession.sessionId,acquired.sessionId);
    assert.equal(movedSession.configurationSha256,acquired.configurationSha256);
    assert.equal(movedSession.snapshot,acquired.snapshot);assert.equal(movedSession.acquiredRows,16);assert.equal(movedSession.completedPages,4);
    assert.equal(digest(await readFile(movedSession.pages[0].responsePath)),firstPageSha256);
    await received.materializeDelivery(delivered.id);
    await received.materializeMerchant(prepared.id);
    receivedMerchant=await startSupersetMerchant({directory:join(receivingDirectory,prepared.preparedRelative),
      stageDirectory:join(directory,'received-stage'),runtime:{port:0}});
    const receivedState=await datasetControl(join(receivingDirectory,'versions',prepared.versionGroup),'status');
    assert.ok(receivedState.versions.some(version=>version.snapshot===initial.edition.snapshot));
    const transferVersionDirectory=join(receivingDirectory,'versions',prepared.versionGroup);
    const expectedTransferred={snapshot:current.current,revision:current.revision};
    async function retainedActivation(phase,before,snapshot){
      const file=join(directory,phase+'-intent.json'),intent={schema:'stellar-forge.superset-native-activation-intent.v1',
        versionDirectory:transferVersionDirectory,expectedSnapshot:before.snapshot,expectedRevision:before.revision,snapshot};
      await saveExact(file,intent);
      const state=await datasetControl(transferVersionDirectory,'status');
      if(state.current===snapshot&&state.revision===before.revision+1){await record(phase,{current:state.current,revision:state.revision});return state;}
      const done=saved(phase);
      if(done){assert.equal(done.current,snapshot);assert.equal(done.revision,before.revision+1);return done;}
      assert.equal(state.current,before.snapshot);assert.equal(state.revision,before.revision);
      const result=await datasetControl(transferVersionDirectory,'activate',{snapshot,
        expectedSnapshot:before.snapshot,expectedRevision:before.revision});
      assert.equal(result.current,snapshot);assert.equal(result.revision,before.revision+1);
      await record(phase,{current:result.current,revision:result.revision});return result;
    }
    const priorBack=saved('received-activate-before'),priorForward=saved('received-activate-after');
    if(!priorBack&&!priorForward&&!await exists(join(directory,'received-activate-before-intent.json'))){assert.equal(receivedState.current,current.current);assert.equal(receivedState.revision,current.revision);}
    const reverted=await retainedActivation('received-activate-before',expectedTransferred,initial.edition.snapshot);
    const advanced=await retainedActivation('received-activate-after',{snapshot:reverted.current,revision:reverted.revision},successor.edition.snapshot);
    await receivedMerchant.close();receivedMerchant=null;await received.close();received=null;
    await receiveSupersetWorkspace({file:archive,directory:receivingDirectory});
    received=await openSupersetWorkspace({directory:receivingDirectory,env:{},fetchImpl:async()=>{throw new Error('Offline repeat attempted a network read');}});
    const finalState=JSON.parse(await readFile(join(receivingDirectory,'versions',prepared.versionGroup,'state.json'),'utf8'));
    assert.equal(finalState.current,advanced.current);assert.equal(finalState.revision,advanced.revision);
    assert.ok(finalState.revision>current.revision,'Receiving the same project again preserves later native version activity.');
    const finalSession=await inspectDatasetSession(join(receivingDirectory,movedBuyer.relative,'session'));
    assert.equal(finalSession.status,'COMPLETE');assert.equal(finalSession.configurationSha256,acquired.configurationSha256);
    await received.close();received=null;
    await record('browser-and-offline-receiving',{desktop:browserExport.desktop,mobile:browserExport.mobile,mobileLayout:browserExport.mobileLayout,
      javascriptErrors:browserExport.javascriptErrors,archive:browserExport.archive,
      receivedWorkspaceId:receivedResult.workspaceId??receivedResult.state?.workspaceId??null,sessionId:movedSession.sessionId,
      originalNativeRevision:current.revision,advancedNativeRevision:advanced.revision,repeatedReceivePreservedCurrent:true,
      rows:16,pages:4,sourceServiceStopped:true});
    const result={schema:'stellar-forge.superset-native-customer-result.v1',status:'PASS',operationId:options.operationId,
      completedAt:new Date().toISOString(),source:ORIGINAL_SOURCE,superset:{version:fixture.supersetVersion,officialCommit:fixture.officialCommit,
        chartId:fixture.chartId,chartUuid:fixture.chartUuid,queryContextSha256:fixture.queryContextSha256},
      phases,screenshots:browserExport.screenshots,
      archive:'received-project.sqlite3',delivery:join(workspaceDirectory,delivered.relative),
      receivedDirectory:receivingDirectory,nativeProcessResults:children.map(entry=>({name:entry.name,code:entry.code,signal:entry.exitSignal??null}))};
    await saveExact(join(directory,'CUSTOMER_RESULT.json'),result);return result;
  }finally{
    const issues=[];
    for(const close of [
      ()=>browser?.close(),()=>receivedMerchant?.close(),()=>received?.close(),
      ()=>freeServer?new Promise((yes,no)=>freeServer.close(error=>error?no(error):yes())):undefined,
      ()=>merchant?.close(),()=>operator?.close()]){
      try{await close();}catch(error){issues.push(error);}
    }
    for(const entry of [...children].reverse())try{await stop(entry);}catch(error){issues.push(error);}
    process.off('SIGTERM',interrupted);process.off('SIGINT',interrupted);signal.removeEventListener('abort',cancelNative);
    try{await unlock();}finally{if(issues.length)throw issues[0];}
  }
}
export async function main(args=process.argv.slice(2)){
  const options={},mapping={'--directory':'directory','--operation-id':'operationId','--python':'python','--redis':'redis',
    '--before':'before','--after':'after','--playwright':'playwright','--chromium':'chromium','--port':'port','--redis-port':'redisPort'};
  for(let index=0;index<args.length;index+=2){
    const key=mapping[args[index]],value=args[index+1];
    if(!key||!value||Object.hasOwn(options,key))throw new TypeError('Use each documented native customer option once.');
    options[key]=key==='port'||key==='redisPort'?Number(value):value;
  }
  const result=await runSupersetNativeCustomer(options);
  process.stdout.write(JSON.stringify({status:result.status,operationId:result.operationId,result:join(resolve(options.directory),'CUSTOMER_RESULT.json')})+'\n');
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write((error.code??'SUPERSET_NATIVE_CUSTOMER_FAILED')+': '+error.message+'\n');process.exitCode=1;});
