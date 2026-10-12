// MIT. Operate the original saved Service case through merchant adjustment and buyer receiving.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,open,readFile,rename} from 'node:fs/promises';
import {join,resolve,isAbsolute,basename} from 'node:path';
import {openCaseServiceAdjustments} from './case-service-adjustments.mjs';
import {retainCaseArtifact} from './case-store.mjs';
import {parseWorkspace,serializeWorkspace,workspaceDraft} from './workspace-file.mjs';
import {serviceCanonical,validateServiceRecord} from './service-commitments.mjs';
import {readServiceAdjustments} from './service-adjustments.mjs';
import {newCommissioning} from './commissioning.mjs';
import {validateNativeServiceAdjustmentOutcome} from './service-adjustments-native.mjs';

const OPERATION='SCF-SERVICE-ADJUSTMENT-HANDOVER-24EA-20261012';
const SCHEMA='stellar-forge.service-adjustment-receiving.v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const same=(a,b)=>serviceCanonical(a)===serviceCanonical(b);
const copy=value=>structuredClone(value);
const now=()=>new Date().toISOString();

function requireValue(value,message){if(!value)throw new Error(message);}
async function optional(path){try{return await readFile(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function atomicJSON(path,value){
  const tmp=path+'.'+randomUUID()+'.tmp',file=await open(tmp,'wx',0o600);
  try{await file.writeFile(json(value));await file.sync();}finally{await file.close();}
  await rename(tmp,path);const parent=await open(resolve(path,'..'),constants.O_RDONLY);
  try{await parent.sync();}finally{await parent.close();}
}
async function frozenJSON(path,value){
  const prior=await optional(path);
  if(prior){const original=JSON.parse(prior.toString('utf8'));assert.ok(same(original,value),'The original retained receiving request changed: '+path);return original;}
  await retainCaseArtifact(path,json(value));return copy(value);
}
async function viewContext(store,caseId,revision=null){
  const record=await store.read(caseId,revision),workspace=await parseWorkspace(record.workspaceText);
  const context={caseId,caseRevision:record.revision,workspaceSha256:sha(record.workspaceText),
    service:await validateServiceRecord(workspace.service),commissioning:workspace.commissioning??newCommissioning()};
  return {record,workspace,context,adjustments:await readServiceAdjustments(context)};
}
function selectedInput(value){
  requireValue(value&&typeof value==='object'&&!Array.isArray(value),'Supply the original accounting fixture selection.');
  const allowed=['runId','eventId','amountAtomic','effectiveAt','reason','reference','actor','basis','verification','expectedJob','source'];
  requireValue(Object.keys(value).every(key=>allowed.includes(key)),'The native selection contains an undeclared field.');
  requireValue(UUID.test(value.runId)&&SHA.test(value.eventId),'Select the original accounting run and event.');
  requireValue(/^[1-9][0-9]*$/.test(value.amountAtomic??''),'Select the explicitly reviewed positive atomic amount.');
  requireValue(value.verification&&SHA.test(value.verification.transaction),'Select the already executed original reverse-transfer transaction.');
  requireValue(typeof value.verification.rpcEndpoint==='string'&&value.verification.rpcEndpoint.length>0,'Select its original native RPC endpoint.');
  requireValue(value.basis&&typeof value.basis.reference==='string'&&typeof value.basis.description==='string','Retain the explicit original monetary basis.');
  requireValue(typeof value.actor==='string'&&value.actor.trim(),'Retain the original receiving operator.');
  return copy(value);
}
function compactCase(record){return {id:record.id,revision:record.revision,workspaceSha256:sha(record.workspaceText)};}
function compactOutcome(outcome){return {id:outcome.id,sha256:outcome.sha256,intentId:outcome.intentId,action:outcome.action,
  adjustmentId:outcome.result.adjustment.id,status:outcome.result.adjustment.status,
  ...(outcome.result.job?{jobId:outcome.result.job.id,jobStatus:outcome.result.job.status,transaction:outcome.result.job.transaction}:{}),
  ...(outcome.result.export?{export:outcome.result.export,credits:outcome.result.buyer.credits?.length??0}:{} )};}

/**
 * Reuse the actual original Accounting owner and saved Service case. The caller
 * owns their lifetime and the persistent browser context. The original fixture
 * supplies a real native run/event and its already executed reverse transfer.
 * Re-enter this same directory after an interrupted response or native process.
 */
export async function receiveServiceAdjustments({
  directory,store,accounting,accountingId,caseId,reportId,selection,
  context,sourceUrl,receivingStore,receivingUrl,transfer,buyerReceive,sourceCommit
}){
  requireValue(typeof directory==='string'&&isAbsolute(directory),'Choose the original persistent receiving directory.');
  requireValue(store&&receivingStore&&typeof store.read==='function'&&typeof receivingStore.read==='function','Use the original source and named receiving case stores.');
  requireValue(accounting&&typeof accounting.withServiceAdjustments==='function','Use the already admitted original Accounting owner.');
  requireValue(typeof transfer==='function'&&typeof buyerReceive==='function','Join the complete original case transfer and buyer receiving operation.');
  requireValue(context&&typeof context.newPage==='function','Reuse the actual persistent browser context.');
  requireValue(UUID.test(caseId)&&UUID.test(reportId),'Select the existing Service case and retained report.');
  requireValue(/^[a-f0-9]{40}$/.test(sourceCommit??''),'Retain the complete selected product source commit.');
  const input=selectedInput(selection),root=resolve(directory);
  await mkdir(root,{recursive:true,mode:0o700});
  for(const name of ['requests','files','receiving-validation'])await mkdir(join(root,name),{recursive:true,mode:0o700});
  const checkpointPath=join(root,'service-adjustment-receiving.json'),prior=await optional(checkpointPath);
  const identity={operationId:OPERATION,caseId,reportId,accountingId,selectionSha256:sha(json(input))};
  let saved=prior?JSON.parse(prior.toString('utf8')):null;
  if(saved){
    assert.equal(saved.schema,SCHEMA);assert.deepEqual(saved.identity,identity,'Continue the same original case, accounting selection and request.');
  }else{
    saved={schema:SCHEMA,identity,createdAt:now(),sourceCommits:[],ids:{
      proposal:randomUUID(),proposalRequest:randomUUID(),recordIntent:randomUUID(),recordIntentRequest:randomUUID(),
      recordExecute:randomUUID(),verifyIntent:randomUUID(),verifyIntentRequest:randomUUID(),verifyExecute:randomUUID(),
      captureIntent:randomUUID(),captureIntentRequest:randomUUID(),captureExecute:randomUUID(),
      continuity:randomUUID()
    },phases:{},artifacts:[],browser:{errors:[]}};
  }
  if(!saved.sourceCommits.includes(sourceCommit))saved.sourceCommits.push(sourceCommit);
  const persist=async()=>{saved.updatedAt=now();await atomicJSON(checkpointPath,saved);};
  await persist();await frozenJSON(join(root,'selection.json'),input);
  const phases=saved.phases;
  async function phase(name,operation){
    if(Object.hasOwn(phases,name))return phases[name].result;
    const result=await operation();
    phases[name]={completedAt:now(),result};await persist();
    process.stdout.write(JSON.stringify({event:'service-adjustment-phase',operationId:OPERATION,caseId,name,result})+'\n');
    return result;
  }
  async function request(name,prepare){
    const path=join(root,'requests',name+'.json'),raw=await optional(path);
    if(raw)return JSON.parse(raw.toString('utf8'));
    return frozenJSON(path,await prepare());
  }
  async function artifact(name,body,mediaType='application/json'){
    requireValue(basename(name)===name&&!['.','..'].includes(name),'Use an original native file basename.');
    const bytes=Buffer.isBuffer(body)?body:Buffer.from(body),path=join(root,'files',name);
    await retainCaseArtifact(path,bytes);
    const descriptor={name,path,mediaType,bytes:bytes.length,sha256:sha(bytes)};
    const found=saved.artifacts.find(row=>row.path===path);
    if(found)assert.deepEqual(found,descriptor,'The original receiving artifact changed.');
    else saved.artifacts.push(descriptor);
    return descriptor;
  }
  let api=openCaseServiceAdjustments({store,accounting,directory:join(root,'native')});
  const reopen=async()=>{await api.close();api=openCaseServiceAdjustments({store,accounting,directory:join(root,'native')});};
  let page=null,receivedPage=null;
  const browserErrors=saved.browser.errors,browserAttempt=randomUUID(),browserErrorStart=browserErrors.length;
  function observeBrowser(value,label){
    value.on('pageerror',error=>browserErrors.push({attempt:browserAttempt,sourceCommit,page:label,message:error.message}));
    value.on('crash',()=>browserErrors.push({attempt:browserAttempt,sourceCommit,page:label,message:'Original browser page crashed.'}));
  }
  async function readyCase(value,expectedRevision){
    try{
      await value.waitForFunction(({id,revision})=>{
        const body=document.body,reference=document.getElementById('case-revision'),open=document.getElementById('open-case');
        return body?.dataset.caseReady==='true'&&body.dataset.caseId===id&&
          reference?.textContent.trim()===revision&&open&&!open.disabled;
      },{id:caseId,revision:expectedRevision},{timeout:30_000});
    }catch(error){
      const detail=await value.locator('#message').textContent().catch(()=>null);
      throw new Error('The original adjustment page did not finish opening case '+caseId+' at '+expectedRevision+
        (detail?': '+detail:''),{cause:error});
    }
  }
  async function openAdjustmentPage(value,origin,expectedRevision){
    const target=new URL('/adjustments',origin);target.searchParams.set('case',caseId);
    await value.goto(target.href,{waitUntil:'domcontentloaded'});
    // The real page opens its query-selected case only after IndexedDB recovery,
    // the original case list, source choices and retained report have returned.
    await readyCase(value,expectedRevision);
    assert.equal(await value.locator('#case-picker').inputValue(),caseId);
    await value.locator('#operator-name').fill(input.actor);
    await value.locator('#proposal-picker').selectOption(saved.ids.proposal);
    await readyCase(value,expectedRevision);
    assert.equal(await value.locator('#proposal-picker').inputValue(),saved.ids.proposal);
  }
  async function savedScreenshot(value,label,revision,{mobile=false}={}){
    const name='browser-'+label+'-'+revision.slice(0,10)+'-'+sourceCommit.slice(0,8)+(mobile?'-mobile':'-desktop')+'.png';
    const retained=await optional(join(root,'files',name));
    if(retained)return artifact(name,retained,'image/png');
    const body=await value.screenshot({fullPage:true,animations:'disabled'});
    return artifact(name,body,'image/png');
  }
  async function readDownload(download){
    const stream=await download.createReadStream();
    requireValue(stream,'The browser did not retain its complete original download.');
    const chunks=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));
    const failure=await download.failure();requireValue(failure===null,'The browser download failed: '+failure);
    return Buffer.concat(chunks);
  }
  async function receiveBrowserFile(value,button,{label,originalApi,revision}){
    const nativePath='/api/cases/'+caseId+'/adjustments/download',buyerPath='/api/cases/'+caseId+'/adjustments/buyer-download';
    const caption=(await button.textContent()).trim();
    const [response,download]=await Promise.all([
      value.waitForResponse(response=>{
        const url=new URL(response.url());
        return [nativePath,buyerPath].includes(url.pathname)&&response.request().method()==='POST';
      },{timeout:60_000}),
      value.waitForEvent('download',{timeout:60_000}),
      button.click()
    ]);
    assert.ok(response.ok(),'Original delivery HTTP '+response.status()+': '+caption);
    const requestBody=response.request().postDataJSON(),path=new URL(response.url()).pathname;
    assert.equal(requestBody.revision,revision,'Download the actual opened original case revision.');
    const expected=path===nativePath?
      await originalApi.download({id:caseId,...requestBody}):
      await originalApi.downloadBuyer({id:caseId,...requestBody});
    const bytes=await readDownload(download),headers=response.headers(),actualSha=sha(bytes);
    assert.equal(download.suggestedFilename(),expected.descriptor.filename);
    assert.equal(headers['x-content-sha256'],expected.descriptor.sha256);
    assert.equal(actualSha,expected.descriptor.sha256);
    assert.equal(bytes.length,expected.descriptor.bytes);
    assert.equal(sha(expected.body),actualSha);
    // Original native/accountant files are often already in the complete packet.
    // Keep one exact copy while retaining each actual browser transfer separately.
    const existing=saved.artifacts.find(file=>file.sha256===actualSha&&file.bytes===bytes.length);
    const stored=existing??await artifact(
      'browser-'+label+'-'+sha(json({path,requestBody})).slice(0,12)+'-'+expected.descriptor.filename,
      bytes,expected.descriptor.mediaType);
    await readyCase(value,revision);
    return {caption,path,request:copy(requestBody),suggestedFilename:download.suggestedFilename(),
      mediaType:expected.descriptor.mediaType,bytes:bytes.length,sha256:actualSha,artifact:stored};
  }
  async function reviewBrowserCase(value,origin,{label,originalStore,originalApi,revision}){
    const current=await viewContext(originalStore,caseId,revision);
    await openAdjustmentPage(value,origin,revision);
    await value.locator('#adjustment-report').selectOption(reportId);
    await readyCase(value,revision);
    const report=current.context.service.reports.find(row=>row.id===reportId);
    requireValue(report,'The named receiving case lost the original service report.');
    const ids=report.preview.incidents.map(row=>row.id).sort();
    await value.waitForFunction(expected=>{
      const actual=[...document.querySelectorAll('#incident-options [name=incidentId]')].map(node=>node.value).sort();
      return JSON.stringify(actual)===JSON.stringify(expected);
    },ids,{timeout:30_000});
    const summary=await value.locator('#proposal-summary').textContent();
    assert.ok(summary.includes(input.basis.reference));
    assert.ok(summary.includes(input.eventId));
    assert.equal(await value.locator('#native-history tbody tr').count(),current.adjustments.outcomes.length);
    const buyer=await originalApi.buyerRead({id:caseId,revision});
    assert.equal(await value.locator('#buyer-history tbody tr').count(),buyer.outcomes.length);
    requireValue(buyer.outcomes.length>0,'The original buyer operation has not reached the saved case.');
    const selectedCaptures=current.adjustments.outcomes.filter(row=>row.proposalId===saved.ids.proposal&&row.action==='capture');
    assert.equal(await value.locator('#native-downloads [data-delivery-file]').count(),5+4*selectedCaptures.length);
    requireValue(await value.locator('#buyer-downloads [data-delivery-file]').count()>0,
      'The original accountant delivery files are absent from the receiving UI.');
    const downloads=[];
    for(const selector of ['#native-downloads [data-delivery-file]','#buyer-downloads [data-delivery-file]']){
      const buttons=value.locator(selector),count=await buttons.count();
      for(let index=0;index<count;index++)downloads.push(await receiveBrowserFile(value,buttons.nth(index),{label,originalApi,revision}));
    }
    await value.setViewportSize({width:1440,height:1000});
    const desktop=await savedScreenshot(value,label,revision);
    await value.setViewportSize({width:390,height:844});
    await readyCase(value,revision);
    assert.equal(await value.locator('#proposal-picker').inputValue(),saved.ids.proposal);
    const mobile=await savedScreenshot(value,label,revision,{mobile:true});
    await value.setViewportSize({width:1440,height:1000});
    return {case:compactCase(current.record),reportId,reportSha256:report.sha256,incidents:ids,
      nativeOutcomes:current.adjustments.outcomes.length,buyerOutcomes:buyer.outcomes.length,
      downloads,screenshots:[desktop,mobile]};
  }
  async function recoverRecordInBrowser(){
    if(!page){page=await context.newPage();observeBrowser(page,'source');}
    const priorBody=await optional(join(root,'requests','record-execute.json'));
    let body=priorBody?JSON.parse(priorBody.toString('utf8')):null;
    let firstRaw=await optional(join(root,'files','browser-accepted-record-response.json'));
    if(!body){
      const before=await api.read({id:caseId});
      await openAdjustmentPage(page,sourceUrl,before.case.revision);
      await page.locator('#intent-picker').selectOption(saved.ids.recordIntent);
      const endpoint=new URL('/api/cases/'+caseId+'/adjustments/execute',sourceUrl).href;
      let resolveAccepted,rejectAccepted,timer,handled=false;
      const accepted=new Promise((res,rej)=>{resolveAccepted=res;rejectAccepted=rej;
        timer=setTimeout(()=>rej(new Error('The original browser execution did not return its accepted response.')),90_000);});
      const routeHandler=async route=>{
        if(handled){await route.continue();return;}handled=true;
        try{
          const wire=route.request().postDataJSON();
          assert.equal(wire.intentId,saved.ids.recordIntent);
          assert.ok(UUID.test(wire.requestId),'The browser must retain its original request UUID.');
          body={id:caseId,...wire};saved.ids.recordExecute=wire.requestId;
          await frozenJSON(join(root,'requests','record-execute.json'),body);await persist();
          const response=await route.fetch(),raw=await response.body();
          if(response.status()<200||response.status()>=300){
            await route.fulfill({response});
            throw new Error('Original execute HTTP '+response.status()+': '+raw.toString('utf8'));
          }
          const value=JSON.parse(raw.toString('utf8'));
          assert.equal(value.material.intentId,saved.ids.recordIntent);
          await artifact('browser-accepted-record-response.json',raw);
          saved.browser.acceptedRecordResponse={requestId:wire.requestId,materialId:value.material.id,
            materialSha256:value.material.sha256,status:response.status(),observedAt:now()};
          await persist();
          await route.abort('failed');
          saved.browser.recordResponseDropped=true;await persist();
          resolveAccepted(value);
        }catch(error){rejectAccepted(error);await route.abort('failed').catch(()=>{});}
      };
      await page.route(endpoint,routeHandler);
      try{
        await Promise.all([accepted,page.locator('#execute-intent').click()]);
      }finally{clearTimeout(timer);await page.unroute(endpoint,routeHandler);}
      firstRaw=await readFile(join(root,'files','browser-accepted-record-response.json'));
    }
    requireValue(body&&body.intentId===saved.ids.recordIntent,'Continue the exact original browser/native request.');
    const before=await api.read({id:caseId});
    await openAdjustmentPage(page,sourceUrl,before.case.revision);
    await page.locator('#intent-picker').selectOption(saved.ids.recordIntent);
    const pending=page.locator('#pending-retry');
    let recovered;
    // A retained browser profile exposes the original pending action. A runtime
    // that lost only its profile still resumes the same request from this
    // operation's durable source/case checkpoint.
    if(await pending.isVisible()&&await pending.isEnabled()){
      const endpoint=new URL('/api/cases/'+caseId+'/adjustments/execute',sourceUrl).href;
      let seen=false;
      const verify=async route=>{
        const wire=route.request().postDataJSON();
        assert.deepEqual({id:caseId,...wire},body,'Browser recovery must reuse the exact original execution request.');
        seen=true;await route.continue();
      };
      await page.route(endpoint,verify);
      try{
        const [response]=await Promise.all([
          page.waitForResponse(response=>response.url()===endpoint&&response.request().method()==='POST',{timeout:90_000}),
          pending.click()
        ]);
        assert.ok(response.ok(),'Original browser retry returned HTTP '+response.status());
        recovered=await response.json();assert.equal(seen,true);
        saved.browser.recordRecovery='persistent-browser-original-pending';
      }finally{await page.unroute(endpoint,verify);}
    }else{
      await reopen();recovered=await api.execute(body);
      saved.browser.recordRecovery='retained-original-native-request';
    }
    // The process may have stopped after its request was retained but before
    // route.fetch sent it. In that window the same request accepts once, then
    // its original receipt must reopen without a second native record.
    if(!recovered.replayed){
      const confirmed=await api.execute(body);
      assert.equal(confirmed.replayed,true);
      assert.equal(confirmed.material.id,recovered.material.id);
      assert.equal(confirmed.material.sha256,recovered.material.sha256);
      saved.browser.recordRecovery+='-first-acceptance-reopened';
      recovered=confirmed;
    }
    assert.equal(recovered.replayed,true);
    if(firstRaw){
      const first=JSON.parse(firstRaw.toString('utf8'));
      assert.equal(recovered.material.id,first.material.id);
      assert.equal(recovered.material.sha256,first.material.sha256);
    }
    await persist();return recovered;
  }
  try{
    await phase('original-service-and-payment',async()=>{
      const before=await viewContext(store,caseId),report=before.context.service.reports.find(row=>row.id===reportId);
      requireValue(report&&report.preview.incidents.length,'Choose a complete retained Service report with original incident observations.');
      const event=await api.accountingOperation('event',{accountingId,runId:input.runId,eventId:input.eventId});
      assert.equal(event.event.eventId,input.eventId);assert.equal(event.source.runId,input.runId);
      requireValue(event.refundTerms&&event.originalProof,'The selected native payment has no original return terms/proof.');
      await artifact('original-service-report.json',json(report));
      await artifact('original-native-payment.json',json(event));
      return {case:compactCase(before.record),reportId:report.id,reportSha256:report.sha256,
        incidentIds:report.preview.incidents.map(row=>row.id),source:event.source,
        network:event.event.network,asset:event.refundTerms.asset,originalAmountAtomic:event.event.amountAtomic};
    });
    const original=phases['original-service-and-payment'].result;
    const proposalRequest=await request('proposal-preview',async()=>{
      const before=await api.read({id:caseId});
      return {id:caseId,expectedRevision:before.case.revision,input:{
        id:saved.ids.proposal,reportId,reportSha256:original.reportSha256,
        incidentIds:original.incidentIds,basis:input.basis,accountingId,actor:input.actor,
        request:{runId:input.runId,eventId:input.eventId,kind:'REFUND',amountAtomic:input.amountAtomic,
          effectiveAt:input.effectiveAt,reason:input.reason,reference:input.reference}
      }};
    });
    const proposalFile=join(root,'requests','reviewed-proposal.json');
    let proposalRaw=await optional(proposalFile),proposal;
    if(proposalRaw)proposal=JSON.parse(proposalRaw.toString('utf8'));
    else{
      const existing=await api.read({id:caseId});
      if(existing.proposals.some(row=>row.id===saved.ids.proposal)){
        proposal=(await api.read({id:caseId,section:'proposals',recordId:saved.ids.proposal})).records[0];
      }else{
        const reviewed=await api.preview(proposalRequest);proposal=reviewed.proposal;
      }
      await frozenJSON(proposalFile,proposal);
    }
    await phase('reviewed-proposal-retained',async()=>{
      const body=await request('proposal-retain',async()=>{
        const before=await api.read({id:caseId});
        return {id:caseId,expectedRevision:before.case.revision,expectedImplementationRevision:before.revision,
          requestId:saved.ids.proposalRequest,material:proposal};
      });
      const result=await api.retain(body);
      assert.equal(result.material.sha256,proposal.sha256);
      const replay=await api.retain(body);assert.equal(replay.replayed,true);
      assert.equal(replay.material.sha256,proposal.sha256);
      return {proposalId:proposal.id,proposalSha256:proposal.sha256,case:result.case,replay:true};
    });

    // Keep an actual unrelated, unfinished Service form in the same case while
    // the original native adjustment is prepared and executed.
    await phase('unfinished-service-form-retained',async()=>{
      const before=await viewContext(store,caseId);
      const marker={operationId:OPERATION,id:saved.ids.continuity,note:'Follow up on this original service adjustment in the next customer report.'};
      const existing=before.context.service.draft?.adjustmentReceiving;
      if(existing)assert.deepEqual(existing,marker);
      else{
        const service={...before.context.service,draft:{...before.context.service.draft,adjustmentReceiving:marker}};
        const workspaceText=await serializeWorkspace(workspaceDraft(before.workspace,{service}),{now:before.workspace.savedAt});
        await store.save({id:caseId,expectedRevision:before.record.revision,workspaceText,
          supportText:before.record.supportText,metadata:before.record.metadata});
      }
      const current=await viewContext(store,caseId);
      assert.deepEqual(current.context.service.draft.adjustmentReceiving,marker);
      return {case:compactCase(current.record),marker};
    });

    async function savedIntent(action,idKey,requestKey,prepareInput,retainedName=action+'-intent'){
      const body=await request(retainedName,async()=>{
        const before=await api.read({id:caseId}),specific=await prepareInput();
        const prepared=await api.prepareIntent({id:caseId,expectedRevision:before.case.revision,
          input:{id:saved.ids[idKey],proposalId:proposal.id,action,actor:input.actor,input:specific}});
        return {id:caseId,expectedRevision:prepared.case.revision,expectedImplementationRevision:prepared.revision,
          requestId:saved.ids[requestKey],material:prepared.intent};
      });
      const result=await api.retain(body);assert.equal(result.material.id,saved.ids[idKey]);
      return result.material;
    }
    await phase('record-intent-retained',async()=>{
      const intent=await savedIntent('record','recordIntent','recordIntentRequest',async()=>({}));
      return {id:intent.id,sha256:intent.sha256};
    });
    await phase('native-record-response-recovered',async()=>{
      const recovered=await recoverRecordInBrowser();
      const native=await accounting.withServiceAdjustments(accountingId,controller=>controller.detail(proposal.id));
      assert.equal(native.adjustment.id,proposal.id);
      assert.equal(native.adjustment.history.filter(row=>row.action==='RECORDED').length,1);
      const after=await viewContext(store,caseId);
      assert.deepEqual(after.context.service.draft.adjustmentReceiving,phases['unfinished-service-form-retained'].result.marker);
      return {...compactOutcome(recovered.material),case:compactCase(after.record),sameRequestReplayed:true,nativeRecords:1,
        acceptedResponseDropped:saved.browser.recordResponseDropped===true,recovery:saved.browser.recordRecovery};
    });

    await phase('returned-transfer-intent-retained',async()=>{
      const intent=await savedIntent('verify','verifyIntent','verifyIntentRequest',async()=>{
        const state=await accounting.withServiceAdjustments(accountingId,controller=>controller.view());
        return {revision:state.revision,transaction:input.verification.transaction,rpcEndpoint:input.verification.rpcEndpoint};
      });
      return {id:intent.id,sha256:intent.sha256,transaction:intent.request.transaction,rpcEndpoint:intent.request.rpcEndpoint};
    });
    await phase('original-returned-transfer-received',async()=>{
      let body=await request('verify-execute',async()=>({id:caseId,intentId:saved.ids.verifyIntent,requestId:saved.ids.verifyExecute}));
      let observed=await api.execute(body),value;
      const attempts=[],visited=new Set();
      while(true){
        const intentId=body.intentId,jobId=observed.material.result.job.id;
        // An accepted case response is immutable. Read the actual original job
        // before deciding whether that earlier observation still needs a wait.
        const job=await accounting.withServiceAdjustments(accountingId,async controller=>{
          requireValue(typeof controller.savedJob==='function','Read the original retained verification job.');
          let retained=await controller.savedJob(jobId);
          if(['QUEUED','RUNNING'].includes(retained.status)){
            requireValue(typeof controller.waitForJob==='function','Continue the original saved verification job.');
            await controller.waitForJob(jobId);retained=await controller.savedJob(jobId);
          }
          return retained;
        });
        assert.equal(job.id,jobId);assert.equal(job.transaction,input.verification.transaction);
        // Retain a distinct exact observation request for this actual native
        // state. Replaying the first execute must keep its earlier response.
        const refresh=await request('verify-observe-'+intentId+'-'+sha(json(job)).slice(0,24),
          async()=>({id:caseId,intentId,requestId:randomUUID()}));
        const current=await api.execute(refresh);value=current.material;
        assert.equal(value.result.job.id,jobId);
        attempts.push({intentId,jobId,status:value.result.job.status,observationRequestId:refresh.requestId});
        // The native owner may recover a completed proof between review and an
        // explicit retry. That same completed job is the accepted original.
        if(value.result.job.status==='COMPLETED')break;
        requireValue(!visited.has(jobId),'The original interrupted verification returned a repeated unfinished job in its recovery chain.');
        visited.add(jobId);
        requireValue(value.result.job.status==='INTERRUPTED',
          'Original returned-transfer verification ended '+value.result.job.status+': '+JSON.stringify(value.result.job.error));
        // The original engine explicitly marks a process-lost read INTERRUPTED.
        // Its retry is a new reviewed intent naming that original job; it never
        // creates another adjustment or changes the selected reverse transfer.
        const key='verifyRetry-'+jobId;
        for(const suffix of ['Intent','IntentRequest','Execute'])
          saved.ids[key+suffix]??=randomUUID();
        await persist();
        const intent=await savedIntent('verify',key+'Intent',key+'IntentRequest',async()=>{
          const state=await accounting.withServiceAdjustments(accountingId,controller=>controller.view());
          return {revision:state.revision,transaction:input.verification.transaction,
            rpcEndpoint:input.verification.rpcEndpoint,retryJobId:jobId};
        },key+'-intent');
        body=await request(key+'-execute',async()=>({id:caseId,intentId:intent.id,requestId:saved.ids[key+'Execute']}));
        observed=await api.execute(body);
      }
      requireValue(value.result.adjustment.status==='VERIFIED',
        'The original native verification did not produce a verified returned transfer: '+value.result.adjustment.status);
      assert.equal(value.result.job.transaction,input.verification.transaction);
      await reopen();
      const original=await request('verify-execute',async()=>{throw new Error('Original verification request is missing.');});
      const replay=await api.execute(original);assert.equal(replay.replayed,true);
      const retained=(await viewContext(store,caseId)).adjustments;
      for(const attempt of attempts){
        const jobs=new Set(retained.outcomes.filter(row=>row.intentId===attempt.intentId).map(row=>row.result.job.id));
        assert.deepEqual([...jobs],[attempt.jobId],'Each exact native intent must retain its one original job.');
      }
      const native=await accounting.withServiceAdjustments(accountingId,controller=>controller.detail(proposal.id));
      const jobs=native.adjustment.history.filter(row=>row.action==='VERIFICATION_REQUESTED'&&row.transaction===input.verification.transaction);
      const nativeJobIds=new Set(attempts.map(row=>row.jobId));
      assert.equal(jobs.length,nativeJobIds.size,'Only the original verification and explicit interrupted-job recoveries may dispatch.');
      return {...compactOutcome(value),sameOriginalJob:true,originalRequestReplay:replay.material.id,
        nativeJobs:nativeJobIds.size,interruptedJobsRecovered:new Set(attempts.filter(row=>row.status==='INTERRUPTED').map(row=>row.jobId)).size,attempts};
    });

    await phase('buyer-capture-intent-retained',async()=>{
      const intent=await savedIntent('capture','captureIntent','captureIntentRequest',async()=>({expectedJob:input.expectedJob??null}));
      return {id:intent.id,sha256:intent.sha256};
    });
    await phase('complete-native-buyer-capture',async()=>{
      const body=await request('capture-execute',async()=>({id:caseId,intentId:saved.ids.captureIntent,requestId:saved.ids.captureExecute}));
      const first=await api.execute(body);await reopen();const replay=await api.execute(body);
      assert.equal(replay.replayed,true);assert.equal(first.material.sha256,replay.material.sha256);
      const capture=first.material.result;
      assert.equal(capture.buyer.source_identity.event_id,input.eventId);
      assert.equal(capture.export.sha256,capture.buyer.source_sha256);
      requireValue(capture.buyer.credits?.some(row=>row.adjustment_id===proposal.id),
        'The original buyer compiler did not retain the selected verified adjustment credit.');
      return {...compactOutcome(first.material),case:first.case,buyerSourceIdentity:capture.buyer.source_identity};
    });

    let current=await viewContext(store,caseId);
    const captureId=phases['complete-native-buyer-capture'].result.id;
    const capture=current.adjustments.outcomes.find(row=>row.id===captureId);
    requireValue(capture,'The saved original capture is missing from the case.');
    await phase('native-and-buyer-source-files',async()=>{
      const selected=await request('delivery-selection',async()=>({
        id:caseId,revision:current.record.revision,proposalId:proposal.id,proposalSha256:proposal.sha256,outcomeId:captureId
      }));
      const delivered=[];
      for(const kind of ['service-report','native-json','native-csv','native-html','buyer-source']){
        const args={...selected,kind};
        const result=await api.download(args),descriptor=await artifact(result.descriptor.filename,result.body,result.descriptor.mediaType);
        assert.equal(descriptor.sha256,result.descriptor.sha256);assert.equal(descriptor.bytes,result.descriptor.bytes);
        delivered.push({kind,...descriptor});
      }
      return {caseRevision:selected.revision,files:delivered};
    });
    await phase('original-buyer-accountant-received',async()=>{
      const files=phases['native-and-buyer-source-files'].result.files;
      const result=await buyerReceive({
        directory:join(root,'buyer'),caseId,caseRevision:phases['native-and-buyer-source-files'].result.caseRevision,
        proposalId:proposal.id,outcomeId:captureId,sourceCommit,
        capture:copy(capture.result.buyer),capturePath:files.find(row=>row.kind==='buyer-source').path,
        nativeFilePath:files.find(row=>row.kind==='native-json').path,expectedJob:input.expectedJob??null
      });
      requireValue(result&&typeof result==='object','The original buyer/accountant receiver returned no complete result.');
      assert.equal(result.case?.id,caseId);assert.equal(result.capture?.id,captureId);
      assert.equal(result.capture?.sha256,capture.sha256);
      assert.equal(result.capture?.sourceSha256,capture.result.export.sha256);
      requireValue(result.credits?.some(row=>row.adjustmentId===proposal.id),
        'The original buyer receiver did not retain the selected adjustment credit.');
      requireValue(result.period?.closeId&&result.period?.reviewId&&result.accountant?.handoffId,
        'The original buyer/accountant operation has not completed its issued close and accountant handover.');
      requireValue(Array.isArray(result.artifacts)&&result.artifacts.length>0,
        'The original buyer/accountant operation returned no complete delivery files.');
      for(const file of result.artifacts){
        requireValue(isAbsolute(file.path)&&SHA.test(file.sha256),'The buyer receiver must return its original retained file identity.');
        const bytes=await readFile(file.path);
        assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);
      }
      const descriptor=await artifact('buyer-accountant-receiving.json',json(result));
      return {artifact:descriptor,result};
    });

    await phase('complete-case-with-buyer-records',async()=>{
      const selected=await request('complete-case-selection',async()=>{
        const latest=await viewContext(store,caseId);
        return {id:caseId,revision:latest.record.revision,proposalId:proposal.id,proposalSha256:proposal.sha256};
      });
      const files=[];
      for(const kind of ['handover','customer-html','case','workspace']){
        const result=await api.download({...selected,kind});
        const file=await artifact('complete-'+result.descriptor.filename,result.body,result.descriptor.mediaType);
        assert.equal(file.sha256,result.descriptor.sha256);files.push({kind,...file});
      }
      const selectedCase=await viewContext(store,caseId,selected.revision);
      return {case:compactCase(selectedCase.record),files};
    });
    await phase('named-case-received',async()=>{
      const selected=phases['complete-case-with-buyer-records'].result.case;
      current=await viewContext(store,caseId);
      assert.equal(current.record.revision,selected.revision,'Complete this original source case transfer before editing the selected case again.');
      const accepted=await transfer({caseId,revision:selected.revision});
      assert.equal(accepted.caseId,caseId,'Receiving must preserve the original case UUID.');
      const received=await viewContext(receivingStore,caseId);
      assert.equal(received.record.revision,accepted.revision);
      assert.equal(received.record.workspaceText,current.record.workspaceText);
      assert.equal(received.record.supportText,current.record.supportText);
      assert.deepEqual(received.record.metadata,current.record.metadata);
      assert.deepEqual(received.adjustments,current.adjustments);
      for(const outcome of received.adjustments.outcomes.filter(row=>row.proposalId===proposal.id)){
        await validateNativeServiceAdjustmentOutcome(received.context,outcome,{directory:join(root,'receiving-validation',outcome.id)});
      }
      const receivedApi=openCaseServiceAdjustments({store:receivingStore,directory:join(root,'receiving-native')});
      try{
        const originalBuyer=await api.buyerRead({id:caseId,revision:current.record.revision}),
          receivedBuyer=await receivedApi.buyerRead({id:caseId,revision:received.record.revision});
        assert.equal(receivedBuyer.schema,originalBuyer.schema);
        assert.equal(receivedBuyer.revision,originalBuyer.revision);
        assert.deepEqual(receivedBuyer.captures,originalBuyer.captures);
        assert.deepEqual(receivedBuyer.intents,originalBuyer.intents);
        assert.deepEqual(receivedBuyer.outcomes,originalBuyer.outcomes);
        for(const originalFile of phases['native-and-buyer-source-files'].result.files){
          const file=await receivedApi.download({id:caseId,revision:received.record.revision,
            proposalId:proposal.id,proposalSha256:proposal.sha256,outcomeId:captureId,kind:originalFile.kind});
          assert.equal(file.descriptor.sha256,originalFile.sha256);
          assert.equal(file.descriptor.bytes,originalFile.bytes);
        }
      }finally{await receivedApi.close();}
      await artifact('received-complete-case.json',json(received.record));
      return {source:compactCase(current.record),receiver:compactCase(received.record),
        proposals:received.adjustments.proposals.length,intents:received.adjustments.intents.length,outcomes:received.adjustments.outcomes.length};
    });

    await phase('browser-complete-case-and-files',async()=>{
      const selected=phases['named-case-received'].result;
      if(!page){page=await context.newPage();observeBrowser(page,'source');}
      const original=await reviewBrowserCase(page,sourceUrl,{
        label:'source',originalStore:store,originalApi:api,revision:selected.source.revision
      });
      receivedPage=await context.newPage();observeBrowser(receivedPage,'receiver');
      const receivedApi=openCaseServiceAdjustments({store:receivingStore,directory:join(root,'receiving-native')});
      let received;
      try{
        received=await reviewBrowserCase(receivedPage,receivingUrl,{
          label:'receiver',originalStore:receivingStore,originalApi:receivedApi,revision:selected.receiver.revision
        });
      }finally{await receivedApi.close();}
      assert.equal(original.reportSha256,received.reportSha256);
      assert.deepEqual(original.incidents,received.incidents);
      assert.equal(original.downloads.length,received.downloads.length);
      for(const sourceFile of original.downloads){
        const match=received.downloads.find(file=>file.path===sourceFile.path&&
          file.request.kind===sourceFile.request.kind&&file.request.outcomeId===sourceFile.request.outcomeId&&
          file.request.name===sourceFile.request.name);
        requireValue(match,'The receiving page lost an original customer, native or accountant file.');
        // Case references and the customer summary identify the actual receiving
        // store revision; original workspace/source/accountant bytes stay exact.
        if(!['handover','case','customer-html'].includes(sourceFile.request.kind)){
          assert.equal(match.bytes,sourceFile.bytes);assert.equal(match.sha256,sourceFile.sha256);
        }
      }
      const errors=browserErrors.slice(browserErrorStart);
      assert.deepEqual(errors,[],'The operated browser encountered an uncaught error.');
      return {source:original,receiver:received,originalFileDownloads:true,uncaughtErrors:errors};
    });
    await phase('files-reopened',async()=>{
      for(const file of saved.artifacts){const raw=await readFile(file.path);assert.equal(raw.length,file.bytes);assert.equal(sha(raw),file.sha256);}
      return {files:saved.artifacts.length,allOriginalBytes:true};
    });
    assert.deepEqual(browserErrors.slice(browserErrorStart),[],'The original browser operation ended with an uncaught error.');
    saved.result='PASS';saved.completedAt=now();delete saved.lastError;await persist();
    const result={schema:SCHEMA,operationId:OPERATION,result:'PASS',caseId,reportId,accountingId,sourceCommits:saved.sourceCommits,
      proposalId:proposal.id,captureOutcomeId:captureId,phases:copy(saved.phases),artifacts:copy(saved.artifacts),browser:copy(saved.browser)};
    await atomicJSON(join(root,'service-adjustment-result.json'),result);
    return result;
  }catch(error){
    saved.result='INTERRUPTED';saved.lastError={at:now(),name:error.name,code:error.code??null,message:error.message};
    await persist();throw error;
  }finally{
    if(page&&!page.isClosed())await page.close().catch(()=>{});
    if(receivedPage&&!receivedPage.isClosed())await receivedPage.close().catch(()=>{});
    await api.close();
  }
}
