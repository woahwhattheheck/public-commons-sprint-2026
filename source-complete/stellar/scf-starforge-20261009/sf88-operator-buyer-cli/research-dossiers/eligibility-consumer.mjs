// MIT. Original Research eligibility calls with complete selected-source receipts.
// This module borrows the authenticated client. It starts no listener or provider.
import {eligibilityInput,eligibilityDigest,ELIGIBILITY_SCHEMA,
  ELIGIBILITY_OPERATION_SCHEMA,ELIGIBILITY_SECTIONS} from './eligibility-review.mjs';
import {need,object} from '../node/store.mjs';

export const ELIGIBILITY_REQUEST_FIELDS=Object.freeze([
  'requestId','expectedRevision','actor','action','reviewId','data'
]);
export const ELIGIBILITY_EXPORT_SECTIONS=Object.freeze([
  'queue','decisions','resolutions','studies','impact','operations','occurrences'
]);
export const ELIGIBILITY_RECOVERY='Read the saved original request and replay its unchanged requestId, expectedRevision, actor, action, reviewId and complete data. The original dossier returns the committed operation after a lost reply. Prepare a new request only after a genuine revision conflict has been reviewed.';
const own=(value,key)=>Object.hasOwn(value,key);
const integer=(value,minimum=0)=>Number.isSafeInteger(value)&&value>=minimum;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const selected=(value,keys)=>Object.fromEntries(keys.filter(key=>own(value,key)).map(key=>[key,value[key]]));
const equal=(a,b)=>eligibilityDigest(a)===eligibilityDigest(b);
function exact(value,keys,code){
  need(object(value)&&Object.keys(value).every(key=>keys.includes(key)),code);return value;
}
export function eligibilityConsumerInput(input){
  need(object(input),'ELIGIBILITY_REQUEST_REQUIRED');
  need(Buffer.byteLength(JSON.stringify(input))<=16*1024*1024,'ELIGIBILITY_INPUT_TOO_LARGE');
  const request=eligibilityInput(input);
  return {request,sha256:eligibilityDigest(request)};
}
export function validateEligibilityPage(value,dossierId,options={}){
  const section=options.section??'overview',offset=options.offset??0,limit=options.limit??30;
  need(object(value)&&value.schema===ELIGIBILITY_SCHEMA&&value.dossier?.id===dossierId&&
    integer(value.dossier.revision,1)&&
    (options.revision===undefined||value.dossier.revision===options.revision)&&
    value.section===section&&value.offset===offset&&value.limit===limit&&
    integer(value.total)&&value.offset<=value.total&&Array.isArray(value.items)&&
    value.items.length===Math.min(limit,value.total-offset)&&
    value.nextOffset===(offset+value.items.length<value.total?offset+value.items.length:null)&&
    (options.reviewId===undefined||value.reviewId===options.reviewId)&&
    (options.workSetId===undefined||value.workSetId===options.workSetId)&&
    Array.isArray(value.protocols)&&Array.isArray(value.workSets)&&Array.isArray(value.reviewers)&&
    Array.isArray(value.exclusionReasons)&&object(value.overview),
    'ELIGIBILITY_PAGE_SELECTION_CHANGED');
  return value;
}
export async function readEligibility(client,dossierId,options={}){
  exact(options,['revision','reviewId','workSetId','section','offset','limit'],
    'ELIGIBILITY_PAGE_FIELDS_INVALID');
  const selectedOptions=selected(options,['revision','reviewId','workSetId','section','offset','limit']);
  const section=selectedOptions.section??'overview',offset=selectedOptions.offset??0,limit=selectedOptions.limit??30;
  need(ELIGIBILITY_SECTIONS.includes(section)&&integer(offset)&&integer(limit,1)&&limit<=100&&
    (selectedOptions.revision===undefined||integer(selectedOptions.revision,1))&&
    (offset===0||selectedOptions.revision!==undefined),'ELIGIBILITY_PAGE_INVALID');
  return validateEligibilityPage(await client.eligibility(dossierId,selectedOptions),dossierId,selectedOptions);
}
export async function* iterateEligibility(client,dossierId,options={}){
  const {offset:initial=0,...selection}=options;let offset=initial,revision=selection.revision;
  for(;;){
    const page=await readEligibility(client,dossierId,{...selection,offset,...(revision!==undefined?{revision}:{})});
    revision=page.dossier.revision;
    for(const item of page.items)yield item;
    if(page.nextOffset===null)return;
    offset=page.nextOffset;
  }
}
export function validateEligibilityOperation(value,dossierId,input){
  const request=eligibilityConsumerInput(input).request,operation=value?.operation;
  const payload=object(operation)?Object.fromEntries(Object.entries(operation).filter(([key])=>key!=='sha256')):null;
  need(object(value)&&value.dossier?.id===dossierId&&typeof value.duplicate==='boolean'&&
    object(operation)&&operation.schema===ELIGIBILITY_OPERATION_SCHEMA&&operation.dossierId===dossierId&&
    operation.id==='eo_'+eligibilityDigest({dossierId,requestId:request.requestId})&&
    operation.requestId===request.requestId&&operation.requestSha256===eligibilityDigest(request)&&
    equal(operation.request,request)&&operation.action===request.action&&equal(operation.actor,request.actor)&&
    operation.originalRevision===request.expectedRevision&&operation.revision===request.expectedRevision+1&&
    integer(value.dossier.revision,operation.revision)&&hash(operation.originalRevisionSha256)&&
    typeof operation.createdAt==='string'&&Number.isFinite(Date.parse(operation.createdAt))&&
    object(operation.result)&&operation.reviewId===(request.reviewId??operation.result.review?.id)&&
    hash(operation.sha256)&&operation.sha256===eligibilityDigest(payload),
    'ELIGIBILITY_OPERATION_RECEIPT_CHANGED');
  return value;
}
export async function submitEligibility(client,dossierId,input){
  const {request}=eligibilityConsumerInput(input);let value;
  try{value=await client.reviewEligibility(dossierId,request);}
  catch(error){
    if(error.outcomeUnknown)Object.assign(error,{dossierId,requestId:request.requestId,recovery:ELIGIBILITY_RECOVERY});
    throw error;
  }
  try{return validateEligibilityOperation(value,dossierId,request);}
  catch(error){
    Object.assign(error,{outcomeUnknown:true,dossierId,requestId:request.requestId,recovery:ELIGIBILITY_RECOVERY});
    throw error;
  }
}
export async function exportEligibility(client,dossierId,options={}){
  exact(options,['revision','reviewId','workSetId','format','section','file','expectedSha256','signal'],
    'ELIGIBILITY_EXPORT_FIELDS_INVALID');
  const format=options.format??'json',section=options.section??'queue';
  need(['json','csv'].includes(format)&&ELIGIBILITY_EXPORT_SECTIONS.includes(section)&&
    integer(options.revision,1)&&typeof options.reviewId==='string'&&options.reviewId.length>0&&
    typeof options.file==='string'&&options.file.length>0,
    'ELIGIBILITY_EXPORT_SELECTION_REQUIRED');
  // The caller retains a revision before downloading; every report in a
  // delivery therefore refers to the same immutable dossier and source.
  const result=await client.exportEligibility(dossierId,{...options,format,section});
  need(result?.revision===options.revision&&hash(result.sha256)&&integer(result.bytes)&&
    typeof result.file==='string','ELIGIBILITY_EXPORT_RECEIPT_CHANGED');
  return result;
}
