// MIT. One original native WordPress -> merchant -> complete source receiving journey.
// Select installed runtimes and the original testnet buyer workspace by local reference.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, lstat, rename, open, unlink } from 'node:fs/promises';
import { writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE=dirname(fileURLToPath(import.meta.url)),NODE=process.execPath;
const argument=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
assert(argument('--config'),'Select the retained --config file.');
const configPath=resolve(argument('--config')),configBytes=await readFile(configPath),config=JSON.parse(configBytes);
assert.equal(config.schema,'stellar-forge.wordpress-native-journey.v1');
for(const name of ['sourceRoot','nativeHelper','workDirectory','resultDirectory','python','chromium','playwrightModule','buyerWorkspace'])
  assert(typeof config[name]==='string'&&config[name].startsWith('/'),name+' is an original absolute runtime/source reference.');
assert.equal(config.merchant.payment.network,'stellar:testnet','Use the selected original testnet merchant.');
assert.match(config.sourceRef,/^[a-f0-9]{40}$/);
const SOURCE=join(config.sourceRoot,'stellar/scf-starforge-20261009/sf30-seller-sdk/wordpress');
const WORK=resolve(config.workDirectory),OUTPUT=resolve(config.resultDirectory),SITE=join(WORK,'wordpress');
const DIRECTORY=join(WORK,'source-workspace'),RECEIVED=join(WORK,'received-packet'),PURCHASED=join(WORK,'received-purchase');
const sha=b=>createHash('sha256').update(b).digest('hex');
const gitBlob=b=>createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex');
const json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const exists=async p=>{try{return await lstat(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
async function atomic(path,value){
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 const tmp=path+'.pending-'+randomUUID(),file=await open(tmp,'wx',0o600);
 try{await file.writeFile(json(value));await file.sync();await file.close();await rename(tmp,path);}
 catch(error){await file.close().catch(()=>{});await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});throw error;}
 const dir=await open(dirname(path),'r');try{await dir.sync();}finally{await dir.close();}
}
async function readJson(path){return JSON.parse(await readFile(path,'utf8'));}
async function freePort(){const s=createServer();await new Promise((ok,bad)=>{s.once('error',bad);s.listen(0,'127.0.0.1',ok);});const p=s.address().port;await new Promise((ok,bad)=>s.close(e=>e?bad(e):ok()));return p;}
async function child(command,args,{env=process.env,timeout=180000,input=null,outputLimit=16777216}={}){
 return await new Promise((ok,bad)=>{
  const p=spawn(command,args,{env,stdio:['pipe','pipe','pipe']});let out='',err='',size=0,killed=false;
  const timer=setTimeout(()=>{killed=true;p.kill('SIGTERM');},timeout);
  p.stdout.on('data',b=>{size+=b.length;if(size>outputLimit){p.kill('SIGTERM');return;}out+=b.toString();});
  p.stderr.on('data',b=>{if(err.length<32768)err+=b.toString();});
  p.once('error',e=>{clearTimeout(timer);bad(e);});p.once('exit',(code,signal)=>{clearTimeout(timer);ok({code,signal,out,err,killed});});
  p.stdin.end(input);
 });
}
const {openWordPressWorkspace}=await import(pathToFileURL(join(SOURCE,'workspace.mjs')));
const {start:startOperator}=await import(pathToFileURL(join(SOURCE,'server.mjs')));
const {identity}=await import(pathToFileURL(join(SOURCE,'config.mjs')));
const {packet}=await import(pathToFileURL(join(SOURCE,'packet.mjs')));
if(argument('--capture-child')){
 const request=await readJson(argument('--capture-child'));
 const work=await openWordPressWorkspace({directory:DIRECTORY,python:config.python,onEvent:e=>{
  if(e.event==='wordpress.response.retained'){
   writeFileSync(join(WORK,'capture-interruption.json'),json(e),{mode:0o600});
   const fd=openSync(join(WORK,'capture-interruption.json'),'r');fsyncSync(fd);closeSync(fd);
   process.exit(73);
  }
 }});
 try{
  const started=await work.act('capture.start',request);
  await work.wait(started.result.sourceId,started.result.jobId);
  throw Error('The retained-response interruption was not reached.');
 }finally{await work.close();}
}else{
 await mkdir(WORK,{recursive:true,mode:0o700});await mkdir(OUTPUT,{recursive:true,mode:0o700});
 const checkpointPath=join(WORK,'journey-checkpoint.json');
 const checkpoint=await exists(checkpointPath)?await readJson(checkpointPath):{schema:'stellar-forge.wordpress-native-checkpoint.v1',operationId:config.operationId,sourceRef:config.sourceRef,ids:{},phases:[]};
 assert.equal(checkpoint.operationId,config.operationId);assert.equal(checkpoint.sourceRef,config.sourceRef);
 const resultPath=join(OUTPUT,'NATIVE_ACCEPTANCE.json');
 const result=await exists(resultPath)?await readJson(resultPath):{schema:'stellar-forge.wordpress-native-acceptance.v1',operationId:config.operationId,sourceRef:config.sourceRef,startedAt:new Date().toISOString(),passed:false,phases:[]};
 assert(!result.passed,'This original journey already completed; reuse its retained result.');
 assert.equal(result.operationId,config.operationId);assert.equal(result.sourceRef,config.sourceRef);
 const configSha256=sha(configBytes);
 if(checkpoint.configSha256)assert.equal(checkpoint.configSha256,configSha256,'The selected native invocation changed.');
 checkpoint.configSha256=configSha256;
 if(result.error){
  const previous=await readFile(resultPath),history=join(OUTPUT,'history','acceptance-'+sha(previous)+'.json');
  if(!await exists(history)){await mkdir(dirname(history),{recursive:true,mode:0o700});await writeFile(history,previous,{mode:0o600,flag:'wx'});}
  result.previousResults??=[];if(!result.previousResults.some(row=>row.sha256===sha(previous)))result.previousResults.push({path:history,sha256:sha(previous)});
  delete result.error;
 }
 checkpoint.invocations=(checkpoint.invocations??0)+1;
 const owned=new Set();let wp,operator,browser,workspace,managedChild;
 const hasPhase=name=>result.phases.some(row=>row.name===name);
 const phase=async(name,value)=>{
  if(hasPhase(name))return;
  const record={name,at:new Date().toISOString(),...value};result.phases.push(record);
  if(!checkpoint.phases.includes(name))checkpoint.phases.push(name);
  await atomic(checkpointPath,checkpoint);await atomic(resultPath,result);console.log(JSON.stringify({phase:name,...value}));
 };
 const saveCheckpoint=()=>atomic(checkpointPath,checkpoint);
 async function id(name){if(!checkpoint.ids[name]){checkpoint.ids[name]=randomUUID();await saveCheckpoint();}return checkpoint.ids[name];}
 async function act(name,action,input={}){
  const operationId=await id(name),state=await workspace.inspect();
  return await workspace.act(action,{operationId,expectedRevision:state.revision,input});
 }
 async function waitJob(started){
  const value=await workspace.wait(started.result.sourceId,started.result.jobId);
  assert.equal(value.status,'complete',JSON.stringify(value.error||value.findings||value.status));return value;
 }
 async function php(mode,extra={}){
  const seed=(await readFile(join(HERE,'seed.php'),'utf8')).replace(/^<\?php\s*/,'');
  const code="<?php require '/wordpress/wp-load.php';$mode="+JSON.stringify(mode)+";$needCredentials="+(extra.needCredentials?'true':'false')+';'+seed;
  const answer=await wp.playground.run({code});
  assert.equal(answer.exitCode,0,answer.errors||'The actual native WordPress action failed.');
  assert.equal(answer.errors,'');return JSON.parse(answer.text);
 }
 async function closeWorkspace(){if(operator){await operator.close();operator=null;workspace=null;}else if(workspace){await workspace.close();workspace=null;}}
 async function openWorkspace(){workspace=await openWordPressWorkspace({directory:DIRECTORY,python:config.python});return workspace;}
 async function openOperator(){await closeWorkspace();operator=await startOperator({directory:DIRECTORY,port:0,python:config.python});workspace=operator.workspace;return operator;}
 async function capture(name,sourceId,discoveryId,selection){
  const started=await act(name,'capture.start',{sourceId,discoveryId,selection});
  const job=await workspace.job(sourceId,started.result.jobId);
  if(job.status!=='complete'&&!job.active)await act(name+'-resume','capture.resume',{sourceId,captureId:job.id});
  return await waitJob(started);
 }
 async function edition(name,sourceId,captureId,projection){
  const job=await workspace.job(sourceId,captureId);
  const mapped=await act(name+'-mapping','mapping.save',{sourceId,captureId,expectedCaptureSha256:job.complete.sha256,projection});
  const result=await act(name+'-edition','edition.build',{mappingId:mapped.result.id,
   dataset:{name:'Native WordPress source editions',filters:['key','collection'],ranges:[],sorts:['key'],defaultLimit:10,maxLimit:100},
   review:{reviewer:'83DD native operator',decision:'approve',note:'Exact native WordPress capture and original projection.',
    expectedCaptureSha256:job.complete.sha256,projectionHash:identity(projection)}});
  return {mapping:mapped.result,edition:result.result};
 }
 async function ensureRelease(name,productId,exportId){
  const prepared=await act(name+'-prepare','publisher.prepare',{productId,exportDirectory:join(DIRECTORY,'exports',exportId)});
  const releaseId='wordpress-native-'+name;
  checkpoint.releasePorts??={};
  checkpoint.releasePorts[name]??=config.sellerRuntime?.port||await freePort();await saveCheckpoint();
  await act(name+'-stage','publisher.release.stage',{productId,draftId:prepared.result.draft.id,id:releaseId,label:'Native WordPress '+name,
   runtime:{...config.sellerRuntime,port:checkpoint.releasePorts[name]}});
  let current=await workspace.inspect();
  if(current.publisher.releases.state.active!==releaseId){
   await act(name+'-activate','publisher.release.activate',{productId,id:releaseId,expectedGeneration:current.publisher.releases.state.generation});
  }
  current=await workspace.inspect();
  if(!current.publisher.ownsRelease)await act(name+'-start-'+current.publisher.releases.state.generation+'-'+result.phases.length,'publisher.release.start',
   {productId,expectedGeneration:current.publisher.releases.state.generation});
  current=await workspace.inspect();
  assert.equal(current.publisher.releases.runtime.state,'RUNNING');
  return {...prepared.result,releaseId,observed:current.publisher};
 }
 async function purchase(name,productId,snapshot,query,maxRows,maxPages){
  const reviewed=await act(name+'-buyer-review','publisher.buyer.review',{productId,snapshot,query});
  const prepared=await act(name+'-buyer-prepare','publisher.buyer.prepare',{productId,review:reviewed.result,
   intentId:await id(name+'-buyer-intent'),acceptIndex:0,offerSha256:reviewed.result.offerSha256});
  const buyerId=prepared.result.buyer.id??prepared.result.buyer.record?.id;assert.match(buyerId,/^[a-f0-9-]{36}$/);
  const budget=(BigInt(config.merchant.payment.amount)*BigInt(maxPages)).toString();
  await act(name+'-buyer-session','publisher.buyer.session',{productId,buyerId,workspaceDirectory:config.buyerWorkspace,
   maxPages,maxTotalAtomic:budget,maxRows,maxPageBytes:1048576});
  const observed=(await workspace.inspect()).publisher.sessions.find(row=>row.id===buyerId)?.report;
  assert(observed, 'The original saved buyer session is missing.');
  // Only the original READY state may advance previously unattempted pages.
  // Its durable page markers and operator approval stay inside SF88.
  let run;
  if(observed.status==='COMPLETE')run={result:observed,recovered:true};
  else{
   assert.equal(observed.status,'READY',JSON.stringify({buyerId,status:observed.status,next:observed.next,stoppedPage:observed.stoppedPage}));
   run=await act(name+'-buyer-run-'+observed.completedPages+'-'+checkpoint.invocations,'publisher.buyer.run',{productId,id:buyerId});
  }
  assert.equal(run.result.status,'COMPLETE',JSON.stringify({buyerId,status:run.result.status,next:run.result.next,stoppedPage:run.result.stoppedPage}));
  const accounted=await act(name+'-buyer-account','publisher.buyer.account',{productId,id:buyerId});
  const exported=await act(name+'-buyer-export','publisher.buyer.export',{productId,id:buyerId});
  assert.equal(exported.result.report.status,'COMPLETE');
  return {buyerId,review:reviewed.result,run:run.result,accounted:accounted.result,delivery:exported.result,
   acquisition:join(DIRECTORY,'publishers',productId,'sessions',buyerId,'acquisition')};
 }
 async function launchBrowser(){
  if(browser)return;
  const {chromium}=await import(pathToFileURL(config.playwrightModule));
  browser=await chromium.launch({executablePath:config.chromium,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 }
 async function saveSourceInBrowser(declaration){
  await openOperator();await launchBrowser();
  const page=await browser.newPage({viewport:{width:1440,height:1040}});
  const response=await page.goto(operator.url,{waitUntil:'networkidle'});assert.equal(response.status(),200);
  await page.locator('#source-label').fill(declaration.label);
  await page.locator('#source-root').fill(declaration.apiRoot);
  await page.locator('#source-context').selectOption(declaration.context);
  await page.locator('#source-auth').selectOption('application-password');
  await page.locator('#source-user-env').fill(declaration.authentication.usernameEnv);
  await page.locator('#source-password-env').fill(declaration.authentication.passwordEnv);
  await page.locator('#source-per-page').fill(String(declaration.perPage));
  await page.locator('#source-timeout').fill(String(declaration.timeoutMs));
  await page.locator('#source-response-bytes').fill(String(declaration.maxResponseBytes));
  await page.locator('#source-loopback').check();
  const savedResponse=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/act');
  await page.locator('#source-form button[type="submit"]').click();
  const saved=await savedResponse,body=await saved.json();assert.equal(saved.status(),200,JSON.stringify(body.error));
  assert.equal(body.operation.action,'source.save');assert.equal(body.operation.status,'complete');
  await page.screenshot({path:join(OUTPUT,'wordpress-native-source.png'),fullPage:true});
  await page.close();await browser.close();browser=null;await closeWorkspace();await openWorkspace();
  return body;
 }
 async function browserReview(){
  await openOperator();await launchBrowser();
  const page=await browser.newPage({viewport:{width:1440,height:1040}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const response=await page.goto(operator.url,{waitUntil:'networkidle'});assert.equal(response.status(),200);
  await page.waitForSelector('#source-select option[value="'+checkpoint.sourceId+'"]');
  for(const asset of ['/app.mjs','/style.css','/publisher.mjs']){const r=await fetch(operator.url+asset);assert.equal(r.status,200);assert((await r.arrayBuffer()).byteLength>100);}
  await page.locator('[data-section="captures"]').click();
  await page.locator('#job-select').selectOption(checkpoint.captureId);
  await page.locator('#job-open').click();
  await page.locator('#records-load').click();
  await page.waitForFunction(()=>document.querySelector('#records-table tbody')?.textContent.includes('Native source article'));
  await page.locator('[data-section="editions"]').click();
  await page.locator('#edition-select').selectOption(checkpoint.edition2);await page.locator('#edition-open').click();
  await page.locator('#dataset-query').fill('limit=2&fields=key,native_integer');
  await page.locator('#dataset-preview-form button[type="submit"]').click();
  await page.locator('#compare-before').selectOption(checkpoint.edition1);await page.locator('#compare-after').selectOption(checkpoint.edition2);
  await page.locator('#compare-form button[type="submit"]').click();
  const downloadPromise=page.waitForEvent('download');await page.locator('#edition-csv').click();const download=await downloadPromise;
  const exported=join(OUTPUT,'native-edition.csv');await download.saveAs(exported);
  assert.equal(sha(await readFile(exported)),sha(await readFile(join(DIRECTORY,'editions',checkpoint.edition2,'dataset.csv'))));
  await page.screenshot({path:join(OUTPUT,'wordpress-native-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-section="source"]').click();await page.screenshot({path:join(OUTPUT,'wordpress-native-mobile.png'),fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),'Native mobile layout overflows.');
  assert.deepEqual(errors,[]);await page.close();
  await phase('native-browser-source-editions-and-download',{desktop:'wordpress-native-desktop.png',mobile:'wordpress-native-mobile.png',downloadSha256:sha(await readFile(exported)),pageErrors:errors});
 }
 try{
  result.sourceFiles={};
  for(const [name,expected] of Object.entries(config.sourceFiles)){
   const bytes=await readFile(join(SOURCE,name));assert.equal(gitBlob(bytes),expected,'Published source differs: '+name);
   result.sourceFiles[name]={gitBlob:expected,bytes:bytes.length,sha256:sha(bytes)};
  }
  result.runner={sha256:sha(await readFile(fileURLToPath(import.meta.url))),seedSha256:sha(await readFile(join(HERE,'seed.php'))),pluginSha256:sha(await readFile(join(HERE,'mu-plugin.php')))};
  const {startNativePhp}=await import(pathToFileURL(config.nativeHelper));
  for(const [key,value] of Object.entries(config.nativeEnvironment||{})){assert(typeof value==='string');process.env[key]=value;}
  checkpoint.wordpressPort??=await freePort();await saveCheckpoint();
  const installed=checkpoint.nativeInstalled===true;await mkdir(SITE,{recursive:true,mode:0o700});
  wp=await startNativePhp({wordpress:SITE,port:checkpoint.wordpressPort,wordpressVersion:'6.8.3',phpVersion:'8.3',
   initial:!installed,resumeInitialization:!installed,coreStorage:'shared',onAcquired:handle=>owned.add(handle)});
  owned.add(wp);checkpoint.nativeInstalled=true;await saveCheckpoint();
  await mkdir(join(SITE,'wp-content/mu-plugins'),{recursive:true,mode:0o700});
  const plugin=await readFile(join(HERE,'mu-plugin.php'));const pluginPath=join(SITE,'wp-content/mu-plugins/sf-native-source.php');
  if(await exists(pluginPath))assert.equal(sha(await readFile(pluginPath)),sha(plugin));else await writeFile(pluginPath,plugin,{mode:0o600,flag:'wx'});
  const credentialPath=join(WORK,'native-wordpress-credentials.json');
  const seeded=await php('prepare',{needCredentials:!await exists(credentialPath)});
  if(seeded.credentials)await atomic(credentialPath,seeded.credentials);
  const credentials=await readJson(credentialPath);process.env.SF_WORDPRESS_NATIVE_USERNAME=credentials.username;process.env.SF_WORDPRESS_NATIVE_PASSWORD=credentials.password;
  checkpoint.seed=seeded.seed;await saveCheckpoint();
  assert.equal(seeded.wordpress,'6.8.3');assert.equal(seeded.integer,'9223372036854775807');
  await phase('actual-wordpress-source-installation',{wordpress:seeded.wordpress,php:seeded.php,apiRoot:new URL(wp.serverUrl).origin+'/index.php?rest_route=/',nativeIds:seeded.seed,coreStorage:wp.nativeMetadata.coreStorage});
  await openWorkspace();
  const declaration={schema:'stellar-forge.wordpress-source.v1',label:'Native WordPress source',apiRoot:new URL(wp.serverUrl).origin+'/index.php?rest_route=/',
   context:'edit',authentication:{mode:'application-password',usernameEnv:'SF_WORDPRESS_NATIVE_USERNAME',passwordEnv:'SF_WORDPRESS_NATIVE_PASSWORD'},
   perPage:2,timeoutMs:30000,maxResponseBytes:8388608,allowLoopback:true};
  const existingSource=(await workspace.inspect()).sources.find(row=>row.sourceSha256===identity(declaration));
  const saved=existingSource?{result:existingSource}:await saveSourceInBrowser(declaration);checkpoint.sourceId=saved.result.id;await saveCheckpoint();
  const discovered=await act('native-discovery','source.discover',{sourceId:checkpoint.sourceId});
  let discovery=await workspace.job(checkpoint.sourceId,discovered.result.jobId);
  if(discovery.status!=='complete'&&!discovery.active)await act('native-discovery-resume-'+discovery.revision,'capture.resume',{sourceId:checkpoint.sourceId,captureId:discovery.id});
  discovery=await waitJob(discovered);checkpoint.discoveryId=discovery.id;await saveCheckpoint();
  for(const key of ['type:post','type:page','type:attachment','type:sf_note','taxonomy:category'])
   assert(discovery.complete.collections.some(row=>row.key===key),'Native discovery missing '+key);
  const note=discovery.complete.collections.find(row=>row.key==='type:sf_note');assert.equal(note.route,'/sf-native/v1/field-notes');
  const selection={collections:[{key:'type:post',query:{status:['publish','draft']}},{key:'type:page',query:{}},
   {key:'type:attachment',query:{}},{key:'type:sf_note',query:{}},{key:'taxonomy:category',query:{hide_empty:false}}],
   maxPages:100,maxRecords:1000,maxBytes:33554432};
  checkpoint.captureId=await id('native-interrupted-capture');await saveCheckpoint();
  if(!hasPhase('retained-native-discovery-and-response-recovery')){
  if(!await exists(join(WORK,'capture-interruption.json'))){
   const state=await workspace.inspect(),request={operationId:checkpoint.captureId,expectedRevision:state.revision,
    input:{sourceId:checkpoint.sourceId,discoveryId:checkpoint.discoveryId,selection}};
   await atomic(join(WORK,'capture-request.json'),request);await closeWorkspace();
   const interrupted=await child(NODE,[fileURLToPath(import.meta.url),'--config',configPath,'--capture-child',join(WORK,'capture-request.json')]);
   await atomic(join(OUTPUT,'capture-child-exit.json'),{code:interrupted.code,signal:interrupted.signal,stderr:interrupted.err});
   assert.equal(interrupted.code,73,interrupted.err);await openWorkspace();
  }
  const retained=await readJson(join(WORK,'capture-interruption.json')),before=await readFile(retained.path);
  const beforeCounts=await php('counts');
  const resume=await act('native-capture-resume','capture.resume',{sourceId:checkpoint.sourceId,captureId:checkpoint.captureId});
  const completed=await waitJob(resume),afterCounts=await php('counts');
  assert.equal(sha(await readFile(retained.path)),sha(before));
  const firstKey='/wp/v2/posts?page=1&context=edit';assert.equal(beforeCounts[firstKey],1);assert.equal(afterCounts[firstKey],1);
  const sample=await workspace.records(checkpoint.sourceId,checkpoint.captureId,{offset:0,limit:250});
  assert(sample.rows.some(row=>row.nativeId===String(seeded.seed.draft)),'Actual editor capture omitted original draft.');
  assert(completed.complete.responses.length>5,'Native pagination did not retain multiple pages.');
  await phase('retained-native-discovery-and-response-recovery',{sourceId:checkpoint.sourceId,discoveryId:checkpoint.discoveryId,captureId:checkpoint.captureId,
   captureSha256:completed.complete.sha256,recordCount:completed.recordCount,responseCount:completed.responseCount,
   interruptionExit:73,retainedResponseSha256:sha(before),firstPageNativeRequests:afterCounts[firstKey],customRoute:note.route});
  }
  let first,second;
  if(!hasPhase('reviewed-native-editions-and-exact-integer')){
  let projection=await workspace.suggestedProjection(checkpoint.sourceId,checkpoint.captureId);
  projection.mapping.native_integer={pointer:'/native/native_exact',type:'string',nullable:true,missing:'null'};
  const preview=await workspace.preview({sourceId:checkpoint.sourceId,captureId:checkpoint.captureId,projection,offset:0,limit:20});
  assert(preview.rows.some(row=>row.row.native_integer==='9223372036854775807'));
  first=await edition('native-v1',checkpoint.sourceId,checkpoint.captureId,projection);
  checkpoint.edition1=first.edition.id;await saveCheckpoint();
  const mutation=await php('mutate');
  const nextCapture=await capture('native-v2-capture',checkpoint.sourceId,checkpoint.discoveryId,selection);
  second=await edition('native-v2',checkpoint.sourceId,nextCapture.id,projection);
  checkpoint.edition2=second.edition.id;await saveCheckpoint();
  const compared=await workspace.compare(first.edition.id,second.edition.id,{offset:0,limit:100});
  assert.notEqual(first.edition.dataset.snapshot,second.edition.dataset.snapshot);
  for(const [kind,nativeId] of [['added',mutation.added],['removed',mutation.removed],['sourceChanged',mutation.changed]])
   assert(compared.changes.some(row=>row.kind===kind&&row.key==='type:post:'+nativeId),'The original comparison omitted '+kind);
  await atomic(join(OUTPUT,'edition-comparison.json'),compared);
  await phase('reviewed-native-editions-and-exact-integer',{before:first.edition.dataset.snapshot,after:second.edition.dataset.snapshot,
   nativeMutation:mutation,comparison:compared,exactInteger:'9223372036854775807'});
  }else{
   first={edition:await workspace.edition(checkpoint.edition1)};
   second={edition:await workspace.edition(checkpoint.edition2)};
  }
  const merchant=await act('native-merchant','merchant.save',{editionId:first.edition.id,...config.merchant,reviewer:'83DD native merchant operator',
   note:'Original configured testnet merchant terms.'});checkpoint.merchantId=merchant.result.id;await saveCheckpoint();
  let contentProduct=checkpoint.contentProduct;
  if(!hasPhase('original-versioned-publication-and-customer')){
  const export1=await act('native-content-export-v1','edition.export',{editionId:first.edition.id,merchantId:merchant.result.id,
   productLabel:'Native WordPress content',reviewer:'83DD native merchant operator',note:'Original reviewed source closure.'});
  contentProduct=export1.result.productId;checkpoint.contentProduct=contentProduct;await saveCheckpoint();
  await ensureRelease('content',contentProduct,export1.result.id);
  const export2=await act('native-content-export-v2','edition.export',{editionId:second.edition.id,merchantId:merchant.result.id,productId:contentProduct,
   reviewer:'83DD native merchant operator',note:'Native updated WordPress edition.'});
  const candidate=await act('native-content-prepare-v2','publisher.prepare',{productId:contentProduct,exportDirectory:join(DIRECTORY,'exports',export2.result.id)});
  const target=(await workspace.inspect()).publisher.target.versions;
  if(target.current!==second.edition.dataset.snapshot){
   await act('native-content-review-v2','publisher.reviewDraft',{productId:contentProduct,draftId:candidate.result.draft.id,
    expectedSnapshot:target.current,expectedRevision:target.revision});
   await act('native-content-publish-v2','publisher.publish',{productId:contentProduct,draftId:candidate.result.draft.id,
    expectedSnapshot:target.current,expectedRevision:target.revision});
  }
  const contentPurchase=await purchase('content',contentProduct,second.edition.dataset.snapshot,'limit=50',second.edition.rowCount,Math.max(1,Math.ceil(second.edition.rowCount/50)));
  await phase('original-versioned-publication-and-customer',{productId:contentProduct,buyerId:contentPurchase.buyerId,
   snapshot:contentPurchase.delivery.report.snapshot,payment:config.merchant.payment,report:contentPurchase.delivery.report,
   accounting:contentPurchase.accounted,delivery:contentPurchase.delivery.exported});
  }
  await act('native-content-stop','publisher.release.stop',{productId:contentProduct});
  if(!hasPhase('native-browser-source-editions-and-download'))await browserReview();
  const packetRecord=await act('native-complete-packet','source.packet',{});
  checkpoint.packetId=packetRecord.result.id;await saveCheckpoint();
  const packetPath=join(DIRECTORY,'packets',packetRecord.result.id+'.zip');
  let restored=checkpoint.packetRestore,again=checkpoint.packetRepeat;
  if(!restored||!again){
   restored=await packet('restore',{input:packetPath,directory:RECEIVED,python:config.python});
   again=await packet('restore',{input:packetPath,directory:RECEIVED,python:config.python});
   assert.equal(restored.workspaceId,(await workspace.inspect()).id);assert(again.reusedFiles>0);
   checkpoint.packetRestore=restored;checkpoint.packetRepeat=again;await saveCheckpoint();
  }
  const sourceProduct=await act('native-source-files','source.files',{packetId:packetRecord.result.id,merchantId:merchant.result.id,
   name:'Native complete WordPress source',productLabel:'Complete native WordPress source',reviewer:'83DD native source receiver',
   note:'Exact retained packet, manifest and original file projection.'});
  checkpoint.sourceProduct=sourceProduct.result.productId;await saveCheckpoint();
  const sourceDirectory=join(DIRECTORY,'exports',sourceProduct.result.id),metadataBytes=await readFile(join(sourceDirectory,'source.json')),
   metadata=JSON.parse(metadataBytes);
  assert(metadataBytes.length<=1048576);assert.equal(metadata.manifest.sha256,packetRecord.result.manifestSha256);
  assert.equal(metadata.manifest.files,packetRecord.result.files);assert(!Array.isArray(metadata.manifest.files));
  if(!hasPhase('original-paid-complete-source-receiving')){
  await ensureRelease('source-files',sourceProduct.result.productId,sourceProduct.result.id);
  const sourcePurchase=await purchase('source-files',sourceProduct.result.productId,sourceProduct.result.snapshot,'limit=10',
   sourceProduct.result.rowCount,Math.max(1,Math.ceil(sourceProduct.result.rowCount/10)));
  const receiver=await child(config.python,[join(HERE,'receive.py'),'--checkout',config.sourceRoot,'--node',NODE,
   '--delivery',sourcePurchase.delivery.delivery,'--session',sourcePurchase.acquisition,'--destination',PURCHASED,
   '--capture',packetRecord.result.manifestSha256,'--workspace',(await workspace.inspect()).id],{timeout:360000});
  assert.equal(receiver.code,0,receiver.err||receiver.out);const received=JSON.parse(receiver.out);
  assert.equal(received.workspaceId,restored.workspaceId);
  await phase('original-paid-complete-source-receiving',{productId:sourceProduct.result.productId,buyerId:sourcePurchase.buyerId,
   packet:packetRecord.result,sourceMetadataBytes:metadataBytes.length,manifestBytes:metadata.manifest.bytes,
   nativeDelivery:sourcePurchase.delivery.report,receipt:received,packetRetryReusedFiles:again.reusedFiles});
  }
  await act('native-source-files-stop','publisher.release.stop',{productId:sourceProduct.result.productId});
  await closeWorkspace();
  if(!hasPhase('native-cli-and-startup-observer-reopen')){
  const receivedWorkspace=await openWordPressWorkspace({directory:PURCHASED,python:config.python}),receivedOwner={close:()=>receivedWorkspace.close()};owned.add(receivedOwner);
  const reopened=await receivedWorkspace.inspect();assert.equal(reopened.id,restored.workspaceId);assert.equal(reopened.editions.length,2);
  assert.equal(reopened.packets.length,0);assert.equal(reopened.operations.length,0);
  const originalCsv=await readFile(join(DIRECTORY,'editions',checkpoint.edition2,'dataset.csv'));
  assert.equal(sha(await readFile(join(PURCHASED,'editions',checkpoint.edition2,'dataset.csv'))),sha(originalCsv));
  await receivedWorkspace.close();owned.delete(receivedOwner);
  const {inspectWordPressWorkspaceBinding,inspectWordPressLaunchSource}=await import(pathToFileURL(join(SOURCE,'managed.mjs')));
  const {wordpressStartup}=await import(pathToFileURL(join(SOURCE,'application-provider.mjs')));
  const binding=await inspectWordPressWorkspaceBinding(PURCHASED),launchSource=await inspectWordPressLaunchSource(SOURCE);
  const launchArgs=['serve','--dir',PURCHASED,'--port','0','--python',config.python,
   '--expected-workspace-id',binding.workspaceId,'--expected-workspace-identity',binding.sha256,
   '--managed-source',SOURCE,'--expected-source-sha256',launchSource.sha256];
  managedChild=spawn(NODE,[join(SOURCE,'cli.mjs'),...launchArgs],{env:process.env,stdio:['ignore','pipe','pipe']});
  const startup=await new Promise((ok,bad)=>{let out='',err='';const timer=setTimeout(()=>bad(Error('Native managed startup timed out.')),30000);
   managedChild.stderr.on('data',b=>{err+=b.toString();});managedChild.stdout.on('data',b=>{out+=b.toString();
    const line=out.split('\n').find(x=>x.startsWith('{"schema":"stellar-forge.wordpress-workspace-startup.v1",'));if(line){clearTimeout(timer);ok(line);}});
   managedChild.once('exit',code=>{clearTimeout(timer);bad(Error('Native managed CLI ended '+code+': '+err.slice(0,2000)));});managedChild.once('error',bad);
  });
  const observed=await wordpressStartup({command:'wordpress',args:launchArgs,releaseDirectory:dirname(config.sourceRoot)},startup);
  assert(observed?.url);assert.equal(observed.original.workspaceId,binding.workspaceId);
  await launchBrowser();const receivedPage=await browser.newPage({viewport:{width:1440,height:1040}});
  await receivedPage.goto(observed.url,{waitUntil:'networkidle'});
  await receivedPage.waitForSelector('#edition-select option[value="'+checkpoint.edition2+'"]');
  await receivedPage.screenshot({path:join(OUTPUT,'wordpress-received-workspace.png'),fullPage:true});await receivedPage.close();
  await phase('native-cli-and-startup-observer-reopen',{workspaceId:binding.workspaceId,workspaceIdentity:binding.sha256,
   sourceSha256:launchSource.sha256,instanceId:observed.original.instanceId,pid:observed.original.pid,
   csvSha256:sha(originalCsv),screenshot:'wordpress-received-workspace.png'});
  }
  result.passed=true;
 }catch(error){
  result.error={name:error.name,code:error.code??null,message:String(error.message).slice(0,5000),stack:String(error.stack).slice(0,12000)};
  process.exitCode=1;
 }finally{
  const failures=[];
  if(managedChild&&managedChild.exitCode===null&&managedChild.signalCode===null){await new Promise(ok=>{const timer=setTimeout(()=>{managedChild.kill('SIGKILL');ok();},10000);managedChild.once('exit',()=>{clearTimeout(timer);ok();});managedChild.kill('SIGTERM');});}
  try{await browser?.close();}catch(e){failures.push(e.message);}
  try{await closeWorkspace();}catch(e){failures.push(e.message);}
  for(const handle of [...owned])try{if(handle[Symbol.asyncDispose])await handle[Symbol.asyncDispose]();else await handle.close();}catch(e){failures.push(e.message);}
  result.resourcesClosed=failures.length===0;result.cleanupErrors=failures;result.endedAt=new Date().toISOString();
  if(failures.length){result.passed=false;process.exitCode=1;}
  await atomic(resultPath,result);console.log(JSON.stringify({passed:result.passed,phases:result.phases.length,resourcesClosed:result.resourcesClosed,result:resultPath,error:result.error?.message}));
 }
}
