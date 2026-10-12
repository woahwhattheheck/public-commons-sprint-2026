// MIT. The original PMTiles producer through one installed Applications lifecycle.
// The caller supplies the original browser factory and a real READY installation.
import {createHash} from 'node:crypto';
import {realpath} from 'node:fs/promises';
import {createConnection} from 'node:net';
import {resolve,join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {privateDirectory,readJson,exists} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {need,clone,digest,timestamp,identifier,HASH} from '../../sf30-seller-sdk/pmtiles/model.mjs';
import {retainJson,fileDescriptor,MAX_METADATA_BYTES} from '../../sf30-seller-sdk/pmtiles/files.mjs';
import {inspectPMTilesApplicationWorkspace,inspectPMTilesApplicationRuntime}
  from '../../sf30-seller-sdk/pmtiles/application.mjs';
import {inspectMerchantRuntime} from '../../sf46-release/runtime-package.mjs';

const PREFIX='stellar/scf-starforge-20261009/';
const INPUT_SCHEMA='stellar-forge.pmtiles-managed-receiving-input.v1';
const RESULT_SCHEMA='stellar-forge.pmtiles-managed-receiving-result.v1';
const bindingKeys=['directory','installationId','profileId','profileSha256','lockSha256',
  'sourceCommit','sourceManifestSha256'];
const runtimeBinding=value=>Object.fromEntries(bindingKeys.map(key=>[key,value[key]]));
const errorView=error=>({code:error.code??'PMTILES_MANAGED_RECEIVING_FAILED',message:String(error.message??error)});
async function optional(path){try{return await readJson(path,MAX_METADATA_BYTES);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function absolute(value,label){
  need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&!value.includes('\0'),
    'PMTILES_MANAGED_ABSOLUTE_PATH_REQUIRED',label);return value;
}
function uuid(value){
  const s=createHash('sha256').update(value).digest('hex');
  return s.slice(0,8)+'-'+s.slice(8,12)+'-4'+s.slice(13,16)+'-a'+s.slice(17,20)+'-'+s.slice(20,32);
}
async function waitFor(label,read,accept,{signal,timeout=180000}={}){
  const end=Date.now()+timeout;let last;
  while(Date.now()<end){
    signal?.throwIfAborted();last=await read();if(accept(last))return last;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw Object.assign(new Error(label+' did not reach its original completed state.'),
    {code:'PMTILES_MANAGED_RECEIVING_TIMEOUT',observed:last});
}
async function listenerClosed(origin){
  const selected=new URL(origin);
  need(selected.protocol==='http:'&&selected.hostname==='127.0.0.1'&&
    Number.isInteger(Number(selected.port))&&Number(selected.port)>0,'PMTILES_MANAGED_ORIGINAL_URL_REQUIRED');
  return new Promise(resolve=>{
    const socket=createConnection({host:'127.0.0.1',port:Number(selected.port)});
    let done=false;
    function finish(value){if(done)return;done=true;socket.destroy();resolve(value);}
    socket.once('connect',()=>finish(false));
    socket.once('error',error=>finish(error.code==='ECONNREFUSED'));
    socket.setTimeout(1000,()=>finish(false));
  });
}
function privateApi(link){
  const url=new URL(link);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&/^#token=[a-f0-9]{64}$/.test(url.hash),
    'PMTILES_MANAGED_ORIGINAL_URL_REQUIRED');
  const token=url.hash.slice(7);
  return async (path,input,{signal}={})=>{
    const response=await fetch(url.origin+path,{method:input===undefined?'GET':'POST',
      headers:{authorization:'Bearer '+token,...(input===undefined?{}:{origin:url.origin,'content-type':'application/json'})},
      ...(input===undefined?{}:{body:JSON.stringify(input)}),
      signal:signal?AbortSignal.any([signal,AbortSignal.timeout(180000)]):AbortSignal.timeout(180000)});
    const value=await response.json();
    need(response.ok,'PMTILES_MANAGED_ORIGINAL_API_FAILED',JSON.stringify(value));
    return value;
  };
}
function runView(app){
  const run=app.current;
  return {applicationId:app.id,applicationRevision:app.revision,phase:app.phase,
    operationId:run?.id??null,operationPhase:run?.phase??null,active:run?.active===true,
    command:run?.command??null,args:run?.args??null,result:run?.result??null,
    origin:run?.privateUrl?new URL(run.privateUrl).origin:null};
}

/**
 * openBrowser({url,directory}) returns the original {context,page}; it uses the
 * caller's retained Playwright/Chromium selection and persistent producer data.
 * This hook opens one context, and retains that same page across both Starts.
 */
export async function exercisePMTilesApplications({
  sourceRoot,installation,directory,runtimeProfile,expectedWorkspaceId,
  root,browserDirectory,operationId,openBrowser,signal
}={}){
  const selected=clone({schema:INPUT_SCHEMA,sourceRoot,installation,directory,runtimeProfile,
    expectedWorkspaceId,root,browserDirectory,operationId});
  identifier(selected.operationId);identifier(selected.expectedWorkspaceId);
  for(const key of ['sourceRoot','directory','runtimeProfile','root','browserDirectory'])absolute(selected[key],key);
  need(typeof openBrowser==='function','PMTILES_ORIGINAL_BROWSER_FACTORY_REQUIRED');
  need(selected.installation&&typeof selected.installation==='object'&&!Array.isArray(selected.installation),
    'PMTILES_READY_INSTALLATION_SELECTION_REQUIRED');
  absolute(selected.installation.directory,'installation.directory');
  need(/^[a-f0-9]{40}$/.test(selected.installation.expectedSourceCommit??'')&&
    HASH.test(selected.installation.expectedSourceManifestSha256??''),'PMTILES_READY_INSTALLATION_IDENTITY_REQUIRED');
  root=await privateDirectory(selected.root);await privateDirectory(join(root,'steps'));
  await retainJson(join(root,'original-input.json'),selected);
  const requestSha256=digest(selected),stepPath=name=>join(root,'steps',name+'.json');
  async function step(name,run){
    signal?.throwIfAborted();
    const old=await optional(stepPath(name));if(old)return old;
    process.stdout.write(JSON.stringify({operationId,phase:'pmtiles-applications:'+name,at:timestamp()})+'\n');
    const value=await run();await retainJson(stepPath(name),value);return value;
  }
  const installed=await inspectMerchantRuntime(selected.installation.directory,{
    expectedManifest:selected.installation.expectedSourceManifestSha256,load:true});
  need(installed.sourceCommit===selected.installation.expectedSourceCommit,
    'PMTILES_MANAGED_INSTALLED_SOURCE_CHANGED');
  const installedSource=await realpath(installed.sourceRoot);
  const originalModule=path=>import(pathToFileURL(join(installedSource,PREFIX,path)).href);
  const {readDistributionSpecification}=await originalModule('distribution/specification.mjs');
  const {spec}=await readDistributionSpecification({sourceRoot:installedSource});
  need(spec.commands?.['pmtiles-workspace']===PREFIX+'sf30-seller-sdk/pmtiles/application.mjs'&&
    spec.applicationProviders?.pmtiles===PREFIX+'distribution/runtime-workspace/providers/pmtiles.mjs'&&
    spec.merchantProviders?.['pmtiles-workspaces']==='stellar-forge/mcp-merchant-operator/providers/pmtiles-workspaces.mjs',
    'PMTILES_MANAGED_COMPLETE_INSTALLATION_REQUIRED');
  const originalWorkspace=await inspectPMTilesApplicationWorkspace({
    directory:selected.directory,expectedWorkspaceId:selected.expectedWorkspaceId});
  const originalRuntime=await inspectPMTilesApplicationRuntime({runtimeProfile:selected.runtimeProfile});
  const priorInstallation=await optional(stepPath('installation'));
  function checkInstallation(retained){
    need(retained&&digest(retained.installation)===digest(runtimeBinding(installed))&&
      retained.nativeRuntime.runtimeSha256===originalRuntime.runtimeSha256&&
      retained.nativeRuntime.profileSha256===originalRuntime.profileSha256,
      'PMTILES_MANAGED_RETAINED_INSTALLATION_CHANGED');
  }
  if(priorInstallation)checkInstallation(priorInstallation);
  const completed=await optional(join(root,'complete.json'));
  if(completed){
    checkInstallation(priorInstallation);
    need(completed.schema===RESULT_SCHEMA&&completed.status==='COMPLETE'&&
      completed.operationId===selected.operationId&&completed.requestSha256===requestSha256&&
      completed.workspaceId===selected.expectedWorkspaceId&&
      digest(completed.installation)===digest(runtimeBinding(installed))&&
      completed.nativeRuntimeSha256===originalRuntime.runtimeSha256&&
      completed.nativeProfileSha256===originalRuntime.profileSha256,
      'PMTILES_MANAGED_COMPLETED_SELECTION_CHANGED');
    const actual=await fileDescriptor(join(root,'managed-reopened-map.png'),{signal});
    need(actual.sha256===completed.screenshot.sha256&&actual.bytes===completed.screenshot.bytes,
      'PMTILES_MANAGED_COMPLETED_ARTIFACT_CHANGED');
    return {...completed,currentRevision:originalWorkspace.revision,currentRelease:originalWorkspace.currentRelease,reused:true};
  }
  const retainedInstallation=priorInstallation??await step('installation',async()=>({
    installation:runtimeBinding(installed),nativeRuntime:originalRuntime,
    sourceEntry:await fileDescriptor(join(installedSource,PREFIX,'sf30-seller-sdk/pmtiles/application.mjs'),{signal}),
    provider:await fileDescriptor(join(installedSource,PREFIX,'distribution/runtime-workspace/providers/pmtiles.mjs'),{signal})
  }));
  checkInstallation(retainedInstallation);
  const original=await step('workspace-selection',async()=>originalWorkspace);
  need(original.workspaceId===selected.expectedWorkspaceId&&original.currentRelease&&
    originalWorkspace.currentRelease===original.currentRelease,
    'PMTILES_MANAGED_PUBLISHED_PRODUCER_REQUIRED');
  const {createRuntimeWorkspace,openRuntimeWorkspace}=await originalModule('distribution/runtime-workspace/model.mjs');
  const operatorDirectory=join(root,'operator');
  if(!await exists(join(operatorDirectory,'workspace.json')))await createRuntimeWorkspace({directory:operatorDirectory});
  let model=await openRuntimeWorkspace({directory:operatorDirectory}),context=null,page=null,applicationId=null;
  const ownedRuns=new Set(),pageErrors=[],tileResponses=[];
  let previewOrigin=null,previewPrefix=null;
  const current=async()=>{
    const state=await model.applicationsState();
    const found=state.applications.find(item=>item.id===applicationId);
    need(found,'PMTILES_MANAGED_APPLICATION_MISSING');return found;
  };
  async function stopRun(selectedRun,tag){
    need(selectedRun.applicationId===applicationId&&selectedRun.operationId&&selectedRun.origin,
      'PMTILES_MANAGED_STOP_SELECTION_CHANGED');
    ownedRuns.add(selectedRun.operationId);
    const before=await current();
    need(before.current?.id===selectedRun.operationId,'PMTILES_MANAGED_STOP_OPERATION_CHANGED');
    await model.applicationsStop({applicationId,operationId:selectedRun.operationId});
    const stopped=await waitFor(tag+' original Stop',current,
      value=>value.current?.id===selectedRun.operationId&&!value.current.active&&value.phase==='STOPPED',{signal});
    need(await listenerClosed(selectedRun.origin),'PMTILES_MANAGED_LISTENER_REMAINS_OPEN');
    return {...runView(stopped),origin:selectedRun.origin,listenerClosed:true};
  }
  async function originalRun(id,app){
    const visible=app.runs.find(run=>run.id===id);if(visible)return visible;
    try{return await model.applicationsOutput({applicationId,operationId:id});}
    catch(error){if(error.code==='ENOENT')return null;throw error;}
  }
  async function startRun(tag){
    // Read each exact retained operation, including one outside the overview's
    // recent history. A new reviewed Start follows a positively ended owner.
    let index=0;
    for(;;index++){
      const name=tag+'-start-'+index,requestPath=stepPath(name+'-request');
      const retained=await optional(requestPath);
      if(!retained)break;
      need(retained.applicationId===applicationId,'PMTILES_MANAGED_START_SELECTION_CHANGED');
      const app=await current(),previous=await originalRun(retained.requestId,app);
      const ended=await optional(stepPath(name+'-ended'));
      if(ended){
        need(ended.operationId===retained.requestId&&!previous?.active,
          'PMTILES_MANAGED_ENDED_OWNER_CHANGED');continue;
      }
      if(previous?.active||['QUEUED','PENDING'].includes(previous?.phase)){
        need(app.current?.id===retained.requestId,'PMTILES_MANAGED_ACTIVE_OPERATION_CHANGED');
        ownedRuns.add(retained.requestId);
        if(previous.active&&app.current.privateUrl)return app;
        if(!previous.active)await model.applicationsRecover({applicationId,operationId:retained.requestId});
        return await waitFor(name+' original readiness',current,value=>
          value.current?.id===retained.requestId&&value.current.active&&Boolean(value.current.privateUrl),{signal});
      }
      if(previous){
        need(['INTERRUPTED','FAILED','STOPPED','SUCCEEDED','CANCELLED'].includes(previous.phase),
          'PMTILES_MANAGED_ORIGINAL_OPERATION_UNRESOLVED');
        if(!['SUCCEEDED','CANCELLED'].includes(previous.phase))
          await model.applicationsStop({applicationId,operationId:retained.requestId});
        await retainJson(stepPath(name+'-ended'),{operationId:retained.requestId,observed:previous,
          reason:'Original receiving continuation after an ended managed operation.'});
        continue;
      }
      // The original review was saved before its first dispatch.
      ownedRuns.add(retained.requestId);await model.applicationsStart(retained);
      return await waitFor(name+' original readiness',current,value=>
        value.current?.id===retained.requestId&&value.current.active&&Boolean(value.current.privateUrl),{signal});
    }
    const name=tag+'-start-'+index;
    const review=await step(name+'-review',()=>model.applicationsStartReview({applicationId}));
    const request={applicationId,requestId:uuid(selected.operationId+':'+name),reviewId:review.id};
    await retainJson(stepPath(name+'-request'),request);
    ownedRuns.add(request.requestId);
    await model.applicationsStart(request);
    return await waitFor(name+' original readiness',current,value=>
      value.current?.id===request.requestId&&value.current.active&&Boolean(value.current.privateUrl),{signal});
  }
  async function preview(run,tag){
    const api=privateApi(run.current.privateUrl);
    const value=await api('/api/actions/preview',{
      requestId:'managed-'+digest({operationId,tag,applicationOperation:run.current.id}).slice(0,40),
      expectedWorkspaceId:selected.expectedWorkspaceId,releaseId:original.currentRelease},{signal});
    need(value.alive===true&&value.releaseId===original.currentRelease&&
      /^\/preview\/[a-f0-9]{64}\/style\.json$/.test(value.path),'PMTILES_MANAGED_NATIVE_PREVIEW_FAILED');
    previewOrigin=new URL(run.current.privateUrl).origin;
    previewPrefix=value.path.slice(0,-'style.json'.length)+'tiles/';
    tileResponses.length=0;
    const refreshing=page.waitForResponse(response=>{
      const u=new URL(response.url());return ['/api/state','/api/bootstrap'].includes(u.pathname)&&response.status()===200;
    },{timeout:30000});
    await page.locator('#refresh').click();await refreshing;
    await page.locator('#map canvas').first().waitFor({state:'visible',timeout:30000});
    await page.waitForFunction(({session})=>{
      const status=document.querySelector('#mapStatus');
      return status?.dataset.state==='ready'&&status.textContent.includes('native session '+session);
    },{session:value.session},{timeout:60000});
    await waitFor('Selected native preview tile',async()=>tileResponses.some(row=>row.status===200),
      value=>value===true,{signal,timeout:60000});
    const state=await api('/api/state',undefined,{signal});
    need(state.id===selected.expectedWorkspaceId&&state.currentRelease===original.currentRelease&&
      state.preview?.alive&&state.preview.releaseId===original.currentRelease&&
      state.preview.session===value.session,'PMTILES_MANAGED_PREVIEW_SELECTION_CHANGED');
    need(tileResponses.some(row=>row.status===200),'PMTILES_MANAGED_NATIVE_TILE_NOT_OBSERVED');
    return {releaseId:value.releaseId,manifestSha256:value.manifestSha256,runtimeSha256:value.runtimeSha256,
      session:value.session,origin:previewOrigin,nativeTileResponses:clone(tileResponses)};
  }
  function observePage(currentPage){
    currentPage.on('pageerror',error=>pageErrors.push(String(error.message??error)));
    currentPage.on('response',response=>{
      const url=new URL(response.url());
      if(previewPrefix&&url.origin===previewOrigin&&url.pathname.startsWith(previewPrefix))
        tileResponses.push({origin:url.origin,path:url.pathname.replace(/^\/preview\/[a-f0-9]{64}\//,'/preview/SELECTED/'),
          status:response.status()});
    });
  }
  try{
    const attached=await model.attach({directory:installed.directory,label:'Original PMTiles Applications runtime'});
    need(attached.status==='READY','PMTILES_MANAGED_INSTALLATION_NOT_READY');
    const catalog=(await model.applicationsState()).catalog;
    need(catalog.filter(item=>item.id==='pmtiles-operations'&&item.command==='pmtiles-workspace').length===1,
      'PMTILES_MANAGED_CATALOG_CHANGED');
    const review=await step('application-review',()=>model.applicationsReview({
      runtimeId:attached.runtimeId,kind:'pmtiles-operations',label:'Original PMTiles managed receiving',
      settings:{workspaceDirectory:selected.directory,runtimeProfile:selected.runtimeProfile,port:0}
    }));
    const saved=await step('application-save',()=>model.applicationsSave({
      requestId:uuid(selected.operationId+':save-pmtiles-application'),reviewId:review.id
    }));
    applicationId=saved.applicationId;
    const application=await current();
    if(!application.release)await model.applicationsConnect({applicationId});
    await waitFor('Original managed installation adoption',current,value=>Boolean(value.release),{signal});

    let firstBefore=await optional(stepPath('first-before-stop'));
    if(!firstBefore){
      const first=await startRun('first');
      const firstOrigin=new URL(first.current.privateUrl).origin;
      if(original.authoringPort)need(Number(new URL(firstOrigin).port)===original.authoringPort,
        'PMTILES_MANAGED_ORIGINAL_ORIGIN_CHANGED');
      ({context,page}=await openBrowser({url:first.current.privateUrl,directory:selected.browserDirectory}));
      need(context&&page,'PMTILES_ORIGINAL_BROWSER_REQUIRED');observePage(page);
      page.setDefaultTimeout(30000);await page.locator('#editionNotes').waitFor();
      // Preview is live process state; reopen it on every actual server lifetime.
      const native=await preview(first,'first');
      const retainedDraft=await optional(stepPath('dirty-draft'));
      const draft=retainedDraft??{
        editionId:await page.locator('#editionId').inputValue(),
        expectedVersion:await page.locator('#expectedVersion').inputValue(),
        originalNotes:await page.locator('#editionNotes').inputValue(),
        notes:(await page.locator('#editionNotes').inputValue())+
          '\nOriginal managed Applications draft retained across Stop and Start.'
      };
      await retainJson(stepPath('dirty-draft'),draft);
      need(await page.locator('#editionId').inputValue()===draft.editionId&&
        await page.locator('#expectedVersion').inputValue()===draft.expectedVersion&&
        [draft.originalNotes,draft.notes].includes(await page.locator('#editionNotes').inputValue()),
        'PMTILES_MANAGED_SELECTED_DRAFT_CHANGED');
      await page.locator('#editionNotes').fill(draft.notes);
      firstBefore={run:runView(first),native,draft:{
        editionId:await page.locator('#editionId').inputValue(),
        expectedVersion:await page.locator('#expectedVersion').inputValue(),
        notes:await page.locator('#editionNotes').inputValue(),origin:firstOrigin
      }};
      await retainJson(stepPath('first-before-stop'),firstBefore);
    }
    // A completed browser phase and its original Stop selection are retained
    // together before Stop. A lost Stop reply never starts another first owner.
    const firstStop=await step('first-stop',()=>stopRun(firstBefore.run,'first'));
    need(firstStop.operationId===firstBefore.run.operationId&&firstStop.origin===firstBefore.run.origin,
      'PMTILES_MANAGED_FIRST_STOP_CHANGED');

    await model.close();model=await openRuntimeWorkspace({directory:operatorDirectory});
    const reopenedApplication=await current();
    need(reopenedApplication.id===applicationId&&reopenedApplication.runtime.sourceCommit===installed.sourceCommit,
      'PMTILES_MANAGED_SAVED_APPLICATION_CHANGED');
    let secondBefore=await optional(stepPath('second-before-stop'));
    if(!secondBefore){
      const second=await startRun('second'),secondOrigin=new URL(second.current.privateUrl).origin;
      need(secondOrigin===firstStop.origin,'PMTILES_MANAGED_RESTART_ORIGIN_CHANGED');
      need(second.current.id!==firstStop.operationId,'PMTILES_MANAGED_RESTART_OPERATION_REUSED');
      if(!context){
        ({context,page}=await openBrowser({url:second.current.privateUrl,directory:selected.browserDirectory}));
        need(context&&page,'PMTILES_ORIGINAL_BROWSER_REQUIRED');observePage(page);page.setDefaultTimeout(30000);
      }else await page.goto(second.current.privateUrl);
      await page.locator('#editionNotes').waitFor();
      const draft=await optional(stepPath('dirty-draft'));
      need(draft&&await page.locator('#editionNotes').inputValue()===draft.notes&&
        await page.locator('#editionId').inputValue()===draft.editionId&&
        await page.locator('#expectedVersion').inputValue()===draft.expectedVersion,
        'PMTILES_MANAGED_DIRTY_DRAFT_CHANGED');
      const native=await preview(second,'second');
      need(await page.locator('#editionNotes').inputValue()===draft.notes,'PMTILES_MANAGED_REFRESH_DRAFT_CHANGED');
      need(pageErrors.length===0,'PMTILES_MANAGED_BROWSER_ERROR',JSON.stringify(pageErrors));
      const screenshotPath=join(root,'managed-reopened-map.png');
      await page.screenshot({path:screenshotPath,fullPage:true});
      const screenshot=await fileDescriptor(screenshotPath,{signal});
      secondBefore={run:runView(second),native,dirtyDraft:{
        editionId:draft.editionId,expectedVersion:draft.expectedVersion,
        notesSha256:createHash('sha256').update(draft.notes).digest('hex')
      },browserErrors:clone(pageErrors),screenshot:{path:screenshotPath,...screenshot}};
      await retainJson(stepPath('second-before-stop'),secondBefore);
    }
    need(secondBefore.run.operationId!==firstStop.operationId&&secondBefore.run.origin===firstStop.origin&&
      secondBefore.native.releaseId===original.currentRelease,'PMTILES_MANAGED_SECOND_SELECTION_CHANGED');
    const actualScreenshot=await fileDescriptor(join(root,'managed-reopened-map.png'),{signal});
    need(secondBefore.screenshot.path===join(root,'managed-reopened-map.png')&&
      secondBefore.screenshot.sha256===actualScreenshot.sha256&&secondBefore.screenshot.bytes===actualScreenshot.bytes,
      'PMTILES_MANAGED_RETAINED_ARTIFACT_CHANGED');
    // If the receiving carrier ended after this Stop, finish from its complete
    // prior native/browser record without launching a third managed process.
    const secondStop=await step('second-stop',()=>stopRun(secondBefore.run,'second'));
    need(secondStop.operationId===secondBefore.run.operationId&&secondStop.origin===firstStop.origin,
      'PMTILES_MANAGED_SECOND_STOP_CHANGED');
    if(context){await context.close();context=null;page=null;}
    await model.close();model=await openRuntimeWorkspace({directory:operatorDirectory});
    const cold=await current(),finalWorkspace=await inspectPMTilesApplicationWorkspace({
      directory:selected.directory,expectedWorkspaceId:selected.expectedWorkspaceId});
    need(cold.phase==='STOPPED'&&!cold.current?.active&&cold.current?.id===secondStop.operationId&&
      finalWorkspace.currentRelease===original.currentRelease&&finalWorkspace.authoringPort===Number(new URL(secondStop.origin).port),
      'PMTILES_MANAGED_COLD_STATE_CHANGED');
    const result={schema:RESULT_SCHEMA,status:'COMPLETE',operationId:selected.operationId,requestSha256,
      workspaceId:selected.expectedWorkspaceId,workspaceDirectory:selected.directory,applicationId,
      installation:runtimeBinding(installed),nativeRuntimeSha256:originalRuntime.runtimeSha256,
      nativeProfileSha256:originalRuntime.profileSha256,originalReleaseId:original.currentRelease,currentRelease:finalWorkspace.currentRelease,currentRevision:finalWorkspace.revision,
      authoringOrigin:secondStop.origin,authoringPort:finalWorkspace.authoringPort,
      firstStop,secondStop,native:secondBefore.native,dirtyDraft:secondBefore.dirtyDraft,
      browserErrors:secondBefore.browserErrors,nativeTileResponses:secondBefore.native.nativeTileResponses,
      screenshot:secondBefore.screenshot,completedAt:timestamp()};
    await retainJson(join(root,'complete.json'),result);return result;
  }catch(error){
    process.stderr.write(JSON.stringify({operationId: selected.operationId,
      phase:'pmtiles-applications',error:errorView(error)})+'\n');throw error;
  }finally{
    if(applicationId&&model){
      const app=await current().catch(()=>null);
      if(app?.current?.active&&ownedRuns.has(app.current.id)){
        await model.applicationsStop({applicationId,operationId:app.current.id}).catch(()=>{});
        await waitFor('Original managed cleanup',current,value=>!value.current?.active,{timeout:30000}).catch(()=>{});
      }
    }
    if(context)await context.close().catch(()=>{});
    await model?.close?.();
  }
}
