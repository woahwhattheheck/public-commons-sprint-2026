// MIT. One retained managed Pipelines → original research workspace browser journey.
// The caller owns the sole native resource record, TLS server, Chrome process and source selection.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PIPELINE_NATIVE_SCENARIO } from './managed-pipelines-fixture.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const copy=value=>JSON.parse(JSON.stringify(value));
const title='Managed document processing · original retained native journey';
const questionText='Which source paragraphs explain the selected plan and its operating assumptions?';
const primaryLabel='Committee source files';
const cancellationLabel='Cancelled follow-up processing';
const firstEditionLabel='Appendix evidence · original provider output';
const secondEditionLabel='Partition-stage evidence · original provider output';
function atomicJson(path,value){
  const raw=Buffer.from(JSON.stringify(value,null,2)+'\n'),temporary=path+'.'+randomUUID()+'.tmp';let fd;
  try{fd=openSync(temporary,'wx',0o600);writeFileSync(fd,raw);fsyncSync(fd);closeSync(fd);fd=undefined;
    renameSync(temporary,path);const parent=openSync(dirname(path),'r');try{fsyncSync(parent);}finally{closeSync(parent);}}
  finally{if(fd!==undefined)closeSync(fd);try{unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
async function bodyOfDownload(download){
  const file=await download.path();assert(file,'The original browser download must have a saved file');
  return readFileSync(file);
}
function originalRequestSummary(request){
  return {requestId:request.body?.requestId??null,method:request.method,path:request.path,
    bodySha256:sha(Buffer.from(JSON.stringify(request.body))),kind:request.kind};
}

/**
 * Required caller contract:
 * - page is the existing Playwright page in the caller's one admitted browser.
 * - app is original startDossierWorkspace({pipelineSource:{operations,workspaceId,directory}}).
 * - fixture is createPipelineJobFixture({...,stateFile:<same native output>/provider-state.json}).
 * - openRestoredWorkspace() starts the SAME original application with a fresh private directory
 *   and pipelineSource:null. This helper calls original POST /api/reopen itself.
 * - sourceIdentity is the caller's actual selected source/manifest identity, copied to the report.
 * No queue, provider account discovery, browser launch or replacement operation is created here.
 */
export async function runManagedPipelineBrowserJourney({
  page,app,fixture,outputDirectory,sourceIdentity,openRestoredWorkspace,
  selectPipelines=async page=>page.locator('#pipelines-tab').click(),
}={}){
  assert(page&&app?.pipelines&&fixture&&typeof openRestoredWorkspace==='function');
  assert(isAbsolute(outputDirectory));assert(sourceIdentity&&typeof sourceIdentity==='object');
  mkdirSync(outputDirectory,{recursive:true,mode:0o700});
  const checkpointPath=join(outputDirectory,'browser-checkpoint.json');
  const resultPath=join(outputDirectory,'managed-pipelines-result.json');
  if(existsSync(resultPath)){
    const prior=JSON.parse(readFileSync(resultPath));
    assert.equal(prior.schema,'stellar-forge.managed-pipelines-native-result.v1');
    assert.deepEqual(prior.sourceIdentity,sourceIdentity);
    if(prior.status==='passed')return prior;
  }
  const checkpoint=existsSync(checkpointPath)?JSON.parse(readFileSync(checkpointPath)):
    {schema:'stellar-forge.managed-pipelines-native-checkpoint.v1',sourceIdentity:copy(sourceIdentity),
      startedAt:new Date().toISOString(),steps:[],requests:[],dropped:{},browserJournal:null};
  assert.equal(checkpoint.schema,'stellar-forge.managed-pipelines-native-checkpoint.v1');
  assert.deepEqual(checkpoint.sourceIdentity,sourceIdentity);
  const save=()=>atomicJson(checkpointPath,checkpoint);
  let activeApp=app,restoredApp=null;
  const pageErrors=[];
  const onPageError=error=>pageErrors.push({message:error.message});
  page.on('pageerror',onPageError);
  function requestPath(path){
    assert(path.startsWith('/api/'));
    return activeApp.origin+path;
  }
  async function api(path,{method='GET',body,raw=false}={}){
    const response=await fetch(requestPath(path),{method,redirect:'error',
      headers:{authorization:'Bearer '+activeApp.token,...(body===undefined?{}:{'content-type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const bytes=Buffer.from(await response.arrayBuffer());
    const value=raw?bytes:JSON.parse(bytes.toString('utf8'));
    assert(response.ok,'Original workspace '+method+' '+path+' failed: '+(value?.error??response.status));
    return value;
  }
  const base=()=>'/api/dossiers/'+encodeURIComponent(checkpoint.dossierId);
  const pipeline=(suffix='')=>base()+'/pipelines'+suffix;
  const snapshot=id=>api(pipeline('/operations/'+id));
  const configured=await app.pipelines.configured();
  assert.equal(configured.configured,true);
  if(checkpoint.workspaceId!==undefined)assert.equal(checkpoint.workspaceId,configured.workspaceId);
  checkpoint.workspaceId=configured.workspaceId;
  const journalKey='unstructured-pipelines:v1:'+encodeURIComponent(configured.workspaceId)+':'+
    encodeURIComponent(checkpoint.dossierId??'');
  let actualJournalKey=journalKey;
  async function captureBrowserJournal(){
    const value=await page.evaluate(key=>{
      const raw=localStorage.getItem(key);return raw?JSON.parse(raw):null;
    },actualJournalKey);
    if(value){assert.equal(value.workspaceId,configured.workspaceId);assert.equal(value.dossierId,checkpoint.dossierId);
      checkpoint.browserJournal=value;save();}
    return value;
  }
  async function step(name,work){
    const completed=checkpoint.steps.find(row=>row.name===name);
    if(completed)return copy(completed.result);
    const result=await work();
    const entry={name,completedAt:new Date().toISOString(),result:copy(result??{})};
    const index=checkpoint.steps.findIndex(row=>row.name===name);
    if(index<0)checkpoint.steps.push(entry);else checkpoint.steps[index]=entry;
    await captureBrowserJournal();save();return result;
  }
  const waitEnabled=selector=>page.waitForFunction(selector=>{
    const element=document.querySelector(selector);return element&&!element.disabled;
  },selector,{timeout:20000});
  const waitText=(selector,text)=>page.waitForFunction(([selector,text])=>
    document.querySelector(selector)?.textContent.includes(text),[selector,text],{timeout:20000});
  async function journalComplete(kind,requestId){
    await page.waitForFunction(([key,kind,id])=>{
      const value=JSON.parse(localStorage.getItem(key)||'null');
      return value?.[kind]?.some(row=>row.input.requestId===id&&row.status==='complete');
    },[actualJournalKey,kind,requestId],{timeout:20000});
    return captureBrowserJournal();
  }
  async function openBrowser(){
    const url=new URL(activeApp.url),params=new URLSearchParams(url.hash.slice(1));
    params.set('dossier',checkpoint.dossierId);url.hash=params.toString();
    await page.goto(url.href);
    await page.locator('#pipelines-tab').waitFor({state:'visible'});
    await selectPipelines(page);
    await page.locator('#pipelines-prepare-form').waitFor({state:'visible'});
    await waitText('#pipelines-source',configured.workspaceId);
  }
  async function openOperation(id){
    await page.locator('[data-pipeline-operation="'+id+'"]').click();
    await waitText('#pipelines-operation-facts',id);
    await waitEnabled('#pipelines-reload-job');
  }
  async function recoverPendingControls(id){
    const journal=await captureBrowserJournal();
    for(const entry of journal?.controls.filter(row=>row.operationId===id&&row.status==='pending')??[]){
      await waitEnabled('#pipelines-reopen-action');
      await page.locator('#pipelines-action-history').selectOption(entry.input.requestId);
      await page.locator('#pipelines-reopen-action').click();
      await journalComplete('controls',entry.input.requestId);
    }
  }
  async function recoverPendingPreparation(){
    const journal=await captureBrowserJournal(),pending=journal?.preparation;
    if(!pending)return;
    assert.equal(pending.dossierId,checkpoint.dossierId);
    assert.equal(pending.input.profileId,PIPELINE_NATIVE_SCENARIO.profile.id);
    assert.equal(pending.input.questionId,checkpoint.questionId);
    assert([primaryLabel,cancellationLabel].includes(pending.input.label));
    const originalFiles=fixture.inputs().slice(0,pending.input.label===primaryLabel?2:1);
    const metadata=originalFiles.map(file=>({filename:file.filename,contentType:file.contentType,
      bytes:file.bytes,sha256:file.sha256}));
    assert.deepEqual(metadata,pending.files,'Continue the same reviewed preparation with its original input bytes');
    const listing=await api(pipeline());
    const found=listing.operations.filter(value=>value.plan.payload.request.requestId===pending.input.requestId);
    assert(found.length<=1);
    if(found.length){
      await page.locator('#pipelines-recover-prepare').waitFor({state:'visible'});
      await waitEnabled('#pipelines-recover-prepare');
      await page.locator('#pipelines-recover-prepare').click();
    }else{
      await page.locator('#pipelines-files').setInputFiles(originalFiles.map(file=>({
        name:file.filename,mimeType:file.contentType,buffer:file.body,
      })));
      await waitEnabled('#pipelines-prepare');
      await page.locator('#pipelines-prepare').click();
    }
    await page.waitForFunction(([key,id])=>{
      const value=JSON.parse(localStorage.getItem(key)||'null');
      return value&&value.preparation?.input.requestId!==id;
    },[actualJournalKey,pending.input.requestId],{timeout:20000});
    await waitEnabled('#pipelines-profile');
    const saved=(await api(pipeline())).operations.filter(value=>
      value.plan.payload.request.requestId===pending.input.requestId);
    assert.equal(saved.length,1);
    assert.equal(saved[0].plan.payload.request.profileId,pending.input.profileId);
    assert.equal(saved[0].plan.payload.request.label,pending.input.label);
    assert.deepEqual(saved[0].plan.payload.inputs.map(file=>({filename:file.filename,contentType:file.contentType,
      bytes:file.bytes,sha256:file.sha256})),metadata);
    checkpoint.preparationRecoveries??=[];
    checkpoint.preparationRecoveries.push({requestId:pending.input.requestId,operationId:saved[0].plan.id,
      recoveredAt:new Date().toISOString(),alreadyPublished:found.length===1});
    await captureBrowserJournal();save();
  }
  async function prepared(label,files){
    await recoverPendingPreparation();
    const current=await api(pipeline());
    const matching=current.operations.filter(value=>value.plan.payload.request.label===label);
    assert(matching.length<=1,'The native run keeps one original preparation for each reviewed job');
    if(matching.length){await openOperation(matching[0].plan.id);await recoverPendingControls(matching[0].plan.id);return snapshot(matching[0].plan.id);}
    await waitEnabled('#pipelines-profile');
    await page.locator('#pipelines-profile').selectOption(PIPELINE_NATIVE_SCENARIO.profile.id);
    await page.locator('#pipelines-question').selectOption(checkpoint.questionId);
    await page.locator('#pipelines-label').fill(label);
    await page.locator('#pipelines-files').setInputFiles(files.map(file=>({
      name:file.filename,mimeType:file.contentType,buffer:file.body,
    })));
    await page.locator('#pipelines-prepare').click();
    await waitText('#pipelines-operation-title',label);
    await waitEnabled('#pipelines-reload-job');
    const saved=(await api(pipeline())).operations.filter(value=>value.plan.payload.request.label===label);
    assert.equal(saved.length,1);return saved[0];
  }
  async function clickAction(selector,kind){
    const before=checkpoint.requests.length;
    await waitEnabled(selector);await page.locator(selector).click();
    await page.waitForFunction(selector=>!document.querySelector(selector)?.disabled,
      '#pipelines-reload-job',{timeout:20000});
    for(let tries=0;tries<100;tries++){
      const found=checkpoint.requests.slice(before).find(row=>row.kind===kind&&row.body?.requestId);
      if(found)return found;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.fail('The original browser did not emit its saved '+kind+' request');
  }
  async function retainedSelection(view,fileId,nodeId){
    const existing=view.operation.outputs.find(row=>row.fileId===fileId&&(row.nodeId??null)===(nodeId??null));
    if(existing)return existing;
    await page.locator('#pipelines-output-option').selectOption(JSON.stringify([fileId,nodeId??null]));
    const request=await clickAction('#pipelines-retain-output','retain');
    if(checkpoint.dropped.retain?.requestId===request.body.requestId){
      await waitEnabled('#pipelines-reopen-action');
      await page.locator('#pipelines-action-history').selectOption(request.body.requestId);
      await page.locator('#pipelines-reopen-action').click();
    }
    await journalComplete('controls',request.body.requestId);
    const current=await snapshot(view.plan.id);
    const output=current.operation.outputs.find(row=>row.fileId===fileId&&(row.nodeId??null)===(nodeId??null));
    assert(output);return output;
  }
  async function receiveOutput(operationId,output,label){
    const original=await api(base()),existing=original.editions.filter(row=>row.label===label);
    assert(existing.length<=1);
    if(existing.length){
      assert.equal(existing[0].questionId,checkpoint.questionId);assert.equal(existing[0].origin?.outputId,output.id);
      const journal=await captureBrowserJournal();
      const pending=journal?.receives.find(row=>row.status==='pending'&&row.input.label===label);
      if(pending){
        const button=page.locator('#pipelines-recovery button').filter({hasText:'Continue exact receiving decision'});
        await button.first().click();await journalComplete('receives',pending.input.requestId);
      }
      return existing[0];
    }
    await page.locator('[data-pipeline-output="'+output.id+'"]').click();
    await page.locator('#pipelines-current').waitFor({state:'visible'});
    await page.locator('#pipelines-receive-question').selectOption(checkpoint.questionId);
    await page.locator('#pipelines-receive-label').fill(label);
    const request=await clickAction('#pipelines-receive','receive');
    if(checkpoint.dropped.receive?.requestId===request.body.requestId){
      await page.reload();await page.locator('#pipelines-tab').click();
      const button=page.locator('#pipelines-recovery button').filter({hasText:'Continue exact receiving decision'});
      await button.first().waitFor({state:'visible'});await button.first().click();
    }
    await journalComplete('receives',request.body.requestId);
    const after=await api(base()),matches=after.editions.filter(row=>row.label===label);
    assert.equal(matches.length,1);
    assert.equal(after.revision,original.revision+1,'The original receiving decision commits exactly one dossier edition');
    const journal=await captureBrowserJournal(),receipt=journal.receives.find(row=>row.input.requestId===request.body.requestId).receipt;
    assert.equal(receipt.editionId,matches[0].id);assert.equal(receipt.questionId,checkpoint.questionId);
    assert.equal(receipt.revision,after.revision);
    return matches[0];
  }
  let intercept;
  try{
    const collection=await api('/api/state');
    if(!checkpoint.dossierId){
      const matching=collection.dossiers.filter(value=>value.title===title);assert(matching.length<=1);
      const dossier=matching[0]??await api('/api/dossiers',{method:'POST',body:{
        title,description:'Retained local HTTP provider scenario for the official managed Jobs workflow.',
      }});
      checkpoint.dossierId=dossier.id;save();
    }
    let dossier=await api(base());
    const questions=dossier.questions.filter(value=>value.text===questionText);assert(questions.length<=1);
    if(!questions.length)dossier=await api(base()+'/questions',{method:'POST',body:{text:questionText,expectedRevision:dossier.revision}});
    checkpoint.questionId=dossier.questions.find(value=>value.text===questionText).id;
    checkpoint.initialDossierRevision??=dossier.revision;
    actualJournalKey='unstructured-pipelines:v1:'+encodeURIComponent(configured.workspaceId)+':'+encodeURIComponent(checkpoint.dossierId);
    const recovered=checkpoint.browserJournal;
    await page.addInitScript(({origin,key,value})=>{
      if(location.origin===origin&&value&&!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(value));
    },{origin:app.origin,key:actualJournalKey,value:recovered});
    intercept=async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin!==app.origin||request.method()!=='POST'||!url.pathname.startsWith(pipeline())){
        await route.continue();return;
      }
      try{
        const body=request.postDataJSON(),kind=url.pathname.split('/').at(-1);
        const row={method:'POST',path:url.pathname,kind,body,at:new Date().toISOString()};
        checkpoint.requests.push(row);await captureBrowserJournal();save();
        const lose=(kind==='retain'||kind==='receive')&&!checkpoint.dropped[kind];
        if(!lose){await route.continue();return;}
        checkpoint.dropped[kind]={requestId:body.requestId,path:url.pathname,requestedAt:row.at,status:'awaiting-original-response'};
        save();
        const response=await route.fetch({maxRedirects:0,maxRetries:0,timeout:30000});
        const raw=Buffer.from(await response.body()),value=JSON.parse(raw.toString('utf8'));
        assert.equal(response.status(),200);assert(kind==='receive'?value.receipt?.requestId===body.requestId:value.actionResult?.requestId===body.requestId);
        writeFileSync(join(outputDirectory,'lost-'+kind+'-original-reply.json'),raw,{mode:0o600});
        checkpoint.dropped[kind]={...checkpoint.dropped[kind],status:'original-response-retained-browser-reply-lost',
          responseBytes:raw.length,responseSha256:sha(raw),
          ...(kind==='receive'?{receipt:value.receipt}:{actionResult:value.actionResult})};
        save();await route.abort('failed');
      }catch(error){checkpoint.interceptionError={code:error.code??'NATIVE_INTERCEPTION_FAILED',message:error.message};save();await route.abort('failed');}
    };
    await page.route('**/api/dossiers/**/pipelines/**',intercept);
    await openBrowser();
    const inputs=fixture.inputs();
    const primary=await step('reviewed original inputs',async()=>{
      const view=await prepared(primaryLabel,inputs);
      checkpoint.operationId=view.plan.id;checkpoint.planSha256=view.plan.sha256;save();
      assert.equal(view.plan.payload.inputs.length,inputs.length);
      for(let index=0;index<inputs.length;index++){
        const retained=view.plan.payload.inputs[index],expected=inputs[index];
        assert.equal(retained.sha256,expected.sha256);assert.equal(retained.bytes,expected.bytes);
        const bytes=await api(pipeline('/operations/'+view.plan.id+'/inputs/'+retained.id),{raw:true});
        assert.deepEqual(bytes,expected.body);
      }
      return {operationId:view.plan.id,planSha256:view.plan.sha256,inputs:view.plan.payload.inputs};
    });
    await step('uncertain submission and original provider identity',async()=>{
      await openOperation(primary.operationId);await recoverPendingControls(primary.operationId);
      let view=await snapshot(primary.operationId);
      if(view.operation.phase==='PREPARED'){
        await page.locator('#pipelines-review-plan').check();
        const request=await clickAction('#pipelines-submit','submit');
        await journalComplete('controls',request.body.requestId);
        view=await snapshot(primary.operationId);
      }
      if(view.operation.phase==='SUBMISSION_UNKNOWN'){
        assert.equal(fixture.summary().counters.create,1);
        await page.locator('#pipelines-reconcile-section').evaluate(element=>{element.open=true;});
        await waitEnabled('#pipelines-provider-jobs');await page.locator('#pipelines-provider-jobs').click();
        const providerId=fixture.jobs()[0].id;
        await page.waitForFunction(id=>Array.from(document.querySelector('#pipelines-provider-job').options).some(value=>value.value===id),providerId);
        await page.locator('#pipelines-provider-job').selectOption(providerId);
        await page.locator('#pipelines-reconcile-reason').fill('The original local provider accepted these retained input files before its create response was lost.');
        const request=await clickAction('#pipelines-reconcile','reconcile');
        await journalComplete('controls',request.body.requestId);
        view=await snapshot(primary.operationId);
      }
      assert(view.operation.providerJobId);assert.equal(fixture.summary().counters.create,1);
      checkpoint.providerJobId=view.operation.providerJobId;save();
      assert.equal(view.operation.providerJobId,fixture.jobs()[0].id);
      return {operationId:view.plan.id,providerJobId:view.operation.providerJobId,
        phase:view.operation.phase,reconciliation:view.operation.reconciliation??null};
    });
    await step('completed provider output selection',async()=>{
      await openOperation(primary.operationId);await recoverPendingControls(primary.operationId);
      let view=await snapshot(primary.operationId);
      if(view.operation.phase!=='COMPLETED'){
        if(fixture.job(checkpoint.providerJobId).status!=='COMPLETED')fixture.complete(checkpoint.providerJobId);
        const request=await clickAction('#pipelines-refresh-job','refresh');await journalComplete('controls',request.body.requestId);
        view=await snapshot(primary.operationId);
      }
      assert.equal(view.operation.phase,'COMPLETED');
      const selected=view.outputOptions.find(row=>row.nodeId===null);
      assert(selected);checkpoint.defaultFileId=selected.fileId;save();
      const output=await retainedSelection(view,selected.fileId,null);
      const expected=fixture.output(checkpoint.providerJobId,selected.fileId,null);
      assert.equal(output.sha256,sha(expected));assert.equal(output.bytes,expected.length);
      checkpoint.outputId=output.id;save();
      const retained=await api(pipeline('/operations/'+view.plan.id+'/outputs/'+output.id),{raw:true});
      assert.deepEqual(retained,expected);
      assert.equal(fixture.summary().counters.download,1,'Reopening the saved retain request returns its original output');
      return {providerJobId:checkpoint.providerJobId,outputId:output.id,fileId:output.fileId,nodeId:output.nodeId,
        bytes:output.bytes,sha256:output.sha256,lostReply:checkpoint.dropped.retain};
    });
    await step('original research receiving and lost reply',async()=>{
      await openOperation(primary.operationId);await recoverPendingControls(primary.operationId);
      const view=await snapshot(primary.operationId),output=view.operation.outputs.find(row=>row.id===checkpoint.outputId);
      const edition=await receiveOutput(primary.operationId,output,firstEditionLabel);
      checkpoint.editionId=edition.id;save();
      assert.equal(fixture.summary().counters.download,1);
      return {editionId:edition.id,questionId:edition.questionId,lostReply:checkpoint.dropped.receive};
    });
    await step('specific original node output',async()=>{
      await openOperation(primary.operationId);await recoverPendingControls(primary.operationId);
      const view=await snapshot(primary.operationId),choice=view.outputOptions.find(row=>row.nodeId!==null);
      assert(choice);
      const output=await retainedSelection(view,choice.fileId,choice.nodeId);
      const expected=fixture.output(checkpoint.providerJobId,choice.fileId,choice.nodeId);
      assert.equal(output.sha256,sha(expected));assert.equal(output.bytes,expected.length);
      const edition=await receiveOutput(primary.operationId,output,secondEditionLabel);
      checkpoint.nodeOutputId=output.id;checkpoint.nodeEditionId=edition.id;save();
      return {outputId:output.id,fileId:output.fileId,nodeId:output.nodeId,sha256:output.sha256,editionId:edition.id};
    });
    await step('original output download and located reading',async()=>{
      await openOperation(primary.operationId);
      const downloadPromise=page.waitForEvent('download');
      await page.locator('[data-pipeline-output-download="'+checkpoint.outputId+'"]').click();
      const raw=await bodyOfDownload(await downloadPromise),expected=fixture.output(checkpoint.providerJobId,checkpoint.defaultFileId);
      assert.deepEqual(raw,expected);writeFileSync(join(outputDirectory,'retained-original-output.json'),raw,{mode:0o600});
      await page.locator('[data-pipeline-edition="'+checkpoint.editionId+'"]').click();
      await page.locator('#pipelines-current').waitFor({state:'visible'});
      await page.locator('#pipelines-page').fill('2');
      await page.locator('#pipelines-type').fill('NarrativeText');
      await page.locator('#pipelines-query').fill('assumptions');
      await page.locator('#pipelines-apply-filter').click();
      await waitText('#pipelines-element-count','1 matching elements');
      assert((await page.locator('#pipelines-elements').innerText()).includes('assumptions'));
      return {bytes:raw.length,sha256:sha(raw),matchingElements:1,providerDownloads:fixture.summary().counters.download};
    });
    await step('cancellation acknowledgement and provider stop',async()=>{
      let view=await prepared(cancellationLabel,inputs.slice(0,1));checkpoint.cancelOperationId=view.plan.id;save();
      if(view.operation.phase==='PREPARED'){
        await page.locator('#pipelines-review-plan').check();
        const request=await clickAction('#pipelines-submit','submit');await journalComplete('controls',request.body.requestId);
        view=await snapshot(view.plan.id);
      }
      checkpoint.cancelProviderJobId=view.operation.providerJobId;save();
      if(!view.operation.cancel){
        await page.locator('#pipelines-cancel-reason').fill('The reviewed follow-up is no longer required; retain the original completed source job.');
        const request=await clickAction('#pipelines-cancel','cancel');await journalComplete('controls',request.body.requestId);
        view=await snapshot(view.plan.id);
        assert.equal(view.operation.cancel.status,'ACKNOWLEDGED');assert.equal(view.operation.phase,'ACTIVE');
      }
      if(view.operation.phase!=='STOPPED'){
        if(fixture.job(view.operation.providerJobId).status!=='STOPPED')fixture.confirmStop(view.operation.providerJobId);
        const request=await clickAction('#pipelines-refresh-job','refresh');await journalComplete('controls',request.body.requestId);
        view=await snapshot(view.plan.id);
      }
      assert.equal(view.operation.phase,'STOPPED');assert.equal(view.operation.cancel.status,'CONFIRMED');
      assert.equal(fixture.summary().counters.create,2);assert.equal(fixture.summary().counters.cancel,1);
      return {operationId:view.plan.id,providerJobId:view.operation.providerJobId,phase:view.operation.phase,cancel:view.operation.cancel};
    });
    await step('desktop mobile and portable export',async()=>{
      await page.locator('[data-pipeline-edition="'+checkpoint.editionId+'"]').click();
      await page.locator('#pipelines-current').waitFor({state:'visible'});
      await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:join(outputDirectory,'managed-pipelines-desktop.png'),fullPage:true});
      await page.setViewportSize({width:390,height:844});
      const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));
      await page.screenshot({path:join(outputDirectory,'managed-pipelines-mobile.png'),fullPage:true});
      assert(overflow<=1,'The original mobile workspace must fit its 390px viewport');
      const bytes=await api(base()+'/export?format=json',{raw:true});
      writeFileSync(join(outputDirectory,'managed-pipelines.research.json'),bytes,{mode:0o600});
      checkpoint.portableSha256=sha(bytes);save();
      return {portableBytes:bytes.length,portableSha256:sha(bytes),mobileWidth:390,horizontalOverflow:overflow};
    });
    await captureBrowserJournal();
    const provider=fixture.summary();
    assert.deepEqual(provider.errors,[]);assert.equal(provider.counters.create,2);
    assert.equal(provider.counters.cancel,1);assert.equal(provider.counters.download,2);
    atomicJson(join(outputDirectory,'provider-http-result.json'),provider);
    await page.unroute('**/api/dossiers/**/pipelines/**',intercept);intercept=null;
    fixture.close();await app.close();
    restoredApp=await openRestoredWorkspace();activeApp=restoredApp;
    const portable=readFileSync(join(outputDirectory,'managed-pipelines.research.json'));
    assert.equal(sha(portable),checkpoint.portableSha256);
    const reopened=await api('/api/reopen',{method:'POST',body:{portable:JSON.parse(portable.toString('utf8'))}});
    assert.equal(reopened.id,checkpoint.dossierId);
    assert.equal(reopened.editions.length,2);
    assert.equal((await restoredApp.pipelines.configured()).configured,false);
    const restoredUrl=new URL(restoredApp.url),params=new URLSearchParams(restoredUrl.hash.slice(1));
    params.set('dossier',checkpoint.dossierId);restoredUrl.hash=params.toString();
    await page.goto(restoredUrl.href);await page.locator('#pipelines-tab').click();
    await page.locator('[data-pipeline-edition="'+checkpoint.editionId+'"]').click();
    await page.locator('#pipelines-current').waitFor({state:'visible'});
    await waitText('#pipelines-output-summary',checkpoint.providerJobId);
    const review=await api(pipeline('/review'),{method:'POST',body:{selection:{editionId:checkpoint.editionId}}});
    const original=await api(pipeline('/download'),{method:'POST',body:{
      selection:{editionId:checkpoint.editionId},expectedEditionSha256:review.editionSha256,file:'output'},raw:true});
    assert.equal(sha(original),checkpoint.steps.find(row=>row.name==='completed provider output selection').result.sha256);
    writeFileSync(join(outputDirectory,'restored-original-output.json'),original,{mode:0o600});
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:join(outputDirectory,'managed-pipelines-restored.png'),fullPage:true});
    assert.deepEqual(fixture.summary().counters,provider.counters,'Portable reading reuses retained bytes with the original provider source closed');
    assert.deepEqual(pageErrors,[]);
    const result={schema:'stellar-forge.managed-pipelines-native-result.v1',status:'passed',
      providerMode:PIPELINE_NATIVE_SCENARIO.providerMode,sourceIdentity:copy(sourceIdentity),
      providerContract:copy(PIPELINE_NATIVE_SCENARIO.providerContract),startedAt:checkpoint.startedAt,finishedAt:new Date().toISOString(),
      dossierId:checkpoint.dossierId,questionId:checkpoint.questionId,operationId:checkpoint.operationId,
      providerJobId:checkpoint.providerJobId,outputId:checkpoint.outputId,nodeOutputId:checkpoint.nodeOutputId,
      editionIds:[checkpoint.editionId,checkpoint.nodeEditionId],cancelOperationId:checkpoint.cancelOperationId,
      cancelProviderJobId:checkpoint.cancelProviderJobId,steps:checkpoint.steps,
      originalRequests:checkpoint.requests.map(originalRequestSummary),
      providerCounters:provider.counters,launchIntervalsMs:provider.launchIntervalsMs,
      portable:{bytes:portable.length,sha256:sha(portable),restoredRevision:reopened.revision,restoredOutputSha256:sha(original),
        sourceConfigured:false},pageErrors};
    atomicJson(resultPath,result);return result;
  }catch(error){
    checkpoint.failure={at:new Date().toISOString(),code:error.code??'NATIVE_JOURNEY_FAILED',message:error.message};save();
    atomicJson(join(outputDirectory,'managed-pipelines-failure.json'),{
      schema:'stellar-forge.managed-pipelines-native-failure.v1',status:'interrupted',
      sourceIdentity:copy(sourceIdentity),dossierId:checkpoint.dossierId??null,
      operationId:checkpoint.operationId??null,providerJobId:checkpoint.providerJobId??null,
      failure:checkpoint.failure,steps:checkpoint.steps,provider:fixture.summary(),pageErrors,
    });throw error;
  }finally{
    if(intercept)await page.unroute('**/api/dossiers/**/pipelines/**',intercept);
    page.off('pageerror',onPageError);
    await restoredApp?.close();
  }
}
