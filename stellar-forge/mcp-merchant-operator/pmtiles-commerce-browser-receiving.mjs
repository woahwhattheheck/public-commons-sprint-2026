// MIT. Browser continuation of the original paid PMTiles receiving operation.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {isAbsolute,join,resolve} from 'node:path';
import {privateDirectory,readJson} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/store.mjs';
import {retainJson,fileDescriptor,MAX_METADATA_BYTES} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/files.mjs';
import {clone,digest,identifier} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/model.mjs';

const PREFIX='merchant_pmtiles_',SCHEMA='starforge.pmtiles-commerce-browser-receiving.v1';
const toolName=name=>name.startsWith(PREFIX)?name:PREFIX+name;
function bodyOf(response){try{return response.request().postDataJSON();}catch{return null;}}

/**
 * Reopen the two original, completely purchased outputs in the same merchant.
 * The caller retains the funded environment and merchant; this hook owns only
 * its supplied original persistent browser context and its receiving records.
 */
export async function exercisePMTilesCommerceBrowser({root,browserDirectory,openBrowser,call,
  operationId,workspaceId,selection,signal,progress}){
  selection=clone(selection);
  identifier(operationId);identifier(workspaceId);
  assert.ok(isAbsolute(root)&&isAbsolute(browserDirectory));
  assert.equal(typeof openBrowser,'function');assert.equal(typeof call,'function');
  root=resolve(root);browserDirectory=resolve(browserDirectory);
  const input={schema:SCHEMA,operationId,workspaceId,root,browserDirectory,selection};
  const inputSha256=digest(input),steps=join(root,'steps');
  await privateDirectory(root);await privateDirectory(steps);
  await retainJson(join(root,'input.json'),input);
  const optional=async path=>{try{return await readJson(path,MAX_METADATA_BYTES);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
  async function verifyCompleted(value){
    assert.equal(value.inputSha256,inputSha256);assert.equal(value.workspaceId,workspaceId);
    for(const row of value.files){
      assert.ok(isAbsolute(row.path)&&resolve(row.path).startsWith(root+'/'));
      const actual=await fileDescriptor(row.path,{signal});assert.equal(actual.sha256,row.sha256);assert.equal(actual.bytes,row.bytes);
    }
    const current=await call('output_status');
    assert.equal(current.state.active,selection.release.id);assert.equal(current.runtime.state,'STOPPED');
    return {...value,reused:true,currentStatus:current};
  }
  async function finishRecorded(record){
    assert.equal(record.inputSha256,inputSha256);assert.equal(record.workspaceId,workspaceId);
    const resultPath=join(root,'operator-result.json'),files=clone(record.receivingFiles);
    for(const row of files){assert.ok(isAbsolute(row.path)&&resolve(row.path).startsWith(root+'/'));const actual=await fileDescriptor(row.path,{signal});
      assert.equal(actual.bytes,row.bytes);assert.equal(actual.sha256,row.sha256);}
    files.push({path:resultPath,...await fileDescriptor(resultPath,{signal})});
    const result={schema:SCHEMA,status:'PMTILES_COMMERCE_BROWSER_COMPLETE',operationId,workspaceId,inputSha256,
      originalReleaseId:selection.mapReleaseId,sellerReleaseId:selection.release.id,origin:record.origin,
      screenshot:files.find(row=>row.path.endsWith('.png')),files,receipts:record.receipts,
      finalStatus:record.finalStatus,completedAt:record.completedAt};
    await retainJson(join(root,'complete.json'),result);return result;
  }
  const complete=await optional(join(root,'complete.json'));if(complete)return verifyCompleted(complete);
  const operated=await optional(join(root,'operator-result.json'));
  if(operated)return verifyCompleted(await finishRecorded(operated));
  const descriptor=await call('console');
  assert.equal(descriptor.workspaceId,workspaceId);assert.equal(descriptor.workspace,'original');
  const origin=new URL(descriptor.url).origin,contextErrors=[],receipts=[],browserRequests=[];
  let opened,executionError;
  function selectedResponse(response,suffix,predicate=()=>true){
    const body=bodyOf(response);
    return new URL(response.url()).origin===origin&&new URL(response.url()).pathname==='/api/merchant'&&
      body?.tool===toolName(suffix)&&body.workspaceId===workspaceId&&body.args?.workspace==='original'&&predicate(body.args);
  }
  async function currentPage(){
    await opened.page.waitForFunction(id=>document.querySelector('#commercePanel')?.dataset.workspaceId===id&&
      document.querySelector('#commercePanel')?.hidden===false,workspaceId,{timeout:60000});
  }
  async function refresh(){
    const response=opened.page.waitForResponse(value=>selectedResponse(value,'output_workbench',args=>args.section==='summary'),{timeout:3600000});
    await opened.page.locator('#paidRefresh').click();assert.ok((await response).ok());
  }
  async function readButton(button,suffix,predicate){
    signal?.throwIfAborted();
    const waiting=opened.page.waitForResponse(value=>selectedResponse(value,suffix,predicate),{timeout:3600000});
    await opened.page.locator(button).click();const response=await waiting;
    const value=await response.json();assert.ok(response.ok(),JSON.stringify(value));return value;
  }
  async function exactRecord(kind,requestId){
    await opened.page.locator('#paidTabWork').click();
    await opened.page.locator('#paidReadKind').selectOption(kind);
    await opened.page.locator('#paidReadId').fill(requestId);
    const value=await readButton('#paidReadRecord','output_workbench',args=>args.section==='request'&&args.kind===kind&&args.requestId===requestId);
    assert.equal(value.record.requestId,requestId);
    await opened.page.waitForFunction(id=>document.querySelector('#paidRecordDetails')?.textContent.includes(id),requestId);
    return value.record;
  }
  async function idle(){
    await opened.page.waitForFunction(()=>document.querySelector('#commercePanel')?.dataset.operationState!=='RUNNING',null,{timeout:3600000});
  }
  async function recoverPending(){
    await idle();
    if(await opened.page.locator('#paidPendingPanel').isVisible()){
      const pending=await opened.page.evaluate(()=>{
        const panel=document.querySelector('#commercePanel'),id=panel.dataset.workspaceId;
        const keys=Object.keys(localStorage).filter(key=>key.startsWith('starforge.pmtiles-commerce-browser.v1:'+location.origin+':'+id+':'));
        if(keys.length!==1)throw Error('Original browser workspace selection is ambiguous.');
        return JSON.parse(localStorage.getItem(keys[0])).pending;
      });
      assert.equal(pending.workspaceId,workspaceId);assert.equal(pending.args.workspace,'original');
      const accounting=[PREFIX+'purchase_finalize',PREFIX+'purchase_accounting'].includes(pending.tool);
      const suffix=pending.tool===PREFIX+'purchase_run'?'purchase_recover':pending.tool;
      let response;
      if(accounting){
        const waiting=opened.page.waitForResponse(value=>[suffix,PREFIX+'purchase_accounting_recover'].some(name=>
          selectedResponse(value,name,args=>args.purchaseRequestId===pending.args.purchaseRequestId&&args.buyer===pending.args.buyer)),{timeout:3600000});
        await opened.page.locator('#paidResumePending').click();assert.ok((await waiting).ok());await idle();
        response=await call('purchase_accounting_recover',{buyer:pending.args.buyer,purchaseRequestId:pending.args.purchaseRequestId});
      }else response=await readButton('#paidResumePending',suffix,args=>
        args.requestId===pending.args.requestId&&args.purchaseRequestId===pending.args.purchaseRequestId);
      await idle();assert.equal(await opened.page.locator('#paidPendingPanel').isVisible(),false);
      return response;
    }
    return null;
  }
  function validateResult(suffix,args,result){
    if(suffix==='output_prepare')assert.equal(result.manifestSha256,selection.output.manifestSha256);
    else if(suffix==='output_stage')assert.equal(result.result?.digest,selection.release.digest);
    else if(suffix==='output_activate')assert.equal(result.result?.selection?.active,selection.release.id);
    else if(suffix==='output_start'){assert.equal(result.result?.state,'RUNNING');assert.equal(result.result.owned,true);assert.ok(result.result.instanceId);}
    else if(suffix==='output_stop')assert.equal(result.result?.state,'STOPPED');
    else{
      const kind=['map','operations'].find(name=>selection.purchases[name].requestId===(args.requestId??args.purchaseRequestId));
      if(suffix==='purchase_prepare'){assert.ok(kind);assert.equal(result.requestSha256,selection.purchases[kind].requestSha256);}
      else if(suffix==='purchase_run'||suffix==='purchase_recover'){
        assert.ok(kind);assert.equal(result.status,'COMPLETE');assert.equal(result.delivery?.assembly?.sha256,selection.objects[kind].expectedSha256);
        assert.equal(result.delivery.assembly.bytes,selection.objects[kind].bytes);
      }else if(suffix==='purchase_adopt'){assert.equal(result.sha256,selection.objects.map.expectedSha256);assert.equal(result.bytes,selection.objects.map.bytes);}
      else if(suffix==='purchase_receive'){assert.equal(result.status,'COMPLETE');assert.equal(result.archiveSha256,selection.objects.operations.expectedSha256);
        assert.equal(result.originalReceiving?.workspaceDirectory,selection.originalReceiving.workspaceDirectory);}
      else if(suffix==='purchase_accounting_recover'){
        assert.ok(kind);const native=result.accounting?.lastComplete?.native,process=result.accounting?.lastComplete?.process;
        assert.equal(result.requestSha256,selection.purchases[kind].requestSha256);
        assert.equal(native?.kind,'object');assert.equal(native.mode,'FINALIZE');assert.equal(native.interrupted,false);
        assert.equal(process?.exitCode,0);assert.ok(!process.errorCode);
        assert.ok(native.entries.every(row=>['FINALIZED','IDEMPOTENT_FINALIZED'].includes(row.outcome)));
      }else throw Error('Unexpected original browser operation '+suffix);
    }
  }
  async function retainedAction(name,suffix,button,{before,dropResponse=false}={}){
    identifier(name);signal?.throwIfAborted();await progress?.({operationId,phase:'paid-browser-'+name});
    const directory=await privateDirectory(join(steps,name)),requestPath=join(directory,'request.json'),donePath=join(directory,'complete.json');
    const previous=await optional(requestPath),done=await optional(donePath);
    if(done){
      assert.equal(done.inputSha256,inputSha256);assert.ok(previous);assert.equal(done.requestSha256,digest(previous));validateResult(suffix,previous.args,done.result);
      receipts.push({name,path:donePath,result:done.result,reused:true});return done.result;
    }
    if(previous){
      assert.equal(previous.tool,toolName(suffix));assert.equal(previous.workspaceId,workspaceId);assert.equal(previous.args.workspace,'original');
      // The exact accepted request survives a native-carrier interruption. These
      // are the original idempotent mutation/read engines, never a new purchase.
      const result=await call(suffix==='purchase_run'?'purchase_recover':suffix,previous.args);
      validateResult(suffix,previous.args,result);
      const saved={inputSha256,requestSha256:digest(previous),result,recoveredFromOriginalRequest:true};
      await retainJson(donePath,saved);receipts.push({name,path:donePath,result,reused:true});
      await recoverPending();await refresh();return result;
    }
    await recoverPending();await before?.();
    let handled=false,resolveResult,rejectResult;
    const responseReady=new Promise((resolve,reject)=>{resolveResult=resolve;rejectResult=reject;});responseReady.catch(()=>{});
    const routePattern='**/api/merchant';
    const handler=async route=>{
      const request=route.request();
      if(handled||request.method()!=='POST'){await route.continue();return;}
      const body=request.postDataJSON();if(body?.tool!==toolName(suffix)){await route.continue();return;}
      handled=true;
      try{
        assert.equal(body.workspaceId,workspaceId);assert.equal(body.args.workspace,'original');
        await retainJson(requestPath,body);browserRequests.push({name,tool:body.tool,requestSha256:digest(body)});
        const response=await route.fetch({timeout:3600000}),result=await response.json();
        await retainJson(join(directory,'returned-'+randomUUID()+'.json'),{inputSha256,status:response.status(),result});
        assert.ok(response.ok(),JSON.stringify(result));validateResult(suffix,body.args,result);
        await retainJson(donePath,{inputSha256,requestSha256:digest(body),result});
        if(dropResponse)await route.abort('failed');else await route.fulfill({response});
        resolveResult({result,body});
      }catch(error){rejectResult(error);await route.abort('failed').catch(()=>{});}
    };
    await opened.page.route(routePattern,handler);
    let returned;
    try{
      await opened.page.locator(button).click();
      returned=await Promise.race([responseReady,new Promise((_,reject)=>{
        const timer=setTimeout(()=>reject(new Error('The original browser request has no complete native response.')),3600000);
        timer.unref?.();responseReady.finally(()=>clearTimeout(timer)).catch(()=>{});
      })]);
    }finally{await opened.page.unroute(routePattern,handler);}
    await idle();
    if(dropResponse){
      await opened.page.waitForFunction(()=>document.querySelector('#commercePanel')?.dataset.operationState==='RETAINED',null,{timeout:60000});
      const replay=await recoverPending();
      assert.equal(replay.requestId,returned.result.requestId);
      if(returned.result.manifestSha256)assert.equal(replay.manifestSha256,returned.result.manifestSha256);
      await retainJson(join(directory,'browser-recovery.json'),{inputSha256,requestSha256:digest(returned.body),result:replay});
    }else assert.equal(await opened.page.locator('#paidPendingPanel').isVisible(),false);
    receipts.push({name,path:donePath,result:returned.result,reused:false});return returned.result;
  }
  async function selectSeller(id){
    await opened.page.locator('#paidTabSeller').click();
    if(await opened.page.locator('#paidSellerSelect').inputValue()!==id){
      const observed=opened.page.waitForResponse(value=>selectedResponse(value,'output_status'),{timeout:60000});
      await opened.page.locator('#paidSellerSelect').selectOption(id);assert.ok((await observed).ok());
    }
    await opened.page.locator('#paidCompare').waitFor({state:'visible'});
    await readButton('#paidCompare','output_compare',args=>args.releaseId===id);
  }
  async function currentOwnedStart(){
    const status=await call('output_status');
    assert.equal(status.state.active,selection.release.id);
    if(status.runtime.state==='RUNNING'){assert.equal(status.runtime.owned,true);return status.runtime.observed;}
    assert.equal(status.runtime.state,'STOPPED');
    const lifetime=digest(status.runtime.observed?.instanceId??null).slice(0,16);
    await refresh();await selectSeller(selection.release.id);
    const result=await retainedAction('start-'+lifetime,'output_start','#paidStart');
    const now=await call('output_status');assert.equal(now.runtime.state,'RUNNING');assert.equal(now.runtime.owned,true);
    assert.equal(now.runtime.observed.instanceId,result.result.instanceId);return now.runtime.observed;
  }
  try{
    opened=await openBrowser({url:descriptor.url,directory:browserDirectory});
    assert.ok(opened?.page&&opened?.context);await currentPage();
    opened.page.on('pageerror',error=>contextErrors.push(String(error.message)));
    await recoverPending();await refresh();
    const summary=await call('output_workbench',{section:'summary'});
    assert.equal(summary.workspaceId,workspaceId);assert.equal(summary.currentRelease.id,selection.mapReleaseId);
    assert.equal(summary.output.state.active,selection.release.id);
    assert.ok(summary.buyers.some(row=>row.name==='original'&&row.available));
    assert.ok(summary.receivingTargets.includes('customer'));

    // Fill the real authoring controls with both complete original source choices.
    // Reopening the saved preparation below reuses those exact package bytes.
    const draftPath=join(root,'draft-selection.json');
    if(!await optional(draftPath)){
      await opened.page.locator('#paidTabOffer').click();
      await opened.page.locator('#paidUsePublication').click();
      await opened.page.locator('#paidPaymentPreset').selectOption('original');
      await opened.page.locator('#paidOfferId').fill(selection.output.offerId);
      await opened.page.locator('#paidOfferTitle').fill('Original paid regional map draft');
      await opened.page.locator('#paidChunkBytes').fill('921600');
      const rows=await opened.page.locator('#paidObjects tr').count();
      for(let index=rows-1;index>=0;index--)await opened.page.locator('#paidObjects tr').nth(index).getByRole('button',{name:'Remove',exact:true}).click();
      for(const item of [{source:'resource:'+selection.mapResourceId,id:'map',filename:'region.pmtiles',amount:selection.mapAtomic},
        {source:'package:'+selection.packageRequestId,id:'operations',filename:'region-operations.zip',amount:selection.operationsAtomic}]){
        await opened.page.locator('#paidSource').selectOption(item.source);
        await opened.page.locator('#paidAddSource').click();
        const row=opened.page.locator('#paidObjects tr').last();
        await row.locator('input').nth(0).fill(item.id);await row.locator('input').nth(1).fill(item.filename);
        await row.locator('input').nth(2).fill(item.amount);
      }
      await retainJson(draftPath,{inputSha256,offerId:selection.output.offerId,mapResourceId:selection.mapResourceId,
        packageRequestId:selection.packageRequestId});
    }
    const originalOffer=await exactRecord('offer',selection.output.requestId);
    assert.equal(originalOffer.prepared.manifestSha256,selection.output.manifestSha256);
    const replayedOffer=await retainedAction('original-offer-replay','output_prepare','#paidResumeRecord',{dropResponse:true});
    assert.equal(replayedOffer.manifestSha256,selection.output.manifestSha256);

    await opened.page.locator('#paidTabSeller').click();
    const staged=await retainedAction('original-seller-stage','output_stage','#paidStage',{before:async()=>{
      await opened.page.locator('#paidRuntime').selectOption('original');
      await opened.page.locator('#paidSellerId').fill(selection.release.id);
      await opened.page.locator('#paidSellerLabel').fill(selection.release.label);
    }});
    assert.equal(staged.result.digest,selection.release.digest);
    await selectSeller(selection.release.id);
    const activated=await retainedAction('original-seller-activation','output_activate','#paidActivate');
    assert.equal(activated.result.selection.active,selection.release.id);
    const instance=await currentOwnedStart();
    const stopName='stop-'+digest(instance.instanceId).slice(0,16);
    const stopped=await retainedAction(stopName,'output_stop','#paidStop');
    assert.equal(stopped.result.state,'STOPPED');

    const customerResults={};
    for(const kind of ['map','operations']){
      const purchase=selection.purchases[kind],object=selection.objects[kind];
      const original=await exactRecord('purchase',purchase.requestId);
      assert.equal(original.object.expectedSha256,object.expectedSha256);
      const prepared=await retainedAction(kind+'-original-prepare','purchase_prepare','#paidResumeRecord');
      assert.equal(prepared.requestSha256,purchase.requestSha256);
      await opened.page.locator('#paidTabCustomer').click();
      const received=await retainedAction(kind+'-original-delivery','purchase_run','#paidRunPurchase');
      assert.equal(received.delivery.assembly.sha256,object.expectedSha256);
      assert.equal(received.delivery.assembly.bytes,object.bytes);
      if(kind==='map'){
        const adopted=await retainedAction('map-original-adoption','purchase_adopt','#paidAdopt',{before:async()=>{
          await opened.page.locator('#paidAdoptRequestId').fill(selection.adoptRequestId);
        }});
        assert.equal(adopted.sha256,object.expectedSha256);customerResults.adopted=adopted;
      }else{
        const receivedPackage=await retainedAction('operations-original-receiving','purchase_receive','#paidReceive',{before:async()=>{
          await opened.page.locator('#paidTarget').selectOption('customer');
          await opened.page.locator('#paidReceiveRequestId').fill(selection.receivingInput.requestId);
        }});
        assert.equal(receivedPackage.archiveSha256,object.expectedSha256);
        assert.equal(receivedPackage.originalReceiving.workspaceDirectory,selection.originalReceiving.workspaceDirectory);
        customerResults.receiving=receivedPackage;
      }
      if(selection.accounting){
        const originalAccounting=await readButton('#paidRecoverAccounting','purchase_accounting_recover',args=>args.purchaseRequestId===purchase.requestId);
        const native=originalAccounting.accounting.lastComplete?.native;
        assert.equal(native?.kind,'object');assert.equal(native.mode,'FINALIZE');assert.equal(native.interrupted,false);
        await opened.page.locator('#paidAccountOffset').fill(String(native.range.offset));
        await opened.page.locator('#paidAccountLimit').fill(String(native.range.limit));
        // This button reads the original finalizer result first. A matching complete
        // range is reused; a partial command stays in its original native records.
        const finalized=await retainedAction(kind+'-original-accounting','purchase_accounting_recover','#paidFinalizeRange');
        const finalNative=finalized.accounting.lastComplete?.native??finalized.accounting.native;
        assert.deepEqual(finalNative,native);
      }
      customerResults[kind]=received;
    }
    const storagePath=join(root,'browser-storage.json');
    const savedStorage=await optional(storagePath);
    if(savedStorage){
      assert.equal(savedStorage.inputSha256,inputSha256);assert.equal(savedStorage.origin,origin);
      assert.ok(savedStorage.entries&&typeof savedStorage.entries==='object'&&!Array.isArray(savedStorage.entries));
      assert.ok(Object.entries(savedStorage.entries).every(([key,value])=>
        key.startsWith('starforge.pmtiles-commerce-browser.v1:'+origin+':')&&typeof value==='string'));
    }else{
      const saved=await opened.page.evaluate(()=>({origin:location.origin,entries:Object.fromEntries(Object.keys(localStorage)
        .filter(key=>key.startsWith('starforge.pmtiles-commerce-browser.v1:'+location.origin+':')).map(key=>[key,localStorage.getItem(key)]))}));
      await retainJson(storagePath,{inputSha256,...saved});
    }
    await opened.page.locator('#paidTabOffer').click();
    const dirty='Retained original paid map draft '+inputSha256.slice(0,16);
    await opened.page.locator('#paidOfferTitle').fill(dirty);
    const dirtyPrice=(BigInt(selection.mapAtomic)+1n).toString();
    await opened.page.locator('#paidObjects tr').first().locator('input').nth(2).fill(dirtyPrice);
    const oldNotes=await opened.page.locator('#editionNotes').inputValue();
    const oldToken=new URL(descriptor.url).hash.slice('#token='.length);
    await call('close');await call('open');
    const reopened=await call('console');assert.equal(new URL(reopened.url).origin,origin);
    assert.notEqual(new URL(reopened.url).hash,new URL(descriptor.url).hash);
    const rejected=await opened.page.request.get(origin+'/api/merchant',{headers:{Authorization:'Bearer '+oldToken}});
    assert.equal(rejected.status(),401);
    await opened.page.goto(reopened.url,{waitUntil:'domcontentloaded',timeout:30000});await currentPage();
    await opened.page.waitForFunction(value=>document.querySelector('#paidOfferTitle')?.value===value,dirty,{timeout:60000});
    assert.equal(await opened.page.locator('#paidObjects tr').first().locator('input').nth(2).inputValue(),dirtyPrice);
    assert.equal(await opened.page.locator('#editionNotes').inputValue(),oldNotes);
    const finalStatus=await call('output_status');
    assert.equal(finalStatus.state.active,selection.release.id);assert.equal(finalStatus.runtime.state,'STOPPED');
    assert.equal(finalStatus.runtime.owned,false);
    await opened.page.locator('#paidTabCustomer').click();
    await opened.page.screenshot({path:join(root,'paid-map-operator.png'),fullPage:true});
    assert.deepEqual(contextErrors,[]);
    const resultPath=join(root,'operator-result.json'),receivingFiles=[];
    for(const path of [storagePath,join(root,'paid-map-operator.png'),...receipts.map(row=>row.path)])
      receivingFiles.push({path,...await fileDescriptor(path,{signal})});
    const record={inputSha256,workspaceId,origin,originalOffer:replayedOffer,
      originalStage:staged,activation:activated,customerResults,finalStatus,browserRequests,
      draft:{title:dirty,atomicPrice:dirtyPrice,editionNotes:oldNotes},contextErrors,receivingFiles,
      receipts:receipts.map(({name,path,reused})=>({name,path,reused})),completedAt:new Date().toISOString()};
    await retainJson(resultPath,record);return finishRecorded(record);
  }catch(error){executionError=error;throw error;}
  finally{
    try{await opened?.context.close();}
    catch(error){throw new AggregateError([...(executionError?[executionError]:[]),error],
      'The original paid-map browser context still needs its owned close.');}
  }
}
