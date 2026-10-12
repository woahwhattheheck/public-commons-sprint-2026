// MIT. Original SF74 quotations, Research revisions and paid publication share one operating owner.
import {join,basename} from 'node:path';
import {readResearchHostFile,openResearchSource} from '../workspace-files.mjs';
import {writePortableFile} from '../portable.mjs';
import {digest,parseJson} from '../../node/store.mjs';
import {openCaseStore} from '../../../sf74-merchant-support-console/case-store.mjs';
import {serializeWorkspace} from '../../../sf74-merchant-support-console/workspace-file.mjs';
import {openCaseCommercial,commercialWorkspaceId} from '../../../sf74-merchant-support-console/case-commercial.mjs';
import {openCommercialReceivingController} from '../../../sf74-merchant-support-console/commercial/operator.mjs';
import {openCommercialTariffController} from '../../../sf74-merchant-support-console/commercial/tariff-controller.mjs';
import {compileCheckout} from '../../../sf101-merchant-receiver/checkout-config.mjs';
import {inspectOrder} from '../../../sf101-merchant-receiver/checkout.mjs';
import {inspectCommerceRecord} from '../customer-commerce/files.mjs';
import {phaseId} from '../customer-commerce/contracts.mjs';
import {customerIdentifier,customerRevision} from '../customer-updates/contracts.mjs';
import {readResearchQuoteConfiguration,quoteDirectoryIdentity,assertQuoteDirectory,quoteConfigurationView,openQuotePricing,selectQuotePricing}
 from './configuration.mjs';
import {QUOTES_SCHEMA,QUOTE_OPERATION_SCHEMA,QUOTE_FILE_LIMIT,fields,id,hash,dossier,need,copy,same,fingerprint,
 briefSelection,responseSelection,normalizePublicationSelection,realizedSelection,caseSelection,applySelection,serialized}
 from './contracts.mjs';
import {quoteRoot,operationPath,withCustomerOperation,optional,retainQuoteRequest,readQuoteOperation,operationView,
 saveQuoteReview,saveQuoteResult,retainCustomerBytes,retainCustomerJson,verifyQuoteFiles,quoteInventory,
 quoteOperationFiles,openQuoteFile,exists,now} from './files.mjs';
import {researchQuoteBrief,researchQuoteResponse,researchQuotePublication,researchQuoteRealized,
 renderResearchQuoteRealized} from './model.mjs';

const CASE_ACTIONS=Object.freeze({
 preview:'preview','save-draft':'saveDraft',publish:'publish',receive:'receive','receive-pricing':'receivePricing',
 compare:'compare','preview-implementation':'previewImplementation','adopt-implementation':'adoptImplementation',
});
const RECEIVING_ACTIONS=Object.freeze({
 'receiving-status':'status','receiving-capture':'capture','receiving-inspect':'inspect','receiving-attach':'attach',
 'receiving-case':'inspect-case','receiving-restore':'restore',
});
const TARIFF_ACTIONS=Object.freeze({
 'tariff-status':'status','tariff-catalog':'catalog','tariff-selection':'selection','tariff-capture':'capture',
 'tariff-inspect':'inspect','tariff-attach':'attach','tariff-case':'case','tariff-restore':'restore',
});
export const RESEARCH_QUOTE_CASE_ACTIONS=Object.freeze([...Object.keys(CASE_ACTIONS),...Object.keys(RECEIVING_ACTIONS),...Object.keys(TARIFF_ACTIONS)]);
export const RESEARCH_QUOTE_PRICING_ACTIONS=Object.freeze([
 'state','preview','save','version','compare','planning-state','planning-preview','planning-save','planning-read',
 'economics-state','economics-preview','economics-save','economics-edition','economics-proposal','economics-apply',
 'repricing-source','repricing-preview','repricing-save','repricing-stage',
]);
const filePin=value=>({name:value.name,bytes:value.bytes,sha256:value.sha256});
function caseIdentity(record){return {id:record.id,revision:record.revision,currentRevision:record.currentRevision,
 name:record.name,metadata:copy(record.metadata),workspaceSha256:digest(Buffer.from(record.workspaceText)),
 supportSha256:record.supportText===null?null:digest(Buffer.from(record.supportText))};}

/** All writes below use the original native engines. This owner retains their complete selected inputs. */
export async function openResearchCustomerQuotes({directory,workspaceId,configurationFile=null,dossiers,commerce,merchant,
 environment=process.env}={}){
 need(/^research_[a-f0-9]{64}$/.test(workspaceId??'')&&dossiers?.customerUpdates&&dossiers?.reviewCustomerUpdate&&
  commerce?.preparePublication&&typeof merchant==='function','RESEARCH_QUOTE_ORIGINAL_HOST_REQUIRED');
 const root=await quoteRoot(directory),configuration=await readResearchQuoteConfiguration(configurationFile,{directory:root});
 const store=await openCaseStore(configuration.casesDirectory),casesIdentity=await quoteDirectoryIdentity(configuration.casesDirectory),
  casesWorkspaceId=commercialWorkspaceId(configuration.casesDirectory),commercial=openCaseCommercial({store,workspaceId:casesWorkspaceId}),
  receiving=openCommercialReceivingController({store,casesDirectory:configuration.casesDirectory,environment}),
  tariffs=openCommercialTariffController({store,casesDirectory:configuration.casesDirectory}),
  pending=new Set(),sources=new Set(),failedOwners=new Set(),pricingOwners=new Map();
 let stopping=false,closing,receivingClosed=false,tariffsClosed=false;
 function run(work){
  need(!stopping,'RESEARCH_QUOTE_CLOSING',503);need(pending.size<32,'RESEARCH_QUOTE_CAPACITY',429);
  const promise=Promise.resolve().then(work).catch(error=>{if(typeof error?.close==='function')failedOwners.add(error);throw error;});
  pending.add(promise);promise.finally(()=>pending.delete(promise)).catch(()=>{});return promise;
 }
 async function checkedCases(){await assertQuoteDirectory(casesIdentity);}
 async function selectedPricing(profile){
  // The original model owns captured observations used by its later preview/save.
  // Keep that same model across HTTP calls, including exact native request replay.
  let promise=pricingOwners.get(profile);
  if(!promise){
   promise=openQuotePricing(configuration,profile);pricingOwners.set(profile,promise);
   promise.catch(()=>{if(pricingOwners.get(profile)===promise)pricingOwners.delete(profile);});
  }
  const original=await promise,current=await selectQuotePricing(configuration,profile);
  need(same(original.binding.directory,current.binding.directory)&&same(original.options,current.options),
   'RESEARCH_QUOTE_PRICING_DIRECTORY_CHANGED',409);
  return {...original,binding:current.binding,bindingSha256:current.bindingSha256};
 }
 function envelope(action,result,extra={}){return {schema:QUOTES_SCHEMA,workspaceId,...extra,action,result};}
 async function withSource(source,work){
  sources.add(source);let primary;
  try{return await work(source);}catch(error){primary=error;throw error;}
  finally{
   try{await source.close();sources.delete(source);}
   catch(error){if(primary)primary.researchQuoteClose=error.code??'RESEARCH_QUOTE_SOURCE_CLOSE_INCOMPLETE';else throw error;}
  }
 }
 async function put(root,name,body){return filePin(await retainCustomerBytes(root,name,Buffer.from(body)));}
 async function putJson(root,name,value){return put(root,name,serialized(value));}
 async function retainedExternal(root,name,source){
  need(Number.isSafeInteger(source.bytes)&&source.bytes>0&&source.bytes<=QUOTE_FILE_LIMIT,'RESEARCH_QUOTE_FILE_LIMIT');
  const target=join(root,name);
  if(await exists(target)){
   return withSource(await openResearchSource(target,source.bytes,{sha256:source.sha256}),async held=>{
    need(held.bytes===source.bytes,'RESEARCH_QUOTE_FILE_CHANGED');return {name,bytes:held.bytes,sha256:held.sha256};});
  }
  return withSource(await openResearchSource(source.path,source.bytes,{sha256:source.sha256}),async held=>{
   const result=await writePortableFile(target,{filename:name,contentType:'application/octet-stream',body:held.stream});
   need(result.bytes===source.bytes&&result.sha256===source.sha256,'RESEARCH_QUOTE_FILE_CHANGED');
   return {name,bytes:result.bytes,sha256:result.sha256};
  });
 }
 async function collection(dossierId,revision,section,projectId){
  const rows=[];let offset=0;
  do{
   const result=await dossiers.customerUpdates(dossierId,{revision,section,...(projectId?{projectId}:{}),offset,limit:100});
   need(result.revision===revision&&Array.isArray(result.items),'RESEARCH_QUOTE_NATIVE_PAGE_CHANGED');
   rows.push(...result.items);need(rows.length<=100000,'RESEARCH_QUOTE_NATIVE_HISTORY_LIMIT');
   if(result.nextOffset===null)return rows;
   need(result.nextOffset>offset,'RESEARCH_QUOTE_NATIVE_PAGE_CHANGED');offset=result.nextOffset;
  }while(true);
 }
 async function researchSelection(input){
  dossier(input.dossierId);customerRevision(input.revision);customerIdentifier(input.projectId);customerIdentifier(input.briefId);
  const projects=await collection(input.dossierId,input.revision,'projects',input.projectId),
   briefs=await collection(input.dossierId,input.revision,'briefs',input.projectId),
   project=projects.find(row=>row.id===input.projectId),brief=briefs.find(row=>row.id===input.briefId);
  need(project&&brief&&brief.projectId===project.id&&project.currentBriefId===brief.id,'RESEARCH_QUOTE_SELECTED_BRIEF_CHANGED',409);
  return {project,brief};
 }
 async function snapshotCase(target,caseId,revision,quoteId,quoteSha256){
  await checkedCases();
  const record=await store.read(caseId,revision),view=await commercial.read({id:caseId,revision});
  const quote=view.quotes.find(row=>row.id===quoteId&&row.sha256===quoteSha256);
  need(quote,'RESEARCH_QUOTE_SELECTED_QUOTE_CHANGED',409);
  const exported=await commercial.download({id:caseId,scope:{workspaceId:casesWorkspaceId,caseId},revision,
   quoteId,quoteSha256,kind:'QUOTE_JSON'});
  const original=JSON.parse(Buffer.from(exported.body).toString('utf8'));
  const files=[await put(target,'case.workspace.json',record.workspaceText),
   await put(target,'quote.json',exported.body)];
  if(record.supportText!==null)files.push(await put(target,'case.support.json',record.supportText));
  return {record,view,quote:original,files};
 }
 async function retainedBinding(bindingId){
  id(bindingId);const selected=await readQuoteOperation(operationPath(root,bindingId));
  need(selected.request.workspaceId===workspaceId&&selected.request.casesWorkspaceId===casesWorkspaceId&&
   selected.request.kind==='BRIEF'&&selected.result,'RESEARCH_QUOTE_APPLIED_BRIEF_REQUIRED');
  await verifyQuoteFiles(operationPath(root,bindingId),selected.review.proof.files);return selected;
 }
 async function copyBinding(target,binding){
  const origin=operationPath(root,binding.request.id),files=[];
  for(const file of binding.review.proof.files.filter(row=>['case.workspace.json','case.support.json','quote.json','research-source.json','merchant-offer.json'].includes(row.name)))
   files.push(await retainedExternal(target,file.name,{...file,path:join(origin,file.name)}));
  files.push(await putJson(target,'binding-record.json',operationView(binding)));return files;
 }
 async function selectedOperation(requestId){
  const dir=operationPath(root,requestId),record=await readQuoteOperation(dir);
  need(record.request.workspaceId===workspaceId&&record.request.casesWorkspaceId===casesWorkspaceId,
   'RESEARCH_QUOTE_WORKSPACE_CHANGED',409);
  return operationView(record);
 }
 async function retainedWork(kind,input,work){
  return withCustomerOperation(operationPath(root,input.requestId),async target=>{
   const request=await retainQuoteRequest(target,{kind,input,workspaceId,casesWorkspaceId});
   const old=await readQuoteOperation(target);
   if(old.review||old.result){
    if(old.review)await verifyQuoteFiles(target,old.review.proof.files);
    if(kind==='REALIZED'&&old.review&&!old.result){
     const report=await optional(target,'realized.json'),{sha256,...content}=report??{};
     need(sha256===old.review.proof.reportSha256&&fingerprint(content)===sha256,'RESEARCH_QUOTE_REPORT_CHANGED');
     const proof=old.review.proof;
     await saveQuoteResult(target,request,old.review,{dossierId:proof.selection.dossierId,caseId:proof.selection.caseId,
      bindingId:proof.bindingId,publicationId:proof.publicationId,report});
     return selectedOperation(input.requestId);
    }
    return operationView(old);
   }
   await work(target,request);return selectedOperation(input.requestId);
  });
 }
 async function prepare(input){
  const selected=briefSelection(input);
  return retainedWork('BRIEF',selected,async(target,request)=>{
   const original=await researchSelection(selected),native=await snapshotCase(target,selected.caseId,selected.caseRevision,selected.quoteId,selected.quoteSha256),
    seller=await merchant(selected.merchant),files=[...native.files,
     await putJson(target,'research-source.json',{dossierId:selected.dossierId,revision:selected.revision,...original}),
     await putJson(target,'merchant-offer.json',{binding:seller.binding,bindingSha256:seller.bindingSha256,view:seller.view})];
   const proof=researchQuoteBrief(selected,{workspaceId,casesWorkspaceId,caseRecord:caseIdentity(native.record),
    quote:native.quote,...original,merchant:seller,files});
   proof.files.push(await putJson(target,'native-request.json',proof.nativeRequest));
   await saveQuoteReview(target,request,proof);
  });
 }
 async function prepareResponse(input){
  const selected=responseSelection(input);
  need(selected.bindingId!==selected.requestId,'RESEARCH_QUOTE_BINDING_ID_CHANGED');
  return retainedWork('RESPONSE',selected,async(target,request)=>{
   const binding=await retainedBinding(selected.bindingId),source=binding.review.proof;
   const view=await commercial.read({id:source.selection.caseId,revision:selected.caseRevision}),
    quote=view.quotes.find(row=>row.id===source.selection.quoteId&&row.sha256===source.selection.quoteSha256),
    response=quote?.receiving.find(row=>row.id===selected.responseId);
   need(response,'RESEARCH_QUOTE_ORIGINAL_CUSTOMER_RESPONSE_REQUIRED',409);
   const files=await copyBinding(target,binding);
   files.push(await putJson(target,'customer-response.json',response));
   const proof=researchQuoteResponse(selected,{binding,response,quote,files});
   proof.files.push(await putJson(target,'native-request.json',proof.nativeRequest));
   await saveQuoteReview(target,request,proof);
  });
 }
 async function apply(input){
  const selected=applySelection(input);
  return withCustomerOperation(operationPath(root,selected.id),async target=>{
   const record=await readQuoteOperation(target);
   need(record.request.workspaceId===workspaceId&&record.request.casesWorkspaceId===casesWorkspaceId&&
    ['BRIEF','RESPONSE'].includes(record.request.kind)&&record.review?.reviewSha256===selected.reviewSha256,
    'RESEARCH_QUOTE_REVIEW_CHANGED',409);
   await verifyQuoteFiles(target,record.review.proof.files);
   if(record.result)return operationView(record);
   // The native writer resolves this exact request before checking any later revision.
   const proof=record.review.proof,native=await dossiers.reviewCustomerUpdate(proof.selection.dossierId,
    {...copy(proof.nativeRequest),projection:'metadata'});
   await saveQuoteResult(target,record.request,record.review,{dossierId:proof.selection.dossierId,
    caseId:proof.selection.caseId,quoteId:proof.selection.quoteId,quoteSha256:proof.selection.quoteSha256,native});
   return selectedOperation(selected.id);
  });
 }

 async function findCreatedCase(caseId,workspaceText,metadata){
  let page;
  try{page=await store.history(caseId,{limit:100});}
  catch(error){if(error.code==='ENOENT'||error.code==='CASE_NOT_FOUND')return null;throw error;}
  let checked=0;
  for(;;){
   for(const entry of page.revisions){
    const record=await store.read(caseId,entry.revision);
    if(record.workspaceText===workspaceText&&same(record.metadata,metadata))return caseIdentity(record);
    need(++checked<=100000,'RESEARCH_QUOTE_CASE_HISTORY_LIMIT');
   }
   if(page.nextBefore===null)return null;
   page=await store.history(caseId,{before:page.nextBefore,limit:100});
  }
 }
 async function createCase(input){
  const selected=caseSelection(input);
  return withCustomerOperation(operationPath(root,selected.requestId),async target=>{
   const request=await retainQuoteRequest(target,{kind:'CASE',input:selected,workspaceId,casesWorkspaceId});
   let record=await readQuoteOperation(target);
   if(record.result)return operationView(record);
   if(!record.review){
    const original=await researchSelection(selected);
    const metadata={merchant:original.brief.definition.customer.name,owner:selected.actor.name,status:'new',
     followUpOn:'',nextAction:'Prepare the customer quotation for '+original.project.name,
     notes:'Research dossier '+selected.dossierId+' / project '+selected.projectId+' / brief '+selected.briefId};
    const workspaceText=await serializeWorkspace({name:original.project.name,termsText:
     original.brief.definition.purpose+'\n\nResearch brief: '+selected.briefId+'\n'+original.brief.definition.scope.note},
     {now:request.createdAt});
    const files=[await put(target,'case.workspace.json',workspaceText),
     await putJson(target,'research-source.json',{dossierId:selected.dossierId,revision:selected.revision,...original})];
    await saveQuoteReview(target,request,{schema:QUOTES_SCHEMA,kind:'CASE',caseId:selected.caseId,
     dossierId:selected.dossierId,projectId:selected.projectId,metadata,files});
    record=await readQuoteOperation(target);
   }
   await verifyQuoteFiles(target,record.review.proof.files);await checkedCases();
   const workspaceText=(await readResearchHostFile(join(target,'case.workspace.json'),QUOTE_FILE_LIMIT)).toString('utf8'),
    metadata=record.review.proof.metadata;
   let created=await findCreatedCase(selected.caseId,workspaceText,metadata);
   if(!created){
    const saved=await store.save({id:selected.caseId,expectedRevision:null,workspaceText,metadata});
    created=caseIdentity(await store.read(selected.caseId,saved.case.revision));
   }
   await saveQuoteResult(target,request,record.review,{dossierId:selected.dossierId,caseId:selected.caseId,case:created});
   return selectedOperation(selected.requestId);
  });
 }
 async function preparePublication(input){
  const selected=normalizePublicationSelection(input);
  need(selected.bindingId!==selected.requestId,'RESEARCH_QUOTE_BINDING_ID_CHANGED');
  return retainedWork('PUBLICATION',selected,async(target,request)=>{
   const binding=await retainedBinding(selected.bindingId),bound=binding.review.proof;
   need(selected.dossierId===bound.selection.dossierId,'RESEARCH_QUOTE_DOSSIER_CHANGED');
   const deliveries=await collection(selected.dossierId,selected.revision,'deliveries',bound.selection.projectId),
    requests=await collection(selected.dossierId,selected.revision,'requests',bound.selection.projectId),
    delivery=deliveries.find(row=>row.id===selected.deliveryId),requested=requests.find(row=>row.id===delivery?.requestEditionId),
    brief=binding.result.result.native.operation.result.brief;
   need(delivery?.revision===selected.revision&&requested?.definition.briefId===brief.id,'RESEARCH_QUOTE_DELIVERY_BRIEF_CHANGED',409);
   const prior=await exists(join(commerce.directory,'publications',selected.requestId,'request.json'));
   if(!prior){
    const current=await merchant(bound.merchant.id);
    need(current.view.checkoutSha256===bound.merchant.view.checkoutSha256&&same(current.view.payment,bound.merchant.view.payment),
     'RESEARCH_QUOTE_CHECKOUT_TERMS_CHANGED',409);
   }
   const {bindingId,...native}=selected;
   const nativeInput={...native,merchant:bound.merchant.id};
   const prepared=await commerce.preparePublication(nativeInput);
   const files=await copyBinding(target,binding);
   files.push(await putJson(target,'native-publication.json',nativeInput),
    await putJson(target,'commerce-review.json',prepared));
   const proof=researchQuotePublication(selected,{binding,delivery,requested,commerce:prepared,files});
   await saveQuoteReview(target,request,proof);
  });
 }
 async function enrollPublication(input){
  const selected=applySelection(input);
  return withCustomerOperation(operationPath(root,selected.id),async target=>{
   const record=await readQuoteOperation(target);
   need(record.request.workspaceId===workspaceId&&record.request.casesWorkspaceId===casesWorkspaceId&&
    record.request.kind==='PUBLICATION'&&record.review?.reviewSha256===selected.reviewSha256,
    'RESEARCH_QUOTE_REVIEW_CHANGED',409);
   await verifyQuoteFiles(target,record.review.proof.files);
   if(record.result)return operationView(record);
   const native=await commerce.enrollPublication({id:selected.id,reviewSha256:record.review.proof.commerce.review.reviewSha256});
   await saveQuoteResult(target,record.request,record.review,{dossierId:record.request.request.dossierId,
    caseId:record.review.proof.selection.caseId,publicationId:selected.id,native});
   return selectedOperation(selected.id);
  });
 }
 async function pricingCapture(target,input,boundMerchant,requestId){
  if(input===null)return {value:null,files:[]};
  const opened=await selectedPricing(input.profile),files=[];
  const manifestBytes=await opened.model.download(input.version,'manifest.json'),manifest=parseJson(manifestBytes),
   sellerBytes=await opened.model.download(input.version,'seller.json'),seller=parseJson(sellerBytes),
   route=seller.routes?.find(row=>row.id===boundMerchant.routeId),payment=boundMerchant.payment;
  need(route&&route.offer?.resource?.url===boundMerchant.purchaseUrl&&route.offer.accepts?.some(value=>
   ['scheme','network','asset','amount','payTo','maxTimeoutSeconds'].every(key=>same(value[key],payment[key]))),
   'RESEARCH_QUOTE_PRICING_MERCHANT_CHANGED',409);
  const native=await opened.model.economics.pricing(input.version),originalFiles=[];
  const add=async(name,body,originalName,kind)=>{
   const file=await put(target,name,body);files.push(file);originalFiles.push({...file,originalName,kind});return file;
  };
  await add('pricing-manifest.json',manifestBytes,'manifest.json','pricing');
  let index=0;
  for(const name of Object.keys(manifest.files)){
   const body=await opened.model.download(input.version,name),pin=manifest.files[name];
   need(body.length===pin.bytes&&digest(body)===pin.sha256,'RESEARCH_QUOTE_PRICING_FILE_CHANGED');
   await add('pricing-'+String(index++).padStart(3,'0')+'-'+basename(name),body,name,'pricing');
  }
  let cost=null,archive=null;
  if(input.costEdition){
   cost=await opened.model.economics.edition(input.costEdition);
   need(cost.pricingVersion===input.version,'RESEARCH_QUOTE_COST_VERSION_CHANGED',409);
   const costManifestBytes=await opened.model.economics.download(input.costEdition,'manifest.json'),costManifest=parseJson(costManifestBytes);
   await add('cost-manifest.json',costManifestBytes,'manifest.json','cost');
   index=0;
   for(const name of Object.keys(costManifest.files)){
    const body=await opened.model.economics.download(input.costEdition,name),pin=costManifest.files[name];
    need(body.length===pin.bytes&&digest(body)===pin.sha256,'RESEARCH_QUOTE_COST_FILE_CHANGED');
    await add('cost-'+String(index++).padStart(3,'0')+'-'+basename(name),body,name,'cost');
   }
   // One original native COST_EDITION export retains supplier originals and received lineage.
   const nativeExport=await opened.model.economics.bundle({kind:'COST_EDITION',edition:input.costEdition,
    requestId:phaseId(requestId,'research-quote-cost-export')});
   const original=await opened.model.economics.exportFile(phaseId(requestId,'research-quote-cost-export'));
   const saved=await retainedExternal(target,'supplier-cost-edition.tar',original);
   files.push(saved);archive={...saved,requestId:nativeExport.requestId??phaseId(requestId,'research-quote-cost-export')};
  }
  return {value:{profile:input.profile,version:input.version,...(input.costEdition?{costEdition:input.costEdition}:{}),
   binding:opened.binding,bindingSha256:opened.bindingSha256,merchantRouteId:boundMerchant.routeId,
   native,originalFiles,cost,archive},files};
 }
 async function prepareReport(input){
  const selected=realizedSelection(input);
  need(selected.bindingId!==selected.requestId,'RESEARCH_QUOTE_BINDING_ID_CHANGED');
  return retainedWork('REALIZED',selected,async(target,request)=>{
   const binding=await retainedBinding(selected.bindingId),bound=binding.review.proof;
   let observed=await optional(target,'observed.json');
   if(!observed){
    const publication=await commerce.publication(selected.publicationId);
    need(publication.status==='ENROLLED'&&publication.review.merchant.checkoutSha256===bound.merchant.view.checkoutSha256&&
     same(publication.review.merchant.payment,bound.merchant.view.payment),'RESEARCH_QUOTE_PUBLICATION_CHANGED',409);
    const publishedRecord=await readQuoteOperation(operationPath(root,selected.publicationId));
    need(publishedRecord.request.kind==='PUBLICATION'&&publishedRecord.request.request.bindingId===selected.bindingId,
     'RESEARCH_QUOTE_PUBLICATION_BINDING_CHANGED',409);
    const deliveryId=publication.result.publication.delivery.deliveryId,
     deliveries=await collection(bound.selection.dossierId,selected.revision,'deliveries',bound.selection.projectId),
     events=await collection(bound.selection.dossierId,selected.revision,'delivery-events',bound.selection.projectId),
     agreements=await collection(bound.selection.dossierId,selected.revision,'agreements',bound.selection.projectId);
    need(deliveries.some(row=>row.id===deliveryId),'RESEARCH_QUOTE_DELIVERY_NOT_IN_REVISION',409);
    const purchases=[];
    for(const purchaseId of selected.purchaseIds)purchases.push(await commerce.purchase(purchaseId,{refresh:true}));
    const order=await withCustomerOperation(join(commerce.directory,'publications',selected.publicationId),async original=>{
     const record=await inspectCommerceRecord(original,'publications');
     return inspectOrder(compileCheckout(record.review.proof.merchant.configuration),record.review.proof.orderReference);
    });
    const customer={dossierId:bound.selection.dossierId,revision:selected.revision,projectId:bound.selection.projectId,
     delivery:deliveries.find(row=>row.id===deliveryId),deliveryEvents:events.filter(row=>row.deliveryId===deliveryId),agreements};
    observed={schema:'sf88-research-quote-observation/v1',requestSha256:request.requestSha256,
     bindingReviewSha256:binding.review.reviewSha256,capturedAt:now(),publication,order,purchases,customer};
    await putJson(target,'observed.json',observed);
   }
   need(observed.schema==='sf88-research-quote-observation/v1'&&observed.requestSha256===request.requestSha256&&
    observed.bindingReviewSha256===binding.review.reviewSha256,'RESEARCH_QUOTE_OBSERVATION_CHANGED');
   const {publication,order,purchases,customer,capturedAt}=observed,files=await copyBinding(target,binding);
   files.push(await putJson(target,'observed.json',observed),await putJson(target,'native-order.json',order),
    await putJson(target,'publication.json',publication.result.publication),await putJson(target,'buyer-receiving.json',purchases));
   let pricing=await optional(target,'pricing-capture.json');
   if(!pricing){pricing=await pricingCapture(target,selected.pricing,bound.merchant.view,selected.requestId);
    await putJson(target,'pricing-capture.json',pricing);}
   files.push(...pricing.files,await putJson(target,'pricing-capture.json',pricing),
    await putJson(target,'customer-receiving.json',customer));
   const report=researchQuoteRealized({request:selected,binding,publication,order,purchases,customer,
    pricing:pricing.value,capturedAt,files});
   files.push(await putJson(target,'realized.json',report),
    await put(target,'realized.md',renderResearchQuoteRealized(report)));
   const proof={schema:QUOTES_SCHEMA,kind:'REALIZED',selection:copy(bound.selection),bindingId:selected.bindingId,
    publicationId:selected.publicationId,reportSha256:report.sha256,files};
   const review=await saveQuoteReview(target,request,proof);
   await saveQuoteResult(target,request,review,{dossierId:bound.selection.dossierId,caseId:bound.selection.caseId,
    bindingId:selected.bindingId,publicationId:selected.publicationId,report});
  });
 }
 async function nativeCase(caseId,action,args={}){
  id(caseId);need(RESEARCH_QUOTE_CASE_ACTIONS.includes(action),'RESEARCH_QUOTE_CASE_ACTION_REQUIRED');
  need(args.id===undefined||args.id===caseId,'RESEARCH_QUOTE_CASE_CHANGED');
  await checkedCases();const input={...copy(args),id:caseId};
  const result=Object.hasOwn(CASE_ACTIONS,action)?await commercial[CASE_ACTIONS[action]](input):
   Object.hasOwn(RECEIVING_ACTIONS,action)?await receiving.call(RECEIVING_ACTIONS[action],input):
   await tariffs.call(TARIFF_ACTIONS[action],input);
  return envelope(action,result,{caseId});
 }
 async function pricing(profile,action,input={}){
  need(RESEARCH_QUOTE_PRICING_ACTIONS.includes(action),'RESEARCH_QUOTE_PRICING_ACTION_REQUIRED');
  const opened=await selectedPricing(profile),{model,planning}=opened;
  const actions={
   state:()=>model.state(input),preview:()=>model.preview(input),save:()=>model.save(input),
   version:()=>model.economics.pricing(input.version),compare:()=>model.compare(input),
   'planning-state':()=>planning.list(input),'planning-preview':()=>planning.preview(input),
   'planning-save':()=>planning.save(input),'planning-read':()=>planning.load(input.planId),
   'economics-state':()=>model.economics.state(),'economics-preview':()=>model.economics.preview(input),
   'economics-save':()=>model.economics.save(input),'economics-edition':()=>model.economics.edition(input.edition),
   'economics-proposal':()=>model.economics.proposal(input),'economics-apply':()=>model.economics.applyPricing(input),
   'repricing-source':()=>model.repricingSource(input.version),'repricing-preview':()=>model.previewRepricing(input),
   'repricing-save':()=>model.saveRepricing(input),'repricing-stage':()=>model.stageRepricing(input),
  };
  return {...envelope(action,await actions[action](),{profile}),binding:opened.binding,bindingSha256:opened.bindingSha256};
 }
 async function nativeCaseDownload(caseId,args){
  id(caseId);need(args.id===undefined||args.id===caseId,'RESEARCH_QUOTE_CASE_CHANGED');await checkedCases();
  const result=await commercial.download({...copy(args),id:caseId});
  return {schema:QUOTES_SCHEMA,workspaceId,caseId,case:result.case,
   descriptor:{name:result.descriptor.filename,bytes:result.descriptor.bytes,sha256:result.descriptor.sha256,
    contentType:result.descriptor.mediaType??(result.descriptor.filename.endsWith('.md')?'text/markdown; charset=utf-8':'application/json; charset=utf-8')},
   body:result.body};
 }
 return {
  directory:root,workspaceId,casesWorkspaceId,
  configuration:()=>run(async()=>{
   await checkedCases();const configured=await commerce.configuration();
   return quoteConfigurationView(configuration,{workspaceId,casesIdentity,commercialWorkspaceId:casesWorkspaceId,
    merchants:{items:configured.merchants,errors:configured.errors}});
  }),
  listCases:query=>{const selected=copy(query??{});return run(async()=>{await checkedCases();
   return envelope('cases',await store.list(selected));});},
  readCase:(caseId,query={})=>{id(caseId);const selected=copy(query);fields(selected,['revision'],[]);
   if(selected.revision!==undefined)hash(selected.revision);return run(async()=>{await checkedCases();
    return envelope('case',await commercial.read({id:caseId,...selected}),{caseId});});},
  caseAction:(caseId,action,args)=>{const selected=copy(args);return run(()=>nativeCase(caseId,action,selected));},
  createCase:input=>{const selected=caseSelection(input);return run(()=>createCase(selected));},
  prepare:input=>{const selected=briefSelection(input);return run(()=>prepare(selected));},
  prepareResponse:input=>{const selected=responseSelection(input);return run(()=>prepareResponse(selected));},
  apply:input=>{const selected=applySelection(input);return run(()=>apply(selected));},
  preparePublication:input=>{const selected=normalizePublicationSelection(input);return run(()=>preparePublication(selected));},
  enrollPublication:input=>{const selected=applySelection(input);return run(()=>enrollPublication(selected));},
  prepareReport:input=>{const selected=realizedSelection(input);return run(()=>prepareReport(selected));},
  pricing:(profile,action,input)=>{const selected=copy(input??{});return run(()=>pricing(profile,action,selected));},
  list:query=>{const selected=copy(query??{});return run(async()=>({workspaceId,...await quoteInventory(root,selected)}));},
  operation:requestId=>{id(requestId);return run(()=>selectedOperation(requestId));},
  files:requestId=>{id(requestId);return run(async()=>{
   await selectedOperation(requestId);const value=await quoteOperationFiles(operationPath(root,requestId));
   return {schema:QUOTES_SCHEMA,workspaceId,id:requestId,files:value.files};});},
  fileInfo:(requestId,name)=>{id(requestId);return run(async()=>{
   await selectedOperation(requestId);const value=await quoteOperationFiles(operationPath(root,requestId)),
    descriptor=value.files.find(row=>row.name===name);need(descriptor,'RESEARCH_QUOTE_FILE_NOT_FOUND',404);
   return {schema:QUOTES_SCHEMA,workspaceId,id:requestId,descriptor};});},
  streamFile:(requestId,name,consume)=>{id(requestId);need(typeof consume==='function','RESEARCH_QUOTE_FILE_CONSUMER_REQUIRED');
   return run(async()=>{await selectedOperation(requestId);
    return withSource(await openQuoteFile(operationPath(root,requestId),name),consume);});},
  caseFileInfo:(caseId,args)=>{const selected=copy(args);return run(async()=>{
   const {body,...result}=await nativeCaseDownload(caseId,selected);return result;});},
  streamCaseFile:(caseId,args,consume)=>{const selected=copy(args);need(typeof consume==='function','RESEARCH_QUOTE_FILE_CONSUMER_REQUIRED');
   return run(async()=>{const value=await nativeCaseDownload(caseId,selected);
    return consume({...value.descriptor,stream:(async function*(){yield value.body;})(),case:value.case});});},
  tariffFileInfo:(caseId,args)=>{const selected=copy(args);id(caseId);return run(async()=>{
   await checkedCases();const original=await tariffs.call('download',{...selected,id:caseId}),result=original.result;
   return {schema:QUOTES_SCHEMA,workspaceId,caseId,case:original.case,descriptor:{
    name:result.descriptor.filename,bytes:result.descriptor.bytes,sha256:result.descriptor.sha256,
    contentType:result.descriptor.mediaType??'application/json; charset=utf-8'}};});},
  streamTariffFile:(caseId,args,consume)=>{const selected=copy(args);id(caseId);return run(async()=>{
   await checkedCases();const original=await tariffs.call('download',{...selected,id:caseId}),result=original.result;
   return consume({name:result.descriptor.filename,bytes:result.descriptor.bytes,sha256:result.descriptor.sha256,
    contentType:result.descriptor.mediaType??'application/json; charset=utf-8',
    stream:(async function*(){yield result.body;})()});});},
  close(){
   if(closing)return closing;stopping=true;
   return closing=(async()=>{
    await Promise.allSettled([...pending]);const errors=[];
    if(!receivingClosed)try{await receiving.close();receivingClosed=true;}catch(error){errors.push(error);}
    if(!tariffsClosed)try{await tariffs.close();tariffsClosed=true;}catch(error){errors.push(error);}
    for(const source of [...sources])try{await source.close();sources.delete(source);}catch(error){errors.push(error);}
    for(const owner of [...failedOwners])try{await owner.close();failedOwners.delete(owner);}catch(error){errors.push(error);}
    if(!errors.length)pricingOwners.clear();
    if(errors.length){const [first,...rest]=errors;if(rest.length)first.researchQuoteCloseErrors=rest;throw first;}
   })().catch(error=>{closing=null;throw error;});
  },
 };
}
