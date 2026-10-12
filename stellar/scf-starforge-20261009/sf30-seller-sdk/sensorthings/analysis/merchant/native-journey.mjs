// SPDX-License-Identifier: MIT
// Existing analysis/buyer continuation. No capture, analysis run, new workspace or purchase.
import {join,isAbsolute,relative} from 'node:path';
import {readOwned} from '../../../stellar-expert/store.mjs';
import {MerchantSensorThingsWorkspaces} from '../../mcp.mjs';
import {inspectSensorThingsFiles,downloadSensorThingsFiles,parseSensorThingsDownloadManifest,DOWNLOAD_MANIFEST} from '../../download.mjs';
import {AnalysisMerchantClient,parsePrivateLink} from './client.mjs';
import {identity,sha,stable,need,hash,text,absolute,fields,opId} from './common.mjs';
import {openNativeJournal,publish,verifyFile,receiveFile,runBrowserAction} from './native-journal.mjs';
export const NATIVE_SCHEMA='stellar-forge.sensorthings-analysis-merchant-native.v1';
export const RECEIVING_SCHEMA='stellar-forge.sensorthings-analysis-merchant-native-receiving.v1';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function endpoint(value,label,{inbox=false}={}){
  fields(value,['urlFile','workspaceId',...(inbox?['inboxDirectory']:[])],['urlFile','workspaceId',...(inbox?['inboxDirectory']:[])]);
  absolute(value.urlFile,label+' original private URL file');need(UUID.test(value.workspaceId??''),'NATIVE_WORKSPACE','Select the original '+label+' UUID.',422);
  if(inbox)absolute(value.inboxDirectory,label+' configured inbox');
}
function within(root,path){const r=relative(root,path);return r===''||!r.startsWith('..')&&!isAbsolute(r);}
export function validateNativeInput(input){
  fields(input,['schema','operationId','controlDirectory','source','receiver','reopened','publication','offer','buyer','startService','actor'],
    ['schema','operationId','controlDirectory','source','receiver','reopened','publication','offer','actor']);
  need(input.schema===NATIVE_SCHEMA,'NATIVE_SCHEMA','Use the declared original continuation schema.',422);
  opId(input.operationId);absolute(input.controlDirectory,'original private control directory');text(input.actor,'the attributed operator',200);
  endpoint(input.source,'source');endpoint(input.receiver,'receiver',{inbox:true});endpoint(input.reopened,'independent receiving',{inbox:true});
  need(new Set([input.source.workspaceId,input.receiver.workspaceId,input.reopened.workspaceId]).size===3,
    'NATIVE_WORKSPACE','Use three explicitly selected original workspaces for source, receiving and independent reopening.',422);
  for(const selected of [input.receiver.inboxDirectory,input.reopened.inboxDirectory])
    need(!within(input.controlDirectory,selected)&&!within(selected,input.controlDirectory),
      'NATIVE_PATH_SCOPE','Keep original workspace inboxes separate from the caller control directory.',422);
  const p=input.publication;
  fields(p,['projectId','versionId','publicationId','publicationSha256','exportId','archiveSha256','archiveBytes'],
    ['projectId','versionId','publicationId','publicationSha256','exportId','archiveSha256','archiveBytes']);
  for(const key of ['projectId','versionId','publicationId','exportId'])opId(p[key]);
  hash(p.publicationSha256);hash(p.archiveSha256);
  need(Number.isSafeInteger(p.archiveBytes)&&p.archiveBytes>0,'NATIVE_ARCHIVE','Retain the complete original archive byte count.',422);
  fields(input.offer,['title','description','license','reason','origin','routePrefix','payment','companions'],
    ['title','description','license','reason','origin','routePrefix','payment','companions']);
  fields(input.offer.payment,['scheme','network','asset','amount','payTo','maxTimeoutSeconds','extra'],['scheme','network','asset','amount','payTo','maxTimeoutSeconds','extra']);
  need(Array.isArray(input.offer.companions)&&new Set(input.offer.companions).size===input.offer.companions.length,'NATIVE_COMPANIONS','Select distinct original companion files.',422);
  if(input.buyer){fields(input.buyer,['intentId','responseOut','acceptIndex','note'],['intentId','responseOut','acceptIndex','note']);
    absolute(input.buyer.responseOut,'original buyer response path');text(input.buyer.intentId,'original buyer intent ID',128);
    text(input.buyer.note,'buyer review note');need(Number.isSafeInteger(input.buyer.acceptIndex)&&input.buyer.acceptIndex>=0,'NATIVE_PAYMENT','Select the original catalog payment option.',422);}
  if(input.startService){fields(input.startService,['note'],['note']);text(input.startService.note,'native service note');}
  return input;
}
export function validateNativeReceiving(value,input){
  fields(value,['schema','parentOperationId','catalog','handoff','response','selection','operations','reopenNote'],
    ['schema','parentOperationId','catalog','handoff','response','selection','reopenNote']);
  need(value.schema===RECEIVING_SCHEMA&&value.parentOperationId===input.operationId,'NATIVE_RECEIVING','Select the original parent continuation.',422);
  for(const key of ['catalog','handoff','response']){
    const f=value[key];fields(f,['path','filename','bytes','sha256'],['path','filename','bytes','sha256']);
    absolute(f.path,'existing '+key+' file');hash(f.sha256);
    need(/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(f.filename??'')&&Number.isSafeInteger(f.bytes)&&f.bytes>0,
      'NATIVE_RECEIVING_FILE','Select each exact original saved file and portable destination name.',422);
  }
  need(new Set(['catalog','handoff','response'].map(k=>value[k].filename)).size===3,'NATIVE_RECEIVING_FILE','Each original input requires its own retained filename.',422);
  fields(value.selection,['rowIndex','acceptIndex','jobId','decision','reason'],['rowIndex','acceptIndex','jobId','decision','reason']);
  for(const key of ['rowIndex','acceptIndex'])need(Number.isSafeInteger(value.selection[key])&&value.selection[key]>=0,'NATIVE_RECEIVING_SELECTION','Retain the original catalog indices.',422);
  text(value.selection.jobId,'original buyer job ID',200);text(value.selection.reason,'receiving decision reason');
  need(['received','changes_requested'].includes(value.selection.decision),'NATIVE_RECEIVING_SELECTION','Use an explicit receiving decision.',422);
  if(value.operations){fields(value.operations,['caseId','deploymentId','purchaseId'],['caseId','deploymentId']);
    need(/^operation-[a-f0-9]{32}$/.test(value.operations.caseId??'')&&/^deployment-[a-f0-9]{32}$/.test(value.operations.deploymentId??'')&&
      (value.operations.purchaseId===undefined||value.operations.purchaseId===null||/^purchase-[a-f0-9]{32}$/.test(value.operations.purchaseId)),
      'NATIVE_OPERATIONS','Use the exact existing Operations case, deployment and optional purchase.',422);}
  text(value.reopenNote,'independent receiving note');return value;
}
async function connect(selected){
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(await readOwned(selected.urlFile,4096)).trim(),
    client=new AnalysisMerchantClient({...parsePrivateLink(raw),workspaceId:selected.workspaceId});
  try{await client.connect();return client;}catch(e){client.close();throw e;}
}
function samePayload(actual,expected){
  need(stable(actual)===stable(expected),'NATIVE_FORM_CHANGED','The visible form produced different original fields than the selected continuation.',409);
}
async function openPage(page,client,actor,section,ready){
  await page.goto(client.privateLink('/analysis/merchant/'),{waitUntil:'domcontentloaded'});
  await page.locator('#identity').filter({hasText:client.workspaceId}).waitFor();
  await page.locator('#actor').fill(actor);await page.locator('[data-page="'+section+'"]').click();await page.locator(ready).waitFor();
  need(new URL(page.url()).origin===client.origin,'NATIVE_PAGE_SCOPE','The operator page left its selected original origin.');
}
async function selectProject(page,projectId,ready){
  const select=page.locator('#project-selector');await select.locator('option[value="'+projectId+'"]').waitFor({state:'attached'});
  if(await select.inputValue()!==projectId){await select.selectOption(projectId);await page.locator(ready).waitFor();}
  need(await page.locator('#project-selector').inputValue()===projectId,'NATIVE_PROJECT','The original project selector changed.');
}
async function fill(page,form,values){
  for(const [key,value]of Object.entries(values)){
    const node=page.locator(form+' [name="'+key+'"]');need(await node.count()===1,'NATIVE_FORM','The original field '+key+' is unavailable.');
    if(await node.evaluate(n=>n.tagName)==='SELECT')await node.selectOption(String(value));else await node.fill(String(value));
  }
}
async function screenshot(journal,page,name){
  return journal.phase(name,async()=>{
    const path=join(journal.root,name+'.png');let prior;
    try{prior=await readOwned(path,24*1024*1024);}catch(e){if(e.code!=='ENOENT')throw e;}
    const raw=prior??await page.screenshot({fullPage:true});if(!prior)await publish(path,raw);
    return {path,bytes:raw.length,sha256:sha(raw)};
  }).then(async file=>{await verifyFile(file.path,file,24*1024*1024);return file;});
}
async function download(journal,name,endpoint,selection){
  const native=new MerchantSensorThingsWorkspaces({schema:'stellar-forge.sensorthings-workspace-connection.v1',
    workspaces:{original:{label:'Original selected analysis workspace',workspaceId:endpoint.workspaceId,consoleUrlFile:endpoint.urlFile}}});
  try{
    const scope={client:native,workspace:'original',workspaceId:endpoint.workspaceId,selection,signal:journal.signal};
    const selected=await journal.phase(name+'-selection',()=>inspectSensorThingsFiles(scope)),directory=join(journal.root,name);
    await downloadSensorThingsFiles({...scope,directory,exportId:selected.manifest.id,
      expectedManifestSha256:selected.manifestSha256,onProgress:value=>journal.progress({phase:name,receiving:value})});
    const raw=await readOwned(join(directory,DOWNLOAD_MANIFEST),16*1024*1024),manifest=parseSensorThingsDownloadManifest(raw,selected.manifest.id);
    need(sha(raw)===selected.manifestSha256&&stable(manifest)===stable(selected.manifest),
      'NATIVE_DOWNLOAD_MANIFEST','The complete native file receiver returned another original selection.');
    for(const file of manifest.files)await verifyFile(join(directory,file.name),file);
    return journal.observe(name,{directory,manifestFile:{path:join(directory,DOWNLOAD_MANIFEST),bytes:raw.length,sha256:sha(raw)},manifest});
  }finally{await native.close();}
}
function downloaded(files,original){
  const matches=files.manifest.files.filter(f=>f.bytes===original.bytes&&f.sha256===original.sha256&&
    f.selection?.file===original.storage.operationId+'/'+original.storage.filename);
  need(matches.length===1,'NATIVE_DOWNLOAD_SELECTION','The exact original file selector is absent or ambiguous.');
  return {path:join(files.directory,matches[0].name),bytes:matches[0].bytes,sha256:matches[0].sha256,name:matches[0].name};
}
async function verifiedRecord(client,result,kind){
  need(result.result?.kind===kind,'NATIVE_RECORD','The original operation returned another delivery kind.');
  const checked=await client.record(result.result.id);
  need(checked.availability==='VERIFIED'&&stable(checked.record)===stable(result.result),
    'NATIVE_RECORD_CHANGED','The original committed record or its complete files changed.');return checked;
}
/** Consume the existing owner's browser page. Without receiving, return the
 * original preparation; later supply the saved output on the SAME input/control. */
export async function runMerchantDelivery(input,{page,receiving=null,signal,progress=()=>{}}={}){
  validateNativeInput(input);if(receiving)validateNativeReceiving(receiving,input);
  need(page&&typeof page.goto==='function','NATIVE_BROWSER','Use the already owned actual browser page.',422);
  const journal=await openNativeJournal(input,{signal,progress}),clients=[];
  try{
    const source=await connect(input.source);clients.push(source);
    await journal.observe('source-endpoint',{origin:source.origin,workspaceId:source.workspaceId});
    const pub=input.publication,current=await source.overview(pub.projectId),
      original=current.publications.find(x=>x.id===pub.publicationId),exported=current.exports.find(x=>x.id===pub.exportId);
    need(original?.publicationSha256===pub.publicationSha256&&original.versionId===pub.versionId&&
      exported?.file?.sha256===pub.archiveSha256&&exported.file.bytes===pub.archiveBytes,
      'NATIVE_SOURCE_CHANGED','The supplied original publication/export map does not match the source workspace.');
    const publication=await source.request('/api/analysis/publications/'+encodeURIComponent(pub.publicationId)),
      companions=publication.files.filter(f=>input.offer.companions.includes(f.name)).map(f=>f.name);
    need(companions.length===input.offer.companions.length,'NATIVE_COMPANIONS','An explicitly selected original companion is unavailable.');
    const offerPayload={publicationId:pub.publicationId,expectedPublicationSha256:pub.publicationSha256,
      exportId:pub.exportId,expectedArchiveSha256:pub.archiveSha256,...input.offer,companions,actor:input.actor};
    const offered=await runBrowserAction(journal,{name:'offer',client:source,page,action:'analysis.merchant.offer',
      validatePayload:p=>samePayload(p,offerPayload),prepare:async()=>{
        await openPage(page,source,input.actor,'publications','#offer-form');await selectProject(page,pub.projectId,'#offer-form');
        if(await page.locator('#publication-selector').inputValue()!==pub.publicationId){
          await page.locator('#publication-selector').selectOption(pub.publicationId);await page.locator('#offer-form').waitFor();
        }
        await page.waitForFunction(id=>document.querySelector('#publication-selector')?.value===id,pub.publicationId);
        await fill(page,'#offer-form',{exportId:pub.exportId,title:input.offer.title,origin:input.offer.origin,routePrefix:input.offer.routePrefix,
          description:input.offer.description,license:input.offer.license,scheme:input.offer.payment.scheme,network:input.offer.payment.network,
          asset:input.offer.payment.asset,amount:input.offer.payment.amount,payTo:input.offer.payment.payTo,
          maxTimeoutSeconds:input.offer.payment.maxTimeoutSeconds,extra:JSON.stringify(input.offer.payment.extra??{}),reason:input.offer.reason});
        const boxes=page.locator('#offer-form input[name="companions"]');
        for(let i=0;i<await boxes.count();i++){const box=boxes.nth(i);await box.setChecked(companions.includes(await box.getAttribute('value')));}
        await page.locator('#offer-form button[type="submit"]').click();
      }});
    const checked=await verifiedRecord(source,offered,'offer'),offer=checked.record;
    need(offer.value.binding.publicationSha256===pub.publicationSha256&&offer.value.binding.archive.sha256===pub.archiveSha256,
      'NATIVE_OFFER_BINDING','The original native offer binds another publication or complete archive.');
    const offerFiles=await download(journal,'offer-files',input.source,{kind:'analysis',id:offer.id}),catalog=downloaded(offerFiles,offer.value.catalog);
    let service=null,buyer=null,buyerFiles=null;
    async function offerPage(){
      await openPage(page,source,input.actor,'offers','[data-offer-id="'+offer.id+'"]');
      await page.locator('[data-offer-id="'+offer.id+'"]').click();await page.locator('#buyer-form').waitFor();
      await page.waitForFunction(id=>document.querySelector('#content')?.textContent.includes(id),checked.recordSha256);
    }
    if(input.startService){
      const payload={offerId:offer.id,expectedOfferSha256:checked.recordSha256,actor:input.actor,note:input.startService.note};
      service=await runBrowserAction(journal,{name:'service-start',client:source,page,action:'analysis.merchant.start',
        validatePayload:p=>samePayload(p,payload),prepare:async()=>{
          await offerPage();await fill(page,'#service-form',{note:input.startService.note});await page.locator('#start-offer').click();
        }});
      await verifiedRecord(source,service,'service-start');
    }
    if(input.buyer){
      const rowIndex=offer.value.routes.findIndex(r=>r.key==='project'),route=offer.value.routes[rowIndex];
      need(route?.sha256===pub.archiveSha256&&route.bytes===pub.archiveBytes,'NATIVE_BUYER_FILE','The complete project route changed.');
      const payload={offerId:offer.id,expectedOfferSha256:checked.recordSha256,file:route.key,rowIndex,
        acceptIndex:input.buyer.acceptIndex,intentId:input.buyer.intentId,responseOut:input.buyer.responseOut,actor:input.actor,note:input.buyer.note};
      buyer=await runBrowserAction(journal,{name:'buyer-review',client:source,page,action:'analysis.merchant.buyer.prepare',
        validatePayload:p=>samePayload(p,payload),prepare:async()=>{
          await offerPage();await fill(page,'#buyer-form',{file:rowIndex,acceptIndex:input.buyer.acceptIndex,intentId:input.buyer.intentId,
            responseOut:input.buyer.responseOut,note:input.buyer.note});await page.locator('#buyer-form button[type="submit"]').click();
        }});
      await verifiedRecord(source,buyer,'buyer-preparation');buyerFiles=await download(journal,'buyer-review-files',input.source,{kind:'analysis',id:buyer.result.id});
    }
    await offerPage();const offerImage=await screenshot(journal,page,'offer-view');
    const prepared=await journal.phase('prepared',async()=>({schema:NATIVE_SCHEMA,operationId:input.operationId,state:'PREPARED',
      originalWorkspaceId:source.workspaceId,publication:pub,offer:offered,offerFiles,catalog,buyer,buyerFiles,service,
      images:[offerImage],nativeBuyerDispatched:false,meaning:'Original file offer and optional existing SF88 review. Payment and saved-output receiving remain distinct original operations.'}));
    await publish(join(journal.root,'prepared.json'),prepared);
    if(!receiving)return {prepared,current:{service:await source.request('/api/analysis/merchant/services/'+offer.id)},
      next:'Supply the exact already-saved catalog, original SF88 handoff and complete response on this same continuation.'};
    await journal.observe('receiving-selection',receiving);
    need(receiving.catalog.sha256===offer.value.catalog.sha256&&receiving.catalog.bytes===offer.value.catalog.bytes&&
      receiving.response.sha256===pub.archiveSha256&&receiving.response.bytes===pub.archiveBytes,
      'NATIVE_RECEIVING_CHANGED','The receiving files differ from this exact prepared offer and complete project.');
    const receiver=await connect(input.receiver);clients.push(receiver);
    await journal.observe('receiver-endpoint',{origin:receiver.origin,workspaceId:receiver.workspaceId});
    const selectedFiles={};
    for(const key of ['catalog','handoff','response']){
      const file=receiving[key];await verifyFile(file.path,file);
      selectedFiles[key]=await receiveFile(file.path,input.receiver.inboxDirectory,file.filename,file,{signal});
    }
    const baseSelection={projectId:pub.projectId,versionId:pub.versionId,...selectedFiles,...receiving.selection,
      publicationId:pub.publicationId,expectedPublicationSha256:pub.publicationSha256,
      operations:receiving.operations?{caseId:receiving.operations.caseId}:null};
    const receipt=await runBrowserAction(journal,{name:'receive-original',client:receiver,page,action:'analysis.merchant.receive',
      validatePayload:p=>{
        const {operations,actor,...base}=p;need(actor===input.actor&&stable(base)===stable((({operations,...v})=>v)(baseSelection)),
          'NATIVE_RECEIVING_FORM','The visible receiving form changed the exact source/job/publication decision.');
        if(receiving.operations)need(operations?.caseId===receiving.operations.caseId&&operations.deploymentId===receiving.operations.deploymentId&&
          (operations.purchaseId??null)===(receiving.operations.purchaseId??null)&&Number.isSafeInteger(operations.expectedCaseVersion)&&
          /^[a-f0-9]{64}$/.test(operations.expectedPreviewSha256??'')&&typeof operations.origin==='string',
          'NATIVE_OPERATIONS_FORM','The visible form did not bind the selected original case and current preview.');
        else need(operations===null,'NATIVE_OPERATIONS_FORM','An unselected Operations association appeared.');
      },prepare:async()=>{
        await openPage(page,receiver,input.actor,'receiving','#receiving-inputs');
        await fill(page,'#receiving-inputs',Object.fromEntries(Object.entries(selectedFiles).map(([k,v])=>[k,v.filename])));
        await page.locator('#receiving-inputs button[type="submit"]').click();await page.locator('#receiving-review').waitFor();
        await fill(page,'#receiving-review',{rowIndex:receiving.selection.rowIndex});
        await fill(page,'#receiving-review',{acceptIndex:receiving.selection.acceptIndex,jobId:receiving.selection.jobId,
          publicationId:pub.publicationId,decision:receiving.selection.decision,reason:receiving.selection.reason,caseId:receiving.operations?.caseId??''});
        if(receiving.operations){
          await page.locator('#load-case').click();await page.locator('#case-pane [name="deploymentId"]').waitFor();
          await fill(page,'#receiving-review',{deploymentId:receiving.operations.deploymentId,purchaseId:receiving.operations.purchaseId??''});
        }
        await page.locator('#preview-receiving').click();await page.waitForFunction(()=>document.querySelector('#receive-commit')?.disabled===false);
        await page.locator('#receive-commit').click();
      }});
    const receiptChecked=await verifiedRecord(receiver,receipt,'receiving');
    need(stable(receipt.result.value.binding)===stable(offer.value.binding)&&receipt.result.value.buyer.jobId===receiving.selection.jobId,
      'NATIVE_RECEIVING_RESULT','The completed original receiving record differs from the prepared publication/job.');
    await openPage(page,receiver,input.actor,'history','#resume-form');await page.locator('#content').filter({hasText:receipt.result.id}).waitFor();
    const receivingImage=await screenshot(journal,page,'receiving-view'),
      receivedFiles=await download(journal,'receiving-files',input.receiver,{kind:'analysis',id:receipt.result.id});
    const exportPayload={projectId:pub.projectId,actor:input.actor,note:'Complete analysis and merchant delivery history for independent receiving.'};
    const completeExport=await runBrowserAction(journal,{name:'complete-project-export',client:receiver,page,action:'analysis.export',
      validatePayload:p=>samePayload(p,exportPayload),prepare:async()=>{
        await openPage(page,receiver,input.actor,'handover','#project-selector');
        await selectProject(page,pub.projectId,'#handover-export');await page.locator('#handover-export').click();
      }});
    need(completeExport.result.schema==='stellar-forge.sensorthings-analysis-project-export.v1'&&completeExport.result.projectId===pub.projectId&&
      completeExport.result.originalWorkspaceId===receiver.workspaceId,'NATIVE_PROJECT_EXPORT','The original exporter returned another workspace/project.');
    const completeFiles=await download(journal,'complete-project-files',input.receiver,{kind:'analysis',id:completeExport.result.id}),
      completeArchive=downloaded(completeFiles,completeExport.result.file);
    const reopened=await connect(input.reopened);clients.push(reopened);
    await journal.observe('reopened-endpoint',{origin:reopened.origin,workspaceId:reopened.workspaceId});
    const archive=await receiveFile(completeArchive.path,input.reopened.inboxDirectory,
      'analysis-delivery-'+completeArchive.sha256.slice(0,24)+'.ndjson.gz',completeArchive,{signal});
    const importPayload={filename:archive.filename,expectedSha256:archive.sha256,expectedBytes:archive.bytes,actor:input.actor,note:receiving.reopenNote};
    const reopenedResult=await runBrowserAction(journal,{name:'independent-project-receiving',client:reopened,page,action:'analysis.import',
      validatePayload:p=>samePayload(p,importPayload),prepare:async()=>{
        await openPage(page,reopened,input.actor,'handover','#project-receiving');
        await fill(page,'#project-receiving',{archive:archive.filename});
        await page.locator('#project-receiving button[type="submit"]').click();await page.locator('#project-import-form').waitFor();
        await fill(page,'#project-import-form',{note:receiving.reopenNote});await page.locator('#project-import-form button[type="submit"]').click();
      }});
    const imported=await reopened.record(receipt.result.id),reopenedPublication=await reopened.request('/api/analysis/publications/'+pub.publicationId),
      history=await reopened.operations();
    need(imported.availability==='VERIFIED'&&stable(imported.record)===stable(receipt.result)&&identity(reopenedPublication)===pub.publicationSha256,
      'NATIVE_REOPEN_CHANGED','Independent receiving changed the original publication or complete receiving record.');
    need(history.importedHistory.some(x=>x.originWorkspaceId===receiver.workspaceId&&x.original.operationId===receipt.operationId&&
      x.original.requestSha256===receipt.requestSha256),'NATIVE_HISTORY_CHANGED','The independent project omitted its original receiving-operation history.');
    const reopenedFiles=await download(journal,'reopened-receiving-files',input.reopened,{kind:'analysis',id:receipt.result.id});
    need(stable(receivedFiles.manifest.files.map(f=>({selection:f.selection,bytes:f.bytes,sha256:f.sha256})))===
      stable(reopenedFiles.manifest.files.map(f=>({selection:f.selection,bytes:f.bytes,sha256:f.sha256}))),
      'NATIVE_REOPEN_FILES','The independently received record has a different original file closure.');
    await openPage(page,reopened,input.actor,'history','#resume-form');await page.locator('#content').filter({hasText:receipt.result.id}).waitFor();
    const reopenedImage=await screenshot(journal,page,'independent-receiving-view');
    const final=await journal.phase('complete',async()=>({schema:NATIVE_SCHEMA,operationId:input.operationId,state:'COMPLETE',
      prepared,receivingSelection:receiving,receipt,receivedFiles,completeExport,completeFiles,completeArchive,reopenedResult,reopenedFiles,
      originalPublicationSha256:pub.publicationSha256,originalReceivingRecordSha256:receiptChecked.recordSha256,
      images:[offerImage,receivingImage,reopenedImage],nativeBuyerDispatched:false,sourceCaptureExecuted:false,
      meaning:'Same reviewed publication, actual original SF88 saved output, full native project receiving, optional original SF47 association, complete project export and independent reopen.'}));
    await publish(join(journal.root,'complete.json'),final);
    return {result:final,current:{source:await source.overview(pub.projectId),receiver:await receiver.overview(pub.projectId),
      reopened:await reopened.overview(pub.projectId)},currentStateMeaning:'Current workspace revisions are separate from the frozen original handover.'};
  }finally{for(const client of clients)client.close();await journal.close();}
}
