// MIT. Freeze an original Research handover, then enroll its exact SF101 order.
import {join} from 'node:path';
import {compileCheckout,orderHandoff} from '../../../sf101-merchant-receiver/checkout-config.mjs';
import {inspectOrder,prepareHandoff} from '../../../sf101-merchant-receiver/checkout.mjs';
import {createCustomerHandover} from '../customer-updates/operator.mjs';
import {describeCustomerFile,inspectCustomerHandover} from '../customer-updates/files.mjs';
import {createResearchPaidArchive,inspectResearchPaidArchive} from './archive.mjs';
import {selectedMerchant} from './configuration.mjs';
import {COMMERCE_SCHEMA,PUBLICATION_SCHEMA,PAID_ARCHIVE_LIMIT,publicationRequest,publicPublication,
 identifier,hash,fields,need,copy,same,fingerprint} from './contracts.mjs';
import {customerDirectory,withCustomerOperation,optionalJson,retainRequest,retainCustomerJson,retainCustomerBytes,
 readCustomerJson,jsonBytes,digest,stamp,inspectCommerceRecord,retainedBytes,assertOriginalDirectory} from './files.mjs';

function publicArchive(value){
 const {name,bytes,sha256,contentType}=value;return {name,bytes,sha256,contentType};
}
function reviewView(record){
 const proof=record.proof;
 return {schema:'sf88-research-paid-publication-review/v1',id:proof.request.requestId,reviewSha256:record.reviewSha256,
  title:proof.request.title,summary:proof.request.summary,usage:proof.request.usage,
  dossierId:proof.request.dossierId,deliveryId:proof.request.deliveryId,revision:proof.archive.selection.revision,
  archive:publicArchive(proof.archive.archive),manifestSha256:proof.archive.manifestSha256,
  manifestBytes:proof.archive.manifestBytes,files:copy(proof.files),merchant:copy(proof.merchant.view),
  orderReference:proof.orderReference,createdAt:record.createdAt};
}
async function verifyArchive(root,review){
 const archive=review.proof.archive.archive,path=join(root,'archive',archive.name);
 const inspected=await inspectResearchPaidArchive({path,expectedSha256:archive.sha256,expectedBytes:archive.bytes});
 need(inspected.manifestSha256===review.proof.archive.manifestSha256&&
  inspected.manifestBytes===review.proof.archive.manifestBytes&&
  same(inspected.selection,review.proof.archive.selection)&&same(inspected.files,review.proof.files),
  'RESEARCH_COMMERCE_ARCHIVE_CHANGED');
 return inspected;
}
export async function prepareResearchPublication({directory,client,configuration,input,environment=process.env}={}){
 const request=publicationRequest(input);
 return withCustomerOperation(directory,async root=>{
  const retained=await retainRequest(root,'publications',request);
  const savedReview=await optionalJson(root,'review.json');
  if(savedReview){
   const record=await inspectCommerceRecord(root,'publications');
   await verifyArchive(root,record.review);
   return {schema:COMMERCE_SCHEMA,kind:'publications',id:request.requestId,status:record.result?'ENROLLED':'REVIEWED',
    review:reviewView(record.review),result:record.result?.result??null,reused:true};
  }
  let merchant=await optionalJson(root,'merchant.json');
  if(!merchant){
   const selected=await selectedMerchant(configuration,request.merchant,{environment});
   await retainCustomerBytes(root,'checkout.json',selected.body);
   merchant={binding:selected.binding,bindingSha256:selected.bindingSha256,view:selected.view,
    configuration:selected.configuration};
   await retainCustomerJson(root,'merchant.json',merchant);
  }
  const body=await retainedBytes(root,'checkout.json',{sha256:merchant.binding.checkoutSha256,bytes:merchant.binding.checkoutBytes});
  need(same((await readCustomerJson(join(root,'checkout.json'))).value,merchant.configuration)&&
   merchant.bindingSha256===fingerprint(merchant.binding),'RESEARCH_COMMERCE_MERCHANT_CHANGED');
  const compiled=compileCheckout(merchant.configuration);
  need(same(compiled.terms,merchant.view.payment),'RESEARCH_COMMERCE_MERCHANT_CHANGED');
  const handover=await createCustomerHandover({client,directory:join(root,'handover'),dossierId:request.dossierId,
   deliveryId:request.deliveryId,revision:request.revision,sourceWorkspace:request.sourceWorkspace});
  need(handover.selection.revision===request.revision,'RESEARCH_COMMERCE_SELECTED_DELIVERY_REVISION_CHANGED');
  const archive=await createResearchPaidArchive({directory:join(root,'archive'),sourceDirectory:handover.directory,
   manifestSha256:handover.manifestSha256});
  need(archive.archive.bytes>0&&archive.archive.bytes<=PAID_ARCHIVE_LIMIT,'RESEARCH_COMMERCE_ARCHIVE_SIZE_INVALID');
  const proof={request:copy(request),merchant:copy(merchant),archive:copy(archive),
   files:copy(handover.manifest.files),orderReference:'research-'+request.requestId};
  const review={schema:'sf88-research-commerce-review/v1',requestSha256:retained.requestSha256,
   proof,reviewSha256:fingerprint(proof),createdAt:stamp()};
  await retainCustomerJson(root,'review.json',review);
  return {schema:COMMERCE_SCHEMA,kind:'publications',id:request.requestId,status:'REVIEWED',review:reviewView(review),result:null,reused:false};
 });
}
function matchOrder(compiled,order,proof){
 const handoff=orderHandoff(compiled,order);
 need(order.orderReference===proof.orderReference&&order.sourceSha256===proof.archive.archive.sha256&&
  order.sourceBytes===proof.archive.archive.bytes&&order.recipientDigest===compiled.context.recipientDigest,
  'RESEARCH_COMMERCE_ENROLLED_ORDER_CHANGED');
 return handoff;
}
async function savedResult(root,record){
 const envelope=(await readCustomerJson(join(root,'publication.json'))).value;
 publicPublication(envelope);
 need(record.result.result.publicationSha256===digest(jsonBytes(envelope))&&
  envelope.publicationId===record.request.request.requestId&&
  envelope.delivery.manifestSha256===record.review.proof.archive.manifestSha256,
  'RESEARCH_COMMERCE_RETAINED_RESULT_CHANGED');
 const original=(await readCustomerJson(join(root,'merchant.handoff.json'))).value;
 need(same(original,envelope.handoff),'RESEARCH_COMMERCE_ENROLLED_ORDER_CHANGED');
 await verifyArchive(root,record.review);
 return {schema:COMMERCE_SCHEMA,kind:'publications',id:envelope.publicationId,status:'ENROLLED',
  review:reviewView(record.review),result:record.result.result,reused:true};
}
export async function enrollResearchPublication({directory,configuration,input,environment=process.env}={}){
 fields(input,['id','reviewSha256']);identifier(input.id);hash(input.reviewSha256);
 return withCustomerOperation(directory,async root=>{
  const record=await inspectCommerceRecord(root,'publications');
  need(record.request.request.requestId===input.id&&record.review?.reviewSha256===input.reviewSha256,
   'RESEARCH_COMMERCE_REVIEW_CHANGED');
  // A completed original enrollment reopens before consulting later host settings.
  if(record.result)return savedResult(root,record);
  const review=record.review,proof=review.proof,compiled=compileCheckout(proof.merchant.configuration);
  await retainedBytes(root,'checkout.json',{sha256:proof.merchant.binding.checkoutSha256,bytes:proof.merchant.binding.checkoutBytes});
  const archive=await verifyArchive(root,review);
  let attempt=await optionalJson(root,'enrollment.json'),order=null;
  if(attempt){
   need(attempt.reviewSha256===review.reviewSha256&&attempt.orderReference===proof.orderReference,
    'RESEARCH_COMMERCE_ENROLLMENT_CHANGED');
   // Native inspect recovers a committed order after an interrupted handoff write.
   try{order=await inspectOrder(compiled,proof.orderReference);}catch(error){
    if(error.code&&error.code!=='ORIGINAL_RECEIVER_OPERATION_FAILED')throw error;
   }
   if(order)matchOrder(compiled,order,proof);
  }
  if(!order){
   const current=await selectedMerchant(configuration,proof.request.merchant,{environment});
   need(current.bindingSha256===proof.merchant.bindingSha256,'RESEARCH_COMMERCE_MERCHANT_CHANGED');
   for(const identity of proof.merchant.binding.directories)await assertOriginalDirectory(identity.path,identity);
   need(current.view.claimAvailable,'RESEARCH_COMMERCE_CLAIM_ENVIRONMENT_REQUIRED');
   if(!attempt){
    attempt={schema:'sf88-research-commerce-enrollment/v1',reviewSha256:review.reviewSha256,
     orderReference:proof.orderReference,createdAt:stamp()};
    await retainCustomerJson(root,'enrollment.json',attempt);
   }
   let error=null;
   try{
    await prepareHandoff(compiled,{ref:proof.orderReference,file:archive.archive.path,
     output:join(root,'native-handoff.json'),claimEnv:proof.merchant.binding.claimEnv,env:environment});
   }catch(problem){error=problem;}
   // The original receiver's unique order key is authoritative on every retry.
   // An existing native order is accepted only when all original terms/file pins match.
   try{order=await inspectOrder(compiled,proof.orderReference);}
   catch(problem){if(error)throw error;throw problem;}
   matchOrder(compiled,order,proof);
  }
  const handoff=matchOrder(compiled,order,proof);
  const envelope=publicPublication({schema:PUBLICATION_SCHEMA,publicationId:proof.request.requestId,
   title:proof.request.title,summary:proof.request.summary,usage:proof.request.usage,
   delivery:{schema:'sf88-research-customer-handover/v1',dossierId:proof.request.dossierId,deliveryId:proof.request.deliveryId,
    revision:proof.archive.selection.revision,manifestSha256:proof.archive.manifestSha256,
    manifestBytes:proof.archive.manifestBytes,files:copy(proof.files)},
   archive:publicArchive(proof.archive.archive),handoff});
  await retainCustomerJson(root,'merchant.handoff.json',handoff);
  const published=await retainCustomerJson(root,'publication.json',envelope);
  const result={publicationId:envelope.publicationId,orderReference:handoff.orderReference,publication:envelope,
   publicationSha256:published.sha256,publicationBytes:published.bytes,merchantHandoffSha256:digest(jsonBytes(handoff)),
   nativeOrder:{state:order.state,createdAt:order.createdAt,eventId:order.eventId,entitledAt:order.entitledAt},
   completedAt:stamp()};
  const saved={schema:'sf88-research-commerce-result/v1',requestSha256:record.request.requestSha256,result};
  await retainCustomerJson(root,'result.json',saved);
  return {schema:COMMERCE_SCHEMA,kind:'publications',id:envelope.publicationId,status:'ENROLLED',
   review:reviewView(review),result,reused:false};
 });
}
export async function researchPublication(directory){
 return withCustomerOperation(directory,async root=>{
  const record=await inspectCommerceRecord(root,'publications');
  if(record.result)return savedResult(root,record);
  return {schema:COMMERCE_SCHEMA,kind:'publications',id:record.request.request.requestId,
   status:record.review?'REVIEWED':'PREPARING',request:record.request.request,
   review:record.review?reviewView(record.review):null,result:null};
 });
}
export async function researchPublicationFile(directory,kind){
 need(['publication','handoff','archive'].includes(kind),'RESEARCH_COMMERCE_FILE_SELECTION_REQUIRED');
 const root=await customerDirectory(directory,{create:false}),record=await inspectCommerceRecord(root,'publications');
 if(kind==='archive'){
  need(record.review,'RESEARCH_COMMERCE_REVIEW_REQUIRED');const archive=await verifyArchive(root,record.review);
  return {...archive.archive};
 }
 need(record.result,'RESEARCH_COMMERCE_ENROLLED_PUBLICATION_REQUIRED');
 await savedResult(root,record);
 const name=kind==='publication'?'publication.json':'merchant.handoff.json';
 return {...await describeCustomerFile(join(root,name),{}),contentType:'application/json; charset=utf-8'};
}
