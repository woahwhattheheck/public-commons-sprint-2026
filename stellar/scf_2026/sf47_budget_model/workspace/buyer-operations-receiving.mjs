// MIT. One retained native Inbox source through customer SDKs and the original SF47 UI.
// Run with a private configuration file. No purchase, recovery or finalization is invoked.
import {readFile,writeFile,open,mkdir,rename,lstat,readdir,readlink} from 'node:fs/promises';
import {join,resolve,dirname,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const sha=raw=>createHash('sha256').update(raw).digest('hex');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
  value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const configPath=resolve(process.argv[2]||'');
need(process.argv.length===3,'Use node buyer-operations-receiving.mjs PRIVATE_CONFIG.json');
const configRaw=await readFile(configPath),config=JSON.parse(configRaw);
need(config.schema==='sf47.native-buyer-receiving-config.v1','Configuration schema differs.');
for(const key of ['sourceRoot','workDirectory','inboxDirectory','browserExecutable','playwrightModule'])
  need(typeof config[key]==='string'&&isAbsolute(config[key]),'Use an absolute '+key);
need(Array.isArray(config.intentIds)&&config.intentIds.length>0&&config.intentIds.length<=100,'Select original intents.');
need(typeof config.actor==='string'&&config.actor.trim()&&typeof config.caseName==='string'&&config.caseName.trim(),
  'Record the operator and case name.');
const work=resolve(config.workDirectory),repo=resolve(config.sourceRoot);
need(!work.startsWith(resolve(config.inboxDirectory)+'/'),'The continuation directory must be outside the original Inbox.');
await mkdir(work,{recursive:true,mode:0o700});
need((await lstat(work)).isDirectory()&&((await lstat(work)).mode&0o077)===0,'The continuation directory must be private.');
const sourceHead=config.sourceHead??null,sf88=join(repo,'stellar/scf-starforge-20261009/sf88-operator-buyer-cli');
const grant=join(repo,'stellar/scf_2026/sf47_budget_model/workspace');
const node=config.nodeExecutable||process.execPath,python=config.pythonExecutable||'python3';
let cohortModule=null;
const workspace=join(work,'grant-workspace'),restored=join(work,'received-workspace');
const handoff=join(work,'original-buyer-operations.json'),statePath=join(work,'continuation.json');
await mkdir(join(work,'requests'),{recursive:true,mode:0o700});
await mkdir(join(work,'captures'),{recursive:true,mode:0o700});
await mkdir(join(work,'browser-tmp'),{recursive:true,mode:0o700});
async function optionalJSON(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function atomic(path,value){
  const raw=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
  const temp=path+'.writing-'+randomUUID(),h=await open(temp,'wx',0o600);
  try{await h.writeFile(raw);await h.sync();}finally{await h.close();}
  await rename(temp,path);return {path,bytes:raw.length,sha256:sha(raw)};
}
let state=await optionalJSON(statePath);
if(state)need(state.configSha256===sha(configRaw),'Continue with the exact original configuration.');
else state={schema:'sf47.native-buyer-receiving-run.v1',configSha256:sha(configRaw),sourceHead,startedAt:new Date().toISOString(),stages:[],requests:[],captures:[]};
const save=()=>atomic(statePath,state);
let baselineMemo=null;
function originalSelection(intentId){return (config.originalCase?.selections??[]).find(row=>row.intentId===intentId);}
function selectedPurchase(current,intentId){
  const selection=originalSelection(intentId);
  const purchase=selection?current.records.purchases.find(row=>row.id===selection.purchaseId):
    current.records.purchases.find(row=>row.intentId===intentId);
  need(purchase,'The selected original purchase is absent.');return purchase;
}
function selectedDeployment(current){
  const ids=[...new Set(config.intentIds.map(intent=>selectedPurchase(current,intent).deploymentId))];
  need(ids.length===1,'This selected Inbox observation must retain one original buyer deployment.');
  const deployment=current.records.deployments.find(row=>row.id===ids[0]);
  need(deployment,'The selected original buyer deployment is absent.');return deployment;
}
async function originalBaseline(){
  if(!state.caseBaseline)return null;
  if(!baselineMemo){const raw=await readFile(state.caseBaseline.path);need(sha(raw)===state.caseBaseline.sha256,'The retained original case baseline changed.');baselineMemo=JSON.parse(raw);}
  return baselineMemo;
}
async function importOriginalCase(){
  if(!config.originalCase)return;
  const source=config.originalCase;
  need(isAbsolute(source.path)&&Number.isSafeInteger(source.bytes)&&/^[a-f0-9]{64}$/.test(source.sha256),
    'Use the complete original case archive and its recorded identity.');
  const raw=await readFile(source.path);
  need(raw.length===source.bytes&&sha(raw)===source.sha256,'The complete original case archive differs.');
  if(!state.originalCaseRequestId){state.originalCaseRequestId='buyer-original-case-'+randomUUID();await save();}
  const result=await grantCLI(workspace,['operations','import','--file',source.path,'--name',config.caseName,
    '--actor',config.actor,'--request-id',state.originalCaseRequestId,
    '--note','Receive the complete original operating case and continue its existing Routescan purchase.']);
  need(!state.caseId||state.caseId===result.id,'The original case import returned another receiving identity.');
  state.caseId=result.id;state.originalCaseImport={result,source:{path:source.path,bytes:source.bytes,sha256:source.sha256,
    caseId:source.caseId,version:source.version,planId:source.planId}};await save();
}
async function retainOriginalCase(){
  if(!config.originalCase||state.caseBaseline)return;
  const current=await api('/api/operations/'+state.caseId),source=config.originalCase;
  need(current.program.version===source.version&&current.program.origin.programId===source.caseId&&
    current.program.origin.planId===source.planId&&current.program.origin.archiveSha256===source.sha256,
    'The imported case differs from its complete original lineage.');
  for(const[k,n]of Object.entries(source.counts??{})){
    const rows=current.records[k]??current[k];need(Array.isArray(rows)&&rows.length===n,'The original '+k+' population differs.');
  }
  for(const item of source.selections??[]){
    const purchase=selectedPurchase(current,item.intentId);
    need(purchase.id===item.purchaseId,'The original purchase selection differs.');
  }
  const history=await api('/api/operations/'+state.caseId+'/history?after=0&limit=200');
  need(history.nextAfter===null&&history.events.length===source.version,'Retain the complete original case history before receiving.');
  const baseline={...current,originalEvents:history.events};
  state.caseBaseline=await atomic(join(work,'original-case-baseline.json'),baseline);baselineMemo=baseline;await save();
  await stage('original-case-received',{originalCaseId:source.caseId,caseId:state.caseId,version:source.version,
    purchases:current.records.purchases.length,deployments:current.records.deployments.length,
    forecasts:current.forecasts.length,portfolios:current.portfolios.length,sources:current.sources.length});
}
async function checkOriginalCase(current,withHistory=false){
  const baseline=await originalBaseline();if(!baseline)return null;
  const selected=new Set((config.originalCase.selections??[]).map(row=>row.purchaseId));
  const deployments=new Set(baseline.records.purchases.filter(row=>selected.has(row.id)).map(row=>row.deploymentId));
  let unchangedPurchases=0,unchangedDeployments=0;
  for(const[kind,rows]of Object.entries(baseline.records)){
    need(current.records[kind]?.length===rows.length,'The original '+kind+' population changed.');
    for(const prior of rows){
      const now=current.records[kind].find(row=>row.id===prior.id);need(now,'An original '+kind+' identity is missing.');
      if(kind==='purchases'&&selected.has(prior.id)){
        need(now.deploymentId===prior.deploymentId&&now.orderStatus===prior.orderStatus,
          'The original deployment or independently recorded order status changed.');
      }else if(kind==='deployments'&&deployments.has(prior.id)){
        const mutable=new Set(['version','updatedAt','recordedBy','sourceIds']);
        for(const[key,value]of Object.entries(prior))if(!mutable.has(key))
          need(canonical(now[key])===canonical(value),'The selected original deployment field changed: '+key);
        need((prior.sourceIds??[]).every(id=>(now.sourceIds??[]).includes(id)),'An earlier deployment source was lost.');
      }else{
        need(canonical(now)===canonical(prior),'An unselected original '+kind+' record changed.');
        if(kind==='purchases')unchangedPurchases++;if(kind==='deployments')unchangedDeployments++;
      }
    }
  }
  for(const key of ['forecasts','portfolios','completionPlans'])
    need(canonical(current[key])===canonical(baseline[key]),'The original '+key+' changed.');
  const cohortRequest=config.cohortReceiving?await requestForPhase('cohort-freeze'):null;
  const allowedReviewId=cohortRequest?.body?.action==='cohort.prepare'?cohortRequest.result?.recordId:null;
  for(const prior of baseline.reviews)
    need(canonical(current.reviews.find(row=>row.id===prior.id))===canonical(prior),'An original frozen review changed.');
  need(current.reviews.every(row=>baseline.reviews.some(prior=>prior.id===row.id)||
    row.id===allowedReviewId&&row.purpose==='COHORT_EVALUATION'),'An unselected original review was added or lost.');
  for(const prior of baseline.sources)
    need(canonical(current.sources.find(row=>row.id===prior.id))===canonical(prior),'An original source metadata record changed.');
  for(const key of ['mode','state','calendarStart','planRevision','createdAt'])
    need(canonical(current.program[key])===canonical(baseline.program[key]),'The original case '+key+' changed.');
  for(const key of ['scenario','planning','contentSha256'])
    need(canonical(current.plan[key])===canonical(baseline.plan[key]),'The pinned original plan '+key+' changed.');
  if(withHistory){
    const history=await api('/api/operations/'+current.program.id+'/history?after=0&limit=200');
    need(canonical(history.events.slice(0,baseline.originalEvents.length))===canonical(baseline.originalEvents),
      'The original case history prefix changed.');
  }
  return {originalCaseId:config.originalCase.caseId,originalVersion:config.originalCase.version,
    unchangedPurchases,unchangedDeployments,forecasts:baseline.forecasts.length,portfolios:baseline.portfolios.length,
    originalSources:baseline.sources.length,originalHistoryVersions:baseline.originalEvents.length,
    selectedOrders:baseline.records.purchases.filter(row=>selected.has(row.id)).map(row=>({purchaseId:row.id,orderStatus:row.orderStatus}))};
}
async function stage(name,detail={}){state.stages.push({name,at:new Date().toISOString(),...detail});await save();process.stdout.write(JSON.stringify({stage:name,...detail})+'\n');}
async function command(executable,args,options={}){
  const max=options.limit??16*1024*1024,timeout=options.timeout??120000;
  return new Promise((resolveCommand,reject)=>{
    const child=spawn(executable,args,{cwd:options.cwd??repo,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',...options.env},stdio:['ignore','pipe','pipe']});
    const out=[],err=[];let total=0,failed=false;
    const timer=setTimeout(()=>{failed=true;child.kill('SIGTERM');},timeout);
    for(const [stream,parts]of [[child.stdout,out],[child.stderr,err]])stream.on('data',chunk=>{
      total+=chunk.length;if(total>max){failed=true;child.kill('SIGTERM');}else parts.push(chunk);
    });
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',(code,signal)=>{
      clearTimeout(timer);const stdout=Buffer.concat(out).toString('utf8'),stderr=Buffer.concat(err).toString('utf8');
      if(code!==0||signal||failed){const error=new Error('Original command failed: '+args[0]+'; '+(stderr||stdout).slice(-6000));
        error.code='ORIGINAL_COMMAND_FAILED';error.result={code,signal,stdout,stderr};reject(error);}
      else resolveCommand({stdout,stderr,code});
    });
  });
}
async function grantCLI(target,args){const r=await command(python,['-B',join(grant,'cli.py'),...args.slice(0,1),'--workspace',target,...args.slice(1)]);
  return JSON.parse(r.stdout);}
async function fileIdentity(path){
  const before=await lstat(path,{bigint:true});
  if(before.isSymbolicLink())return {type:'symlink',target:await readlink(path)};
  need(before.isFile(),'Only original files and directories are supported in the preserved set.');
  const h=await open(path,'r'),hash=createHash('sha256');let bytes=0;
  try{const buffer=Buffer.alloc(131072);while(true){const r=await h.read(buffer,0,buffer.length,null);if(!r.bytesRead)break;bytes+=r.bytesRead;hash.update(buffer.subarray(0,r.bytesRead));}
    const after=await h.stat({bigint:true});need(['dev','ino','size','mtimeNs','ctimeNs'].every(k=>before[k]===after[k]),'Original file changed during its read.');
  }finally{await h.close();}
  return {type:'file',bytes,sha256:hash.digest('hex'),dev:String(before.dev),ino:String(before.ino),mtimeNs:String(before.mtimeNs),ctimeNs:String(before.ctimeNs)};
}
async function preserveInventory(){
  const result={};
  async function walk(path,label){
    const st=await lstat(path);
    if(st.isDirectory()){for(const name of (await readdir(path)).sort())await walk(join(path,name),label+'/'+name);}
    else result[label]=await fileIdentity(path);
  }
  for(let i=0;i<(config.preservedPaths??[config.inboxDirectory]).length;i++){
    const path=config.preservedPaths?.[i]??config.inboxDirectory;await walk(path,String(i)+':'+path);
  }
  return result;
}
async function preserveCheck(){
  const current=await preserveInventory();need(canonical(current)===canonical(state.originalFiles),'The preserved original buyer files changed.');
  return {files:Object.keys(current).length,sha256:sha(canonical(current))};
}
async function checkPurchases(current,expectedFileSha,checkOutput=true){
  const files=current.sources.filter(x=>x.buyerHandoff?.sourceSha256===expectedFileSha);
  need(files.length===1,'The original buyer source was not retained exactly once.');
  const baseline=await originalBaseline();
  need(current.records.purchases.length===(baseline?.records.purchases.length??config.intentIds.length),
    'The receiving case contains an unexpected purchase population.');
  for(const expected of config.expected??[]){
    const purchase=selectedPurchase(current,expected.intentId);
    need(purchase,'Original intent is absent from the receiving case.');
    for(const [key,value]of Object.entries(expected.purchase??{})){
      if(!checkOutput&&['outputStatus','deliveredBytes','deliveredSha256'].includes(key))continue;
      need(canonical(purchase[key])===canonical(value),'Received original '+key+' differs.');
    }
  }
  if(baseline)await checkOriginalCase(current);
  else{
    need(current.records.cash.length===0,'This receiving flow unexpectedly created a cash record.');
    need(current.records.deployments.length===1,'The accountable deployment was duplicated.');
  }
  return files[0];
}
let server=null,browser=null,context=null,page=null,origin=null,token=null;
async function stopServer(){
  if(!server)return;const child=server;server=null;
  if(child.exitCode!==null||child.signalCode!==null)return;
  await new Promise(resolveStop=>{const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
    child.once('close',()=>{clearTimeout(timer);resolveStop();});child.kill('SIGTERM');});
}
async function startServer(directory){
  await stopServer();const child=spawn(python,['-B',join(grant,'cli.py'),'serve','--workspace',directory,'--port','0'],
    {cwd:grant,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',SF47_BUYER_NODE:node},stdio:['ignore','pipe','pipe']});
  server=child;const errors=[];child.stderr.on('data',b=>{if(errors.reduce((n,x)=>n+x.length,0)<131072)errors.push(b);});
  const launch=await new Promise((resolveLaunch,reject)=>{
    let pending='';const timer=setTimeout(()=>reject(new Error('Original workspace did not announce its address.')),30000);
    child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',(code,signal)=>{clearTimeout(timer);reject(new Error('Original workspace exited before opening: '+code+'/'+signal+' '+Buffer.concat(errors).toString('utf8')));});
    child.stdout.on('data',chunk=>{pending+=chunk.toString('utf8');const lines=pending.split('\n');pending=lines.pop();
      for(const line of lines){try{const value=JSON.parse(line);if(value.url&&value.access_file){clearTimeout(timer);resolveLaunch(value);}}catch{}}
    });
  });
  origin=launch.url;const html=await readFile(launch.access_file,'utf8'),match=/href="([^"]+#access=[^"]+)"/.exec(html);
  need(match,'Original private access link is missing.');const href=match[1].replaceAll('&amp;','&');
  token=new URL(href).hash.slice('#access='.length);return href;
}
async function api(path,body){
  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,
    ...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error?.message||'Original API rejected the request.'),{status:response.status,code:value.error?.code});
  return value;
}
async function persistRequest(path,body){
  if(!body?.requestId)return;
  const key=sha(body.requestId),file=join(work,'requests',key+'.json'),existing=await optionalJSON(file);
  const request={id:body.requestId,path,body};
  need(!existing||canonical(existing)===canonical(request),'One original request ID was reused with different fields.');
  if(!existing)await atomic(file,request);
  if(!state.requests.includes(key)){state.requests.push(key);await save();}
  if(state.activePhase){state.phaseRequests??={};const prior=state.phaseRequests[state.activePhase];
    need(!prior||prior===key,'The original phase already has a different retained request.');
    state.phaseRequests[state.activePhase]=key;await save();}
  if(context)await context.storageState({path:join(work,'browser-state.json')});
}
async function settleRequest(key){
  const file=join(work,'requests',key+'.json'),responseFile=join(work,'requests',key+'.result.json');
  let saved=await optionalJSON(responseFile);const request=await optionalJSON(file);
  if(!saved){const result=await api(request.path,request.body);saved={result};await atomic(responseFile,saved);}
  if(request.path==='/api/operations'){state.caseId=saved.result.id;await save();}
  if(request.body.action==='buyer.receive'){state.lastReceiving=saved.result;await save();}
  return saved.result;
}
async function requestForPhase(name) {
  const key=state.phaseRequests?.[name];if(!key)return null;
  const request=await optionalJSON(join(work,'requests',key+'.json')),saved=await optionalJSON(join(work,'requests',key+'.result.json'));
  need(request,'The retained phase lost its original request.');
  return {...request,result:saved?.result??null};
}
async function recoverOriginalRequests(){
  for(const key of state.requests)await settleRequest(key);
  if(state.activePhase&&state.phaseRequests?.[state.activePhase]){state.activePhase=null;await save();}
}
async function screenshot(name){
  const path=join(work,'captures',name+'.png');await page.screenshot({path,fullPage:true});
  const raw=await readFile(path),row={name,path,bytes:raw.length,sha256:sha(raw)};
  state.captures=state.captures.filter(x=>x.name!==name).concat([row]);await save();return row;
}
async function openOperations(href,caseId){
  await page.goto(href,{waitUntil:'domcontentloaded'});
  await page.locator('[data-tab="operations"]').waitFor({state:'visible'});
  await page.locator('[data-tab="operations"]').click();
  await page.locator('[name="recordingActor"]').waitFor({state:'visible'});
  await page.locator('[name="recordingActor"]').fill(config.actor);
  if(caseId){await page.locator('[name="caseSelect"]').selectOption(caseId);}
}
async function openBuyer(){await page.locator('[data-ops-tab="buyer"]').click();await page.locator('.buyer-receiving').waitFor({state:'visible'});}
async function waitPost(path,action){
  const response=await page.waitForResponse(r=>new URL(r.url()).pathname===path&&r.request().method()==='POST'&&
    (!action||r.request().postDataJSON()?.action===action),{timeout:60000});
  const body=response.request().postDataJSON(),result=await response.json();
  need(response.ok(),'Original operator action failed: '+JSON.stringify(result));
  await atomic(join(work,'requests',sha(body.requestId)+'.result.json'),{result});
  if(path==='/api/operations')state.caseId=result.id;
  if(action==='buyer.receive')state.lastReceiving=result;
  await save();return result;
}
async function saveBrowserRequest(click,path,action){const waiting=waitPost(path,action);waiting.catch(()=>{});await click();return waiting;}
async function phaseRequest(name,click,path,action){
  if(state.phaseRequests?.[name]){
    const result=await settleRequest(state.phaseRequests[name]);
    if(state.activePhase===name){state.activePhase=null;await save();}
    return result;
  }
  state.activePhase=name;await save();
  const result=await saveBrowserRequest(click,path,action);state.activePhase=null;await save();return result;
}
async function receiveSource(current){
  await openBuyer();
  await page.locator('[data-buyer-file]').setInputFiles(handoff);
  await page.locator('[data-buyer-form]').waitFor({state:'visible',timeout:60000});
  if(config.originalCase){
    await page.locator('[name="deploymentId"]').selectOption(selectedDeployment(current).id);
    for(const row of state.nativeReport.rows){
      await page.locator('[data-buyer-job="'+row.jobId+'"]').check();
      await page.locator('[data-buyer-purchase="'+row.jobId+'"]').selectOption(selectedPurchase(current,row.intentId).id);
    }
  }else{
    await page.locator('[name="deploymentId"]').selectOption('__new__');
    for(const [key,value]of Object.entries(config.deployment)){
      const field=page.locator('.buyer-receiving [name="'+key+'"]');if(!await field.count())continue;
      const tag=await field.evaluate(el=>el.tagName);
      if(tag==='SELECT')await field.selectOption(value===null?'':Array.isArray(value)?value:String(value));
      else await field.fill(value===null?'':String(value));
    }
    for(const row of state.nativeReport.rows)await page.locator('[data-buyer-job="'+row.jobId+'"]').check();
  }
  await page.locator('.buyer-receiving [name="note"]').fill(config.receivingNote);
  await screenshot('01-native-source-review-desktop');
  const receipt=await saveBrowserRequest(()=>page.locator('[data-buyer-send]').click(),
    '/api/operations/'+state.caseId+'/command','buyer.receive');
  await page.locator('[data-buyer-action="open-source"]').first().waitFor({state:'visible',timeout:60000});
  return receipt;
}
async function captureObservation(inbox,label,maximum){
  const path=join(work,label+'.json');let found=true;
  try{await lstat(path);}catch(error){if(error.code==='ENOENT')found=false;else throw error;}
  if(!found){
    state.captureAttempts??={};
    need(!state.captureAttempts[label],'The original capture attempt has no retained file. Resolve that original publication before another capture.');
    state.captureAttempts[label]={path,intentIds:config.intentIds,maxVerifyBytes:maximum??null,attemptedAt:new Date().toISOString()};await save();
    await inbox.exportOperations(path,{intentIds:config.intentIds,...(maximum===undefined?{}:{maxVerifyBytes:maximum})});
  }
  const result=await inbox.inspectOperations(path),report=result.native.report;
  need(report.rows.length===config.intentIds.length&&report.rows.every(row=>row.canReceive),'The retained observation requires source review.');
  const metadata={path,sourceSha256:report.source.sha256,bytes:report.source.bytes,report};
  await atomic(join(work,label+'-review.json'),metadata);return metadata;
}
async function observeExisting(current,observation,note,phase){
  if(state.phaseRequests?.[phase])return phaseRequest(phase,()=>{throw new Error('Continue the original phase request.');},'/api/operations/'+state.caseId+'/command','buyer.receive');
  await openBuyer();
  await page.locator('[data-buyer-file]').setInputFiles(observation.path);
  await page.locator('[data-buyer-form]').waitFor({state:'visible',timeout:60000});
  await page.locator('[name="deploymentId"]').selectOption(selectedDeployment(current).id);
  for(const row of observation.report.rows){
    await page.locator('[data-buyer-job="'+row.jobId+'"]').check();
    await page.locator('[data-buyer-purchase="'+row.jobId+'"]').selectOption(selectedPurchase(current,row.intentId).id);
  }
  await page.locator('.buyer-receiving [name="note"]').fill(note);
  return phaseRequest(phase,()=>page.locator('[data-buyer-send]').click(),
    '/api/operations/'+state.caseId+'/command','buyer.receive');
}
async function preserveLatestObservation(inbox){
  if(state.observationSequenceComplete)return;
  if(!state.boundedReceived){
    const bounded=await captureObservation(inbox,'bounded-output-observation',0);
    need(bounded.report.rows.every(row=>row.output.state==='OVER_LIMIT'&&row.purchase.outputStatus!=='COMPLETE'),
      'The explicit zero-byte limit did not retain the actual output-verification boundary.');
    let current=await api('/api/operations/'+state.caseId);
    if(!current.sources.some(row=>row.buyerHandoff?.sourceSha256===bounded.sourceSha256))
      await observeExisting(current,bounded,'Observe the original Inbox with an explicit zero-byte verification limit. Its existing response remains untouched.','bounded-observation');
    current=await api('/api/operations/'+state.caseId);
    await checkPurchases(current,bounded.sourceSha256,false);
    for(const row of bounded.report.rows){
      const purchase=selectedPurchase(current,row.intentId);
      need(purchase.outputStatus===row.purchase.outputStatus&&purchase.observedAt===row.purchase.observedAt,
        'The bounded native output observation was not retained on its original purchase.');
    }
    state.boundedReceived={sourceSha256:bounded.sourceSha256,path:bounded.path,version:current.program.version,
      purchases:current.records.purchases};await save();
    await stage('bounded-native-output-observed',{sourceSha256:bounded.sourceSha256,version:current.program.version});
  }
  if(!state.reopenedSameSource){
    let current=await api('/api/operations/'+state.caseId);
    const repeated=await observeExisting(current,{path:handoff,report:state.nativeReport},
      'Reopen the older exact source association while retaining the later original output observation.','historical-source-replay');
    current=await api('/api/operations/'+state.caseId);
    need(repeated.unchanged===true&&repeated.version===state.boundedReceived.version&&
      canonical(current.records.purchases)===canonical(state.boundedReceived.purchases),
      'The historical source replay changed the later purchase observation or its time.');
    state.reopenedSameSource=repeated;await save();
    await stage('historical-source-kept-current-purchase',{version:current.program.version,unchanged:true});
  }
  if(!state.currentVerifiedReceived){
    const verified=await captureObservation(inbox,'current-verified-output-observation');
    need(verified.report.rows.every(row=>row.output.state==='VERIFIED'&&row.purchase.outputStatus==='COMPLETE'),
      'The current original response did not verify.');
    let current=await api('/api/operations/'+state.caseId);
    if(!current.sources.some(row=>row.buyerHandoff?.sourceSha256===verified.sourceSha256))
      await observeExisting(current,verified,'Record a fresh verification of the unchanged original saved response after the bounded review.','current-verified-observation');
    current=await api('/api/operations/'+state.caseId);
    await checkPurchases(current,verified.sourceSha256);
    state.currentVerifiedReceived={sourceSha256:verified.sourceSha256,path:verified.path,version:current.program.version};await save();
    await stage('original-output-currently-verified',{sourceSha256:verified.sourceSha256,version:current.program.version});
  }
  state.observationSequenceComplete=true;await save();
}
async function inspectThroughSDK(){
  const script='import json,sys\nfrom stellar_forge_buyer import Inbox\nbox=Inbox(checkout=sys.argv[1],directory=sys.argv[2],node=sys.argv[3])\nresult=box.inspect_operations(sys.argv[4])\nprint(json.dumps({"native":result.native,"process":result.process},sort_keys=True))\n';
  const r=await command(python,['-B','-c',script,repo,config.inboxDirectory,node,handoff],
    {env:{PYTHONPATH:join(sf88,'python')},limit:20*1024*1024});
  const value=JSON.parse(r.stdout);
  need(value.native.sha256===state.nativeReport.source.sha256&&value.native.noExecution===true,
    'Python saved-file reader returned a different source.');
  await atomic(join(work,'python-inspection.json'),value);
  const q=await command(node,[join(sf88,'queue-cli.mjs'),'operations','inspect','--file',handoff]);
  const cli=JSON.parse(q.stdout);
  need(cli.report.source.sha256===state.nativeReport.source.sha256,'Maintained CLI inspection returned a different source.');
  await atomic(join(work,'queue-cli-inspection.json'),cli);
  return {pythonSourceSha256:value.native.sha256,queueSourceSha256:cli.report.source.sha256};
}
try{
  if(!state.originalFiles){state.originalFiles=await preserveInventory();await save();}
  await preserveCheck();
  const {Buyer}=await import(pathToFileURL(join(sf88,'node/client.mjs')).href);
  const buyer=new Buyer({runtimeDirectory:sf88,stateDirectory:join(work,'node-customer-state'),node,timeoutMs:180000});
  const inbox=buyer.inbox(config.inboxDirectory);
  let exists=true;try{await lstat(handoff);}catch(e){if(e.code==='ENOENT')exists=false;else throw e;}
  if(!exists){
    need(!state.originalCaptureAttempt&&!state.nodeExport,'The original captured handoff is unavailable after its retained attempt. Resolve that exact file without recapturing.');
    state.originalCaptureAttempt={path:handoff,intentIds:config.intentIds,attemptedAt:new Date().toISOString()};await save();
    const exported=await inbox.exportOperations(handoff,{intentIds:config.intentIds});state.nodeExport=exported.native;await save();
  }
  const inspected=await inbox.inspectOperations(handoff);
  state.nativeReport=inspected.native.report;
  need(state.nativeReport.rows.length===config.intentIds.length&&state.nativeReport.rows.every(x=>x.canReceive),
    'Review the original native source findings before receiving.');
  for(const expected of config.expected??[]){
    const row=state.nativeReport.rows.find(x=>x.intentId===expected.intentId);need(row,'Selected original intent is absent.');
    for(const [key,value]of Object.entries(expected.purchase??{}))
      need(canonical(row.purchase[key])===canonical(value),'Native original '+key+' differs.');
  }
  await atomic(join(work,'native-source-review.json'),state.nativeReport);
  await stage('original-native-source-captured',{sourceSha256:state.nativeReport.source.sha256,jobs:state.nativeReport.rows.length});
  const joined=await inspectThroughSDK();await stage('node-python-cli-same-source',joined);
  await grantCLI(workspace,['init']);
  await importOriginalCase();
  const href=await startServer(workspace);
  await retainOriginalCase();
  const {chromium}=await import(pathToFileURL(config.playwrightModule).href);
  browser=await chromium.launch({executablePath:config.browserExecutable,headless:true,args:['--disable-dev-shm-usage'],
    env:{...process.env,TMPDIR:join(work,'browser-tmp')}});
  const oldStorage=await optionalJSON(join(work,'browser-state.json'));
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,...(oldStorage?{storageState:oldStorage}:{})});
  page=await context.newPage();const browserErrors=[];page.on('pageerror',e=>browserErrors.push(String(e)));
  await page.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(!['http:','https:'].includes(u.protocol)){await route.continue();return;}
    if(u.origin!==origin){await route.abort();throw new Error('The original local receiving page attempted an external request.');}
    if(route.request().method()==='POST'&&u.pathname.startsWith('/api/operations')){
      const body=route.request().postDataJSON();await persistRequest(u.pathname,body);
    }
    await route.continue();
  });
  await recoverOriginalRequests();
  const cases=(await api('/api/operations')).cases;
  if(!state.caseId){
    const matches=cases.filter(x=>x.name===config.caseName);need(matches.length<=1,'More than one retained case matches this continuation.');
    if(matches.length)state.caseId=matches[0].id;
  }
  await openOperations(href,state.caseId);
  if(!state.caseId){
    await page.locator('[data-ops-action="new-case"]').click();
    await page.locator('[data-ops-form] [name="name"]').fill(config.caseName);
    await page.locator('[data-ops-form] [name="mode"]').selectOption('OPERATIONS');
    await page.locator('[data-ops-form] [name="calendarStart"]').fill('');
    await saveBrowserRequest(()=>page.locator('[data-ops-form] button[type="submit"]').click(),'/api/operations');
  }
  await save();
  let current=await api('/api/operations/'+state.caseId);
  if(!current.sources.some(x=>x.buyerHandoff?.sourceSha256===state.nativeReport.source.sha256))
    await receiveSource(current);
  else await openBuyer();
  current=await api('/api/operations/'+state.caseId);
  const originalSource=await checkPurchases(current,state.nativeReport.source.sha256,false);
  await atomic(join(work,'received-original-case.json'),current);
  await screenshot('02-received-original-source-desktop');
  await page.setViewportSize({width:390,height:844});
  await screenshot('03-received-original-source-mobile');
  await page.setViewportSize({width:1440,height:1000});
  await preserveLatestObservation(inbox);
  current=await api('/api/operations/'+state.caseId);
  await checkPurchases(current,state.nativeReport.source.sha256);
  if(config.cohortReceiving) {
    need(config.originalCase,'The cohort continuation requires the supplied complete original operating case.');
    const helper=join(grant,'cohort-operations-receiving.mjs'),raw=await readFile(helper);
    need(createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex')==='6e6b008dc603ea8affe376eb28000d35ef5ab923',
      'Use the exact complete cohort continuation source.');
    cohortModule=await import(pathToFileURL(helper).href);
    await cohortModule.receiveCohortWithOperations({page,api,phaseRequest,requestForPhase,screenshot,atomic,state,save,
      workDirectory:work,caseId:state.caseId,actor:config.actor,sourceId:originalSource.id,
      purchaseId:selectedPurchase(current,config.intentIds[0]).id,expectedPurchase:config.expected[0].purchase});
    current=await api('/api/operations/'+state.caseId);
    await stage('original-cohort-review-frozen',{reviewId:state.cohortReceiving.reviewId,version:current.program.version,
      independentCompletions:0,awardClockEstablished:false});
  }
  const originalCasePreservation=await checkOriginalCase(current,true);
  if(config.agentReceiving){
    need(config.intentIds.length===1,'The joined agent phase requires one explicitly selected original purchase.');
    const helperPath=join(grant,'buyer-agent-receiving.mjs'),helperBytes=await readFile(helperPath);
    const helperGitBlob=createHash('sha1').update('blob '+helperBytes.length+'\0').update(helperBytes).digest('hex');
    need(helperGitBlob==='0f1fdf851383f328538beddf353393c983228e03','Use the exact original agent receiving phase.');
    need(isAbsolute(python)&&isAbsolute(node),'The original managed agent requires absolute Python and Node executable paths.');
    const purchase=selectedPurchase(current,config.intentIds[0]),deployment=selectedDeployment(current);
    const phaseInput={schema:'sf47.native-buyer-agent-phase.v1',operationId:config.agentReceiving.operationId,
      sourceRoot:repo,sourceHead,workspaceDirectory:workspace,outputDirectory:join(work,'agent-receiving'),
      caseId:state.caseId,originalHandoffPath:handoff,sourceSha256:state.nativeReport.source.sha256,
      purchaseId:purchase.id,deploymentId:deployment.id,actor:config.actor,nodeExecutable:node,pythonExecutable:python,
      ...(state.cohortReceiving?{cohort:state.cohortReceiving.agent}:{})};
    await context.storageState({path:join(work,'browser-state.json')});
    await page.goto('about:blank');
    await stopServer();
    const {receiveBuyerWithAgent}=await import(pathToFileURL(helperPath).href);
    const result=await receiveBuyerWithAgent(phaseInput);
    need(result.complete===true&&result.allOwnedServicesClosed===true&&result.toolCount===58&&
      result.caseId===state.caseId&&result.purchaseId===purchase.id&&result.deploymentId===deployment.id&&
      result.originalSourceSha256===state.nativeReport.source.sha256,
      'Complete the same original agent receiving phase and drain its managed service before continuing.');
    state.agentReceiving=result;await save();
    await stage('original-agent-receiving-complete',{caseId:result.caseId,version:result.caseVersion,
      sourceSha256:result.originalSourceSha256,requestId:result.requestId,toolCount:result.toolCount});
    const receivingHref=await startServer(workspace);
    await openOperations(receivingHref,state.caseId);await openBuyer();
    current=await api('/api/operations/'+state.caseId);
    need(current.program.version===result.caseVersion,'The original agent and browser reopened different case versions.');
    await checkPurchases(current,state.nativeReport.source.sha256);await checkOriginalCase(current,true);
  }
  await page.locator('[data-ops-tab="delivery"]').click();
  await screenshot('04-original-purchase-accounting');
  const exportPath=join(work,'Native_Buyer_Operations_Complete_Workspace.zip');
  if(!state.export){
    const downloadWait=page.waitForEvent('download',{timeout:60000});
    await page.locator('[data-ops-action="export"]').click();
    const download=await downloadWait;await download.saveAs(exportPath);
    const raw=await readFile(exportPath);state.export={path:exportPath,bytes:raw.length,sha256:sha(raw),caseId:state.caseId,version:current.program.version};await save();
  }
  need(sha(await readFile(state.export.path))===state.export.sha256,'Original complete-case export changed.');
  await context.storageState({path:join(work,'browser-state.json')});
  await stopServer();
  if(cohortModule){
    state.cohortCLI=await cohortModule.inspectCohortWithCLI({grantCLI,workspaceDirectory:workspace,state,save,atomic,workDirectory:work});
    await save();
  }
  if(!state.importRequestId){state.importRequestId='buyer-operations-receive-'+randomUUID();await save();}
  await grantCLI(restored,['init']);
  const imported=await grantCLI(restored,['operations','import','--file',state.export.path,'--name',config.caseName+' / received',
    '--actor',config.actor,'--request-id',state.importRequestId,'--note','Reopen the complete native buyer case with its original source and history.']);
  state.imported=imported;await save();
  const restoredHref=await startServer(restored);
  await openOperations(restoredHref,imported.id);
  await openBuyer();await page.locator('[data-buyer-action="open-source"]').first().waitFor({state:'visible',timeout:60000});
  const received=await api('/api/operations/'+imported.id);
  const retained=await checkPurchases(received,state.nativeReport.source.sha256);
  need(canonical(received.records.purchases)===canonical(current.records.purchases),'Imported purchase identities or values differ.');
  need(canonical(received.records.deployments)===canonical(current.records.deployments),'Imported deployment identities differ.');
  const reopenedCasePreservation=await checkOriginalCase(received,true);
  const bytes=await fetch(origin+'/api/operations/'+imported.id+'/sources/'+retained.id,{headers:{authorization:'Bearer '+token}}).then(r=>r.arrayBuffer());
  need(sha(Buffer.from(bytes))===state.nativeReport.source.sha256,'The reopened original handoff bytes differ.');
  await page.locator('[data-buyer-action="open-source"][data-source="'+retained.id+'"]').click();
  await page.locator('[data-buyer-form]').waitFor({state:'visible',timeout:60000});
  await screenshot('05-reopened-complete-case-source');
  await atomic(join(work,'reopened-original-case.json'),received);
  if(cohortModule){
    state.reopenedCohort=await cohortModule.reopenCohortWithOperations({page,api,screenshot,restoredCaseId:imported.id,state,save,atomic,workDirectory:work});
    await save();
  }
  const preserved=await preserveCheck();
  need(browserErrors.length===0,'The original browser returned a page error: '+browserErrors.join('; '));
  state.completedAt=new Date().toISOString();state.result={schema:'sf47.native-buyer-receiving-result.v1',completedAt:state.completedAt,
    sourceHead,sourceSha256:state.nativeReport.source.sha256,sourceBytes:state.nativeReport.source.bytes,
    agentReceiving:state.agentReceiving??null,cohortReceiving:state.cohortReceiving??null,cohortCLI:state.cohortCLI??null,reopenedCohort:state.reopenedCohort??null,
    nodeExport:state.nodeExport??null,sdkInspection:joined,caseId:state.caseId,caseVersion:current.program.version,
    importedCaseId:imported.id,purchaseIds:current.records.purchases.map(p=>p.id),
    originalPurchaseFields:current.records.purchases.map(({id,intentId,network,asset,transactionHash,ledger,amountStroops,
      settlementStatus,outputStatus,deliveredBytes,deliveredSha256,participantClass})=>({id,intentId,network,asset,transactionHash,ledger,
      amountStroops,settlementStatus,outputStatus,deliveredBytes,deliveredSha256,participantClass})),
    sameSourceReopen:state.reopenedSameSource,boundedObservation:state.boundedReceived,currentVerifiedObservation:state.currentVerifiedReceived,
    retainedBuyerSourceCount:current.sources.filter(value=>value.buyerHandoff).length,originalSourceId:originalSource.id,importedOriginalSourceId:retained.id,
    bundle:state.export,originalCaseImport:state.originalCaseImport??null,originalCasePreservation,reopenedCasePreservation,
    preservedBuyerFiles:preserved,captures:state.captures,
    purchaseCalls:0,upstreamProviderCalls:0,buyerRecoveryCalls:0,finalizationCalls:0};
  await atomic(join(work,'result.json'),state.result);await stage('complete-native-buyer-receiving',{caseId:state.caseId,importedCaseId:imported.id,sourceSha256:state.nativeReport.source.sha256});
}catch(error){
  state.lastFailure={at:new Date().toISOString(),code:error.code??null,message:error.message,command:error.result??null};
  try{await save();}catch{}
  process.stderr.write(JSON.stringify({state:'RETAINED_FOR_SAME_WORKSPACE_CONTINUATION',...state.lastFailure})+'\n');process.exitCode=1;
}finally{
  if(context){try{await context.storageState({path:join(work,'browser-state.json')});}catch{}}
  if(browser){try{await browser.close();}catch{}}
  await stopServer();
  if(state.completedAt){state.allOwnedServicesClosed=true;await save();await atomic(join(work,'result.json'),{...state.result,allOwnedServicesClosed:true});}
}
