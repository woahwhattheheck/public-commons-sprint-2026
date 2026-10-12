// MIT. Research quotations bind native SF74 cases, Research history and SF101 offers.
import {createHash} from 'node:crypto';
import {customerActor,customerBrief,customerIdentifier,customerRevision,customerJson} from '../customer-updates/contracts.mjs';
import {customerUpdateDigest,customerUpdateSame} from '../customer-updates/context.mjs';
import {publicationRequest} from '../customer-commerce/contracts.mjs';
export const QUOTES_SCHEMA='sf88-research-customer-quotes/v1';
export const QUOTE_OPERATION_SCHEMA='sf88-research-customer-quote-operation/v1';
export const QUOTE_HOST_SCHEMA='sf88-research-customer-quotes-host/v1';
export const QUOTE_REQUEST_LIMIT=96*1024*1024+65536;
export const QUOTE_FILE_LIMIT=256*1024*1024;
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const SHA=/^[a-f0-9]{64}$/;
export const copy=value=>structuredClone(value);
export const fingerprint=customerUpdateDigest,same=customerUpdateSame;
export function need(ok,code='RESEARCH_QUOTE_INPUT_INVALID',status=422){
 if(!ok)throw Object.assign(new Error(code),{code,status});
}
export function fields(value,allowed,required=allowed){
 need(value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key)),
  'RESEARCH_QUOTE_FIELDS_INVALID');return value;
}
export function id(value){need(UUID.test(value??''),'RESEARCH_QUOTE_REQUEST_ID_REQUIRED');return value;}
export function hash(value){need(SHA.test(value??''),'RESEARCH_QUOTE_SHA256_REQUIRED');return value;}
export function alias(value){need(typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value),'RESEARCH_QUOTE_PROFILE_REQUIRED');return value;}
export function text(value,max=240,{empty=false}={}){
 need(typeof value==='string'&&value.length<=max&&(empty||value.trim())&&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),'RESEARCH_QUOTE_TEXT_REQUIRED');return value;
}
export function dossier(value){need(/^d_[a-f0-9-]{36}$/.test(value??''),'DOSSIER_ID_INVALID');return value;}
export function page(input={}){
 fields(input,['offset','limit','snapshot','dossierId','kind'],[]);
 const value={offset:input.offset??0,limit:input.limit??50,...copy(input)};
 need(Number.isSafeInteger(value.offset)&&value.offset>=0&&Number.isSafeInteger(value.limit)&&value.limit>=1&&value.limit<=100,
  'RESEARCH_QUOTE_PAGE_INVALID');
 if(value.snapshot!==undefined)hash(value.snapshot);
 if(value.dossierId!==undefined)dossier(value.dossierId);
 if(value.kind!==undefined)need(['CASE','BRIEF','RESPONSE','PUBLICATION','REALIZED'].includes(value.kind),'RESEARCH_QUOTE_KIND_INVALID');
 return value;
}
export function briefSelection(input){
 fields(input,['requestId','caseId','caseRevision','quoteId','quoteSha256','dossierId','revision','projectId','briefId',
  'merchant','scope','reason','actor']);
 id(input.requestId);id(input.caseId);hash(input.caseRevision);id(input.quoteId);hash(input.quoteSha256);
 dossier(input.dossierId);customerRevision(input.revision);customerIdentifier(input.projectId);customerIdentifier(input.briefId);
 alias(input.merchant);text(input.reason,20000);
 fields(input.scope,['component','unit','note']);
 need(['IMPLEMENTATION','RECURRING','ROUTE_USAGE','KEEP'].includes(input.scope.component),'RESEARCH_QUOTE_SCOPE_COMPONENT_REQUIRED');
 text(input.scope.unit,240,{empty:input.scope.component==='KEEP'});text(input.scope.note,16000,{empty:true});
 return {...copy(input),actor:customerActor(input.actor)};
}
export function responseSelection(input){
 fields(input,['requestId','bindingId','caseRevision','responseId','revision','actor','by']);
 id(input.requestId);id(input.bindingId);hash(input.caseRevision);id(input.responseId);customerRevision(input.revision);
 return {...copy(input),actor:customerActor(input.actor),by:customerActor(input.by)};
}
export function normalizePublicationSelection(input){
 fields(input,['requestId','bindingId','dossierId','revision','deliveryId','title','summary','usage','sourceWorkspace'],
  ['requestId','bindingId','dossierId','revision','deliveryId','title','summary','usage']);
 id(input.bindingId);
 const {bindingId,...native}=input;
 const selected=publicationRequest({...copy(native),merchant:'selected'});
 const {merchant,...result}=selected;return {...result,bindingId};
}
export function realizedSelection(input){
 fields(input,['requestId','bindingId','publicationId','purchaseIds','revision','pricing','actor']);
 id(input.requestId);id(input.bindingId);id(input.publicationId);customerRevision(input.revision);
 need(Array.isArray(input.purchaseIds)&&input.purchaseIds.length<=100,'RESEARCH_QUOTE_PURCHASE_SELECTION_INVALID');
 input.purchaseIds.forEach(id);need(new Set(input.purchaseIds).size===input.purchaseIds.length,'RESEARCH_QUOTE_PURCHASE_SELECTION_INVALID');
 if(input.pricing!==null){
  fields(input.pricing,['profile','version','costEdition'],['profile','version']);
  alias(input.pricing.profile);id(input.pricing.version);if(input.pricing.costEdition!==undefined)id(input.pricing.costEdition);
 }
 return {...copy(input),actor:customerActor(input.actor)};
}
export function caseSelection(input){
 fields(input,['requestId','caseId','dossierId','revision','projectId','briefId','actor']);
 id(input.requestId);id(input.caseId);dossier(input.dossierId);customerRevision(input.revision);
 customerIdentifier(input.projectId);customerIdentifier(input.briefId);
 return {...copy(input),actor:customerActor(input.actor)};
}
export function applySelection(input){fields(input,['id','reviewSha256']);id(input.id);hash(input.reviewSha256);return copy(input);}
export function sourceDescriptor(name,body){
 need(body instanceof Uint8Array,'RESEARCH_QUOTE_FILE_REQUIRED');
 return {name,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')};
}
export function reviewedBrief(original,quote,scope,reference){
 const next=customerBrief(copy(original));
 if(scope.component==='KEEP')return next;
 const amount={IMPLEMENTATION:quote.totals.implementationUsd,RECURRING:quote.totals.recurringUsd,
  ROUTE_USAGE:quote.totals.routeUsageUsd}[scope.component];
 need(typeof amount==='string'&&/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount),'RESEARCH_QUOTE_NATIVE_AMOUNT_REQUIRED');
 next.scope={currency:quote.totals.currency,amount,unit:scope.unit,note:scope.note,reference};
 return customerBrief(next);
}
export const nativeRequestId=(id,kind)=>'rq-'+kind.toLowerCase()+'-'+id;
export const serialized=value=>Buffer.from(JSON.stringify(customerJson(value),null,2)+'\n');
