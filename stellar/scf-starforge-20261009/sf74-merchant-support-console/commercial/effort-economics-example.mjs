#!/usr/bin/env node
// MIT. Complete internal quotation -> saved delivery effort -> private economics example.
import {randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {prepareEconomicsExample} from './economics-example.mjs';
import {receiveEffortEconomics} from './effort-economics-receiving.mjs';
import {openCaseStore,retainCaseArtifact} from '../case-store.mjs';
import {openCaseCommercial,commercialWorkspaceId} from '../case-commercial.mjs';
import {inspectCommercialInstallationSource} from '../../../scf_2026/sf47_budget_model/workspace/commercial_installation_source.mjs';
import {privateDirectory} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {readPrivateFile} from '../../sf93-seller-support-bundle/incident-store.mjs';
import {canonical,jsonBytes,sha256} from '../commercial-pricing.mjs';
import {start} from '../server.mjs';

export const EFFORT_EXAMPLE_SCHEMA='stellar-forge.commercial-delivery-effort-internal-example.v1';
const ACTOR='Internal delivery example operator';
const LABEL='Internal example · quotation, delivery effort and private economics';
const PURPOSE='Authored internal operator scenario. The quotation, acceptance, Work and remaining effort are illustrative inputs in this separate example workspace.';
const helper=fileURLToPath(new URL('../../../scf_2026/sf47_budget_model/workspace/commercial_effort_example.py',import.meta.url));
const HASH=/^[a-f0-9]{64}$/;
const operationsAccess=new WeakMap();
const decode=body=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));
const same=(left,right,message='The retained original internal example changed.')=>{
  if(canonical(left)!==canonical(right))throw new Error(message);
};
const absolute=value=>{
  if(typeof value!=='string'||!isAbsolute(value)||resolve(value)!==value||value==='/')
    throw new Error('Use an absolute normalized private example path.');
  return value;
};
const alive=signal=>{if(signal?.aborted)throw signal.reason??new Error('Example cancelled.');};
async function optional(path){
  try{return decode(await readPrivateFile(path,64*1024*1024));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function keep(path,value){await retainCaseArtifact(path,jsonBytes(value));return value;}
async function checked(path,pin){
  const bytes=await readPrivateFile(path,pin.bytes);
  if(bytes.length!==pin.bytes||sha256(bytes)!==pin.sha256)throw new Error('An original complete example file changed.');
  return bytes;
}
function port(value){if(!Number.isInteger(value)||value<1||value>65535)throw new Error('Use a whole loopback port from 1 through 65535.');return value;}
async function runPython(argv,{python='python3',environment=process.env,signal,inline=null}={}){
  alive(signal);
  return new Promise((resolvePromise,reject)=>{
    const child=spawn(python,['-B',...(inline?['-c',inline]:[helper]),...argv],{env:{...environment,SF47_SUPPORT_NODE:environment.SF47_SUPPORT_NODE??process.execPath},stdio:['ignore','pipe','pipe'],windowsHide:true});
    const chunks=[],errors=[];let size=0,errorSize=0,failure=null,closed=false,killTimer;
    const stop=error=>{
      failure??=error;
      if(!closed){child.kill('SIGTERM');killTimer??=setTimeout(()=>{if(!closed)child.kill('SIGKILL');},10000);}
    };
    const abort=()=>stop(signal.reason??new Error('Example cancelled.'));
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const timer=setTimeout(()=>stop(new Error('The complete internal delivery preparation exceeded fifteen minutes.')),900000);
    child.stdout.on('data',bytes=>{size+=bytes.length;if(size>64*1024*1024)stop(new Error('The full example result exceeds 64 MiB.'));else chunks.push(bytes);});
    child.stderr.on('data',bytes=>{errorSize+=bytes.length;if(errorSize<=1024*1024)errors.push(bytes);else stop(new Error('The original native error output exceeds its bound.'));});
    child.on('error',error=>{failure??=error;});
    child.on('close',(code,signalName)=>{
      closed=true;clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);
      if(failure)return reject(failure);
      if(code!==0)return reject(new Error('Internal delivery preparation failed: '+Buffer.concat(errors).toString('utf8')+(signalName?' ('+signalName+')':'')));
      try{resolvePromise(decode(Buffer.concat(chunks)));}catch(error){reject(error);}
    });
  });
}
/** All authoring is confined to this retained, explicitly labelled example. */
export async function prepareCommercialEffortExample({directory,merchantPort=18776,operationsPort=18777,
  python='python3',environment=process.env,signal}={}){
  directory=absolute(directory);port(merchantPort);port(operationsPort);
  if(merchantPort===operationsPort)throw new Error('Select separate Merchant and Operations loopback ports.');
  alive(signal);await privateDirectory(directory);
  let intent=await optional(join(directory,'example-intent.json'));
  if(!intent){
    intent={schema:EFFORT_EXAMPLE_SCHEMA,label:LABEL,purpose:PURPOSE,directory,merchantPort,operationsPort,
      createdAt:new Date().toISOString(),operationId:'INTERNAL-COMMERCIAL-EFFORT-'+randomUUID(),
      planningRequestId:randomUUID(),acceptanceRequestId:randomUUID(),observedRequestId:randomUUID(),
      receiveRequestId:randomUUID()};
    await keep(join(directory,'example-intent.json'),intent);
  }
  same({schema:intent.schema,label:intent.label,purpose:intent.purpose,directory:intent.directory,
    merchantPort:intent.merchantPort,operationsPort:intent.operationsPort},
    {schema:EFFORT_EXAMPLE_SCHEMA,label:LABEL,purpose:PURPOSE,directory,merchantPort,operationsPort});
  const merchant=await prepareEconomicsExample({directory:join(directory,'merchant'),port:merchantPort});
  const model=openCaseCommercial({store:await openCaseStore(merchant.casesDirectory),
    workspaceId:commercialWorkspaceId(merchant.casesDirectory)});
  const planningPath=join(directory,'planning-request.json');
  let planningRequest=await optional(planningPath);
  if(!planningRequest){
    const view=await model.read({id:merchant.caseId});
    const input={...merchant.cliInput,note:PURPOSE+' Original planned implementation: 60 hours. '+merchant.cliInput.note};
    const preview=await model.previewEconomics({id:merchant.caseId,expectedRevision:view.case.revision,input});
    planningRequest={id:merchant.caseId,expectedRevision:view.case.revision,requestId:intent.planningRequestId,
      actor:ACTOR,input,reviewSha256:preview.review.reviewSha256};
    await keep(planningPath,planningRequest);
  }
  same({id:planningRequest.id,requestId:planningRequest.requestId,actor:planningRequest.actor},
    {id:merchant.caseId,requestId:intent.planningRequestId,actor:ACTOR});
  alive(signal);const planned=await model.saveEconomics(planningRequest);
  const acceptancePath=join(directory,'authored-acceptance-request.json');
  let acceptanceRequest=await optional(acceptancePath);
  if(!acceptanceRequest){
    const view=await model.read({id:merchant.caseId});
    acceptanceRequest={id:merchant.caseId,scope:view.scope,expectedRevision:view.case.revision,
      requestId:intent.acceptanceRequestId,actor:ACTOR,quoteId:merchant.quoteId,quoteSha256:merchant.quoteSha256,
      status:'ACCEPTED',observedAt:intent.createdAt,source:'urn:stellar-forge:internal-example:'+intent.operationId,
      note:PURPOSE+' This authored acceptance enables the original delivery workflow inside this internal example.'};
    await keep(acceptancePath,acceptanceRequest);
  }
  same({id:acceptanceRequest.id,requestId:acceptanceRequest.requestId,quoteId:acceptanceRequest.quoteId,
    quoteSha256:acceptanceRequest.quoteSha256,status:acceptanceRequest.status,source:acceptanceRequest.source},
    {id:merchant.caseId,requestId:intent.acceptanceRequestId,quoteId:merchant.quoteId,quoteSha256:merchant.quoteSha256,
      status:'ACCEPTED',source:'urn:stellar-forge:internal-example:'+intent.operationId});
  alive(signal);await model.receive(acceptanceRequest);
  const selectionPath=join(directory,'merchant-source-selection.json');
  let sourceSelection=await optional(selectionPath);
  if(!sourceSelection){
    const view=await model.read({id:merchant.caseId});
    const assessment=view.economics.assessments.find(row=>row.id===planned.assessmentId);
    if(!assessment||assessment.id!==intent.planningRequestId)throw new Error('The original planning assessment is missing.');
    sourceSelection={caseId:merchant.caseId,revision:view.case.revision,quoteId:merchant.quoteId,
      quoteSha256:merchant.quoteSha256,assessmentId:assessment.id,assessmentSha256:assessment.sha256};
    await keep(selectionPath,sourceSelection);
  }
  same({caseId:sourceSelection.caseId,quoteId:sourceSelection.quoteId,quoteSha256:sourceSelection.quoteSha256,
    assessmentId:sourceSelection.assessmentId},{caseId:merchant.caseId,quoteId:merchant.quoteId,
    quoteSha256:merchant.quoteSha256,assessmentId:intent.planningRequestId});
  if(!HASH.test(sourceSelection.revision)||!HASH.test(sourceSelection.assessmentSha256))throw new Error('Keep the original historical source revision.');
  const handoff=await model.download({id:merchant.caseId,revision:sourceSelection.revision,
    quoteId:merchant.quoteId,quoteSha256:merchant.quoteSha256,kind:'HANDOFF'});
  const sourceBytes=Buffer.from(handoff.body);
  if(sourceBytes.length!==handoff.descriptor.bytes||sha256(sourceBytes)!==handoff.descriptor.sha256)
    throw new Error('The complete original Merchant handoff changed.');
  const sourcePath=join(directory,'internal-merchant-handoff.json');
  const sourcePin=await retainCaseArtifact(sourcePath,sourceBytes);
  const inventory=await inspectCommercialInstallationSource(sourceBytes);
  const originalQuote=inventory.quotes.find(row=>row.id===merchant.quoteId&&row.sha256===merchant.quoteSha256);
  const acceptance=originalQuote?.acceptances.find(row=>row.id===intent.acceptanceRequestId);
  if(!acceptance)throw new Error('The original source did not retain its authored internal acceptance.');
  const selected={quoteId:merchant.quoteId,quoteSha256:merchant.quoteSha256,
    acceptanceId:acceptance.id,acceptanceSha256:acceptance.sha256};
  const sourceReview=await inspectCommercialInstallationSource(sourceBytes,selected);
  await keep(join(directory,'internal-merchant-source-review.json'),sourceReview);
  const nativeInput={schema:'stellar-forge.sf47-commercial-effort-example.v1',
    operationId:intent.operationId,createdAt:intent.createdAt,actor:ACTOR,
    merchantSource:{path:sourcePath,...sourcePin},selected};
  const nativeInputPath=join(directory,'delivery-input.json');await keep(nativeInputPath,nativeInput);
  alive(signal);
  const delivery=await runPython(['--input',nativeInputPath,'--input-sha',sha256(jsonBytes(nativeInput)),
    '--out',join(directory,'delivery')],{python,environment,signal});
  await keep(join(directory,'delivery-result.json'),delivery);
  await checked(delivery.archive.path,delivery.archive);
  if(delivery.operationId!==intent.operationId)throw new Error('The original delivery preparation belongs to another example.');
  const course={schema:'stellar-forge.merchant-effort-economics-receiving.v1',operationId:intent.operationId,
    casesDirectory:merchant.casesDirectory,caseId:merchant.caseId,revision:sourceSelection.revision,
    quoteId:merchant.quoteId,quoteSha256:merchant.quoteSha256,assessmentId:sourceSelection.assessmentId,
    assessmentSha256:sourceSelection.assessmentSha256,archive:delivery.archive.path,
    archiveSha256:delivery.archive.sha256,...delivery.selected,hoursBasis:'PROJECTED',costBasis:'REUSE_SELECTED_PLAN',
    requestId:intent.observedRequestId,actor:ACTOR,exportId:'internal-effort-'+merchant.caseId,
    sourceDirectory:join(merchant.casesDirectory,'source-bundles'),
    receivedCasesDirectory:join(directory,'received-cases'),receivedSourceDirectory:join(directory,'received-sources'),
    receiveRequestId:intent.receiveRequestId,receivingActor:'Internal delivery receiving operator',python};
  await keep(join(directory,'effort-receiving-input.json'),course);
  const result={schema:EFFORT_EXAMPLE_SCHEMA,state:'PREPARED',label:LABEL,purpose:PURPOSE,
    directory,intent,merchant,sourceSelection,source:{path:sourcePath,...sourcePin},sourceReview,delivery,course};
  await keep(join(directory,'prepared.json'),result);
  return result;
}

async function startOperations(prepared,{python='python3',environment=process.env,signal}={}){
  alive(signal);
  const accessFile=join(prepared.directory,'open-delivery-workspace.html');
  const server=fileURLToPath(new URL('../../../scf_2026/sf47_budget_model/workspace/server.py',import.meta.url));
  const child=spawn(python,['-B',server,'--workspace',absolute(prepared.delivery.operations.workspaceDirectory),
    '--scenario',absolute(prepared.delivery.operations.sourcePath),'--port',String(prepared.intent.operationsPort),
    '--access-file',accessFile],{env:{...environment,SF47_SUPPORT_NODE:environment.SF47_SUPPORT_NODE??process.execPath},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let settled=false,closed=false,failure=null,pending='',stderr='',force=null,closePromise=null;
  let startupResolve,startupReject;
  const announced=new Promise((resolvePromise,reject)=>{startupResolve=resolvePromise;startupReject=reject;});
  const stopped=new Promise(resolvePromise=>{
    child.once('error',error=>{failure=error;if(!settled){settled=true;startupReject(error);}});
    child.once('close',(code,signalName)=>{
      closed=true;if(force)clearTimeout(force);
      if(!settled){settled=true;startupReject(failure??new Error('The original Operations listener closed: '+stderr));}
      resolvePromise({code,signal:signalName,error:failure?.message??null});
    });
  });
  function close(){
    if(closePromise)return closePromise;
    closePromise=(async()=>{
      if(!closed){child.kill('SIGTERM');force=setTimeout(()=>{if(!closed)child.kill('SIGKILL');},10000);}
      await stopped;
    })();return closePromise;
  }
  const abort=()=>{void close();};
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const startupTimer=setTimeout(()=>{
    if(!settled){settled=true;startupReject(new Error('The original Operations listener did not announce within one minute.'));void close();}
  },60000);
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString('utf8')).slice(-65536);});
  child.stdout.on('data',chunk=>{
    if(settled)return;
    pending+=chunk.toString('utf8');
    if(pending.length>1024*1024){settled=true;startupReject(new Error('Unexpected Operations startup output.'));void close();return;}
    const end=pending.indexOf('\n');if(end<0)return;
    try{
      const value=JSON.parse(pending.slice(0,end)),url=new URL(value.url);
      if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||Number(url.port)!==prepared.intent.operationsPort||
        value.access_file!==accessFile)throw new Error('The owned Operations listener returned another opening selection.');
      settled=true;startupResolve({origin:url.origin,accessFile,stopped,close});
    }catch(error){settled=true;startupReject(error);void close();}
  });
  try{const result=await announced;alive(signal);return result;}
  catch(error){await close();throw error;}
  finally{clearTimeout(startupTimer);signal?.removeEventListener('abort',abort);}
}
async function saveBytes(path,body){return{path,...await retainCaseArtifact(path,body)};}
async function browserFile(path,produce){
  let body;try{body=await readPrivateFile(path,64*1024*1024);}
  catch(error){if(error.code!=='ENOENT')throw error;body=await produce();}
  return saveBytes(path,body);
}
async function browserDownload(page,selector,path){
  return browserFile(path,async()=>{
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator(selector).click()]);
    const temporary=await download.path();
    if(!temporary)throw new Error('The complete original browser download is unavailable.');
    const {readFile}=await import('node:fs/promises');return readFile(temporary);
  });
}
async function installationIdle(page){
  await page.locator('.installation-desk[aria-busy="false"]').waitFor();
  const error=await page.locator('.installation-message[role="alert"]').allTextContents();
  if(error.some(value=>value.trim()))throw new Error(error.join('\n'));
}
async function economicsIdle(page){
  await page.locator('.cq-economics[aria-busy="false"]').waitFor();
  const error=await page.locator('.cq-economics-status [role="alert"]').allTextContents();
  if(error.some(value=>value.trim()))throw new Error(error.join('\n'));
}
async function api(page,path,body){
  const access=operationsAccess.get(page);
  if(!access||new URL(path).origin!==access.origin)throw new Error('Use the exact owned original Operations origin.');
  const headers={Authorization:'Bearer '+access.token};
  const response=body===undefined?await page.request.get(path,{headers}):await page.request.post(path,{headers,data:body});
  const value=await response.json();
  if(!response.ok())throw new Error('The original application rejected the operation: '+JSON.stringify(value));
  return value;
}
async function openOperationsPage(page,owner,prepared){
  const html=new TextDecoder('utf-8',{fatal:true}).decode(await readPrivateFile(owner.accessFile,1024*1024));
  const link=html.match(/href="([^"]+)"/);
  if(!link)throw new Error('The original private access file has no opening link.');
  const url=new URL(link[1].replaceAll('&amp;','&')),token=new URLSearchParams(url.hash.slice(1)).get('access');
  if(url.origin!==owner.origin||!token||token.length>256)throw new Error('The private opening file belongs to another Operations listener.');
  operationsAccess.set(page,{origin:owner.origin,token});
  await page.goto(pathToFileURL(owner.accessFile).href);
  await page.getByRole('link',{name:'Open the retained local workspace',exact:true}).click();
  await page.locator('#workbench').waitFor({state:'visible'});
  await page.locator('#plan-select').selectOption(prepared.delivery.operations.planId);
  await page.locator('[data-tab="operations"]').click();
  await page.locator('.operations select[name="caseSelect"]').selectOption(prepared.delivery.operations.caseId);
  await page.locator('.operations [name="recordingActor"]').fill(ACTOR);
  await page.locator('[data-ops-tab="installations"]').click();await installationIdle(page);
}
async function openSavedInstallation(page,installationId,revision){
  await page.locator('[data-installation-action="open"][data-id="'+installationId+'"]').click();await installationIdle(page);
  const edition=page.locator('[data-installation-action="edition"][data-revision="'+revision+'"]');
  await edition.waitFor({state:'attached'});
  if(await edition.isEnabled()){await edition.click();await installationIdle(page);}
}
async function deliveryBrowser(page,owner,prepared,directory,signal){
  const donePath=join(directory,'delivery-browser-result.json'),prior=await optional(donePath);
  if(prior){
    same(prior.operationId,prepared.intent.operationId);
    for(const file of [...prior.screenshots,prior.archive,prior.savedInput])await checked(file.path,file);
    return prior;
  }
  await openOperationsPage(page,owner,prepared);
  const caseId=prepared.delivery.operations.caseId,installationId=prepared.delivery.selected.installationId;
  const prefix=owner.origin+'/api/operations/'+caseId;
  const original=await api(page,prefix+'/installations/'+installationId+'?revision='+prepared.delivery.selected.installationRevision);
  const report=original.preview.report.effort;
  if(report.sourceKind!=='COMMERCIAL'||report.commercial.quoteId!==prepared.merchant.quoteId||
    report.reportSha256!==prepared.delivery.selected.reportSha256)
    throw new Error('Open the complete original commercial example Installation.');
  const requestPath=join(directory,'browser-installation-request.json');
  let request=await optional(requestPath),routeError=null;
  function validateBrowserRequest(body){
    if(body?.action!=='installation.save'||body.actor!==ACTOR||
      typeof body.requestId!=='string'||!body.requestId||body.requestId.length>200||
      body.data?.installationId!==installationId||
      body.data?.expectedRevision!==prepared.delivery.selected.installationRevision||
      !HASH.test(body.data?.expectedPreviewSha256??''))
      throw new Error('Use the original internal browser Installation save request.');
    const {effort:originalEffort,...originalDocument}=original.preview.document;
    const {effort:enteredEffort,...enteredDocument}=body.data.document??{};
    same(enteredDocument,originalDocument,'The retained browser request changed the original accepted Installation scope.');
    same(enteredEffort?.allocations,originalEffort.allocations,'Keep the original selected Work allocations.');
    same(enteredEffort?.asOfDate,originalEffort.asOfDate,'Keep the original internal Work review date.');
  }
  if(request)validateBrowserRequest(request);
  await page.route('**/api/operations/'+caseId+'/command',async route=>{
    const body=route.request().postDataJSON();
    if(body?.action!=='installation.save'){await route.continue();return;}
    try{
      validateBrowserRequest(body);
      if(request)same(request,body,'Keep the original browser save request across interrupted replies.');
      else{request=body;await keep(requestPath,request);}
      await route.continue();
    }catch(error){routeError=error;await route.abort();}
  });
  if(request){
    alive(signal);
    // Resume the same UI-generated request through its original native writer.
    await api(page,prefix+'/command',request);
    await openOperationsPage(page,owner,prepared);
  }else{
    await openSavedInstallation(page,installationId,prepared.delivery.selected.installationRevision);
    await page.locator('[data-installation-action="edit"]').click();await installationIdle(page);
    await page.locator('[data-installation-action="effort-read"]').click();await installationIdle(page);
    await page.locator('[data-installation-effort-field="reviewMeta.reviewedBy"]').fill(ACTOR);
    await page.locator('[data-installation-effort-field="reviewMeta.reviewedAt"]').fill(prepared.intent.createdAt);
    for(const phase of report.phases){
      if(phase.remainingHours===null)throw new Error('The internal example needs its explicit editable remaining estimate.');
      await page.locator('[data-effort-phase="'+phase.phaseId+'"]').evaluate(element=>{element.open=true;});
      const key=encodeURIComponent(phase.phaseId).replaceAll('.','%2E');
      await page.locator('[data-installation-effort-field="reviewDrafts.'+key+'.remainingHours"]').fill(phase.remainingHours);
      await page.locator('[data-installation-effort-field="reviewDrafts.'+key+'.note"]').fill(PURPOSE+' Reviewed through the actual delivery effort controls.');
    }
    await page.locator('[data-installation-action="effort-apply-reviews"]').click();await installationIdle(page);
    await page.locator('[data-installation-note]').fill(PURPOSE+' Saved after reviewing original recorded Work and remaining task effort in the browser.');
    await page.locator('[data-installation-action="preview"]').click();await installationIdle(page);
    alive(signal);await page.locator('[data-installation-action="save"]').click();await installationIdle(page);
    if(routeError)throw routeError;
    if(!request)throw new Error('The original browser save request was not retained before dispatch.');
  }
  const saved=await api(page,prefix+'/installations/'+installationId+'?revision='+(prepared.delivery.selected.installationRevision+1));
  if(saved.revision!==prepared.delivery.selected.installationRevision+1||
    saved.preview.previewSha256!==request.data.expectedPreviewSha256||
    canonical(saved.preview.document)!==canonical(request.data.document))
    throw new Error('The original browser saved edition differs from its retained reviewed request.');
  if(saved.preview.report.effort.readyForPlanning!==true)throw new Error('Review every current task remainder before using the projected example.');
  await openSavedInstallation(page,installationId,saved.revision);
  const screenshots=[];
  for(const width of [1440,390]){
    alive(signal);await page.setViewportSize({width,height:1000});
    screenshots.push(await browserFile(join(directory,'delivery-'+width+'.png'),()=>page.screenshot({fullPage:true})));
  }
  const archive=await browserDownload(page,'[data-installation-action="export"]',join(directory,'browser-selected-installation.zip'));
  const savedInput=await browserDownload(page,'[data-installation-action="saved-input"]',join(directory,'browser-saved-installation-input.json'));
  await keep(join(directory,'browser-saved-installation.json'),saved);
  await openOperationsPage(page,owner,prepared);
  await openSavedInstallation(page,installationId,saved.revision);
  const result={schema:EFFORT_EXAMPLE_SCHEMA+'.delivery-browser',operationId:prepared.intent.operationId,
    requestId:request.requestId,archive,savedInput,screenshots,selected:{installationId,
      installationRevision:saved.revision,installationSha256:saved.sha256,
      reportSha256:saved.preview.report.effort.reportSha256},report:saved.preview.report.effort};
  await keep(donePath,result);return result;
}
async function merchantBrowser(page,merchantUrl,prepared,receiving,directory,signal){
  const donePath=join(directory,'merchant-browser-result.json'),prior=await optional(donePath);
  if(prior){
    same(prior.operationId,prepared.intent.operationId);
    for(const file of [...prior.screenshots,...prior.downloads])await checked(file.path,file);
    return prior;
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(merchantUrl);await page.locator('[data-tab="economics"]').click();await economicsIdle(page);
  await page.locator('[data-economics-select="assessment"]').selectOption(receiving.savedAssessment.id);await economicsIdle(page);
  const downloads=[];
  for(const kind of ['JSON','REPORT'])
    downloads.push(await browserDownload(page,'[data-economics-action="download-'+kind+'"]',
      join(directory,kind==='JSON'?'observed-assessment.json':'observed-assessment.md')));
  await page.locator('input[data-economics-file]').setInputFiles(downloads[0].path);await economicsIdle(page);
  await page.locator('[data-economics-field="actor"]').fill(ACTOR);
  await page.locator('[data-economics-action="preview"]').click();await economicsIdle(page);
  downloads.push(await browserDownload(page,'[data-economics-action="draft-download"]',join(directory,'private-economics-working-draft.json')));
  const screenshots=[];
  for(const width of [1440,390]){
    alive(signal);await page.setViewportSize({width,height:1000});
    screenshots.push(await browserFile(join(directory,'private-economics-'+width+'.png'),()=>page.screenshot({fullPage:true})));
  }
  await page.reload();await page.locator('[data-tab="economics"]').click();await economicsIdle(page);
  await page.locator('[data-economics-select="assessment"]').selectOption(receiving.savedAssessment.id);await economicsIdle(page);
  const result={schema:EFFORT_EXAMPLE_SCHEMA+'.merchant-browser',operationId:prepared.intent.operationId,
    assessment:receiving.savedAssessment,downloads,screenshots};
  await keep(donePath,result);return result;
}

export async function receiveCommercialEffortExample(owner,{playwright,chromium,python='python3',
  environment=process.env,signal}={}){
  absolute(playwright);absolute(chromium);alive(signal);
  const prepared=owner.prepared,directory=join(prepared.directory,'browser-course');
  await privateDirectory(directory);
  const imported=await import(pathToFileURL(playwright).href),engine=imported.chromium??imported.default?.chromium;
  if(!engine)throw new Error('Use the installed original Playwright module.');
  let browser,context,receivedHost,primaryError;
  const abort=()=>{if(browser)void browser.close().catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  try{
    browser=await engine.launch({headless:true,executablePath:chromium});alive(signal);
    context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}});alive(signal);
    const page=await context.newPage();page.setDefaultTimeout(45000);
    const delivery=await deliveryBrowser(page,owner.operations,prepared,directory,signal);
    const selectedCourse={...prepared.course,...delivery.selected,archive:delivery.archive.path,
      archiveSha256:delivery.archive.sha256};
    await keep(join(prepared.directory,'operated-effort-receiving-input.json'),selectedCourse);
    alive(signal);
    const receiving=await receiveEffortEconomics(selectedCourse,{
      out:join(prepared.directory,'effort-receiving'),environment,signal});
    const merchantDirectory=join(directory,'merchant');await privateDirectory(merchantDirectory);
    const merchant=await merchantBrowser(page,owner.merchantUrl,prepared,receiving,merchantDirectory,signal);
    const receivedDirectory=join(directory,'received-merchant');await privateDirectory(receivedDirectory);
    receivedHost=await start({casesDir:selectedCourse.receivedCasesDirectory,port:0});
    const receivedUrl=new URL('/commercial',receivedHost.url);receivedUrl.searchParams.set('case',receiving.received.id);
    const received=await merchantBrowser(page,receivedUrl.href,prepared,receiving,receivedDirectory,signal);
    // The native source receiver above has already verified this complete ZIP.
    // Render the producer's actual HTML export unchanged, including every section.
    await checked(delivery.archive.path,delivery.archive);
    const extracted=await runPython([delivery.archive.path],{python,environment,signal,inline:
      'import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n s=z.read("installation.html").decode("utf-8")\nprint(json.dumps({"html":s},ensure_ascii=False))\n'});
    const report=await saveBytes(join(directory,'selected-installation.html'),Buffer.from(extracted.html,'utf8'));
    await page.goto(pathToFileURL(report.path).href);
    const reportScreens=[];
    for(const width of [1440,390]){
      alive(signal);await page.setViewportSize({width,height:1000});
      reportScreens.push(await browserFile(join(directory,'installation-report-'+width+'.png'),()=>page.screenshot({fullPage:true})));
    }
    const result={schema:EFFORT_EXAMPLE_SCHEMA,state:'OPERATED',operationId:prepared.intent.operationId,
      label:LABEL,purpose:PURPOSE,directory:prepared.directory,delivery,receiving,merchant,received,
      report,screenshots:[...delivery.screenshots,...merchant.screenshots,...received.screenshots,...reportScreens],
      visualInspection:'OPEN_AND_INSPECT_THE_RETAINED_ACTUAL_SCREENSHOTS',
      opening:{merchant:owner.merchantUrl,operationsAccessFile:owner.operations.accessFile}};
    await keep(join(prepared.directory,'operated-result.json'),result);return result;
  }catch(error){primaryError=error;throw error;}
  finally{
    signal?.removeEventListener('abort',abort);
    const closed=await Promise.allSettled([context?.close(),browser?.close(),receivedHost?.close()]);
    const failed=closed.filter(result=>result.status==='rejected');
    if(failed.length&&!signal?.aborted){
      if(primaryError)primaryError.closeErrors=failed.map(result=>result.reason);
      else throw new AggregateError(failed.map(result=>result.reason),'An owned example browser or receiving listener failed to close.');
    }
  }
}
/** Opens both original applications. The retained private case and request
 * journals survive closing; only this invocation's listeners are owned here. */
export async function openCommercialEffortExample(options){
  const prepared=await prepareCommercialEffortExample(options);
  let merchantHost,operations,closing;
  const close=()=>closing??=(async()=>{
    const results=await Promise.allSettled([operations?.close(),merchantHost?.close()]);
    const errors=results.filter(result=>result.status==='rejected').map(result=>result.reason);
    if(errors.length)throw new AggregateError(errors,'An owned internal example listener failed to close.');
  })();
  try{
    alive(options?.signal);
    merchantHost=await start({casesDir:prepared.merchant.casesDirectory,port:prepared.intent.merchantPort});
    operations=await startOperations(prepared,options);
    const url=new URL('/commercial',merchantHost.url);url.searchParams.set('case',prepared.merchant.caseId);
    const owner={prepared,merchantUrl:url.href,operations,close,
      receive:args=>receiveCommercialEffortExample(owner,{...options,...args})};
    return owner;
  }catch(error){try{await close();}catch(closeError){error.closeError=closeError;}throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let owner,wake;const controller=new AbortController();
  const stop=signalName=>{
    if(controller.signal.aborted)return;
    process.exitCode=signalName==='SIGINT'?130:143;
    controller.abort(new Error('The internal example operator requested '+signalName+'.'));wake?.();
  };
  const interrupt=()=>stop('SIGINT'),terminate=()=>stop('SIGTERM');
  process.once('SIGINT',interrupt);process.once('SIGTERM',terminate);
  try{
    const {values:v}=parseArgs({options:{out:{type:'string'},'merchant-port':{type:'string'},
      'operations-port':{type:'string'},python:{type:'string'},playwright:{type:'string'},chromium:{type:'string'},
      receive:{type:'boolean'},help:{type:'boolean'}}});
    if(v.help){
      process.stdout.write('node effort-economics-example.mjs --out /ABS/private/example [--merchant-port 18776] [--operations-port 18777] [--python python3]\n'+
        '  --receive --playwright /ABS/installed/playwright/index.mjs --chromium /ABS/installed/chromium\n'+
        'Opens the original Merchant and Operations applications with a separate labelled WALKTHROUGH case.\n'+
        'The receiving option operates actual delivery controls, exports the selected ZIP, saves its private economics, receives the complete case and reopens the reports.\n');
    }else{
      for(const name of ['merchant-port','operations-port'])
        if(v[name]!==undefined&&!/^[1-9]\d*$/.test(v[name]))throw new Error('Use a whole --'+name+'.');
      if(!v.receive&&(v.playwright||v.chromium))throw new Error('Browser options require --receive.');
      owner=await openCommercialEffortExample({directory:v.out,
        merchantPort:v['merchant-port']===undefined?18776:Number(v['merchant-port']),
        operationsPort:v['operations-port']===undefined?18777:Number(v['operations-port']),
        python:v.python??'python3',signal:controller.signal});
      alive(controller.signal);
      process.stdout.write(JSON.stringify({schema:EFFORT_EXAMPLE_SCHEMA,state:'OPEN',label:LABEL,
        directory:owner.prepared.directory,merchant:owner.merchantUrl,
        operationsAccessFile:owner.operations.accessFile})+'\n');
      if(v.receive){
        const result=await owner.receive({playwright:v.playwright,chromium:v.chromium});
        alive(controller.signal);process.stdout.write(JSON.stringify(result)+'\n');
      }else{
        const stopped=await Promise.race([new Promise(resolvePromise=>{wake=()=>resolvePromise(null);if(controller.signal.aborted)wake();}),
          owner.operations.stopped]);
        if(stopped&&!controller.signal.aborted)throw new Error('The owned Operations listener exited: '+JSON.stringify(stopped));
      }
    }
  }catch(error){
    process.stderr.write(JSON.stringify({error:error.code??'COMMERCIAL_EFFORT_EXAMPLE',message:error.message})+'\n');
    if(!controller.signal.aborted)process.exitCode=1;
  }finally{
    process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);
    if(owner)try{await owner.close();}catch(error){process.stderr.write(error.message+'\n');if(!controller.signal.aborted)process.exitCode=1;}
  }
}
