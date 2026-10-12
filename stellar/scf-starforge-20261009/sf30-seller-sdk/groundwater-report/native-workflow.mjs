// SPDX-License-Identifier: MIT
// Continue the same real frozen report and the explicitly selected existing buyer operation.
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {GroundwaterReportDesk} from './desk.mjs';
import {startReportDesk} from './server.mjs';
import {startPublication} from './publication.mjs';
import {privateAccess} from './cli.mjs';
import {SCHEMA,need,read,readJSON,put,exists,directory,identity,canonical,sha,checkFile,defaultApplication} from './common.mjs';

export async function runReportJourney(input,{signal}={}){
  need(input.schema==='stellar-forge.groundwater-report-journey.v1','JOURNEY_SCHEMA','Select the original report journey input.');
  const {receiving,...initial}=input;
  await directory(input.outputDirectory,{create:true});
  const request=join(input.outputDirectory,'report-journey-input.json');
  await put(request,initial);
  const desk=new GroundwaterReportDesk({directory:input.deskDirectory,sourceWorkspace:input.sourceWorkspace,
    application:input.application??defaultApplication,python:input.python??'python3',
    operationsAccess:input.operationsUrlFile?await privateAccess(input.operationsUrlFile):null,signal});
  await desk.open({create:!await exists(join(input.deskDirectory,'desk.json'))});
  const publicationId=input.operationId+':publication',buyerId=input.operationId+':buyer-preparation';
  const publication=await desk.publish({operationId:publicationId,actor:input.actor,input:input.publication});
  const source=publication.publication.source;
  need(source.report.sha256===input.publication.expectedReportSha256&&source.manifest.sha256===input.publication.expectedManifestSha256&&
    source.exports.zip.sha256===input.publication.expectedArchiveSha256,'JOURNEY_SOURCE','The actual original frozen report differs.');
  const completedPath=join(input.outputDirectory,'complete-report-journey.json');
  if(await exists(completedPath)){
    const saved=(await readJSON(completedPath)).value;
    need(saved.operationId===input.operationId&&saved.reportId===source.report.id&&saved.archiveSha256===source.exports.zip.sha256,
      'JOURNEY_IDENTITY','The retained completion differs from this original report.');
    if(receiving){
      const h=await read(receiving.handoffFile,8388608),r=await read(receiving.responseFile,16777216);
      await put(join(input.outputDirectory,'original-buyer-selection.json'),{...receiving,handoff:identity(h),response:identity(r)});
    }
    await desk.receiving(saved.receivingId);
    await desk.resume(input.operationId+':export');
    const reopened=new GroundwaterReportDesk({directory:saved.restored.directory,application:input.application??defaultApplication,python:input.python??'python3',signal});
    need((await reopened.state()).desk.id===saved.deskId,'RESTORED_ORIGINAL','The original restored desk identity differs.');
    await reopened.receiving(saved.receivingId);await reopened.publication(saved.publicationId);
    return saved;
  }
  const prepared=await desk.prepareBuyer({operationId:buyerId,actor:input.actor,publicationId,format:'zip',
    acceptIndex:input.buyer.acceptIndex,intentId:input.buyer.intentId,responseOut:input.buyer.responseOut});
  await put(join(input.outputDirectory,'publication-result.json'),publication);
  await put(join(input.outputDirectory,'buyer-preparation-result.json'),prepared);
  let service,operator,browser,browserResult=await exists(join(input.outputDirectory,'browser-source-receiving.json'))?
    (await readJSON(join(input.outputDirectory,'browser-source-receiving.json'))).value:null;
  try{
    service=await startPublication({desk:await desk.open(),publicationId,runtime:desk.runtime,handleSignals:false});
    const health=await (await fetch(service.url+'/_seller/health',{signal})).json();
    const response=await fetch(service.url+publication.publication.formats.find(x=>x.format==='zip').route,{signal});
    const raw=Buffer.from(await response.arrayBuffer());
    need(response.status===402&&sha(raw)!==publication.publication.binding.archiveSha256,'NATIVE_CHALLENGE','The original unconfigured native service did not retain the payment challenge boundary.');
    const proof={mode:service.mode,health,status:response.status,response:identity(raw),publicationSha256:publication.publicationSha256};
    const proofPath=join(input.outputDirectory,'native-challenge.json');
    // A fresh readiness read is an observation, not an original business operation.
    if(!await exists(proofPath))await put(proofPath,proof);
    if(browserResult)need(browserResult.deskId===(await desk.state()).desk.id&&browserResult.publicationId===publicationId&&browserResult.originalReportId===source.report.id,
      'BROWSER_IDENTITY','The original browser result names another report or desk.');
    if(input.browser&&!browserResult){
      const require=createRequire(import.meta.url),playwright=require(input.browser.package);
      operator=await startReportDesk({desk,handleSignals:false});
      browser=await playwright.chromium.launch({headless:true,executablePath:input.browser.executable,args:['--no-sandbox']});
      const page=await browser.newPage({viewport:{width:1450,height:1000}});
      await page.goto(operator.url,{waitUntil:'domcontentloaded'});
      await page.locator('#identity').filter({hasText:(await desk.state()).desk.id}).waitFor();
      await page.getByRole('link',{name:'Frozen reports',exact:true}).click();
      await page.locator('[data-report="'+source.report.id+'"]').click();
      await page.getByRole('button',{name:'Use this exact report for publication',exact:true}).waitFor();
      need((await page.locator('#detail').innerText()).includes(source.run.id),'BROWSER_SOURCE','The source view omitted the actual original run.');
      await page.getByRole('link',{name:'Buyer preparation',exact:true}).click();
      await page.locator('[data-publication="'+publicationId+'"]').click();
      need((await page.locator('#detail').innerText()).includes(publication.publication.binding.archiveSha256),'BROWSER_PUBLICATION','The original report artifact binding was not visible.');
      await page.getByRole('link',{name:'Operations & recovery',exact:true}).click();
      await page.locator('[data-original="'+buyerId+'"]').click();
      need((await page.locator('#detail').innerText()).includes(input.buyer.intentId),'BROWSER_RECOVERY','The original preparation request was not visible.');
      browserResult={state:'COMPLETE',deskId:(await desk.state()).desk.id,publicationId,buyerId,originalReportId:source.report.id,
        sourceViewed:true,publicationViewed:true,originalPreparationViewed:true};
      if(!await exists(join(input.outputDirectory,'browser-source-receiving.json')))await put(join(input.outputDirectory,'browser-source-receiving.json'),browserResult);
    }
  }finally{
    const errors=[];
    if(browser)try{await browser.close();}catch(e){errors.push(e);}
    if(operator)try{await operator.close();}catch(e){errors.push(e);}
    if(service)try{await service.close();}catch(e){errors.push(e);}
    if(errors.length)throw new AggregateError(errors,'The original report journey resources did not all drain.');
  }
  if(!receiving){
    const result={schema:input.schema,state:'PREPARED_AWAITING_ORIGINAL_BUYER',operationId:input.operationId,
      publicationId,buyerId,deskId:(await desk.state()).desk.id,reportId:source.report.id,
      catalog:await desk.download(publicationId,'catalog'),buyerConfiguration:await desk.download(buyerId,'buyer-config'),
      browser:browserResult??null,
      next:'Use the existing authorized SF88 buyer workflow with this original configuration. Continue this same journey with its actual saved handoff, response file and explicit receiving selection. No buyer payment or solver was dispatched here.'};
    await put(join(input.outputDirectory,'prepared-receiving.json'),result);return result;
  }
  const handoff=await read(receiving.handoffFile,8388608),response=await read(receiving.responseFile,16777216),
    catalog=await read((await desk.download(publicationId,'catalog')).path,1048576);
  const receivedInput={...receiving,handoff:identity(handoff),response:identity(response)};
  await put(join(input.outputDirectory,'original-buyer-selection.json'),receivedInput);
  const previewId=input.operationId+':receiving-preview',receivingId=input.operationId+':receiving';
  const reviewInput={rowIndex:publication.publication.formats.findIndex(x=>x.format==='zip'),acceptIndex:input.buyer.acceptIndex,
    jobId:receiving.jobId,decision:receiving.decision,reason:receiving.reason,...(receiving.caseId?{caseId:receiving.caseId}:{})};
  const preview=await desk.previewReceiving({operationId:previewId,actor:input.actor,input:reviewInput,catalog,handoff,response});
  need(preview.selection.intentId===input.buyer.intentId&&preview.binding.reportId===source.report.id,
    'ORIGINAL_BUYER_SELECTION','The received job or report differs from this original preparation.');
  const chosen={...reviewInput,...(receiving.caseId?{deploymentId:receiving.deploymentId,purchaseId:receiving.purchaseId??null,
    expectedCaseVersion:receiving.expectedCaseVersion,expectedPreviewSha256:receiving.expectedPreviewSha256}:{})};
  if(receiving.caseId)need(preview.operations.case.version===chosen.expectedCaseVersion&&preview.operations.preview.previewSha256===chosen.expectedPreviewSha256,
    'REVIEWED_OPERATIONS_SELECTION','Use the exact operator-reviewed original Operations preview; no selection is inferred.');
  const result=await desk.receive({operationId:receivingId,actor:input.actor,input:chosen,catalog,handoff,response});
  await put(join(input.outputDirectory,'report-receiving-result.json'),result);
  const exportResult=await desk.export({operationId:input.operationId+':export',actor:input.actor,destination:join(input.outputDirectory,'Groundwater_Report_Desk.zip')});
  const restore=await desk.restore({archive:exportResult.result.path,destination:join(input.outputDirectory,'restored-original'),
    expectedSha256:exportResult.result.archive.sha256,expectedBytes:exportResult.result.archive.bytes});
  const reopened=new GroundwaterReportDesk({directory:restore.directory,application:input.application??defaultApplication,python:input.python??'python3',signal});
  const reopenedState=await reopened.state(),reopenedReceiving=await reopened.receiving(receivingId),reopenedPublication=await reopened.publication(publicationId);
  need(reopenedState.desk.id===(await desk.state()).desk.id&&reopenedReceiving.review.binding.archiveSha256===source.exports.zip.sha256&&
    reopenedPublication.publicationSha256===publication.publicationSha256,'RESTORED_ORIGINAL','The restored original report desk differs.');
  const terminal={schema:input.schema,state:'COMPLETE',operationId:input.operationId,deskId:reopenedState.desk.id,
    reportId:source.report.id,publicationId,buyerId,receivingId,reportSha256:source.report.sha256,archiveSha256:source.exports.zip.sha256,
    buyerIntentId:input.buyer.intentId,originalBuyerJobId:receiving.jobId,
    originalPayment:result.review.buyer,receivingDecision:result.review.decision,operations:result.originalResult.result.operations,
    completeExport:exportResult.result,restored:restore,browser:browserResult??null,noSolverDispatch:true,noBuyerPaymentDispatch:true};
  await put(join(input.outputDirectory,'complete-report-journey.json'),terminal);return terminal;
}
export async function main(args=process.argv.slice(2)){
  need(args.length===1,'JOURNEY_INPUT','Pass one complete original private journey input path.');
  const input=(await readJSON(resolve(args[0]))).value;
  const controller=new AbortController(),stop=()=>controller.abort();
  for(const s of ['SIGINT','SIGTERM'])process.on(s,stop);
  try{const result=await runReportJourney(input,{signal:controller.signal});process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;}
  finally{for(const s of ['SIGINT','SIGTERM'])process.off(s,stop);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{process.stderr.write(JSON.stringify({error:{code:e.code??'JOURNEY_FAILED',message:e.message}})+'\n');process.exitCode=1;});
