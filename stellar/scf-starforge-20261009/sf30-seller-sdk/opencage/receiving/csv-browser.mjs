// MIT. Receive the original OpenCage CSV workbench through its actual browser and retained APIs.
import assert from 'node:assert/strict';
import {readFile,mkdir,open,rename,link,unlink,realpath} from 'node:fs/promises';
import {resolve,dirname,basename,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const SCHEMA='stellar-forge.opencage-csv-browser-receiving.v1';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const NOTE='Reviewed original provider candidate for source row 1 in the retained CSV customer delivery.';
const RETRY_NOTE='Recover the configured source using its retained original provider capture.';
function same(actual,expected,label){assert.deepEqual(actual,expected,label);}
async function bytesIf(file){try{return await readFile(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function sync(directory){const handle=await open(directory,'r');try{await handle.sync();}finally{await handle.close();}}
async function publish(file,bytes,{replace=false}={}){
  await mkdir(dirname(file),{recursive:true,mode:0o700});
  const previous=await bytesIf(file);if(previous?.equals(bytes))return;
  if(previous&&!replace)throw Error('A retained receiving file has different bytes: '+basename(file));
  const temporary=file+'.'+randomUUID()+'.tmp';
  try{
    const handle=await open(temporary,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
    if(replace)await rename(temporary,file);
    else {try{await link(temporary,file);}catch(error){if(error.code!=='EEXIST')throw error;same(await readFile(file),bytes,'Retain the original published receiving file');}}
    await sync(dirname(file));
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
function selectedServer(value){
  const url=new URL(value);
  assert.equal(url.protocol,'http:');assert(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
  assert(/^[a-f0-9]{64}$/.test(url.hash.slice(1)),'Use the original private server URL');
  return {url:url.href,origin:url.origin,token:url.hash.slice(1)};
}
function safeRelative(value){
  assert(typeof value==='string'&&value&&!value.startsWith('/')&&!value.includes('\\')&&!value.split('/').some(part=>!part||part==='.'||part==='..'));
  return value;
}

/** The parent owns the existing browser, native admission, workspace and both original servers. */
export async function exerciseCsvBrowser({browser,operatorUrl,outputDirectory,csv,retry,onRetryPrepared,openCustomer}){
  assert(browser&&typeof browser.newContext==='function');
  assert(csv&&typeof csv.fileName==='string'&&csv.fileName===basename(csv.fileName));
  assert(typeof csv.productId==='string'&&typeof csv.reuseRequestId==='string');
  assert(csv.mapping?.queryColumn&&Object.keys(csv.mapping.optionColumns??{}).length===0,
    'This receiving fixture uses the retained query column and fixed original options');
  assert(typeof onRetryPrepared==='function'&&typeof openCustomer==='function');
  assert(retry&&typeof retry.batchId==='string'&&Number.isInteger(retry.ordinal)&&retry.ordinal>0);
  const bytes=Buffer.from(csv.bytes),out=resolve(outputDirectory),operator=selectedServer(operatorUrl);
  assert(bytes.length>0&&bytes.length<=2097152);
  await mkdir(out,{recursive:true,mode:0o700});assert.equal(await realpath(out),out);
  const ownSource=await readFile(new URL(import.meta.url));
  const selection={sourceSha256:sha(ownSource),csvSha256:sha(bytes),csvBytes:bytes.length,fileName:csv.fileName,
    productId:csv.productId,mapping:csv.mapping,reuseRequestId:csv.reuseRequestId,retry:{batchId:retry.batchId,ordinal:retry.ordinal}};
  const journalPath=resolve(out,'CSV_Browser_Receiving.json'),old=await bytesIf(journalPath);
  const journal=old?JSON.parse(old):{schema:SCHEMA,selection,phases:{},downloads:[],screenshots:[],failures:[]};
  assert.equal(journal.schema,SCHEMA);same(journal.selection,selection,'Resume the exact selected browser/source fixture');
  for(const file of [...journal.downloads,...journal.screenshots]){
    const actual=await readFile(resolve(out,safeRelative(file.path)));
    assert.equal(actual.length,file.bytes);assert.equal(sha(actual),file.sha256);
  }
  const save=()=>publish(journalPath,json(journal),{replace:true});
  const phase=async(name,value)=>{journal.phases[name]=value;await save();return value;};
  await save();
  const context=await browser.newContext({viewport:{width:1360,height:950},acceptDownloads:true});
  const page=await context.newPage();page.setDefaultTimeout(30000);
  let customer=null;
  const scrub=value=>String(value).replaceAll(operator.token,'[private token]').replace(/#[a-f0-9]{64}/g,'#[private token]').slice(0,1200);
  const pageErrors=[];page.on('pageerror',error=>pageErrors.push(scrub(error.message)));
  async function idle(target){
    await target.waitForFunction(()=>document.body&&!document.body.hasAttribute('aria-busy'));
    const notice=target.locator('#notice.error');
    if(await notice.isVisible())throw Error(await notice.innerText());
  }
  async function get(target,server,path){
    const response=await target.request.get(new URL(path,server.origin).href,{headers:{authorization:'Bearer '+server.token}});
    assert(response.ok(),'Original receiving GET '+path.split('?')[0]+' returned '+response.status());
    return response.json();
  }
  async function postClick(target,button,path){
    const pending=target.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===path);
    await button.click();const response=await pending,value=await response.json();
    assert(response.ok(),'Original '+path+' returned '+response.status()+': '+(value.message??value.error??''));
    await idle(target);return value;
  }
  async function click(target,button){await button.click();await idle(target);}
  async function openOperator(){
    await page.goto(operator.url,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#batch-product')?.options.length>0);
    await page.locator('nav button[data-view="batches"]').click();
    await page.locator('#view-batches').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('#batch-select')?.options.length>0);
    await idle(page);
  }
  async function chooseBatch(id){
    await page.locator('#batch-select').selectOption(id);
    await page.waitForFunction(id=>document.querySelector('#batch-record-id')?.textContent===id,id);
    await idle(page);
  }
  async function row(target,ordinal){
    await click(target,target.getByRole('button',{name:'Review source row '+ordinal,exact:true}));
    await target.waitForFunction(ordinal=>document.querySelector('#batch-row-id')?.textContent.startsWith('Source row '+ordinal+' ·'),ordinal);
    return JSON.parse(await target.locator('#batch-row-native').textContent());
  }
  async function captureDownload(target,button,relative,expected){
    safeRelative(relative);const pending=target.waitForEvent('download');
    await button.click();const download=await pending;
    const failure=await download.failure();assert.equal(failure,null);
    const temporary=resolve(out,'.download-'+randomUUID());
    try{
      await download.saveAs(temporary);const actual=await readFile(temporary);
      if(expected?.bytes!==undefined)assert.equal(actual.length,expected.bytes,relative);
      if(expected?.sha256)assert.equal(sha(actual),expected.sha256,relative);
      const file=resolve(out,relative);assert(file.startsWith(out+sep));await publish(file,actual);
      const record={path:relative,name:download.suggestedFilename(),bytes:actual.length,sha256:sha(actual)};
      const previous=journal.downloads.find(item=>item.path===relative);
      if(previous)same(record,previous,'Reuse the exact browser download');
      else {journal.downloads.push(record);await save();}
      await idle(target);return {record,bytes:actual};
    }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
  async function screenshot(target,name,width,height){
    await target.setViewportSize({width,height});await target.locator('#view-batches').waitFor({state:'visible'});
    const relative='screenshots/'+safeRelative(name),file=resolve(out,relative);
    const previous=journal.screenshots.find(item=>item.path===relative);
    if(previous)return previous;
    const retained=await bytesIf(file),actual=retained??await target.screenshot({fullPage:true});
    assert(actual.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Use the retained browser PNG');
    if(!retained)await publish(file,actual);
    const record={path:relative,bytes:actual.length,sha256:sha(actual),width,height,reusedPublishedImage:Boolean(retained)};
    journal.screenshots.push(record);await save();return record;
  }
  async function currentBatch(id){return get(page,operator,'/api/batch?'+new URLSearchParams({batchId:id,offset:0,limit:50}));}
  async function waitStopped(id){
    const started=Date.now();let value;
    do {
      value=await currentBatch(id);
      if(!value.active)return value;
      assert(Date.now()-started<90000,'The retained batch did not finish its current run');
      await new Promise(resolve=>setTimeout(resolve,1000));
    }while(true);
  }
  async function refresh(){await click(page,page.locator('#batch-refresh'));}
  async function downloadDelivery(target,server,exportId,label,expectedManifest=null){
    const native=await get(target,server,'/api/batch-delivery?'+new URLSearchParams({exportId,offset:0,limit:50}));
    if(expectedManifest)same(native.manifest,expectedManifest,'Reopen the same customer delivery manifest');
    const manifest=native.manifest;
    assert.equal(manifest.counts.rows,52);assert.equal(manifest.counts.selected,1);assert.equal(manifest.counts.invalid,2);
    assert.equal(manifest.sourceSha256,selection.csvSha256);
    const downloaded=await captureDownload(target,target.locator('#batch-download-manifest'),label+'/manifest.json');
    same(JSON.parse(downloaded.bytes),manifest,'Download the selected original manifest');
    for(const file of manifest.files){
      await captureDownload(target,target.getByRole('button',{name:'Download '+file.name,exact:true}),
        label+'/'+safeRelative(file.name),file);
    }
    return native;
  }
  try{
    await openOperator();
    if(!journal.phases.intake){
      await page.locator('#batch-file').setInputFiles({name:csv.fileName,mimeType:'text/csv',buffer:bytes});
      const source=await postClick(page,page.locator('#batch-load-source'),'/api/batch/source');
      same(source.headers,['customer_id','query','note'],'Use the actual original source columns');
      assert.equal(source.sourceSha256,selection.csvSha256);assert.equal(source.rowCount,52);
      await page.locator('#batch-product').selectOption(csv.productId);
      await page.locator('#batch-id-column').selectOption(csv.mapping.idColumn??'');
      await page.locator('#batch-query-mode').selectOption('query');
      await page.locator('#batch-query-column').selectOption(csv.mapping.queryColumn);
      await page.locator('#batch-options').fill(JSON.stringify(csv.mapping.options??{}));
      await page.locator('#batch-reuse').fill(csv.reuseRequestId);
      const label='Original captured OpenCage CSV customer delivery';
      await page.locator('#batch-label').fill(label);
      let review=await postClick(page,page.locator('#batch-review'),'/api/batch/review');
      await page.locator('#batch-label').fill(label+' revised');
      assert(await page.locator('#batch-prepare').isDisabled(),'An edited input invalidates the reviewed preparation');
      await page.locator('#batch-label').fill(label);
      review=await postClick(page,page.locator('#batch-review'),'/api/batch/review');
      assert.equal(review.rowCount,52);assert.equal(review.validRows,50);assert.equal(review.invalidRows,2);
      assert.equal(review.uniqueQueries,1);assert.equal(review.estimatedFreshQueries,0);
      same(review.reuse.map(item=>item.requestId),[csv.reuseRequestId]);
      const prepared=await postClick(page,page.locator('#batch-prepare'),'/api/batch/prepare');
      assert.equal(prepared.review.reviewSha256,review.reviewSha256);
      await phase('intake',{batchId:prepared.batchId,reviewSha256:review.reviewSha256,sourceSha256:review.sourceSha256,
        rows:review.rowCount,valid:review.validRows,invalid:review.invalidRows,estimatedFreshQueries:review.estimatedFreshQueries});
    }
    const batchId=journal.phases.intake.batchId;assert.notEqual(batchId,retry.batchId);
    await chooseBatch(batchId);let status=await currentBatch(batchId);
    assert.equal(status.review.sourceSha256,selection.csvSha256);assert.equal(status.review.reviewSha256,journal.phases.intake.reviewSha256);
    if(!journal.phases.run){
      const runs=[];let stopped=false;
      if(status.active){status=await waitStopped(batchId);await refresh();}
      if((status.counts.READY??0)>0){
        const started=await postClick(page,page.locator('#batch-start'),'/api/batch/start');
        runs.push({runId:started.runId,state:started.state});journal.activeRun={batchId,runId:started.runId};await save();
        if(await page.locator('#batch-stop').isEnabled()){
          await postClick(page,page.locator('#batch-stop'),'/api/batch/stop');
          status=await waitStopped(batchId);stopped=status.run?.state==='STOPPED';await refresh();
        }else status=await waitStopped(batchId);
      }
      await postClick(page,page.locator('#batch-reconcile'),'/api/batch/reconcile');
      status=await currentBatch(batchId);await refresh();
      if((status.counts.READY??0)>0){
        const started=await postClick(page,page.locator('#batch-start'),'/api/batch/start');
        runs.push({runId:started.runId,state:started.state});journal.activeRun={batchId,runId:started.runId};await save();
      }
      status=await waitStopped(batchId);await refresh();
      assert.equal(status.counts.READY??0,0);assert.equal(status.counts.CANDIDATES,50);assert.equal(status.counts.INVALID,2);
      assert.equal(status.counts.EXCEPTION??0,0);assert.equal(status.counts.NEEDS_RECONCILIATION??0,0);
      delete journal.activeRun;await phase('run',{runs,stopped,finalRun:status.run,counts:status.counts});
    }
    await refresh();
    if(!journal.phases.paging){
      assert.equal(await page.locator('#batch-rows > tr').count(),50);
      await click(page,page.locator('#batch-next'));
      assert.equal(await page.locator('#batch-rows > tr').count(),2);
      const invalid=await row(page,51),columnError=await row(page,52);
      assert(invalid.row.error&&columnError.row.error);assert.equal(invalid.result,null);assert.equal(columnError.result,null);
      await click(page,page.locator('#batch-prev'));
      const raw=await captureDownload(page,page.locator('#batch-source-download'),'operator/source.csv',
        {bytes:bytes.length,sha256:selection.csvSha256});
      same(raw.bytes,bytes,'Keep the original quoted, multiline and formula-like CSV bytes');
      await phase('paging',{firstPage:50,secondPage:2,invalidOrdinals:[51,52],source:raw.record});
    }
    let selected=await row(page,1);
    assert.equal(selected.status,'CANDIDATES');assert(selected.result.candidates.length>0);
    if(selected.result.decision.current?.index!==0||selected.result.decision.current?.note!==NOTE){
      await page.getByRole('radio',{name:'Choose batch candidate 0',exact:true}).check();
      await page.locator('#batch-decision-note').fill(NOTE);
      selected=await postClick(page,page.locator('#batch-save-choice'),'/api/batch/select');
    }
    assert.equal(selected.result.decision.current.index,0);assert.equal(selected.result.decision.current.note,NOTE);
    const other=await row(page,2);
    assert.notEqual(other.requestId,selected.requestId,'Duplicate customer IDs retain independent row decisions');
    assert.equal(other.result.decision.current?.index??null,null);
    const captureFiles=selected.result.files;
    assert(Array.isArray(captureFiles),'Use the file list from the original verified capture');
    const expectedCapture=captureFiles.find(file=>file.name==='capture.json');
    const expectedResponse=captureFiles.find(file=>file.name==='response.json');
    assert(expectedCapture&&expectedResponse);assert.equal(expectedResponse.sha256,selected.result.responseSha256);
    await row(page,1);
    await captureDownload(page,page.locator('#batch-capture-download'),'operator/row-1-capture.json',expectedCapture);
    await captureDownload(page,page.locator('#batch-response-download'),'operator/row-1-response.json',expectedResponse);
    await phase('decision',{row:1,requestId:selected.requestId,responseSha256:selected.result.responseSha256,
      captureIdentity:selected.result.captureIdentity,decision:selected.result.decision.current,
      decisionRevision:selected.result.decision.revision,otherRow:{ordinal:2,requestId:other.requestId,selectedIndex:null}});
    await screenshot(page,'operator-1360.png',1360,950);
    await screenshot(page,'operator-390.png',390,844);await page.setViewportSize({width:1360,height:950});
    let exportId=journal.phases.export?.exportId;
    if(!exportId){
      const exported=await postClick(page,page.locator('#batch-export'),'/api/batch/export');
      exportId=exported.exportId;await phase('export',{exportId,identity:exported.manifest.identity,revision:exported.manifest.revision});
    }else {
      await page.locator('#batch-delivery-select').selectOption(exportId);await idle(page);
      await click(page,page.locator('#batch-open-delivery'));
    }
    const delivered=await downloadDelivery(page,operator,exportId,'operator/delivery');
    const savedSelected=await row(page,1);assert.equal(savedSelected.result.decision.current.index,0);
    await captureDownload(page,page.locator('#batch-capture-download'),'operator/saved-row-1-capture.json',expectedCapture);
    await captureDownload(page,page.locator('#batch-response-download'),'operator/saved-row-1-response.json',expectedResponse);
    await openOperator();await chooseBatch(batchId);
    await page.locator('#batch-delivery-select').selectOption(exportId);await idle(page);
    await click(page,page.locator('#batch-open-delivery'));
    same(JSON.parse(await page.locator('#batch-delivery-native').textContent()),delivered.manifest);
    await phase('operatorReopen',{batchId,exportId,identity:delivered.identity});

    await click(page,page.locator('#batch-return-live'));await chooseBatch(retry.batchId);
    let retryRow=await row(page,retry.ordinal);
    if(!journal.phases.retryIntent){
      assert(['EXCEPTION','NEEDS_RECONCILIATION','NO_RESULTS'].includes(retryRow.status),'Use the retained original failed attempt');
      await phase('retryIntent',{batchId:retry.batchId,ordinal:retry.ordinal,reason:RETRY_NOTE,
        previous:{requestId:retryRow.requestId,attempt:retryRow.attempt,status:retryRow.status,
          responseSha256:retryRow.result?.responseSha256??null}});
    }
    if(!journal.phases.retryPrepared){
      const previous=journal.phases.retryIntent.previous;
      if(retryRow.requestId===previous.requestId&&retryRow.attempt===previous.attempt){
        assert(['EXCEPTION','NEEDS_RECONCILIATION','NO_RESULTS'].includes(retryRow.status),'Review the original failed attempt');
        await page.locator('#batch-retry-reason').fill(RETRY_NOTE);
        if(await page.locator('#batch-uncertain-label').isVisible())await page.locator('#batch-retry-uncertain').check();
        retryRow=await postClick(page,page.locator('#batch-retry'),'/api/batch/retry');
      }else {
        const original=await get(page,operator,'/api/batch?'+new URLSearchParams({
          batchId:retry.batchId,offset:retry.ordinal-1,limit:1}));
        const source=original.rows.find(item=>item.ordinal===retry.ordinal);
        const retained=source?.attempts?.find(item=>item.attempt===retryRow.attempt);
        assert(retained&&retained.requestId===retryRow.requestId&&retained.previousRequestId===previous.requestId&&retained.reason===RETRY_NOTE,
          'Recover the same original reviewed retry receipt after a journal interruption');
      }
      assert.equal(retryRow.attempt,previous.attempt+1);assert.notEqual(retryRow.requestId,previous.requestId);
      await phase('retryPrepared',{batchId:retry.batchId,ordinal:retry.ordinal,previous,requestId:retryRow.requestId,attempt:retryRow.attempt});
    }
    same({requestId:retryRow.requestId,attempt:retryRow.attempt},
      {requestId:journal.phases.retryPrepared.requestId,attempt:journal.phases.retryPrepared.attempt});
    if(!retryRow.result?.captureIdentity){
      await onRetryPrepared({requestId:retryRow.requestId,batchId:retry.batchId,ordinal:retry.ordinal});
    }
    await postClick(page,page.locator('#batch-reconcile'),'/api/batch/reconcile');
    retryRow=await row(page,retry.ordinal);
    assert.equal(retryRow.status,'CANDIDATES');assert.equal(retryRow.result.responseSha256,selected.result.responseSha256);
    assert.equal(retryRow.attempt,journal.phases.retryPrepared.attempt);
    await phase('retryRecovered',{batchId:retry.batchId,ordinal:retry.ordinal,requestId:retryRow.requestId,
      attempt:retryRow.attempt,responseSha256:retryRow.result.responseSha256,captureIdentity:retryRow.result.captureIdentity});
    await screenshot(page,'retry-1360.png',1360,950);

    const opened=await openCustomer(exportId);customer=selectedServer(opened.url);
    const customerPage=await context.newPage();customerPage.setDefaultTimeout(30000);
    customerPage.on('pageerror',error=>pageErrors.push(scrub(error.message).replaceAll(customer.token,'[private token]')));
    await customerPage.goto(customer.url,{waitUntil:'domcontentloaded'});
    await customerPage.waitForFunction(id=>document.querySelector('#batch-record-id')?.textContent===id,exportId);
    const customerState=await get(customerPage,customer,'/api/workspace');
    assert.equal(customerState.readOnly,true);assert.equal(customerState.batchDelivery.exportId,exportId);
    assert(await customerPage.locator('#batch-intake').isHidden());assert(await customerPage.locator('#batch-live-actions').isHidden());
    assert(await customerPage.locator('#batch-export-controls').isHidden());
    const received=await downloadDelivery(customerPage,customer,exportId,'customer/delivery',delivered.manifest);
    const customerRow=await row(customerPage,1);
    assert.equal(customerRow.result.decision.current.index,0);assert(await customerPage.locator('#batch-decision-controls').isHidden());
    await captureDownload(customerPage,customerPage.locator('#batch-capture-download'),'customer/row-1-capture.json',expectedCapture);
    await captureDownload(customerPage,customerPage.locator('#batch-response-download'),'customer/row-1-response.json',expectedResponse);
    await click(customerPage,customerPage.locator('#batch-next'));
    assert.equal(await customerPage.locator('#batch-rows > tr').count(),2);
    const savedInvalid=await row(customerPage,52);assert(savedInvalid.source.error);assert.equal(savedInvalid.result,null);
    await click(customerPage,customerPage.locator('#batch-prev'));
    await screenshot(customerPage,'customer-1360.png',1360,950);
    await screenshot(customerPage,'customer-390.png',390,844);
    await customerPage.reload({waitUntil:'domcontentloaded'});
    await customerPage.waitForFunction(id=>document.querySelector('#batch-record-id')?.textContent===id,exportId);
    same((await get(customerPage,customer,'/api/workspace')).batchDelivery.manifest,delivered.manifest);
    assert.equal(pageErrors.length,0,'Original operator/customer browser page errors: '+pageErrors.join('; '));
    await phase('customer',{exportId,identity:received.identity,batchId,rows:received.total,readOnly:true,reopened:true});
    journal.state='COMPLETE';journal.completedAt=new Date().toISOString();await save();
    return {...journal,outputDirectory:out,reportPath:journalPath};
  }catch(error){
    journal.state='INTERRUPTED';journal.failures.push({at:new Date().toISOString(),message:scrub(error.message),pageErrors});
    try{await save();}catch(publication){throw new AggregateError([error,publication],'The browser receiving failure and its local report publication both failed');}
    throw error;
  }finally{await context.close();}
}
