#!/usr/bin/env node
// MIT. Continue the original repository tariff operation through customer receiving.
// Native pricing, case, commissioning, package, restore and file-read engines own state.
import assert from 'node:assert/strict';
import {readFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {openCaseStore,retainCaseArtifact} from '../case-store.mjs';
import {serializeWorkspace} from '../workspace-file.mjs';
import {openCaseCommercial,commercialWorkspaceId} from '../case-commercial.mjs';
import {emptyCommercialDraft} from '../commercial-quote.mjs';
import {commercialCli} from '../commercial-cli.mjs';
import {readPrivateFile} from '../../sf93-seller-support-bundle/incident-store.mjs';
import {openCommercialTariffController} from './tariff-controller.mjs';
import {commercialTariffCli} from './tariff-cli.mjs';
import {createCommercialTariffClient} from './tariff-client.mjs';
import {start as startSupport} from '../server.mjs';
import {merchantCommercialTariffs} from '../../../../stellar-forge/mcp-merchant-operator/support-commercial-tariffs.mjs';
import {RetainedFileReads} from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';

const OPERATION_SCHEMA='stellar-forge.merchant-tariff-customer-operation.v1';
const RESULT_SCHEMA='stellar-forge.merchant-tariff-customer-result.v1';
const ROOT=resolve(fileURLToPath(new URL('../',import.meta.url)));
const PRICING_ROOT=resolve(ROOT,'../sf97-merchant-revenue-ops');
const SOURCE_COMMIT='f89885a893dcfe66a05bdc51ca2b4a00f7848c8e';
const FIXTURES={
  'illustrative-service.json':'e882bac9ecf5f68ed47a23b097969bd0aded40c0',
  'illustrative-native-shape-snapshot.json':'fdcd6a2621003c90398430d1bef02283fd57243d',
  'example-terms.json':'fd37ff4d0c6cdd9eea42c102edaf2b81f0de25e7',
};
const ACTOR='Original repository Tariff customer receiver';
const HASH=/^[a-f0-9]{64}$/;
const json=value=>JSON.stringify(value,null,2)+'\n';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const amount=value=>value.includes('.')?value.replace(/0+$/,'').replace(/\.$/,''):value;
function path(value,label){
  assert.ok(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&value!=='/',
    'Choose the original absolute '+label+' directory.');
  return value;
}
async function directory(value){
  await mkdir(value,{recursive:true,mode:0o700});
  const stat=await lstat(value);
  assert.ok(stat.isDirectory()&&!stat.isSymbolicLink()&&await realpath(value)===value&&!(stat.mode&0o077),
    'Use an original private real directory.');
}
async function readJSON(file){
  const bytes=Buffer.from(await readPrivateFile(file,64*1024*1024));
  return {bytes,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};
}
async function optionalJSON(file){
  try{return await readJSON(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function retainJSON(file,value){
  const body=Buffer.from(json(value));await retainCaseArtifact(file,body);return value;
}
async function retained(file,create){
  const previous=await optionalJSON(file);
  if(previous)return previous.value;
  return retainJSON(file,await create());
}
function selectedQuote(view,id){
  const value=view.quotes.find(row=>row.id===id);
  assert.ok(value,'Reopen the original saved quote.');
  return value;
}
async function completeDownload(file,value){
  const body=Buffer.from(value.body??value.bytes),descriptor=value.descriptor;
  assert.equal(body.length,descriptor.bytes);assert.equal(sha(body),descriptor.sha256);
  await retainCaseArtifact(file,body);
  return {...descriptor,path:file};
}
async function httpJSON(url,route,body){
  const base=new URL(url);
  const response=await fetch(new URL(route,base),{
    method:body===undefined?'GET':'POST',redirect:'error',cache:'no-store',
    headers:{origin:base.origin,...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:json(body)}),signal:AbortSignal.timeout(120000),
  });
  const result=await response.json();
  assert.equal(response.status,200,json(result));
  return result;
}

/** This is a customer continuation of the existing completed native fixture run. */
export async function runTariffCommercialReceiving({nativeRun,output,python=process.env.SCF_PYTHON||'python3'}={}){
  process.umask(0o077);
  nativeRun=path(nativeRun,'native run');output=path(output,'customer operation');
  assert.equal(await realpath(nativeRun),nativeRun);
  assert.notEqual(nativeRun,output);
  await directory(output);
  const nativeOperation=await readJSON(join(nativeRun,'operation.json'));
  const nativeResult=await readJSON(join(nativeRun,'flow-result.json'));
  const selectionRequest=await readJSON(join(nativeRun,'selection-request.json'));
  assert.equal(nativeOperation.value.schema,'stellar-forge.merchant-tariff-native-operation.v1');
  assert.equal(nativeResult.value.schema,'stellar-forge.merchant-tariff-native-result.v1');
  assert.equal(nativeResult.value.status,'COMPLETE');
  assert.equal(resolve(nativeResult.value.operationDirectory),nativeRun);
  const nativePricingRoot=path(nativeResult.value.sourceRoot,'original pricing source');
  assert.equal(await realpath(nativePricingRoot),nativePricingRoot);
  assert.equal(resolve(nativeOperation.value.sourceRoot),nativePricingRoot);
  assert.equal(selectionRequest.value.pricingRequestId,nativeOperation.value.pricingRequestId);
  assert.equal(selectionRequest.value.planRequestId,nativeOperation.value.scenarioRequestId);
  assert.equal(nativeResult.value.selected.quantity,'1250');
  const fixtures=[];
  for(const [name,expected]of Object.entries(FIXTURES)){
    const bytes=await readFile(join(PRICING_ROOT,name));
    assert.equal(git(bytes),expected,'Keep the unchanged original '+name);
    fixtures.push({name,gitBlob:expected,bytes:bytes.length,sha256:sha(bytes)});
  }
  assert.deepEqual(nativeResult.value.sourceFiles,nativeOperation.value.sourceFiles);
  for(const file of nativeResult.value.sourceFiles){
    const bytes=await readFile(join(nativePricingRoot,file.name));
    assert.equal(git(bytes),file.gitBlob,'Retain the original native tariff source: '+file.name);
    assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);
  }
  const binding={
    nativeRun,output,sourceCommit:SOURCE_COMMIT,pricingSourceRoot:PRICING_ROOT,
    nativePricingSourceRoot:nativePricingRoot,
    nativeOperationSha256:sha(nativeOperation.bytes),nativeResultSha256:sha(nativeResult.bytes),
    selectionRequestSha256:sha(selectionRequest.bytes),selectionRequestId:nativeOperation.value.pricingRequestId,
    backupRequestId:nativeOperation.value.backupRequestId,fixtures,
  };
  const operation=await retained(join(output,'operation.json'),async()=>({
    schema:OPERATION_SCHEMA,createdAt:new Date().toISOString(),binding,
    caseId:randomUUID(),pricingRequestId:randomUUID(),backupAttachmentRequestId:randomUUID(),
    tariffAttachmentRequestId:randomUUID(),draftRequestId:randomUUID(),quoteRequestId:randomUUID(),
    revisedQuoteRequestId:randomUUID(),receiveRequestId:randomUUID(),recipientDraftRequestId:randomUUID(),
  }));
  assert.equal(operation.schema,OPERATION_SCHEMA);assert.deepEqual(operation.binding,binding);
  const casesDirectory=join(output,'cases'),receivedCasesDirectory=join(output,'received-cases');
  const requests=join(output,'requests'),downloads=join(output,'downloads');
  await directory(requests);await directory(downloads);
  const store=await openCaseStore(casesDirectory);
  const scope={workspaceId:commercialWorkspaceId(casesDirectory),caseId:operation.caseId};
  const metadata={merchant:'Repository fixture recipient',owner:ACTOR,status:'new',
    nextAction:'Receive the complete original tariff pricing and customer package.',
    notes:'Same original repository native operation; selected tariff and request history are retained.'};
  const initialText=await serializeWorkspace({
    name:'Repository fixture tariff customer',inputs:{},sources:{},
  },{now:operation.createdAt});
  try{
    const current=await store.read(operation.caseId);
    assert.equal(current.name,'Repository fixture tariff customer');
    assert.equal(current.metadata.owner,ACTOR);
  }catch(error){
    if(error.code!=='CASE_NOT_FOUND')throw error;
    await store.save({id:operation.caseId,expectedRevision:null,workspaceText:initialText,supportText:null,metadata});
  }
  const request=async(name,create)=>retained(join(requests,name+'.json'),create);
  const record=async(name,value)=>retained(join(output,name+'.json'),async()=>value);
  const originalPricing={
    pricingDirectory:join(nativeRun,'pricing'),pricingConfig:join(PRICING_ROOT,'illustrative-service.json'),
    pricingSnapshot:join(PRICING_ROOT,'illustrative-native-shape-snapshot.json'),
  };
  const captureDirectory=join(output,'source');
  const captureRequest=await request('capture',async()=>({
    id:operation.caseId,scope,...originalPricing,selectionRequestId:binding.selectionRequestId,
    backupRequestId:binding.backupRequestId,directory:captureDirectory,
  }));
  const captureCommand=await commercialTariffCli(['capture','--cases-dir',casesDirectory,
    '--input',join(requests,'capture.json'),'--report',join(output,'capture-command.json')]);
  const captured=captureCommand.result.result;
  assert.ok(HASH.test(captured.sourceSha256));
  assert.equal(captured.tariff.selectionRequestId,binding.selectionRequestId);
  assert.equal(captured.tariff.selectedQuantity,'1250');
  assert.equal(captured.pricing.backup.sha256,nativeResult.value.originalBackup.sha256,
    'Reuse the original completed native backup.');
  const controller=openCommercialTariffController({store,casesDirectory});
  let support,recipientSupport,recipientController,mcp,reads;
  try{
    const originalSelection=await controller.call('selection',{
      id:operation.caseId,scope,...originalPricing,selectionRequestId:binding.selectionRequestId,
    });
    assert.equal(originalSelection.result.selection.id,binding.selectionRequestId);
    // Reopen the complete capture using only retained native identities. No authoring path is required.
    const captureReplay=await controller.call('capture',{
      id:operation.caseId,scope,selectionRequestId:binding.selectionRequestId,
      backupRequestId:binding.backupRequestId,directory:captureDirectory,
    });
    assert.equal(captureReplay.result.sourceSha256,captured.sourceSha256);
    const inspected=await controller.call('inspect',{
      id:operation.caseId,scope,directory:captureDirectory,expectedSourceSha256:captured.sourceSha256,
    });
    assert.equal(inspected.result.tariff.id,captured.tariff.id);
    await request('attach',async()=>({
      id:operation.caseId,scope,expectedRevision:(await store.read(operation.caseId)).revision,
      directory:captureDirectory,expectedSourceSha256:captured.sourceSha256,
      pricingRequestId:operation.pricingRequestId,backupAttachmentRequestId:operation.backupAttachmentRequestId,
      tariffAttachmentRequestId:operation.tariffAttachmentRequestId,actor:ACTOR,
      bindingReason:'Original repository tariff selection and its complete native pricing backup.',
    }));
    const attachArgs=['attach','--cases-dir',casesDirectory,'--input',join(requests,'attach.json'),
      '--report',join(output,'attach-command.json')];
    const attached=(await commercialTariffCli(attachArgs)).result.result;
    assert.equal(attached.tariffSourceId,captured.tariff.id);
    const attachmentReplay=(await commercialTariffCli(attachArgs)).result.result;
    assert.equal(attachmentReplay.tariffSourceId,attached.tariffSourceId);
    assert.equal(attachmentReplay.tariffReplayed,true);
    const commercial=openCaseCommercial({store,workspaceId:scope.workspaceId});
    const draft=await request('quote-draft',async()=>{
      const value=emptyCommercialDraft();
      value.title='Repository fixture tariff quotation';
      value.customer.name='Repository fixture recipient';
      value.pricingSourceId=captured.pricing.sourceId;value.tariffSourceId=captured.tariff.id;
      value.pricing.routes=[{routeId:captured.tariff.routeId,monthlyRequests:'1250'}];
      value.terms.scope='A monthly route-use quotation from the original saved graduated tariff selection.';
      value.terms.deliverables='The saved quotation, complete pricing workspace backup, tariff portfolio and original customer case.';
      value.terms.payment='Monthly modeled usage at the saved uniform route rate.';
      value.terms.acceptance='Receive and reopen the complete original package with its saved quote and tariff basis.';
      value.notes='Repository fixture customer receiving.';
      return value;
    });
    const draftRequest=await request('save-draft',async()=>({
      id:operation.caseId,scope,expectedRevision:(await store.read(operation.caseId)).revision,
      requestId:operation.draftRequestId,actor:ACTOR,draft,
    }));
    await commercial.saveDraft(draftRequest);
    const baseReview=await commercial.preview({
      id:operation.caseId,scope,expectedRevision:(await store.read(operation.caseId)).revision,draft,
    });
    assert.equal(amount(baseReview.review.totals.routeUsageUsd),'14.25');
    const quoteRequest=await request('publish',async()=>({
      id:operation.caseId,scope,expectedRevision:baseReview.revision,requestId:operation.quoteRequestId,
      actor:ACTOR,draft,reviewSha256:baseReview.review.reviewSha256,parentId:null,
    }));
    const published=await commercial.publish(quoteRequest);
    assert.equal(published.quote.id,operation.quoteRequestId);
    assert.equal((await commercial.publish(quoteRequest)).replayed,true);
    const zero=clone(draft);zero.pricing.routes[0].monthlyRequests='0';
    const zeroReview=await commercial.preview({
      id:operation.caseId,scope,expectedRevision:(await store.read(operation.caseId)).revision,draft:zero,
    });
    assert.equal(amount(zeroReview.review.totals.routeUsageUsd),'0');
    assert.equal(zeroReview.review.sourceBindings.tariff.basis.derivedUnitAtQuotedQuantityUsd,null);
    assert.ok(!zeroReview.review.customerDocument.includes('USD null'));
    const revised=await request('revised-draft',async()=>{
      const value=clone(draft);value.parentId=operation.quoteRequestId;
      value.title='Repository fixture tariff quotation / volume revision';
      value.pricing.routes[0].monthlyRequests='1500';return value;
    });
    const changedReview=await commercial.preview({
      id:operation.caseId,scope,expectedRevision:(await store.read(operation.caseId)).revision,draft:revised,
    });
    assert.equal(amount(changedReview.review.totals.routeUsageUsd),'17.1');
    assert.equal(amount(changedReview.review.sourceBindings.tariff.basis.tariffGrossAtQuotedQuantityUsd),'16.5');
    assert.equal(changedReview.review.sourceBindings.tariff.basis.changedQuantity,true);
    const revisedRequest=await request('publish-revision',async()=>({
      id:operation.caseId,scope,expectedRevision:changedReview.revision,
      requestId:operation.revisedQuoteRequestId,actor:ACTOR,draft:revised,
      reviewSha256:changedReview.review.reviewSha256,parentId:operation.quoteRequestId,
    }));
    const revisedPublished=await commercial.publish(revisedRequest);
    assert.equal((await commercial.publish(revisedRequest)).replayed,true);
    const quote=revisedPublished.quote;
    const comparison=await commercial.compare({
      id:operation.caseId,scope,expectedRevision:(await store.read(operation.caseId)).revision,
      beforeId:operation.quoteRequestId,afterId:operation.revisedQuoteRequestId,
    });
    await record('quote-comparison',comparison);
    const quoteFile=await completeDownload(join(downloads,'customer-quote.md'),await commercial.download({
      id:operation.caseId,scope,quoteId:quote.id,quoteSha256:quote.sha256,kind:'QUOTE',
    }));
    const exportRequest=await request('export',async()=>({
      id:operation.caseId,revision:(await store.read(operation.caseId)).revision,
      exportId:'tariff-customer-'+operation.caseId,generatedAt:operation.createdAt,
      directory:join(output,'package'),
    }));
    const exportArgs=['export','--cases-dir',casesDirectory,'--case',exportRequest.id,
      '--revision',exportRequest.revision,'--out',exportRequest.directory,
      '--export-id',exportRequest.exportId,'--generated-at',exportRequest.generatedAt,'--python',python];
    const exported=await commercialCli(exportArgs);
    assert.equal(exported.caseSource.state,'COMPLETE');
    const exportReplay=await commercialCli(exportArgs);
    assert.equal(exportReplay.caseSource.manifestSha256,exported.caseSource.manifestSha256);
    const packageReview=await commercialCli(['inspect-package','--from',exportRequest.directory,
      '--sha256',exported.caseSource.manifestSha256,'--python',python]);
    assert.equal(packageReview.case.id,operation.caseId);
    const receiveArgs=['receive-package','--from',exportRequest.directory,
      '--sha256',exported.caseSource.manifestSha256,'--out',join(output,'received-package'),
      '--cases-dir',receivedCasesDirectory,'--source-dir',join(output,'received-sources'),
      '--request-id',operation.receiveRequestId,'--actor',ACTOR,'--python',python];
    const received=await commercialCli(receiveArgs);
    assert.equal(received.state,'COMPLETE');assert.equal(received.sourceCase.id,operation.caseId);
    const recipientStore=await openCaseStore(receivedCasesDirectory);
    const recipientScope={workspaceId:commercialWorkspaceId(receivedCasesDirectory),caseId:received.case.id};
    const recipient=openCaseCommercial({store:recipientStore,workspaceId:recipientScope.workspaceId});
    let recipientView=await recipient.read({id:recipientScope.caseId});
    const receivedQuote=selectedQuote(recipientView,quote.id);
    assert.equal(receivedQuote.sha256,quote.sha256);
    assert.equal(receivedQuote.originCaseId,operation.caseId);
    const receiverDraftRequest=await request('recipient-save-draft',async()=>{
      const value=clone(receivedQuote.draft);
      value.parentId=receivedQuote.id;
      value.notes='Recipient-owned continuation retained through the original package replay.';
      return {id:recipientScope.caseId,scope:recipientScope,
        expectedRevision:recipientView.case.revision,requestId:operation.recipientDraftRequestId,
        actor:ACTOR,draft:value};
    });
    await recipient.saveDraft(receiverDraftRequest);
    const receivedAgain=await commercialCli(receiveArgs);
    assert.equal(receivedAgain.case.id,recipientScope.caseId);
    recipientView=await recipient.read({id:recipientScope.caseId});
    assert.equal(recipientView.draft.notes,receiverDraftRequest.draft.notes);
    assert.equal(selectedQuote(recipientView,quote.id).originCaseId,operation.caseId);
    const packageManifest=await readJSON(join(received.package.directory,'case-source-package.json'));
    const archiveMembers=packageManifest.value.files.filter(file=>
      file.role==='inline-implementation-original'&&file.sha256===captured.pricing.backup.sha256&&
      Number(file.bytes)===captured.pricing.backup.bytes);
    assert.ok(archiveMembers.length,'The complete recipient package must retain the original pricing archive.');
    archiveMembers.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
    const recipientArchive=join(received.package.directory,archiveMembers[0].name);
    recipientController=openCommercialTariffController({store:recipientStore,casesDirectory:receivedCasesDirectory});
    const restoredRequest=await request('restore',async()=>({
      id:recipientScope.caseId,scope:recipientScope,revision:recipientView.case.revision,
      sourceId:captured.tariff.id,quoteId:quote.id,quoteSha256:quote.sha256,
      archive:recipientArchive,directory:join(output,'restored-pricing'),
    }));
    const restored=(await recipientController.call('restore',restoredRequest)).result;
    assert.equal(restored.state,'COMPLETE');assert.equal(restored.selectionRequestId,binding.selectionRequestId);
    const restoredAgain=(await recipientController.call('restore',restoredRequest)).result;
    assert.equal(restoredAgain.tariffSourceId,restored.tariffSourceId);
    const restoredCatalog=await recipientController.call('catalog',{
      id:recipientScope.caseId,scope:recipientScope,pricingDirectory:restored.source.directory,
      pricingConfig:restored.source.config,
      ...(restored.source.snapshot?{pricingSnapshot:restored.source.snapshot}:{pricingHistory:restored.source.history}),
    });
    assert.ok(restoredCatalog.result.selections.some(row=>row.id===binding.selectionRequestId));
    await record('original-package',exported.caseSource);await record('original-receiving',receivedAgain);
    await record('original-restore',restoredAgain);

    // Serve both original stores sequentially; the existing owner closes all child services.
    support=await startSupport({casesDir:casesDirectory,environment:{...process.env,SCF_PYTHON:python}});
    const health=await httpJSON(support.url,'/health');assert.equal(health.commercialTariffEnabled,true);
    const http=createCommercialTariffClient({url:support.url,caseId:operation.caseId,workspaceId:scope.workspaceId});
    const httpStatus=await http.status();assert.equal(httpStatus.scope.caseId,operation.caseId);
    const httpSelection=await http.case({sourceId:captured.tariff.id,quoteId:quote.id,quoteSha256:quote.sha256,monthlyRequests:'1500'});
    assert.equal(httpSelection.result.volumeReview.monthlyRequests,'1500');
    const httpFiles=[];
    for(const kind of ['SOURCE','PORTFOLIO']){
      const result=await http.download({sourceId:captured.tariff.id,kind});
      httpFiles.push(await completeDownload(join(downloads,'http-'+kind.toLowerCase()+'.json'),result));
    }
    const assets=[];
    for(const asset of ['/commercial','/commercial/tariff-desk.mjs','/commercial/tariff-desk.css','/commercial/tariff-client.mjs']){
      const response=await fetch(new URL(asset,support.url),{redirect:'error',signal:AbortSignal.timeout(20000)});
      assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());
      const local=asset==='/commercial'?join(ROOT,'commercial.html'):join(ROOT,asset.slice(1));
      assert.deepEqual(bytes,await readFile(local),'Serve the exact original application asset.');
      assets.push({route:asset,bytes:bytes.length,sha256:sha(bytes)});
    }
    const wrongScope=await fetch(new URL('/api/cases/'+operation.caseId+'/commercial/tariff-status',support.url),{
      method:'POST',headers:{origin:new URL(support.url).origin,'content-type':'application/json'},
      body:json({scope:{...scope,caseId:randomUUID()}}),signal:AbortSignal.timeout(20000),
    });
    assert.equal(wrongScope.status,409);
    await support.close();support=null;
    recipientSupport=await startSupport({casesDir:receivedCasesDirectory,
      sourceDir:join(output,'received-sources'),environment:{...process.env,SCF_PYTHON:python}});
    const reopenedHTTP=createCommercialTariffClient({url:recipientSupport.url,
      caseId:recipientScope.caseId,workspaceId:recipientScope.workspaceId});
    const finalHTTP=await reopenedHTTP.case({sourceId:captured.tariff.id,quoteId:quote.id,quoteSha256:quote.sha256,monthlyRequests:'1500'});
    assert.equal(finalHTTP.result.quote.originCaseId,operation.caseId);

    await directory(join(output,'mcp-files'));
    reads=new RetainedFileReads({errorPrefix:'SUPPORT'});
    mcp=merchantCommercialTariffs({
      cases:async()=>recipientStore,casesDirectory:()=>receivedCasesDirectory,
      exportsDirectory:()=>join(output,'mcp-files'),reads,
    });
    const mcpStatus=await mcp.call('merchant_case_commercial_tariff_status',{id:recipientScope.caseId});
    assert.equal(mcpStatus.scope.workspaceId,recipientScope.workspaceId);
    const mcpCase=await mcp.call('merchant_case_commercial_tariff_case',{
      id:recipientScope.caseId,sourceId:captured.tariff.id,quoteId:quote.id,quoteSha256:quote.sha256,monthlyRequests:'1500',
    });
    assert.equal(mcpCase.result.quote.sha256,quote.sha256);
    const exactPortfolio=await reopenedHTTP.download({sourceId:captured.tariff.id,kind:'PORTFOLIO'});
    const fileChoice={id:recipientScope.caseId,revision:(await recipientStore.read(recipientScope.caseId)).revision,
      sourceId:captured.tariff.id,kind:'PORTFOLIO',expectedSha256:exactPortfolio.descriptor.sha256};
    let page=await mcp.call('merchant_case_commercial_tariff_file',{...fileChoice,limit:127});
    assert.equal(page.encoding,'base64');
    assert.equal(page.file.sha256,exactPortfolio.descriptor.sha256);
    const chunks=[Buffer.from(page.data,'base64')];
    assert.equal(chunks[0].length,page.bytesRead);
    assert.ok(page.nextOffset!==null,'The original retained file is long enough to reopen after a prefix.');
    const prefix=page.nextOffset;
    await reads.release('commercial:'+recipientScope.caseId,page.readId);
    // A released read reopens at the same original byte offset and full digest.
    page=await mcp.call('merchant_case_commercial_tariff_file',{...fileChoice,offset:prefix,limit:8191});
    let pages=2;
    for(;;){
      const bytes=Buffer.from(page.data,'base64');assert.equal(bytes.length,page.bytesRead);
      chunks.push(bytes);
      if(page.nextOffset===null)break;
      page=await mcp.call('merchant_case_commercial_tariff_file',{
        ...fileChoice,readId:page.readId,offset:page.nextOffset,limit:8191,
      });pages++;
    }
    const mcpBody=Buffer.concat(chunks);
    assert.deepEqual(mcpBody,Buffer.from(exactPortfolio.bytes));
    const mcpFile=await completeDownload(join(downloads,'mcp-reopened-portfolio.json'),{
      body:mcpBody,descriptor:exactPortfolio.descriptor,
    });
    await mcp.close();mcp=null;await reads.close();reads=null;
    await recipientSupport.close();recipientSupport=null;
    await recipientController.close();recipientController=null;
    await controller.close();
    const result={
      schema:RESULT_SCHEMA,state:'COMPLETE',completedAt:new Date().toISOString(),
      operationDirectory:output,sourceCommit:SOURCE_COMMIT,sourceLabel:'Original repository native tariff fixture',
      customerSourceRoot:ROOT,pricingSourceRoot:PRICING_ROOT,
      original:{operationDirectory:nativeRun,sourceRoot:nativePricingRoot,operationSha256:binding.nativeOperationSha256,
        resultSha256:binding.nativeResultSha256,selectionRequestId:binding.selectionRequestId,
        backupRequestId:binding.backupRequestId,archiveSha256:nativeResult.value.originalBackup.sha256},
      capture:{sourceSha256:captured.sourceSha256,tariffSourceId:captured.tariff.id,pricingSourceId:captured.pricing.sourceId},
      case:{id:operation.caseId,revision:exportRequest.revision},
      quote:{id:quote.id,sha256:quote.sha256,originalQuoteId:published.quote.id,customerDocument:quoteFile},
      volume:{selectedRequests:'1250',selectedUniformMonthlyUsd:'14.25',
        revisedRequests:'1500',savedUniformMonthlyUsd:'17.1',tariffScheduleMonthlyUsd:'16.5',zeroQuantity:'COMPLETE'},
      recovery:{capture:'COMPLETE',attachment:'COMPLETE',quote:'COMPLETE',package:'COMPLETE',
        recipientDraftPreserved:true,originalQuoteOriginPreserved:true,pricingAndTariffRestore:'COMPLETE'},
      package:{directory:exportRequest.directory,manifestSha256:exported.caseSource.manifestSha256,files:exported.caseSource.files},
      recipient:{caseId:recipientScope.caseId,casesDirectory:receivedCasesDirectory,
        receivedPackageDirectory:received.package.directory,restoredSource:restored.source},
      http:{sender:'COMPLETE',recipient:'COMPLETE',assets,files:httpFiles},
      mcp:{state:'COMPLETE',prefixBytes:prefix,pages,file:mcpFile},
      resources:'CLOSED',
    };
    const completion=await retained(join(output,'flow-result.json'),async()=>result);
    assert.equal(completion.original.resultSha256,binding.nativeResultSha256);
    assert.equal(completion.capture.tariffSourceId,captured.tariff.id);
    assert.equal(completion.quote.sha256,quote.sha256);
    return completion;
  }finally{
    await Promise.allSettled([mcp?.close(),reads?.close(),recipientSupport?.close(),support?.close(),
      recipientController?.close(),controller.close()]);
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let output;
  try{
    const {values,positionals}=parseArgs({allowPositionals:false,strict:true,options:{
      'native-run':{type:'string'},output:{type:'string'},python:{type:'string'},
    }});
    assert.equal(positionals.length,0);output=values.output;
    process.stdout.write(json(await runTariffCommercialReceiving({
      nativeRun:values['native-run'],output,python:values.python??process.env.SCF_PYTHON??'python3',
    })));
  }catch(error){
    process.stderr.write(json({error:error.code??'TARIFF_CUSTOMER_RECEIVING_FAILED',
      detail:error.message,operationDirectory:output??null,stack:error.stack}));
    process.exitCode=1;
  }
}
