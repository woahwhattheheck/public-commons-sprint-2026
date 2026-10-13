'use strict';
/** Shared delivery feedback joins; the native and portable hosts use this same implementation. */
function createLeadDeliveryFeedback({core,parseDeliveryReports,correlateDeliveryReports,unwrapNativeMessages,nativeSentIdentity,savedSentIdentity,deliveryAddress,normalizeMessages,nativeMessageEvidence,googleAttachmentFailure,googleSendingLimitFailure}) {
/** Original Gmail DSNs joined to the existing saved customer delivery.
 * All provider parsing and original SENT recognition belong to the maintained
 * Gmail modules. This adapter has no provider, storage or outbound operations.
 */
const LEAD_DELIVERY_FEEDBACK_VERSION = 'dealscout.lead-delivery-feedback.v1';
const LEAD_DELIVERY_FEEDBACK_SOURCE_VERSION = 'dealscout.lead-delivery-feedback-source.v1';
const LEAD_DELIVERY_FEEDBACK_PREVIEW_VERSION = 'dealscout.lead-delivery-feedback-preview.v1';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const sorted = rows => [...rows].sort((a,b) => {
  const left=core.hash(a),right=core.hash(b);return left < right ? -1 : left > right ? 1 : 0;
});
const sealed = document => ({...document,sha256:core.hash(document)});
const fail = (code,message,details) => { throw Object.assign(new Error(message),
  {code,status:422,...(details?{details}:{})}); };
const requireValue = (value,code,message,details) => {
  if(!value)fail(code,message,details);
};
const id = (prefix,value) => prefix+core.hash(value).slice(0,40);
const plainMailbox = value => typeof value === 'string'
  ? deliveryAddress('rfc822; '+value).mailbox : null;
const instant = value => Number.isFinite(Date.parse(value ?? ''))
  ? new Date(Date.parse(value)).toISOString() : null;
const eventDocument = row => {const {sha256,...document}=row;return document;};
const semanticEvent = row => {
  const {id,sha256,report_source_id,sent_source_id,sent_source_sha256,
    sent_native_review_sha256,case_bindings,...document}=row;return document;
};
const diagnostic = (code,message,details={}) => ({code,message,...details});
const mailboxKey = value => {
  const parsed=plainMailbox(value);
  requireValue(parsed && parsed.key===value && value===value.trim(),
    'LEAD_DELIVERY_MAILBOX','Enter the exact Gmail account used for the native exports.');
  return parsed.key;
};
// Gmail attachment handles authorize retrieval and may change on a later
// read of the same message. The complete original capture retains them;
// content comparison retains all MIME fields and omits only these handles.
function originalPayload(value) {
  if(Array.isArray(value))return value.map(originalPayload);
  if(!plain(value))return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key])=>key!=='attachment_id'&&key!=='attachmentId')
    .map(([key,child])=>[key,originalPayload(child)]));
}
function sourceDocument(native,kind,mailbox) {
  const identity=nativeSentIdentity(native,{mailbox});
  requireValue(typeof native.id==='string' && /^[a-zA-Z0-9_-]{1,128}$/.test(native.id) &&
    identity.occurred_at && typeof identity.thread_id==='string' && identity.thread_id,
    'LEAD_DELIVERY_NATIVE_IDENTITY','The original Gmail message needs its provider ID, thread and timestamp.');
  const document={version:LEAD_DELIVERY_FEEDBACK_SOURCE_VERSION,
    id:id('gmail-source-',{kind,mailbox,native_message:native}),
    kind,origin:'GMAIL_FULL',mailbox,provider_id:native.id,
    thread_id:identity.thread_id,occurred_at:identity.occurred_at,
    // JSON member order can differ across complete connector reads. Retain
    // the exact capture separately while comparing its original content.
    native_identity_sha256:core.hash({id:native.id,
      internal_date:native.internal_date??native.internalDate,payload:originalPayload(native.payload)}),
    native_message:clone(native),saved_sent:null};
  return sealed(document);
}
function savedSource(event,caseId,mailbox) {
  const identity=savedSentIdentity(event);
  requireValue(identity?.mailbox===mailbox,'LEAD_DELIVERY_SAVED_SENT',
    'The retained case needs its original native SENT identity.');
  const original={case_id:caseId,event:clone(event)};
  return sealed({version:LEAD_DELIVERY_FEEDBACK_SOURCE_VERSION,
    id:id('gmail-source-',{kind:'sent',mailbox,saved_sent:original}),
    kind:'sent',origin:'RETAINED_NATIVE_SENT',mailbox,
    provider_id:event.provider_id,thread_id:identity.thread_id,
    occurred_at:instant(identity.occurred_at),
    native_identity_sha256:identity.source_sha256,native_message:null,saved_sent:original});
}
function sourceList(raw,label) {
  requireValue(Array.isArray(raw),'LEAD_DELIVERY_NATIVE_LIST',
    label+' must contain complete original Gmail messages.');
  requireValue(raw.length<=1000,'LEAD_DELIVERY_NATIVE_LIMIT',
    'Receive at most 1,000 original messages in one delivery-feedback operation.');
  if(!raw.length)return [];
  return unwrapNativeMessages(raw);
}
function canonicalSources(natives,kind,mailbox,review,retainedSources=[]) {
  const sources=[],groups=new Map();
  for(const native of natives) {
    const source=sourceDocument(native,kind,mailbox);
    if(!sources.some(row=>row.id===source.id))sources.push(source);
    const group=groups.get(source.provider_id)||[];
    group.push({native,source});groups.set(source.provider_id,group);
  }
  const chosen=[];
  for(const [providerId,group] of groups) {
    const retained=retainedSources.filter(source=>source.origin==='GMAIL_FULL'&&
      source.kind===kind&&source.mailbox===mailbox&&source.provider_id===providerId);
    if(retained.length&&new Set([...retained.map(source=>source.native_identity_sha256),
      ...group.map(item=>item.source.native_identity_sha256)]).size!==1) {
      review.push(diagnostic('RETAINED_NATIVE_SOURCE_CHANGED',
        'The same provider message differs from its retained original content.',
        {provider_id:providerId,kind,retained_source_ids:retained.map(source=>source.id),
          source_ids:group.map(item=>item.source.id)}));continue;
    }
    if(new Set(group.map(item=>item.source.native_identity_sha256)).size!==1) {
      review.push(diagnostic('CONFLICTING_NATIVE_SOURCE',
        'The same provider message has different original content in this input.',
        {provider_id:providerId,kind,source_ids:group.map(item=>item.source.id)}));continue;
    }
    const states=group.map(item=>{
      const labels=item.native.label_ids??item.native.labelIds??[];
      return [labels.includes('SENT'),labels.includes('DRAFT')].join(':');
    });
    if(new Set(states).size!==1) {
      review.push(diagnostic('CONFLICTING_NATIVE_DIRECTION',
        'The supplied copies disagree on the original message direction.',
        {provider_id:providerId,kind,source_ids:group.map(item=>item.source.id)}));continue;
    }
    group.sort((a,b)=>a.source.id<b.source.id?-1:a.source.id>b.source.id?1:0);
    chosen.push(group[0]);
  }
  return {sources,chosen};
}
function destination(row) {
  const value=String(row.destination??'').trim();
  if(/^mailto:/i.test(value)) {
    if(/[?#]/.test(value))return null;
    try {return plainMailbox(decodeURIComponent(value.slice(7)));} catch {return null;}
  }
  return plainMailbox(value);
}
function gmailDelivery(row) {
  return /^(?:gmail|e-?mail)(?:[ :/_-]+gmail)?$/i.test(String(row.channel??'').trim()) ||
    /^https:\/\/mail\.google\.com\//i.test(String(row.receipt_url??''));
}
function sourceMap(root,additional) {
  const map=new Map();
  for(const source of [...(root.delivery_feedback_sources||[]),...additional]) {
    const existing=map.get(source.id);
    requireValue(!existing||core.hash(existing)===core.hash(source),'LEAD_DELIVERY_SOURCE_CONFLICT',
      'An existing delivery source ID has different retained content.',{source_id:source.id});
    map.set(source.id,source);
  }
  return map;
}
function previousFeedback(root,event,sources) {
  const existing=(root.delivery_feedback||[]).find(row=>row.id===event.id);
  if(!existing)return event;
  requireValue(existing.sha256===core.hash(eventDocument(existing)),
    'LEAD_DELIVERY_FEEDBACK_CHANGED','An existing delivery outcome changed.',{feedback_id:existing.id});
  requireValue(core.hash(semanticEvent(existing))===core.hash(semanticEvent(event)),
    'LEAD_DELIVERY_FEEDBACK_CONFLICT','The same original report has different delivery semantics.',
    {feedback_id:event.id});
  const originalSent=sources.get(existing.sent_source_id),currentSent=sources.get(event.sent_source_id);
  requireValue(originalSent&&currentSent,'LEAD_DELIVERY_SOURCE_MISSING',
    'The original SENT source for this outcome is missing.');
  if(originalSent.origin==='GMAIL_FULL'&&currentSent.origin==='GMAIL_FULL')
    requireValue(originalSent.native_identity_sha256===currentSent.native_identity_sha256,
      'LEAD_DELIVERY_SENT_CONFLICT','The provider SENT content differs from the retained original.');
  requireValue(existing.sent_native_review_sha256===event.sent_native_review_sha256,
    'LEAD_DELIVERY_SENT_REVIEW_CONFLICT','The original SENT body or header evidence differs from the retained outcome.');
  return clone(existing);
}

/** Read all original deliveries before applying the optional pack selection. */

/** Use the same native Gmail policy classifier as case mail review. Its empty
 * SMTP status stays empty; recipient evidence comes from one original SENT. */
function nativeGoogleFailureReport(item,normalized,cases,mailbox,review){
  const classifiers=[googleAttachmentFailure,googleSendingLimitFailure].filter(value=>typeof value==='function');
  if(!classifiers.length)return null;
  let notice;
  try{notice=normalizeMessages([item.native],{mailbox})[0];}
  catch(error){return null;}
  const matches=[];
  for(const sent of normalized.values()){
    const recipients=[...new Map(sent.identity.recipients.map(row=>[row.key,row])).values()];
    if(recipients.length!==1)continue;
    const recipient=recipients[0],outcome=classifiers.map(classify=>classify(notice,sent.message,recipient.key)).find(Boolean);
    if(!outcome)continue;
    if(!sent.identity.occurred_at||Date.parse(sent.identity.occurred_at)>Date.parse(item.source.occurred_at)){
      review.push(diagnostic('POLICY_NOTICE_TIME_ORDER','The original SENT must precede this native policy notice.',
        {notice_provider_id:item.native.id,sent_provider_id:sent.native.id}));continue;
    }
    matches.push({sent,recipient,outcome});
  }
  if(matches.length>1){
    review.push(diagnostic('AMBIGUOUS_POLICY_NOTICE','This notice matches more than one complete original SENT.',
      {notice_provider_id:item.native.id,sent_provider_ids:matches.map(x=>x.sent.native.id)}));
    return {ambiguous:true};
  }
  if(!matches.length)return null;
  const {sent,recipient,outcome}=matches[0],bindings=[];
  for(const record of cases)for(const event of record.events||[]){
    const identity=savedSentIdentity(event);
    if(!identity||identity.provider_id!==sent.native.id||identity.mailbox!==mailbox||
       Date.parse(identity.occurred_at)!==Date.parse(sent.identity.occurred_at)||
       identity.message_ids.length!==1||identity.message_ids[0]!==sent.identity.message_ids[0]||
       new Set(identity.recipients.map(row=>row.key)).size!==1||
       identity.recipients[0].key!==recipient.key)continue;
    bindings.push({case_id:record.id??record.case_id,sent_event_id:event.id,
      recipient_email:recipient.key,occurred_at:event.occurred_at});
  }
  const sendingLimit=outcome.delivery_failure_kind==='GMAIL_SENDING_LIMIT';
  const reportId=id(sendingLimit?'gmail-sending-limit-':'gmail-policy-',{mailbox,notice:item.native.id,source:item.source.native_identity_sha256});
  const recipientId=id(sendingLimit?'gmail-sending-limit-recipient-':'gmail-policy-recipient-',{report_id:reportId,sent:sent.native.id,recipient:recipient.key});
  const candidate={provider_id:sent.native.id,mailbox,original_message_ids:[...sent.identity.message_ids],
    original_envelope_id:null,recipient_email:recipient.key,recipient_match:'ORIGINAL_SENT_SINGLE_RECIPIENT',
    header_field:recipient.field,source_sha256:sent.identity.source_sha256,
    occurred_at:sent.identity.occurred_at,case_bindings:bindings};
  return {kind:outcome.delivery_failure_kind,delivery_failure_evidence:clone(outcome.delivery_failure_evidence),
    id:reportId,provider_id:item.native.id,observed_at:item.source.occurred_at,issues:[],
    source:{sha256:core.hash({notice_native_identity_sha256:item.source.native_identity_sha256,
      original_sent_native_review_sha256:sent.evidence.source_sha256,kind:outcome.delivery_failure_kind})},
    recipients:[{id:recipientId,native_sent_recipient:recipient.key,issues:[],action:'failed',state:'FAILED',status:outcome.status,
      terminal:true,diagnostic:{raw:outcome.diagnostic,type:sendingLimit?'gmail-sending-limit':'gmail-attachment-policy',value:outcome.diagnostic},
      correlation:{state:bindings.length>1?'AMBIGUOUS_CASE':bindings.length===1?'MATCHED_CASE':'MATCHED_SENT',
        candidates:[candidate],issues:[]}}]};
}

function previewLeadDeliveryFeedback(ledger,input) {
  requireValue(plain(input),'LEAD_DELIVERY_INPUT','Supply the original delivery reports and SENT sources.');
  const mailbox=mailboxKey(input.mailbox),root=core.validateRoot(ledger);
  const packId=input.pack_id??'';
  requireValue(typeof packId==='string'&&(!packId||root.packs.some(row=>row.id===packId)),
    'LEAD_DELIVERY_PACK','Choose an existing customer lead pack.');
  const review=[],unmatched=[],feedback=[],nativeSources=[];
  const reportsInput=sourceList(input.reports,'Delivery reports');
  requireValue(reportsInput.length>0,'LEAD_DELIVERY_REPORT_REQUIRED','Supply at least one original delivery report.');
  const sentInput=sourceList(input.sent_messages??[],'Original SENT messages');
  const reportSet=canonicalSources(reportsInput,'report',mailbox,review,root.delivery_feedback_sources||[]);
  const sentSet=canonicalSources(sentInput,'sent',mailbox,review,root.delivery_feedback_sources||[]);
  nativeSources.push(...reportSet.sources,...sentSet.sources);
  const suppliedReportIds=new Set(reportsInput.map(row=>row.id));
  const suppliedSentIds=new Set(sentInput.map(row=>row.id));
  for(const providerId of suppliedReportIds)
    requireValue(!suppliedSentIds.has(providerId),'LEAD_DELIVERY_DIRECTION',
      'A provider message cannot be both the selected report and its original SENT.');
  const normalized=new Map();
  const usableSent=[];
  for(const item of sentSet.chosen) {
    try {
      const identity=nativeSentIdentity(item.native,{mailbox});
      const message=normalizeMessages([item.native],{mailbox})[0];
      if(!identity.native_sent||!identity.occurred_at||identity.message_ids.length!==1 ||
        message.native_review?.body_complete!==true||!message.native_review?.source_sha256) {
        review.push(diagnostic('ORIGINAL_SENT_SOURCE_REQUIRED',
          'The selected SENT needs its original account, complete message and unique RFC identity.',
          {provider_id:item.native.id,source_id:item.source.id}));continue;
      }
      normalized.set(item.native.id,{...item,identity,message,evidence:nativeMessageEvidence(message)});
      usableSent.push(item.native);
    } catch(error) {
      review.push(diagnostic('ORIGINAL_SENT_SOURCE_INVALID',
        'The selected original SENT source could not be received.',
        {provider_id:item.native.id,source_id:item.source.id,detail:String(error.message)}));
    }
  }
  // Existing case headers may supply an original SENT when its full capture is
  // not part of this input. A conflicting supplied provider copy is not hidden
  // by that fallback.
  const blockedSent=new Set([...suppliedSentIds].filter(value=>!normalized.has(value)));
  const cases=(Array.isArray(ledger.cases)?ledger.cases:[]).map(record=>({
    ...record,events:(record.events||[]).filter(event=>
      !(event.type==='SENT'&&(blockedSent.has(event.provider_id)||
        (event.mailbox&&event.mailbox!==mailbox))))
  }));
  const caseLedger={...ledger,cases};
  const parsed=[],policyReports=[];
  const reportSources=new Map(reportSet.chosen.map(item=>[item.native.id,item.source]));
  for(const item of reportSet.chosen) {
    try {
      const result=parseDeliveryReports(item.native,{mailbox});
      if(!result.reports.length) {
        const policy=nativeGoogleFailureReport(item,normalized,cases,mailbox,review);
        if(policy){if(!policy.ambiguous)policyReports.push(policy);continue;}
        review.push(diagnostic(result.report_like?'DELIVERY_STATUS_PART_REQUIRED':'NOT_A_DELIVERY_REPORT',
          result.report_like?'Receive the complete original delivery-status MIME part.':'The selected message has no native delivery-status report.',
          {provider_id:item.native.id,source_id:item.source.id}));continue;
      }
      parsed.push(...result.reports);
    } catch(error) {
      review.push(diagnostic('DELIVERY_REPORT_INVALID','The original delivery report could not be parsed.',
        {provider_id:item.native.id,source_id:item.source.id,detail:String(error.message)}));
    }
  }
  const correlated=[...correlateDeliveryReports({reports:parsed,sentMessages:usableSent,ledger:caseLedger,mailbox}),...policyReports];
  const editions=new Map(root.editions.map(row=>[row.id,row]));
  const retainedSources=sourceMap(root,nativeSources);
  let outcomes=0,matchedSent=0,outsideSelection=0;
  const reusedIds=new Set();
  for(const report of correlated)for(const recipient of report.recipients) {
    outcomes++;
    const scope={notice_provider_id:report.provider_id,report_id:report.id,recipient_id:recipient.id,
      recipient:recipient.original_recipient?.mailbox?.key??recipient.final_recipient?.mailbox?.key??recipient.native_sent_recipient??'',
      action:recipient.action,status:recipient.status};
    const correlation=recipient.correlation;
    if(!['MATCHED_SENT','MATCHED_CASE'].includes(correlation.state)||correlation.candidates.length!==1) {
      const entry=diagnostic(correlation.state,
        correlation.state==='UNMATCHED'?'The report has no unique original SENT association.':'Review the original delivery source or its ambiguous associations.',
        {...scope,correlation:clone(correlation),source_issues:clone([...report.issues,...recipient.issues])});
      (correlation.state==='UNMATCHED'?unmatched:review).push(entry);continue;
    }
    matchedSent++;
    const candidate=correlation.candidates[0];
    const fullSent=normalized.get(candidate.provider_id);
    const caseSourceMismatch=fullSent&&candidate.case_bindings.some(binding=>{
      const record=cases.find(row=>(row.id??row.case_id)===binding.case_id);
      const event=record?.events.find(row=>row.id===binding.sent_event_id);
      return event?.native_message_source?.source_sha256&&
        event.native_message_source.source_sha256!==fullSent.evidence.source_sha256;
    });
    if(caseSourceMismatch) {
      review.push(diagnostic('ORIGINAL_CASE_SENT_SOURCE_MISMATCH',
        'The current native SENT differs from its original retained case evidence.',
        {...scope,sent_provider_id:candidate.provider_id,case_bindings:clone(candidate.case_bindings)}));continue;
    }
    // This search is deliberately over every pack. A selected pack cannot
    // resolve a provider/recipient collision elsewhere in the same workspace.
    const providerRows=root.deliveries.filter(row=>row.provider_id===candidate.provider_id);
    const matched=providerRows.filter(row=>gmailDelivery(row)&&destination(row)?.key===candidate.recipient_email);
    if(matched.length!==1) {
      (matched.length?review:unmatched).push(diagnostic(
        matched.length?'AMBIGUOUS_LEAD_DELIVERY':'LEAD_DELIVERY_NOT_RECORDED',
        matched.length?'The original SENT and recipient identify more than one saved customer delivery.':'The original SENT is recognized, but its matching lead delivery is not recorded in this workspace.',
        {...scope,sent_provider_id:candidate.provider_id,
          candidate:clone(candidate),delivery_candidates:providerRows.map(row=>({
            delivery_id:row.id,edition_id:row.edition_id,provider_id:row.provider_id,
            destination:row.destination,channel:row.channel,delivery_sha256:core.hash(row)}))}));continue;
    }
    const delivery=matched[0],edition=editions.get(delivery.edition_id);
    const sourceTime=Date.parse(candidate.occurred_at);
    if(!edition||sourceTime<Date.parse(edition.prepared_at)) {
      review.push(diagnostic('LEAD_DELIVERY_TIME_MISMATCH',
        'The original SENT predates its prepared customer edition.',
        {...scope,sent_provider_id:candidate.provider_id,delivery_id:delivery.id,
          sent_at:candidate.occurred_at,recorded_delivery_at:delivery.delivered_at,
          prepared_at:edition?.prepared_at??null}));continue;
    }
    if(packId&&edition.pack_id!==packId){outsideSelection++;continue;}
    if(Date.parse(delivery.delivered_at)!==sourceTime)
      review.push(diagnostic('RECORDED_DELIVERY_TIME_DIFFERS',
        'The saved delivery time differs from the native SENT time; the original provider and recipient identify this delivery.',
        {...scope,severity:'warning',requires_review:false,
          sent_provider_id:candidate.provider_id,delivery_id:delivery.id,
          sent_at:candidate.occurred_at,recorded_delivery_at:delivery.delivered_at}));
    let sent=normalized.get(candidate.provider_id);
    if(!sent) {
      const binding=candidate.case_bindings.length===1?candidate.case_bindings[0]:null;
      const originalCase=binding&&cases.find(row=>(row.id??row.case_id)===binding.case_id);
      const originalEvent=originalCase?.events.find(row=>row.id===binding.sent_event_id);
      const identity=originalEvent&&savedSentIdentity(originalEvent);
      if(!identity||identity.source_sha256!==candidate.source_sha256) {
        review.push(diagnostic('ORIGINAL_SENT_SOURCE_REQUIRED',
          'Retain the complete original SENT or its existing verified case association.',
          {...scope,sent_provider_id:candidate.provider_id,delivery_id:delivery.id}));continue;
      }
      const source=savedSource(originalEvent,binding.case_id,mailbox);
      nativeSources.push(source);retainedSources.set(source.id,source);
      sent={source,identity,evidence:clone(originalEvent.native_message_source)};
    }
    const reportSource=reportSources.get(report.provider_id);
    const semantic={version:LEAD_DELIVERY_FEEDBACK_VERSION,
      pack_id:edition.pack_id,edition_id:edition.id,edition_sha256:edition.sha256,
      delivery_id:delivery.id,delivery_sha256:core.hash(delivery),
      mailbox,notice_provider_id:report.provider_id,sent_provider_id:candidate.provider_id,
      report_id:report.id,recipient_id:recipient.id,report_source_sha256:report.source.sha256,
      recipient:candidate.recipient_email,recipient_match:candidate.recipient_match,
      header_field:candidate.header_field,action:recipient.action,state:recipient.state,
      status:recipient.status,terminal:recipient.terminal,diagnostic:clone(recipient.diagnostic),
      occurred_at:report.observed_at,last_attempt_at:recipient.last_attempt?.utc??null,
      will_retry_until:recipient.will_retry_until?.utc??null,
      original_message_ids:[...candidate.original_message_ids].sort(),
      original_envelope_id:candidate.original_envelope_id??null,
      ...(report.kind?{delivery_failure_kind:report.kind,delivery_failure_evidence:clone(report.delivery_failure_evidence)}:{})};
    const record=sealed({id:id('delivery-feedback-',{
        mailbox,notice_provider_id:report.provider_id,report_id:report.id,
        recipient_id:recipient.id,report_source_sha256:report.source.sha256,
        sent_provider_id:candidate.provider_id,recipient:candidate.recipient_email,
        delivery_id:delivery.id,delivery_sha256:core.hash(delivery)}),
      ...semantic,report_source_id:reportSource.id,sent_source_id:sent.source.id,
      sent_source_sha256:candidate.source_sha256,
      sent_native_review_sha256:sent.evidence.source_sha256,
      case_bindings:sorted(candidate.case_bindings)});
    const accepted=previousFeedback(root,record,retainedSources);
    if(accepted.sha256!==record.sha256||(root.delivery_feedback||[]).some(row=>row.id===accepted.id))reusedIds.add(accepted.id);
    if(!feedback.some(row=>row.id===accepted.id))feedback.push(accepted);
  }
  const sources=sorted([...new Map(nativeSources.map(row=>[row.id,row])).values()]);
  const orderedFeedback=[...feedback].sort((a,b)=>a.occurred_at.localeCompare(b.occurred_at)||a.id.localeCompare(b.id));
  return {version:LEAD_DELIVERY_FEEDBACK_PREVIEW_VERSION,pack_id:packId,mailbox,
    input_sha256:core.hash(input),feedback:orderedFeedback,sources,
    unmatched:sorted(unmatched),review:sorted(review),
    summary:{reports:correlated.length,outcomes,matched_sent:matchedSent,
      feedback:orderedFeedback.length,new_feedback:orderedFeedback.length-reusedIds.size,reused_feedback:reusedIds.size,
      outside_selection:outsideSelection,unmatched:unmatched.length,review:review.length,
      sources:sources.length,
      actions:Object.fromEntries(['failed','delayed','delivered','relayed','expanded'].map(action=>
        [action,orderedFeedback.filter(row=>row.action===action).length]))}};
}

/** Compare a prepared result against the same source-native adapter, without
 * granting a caller-supplied derived record authority to alter the workspace. */
function validateLeadDeliveryFeedbackPreview(ledger,input,preview) {
  const expected=previewLeadDeliveryFeedback(ledger,input);
  requireValue(core.hash(preview)===core.hash(expected),'LEAD_DELIVERY_PREVIEW_CHANGED',
    'The prepared delivery feedback differs from its original messages and current lead workspace.');
  return expected;
}

return {LEAD_DELIVERY_FEEDBACK_VERSION,LEAD_DELIVERY_FEEDBACK_SOURCE_VERSION,LEAD_DELIVERY_FEEDBACK_PREVIEW_VERSION,previewLeadDeliveryFeedback,validateLeadDeliveryFeedbackPreview};
}
module.exports={createLeadDeliveryFeedback};
