// MIT. Agreement renewals carried by the original merchant service case.
import {
  createServiceRecord, validateServiceRecord, saveServiceTerms,
  serviceCanonical, serviceSha256, MAX_SERVICE_BYTES
} from './service-commitments.mjs';

export const SERVICE_RENEWAL_SCHEMA='stellar-forge.merchant-service-renewal.v1';
export const SERVICE_RENEWAL_PREVIEW_SCHEMA='stellar-forge.merchant-service-renewal-preview.v1';
export const SERVICE_RENEWAL_QUEUE_SCHEMA='stellar-forge.merchant-service-renewal-queue.v1';
export const SERVICE_RENEWAL_HANDOVER_SCHEMA='stellar-forge.merchant-service-renewal-handover.v1';
const DAY=86400000,enc=new TextEncoder();
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ANY_UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const STATES=['proposed','accepted','declined','closed'];
const TERM_FIELDS=['title','customer','owner','reference','status','incidentSourceId','merchantId',
  'merchantBinding','effectiveFrom','effectiveUntil','calendar','targets','reviewedBy','note'];
const CONTINUATION_FIELDS=['title','customer','owner','effectiveFrom','effectiveUntil','calendar','targets'];
const PROPOSAL_FIELDS=['id','requestId','expectedRevision','expectedCaseRevision','termsId','expectedTermsRevision','expectedTermsSha256',
  'continuation','owner','noticeDays','noticeAt','actor','note','quoteId','quoteSha256','expectedPreviewSha256'];
const DECISION_FIELDS=['id','requestId','expectedRevision','expectedCaseRevision','state','actor','observedAt','reference','note','acceptanceId'];
const copy=value=>structuredClone(value),same=(a,b)=>serviceCanonical(a)===serviceCanonical(b);
const unsealed=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='sha256'));
export const serviceRenewalError=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
function need(condition,message,code='SERVICE_RENEWAL_INPUT_INVALID',status=422){
  if(!condition)throw serviceRenewalError(code,message,status);
}
function fields(value,allowed,label){
  need(value&&typeof value==='object'&&!Array.isArray(value)&&
    [Object.prototype,null].includes(Object.getPrototypeOf(value)), 'Supply '+label+' as an object.');
  need(Object.keys(value).every(key=>allowed.includes(key)), 'Unexpected '+label+' field.');return value;
}
function text(value,label,max=4000,empty=false){
  need(typeof value==='string'&&enc.encode(value).length<=max&&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),'Supply complete '+label+'.');
  const result=value.trim();need(empty||result.length>0,'Supply '+label+'.');return result;
}
function uuid(value,label='renewal ID',any=false){
  need(typeof value==='string'&&(any?ANY_UUID:UUID).test(value),'Use the original '+label+'.');return value;
}
function hash(value,label='revision hash'){
  need(typeof value==='string'&&HASH.test(value),'Use the original '+label+'.');return value;
}
function integer(value,label,min=1,max=Number.MAX_SAFE_INTEGER){
  need(Number.isSafeInteger(value)&&value>=min&&value<=max,'Use a whole '+label+' from '+min+' to '+max+'.');return value;
}
function instant(value,label='time'){
  need(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&
    Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value,'Use an exact UTC '+label+'.');return value;
}
function rows(value,label){need(Array.isArray(value)&&value.length<=1000,'Keep the complete '+label+' within 1,000 entries.');return value;}
function ref(terms){return {id:terms.id,revision:terms.revision,sha256:terms.sha256};}
function resolveTerms(terms,reference,label){
  fields(reference,['id','revision','sha256'],label);uuid(reference.id,'agreement ID');
  integer(reference.revision,'terms edition');hash(reference.sha256,'terms edition hash');
  const found=terms.find(row=>row.id===reference.id&&row.revision===reference.revision);
  need(found&&found.sha256===reference.sha256,'Keep the original '+label+' in this service history.',
    'SERVICE_RENEWAL_TERMS_CHANGED',409);return found;
}
function latestTerms(terms,termsId){return terms.filter(row=>row.id===termsId).sort((a,b)=>b.revision-a.revision)[0]??null;}
function latestRenewals(renewals){
  const result=new Map();for(const row of renewals)if((result.get(row.id)?.revision??0)<row.revision)result.set(row.id,row);
  return [...result.values()];
}
function termInput(terms){return {id:terms.id,expectedRevision:terms.revision,...Object.fromEntries(TERM_FIELDS.map(key=>[key,copy(terms[key])]))};}
function size(record){
  need(enc.encode(serviceCanonical(record)).length<=MAX_SERVICE_BYTES,
    'The complete service case exceeds 8 MB. Preserve its complete original handoff before starting another service case.');return record;
}
function at(context){return instant(typeof context.now==='function'?context.now():context.now??new Date().toISOString(),'recording time');}
function material(value,label){
  fields(value,['id','sha256','bytes'],label);text(value.id,label+' identity',400);hash(value.sha256,label+' hash');
  integer(value.bytes,label+' byte count',1);return copy(value);
}
function quoteShape(value,continuation){
  fields(value,['id','sha256','originCaseId','material','title','createdAt','serviceSourceId','serviceSourceSha256'],'renewal quote');
  uuid(value.id,'quote ID',true);hash(value.sha256,'quote hash');uuid(value.originCaseId,'original quote case ID',true);
  material(value.material,'quote material');text(value.title,'quote title',400);instant(value.createdAt,'quote creation time');
  need(value.serviceSourceId===continuation.id+':'+continuation.revision&&value.serviceSourceSha256===continuation.sha256,
    'The renewal quotation selects another service terms edition.','SERVICE_RENEWAL_QUOTE_CHANGED',409);
}
function acceptanceShape(value,quote){
  fields(value,['id','originCaseId','material','quoteId','quoteSha256','status','observedAt','recordedAt','source'],'renewal acceptance');
  uuid(value.id,'acceptance ID',true);uuid(value.originCaseId,'original response case ID',true);material(value.material,'response material');
  need(quote&&value.quoteId===quote.id&&value.quoteSha256===quote.sha256&&value.status==='ACCEPTED',
    'Keep the accepted customer response with its exact original renewal quotation.','SERVICE_RENEWAL_ACCEPTANCE_CHANGED',409);
  instant(value.observedAt,'acceptance time');instant(value.recordedAt,'response recording time');text(value.source,'acceptance reference',4096);
}
function continuity(source,continuation){
  need(['active','ended'].includes(source.status)&&source.effectiveUntil,
    'Renew a retained active or ended agreement with an exact service end.');
  need(continuation.id===source.id&&continuation.revision>source.revision,
    'Keep the continuation under the original agreement identity.');
  for(const key of ['incidentSourceId','merchantId','merchantBinding'])need(continuation[key]===source[key],
    'A renewal must retain the original incident source and merchant binding. Use a separate agreement for a different binding.');
  need(continuation.status==='proposed','Keep the proposed continuation edition with its renewal.');
  need(continuation.effectiveFrom>=source.effectiveUntil,
    'The continuation must start at or after the original service end; agreement periods cannot overlap.');
  return Date.parse(continuation.effectiveFrom)-Date.parse(source.effectiveUntil);
}

/** Validate references without recursively validating the surrounding service record. */
export async function validateServiceRenewals(value,terms){
  const history=copy(rows(value??[],'renewal history')),heads=new Map(),requests=new Set();
  for(const row of history){
    fields(row,['schema','id','revision','createdAt','caseId','state','sourceTerms','continuationTerms','activatedTerms',
      'owner','noticeDays','noticeAt','quote','acceptance','decision','actor','note','previousSha256',
      'requestId','request','requestSha256','sha256'],'retained renewal');
    need(row.schema===SERVICE_RENEWAL_SCHEMA,'Choose the original renewal schema.');
    uuid(row.id);integer(row.revision,'renewal edition');uuid(row.caseId,'renewal case ID');instant(row.createdAt,'renewal recording time');
    need(STATES.includes(row.state),'Choose the original renewal state.');
    text(row.owner,'renewal owner',400);text(row.actor,'renewal reviewer',240);text(row.note,'renewal note',8000,true);
    const source=resolveTerms(terms,row.sourceTerms,'source agreement'),continuation=resolveTerms(terms,row.continuationTerms,'proposed continuation');
    continuity(source,continuation);instant(row.noticeAt,'renewal notice time');
    need(row.noticeAt<=source.effectiveUntil,'The renewal notice must fall on or before the original service end.');
    if(row.noticeDays!==null){integer(row.noticeDays,'notice days',0,3660);need(Date.parse(source.effectiveUntil)-row.noticeDays*DAY===Date.parse(row.noticeAt),'The renewal notice changed from its retained day interval.');}
    if(row.quote!==null)quoteShape(row.quote,continuation);
    if(row.acceptance!==null)acceptanceShape(row.acceptance,row.quote);
    if(row.activatedTerms!==null){
      const active=resolveTerms(terms,row.activatedTerms,'activated continuation');
      need(active.status==='active'&&active.id===continuation.id&&active.revision===continuation.revision+1,
        'Keep the activated edition immediately after its original proposed continuation.');
      for(const key of TERM_FIELDS.filter(key=>!['status','reference','reviewedBy','note'].includes(key)))
        need(same(active[key],continuation[key]),'Activation changed the customer-reviewed continuation terms.');
      need(row.acceptance!==null,'The activated continuation requires its retained quote acceptance.');
    }
    const previous=heads.get(row.id);
    need(row.revision===(previous?.revision??0)+1&&row.previousSha256===(previous?.sha256??null),
      'The renewal history has a missing or conflicting edition.','SERVICE_RENEWAL_HISTORY_CONFLICT',409);
    if(previous){
      need(row.caseId===previous.caseId&&same(row.sourceTerms,previous.sourceTerms),
        'Keep the original case and agreement binding through the renewal history.');
      const allowed=previous.state==='proposed'?['proposed','accepted','declined','closed']:
        ['accepted','declined'].includes(previous.state)?['closed']:[];
      need(allowed.includes(row.state),'This renewal state cannot follow its retained decision.');
      need(row.createdAt>=previous.createdAt,'A renewal edition predates its original previous edition.');
      if(row.state!=='proposed'){
        for(const key of ['continuationTerms','owner','noticeDays','noticeAt','quote'])
          need(same(row[key],previous[key]),'A renewal decision changed its reviewed proposal.');
        if(row.state==='closed')for(const key of ['activatedTerms','acceptance'])
          need(same(row[key],previous[key]),'Closing a renewal changed its original acceptance.');
      }
    }else need(row.state==='proposed','Begin a renewal with its original proposed continuation.');
    if(row.state==='proposed')need(row.decision===null&&row.acceptance===null&&row.activatedTerms===null,
      'A proposal cannot contain a completed decision or activation.');
    else{
      fields(row.decision,['observedAt','reference','note','actor'],'renewal decision');
      instant(row.decision.observedAt,'decision time');text(row.decision.reference,'decision reference',4096,true);
      text(row.decision.note,'decision note',8000,row.state!=='closed');text(row.decision.actor,'decision reviewer',240);
      need(row.decision.actor===row.actor&&row.decision.note===row.note,'Keep the original decision reviewer and note.');
      if(row.state==='accepted')need(row.acceptance&&row.activatedTerms&&row.decision.observedAt===row.acceptance.observedAt,
        'An accepted renewal requires the original quote acceptance and activated terms.');
      if(row.state==='declined')need(row.acceptance===null&&row.activatedTerms===null,
        'A declined renewal cannot activate service.');
    }
    uuid(row.requestId,'renewal request ID');hash(row.requestSha256,'renewal request hash');hash(row.sha256,'renewal edition hash');
    fields(row.request,['action','input'],'renewal request');
    need(['propose','decide'].includes(row.request.action),'Choose the original renewal request action.');
    const input=fields(row.request.input,row.request.action==='propose'?PROPOSAL_FIELDS:DECISION_FIELDS,'retained renewal inputs');
    if(input.expectedCaseRevision!==undefined)hash(input.expectedCaseRevision,'original case revision');
    need(input.id===row.id&&input.requestId===row.requestId&&input.expectedRevision===(previous?.revision??null),
      'The retained request selects another renewal edition.');
    need(row.request.action==='propose'?row.state==='proposed':input.state===row.state&&row.state!=='proposed',
      'The retained renewal request differs from its decision.');
    need(text(input.actor,'request reviewer',240)===row.actor&&text(input.note??'','request note',8000,true)===row.note,
      'The retained renewal request changed its reviewer or note.');
    need(!requests.has(row.requestId),'A renewal request ID is duplicated.');requests.add(row.requestId);
    need(await serviceSha256(row.request)===row.requestSha256&&await serviceSha256(unsealed(row))===row.sha256,
      'A retained renewal request or edition changed.','SERVICE_RENEWAL_HISTORY_CONFLICT',409);
    heads.set(row.id,row);
  }
  const open=new Set();for(const row of heads.values())if(row.state==='proposed'){
    need(!open.has(row.sourceTerms.id),'The agreement contains parallel proposed renewals. Open its current retained case history.',
      'SERVICE_RENEWAL_HISTORY_CONFLICT',409);open.add(row.sourceTerms.id);
  }
  return history;
}

export async function mergeServiceRenewals(incoming,retained,terms){
  const left=await validateServiceRenewals(incoming,terms),right=await validateServiceRenewals(retained,terms);
  const merged=new Map(right.map(row=>[row.id+':'+row.revision,row]));
  for(const row of left){const key=row.id+':'+row.revision,old=merged.get(key);
    need(!old||old.sha256===row.sha256,'A retained renewal edition differs from the original case history.',
      'SERVICE_RENEWAL_HISTORY_CONFLICT',409);if(!old)merged.set(key,row);}
  return validateServiceRenewals([...merged.values()].sort((a,b)=>a.id.localeCompare(b.id)||a.revision-b.revision),terms);
}

async function original(value){
  const record=await validateServiceRecord(value??createServiceRecord());record.renewals??=[];
  return record;
}
function request(input,action){return {action,input:copy(input)};}
async function replay(record,input,action){
  uuid(input.id);uuid(input.requestId,'renewal request ID');
  const wanted=request(input,action),digest=await serviceSha256(wanted);
  const found=record.renewals.find(row=>row.requestId===input.requestId);
  if(!found)return {request:wanted,requestSha256:digest};
  need(found.requestSha256===digest,'This renewal request ID belongs to different changes.',
    'SERVICE_RENEWAL_OPERATION_CONFLICT',409);
  return {result:{record,renewal:copy(found),terms:copy(resolveTerms(record.terms,found.activatedTerms??found.continuationTerms,'retained continuation')),reused:true}};
}
function current(record,input){
  const found=latestRenewals(record.renewals).find(row=>row.id===input.id)??null;
  if(input.expectedRevision!==null)integer(input.expectedRevision,'expected renewal edition');
  need((found?.revision??null)===input.expectedRevision,'The renewal has a newer edition. Open its current decision before changing it.',
    'SERVICE_RENEWAL_CONFLICT',409);return found;
}
function contextCase(context){return uuid(context.caseId??context.scope?.caseId,'original case ID');}
function notice(input,source,previous){
  if(Object.hasOwn(input,'noticeAt')&&input.noticeAt!==null){
    const noticeAt=instant(input.noticeAt,'renewal notice time');need(noticeAt<=source.effectiveUntil,'The notice must fall on or before the original service end.');
    if(input.noticeDays!==undefined&&input.noticeDays!==null){integer(input.noticeDays,'notice days',0,3660);need(Date.parse(source.effectiveUntil)-input.noticeDays*DAY===Date.parse(noticeAt),'Choose a notice date or its matching number of notice days.');}
    return {noticeAt,noticeDays:input.noticeDays??null};
  }
  if(input.noticeDays===undefined&&previous)return {noticeAt:previous.noticeAt,noticeDays:previous.noticeDays};
  const noticeDays=integer(input.noticeDays??30,'notice days',0,3660),timestamp=Date.parse(source.effectiveUntil)-noticeDays*DAY;
  return {noticeDays,noticeAt:instant(new Date(timestamp).toISOString(),'renewal notice time')};
}
function quoteRows(context){return context.quotes??context.commercial?.quotes??[];}
function responseRows(context){return context.responses??context.documents??context.commercial?.documents??[];}
async function bindQuote(context,quoteId,quoteSha256,continuation){
  uuid(quoteId,'quote ID',true);hash(quoteSha256,'quote hash');
  const quote=quoteRows(context).find(row=>row.id===quoteId);
  need(quote&&quote.sha256===quoteSha256,'Choose the exact retained renewal quotation in this case.',
    'SERVICE_RENEWAL_QUOTE_CHANGED',409);
  const payload=Object.fromEntries(Object.entries(quote).filter(([key])=>!['sha256','originCaseId','receiving','material'].includes(key)));
  need(quote.schema==='stellar-forge.merchant-commercial-quote.v1'&&await serviceSha256(payload)===quote.sha256,
    'The retained renewal quotation differs from its original edition.','SERVICE_RENEWAL_QUOTE_CHANGED',409);
  const binding=quote.sourceBindings?.service;
  need(binding?.id===continuation.id+':'+continuation.revision&&binding.sha256===continuation.sha256&&same(binding.snapshot,continuation),
    'Quote the retained proposed continuation edition before linking its quotation.','SERVICE_RENEWAL_QUOTE_CHANGED',409);
  need(quote.lines?.some(line=>line.kind==='RECURRING_SERVICE'&&line.sourceId===binding.id&&line.sourceRowId===continuation.id),
    'The continuation quotation needs its original recurring-service line.');
  const result={id:quote.id,sha256:quote.sha256,originCaseId:quote.originCaseId,material:copy(quote.material),
    title:quote.title,createdAt:quote.createdAt,serviceSourceId:binding.id,serviceSourceSha256:binding.sha256};
  quoteShape(result,continuation);return result;
}
async function proposal(record,input,context){
  fields(input,PROPOSAL_FIELDS,'renewal proposal');
  if(input.expectedCaseRevision!==undefined)hash(input.expectedCaseRevision,'original case revision');
  uuid(input.id);uuid(input.requestId,'renewal request ID');const caseId=contextCase(context),previous=current(record,input);
  if(previous)need(previous.caseId===caseId&&previous.state==='proposed','Open the current proposed renewal to revise its terms.',
    'SERVICE_RENEWAL_CONFLICT',409);
  const head=latestTerms(record.terms,uuid(input.termsId,'agreement ID'));
  need(head&&head.revision===integer(input.expectedTermsRevision,'expected terms edition')&&
    head.sha256===hash(input.expectedTermsSha256,'expected terms hash'),
    'The agreement has a newer terms edition. Open that edition before preparing this renewal.','SERVICE_RENEWAL_TERMS_CONFLICT',409);
  let source;
  if(previous){source=resolveTerms(record.terms,previous.sourceTerms,'source agreement');
    need(same(previous.continuationTerms,ref(head)),'The original proposed continuation has changed. Open the current agreement before revising it.',
      'SERVICE_RENEWAL_TERMS_CONFLICT',409);
  }else{
    const other=latestRenewals(record.renewals).find(row=>row.sourceTerms.id===head.id&&row.state==='proposed');
    need(!other,'This agreement already has a proposed renewal. Open that renewal to continue it.','SERVICE_RENEWAL_CONFLICT',409);
    source=head;
    if(head.status==='proposed'){
      const priorAgreement=latestTerms(record.terms.filter(row=>['active','ended'].includes(row.status)&&row.revision<head.revision),head.id);
      const terminal=latestRenewals(record.renewals).find(row=>['declined','closed'].includes(row.state)&&
        !row.activatedTerms&&row.continuationTerms.id===head.id&&row.continuationTerms.revision<=head.revision&&
        priorAgreement&&same(row.sourceTerms,ref(priorAgreement)));
      need(terminal,'Choose an active or ended source agreement, or its closed renewal with a retained current proposal.');
      source=resolveTerms(record.terms,terminal.sourceTerms,'source agreement');
    }
  }
  need(['active','ended'].includes(source.status)&&source.effectiveUntil,'The original agreement needs active or ended terms and an exact ending timestamp.');
  const actor=text(input.actor,'renewal reviewer',240),note=text(input.note??'','renewal note',8000,true);
  const changes=fields(input.continuation??{},CONTINUATION_FIELDS,'continuation terms');
  if(!previous)need(Object.hasOwn(changes,'effectiveUntil'),'Enter the continuation ending timestamp, or null for an open-ended continuation.');
  const wanted=termInput(previous||head.status==='proposed'?head:source);
  Object.assign(wanted,copy(changes),{expectedRevision:head.revision,status:'proposed',reference:'',reviewedBy:actor,note});
  if(!previous&&head.status!=='proposed'&&!Object.hasOwn(changes,'effectiveFrom'))wanted.effectiveFrom=source.effectiveUntil;
  const identical=previous&&TERM_FIELDS.filter(key=>!['reviewedBy','note'].includes(key)).every(key=>same(wanted[key],head[key]));
  let native=null,continuation=head;
  if(!identical){native=await saveServiceTerms(record,wanted);continuation=native.terms;}
  const gapMilliseconds=continuity(source,continuation),timing=notice(input,source,previous);
  let quote=null;
  if(input.quoteId!==undefined&&input.quoteId!==null&&input.quoteId!==''){
    need(identical,'Retain the proposed continuation before attaching the quotation of that exact edition.');
    quote=await bindQuote(context,input.quoteId,input.quoteSha256,continuation);
  }else if(input.quoteSha256!==undefined&&input.quoteSha256!==null)need(false,'Select the original quotation with its hash.');
  else if(input.quoteId===undefined&&identical&&previous?.quote)quote=await bindQuote(context,previous.quote.id,previous.quote.sha256,continuation);
  const continuationInput=termInput(continuation);continuationInput.expectedRevision=head.revision;
  const body={schema:SERVICE_RENEWAL_PREVIEW_SCHEMA,caseId,id:input.id,expectedRevision:input.expectedRevision,
    sourceTerms:ref(source),currentTerms:ref(head),continuation:continuationInput,
    continuationTerms:identical?ref(continuation):null,owner:text(input.owner??previous?.owner??source.owner,'renewal owner',400),
    ...timing,quote,gapMilliseconds,continuity:gapMilliseconds===0?'continuous':'gap',
    previousSha256:previous?.sha256??null,actor,note};
  return {preview:{...body,previewSha256:await serviceSha256(body)},previous,continuation,native,source};
}

export async function previewServiceRenewal(value,input,context={}){
  const record=await original(value),prepared=await proposal(record,input,context);return prepared.preview;
}
export async function retainServiceRenewal(value,input,context={}){
  const record=await original(value),retried=await replay(record,input,'propose');if(retried.result)return retried.result;
  const prepared=await proposal(record,input,context),p=prepared.preview;
  if(input.expectedPreviewSha256!==undefined)need(hash(input.expectedPreviewSha256,'renewal preview hash')===p.previewSha256,
    'The renewal preview changed. Review the current proposal before retaining it.','SERVICE_RENEWAL_PREVIEW_CHANGED',409);
  const next=prepared.native?.record??record;next.renewals??=[];
  const body={schema:SERVICE_RENEWAL_SCHEMA,id:input.id,revision:(prepared.previous?.revision??0)+1,
    createdAt:at(context),caseId:p.caseId,state:'proposed',sourceTerms:p.sourceTerms,continuationTerms:ref(prepared.continuation),
    activatedTerms:null,owner:p.owner,noticeDays:p.noticeDays,noticeAt:p.noticeAt,quote:p.quote,acceptance:null,decision:null,
    actor:p.actor,note:p.note,previousSha256:p.previousSha256,requestId:input.requestId,
    request:retried.request,requestSha256:retried.requestSha256};
  const renewal={...body,sha256:await serviceSha256(body)};next.renewals.push(renewal);
  await validateServiceRenewals(next.renewals,next.terms);
  return {record:size(next),renewal:copy(renewal),terms:copy(prepared.continuation),reused:false};
}

function bindAcceptance(context,input,quote){
  uuid(input.acceptanceId,'accepted customer response ID',true);
  const responses=responseRows(context).filter(row=>row.kind==='RESPONSE'&&row.payload?.quoteId===quote.id);
  const response=responses.find(row=>row.id===input.acceptanceId);
  need(response&&response.payload.quoteSha256===quote.sha256&&response.payload.status==='ACCEPTED',
    'Select the retained accepted response to this exact renewal quotation.','SERVICE_RENEWAL_ACCEPTANCE_REQUIRED',409);
  const ordered=[...responses].sort((a,b)=>String(b.payload.observedAt).localeCompare(String(a.payload.observedAt))||
    String(b.createdAt).localeCompare(String(a.createdAt))||b.id.localeCompare(a.id));
  need(ordered[0]?.id===response.id,'A later customer response is retained for this quotation. Use its current recorded decision.',
    'SERVICE_RENEWAL_RESPONSE_CHANGED',409);
  const result={id:response.id,originCaseId:response.caseId,material:copy(response.material),quoteId:quote.id,
    quoteSha256:quote.sha256,status:'ACCEPTED',observedAt:response.payload.observedAt,recordedAt:response.createdAt,source:response.payload.source};
  acceptanceShape(result,quote);return result;
}
export async function recordServiceRenewalDecision(value,input,context={}){
  fields(input,DECISION_FIELDS,'renewal decision');
  if(input.expectedCaseRevision!==undefined)hash(input.expectedCaseRevision,'original case revision');
  const record=await original(value),retried=await replay(record,input,'decide');if(retried.result)return retried.result;
  const previous=current(record,input),caseId=contextCase(context);
  need(previous&&previous.caseId===caseId,'Choose the original renewal in this case.','SERVICE_RENEWAL_NOT_FOUND',404);
  need(['accepted','declined','closed'].includes(input.state),'Choose accepted, declined or closed.');
  need(previous.state==='proposed'||input.state==='closed'&&['accepted','declined'].includes(previous.state),
    'This renewal already has a retained final decision.','SERVICE_RENEWAL_CONFLICT',409);
  const actor=text(input.actor,'decision reviewer',240),note=text(input.note??'','decision note',8000,input.state!=='closed');
  let reference=text(input.reference??'','decision reference',4096,true),observedAt=instant(input.observedAt,'decision time');
  let next=record,acceptance=previous.acceptance,activatedTerms=previous.activatedTerms;
  const continuation=resolveTerms(record.terms,previous.continuationTerms,'proposed continuation');
  if(input.state==='accepted'){
    need(previous.quote,'Attach the retained continuation quotation before recording acceptance.');
    const head=latestTerms(record.terms,continuation.id);
    need(same(ref(head),previous.continuationTerms),'The proposed continuation has a newer terms edition. Review its renewal before accepting it.',
      'SERVICE_RENEWAL_TERMS_CONFLICT',409);
    const quote=await bindQuote(context,previous.quote.id,previous.quote.sha256,continuation);
    need(same(quote,previous.quote),'The retained renewal quotation material changed.','SERVICE_RENEWAL_QUOTE_CHANGED',409);
    acceptance=bindAcceptance(context,input,quote);
    need(observedAt===acceptance.observedAt,'Use the observed time of the original accepted customer response.');
    reference=reference||acceptance.source;
    const activeInput={...termInput(continuation),status:'active',reference,reviewedBy:actor,note};
    const activated=await saveServiceTerms(record,activeInput);next=activated.record;activatedTerms=ref(activated.terms);
  }else need(input.acceptanceId===undefined||input.acceptanceId===null,'An acceptance ID belongs to an accepted renewal decision.');
  const body={...unsealed(previous),revision:previous.revision+1,createdAt:at(context),state:input.state,
    activatedTerms,acceptance,decision:{observedAt,reference,note,actor},actor,note,
    previousSha256:previous.sha256,requestId:input.requestId,request:retried.request,requestSha256:retried.requestSha256};
  const renewal={...body,sha256:await serviceSha256(body)};next.renewals.push(renewal);
  await validateServiceRenewals(next.renewals,next.terms);
  return {record:size(next),renewal:copy(renewal),terms:copy(resolveTerms(next.terms,activatedTerms??previous.continuationTerms,'retained continuation')),reused:false};
}

/** Explicit UTC dates make the same saved portfolio produce the same queue. */
export async function buildServiceRenewalQueue(cases,{asOf,through,noticeDays=30,includeClosed=false}={}){
  instant(asOf,'portfolio date');through=instant(through??new Date(Date.parse(asOf)+90*DAY).toISOString(),'portfolio horizon');
  need(through>=asOf,'The portfolio horizon must follow its reporting date.');integer(noticeDays,'default notice days',0,3660);
  need(Array.isArray(cases),'Supply the saved case portfolio.');need(typeof includeClosed==='boolean','Choose whether to include closed renewals.');
  const queue=[],caseIds=new Set();
  for(const item of cases){
    const caseId=uuid(item.id,'portfolio case ID');hash(item.revision,'saved case revision');
    need(!caseIds.has(caseId),'Select one saved revision per case for this portfolio.');caseIds.add(caseId);
    const record=await original(item.service),heads=latestRenewals(record.renewals),selected=new Map();
    for(const renewal of heads){
      if(renewal.state==='closed'&&!includeClosed)continue;
      const source=resolveTerms(record.terms,renewal.sourceTerms,'source agreement');
      const existing=selected.get(source.sha256);
      if(!existing||renewal.createdAt>existing.renewal.createdAt||renewal.createdAt===existing.renewal.createdAt&&renewal.id>existing.renewal.id)
        selected.set(source.sha256,{source,renewal});
    }
    const agreements=new Map();
    for(const terms of record.terms)if(['active','ended'].includes(terms.status)&&
      (agreements.get(terms.id)?.revision??0)<terms.revision)agreements.set(terms.id,terms);
    for(const source of agreements.values()){
      if(!source.effectiveUntil||selected.has(source.sha256))continue;
      const terminal=heads.find(row=>same(row.sourceTerms,ref(source))&&row.state==='closed');
      if(terminal&&!includeClosed)continue;selected.set(source.sha256,{source,renewal:null});
    }
    for(const {source,renewal}of selected.values()){
      if(!source.effectiveUntil||source.effectiveUntil>through)continue;
      const continuation=renewal?resolveTerms(record.terms,renewal.continuationTerms,'proposed continuation'):null;
      const noticeAt=renewal?.noticeAt??new Date(Date.parse(source.effectiveUntil)-noticeDays*DAY).toISOString();
      const state=renewal?.state??'unplanned',resolved=['accepted','declined','closed'].includes(state),expired=source.effectiveUntil<=asOf;
      const noticeDue=noticeAt<=asOf,urgency=resolved?'resolved':expired?'expired':noticeDue?'notice_due':'upcoming';
      queue.push({caseId,caseRevision:item.revision,caseName:item.name??'',termsId:source.id,sourceTerms:ref(source),
        currentTerms:ref(latestTerms(record.terms,source.id)),title:source.title,customer:source.customer,
        owner:renewal?.owner??source.owner,incidentSourceId:source.incidentSourceId,merchantId:source.merchantId,
        merchantBinding:source.merchantBinding,effectiveFrom:source.effectiveFrom,effectiveUntil:source.effectiveUntil,
        state,urgency,expired,noticeDue,noticeAt,noticeDays:renewal?renewal.noticeDays:noticeDays,
        daysUntilExpiry:Math.ceil((Date.parse(source.effectiveUntil)-Date.parse(asOf))/DAY),
        renewal:renewal?{id:renewal.id,revision:renewal.revision,sha256:renewal.sha256}:null,
        continuation:continuation?{...ref(continuation),effectiveFrom:continuation.effectiveFrom,effectiveUntil:continuation.effectiveUntil}:null,
        activatedTerms:renewal?.activatedTerms??null,quote:copy(renewal?.quote??null),acceptance:copy(renewal?.acceptance??null),
        decision:copy(renewal?.decision??null),gapMilliseconds:continuation?Date.parse(continuation.effectiveFrom)-Date.parse(source.effectiveUntil):null});
    }
  }
  const rank={expired:0,notice_due:1,upcoming:2,resolved:3};
  queue.sort((a,b)=>rank[a.urgency]-rank[b.urgency]||a.effectiveUntil.localeCompare(b.effectiveUntil)||
    a.noticeAt.localeCompare(b.noticeAt)||a.caseId.localeCompare(b.caseId)||a.termsId.localeCompare(b.termsId)||
    (a.renewal?.id??'').localeCompare(b.renewal?.id??''));
  return {schema:SERVICE_RENEWAL_QUEUE_SCHEMA,asOf,through,noticeDays,includeClosed,cases:cases.length,
    summary:{agreements:new Set(queue.map(row=>row.caseId+':'+row.termsId)).size,rows:queue.length,
      ...Object.fromEntries(['unplanned',...STATES].map(state=>[state,queue.filter(row=>row.state===state).length])),
      expired:queue.filter(row=>row.urgency==='expired').length,noticeDue:queue.filter(row=>row.urgency==='notice_due').length},rows:queue};
}

async function handoverDocument(encoded,document,kind,caseId){
  const label=kind==='QUOTE'?'quotation':'customer response';
  fields(encoded,['id','sha256','bytes','encoding','data'],label+' material bytes');
  const identity=material({id:encoded.id,sha256:encoded.sha256,bytes:encoded.bytes},label+' material');
  need(encoded.encoding==='base64'&&typeof encoded.data==='string'&&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded.data),
    'Keep the complete original '+label+' material as base64.','SERVICE_RENEWAL_MATERIAL_CHANGED',409);
  let bytes,source,value;
  try{
    bytes=Uint8Array.from(atob(encoded.data),character=>character.charCodeAt(0));
    source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);value=JSON.parse(source);
  }catch{throw serviceRenewalError('SERVICE_RENEWAL_MATERIAL_CHANGED','The original '+label+' material is not complete UTF-8 JSON.',409);}
  need(bytes.length===identity.bytes&&await serviceSha256(source)===identity.sha256,
    'The original '+label+' material bytes changed.','SERVICE_RENEWAL_MATERIAL_CHANGED',409);
  fields(value,['schema','kind','id','caseId','createdAt','request','payload'],'original '+label+' document');
  need(value.schema==='stellar-forge.merchant-commercial-document.v1'&&value.kind===kind&&value.caseId===caseId,
    'Keep the '+label+' document with its original case.','SERVICE_RENEWAL_MATERIAL_CHANGED',409);
  uuid(value.id,label+' document ID',true);instant(value.createdAt,label+' recording time');
  fields(value.request,['action','actor','sha256'],'original '+label+' request');hash(value.request.sha256,label+' request hash');
  need(value.request.action===(kind==='QUOTE'?'publish':'receive')&&
    typeof value.request.actor==='string'&&value.request.actor.trim()&&value.request.actor.length<=200&&!/\0/.test(value.request.actor),
    'Keep the original '+label+' writer request.','SERVICE_RENEWAL_MATERIAL_CHANGED',409);
  fields(document,['schema','kind','id','caseId','createdAt','request','payload','material'],'retained '+label+' document');
  need(same(document.material,identity)&&identity.id==='commercial:'+value.id&&
    same(Object.fromEntries(Object.entries(document).filter(([key])=>key!=='material')),value),
    'The retained '+label+' document differs from its original material.','SERVICE_RENEWAL_MATERIAL_CHANGED',409);
  return value;
}

/** Validate the portable financial join using the original service lifecycle and document bytes. */
export async function validateServiceRenewalHandover(value){
  fields(value,['schema','case','renewal','renewalHistory','termsHistory','acceptedHead','sourceTerms',
    'proposedContinuation','activeTerms','currentTerms','quote','quoteDocument','acceptance','materials',
    'continuity','financialJoin','sha256'],'renewal handover');
  need(value.schema===SERVICE_RENEWAL_HANDOVER_SCHEMA,'Choose the original renewal handover schema.');
  hash(value.sha256,'renewal handover hash');
  need(await serviceSha256(unsealed(value))===value.sha256,'The complete renewal handover changed.',
    'SERVICE_RENEWAL_HANDOVER_CHANGED',409);
  const caseId=uuid(value.case?.id,'handover case ID'),caseRevision=hash(value.case?.revision,'handover case revision');
  if(value.case.currentRevision!==undefined)hash(value.case.currentRevision,'current case revision');
  const service=await original({...createServiceRecord(),terms:copy(rows(value.termsHistory,'handover terms history')),
    renewals:copy(rows(value.renewalHistory,'handover renewal history'))});
  need(service.renewals.every(row=>row.caseId===caseId),'Keep every renewal with its original handover case.',
    'SERVICE_RENEWAL_HISTORY_CONFLICT',409);
  const renewal=latestRenewals(service.renewals).find(row=>row.id===value.renewal?.id);
  need(renewal&&same(renewal,value.renewal),'The selected renewal is not its current retained edition.',
    'SERVICE_RENEWAL_HISTORY_CONFLICT',409);
  const accepted=service.renewals.filter(row=>row.id===renewal.id&&row.state==='accepted').sort((a,b)=>b.revision-a.revision)[0]??null;
  need(same(value.acceptedHead,accepted?ref(accepted):null),'Keep the exact retained accepted renewal edition.',
    'SERVICE_RENEWAL_ACCEPTANCE_CHANGED',409);
  const source=resolveTerms(service.terms,renewal.sourceTerms,'handover source agreement');
  const continuation=resolveTerms(service.terms,renewal.continuationTerms,'handover proposed continuation');
  const active=renewal.activatedTerms?resolveTerms(service.terms,renewal.activatedTerms,'handover active continuation'):null;
  need(same(value.sourceTerms,source)&&same(value.proposedContinuation,continuation)&&same(value.activeTerms,active)&&
    same(value.currentTerms,latestTerms(service.terms,source.id)),
    'Keep the distinct original, proposed, activated and current terms editions.','SERVICE_RENEWAL_TERMS_CHANGED',409);
  fields(value.materials,['quote','acceptance'],'handover materials');
  if(renewal.quote){
    need(value.quote&&typeof value.quote==='object'&&!Array.isArray(value.quote),
      'Keep the complete original renewal quotation.','SERVICE_RENEWAL_QUOTE_CHANGED',409);
    const quote=await bindQuote({quotes:[value.quote]},renewal.quote.id,renewal.quote.sha256,continuation);
    need(same(quote,renewal.quote),'The handover quotation differs from the retained renewal.','SERVICE_RENEWAL_QUOTE_CHANGED',409);
    const document=await handoverDocument(value.materials.quote,value.quoteDocument,'QUOTE',caseId);
    const payload=Object.fromEntries(Object.entries(value.quote).filter(([key])=>!['originCaseId','receiving','material'].includes(key)));
    need(document.id===quote.id&&document.createdAt===quote.createdAt&&same(document.payload,payload)&&
      value.quote.originCaseId===caseId&&same(value.quote.material,value.quoteDocument.material),
      'Keep the exact original quotation payload and its source binding.','SERVICE_RENEWAL_QUOTE_CHANGED',409);
  }else need(value.quote===null&&value.quoteDocument===null&&value.materials.quote===null,
    'This renewal has no retained quotation.','SERVICE_RENEWAL_QUOTE_CHANGED',409);
  if(renewal.acceptance){
    const document=await handoverDocument(value.materials.acceptance,value.acceptance,'RESPONSE',caseId);
    fields(document.payload,['quoteId','quoteSha256','status','observedAt','source','note'],'original customer response');
    need(typeof document.payload.note==='string'&&document.payload.note.length<=16000&&!/\0/.test(document.payload.note),
      'Keep the complete original customer response note.','SERVICE_RENEWAL_ACCEPTANCE_CHANGED',409);
    const acceptance=bindAcceptance({responses:[value.acceptance]},{acceptanceId:renewal.acceptance.id},renewal.quote);
    need(same(acceptance,renewal.acceptance),'The handover response differs from the retained acceptance.',
      'SERVICE_RENEWAL_ACCEPTANCE_CHANGED',409);
  }else need(value.acceptance===null&&value.materials.acceptance===null,
    'This renewal has no retained customer acceptance.','SERVICE_RENEWAL_ACCEPTANCE_CHANGED',409);
  const continuity={sourceEndsAt:source.effectiveUntil,continuationStartsAt:continuation.effectiveFrom,
    gapMilliseconds:Date.parse(continuation.effectiveFrom)-Date.parse(source.effectiveUntil)};
  need(same(value.continuity,continuity),'The handover changed the original continuation dates.','SERVICE_RENEWAL_TERMS_CHANGED',409);
  const financialJoin={caseId,caseRevision,agreementId:source.id,sourceTerms:ref(source),proposedContinuation:ref(continuation),
    activeTerms:active?ref(active):null,quoteId:renewal.quote?.id??null,quoteSha256:renewal.quote?.sha256??null,
    acceptanceId:renewal.acceptance?.id??null,acceptedAt:renewal.acceptance?.observedAt??null};
  need(same(value.financialJoin,financialJoin),'The financial join differs from the original renewal references.',
    'SERVICE_RENEWAL_HANDOVER_CHANGED',409);
  return copy(value);
}
