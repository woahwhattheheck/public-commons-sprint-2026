// SPDX-License-Identifier: MIT
// The original runtime/Application lifecycle over an explicitly supplied existing Report Desk.
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {openRuntimeWorkspace} from '../../distribution/runtime-workspace/model.mjs';
import {inspectRuntimeInstall} from '../../distribution/runtime-install.mjs';
import {GroundwaterReportDesk} from './desk.mjs';
import {privateAccess} from './cli.mjs';
import {REPORT_SOURCE,CORE_SOURCE,inspectReportDesk,inspectReportLaunchSource,authenticatedReportState} from './managed.mjs';
import {need,absolute,directory,exists,put,readJSON,sha,canonical,checkFile,core,fields,ident} from './common.mjs';

const INPUT='stellar-forge.groundwater-report-managed-receiving.v1';
const uuidFor=value=>{const h=sha(value);return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);};
const pause=signal=>new Promise((done,reject)=>{
  if(signal?.aborted){reject(signal.reason??new Error('Stopped'));return;}
  const abort=()=>{clearTimeout(timer);reject(signal.reason??new Error('Stopped'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);done();},500);
  signal?.addEventListener('abort',abort,{once:true});
});
export async function runManagedReportReceiving(input,{signal}={}){
  fields(input,['schema','operationId','actor','runtimeWorkspaceDirectory','runtimeDirectory','expectedSourceCommit','deskDirectory','expectedDeskId','python','outputDirectory','originalOperationIds','expectedLaunchSourceSha256','scientificWorkspace','operationsUrlFile','facilitator','allowLocalFacilitator','environmentFile','port','label','waitMilliseconds','browser'],'managed receiving input');
  need(input?.schema===INPUT&&typeof input.operationId==='string'&&input.operationId.length<=100&&input.operationId.trim(),
    'REPORT_MANAGED_RECEIVING_INPUT','Select the complete original managed receiving input.');
  ident(input.operationId,'managed receiving operation ID');
  need(/^[a-f0-9]{40}$/.test(input.expectedSourceCommit??''),'REPORT_MANAGED_SOURCE','Select the complete original source commit.');
  need(input.waitMilliseconds===undefined||Number.isSafeInteger(input.waitMilliseconds)&&input.waitMilliseconds>=1000&&input.waitMilliseconds<=600000,'REPORT_MANAGED_WAIT','Use a bounded receiving wait.');
  need(input.port===undefined||Number.isSafeInteger(input.port)&&input.port>=0&&input.port<=65535,'REPORT_PORT','Use the explicit original port.');
  if(input.browser){fields(input.browser,['package','executable'],'existing browser');absolute(input.browser.package);absolute(input.browser.executable);}
  for(const key of ['runtimeWorkspaceDirectory','runtimeDirectory','deskDirectory','outputDirectory','python'])absolute(input[key],key);
  need(typeof input.actor==='string'&&input.actor.trim()&&input.actor.length<=500,'REPORT_MANAGED_ACTOR','Name the actual receiving operator.');
  need(Array.isArray(input.originalOperationIds)&&input.originalOperationIds.length<=200&&
    input.originalOperationIds.every(x=>typeof x==='string')&&new Set(input.originalOperationIds).size===input.originalOperationIds.length,
    'REPORT_MANAGED_ORIGINALS','Explicitly select the retained Report Desk operations to reopen.');
  need(typeof input.expectedDeskId==='string','REPORT_MANAGED_ORIGINALS','Retain the selected original desk UUID.');
  for(const id of input.originalOperationIds)ident(id);
  need(input.outputDirectory!==input.deskDirectory&&!input.outputDirectory.startsWith(input.deskDirectory+'/'),'REPORT_MANAGED_OUTPUT','Keep complete handover files outside the original desk.');
  await directory(input.outputDirectory,{create:true});
  await put(join(input.outputDirectory,'managed-receiving-input.json'),input);
  const original=await inspectReportDesk(input.deskDirectory);
  need(original.desk.id===input.expectedDeskId,'REPORT_MANAGED_ORIGINALS','The chosen desk belongs to another original.');
  const runtime=await inspectRuntimeInstall({directory:input.runtimeDirectory,load:true,source:true,python:input.python});
  need(runtime.ready&&runtime.status==='READY'&&runtime.sourceCommit===input.expectedSourceCommit,
    'REPORT_MANAGED_RUNTIME','Use the explicitly selected READY runtime and source commit.');
  const source=await inspectReportLaunchSource(runtime.sourceRoot);
  if(input.expectedLaunchSourceSha256)need(source.sha256===input.expectedLaunchSourceSha256,'REPORT_MANAGED_RUNTIME','The direct original launch source differs.');
  const selectedApp=join(runtime.sourceRoot,CORE_SOURCE);
  const model=await openRuntimeWorkspace({directory:input.runtimeWorkspaceDirectory});
  const settings={deskDirectory:input.deskDirectory,python:input.python,port:input.port??0,
    ...(input.scientificWorkspace?{scientificWorkspace:input.scientificWorkspace}:{}),
    ...(input.operationsUrlFile?{operationsUrlFile:input.operationsUrlFile}:{}),
    ...(input.facilitator?{facilitator:input.facilitator}:{}),
    ...(input.allowLocalFacilitator?{allowLocalFacilitator:true}:{}),
    ...(input.environmentFile?{environmentFile:input.environmentFile}:{})};
  const desk=new GroundwaterReportDesk({directory:input.deskDirectory,application:selectedApp,python:input.python,
    sourceWorkspace:input.scientificWorkspace??null,
    operationsAccess:input.operationsUrlFile?await privateAccess(input.operationsUrlFile):null,signal});
  const originalsFile=join(input.outputDirectory,'selected-original-operations.json');
  let selectedOriginals;
  if(await exists(originalsFile)){
    selectedOriginals=(await readJSON(originalsFile)).value;
    need(Array.isArray(selectedOriginals)&&canonical(selectedOriginals.map(x=>x.id))===canonical(input.originalOperationIds),
      'REPORT_MANAGED_ORIGINALS','The frozen original operation selection differs.');
  }else{
    selectedOriginals=[];
    for(const id of input.originalOperationIds){
      const row=await desk.original(id);
      selectedOriginals.push({id,requestSha256:row.request.bodySha256,resultSha256:row.result?sha(canonical(row.result)):null});
    }
    await put(originalsFile,selectedOriginals);
  }
  for(const original of selectedOriginals){
    const row=await desk.original(original.id);
    need(row.request.bodySha256===original.requestSha256&&(!original.resultSha256||sha(canonical(row.result))===original.resultSha256),
      'REPORT_MANAGED_ORIGINALS','A selected original request or committed result differs.');
  }
  const phasePath=name=>join(input.outputDirectory,name+'.json');
  async function phase(name,work){
    if(await exists(phasePath(name)))return (await readJSON(phasePath(name))).value;
    const value=await work();await put(phasePath(name),value);return value;
  }
  async function current(applicationId){
    const state=await model.applicationsState({historyLimit:100});
    const app=state.applications.find(row=>row.id===applicationId);
    need(app&&app.kind==='groundwater-report-desk','REPORT_MANAGED_APPLICATION','The original saved application is unavailable.');
    return app;
  }
  async function waitFor(applicationId,predicate,label,{ignoreAbort=false}={}){
    const end=Date.now()+(input.waitMilliseconds??120000);
    while(true){
      if(!ignoreAbort&&signal?.aborted)throw signal.reason??new Error('Stopped');
      const app=await current(applicationId);
      if(predicate(app))return app;
      need(Date.now()<end,'REPORT_MANAGED_WAIT','The original '+label+' remains pending. Reopen this same saved request.');
      await pause(ignoreAbort?undefined:signal);
    }
  }
  const attachment=await phase('runtime-attachment',()=>model.attach({directory:input.runtimeDirectory,label:input.label??'Groundwater Report Desk'}));
  async function saveApplication(name,chosen){
    const review=await phase(name+'-review',()=>model.applicationsReview({runtimeId:attachment.runtimeId,providerId:'groundwater-reports',
      kind:'groundwater-report-desk',label:(input.label??'Groundwater Report Desk')+(name==='received'?' — received copy':''),settings:chosen}));
    const request={requestId:uuidFor(input.operationId+':'+name+':save'),reviewId:review.id};
    await put(phasePath(name+'-save-request'),request);
    const saved=await phase(name+'-saved',()=>model.applicationsSave(request));
    let app=await current(saved.applicationId);
    if(!app.release){await model.applicationsConnect({applicationId:saved.applicationId});
      app=await waitFor(saved.applicationId,value=>Boolean(value.release),'managed adoption');}
    need(app.settings.deskDirectory===chosen.deskDirectory&&app.runtimeId===attachment.runtimeId,
      'REPORT_MANAGED_APPLICATION','The original application selection differs.');
    return saved.applicationId;
  }
  const ownedRuns=[];
  async function stopAndWait(applicationId,operationId){
    const app=await current(applicationId),run=app.runs.find(x=>x.id===operationId);
    need(run,'REPORT_MANAGED_RUN','The original saved run is unavailable.');
    if(run.active||['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(run.phase)){
      await model.applicationsStop({applicationId,operationId});
      await waitFor(applicationId,value=>{
        const original=value.runs.find(x=>x.id===operationId);
        return original&&!original.active&&!['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(original.phase);
      },'stop and drain',{ignoreAbort:true});
    }
    const final=(await current(applicationId)).runs.find(x=>x.id===operationId);
    return {operationId,phase:final.phase,result:final.result??null,active:final.active};
  }
  async function browserObserve(url,deskId){
    if(!input.browser)return null;
    const require=createRequire(import.meta.url),playwright=require(input.browser.package);
    let browser;
    try{
      browser=await playwright.chromium.launch({headless:true,executablePath:input.browser.executable,args:['--no-sandbox']});
      const page=await browser.newPage({viewport:{width:1450,height:1000}});
      await page.goto(url,{waitUntil:'domcontentloaded'});
      await page.locator('#identity').filter({hasText:deskId}).waitFor();
      await page.getByRole('link',{name:'Operations & recovery',exact:true}).click();
      for(const id of input.originalOperationIds){
        // The stable value is the retained original operation ID; no operation is executed.
        await page.locator('[data-original="'+id.replaceAll('"','\\"')+'"]').click();
        need((await page.locator('#detail').innerText()).includes(id),'REPORT_MANAGED_BROWSER','The original operation is not visible.');
      }
      await page.getByRole('link',{name:'Complete handover',exact:true}).click();
      return {deskId,originalOperationIds:input.originalOperationIds,historyVisible:true,handoverVisible:true};
    }finally{if(browser)await browser.close();}
  }
  async function operate(applicationId,name,expectedDirectory){
    const operationId=uuidFor(input.operationId+':'+name+':run');
    ownedRuns.push({applicationId,operationId});
    const observedPath=phasePath(name+'-observed'),stoppedPath=phasePath(name+'-stopped');
    if(await exists(stoppedPath)){
      const run=(await current(applicationId)).runs.find(x=>x.id===operationId);
      need(run&&!run.active,'REPORT_MANAGED_RUN','The original completed receiving run is active or unavailable.');
      const observed=(await readJSON(observedPath)).value;
      need(observed.deskId===input.expectedDeskId&&observed.directory===expectedDirectory&&observed.operationId===operationId,
        'REPORT_MANAGED_RUN','The saved original listener observation differs.');
      return {observation:observed,stop:(await readJSON(stoppedPath)).value};
    }
    const review=await phase(name+'-start-review',()=>model.applicationsStartReview({applicationId}));
    const request={applicationId,requestId:operationId,reviewId:review.id};
    await put(phasePath(name+'-start-request'),request);
    await phase(name+'-started',()=>model.applicationsStart(request));
    let app=await current(applicationId),run=app.runs.find(x=>x.id===operationId);
    if(run&&['PENDING','QUEUED','INTERRUPTED'].includes(run.phase)&&!run.active)
      await model.applicationsRecover({applicationId,operationId});
    if(!await exists(observedPath)){
      app=await waitFor(applicationId,value=>{
        const r=value.runs.find(x=>x.id===operationId);
        need(!r||r.active||['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(r.phase),
          'REPORT_MANAGED_STOPPED_BEFORE_OBSERVATION','The original run ended before a complete live observation; preserve that run and its output.');
        return r?.active&&Boolean(r.privateUrl);
      },'native listener');
      run=app.runs.find(x=>x.id===operationId);
      const state=await authenticatedReportState(run.privateUrl,input.expectedDeskId,{signal});
      need(state.desk.id===input.expectedDeskId,'REPORT_MANAGED_ORIGINALS','The actual listener serves another desk.');
      const checked=[];
      const currentDesk=new GroundwaterReportDesk({directory:expectedDirectory,application:selectedApp,python:input.python,signal});
      for(const original of selectedOriginals){
        const row=await currentDesk.original(original.id);
        need(row.request.bodySha256===original.requestSha256&&(!original.resultSha256||sha(canonical(row.result))===original.resultSha256),
          'REPORT_MANAGED_ORIGINALS','An original request or committed result changed.');
        if(row.result&&row.request.body.action==='publish')await currentDesk.publication(original.id);
        if(row.result&&row.request.body.action==='receive')await currentDesk.receiving(original.id);
        checked.push(original.id);
      }
      const browser=await browserObserve(run.privateUrl,input.expectedDeskId);
      await put(observedPath,{applicationId,operationId,directory:expectedDirectory,deskId:input.expectedDeskId,
        sourceCommit:runtime.sourceCommit,sourceSha256:source.sha256,checkedOriginals:checked,browser,
        authenticatedNativeState:true,recordedServices:state.services??[]});
    }
    const stop=await stopAndWait(applicationId,operationId);
    await put(stoppedPath,stop);
    return {observation:(await readJSON(observedPath)).value,stop};
  }
  let browserFailure,completed;
  try{
    const applicationId=await saveApplication('original',settings);
    const first=await operate(applicationId,'first',input.deskDirectory);
    const reopened=await operate(applicationId,'reopened',input.deskDirectory);
    const exportId=input.operationId+':managed-export';
    const exported=await phase('complete-export',()=>desk.export({operationId:exportId,actor:input.actor,
      destination:join(input.outputDirectory,'Groundwater_Report_Desk.zip')}));
    // Existing completion validates its exact frozen archive; missing bytes do not trigger a new snapshot.
    const confirmed=await desk.resume(exportId);
    need(confirmed.result.archive.sha256===exported.result.archive.sha256,'REPORT_MANAGED_EXPORT','The original desk export differs.');
    const receipt=await phase('received-original',()=>desk.restore({archive:exported.result.path,destination:join(input.outputDirectory,'received-original'),
      expectedSha256:exported.result.archive.sha256,expectedBytes:exported.result.archive.bytes}));
    const received=await inspectReportDesk(receipt.directory);
    need(received.desk.id===input.expectedDeskId,'REPORT_MANAGED_RESTORE','The restored report desk has another original identity.');
    // Check exact retained archive closure even when the restore phase response was already recorded.
    const archive=await core('inspect-desk',{archive:exported.result.path},{application:selectedApp,python:input.python,signal});
    for(const row of archive.manifest.files)await checkFile(join(receipt.directory,row.path),row,16*1024*1024);
    const receivedId=await saveApplication('received',{...settings,deskDirectory:receipt.directory,port:0});
    const receiving=await operate(receivedId,'received',receipt.directory);
    completed={schema:INPUT,state:'COMPLETE',operationId:input.operationId,deskId:input.expectedDeskId,
      runtimeId:attachment.runtimeId,runtimeDirectory:input.runtimeDirectory,sourceCommit:runtime.sourceCommit,
      sourceManifestSha256:(await model.handoff(attachment.runtimeId)).sourceManifestSha256,
      launchSourceSha256:source.sha256,applicationId,receivedApplicationId:receivedId,
      first,reopened,receiving,export:exported.result,restored:receipt,originalOperations:selectedOriginals,
      noSolverDispatch:true,noBuyerPaymentDispatch:true};
  }catch(error){browserFailure=error;}
  finally{
    const errors=[];
    for(const run of ownedRuns)try{
      const app=await current(run.applicationId),original=app.runs.find(x=>x.id===run.operationId);
      if(original&&(original.active||['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(original.phase)))
        await stopAndWait(run.applicationId,run.operationId);
    }catch(error){errors.push(error);}
    await model.close();
    if(errors.length)throw new AggregateError([...(browserFailure?[browserFailure]:[]),...errors],
      'The original managed application did not fully drain; keep its original operation selected.');
  }
  if(browserFailure)throw browserFailure;
  await put(join(input.outputDirectory,'managed-receiving-result.json'),completed);
  return completed;
}

export async function main(args=process.argv.slice(2)){
  need(args.length===1,'REPORT_MANAGED_RECEIVING_INPUT','Pass one original private managed receiving input file.');
  const abort=new AbortController(),stop=()=>abort.abort(new Error('Original managed receiving stopped'));
  for(const name of ['SIGINT','SIGTERM'])process.on(name,stop);
  try{const result=await runManagedReportReceiving((await readJSON(resolve(args[0]))).value,{signal:abort.signal});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;}
  finally{for(const name of ['SIGINT','SIGTERM'])process.off(name,stop);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'REPORT_MANAGED_RECEIVING_FAILED',message:error.message}})+'\n');process.exitCode=1;});
