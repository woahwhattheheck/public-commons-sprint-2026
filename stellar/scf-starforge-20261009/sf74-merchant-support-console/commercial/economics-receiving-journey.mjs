#!/usr/bin/env node
// MIT. One operated economics course on an existing Merchant owner and original case.
import {parseArgs} from 'node:util';
import {join,resolve,isAbsolute} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {openCaseStore,retainCaseArtifact} from '../case-store.mjs';
import {openCaseCommercial,commercialWorkspaceId} from '../case-commercial.mjs';
import {privateDirectory} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {readPrivateFile} from '../../sf93-seller-support-bundle/incident-store.mjs';
import {canonical,jsonBytes,sha256} from '../commercial-pricing.mjs';
import {commercialEconomicsCli} from './economics-cli.mjs';
import {inspectEconomicsCase} from './economics-receiving.mjs';

const SCHEMA='stellar-forge.merchant-economics-receiving-course.v1';
const equal=(a,b)=>{if(canonical(a)!==canonical(b))throw new Error('The original economics receiving input or result changed.');};
const parse=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
function absolute(value){if(typeof value!=='string'||!isAbsolute(value)||resolve(value)!==value||value==='/')throw new Error('Use absolute normalized private paths.');return value;}
async function optional(path){try{return await readPrivateFile(path,64*1024*1024);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function retained(path,value){await retainCaseArtifact(path,jsonBytes(value));return value;}
async function read(path){return parse(await readPrivateFile(path,64*1024*1024));}
function argumentsOf(action,values){
  return [action,...Object.entries(values).flatMap(([key,value])=>value===undefined?[]:['--'+key,String(value)])];
}
async function originalModel(directory){
  return openCaseCommercial({store:await openCaseStore(directory),workspaceId:commercialWorkspaceId(directory)});
}
function chosen(view,id,quoteId,quoteSha,input){
  const assessment=view.economics.assessments.find(row=>row.id===id);
  if(!assessment||assessment.quoteId!==quoteId||assessment.quoteSha256!==quoteSha)throw new Error('Original saved assessment is unavailable.');
  equal(assessment.review.input,input);return assessment;
}
async function browserArtifact(path,binding,produce){
  const recordPath=path+'.artifact.json',prior=await optional(recordPath);
  let record;
  if(prior){
    record=parse(prior);
    if(record.schema!=='stellar-forge.merchant-economics-browser-artifact.v1')throw new Error('The original artifact record is invalid.');
    equal(record.binding,binding);
  }else{
    const produced=await produce(),bytes=Buffer.from(produced.bytes);
    record={schema:'stellar-forge.merchant-economics-browser-artifact.v1',binding,
      filename:produced.filename,metadata:produced.metadata??null,
      bytes:bytes.length,sha256:sha256(bytes),body:bytes.toString('base64')};
    // Complete bytes are retained before the public output name. A lost reply
    // reopens this exact screenshot/download rather than capturing a different one.
    await retained(recordPath,record);
  }
  if(typeof record.body!=='string'||!Number.isSafeInteger(record.bytes)||record.bytes<1)
    throw new Error('The complete original browser artifact is missing.');
  const bytes=Buffer.from(record.body,'base64');
  if(bytes.toString('base64')!==record.body||bytes.length!==record.bytes||sha256(bytes)!==record.sha256)
    throw new Error('The complete retained browser artifact changed.');
  await retainCaseArtifact(path,bytes);
  return {path,bytes:bytes.length,sha256:record.sha256,filename:record.filename,metadata:record.metadata};
}
async function download(page,action,path,expected,binding){
  const result=await browserArtifact(path,{...binding,action},async()=>{
    const [file]=await Promise.all([page.waitForEvent('download'),
      page.locator('[data-economics-action="'+action+'"]').click()]);
    const error=await file.failure();if(error)throw new Error(error);
    return {bytes:await readFile(await file.path()),filename:file.suggestedFilename()};
  });
  if(expected&&(result.bytes!==expected.bytes||result.sha256!==expected.sha256))
    throw new Error('The actual browser download differs from the native descriptor.');
  return result;
}
async function waitIdle(page){
  await page.locator('.cq-economics[aria-busy="false"]').waitFor();
  const errors=await page.locator('.cq-economics-status [role="alert"]').allTextContents();
  if(errors.length)throw new Error(errors.join(' '));
}
async function browserCourse(input,out,model,signal){
  signal?.throwIfAborted();
  const directory=join(out,'browser');await privateDirectory(directory);
  const priorPath=join(directory,'request.json'),donePath=join(directory,'complete.json');
  const before=await model.read({id:input.caseId});
  const prior=await optional(priorPath);
  if(prior){
    const original=parse(prior);
    equal(original.input,input.browserInput);
    if(original.actor!==input.browserActor||original.scope?.caseId!==input.caseId||
      original.scope?.workspaceId!==commercialWorkspaceId(input.casesDirectory))
      throw new Error('The retained browser request belongs to a different actor or selected case.');
  }
  const completed=await optional(donePath);
  if(completed){
    const result=parse(completed),assessment=chosen(before,result.assessmentId,input.quoteId,input.quoteSha256,input.browserInput);
    if(assessment.sha256!==result.assessmentSha256)throw new Error('The browser assessment changed.');
    for(const file of [...result.downloads,...result.screenshots]){
      const bytes=await readPrivateFile(file.path,file.bytes);
      if(bytes.length!==file.bytes||sha256(bytes)!==file.sha256)throw new Error('A retained browser artifact changed.');
    }
    return result;
  }
  const imported=await import(pathToFileURL(absolute(input.playwright)).href);
  const chromium=imported.chromium??imported.default?.chromium;
  if(!chromium)throw new Error('Use the original installed Playwright module.');
  let browser,context,contextClosing,browserClosing;
  async function closeOwned(){try{if(context)await(contextClosing??=context.close());}finally{if(browser)await(browserClosing??=browser.close());}}
  const stop=()=>{void closeOwned().catch(()=>{});};
  signal?.addEventListener('abort',stop,{once:true});
  const observations=[],screenshots=[],downloads=[];
  let request=prior?parse(prior):null,routeError=null;
  try{
    signal?.throwIfAborted();
    browser=await chromium.launch({headless:true,executablePath:absolute(input.chromium)});
    signal?.throwIfAborted();
    context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}});
    signal?.throwIfAborted();
    const page=await context.newPage();
    page.on('dialog',dialog=>dialog.accept());
    await page.route('**/api/cases/*/commercial/economics-save',async route=>{
      try{
        const actual=route.request().postDataJSON();
        if(route.request().method()!=='POST'||actual.scope?.caseId!==input.caseId||
          actual.scope.workspaceId!==commercialWorkspaceId(input.casesDirectory)||actual.actor!==input.browserActor)
          throw new Error('The actual browser save belongs to another case or actor.');
        equal(actual.input,input.browserInput);
        if(request)equal(actual,request);
        else {await retained(priorPath,actual);request=actual;}
        await route.continue();
      }catch(error){routeError=error;await route.abort('failed');}
    });
    const url=new URL('/commercial',input.origin);url.searchParams.set('case',input.caseId);
    await page.goto(url.href);await page.locator('[data-tab="economics"]').click();await waitIdle(page);
    // A retained browser request is always adopted/replayed under its original ID.
    let already=request&&before.requests.some(row=>row.requestId===request.requestId&&row.action==='saveEconomics'&&row.state==='COMPLETE');
    if(!already){
      const value=request?{schema:'stellar-forge.merchant-commercial-economics-desk.v1',
        scope:request.scope,input:request.input,actor:request.actor,dirty:true,pending:request,selectedAssessmentId:''}:input.browserInput;
      await page.locator('input[data-economics-file]').setInputFiles({
        name:'original-private-economics.json',mimeType:'application/json',buffer:jsonBytes(value)});
      await waitIdle(page);
      if(request){
        await page.locator('[data-economics-action="refresh"]').click();await waitIdle(page);
        const fresh=await model.read({id:input.caseId});
        already=fresh.requests.some(row=>row.requestId===request.requestId&&row.action==='saveEconomics'&&row.state==='COMPLETE');
        if(!already){await page.locator('[data-economics-action="resume"]').click();await waitIdle(page);}
      }else{
        await page.locator('[data-economics-field="actor"]').fill(input.browserActor);
        await page.locator('[data-economics-action="preview"]').click();await waitIdle(page);
        await page.locator('[data-economics-action="save"]').click();await waitIdle(page);
      }
      if(routeError)throw routeError;
      if(!request)throw new Error('The actual browser save was not retained before dispatch.');
    }
    const view=await model.read({id:input.caseId});
    const assessment=chosen(view,request.requestId,input.quoteId,input.quoteSha256,input.browserInput);
    await page.locator('[data-economics-select="assessment"]').selectOption(assessment.id);await waitIdle(page);
    const artifactBinding={caseId:input.caseId,quoteId:input.quoteId,quoteSha256:input.quoteSha256,
      requestId:request.requestId,assessmentId:assessment.id,assessmentSha256:assessment.sha256};
    for(const kind of ['JSON','REPORT']){
      const file=await model.downloadEconomics({id:input.caseId,revision:view.case.revision,assessmentId:assessment.id,kind});
      downloads.push(await download(page,'download-'+kind,join(directory,kind==='JSON'?'assessment.json':'assessment.md'),file.descriptor,artifactBinding));
    }
    // Reopen the actual saved assessment on every path, including a committed
    // save whose browser completion marker was interrupted before publication.
    await page.locator('input[data-economics-file]').setInputFiles(join(directory,'assessment.json'));await waitIdle(page);
    await page.locator('[data-economics-field="actor"]').fill(input.browserActor);
    await page.locator('[data-economics-action="preview"]').click();await waitIdle(page);
    downloads.push(await download(page,'draft-download',join(directory,'working-draft.json'),null,artifactBinding));
    const draft=await read(join(directory,'working-draft.json'));equal(draft.input,input.browserInput);
    if(draft.actor!==input.browserActor)throw new Error('The retained draft actor differs from the original course.');
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:1000});
      await page.locator('[data-economics-action="preview"]').focus();await page.keyboard.press('Tab');
      const path=join(directory,'economics-'+width+'.png');
      const artifact=await browserArtifact(path,{...artifactBinding,viewportWidth:width},async()=>{
        const metadata=await page.evaluate(()=>({width:innerWidth,
          pageOverflow:document.documentElement.scrollWidth>innerWidth,
          focused:document.activeElement?.tagName,
          text:document.querySelector('.cq-economics-review')?.textContent??null}));
        return {bytes:await page.screenshot({fullPage:true}),filename:'economics-'+width+'.png',metadata};
      });
      observations.push(artifact.metadata);screenshots.push(artifact);
    }
    // Reload the original saved case and retain the assessment without another save.
    await page.reload();await page.locator('[data-tab="economics"]').click();await waitIdle(page);
    await page.locator('[data-economics-select="assessment"]').selectOption(assessment.id);
    signal?.throwIfAborted();
    return retained(donePath,{schema:SCHEMA,state:'BROWSER_COMPLETED',requestId:request.requestId,
      assessmentId:assessment.id,assessmentSha256:assessment.sha256,caseRevision:view.case.revision,
      downloads,screenshots,observations,visualInspection:'PENDING_OWNER_IMAGE_INSPECTION'});
  }finally{signal?.removeEventListener('abort',stop);await closeOwned();}
}
async function coldRead(inputPath,outPath,signal){
  signal?.throwIfAborted();
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--cold-read',inputPath],{stdio:['ignore','pipe','pipe']});
  const chunks=[],errors=[];let size=0,errorBytes=0,timedOut=false,spawnError=null,force=null;
  const terminate=()=>{
    if(child.exitCode!==null||child.signalCode!==null)return;
    child.kill('SIGTERM');
    force??=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},10000);
  };
  const timeout=setTimeout(()=>{timedOut=true;terminate();},120000);
  signal?.addEventListener('abort',terminate,{once:true});
  if(signal?.aborted)terminate();
  try{
    const code=await new Promise(resolve=>{
      child.once('error',error=>{spawnError=error;});
      child.stdout.on('data',b=>{size+=b.length;if(size>32*1024*1024)terminate();else chunks.push(b);});
      child.stderr.on('data',b=>{if(errorBytes<65536){errors.push(b);errorBytes+=b.length;}});
      child.once('close',resolve);
    });
    signal?.throwIfAborted();
    if(spawnError)throw spawnError;
    if(code!==0||timedOut||size>32*1024*1024)throw new Error('Original cold read failed: '+Buffer.concat(errors).toString().slice(0,2000));
    const bytes=Buffer.concat(chunks),result=parse(bytes);await retainCaseArtifact(outPath,bytes);return result;
  }finally{clearTimeout(timeout);if(force)clearTimeout(force);signal?.removeEventListener('abort',terminate);}
}
export async function receiveEconomicsJourney(input,{out,environment=process.env,signal}={}){
  signal?.throwIfAborted();
  if(input?.schema!==SCHEMA)throw new Error('Use the full original economics receiving input.');
  absolute(out);absolute(input.casesDirectory);absolute(input.receivedCasesDirectory);absolute(input.receivedSourceDirectory);
  const origin=new URL(input.origin);
  if(!['127.0.0.1','localhost','[::1]'].includes(origin.hostname)||origin.protocol!=='http:'||origin.username||origin.password||origin.search||origin.hash)
    throw new Error('Use the actual original loopback Merchant owner origin.');
  for(const value of [input.cliInput,input.browserInput]){
    if(value?.quoteId!==input.quoteId||value.quoteSha256!==input.quoteSha256)throw new Error('Bind both explicit inputs to the selected original quote.');
  }
  await privateDirectory(out);await retained(join(out,'intent.json'),input);
  const cli=(action,values)=>{signal?.throwIfAborted();return commercialEconomicsCli(argumentsOf(action,values),{environment,signal});};
  const model=await originalModel(input.casesDirectory);
  const common={'cases-dir':input.casesDirectory,case:input.caseId,revision:input.revision};
  const inputFile=join(out,'cli-input.json'),inputBytes=jsonBytes(input.cliInput);
  await retainCaseArtifact(inputFile,inputBytes);
  const requestPath=join(out,'cli-request.json');let request=await optional(requestPath);
  if(request)request=parse(request);
  else{
    const preview=await cli('preview',{...common,input:inputFile,'input-sha':sha256(inputBytes),out:join(out,'cli-review.json')});
    request={...common,input:inputFile,'input-sha':sha256(inputBytes),'review-sha':preview.review.reviewSha256,
      'request-id':input.cliRequestId,actor:input.actor};
    await retained(requestPath,request);
  }
  const expectedRequest={...common,input:inputFile,'input-sha':sha256(inputBytes),
    'review-sha':request['review-sha'],'request-id':input.cliRequestId,actor:input.actor};
  equal(request,expectedRequest);
  const saved=await cli('save',request);
  const cliView=await model.read({id:input.caseId});
  const cliAssessment=chosen(cliView,input.cliRequestId,input.quoteId,input.quoteSha256,input.cliInput);
  if(saved.assessmentId!==cliAssessment.id)throw new Error('The original CLI save returned a different assessment.');
  const browser=await browserCourse(input,out,model,signal);
  const current=await model.read({id:input.caseId});
  const assessment=chosen(current,browser.assessmentId,input.quoteId,input.quoteSha256,input.browserInput);
  chosen(current,input.cliRequestId,input.quoteId,input.quoteSha256,input.cliInput);
  // Capture this phase once; later case edits must not move a resumed export.
  const selectedPath=join(out,'export-selection.json'),oldSelection=await optional(selectedPath);
  const selected=oldSelection?parse(oldSelection):{...common,revision:current.case.revision,
    quote:input.quoteId,'quote-sha':input.quoteSha256,assessment:assessment.id,'assessment-sha':assessment.sha256};
  if(!oldSelection)await retained(selectedPath,selected);
  equal({'cases-dir':selected['cases-dir'],case:selected.case},{'cases-dir':input.casesDirectory,case:input.caseId});
  equal({quote:selected.quote,'quote-sha':selected['quote-sha'],assessment:selected.assessment,'assessment-sha':selected['assessment-sha']},
    {quote:input.quoteId,'quote-sha':input.quoteSha256,assessment:assessment.id,'assessment-sha':assessment.sha256});
  const exported=await cli('export',{...selected,out:join(out,'package'),'export-id':input.exportId,
    'source-dir':input.sourceDirectory,python:input.python});
  const packageHash=exported.casePackage.manifestSha256;
  const pureSelection={quote:selected.quote,'quote-sha':selected['quote-sha'],assessment:selected.assessment,'assessment-sha':selected['assessment-sha']};
  const receiving={from:join(out,'package'),sha256:packageHash,out:join(out,'receiving'),
    'cases-dir':input.receivedCasesDirectory,'source-dir':input.receivedSourceDirectory,
    'request-id':input.receiveRequestId,actor:input.receivingActor,...pureSelection,python:input.python};
  const received=await cli('receive',receiving);
  const repeated=await cli('receive',receiving);
  equal(received.receiving.case.id,repeated.receiving.case.id);
  equal(received.review.assessment,repeated.review.assessment);
  const coldInput={casesDirectory:input.receivedCasesDirectory,id:received.receiving.case.id,
    revision:received.receiving.case.importedRevision,quoteId:input.quoteId,quoteSha256:input.quoteSha256,
    assessmentId:assessment.id,assessmentSha256:assessment.sha256};
  await retained(join(out,'cold-read-input.json'),coldInput);
  const reopened=await coldRead(join(out,'cold-read-input.json'),join(out,'cold-read-result.json'),signal);
  equal(reopened.assessment,received.review.assessment);equal(reopened.quote,received.review.quote);
  const handoff=await cli('handoff',{...selected,out:join(out,'sf47-handoff'),
    acceptance:input.acceptanceId,'acceptance-sha':input.acceptanceSha256});
  const recipientCommon={'cases-dir':input.receivedCasesDirectory,case:received.receiving.case.id,
    revision:received.receiving.case.importedRevision,...pureSelection};
  const onward=await cli('export',{...recipientCommon,out:join(out,'received-reexport'),'export-id':input.onwardExportId,
    'source-dir':input.receivedSourceDirectory,python:input.python});
  await cli('inspect-package',{from:join(out,'received-reexport'),sha256:onward.casePackage.manifestSha256,...pureSelection,python:input.python});
  const result={schema:SCHEMA,state:'COMPLETE',operationId:input.operationId,
    cliAssessment:{id:cliAssessment.id,sha256:cliAssessment.sha256},
    browser,selection:selected,package:{directory:join(out,'package'),sha256:packageHash},
    received:{id:received.receiving.case.id,importedRevision:received.receiving.case.importedRevision},
    repeatedReceivingSameCase:true,coldRead:{freshProcess:true,assessmentSha256:reopened.assessment.sha256},
    handoff,onward:{directory:join(out,'received-reexport'),sha256:onward.casePackage.manifestSha256},
    visualInspection:'PENDING_OWNER_IMAGE_INSPECTION'};
  signal?.throwIfAborted();await retained(join(out,'result.json'),result);return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const controller=new AbortController();
  const stop=signal=>{if(controller.signal.aborted)return;process.exitCode=signal==='SIGINT'?130:143;controller.abort(new Error('The original receiving operator requested '+signal+'.'));};
  const interrupt=()=>stop('SIGINT'),terminate=()=>stop('SIGTERM');
  process.once('SIGINT',interrupt);process.once('SIGTERM',terminate);
  try{
    const {values}=parseArgs({options:{input:{type:'string'},out:{type:'string'},'cold-read':{type:'string'},help:{type:'boolean'}}});
    if(values.help)process.stdout.write(jsonBytes({schema:SCHEMA,usage:'node economics-receiving-journey.mjs --input PRIVATE_INPUT.json --out PRIVATE_DIRECTORY',
      input:['schema','operationId','casesDirectory','caseId','revision','quoteId','quoteSha256',
        'cliInput','browserInput','cliRequestId','actor','browserActor','origin','playwright','chromium',
        'sourceDirectory (if original case has source bundles)','receivedCasesDirectory','receivedSourceDirectory',
        'receiveRequestId','receivingActor','exportId','onwardExportId','python (optional)',
        'acceptanceId + acceptanceSha256 (optional original actual response)'],
      environment:'Use the original equipped owner listener, installed Node/Playwright/Chromium and same case. No installation or new listener is performed.',
      screenshots:'Captured for explicit owner image inspection; not automatically marked visually accepted.'}));
    else if(values['cold-read'])process.stdout.write(jsonBytes(await inspectEconomicsCase(await read(absolute(values['cold-read'])))));
    else process.stdout.write(jsonBytes(await receiveEconomicsJourney(await read(absolute(values.input)),{out:absolute(values.out),signal:controller.signal})));
  }catch(error){process.stderr.write(JSON.stringify({error:error.code??'ECONOMICS_RECEIVING_FAILED',message:error.message})+'\n');if(!controller.signal.aborted)process.exitCode=1;}
  finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);}
}
