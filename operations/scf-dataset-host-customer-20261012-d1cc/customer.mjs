// One original dataset host customer continuation, over retained native inputs.
import {constants} from 'node:fs';
import {readFile,writeFile,open,mkdir,rename,unlink,lstat,readdir} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

const inputFile=resolve(process.argv[2]), root=dirname(inputFile);
const inputRaw=await readFile(inputFile), input=JSON.parse(inputRaw);
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const check=(value,message)=>{if(!value)throw Error(message)};
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const optional=async path=>{try{return await read(path)}catch(e){if(e.code==='ENOENT')return null;throw e}};
const resultFile=join(root,'host-customer-result.json'), intentRoot=join(root,'customer-intents');
check(input.schema==='stellar-forge.dataset-host-customer.v1','Unsupported original customer input');
await mkdir(intentRoot,{recursive:true,mode:0o700});
async function save(path,value){
 const temporary=path+'.'+randomUUID()+'.tmp';let fd;
 try{fd=await open(temporary,'wx',0o600);await fd.writeFile(encode(value));await fd.sync();await fd.close();fd=null;
  await rename(temporary,path);const parent=await open(dirname(path),'r');try{await parent.sync()}finally{await parent.close()}}
 finally{await fd?.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e})}
}
const prior=await optional(resultFile);
check(!prior||prior.inputSha256===hash(inputRaw),'The original customer inputs changed');
check(prior?.status!=='COMPLETE','The original host customer is already complete');
const result=prior??{schema:'stellar-forge.dataset-host-customer-result.v1',inputSha256:hash(inputRaw),
 startedAt:new Date().toISOString(),status:'RUNNING',stages:{},pageErrors:[]};
result.status='RUNNING';
await save(resultFile,result);
async function stage(name,work){
 if(result.stages[name])return result.stages[name];
 console.log(JSON.stringify({phase:name,status:'RUNNING'}));
 const value=await work();result.stages[name]=value;await save(resultFile,result);
 console.log(JSON.stringify({phase:name,status:'COMPLETE'}));return value;
}
async function intent(name,build){
 const file=join(intentRoot,name+'.json'),saved=await optional(file);
 if(saved)return saved;const value=await build();await save(file,value);return value;
}
async function runCustomer(){
const closureRaw=await readFile(input.sourceClosure),closure=JSON.parse(closureRaw);
check(hash(closureRaw)===input.sourceClosureSha256&&closure.sourceCommit===input.sourceCommit,
 'The complete selected customer source changed');
const sourceRoot=closure.sourceRoot;
const {startDatasetWorkspace}=await import(pathToFileURL(join(sourceRoot,
 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-workspace/server.mjs')).href);
const {catalogChoices}=await import(pathToFileURL(join(sourceRoot,
 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-workspace/receiving.mjs')).href);
const {readBuyerOperatorPreset}=await import(pathToFileURL(join(sourceRoot,
 'stellar/scf-starforge-20261009/buyer-runbook/handoff-intake.mjs')).href);
const {chromium}=await import(pathToFileURL(input.playwright).href);
const definitionRaw=await readFile(join(input.session,'session.json')),definition=JSON.parse(definitionRaw);
check(hash(definitionRaw)===input.definitionSha256&&definition.configurationSha256===input.configurationSha256&&
 definition.config.operation.intentId===input.nativeSessionId,'The original acquisition changed');
const nativeUrl=new URL(definition.config.operation.url);
const preset=await readBuyerOperatorPreset(input.operatorSettings,{directory:join(input.stateDirectory,'received')});
check(preset.sha256===input.operatorSettingsSha256,'The prepared host preset changed');
const offersRaw=await readFile(input.offersFile);
check(hash(offersRaw)===input.offersSha256,'The generated original seller offers changed');
const choices=catalogChoices(offersRaw),terms=definition.config.operation.expect;
const choiceIndex=choices.findIndex(row=>row.resource===nativeUrl.origin+nativeUrl.pathname&&
 ['network','asset','payTo','maxAtomic'].every(key=>row.terms[key]===terms[key]));
check(choiceIndex>=0,'The new configured seller offer does not prepare this retained inventory example');
const choice=choices[choiceIndex],limit=definition.limits;
const generationRaw=await readFile(input.sellerGeneration),generation=JSON.parse(generationRaw);
check(hash(generationRaw)===input.sellerGenerationSha256&&
 generation.kind==='NEW_ORIGINAL_SF30_CONFIGURATION'&&generation.sourceCommit===input.sourceCommit&&
 generation.offersSha256===input.offersSha256&&
 generation.originalAcquisition.sessionId===input.nativeSessionId&&
 generation.originalAcquisition.configurationSha256===input.configurationSha256&&
 generation.originalAcquisition.payments===0,'The new original seller generation changed');
result.merchantInput={kind:generation.kind,sha256:input.sellerGenerationSha256,
 priorAcquisitionPayments:0,newProviderRequests:0};
const environmentPin=input.originalHostEnvironment;
async function originalHostFile(path,expected){
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await file.stat({bigint:true});
  check(before.isFile()&&before.size<=16384n&&(before.mode&0o077n)===0n&&
   (typeof process.getuid!=='function'||before.uid===BigInt(process.getuid())),
   'The original private host input ownership changed');
  const raw=await file.readFile(),after=await file.stat({bigint:true}),current=await lstat(path,{bigint:true});
  check(current.isFile()&&['dev','ino','size','mtimeNs','ctimeNs'].every(key=>
   before[key]===after[key]&&after[key]===current[key])&&hash(raw)===expected,
   'The original private host input changed');
  return JSON.parse(raw);
 }finally{await file.close()}
}
const originalEnvironment=await originalHostFile(environmentPin.path,environmentPin.sha256);
check(originalEnvironment.payer===preset.value.payer&&environmentPin.payer===preset.value.payer&&
 originalEnvironment.payTo===terms.payTo,'The original wallet identity changed');
if(!preset.value.signerProvider){
 check(preset.value.secretEnv===environmentPin.secretEnv&&
  /^[A-Z][A-Z0-9_]{0,127}$/.test(environmentPin.secretEnv)&&!environmentPin.secretEnv.startsWith('SF36_')&&
  typeof originalEnvironment.secret==='string','The original wallet environment binding changed');
 process.env[environmentPin.secretEnv]=originalEnvironment.secret;
}
if(preset.value.httpsProxyEnv){
 const originalOperator=await originalHostFile(environmentPin.operator,environmentPin.operatorSha256);
 check(originalOperator.buyerTransport?.mode==='explicit-connect'&&
  originalOperator.buyerTransport.origin===nativeUrl.origin&&
  typeof originalOperator.buyerTransport.proxyUrl==='string','The original buyer transport changed');
 process.env[preset.value.httpsProxyEnv]=originalOperator.buyerTransport.proxyUrl;
}
const browserEnvironment={...process.env};
for(const name of [environmentPin.secretEnv,preset.value.httpsProxyEnv])if(name)delete browserEnvironment[name];
const retainedTotal=BigInt(limit.maxTotalAtomic),hostTotal=BigInt(preset.value.maxTotalAtomic);
const total=retainedTotal<hostTotal?retainedTotal:hostTotal;
const daily=BigInt(preset.value.maxDailyAtomic)<total?BigInt(preset.value.maxDailyAtomic):total;
check(total<=BigInt(preset.value.maxTotalAtomic)&&daily>=BigInt(terms.maxAtomic),
 'The original selected acquisition limits do not fit the retained host preset');
const acquisitionInput=name=>({sourceId:input.offersSha256,name,rowIndex:choice.rowIndex,
 acceptIndex:choice.acceptIndex,query:nativeUrl.search.slice(1),maxPages:limit.maxPages,maxRows:limit.maxRows,
 maxPageBytes:limit.maxPageBytes,maxTotalAtomic:String(total),dailyAtomic:String(daily)});
const profile={schema:'stellar-forge.sf88.dataset-workspace.v1',sessions:[{
 id:'retained_inventory',label:'Original retained inventory',session:input.session,room:input.room}]};
const profileFile=join(root,'retained-profile.json');
const oldProfile=await optional(profileFile);
if(oldProfile)check(JSON.stringify(oldProfile)===JSON.stringify(profile),'Original profile changed');
else await save(profileFile,profile);
const originalFiles={};
for(const [name,pin]of Object.entries(input.deliveryFiles)){
 const bytes=await readFile(join(input.room,name));
 check(bytes.length===pin.bytes&&hash(bytes)===pin.sha256,'Original delivered file changed: '+name);
 originalFiles[name]=pin;
}
let browser=null,context=null,page=null,app=null,appEpoch=null;
async function api(path,value,{url=app.url,header='X-Dataset-Workspace-Token',raw=false}={}){
 const u=new URL(url),response=await fetch(new URL(path,u.origin),{
  method:value===undefined?'GET':'POST',headers:{[header]:u.hash.slice(1),
   ...(value===undefined?{}:{'content-type':'application/json',origin:u.origin})},
  ...(value===undefined?{}:{body:JSON.stringify(value)})});
 if(!response.ok){const message=await response.json().catch(()=>({}));
  throw Object.assign(Error(message.message??message.error??'Original application HTTP '+response.status),{status:response.status,code:message.error})}
 return raw?Buffer.from(await response.arrayBuffer()):response.json();
}
async function uiResponse(path,action){
 const waiting=page.waitForResponse(response=>new URL(response.url()).pathname===path&&
 response.request().method()==='POST',{timeout:120000});
 await action();const response=await waiting;
 const value=await response.json();
 check(response.ok(),value.message??value.error??'The original customer action failed');
 return{value,request:response.request().postDataJSON()};
}
async function start(){
 app=await startDatasetWorkspace({stateDirectory:input.stateDirectory,profilePath:profileFile,port:0,
  analysis:{python:input.python,checkout:sourceRoot,directory:input.analysisDirectory}});
 appEpoch=hash(new URL(app.url).hash).slice(0,12);
 if(!browser)browser=await chromium.launch({executablePath:input.chromium,headless:true,
  args:['--no-sandbox','--disable-dev-shm-usage'],env:browserEnvironment,downloadsPath:join(root,'downloads')});
 context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
 page=await context.newPage();page.on('pageerror',error=>result.pageErrors.push(error.message));
 await page.goto(app.url);await page.locator('#open-operator').waitFor();
}
async function close(){
 const failures=[],ownedContext=context,ownedApp=app;
 context=null;page=null;app=null;
 try{await ownedContext?.close()}catch(error){failures.push(error)}
 try{await ownedApp?.close()}catch(error){failures.push(error)}
 if(failures.length)throw new AggregateError(failures,'The original customer close did not finish');
}
async function fillSettings(value,note){
 await page.locator('#open-operator').click();await page.locator('#operator-form').waitFor();
 await page.locator('#operator-signer-kind').selectOption(value.signerProvider?'PROVIDER':'ENVIRONMENT');
 const ids={actor:'actor',service:'service',payer:'payer',python:'python',maxTotalAtomic:'total',
  maxDailyAtomic:'daily',secretEnv:'secret-env',signerProvider:'provider',rpc:'rpc',httpsProxyEnv:'proxy-env'};
 for(const [key,id]of Object.entries(ids)){
  if(key==='secretEnv'&&value.signerProvider||key==='signerProvider'&&!value.signerProvider)continue;
  await page.locator('#operator-'+id).fill(String(value[key]??(key==='secretEnv'?'STELLAR_SECRET':'')));
 }
 await page.locator('#operator-note').fill(note);
}
async function saveHost(name,settings,note,sourceRevision=null){
 const file=join(intentRoot,name+'.json');let retained=await optional(file),value;
 if(retained)value=await api('/api/operator/save',retained);
 else{
  if(sourceRevision){
   await page.locator('#open-operator').click();
   await page.locator('[data-operator-revision="'+sourceRevision+'"]').click();
   await page.locator('#operator-note').fill(note);
  }else await fillSettings(settings,note);
  const reviewed=await uiResponse('/api/operator/review',()=>page.locator('#operator-review').click());
  retained={...reviewed.request,expectedReviewSha256:reviewed.value.reviewSha256};
  await save(file,retained);
  const saved=await uiResponse('/api/operator/save',()=>page.locator('#operator-save').click());
  value=saved.value;
 }
 check(value.configured&&value.revision&&value.settingsSha256,'The reviewed host was not saved');
 return{revision:value.revision,revisionNumber:value.revisionNumber,settingsSha256:value.settingsSha256,
  impact:value.impact,operator:value.operator};
}
async function received(){
 const state=await api('/api/state');
 if(state.sources.some(row=>row.id===input.offersSha256))return api('/api/source?id='+input.offersSha256);
 await page.locator('#receive-nav').click();
 const response=await uiResponse('/api/receive',()=>page.getByLabel('Original merchant offers JSON').setInputFiles(input.offersFile));
 check(response.value.id===input.offersSha256,'Received merchant bytes changed');
 return response.value;
}
async function reviewedAcquisition(name){
 await received();
 const request=await intent('review-'+name,()=>acquisitionInput(name));
 const review=await api('/api/review',request);
 check(review.sourceId===input.offersSha256&&review.sourceUrl===nativeUrl.href,'Original reviewed merchant identity changed');
 return review;
}
async function readySnapshot(reviewId){
 const root=join(input.stateDirectory,'received/products',reviewId),ready=await read(join(root,'ready.json'));
 const definition=await read(join(ready.session,'session.json')),files={};
 for(const name of ['operator.json','workspace.json','policy.json','signer.mjs']){
  const raw=await readFile(join(ready.workspace,name));files[name]={bytes:raw.length,sha256:hash(raw)};
  check(files[name].sha256===ready.files[name],'Prepared native file changed: '+name);
 }
 const names=(await readdir(ready.workspace)).filter(name=>/\.(pem|key)$/.test(name)).sort();
 const ledger=definition.config.operator.ledger;
 const retained=[join(ready.workspace,'operator-keys.json'),...names.map(name=>join(ready.workspace,name)),ledger];
 for(const path of new Set(retained)){
  const stat=await lstat(path);check(stat.isFile(),'The original prepared identity is not a regular file');
  const raw=await readFile(path);files[path]={bytes:raw.length,sha256:hash(raw)};
 }
 return{reviewId,session:ready.session,workspace:ready.workspace,generation:ready.generation,
  sessionGeneration:ready.sessionGeneration,definitionSha256:ready.definitionSha256,
  sessionId:ready.sessionId,configurationSha256:ready.configurationSha256,files};
}
async function downloadSettings(revision){
 await page.locator('#open-operator').click();
 const response=await Promise.all([page.waitForEvent('download',{timeout:30000}),
  page.locator('a[href="/files/operator/'+revision+'/settings.json"]').click()]);
 const destination=join(root,'downloads',revision+'.settings.json');
 await response[0].saveAs(destination);const raw=await readFile(destination);
 return{path:destination,bytes:raw.length,sha256:hash(raw)};
}
async function action(kind,id,extra={}){
 const request=await intent('action-'+id,async()=>{
  const current=await api('/api/session?id=retained_inventory');
  return{actionId:id,session:'retained_inventory',kind,expectedRevision:current.revision,...extra};
 });
 let job=await api('/api/start',request);
 const deadline=Date.now()+180000;
 while(job.status==='RUNNING'&&Date.now()<deadline){await new Promise(r=>setTimeout(r,500));job=await api('/api/job?id='+id)}
 check(job.status==='COMPLETE',job.error?.message??'The original customer operation did not finish: '+job.status);
 return job;
}
async function originalAnalysis(id){
 // Analysis owns a process for this particular application open. A previously
 // completed start remains retained while the new host starts its own service.
 const job=await action('analysis',id+'-'+appEpoch,{alias:'received_inventory'});
 check(job.result.workspaceId===input.analysisWorkspaceId,'The original analysis workspace changed');
 const state=await api('/api/state');
 check(state.analysis.running&&state.analysis.alias==='received_inventory','Original analysis is not open');
 const target=await context.newPage();target.on('pageerror',error=>result.pageErrors.push(error.message));
 try{
  await target.goto(state.analysis.url);await target.locator('[data-tab="reports"]').click();
  await target.locator('#report-publications').getByRole('button').first().waitFor();
  const observed=await api('/api/state',undefined,{url:state.analysis.url,header:'X-Analysis-Capability'});
  const report=await api('/api/report-runs/'+input.reportId,undefined,{url:state.analysis.url,header:'X-Analysis-Capability'});
  check(observed.workspace_id===input.analysisWorkspaceId&&report.report.result_sha256===input.reportResultSha256,
   'The retained analytical report changed');
  return{workspaceId:observed.workspace_id,reportId:input.reportId,resultSha256:report.report.result_sha256};
 }finally{await target.close()}
}
try{
 await start();
 const first=await stage('saved_original_host',()=>saveHost('host-original',preset.value,'Original retained inventory buyer host'));
 await stage('exact_host_download',async()=>{const file=await downloadSettings(first.revision);
  check(file.sha256===first.settingsSha256,'The downloaded host settings changed');return file});
 const prepared=await stage('configured_merchant_preparation',async()=>{
  const review=await reviewedAcquisition('host_inventory_prepared');
  check(review.settingsSha256===first.settingsSha256,'New acquisition did not bind the reviewed original host');
  const value=await api('/api/prepare',{reviewId:review.reviewId});
  check(value.id==='host_inventory_prepared','The original preparation returned another session');
  return readySnapshot(review.reviewId);
 });
 const pending=await stage('pending_original_review',()=>reviewedAcquisition('host_inventory_future'));
 const next={...preset.value},single=BigInt(terms.maxAtomic);
 if(BigInt(next.maxTotalAtomic)>single){
  next.maxTotalAtomic=String(BigInt(next.maxTotalAtomic)-single);
  next.maxDailyAtomic=String(BigInt(next.maxDailyAtomic)>BigInt(next.maxTotalAtomic)?BigInt(next.maxTotalAtomic):BigInt(next.maxDailyAtomic));
 }else next.service=(next.service.slice(0,49)+'-future').slice(0,64);
 const changed=await stage('reviewed_future_host',()=>saveHost('host-future',next,'Future acquisition host; retain existing preparation'));
 await stage('prepared_identity_retained',async()=>{
  check(changed.impact.rows.some(row=>row.id===prepared.reviewId&&row.phase==='PREPARED'&&!row.needsReview),
   'The original prepared buyer was not retained');
  check(changed.impact.rows.some(row=>row.id===pending.reviewId&&row.phase==='REVIEWED'&&row.needsReview),
   'The future review did not follow the selected host');
  await api('/api/prepare',{reviewId:prepared.reviewId});
  const current=await readySnapshot(prepared.reviewId);
  check(JSON.stringify(current)===JSON.stringify(prepared),'Original preparation identity, keys or ledger changed');
  return{reviewId:prepared.reviewId,sessionId:prepared.sessionId,pendingReviewId:pending.reviewId,files:current.files};
 });
 const restored=await stage('restored_original_host',()=>saveHost('host-restored',preset.value,'Restore original retained host',first.revision));
 await stage('restored_original_bytes',async()=>{
  const file=await downloadSettings(restored.revision);
  check(file.sha256===first.settingsSha256&&restored.settingsSha256===first.settingsSha256,
   'Restoring a host revision changed its original bytes');
  const state=await api('/api/operator');
  check(state.history.length===3&&state.history.some(row=>row.id===first.revision)&&
   state.impact.rows.some(row=>row.id===pending.reviewId&&!row.needsReview),'Original host history or pending selection changed');
  return{revision:restored.revision,settingsSha256:file.sha256,history:state.history.map(({id,revision})=>({id,revision}))};
 });
 await stage('reused_original_delivery',async()=>{
  const job=await action('deliver','host-customer-delivery-original');
  check(job.result.appendedPages===0,'The original delivery appended new pages');
  const preview=await api('/api/preview?session=retained_inventory&offset=0&limit=100');
  check(preview.rows.length===6&&preview.originalSha256===input.deliveryFiles['dataset.jsonl'].sha256,'The retained inventory changed');
  if(await page.locator('#close-operator').isVisible()) await page.locator('#close-operator').click();
  await page.getByRole('button').filter({hasText:'Original retained inventory'}).click();
  await page.getByRole('button',{name:'Data & analysis',exact:true}).click();
  const ticket=await api('/api/download-ticket',{session:'retained_inventory',name:'dataset.csv'});
  const response=await fetch(new URL(ticket.url,app.origin));
  check(response.ok,'The original CSV did not download');
  const raw=Buffer.from(await response.arrayBuffer());
  check(hash(raw)===input.deliveryFiles['dataset.csv'].sha256,'The original downloaded inventory changed');
  await writeFile(join(root,'downloads','retained-inventory.csv'),raw,{mode:0o600});
  return{rows:preview.rows.length,appendedPages:job.result.appendedPages,sourceBindingSha256:job.result.sourceBindingSha256,
   jsonlSha256:preview.originalSha256,csvSha256:hash(raw)};
 });
 await stage('opened_original_report',()=>originalAnalysis('host-customer-analysis-original'));
 await stage('narrow_customer_view',async()=>{
  await page.setViewportSize({width:390,height:844});await page.locator('#open-operator').click();
  const observed=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,
   configured:document.querySelector('#operator-ready')?.textContent}));
  check(observed.documentWidth<=observed.width,'The host customer overflows its narrow viewport');
  return observed;
 });
 await close();
 await start();
 await stage('reopened_customer_and_report',async()=>{
  const host=await api('/api/operator'),current=await readySnapshot(prepared.reviewId);
  check(host.revision===restored.revision&&host.settingsSha256===first.settingsSha256&&
   JSON.stringify(current)===JSON.stringify(prepared),'The saved host or prepared buyer did not reopen');
  const preview=await api('/api/preview?session=retained_inventory&offset=0&limit=100');
  check(preview.rows.length===6,'The existing inventory did not reopen');
  const report=await originalAnalysis('host-customer-analysis-reopened');
  return{revision:host.revision,rows:preview.rows.length,...report};
 });
 await close();
 await stage('original_input_identity',async()=>{
  check(hash(await readFile(join(input.session,'session.json')))===input.definitionSha256,'Original session definition changed');
  for(const [name,pin]of Object.entries(originalFiles)){
   const raw=await readFile(join(input.room,name));
   check(raw.length===pin.bytes&&hash(raw)===pin.sha256,'Original accepted output changed: '+name);
  }
  return{sessionId:input.nativeSessionId,configurationSha256:input.configurationSha256,deliveryFiles:originalFiles};
 });
 check(result.pageErrors.length===0,'The original customer browser reported an error');
 result.status='COMPLETE';result.completedAt=new Date().toISOString();
}catch(error){result.status='FAILED';result.error={name:error.name,message:error.message,code:error.code??null};process.exitCode=1}
finally{
 try{await close()}catch(error){result.cleanupError=error.message;result.status='FAILED';process.exitCode=1}
 await browser?.close().catch(error=>{result.cleanupError=error.message;result.status='FAILED';process.exitCode=1});
 result.closedAt=new Date().toISOString();await save(resultFile,result);
 console.log(JSON.stringify({status:result.status,stages:Object.keys(result.stages),result:resultFile,error:result.error??null}));
}

}
try{await runCustomer()}catch(error){
 result.status='FAILED';result.error={name:error.name,message:error.message,code:error.code??null};
 result.closedAt=new Date().toISOString();process.exitCode=1;await save(resultFile,result);
 console.log(JSON.stringify({status:result.status,result:resultFile,error:result.error}));
}
