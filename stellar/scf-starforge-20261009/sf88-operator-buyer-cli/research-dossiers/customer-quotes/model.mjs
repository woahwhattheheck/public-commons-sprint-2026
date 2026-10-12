// MIT. Native quote amounts and research records remain their original complete values.
import {customerBrief,customerUpdateInput} from '../customer-updates/contracts.mjs';
import {QUOTES_SCHEMA,copy,same,need,fingerprint,reviewedBrief,nativeRequestId} from './contracts.mjs';
export function quoteReference(caseId,quote){return 'urn:stellar-forge:merchant-quote:'+caseId+':'+quote.id+':'+quote.sha256;}
export function researchQuoteBrief(input,{workspaceId,casesWorkspaceId,caseRecord,quote,project,brief,merchant,files}){
 need(quote.id===input.quoteId&&quote.sha256===input.quoteSha256&&caseRecord.id===input.caseId&&caseRecord.revision===input.caseRevision,
  'RESEARCH_QUOTE_SELECTED_CASE_CHANGED',409);
 need(project.id===input.projectId&&brief.id===input.briefId&&brief.projectId===project.id,
  'RESEARCH_QUOTE_SELECTED_BRIEF_CHANGED',409);
 need(project.customer.id===brief.definition.customer.id,'RESEARCH_QUOTE_CUSTOMER_CHANGED',409);
 const reference=quoteReference(input.caseId,quote),definition=reviewedBrief(brief.definition,quote,input.scope,reference);
 const request=customerUpdateInput({requestId:nativeRequestId(input.requestId,'brief'),expectedRevision:input.revision,
  actor:input.actor,action:'revise-brief',data:{projectId:project.id,expectedBriefId:brief.id,brief:definition,reason:input.reason}});
 return {schema:QUOTES_SCHEMA,kind:'BRIEF',workspaceId,casesWorkspaceId,
  selection:{dossierId:input.dossierId,revision:input.revision,projectId:project.id,briefId:brief.id,
   caseId:input.caseId,caseRevision:input.caseRevision,quoteId:quote.id,quoteSha256:quote.sha256,reference},
  quote:copy(quote),project:copy(project),before:copy(brief),brief:definition,
  merchant:{id:input.merchant,bindingSha256:merchant.bindingSha256,binding:copy(merchant.binding),view:copy(merchant.view)},
  scope:copy(input.scope),nativeRequest:request,files:copy(files),
  changes:{scope:!same(brief.definition.scope,definition.scope),
   preserved:['customer','purpose','owner','questionIds','protocol','sourcePlans','outputs','updatePolicy']}};
}
export function researchQuoteResponse(input,{binding,response,quote,files}){
 need(binding.request.kind==='BRIEF'&&binding.result?.result?.native?.operation?.result?.brief,
  'RESEARCH_QUOTE_APPLIED_BRIEF_REQUIRED');
 const source=binding.review.proof,brief=binding.result.result.native.operation.result.brief;
 need(response.id===input.responseId&&response.quoteId===source.selection.quoteId&&response.quoteSha256===source.selection.quoteSha256&&
  quote.id===source.selection.quoteId&&quote.sha256===source.selection.quoteSha256,'RESEARCH_QUOTE_RESPONSE_CHANGED',409);
 const dispositions={ACCEPTED:'ACCEPTED',REVISION_REQUESTED:'CHANGES_REQUESTED',DECLINED:'DECLINED'};
 need(dispositions[response.status],'RESEARCH_QUOTE_RESPONSE_REQUIRED');
 const nativeRequest=customerUpdateInput({requestId:nativeRequestId(input.requestId,'response'),expectedRevision:input.revision,
  actor:input.actor,action:'record-agreement',data:{projectId:source.selection.projectId,briefId:brief.id,
   disposition:dispositions[response.status],by:input.by,occurredAt:response.observedAt,reference:response.source,
   message:response.note||'Customer response '+response.status+' to quotation '+quote.title+'.',
   records:{schema:QUOTES_SCHEMA,quoteId:quote.id,quoteSha256:quote.sha256,caseId:source.selection.caseId,
    caseRevision:input.caseRevision,responseId:response.id,responseSha256:fingerprint(response),
    bindingId:binding.request.id,bindingReviewSha256:binding.review.reviewSha256}}});
 return {schema:QUOTES_SCHEMA,kind:'RESPONSE',selection:copy(source.selection),bindingId:binding.request.id,
  bindingReviewSha256:binding.review.reviewSha256,brief:copy(brief),response:copy(response),
  nativeRequest,files:copy(files)};
}
export function researchQuotePublication(input,{binding,delivery,requested,commerce,files}){
 const bound=binding.review.proof,brief=binding.result?.result?.native?.operation?.result?.brief;
 need(brief&&input.dossierId===bound.selection.dossierId&&delivery.id===input.deliveryId&&
  delivery.revision===input.revision&&delivery.projectId===bound.selection.projectId&&
  requested.id===delivery.requestEditionId&&requested.definition.briefId===brief.id,
  'RESEARCH_QUOTE_DELIVERY_BRIEF_CHANGED',409);
 need(commerce.review?.merchant?.checkoutSha256===bound.merchant.view.checkoutSha256&&
  same(commerce.review.merchant.payment,bound.merchant.view.payment),'RESEARCH_QUOTE_CHECKOUT_TERMS_CHANGED',409);
 return {schema:QUOTES_SCHEMA,kind:'PUBLICATION',selection:copy(bound.selection),bindingId:binding.request.id,
  bindingReviewSha256:binding.review.reviewSha256,brief:copy(brief),delivery:copy(delivery),
  requested:copy(requested),commerce:copy(commerce),files:copy(files)};
}
export function researchQuoteRealized({request,binding,publication,order,purchases,customer,pricing,capturedAt,files}){
 const selection=binding.review.proof.selection,enrolled=publication.result?.publication;
 need(enrolled&&enrolled.publicationId===request.publicationId&&enrolled.delivery.dossierId===selection.dossierId,
  'RESEARCH_QUOTE_PUBLICATION_CHANGED',409);
 need(order.orderReference===enrolled.handoff.orderReference&&order.sourceSha256===enrolled.archive.sha256&&
  order.sourceBytes===enrolled.archive.bytes,'RESEARCH_QUOTE_NATIVE_ORDER_CHANGED',409);
 for(const purchase of purchases)need(purchase.publication?.publicationId===enrolled.publicationId&&
  same(purchase.publication,enrolled),'RESEARCH_QUOTE_PURCHASE_PUBLICATION_CHANGED',409);
 const report={schema:'sf88-research-customer-quote-realized/v1',capturedAt,actor:copy(request.actor),
  selection:copy(selection),bindingId:binding.request.id,bindingReviewSha256:binding.review.reviewSha256,
  quote:copy(binding.review.proof.quote),publication:copy(enrolled),paymentTerms:copy(binding.review.proof.merchant.view.payment),
  originalOrder:copy(order),purchases:copy(purchases),customer:copy(customer),pricing:copy(pricing),
  sourceScope:{quote:'Selected original SF74 quotation',
   payment:'The original SF101 order for this exact published archive',
   pricing:pricing?'Selected complete SF97 merchant pricing version and supplier-cost edition':null},
  files:copy(files)};
 return {...report,sha256:fingerprint(report)};
}
export function renderResearchQuoteRealized(report){
 const quote=report.quote,terms=report.paymentTerms;
 const lines=['# Research quotation and delivery','',quote.title,'',quote.draft.customer.name,'',
  'Captured: '+report.capturedAt,'','## Quoted scope','',quote.draft.terms.scope,'',
  'Implementation: USD '+quote.totals.implementationUsd,
  'Monthly service and planned route usage: USD '+quote.totals.recurringUsd,'',
  '## Original published delivery','',report.publication.title,
  'Publication: '+report.publication.publicationId,'Delivery: '+report.publication.delivery.deliveryId,
  'Archive bytes: '+report.publication.archive.bytes,'Archive SHA-256: '+report.publication.archive.sha256,'',
  '## Payment and receiving','',
  'Original order: '+report.originalOrder.orderReference,'Native order state: '+report.originalOrder.state,
  'Compiled checkout terms: '+JSON.stringify(terms),''];
 for(const item of report.purchases)lines.push('- Buyer '+item.buyer.label+': '+item.status+
  (item.received?' — original editable Research receiving completed':''));
 lines.push('','## Customer delivery history','');
 for(const event of report.customer.deliveryEvents)lines.push('- '+event.occurredAt+' — '+event.status+' — '+event.by.name+
  (event.reference?' — '+event.reference:''));
 if(report.pricing)lines.push('','## Retained merchant economics','',
  'Pricing profile: '+report.pricing.profile,'Saved pricing version: '+report.pricing.version,
  'The complete native report and selected cost files accompany this report. Their period and route coverage remain the original merchant scope.',
  ...(report.pricing.costEdition?['Supplier-cost edition: '+report.pricing.costEdition]:[]));
 lines.push('','## Receiving and acceptance terms','',quote.draft.terms.acceptance,'',
  '## Payment schedule','',quote.draft.terms.payment,'');
 return lines.join('\n');
}
