'use strict';
/** Connected checkpoint history over the maintained native Gmail/Lead Service parser. */
const {sha256Utf8}=require('./connected_sha256.cjs');
const {createPortableGmail}=require('../tools/revenue_owner_console_20261010/lead_delivery_portable_gmail.cjs');
const gmail=createPortableGmail();
const VERSION='commons.contact-delivery-notice/v1';
const STATE='commons.contact-delivery-state/v1';
const clone=value=>JSON.parse(JSON.stringify(value));
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function need(value,code){if(!value)throw Object.assign(new Error(code),{code});}
function canonical(value){
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  need(plain(value),'DELIVERY_NOTICE_JSON_REQUIRED');
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
const digest=value=>sha256Utf8(canonical(value)).sha256;
function one(part,name,required=false){
  const rows=(part?.headers??[]).filter(row=>row.name?.toLowerCase()===name);
  need(rows.length<=1&&rows.every(row=>typeof row.value==='string'),'DELIVERY_NOTICE_HEADER_AMBIGUOUS');
  const value=rows[0]?.value??'';
  need(!required||value,'DELIVERY_NOTICE_HEADER_REQUIRED');return value;
}
function identityId(value){
  need(typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value),'DELIVERY_NOTICE_PROVIDER_ID_REQUIRED');return value;
}
function originalPayload(value){
  if(Array.isArray(value))return value.map(originalPayload);
  if(!plain(value))return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!['attachment_id','attachmentId','read_attachment_supported'].includes(key))
    .map(([key,child])=>[key,originalPayload(child)]));
}
function contentIdentity(native){
  return {id:native.id,thread_id:native.thread_id??native.threadId,
    internal_date:native.internal_date??native.internalDate,payload:originalPayload(native.payload)};
}
function targetAddress(value){
  need(typeof value==='string'&&value===value.trim()&&!/[\x00-\x20\x7f<>,;]/.test(value),'DELIVERY_NOTICE_ADDRESS_REQUIRED');
  const parsed=gmail.report.deliveryAddress('rfc822; '+value).mailbox;
  need(parsed&&parsed.key===value,'DELIVERY_NOTICE_ADDRESS_REQUIRED');return parsed.key;
}
function readDeliveryNotice({sent,notice,mailbox,recipient,recordedAt=new Date().toISOString()}={}){
  need(plain(sent)&&plain(notice)&&plain(mailbox),'DELIVERY_NOTICE_NATIVE_SOURCES_REQUIRED');
  const account={link_id:identityId(mailbox.link_id),profile_id:identityId(mailbox.profile_id),email:targetAddress(mailbox.email)};
  const target=targetAddress(recipient),sentId=identityId(sent.id),noticeId=identityId(notice.id);
  need(sentId!==noticeId,'DELIVERY_NOTICE_SOURCE_ID_CONFLICT');
  const sentIdentity=gmail.report.nativeSentIdentity(sent,{mailbox:account.email});
  need(sentIdentity.native_sent&&sentIdentity.message_ids.length===1&&sentIdentity.occurred_at&&
    sentIdentity.recipients.length===1&&sentIdentity.recipients[0].key===target&&sentIdentity.recipients[0].field==='to',
    'DELIVERY_NOTICE_ORIGINAL_ENVELOPE_MISMATCH');
  const rfc=one(sent.payload,'message-id',true).trim();
  need(rfc===sentIdentity.message_ids[0]&&/^<[^<>\s]+@[^<>\s]+>$/.test(rfc),'DELIVERY_NOTICE_MESSAGE_ID_REQUIRED');
  one(sent.payload,'from',true);one(sent.payload,'to',true);one(sent.payload,'cc');one(sent.payload,'bcc');
  const subject=one(sent.payload,'subject',true),noticeRfc=one(notice.payload,'message-id',true).trim();
  need(/^<[^<>\s]+@[^<>\s]+>$/.test(noticeRfc)&&noticeRfc!==rfc,'DELIVERY_NOTICE_MESSAGE_ID_REQUIRED');
  const noticeIdentity=gmail.report.nativeSentIdentity(notice,{mailbox:account.email});
  need(noticeIdentity.occurred_at&&Date.parse(noticeIdentity.occurred_at)>=Date.parse(sentIdentity.occurred_at),
    'DELIVERY_NOTICE_PRECEDES_SEND');
  const parsed=gmail.report.parseDeliveryReports(notice,{mailbox:account.email});
  const reports=gmail.report.correlateDeliveryReports({reports:parsed.reports,sentMessages:[sent],mailbox:account.email});
  const selected=[];
  for(const report of reports){
    need(report.complete&&report.valid&&report.native_inbound,'DELIVERY_NOTICE_REPORT_INCOMPLETE');
    // Every supplied original-message identity must refer to this selected send.
    // SMTP envelope IDs remain in their own native parser field.
    need(report.original_message_ids.length&&report.original_message_ids.every(id=>id===rfc),
      'DELIVERY_NOTICE_ORIGINAL_MESSAGE_MISMATCH');
    for(const row of report.recipients){
      // A rewritten Final-Recipient cannot override an explicit different
      // Original-Recipient when binding this one-recipient contact.
      if(row.original_recipient){
        if(row.original_recipient.mailbox?.key!==target)continue;
      }else if(row.final_recipient?.mailbox?.key!==target)continue;
      const match=row.correlation;
      need(['MATCHED_SENT','MATCHED_CASE'].includes(match.state)&&match.candidates.length===1&&
        match.candidates[0].provider_id===sentId&&match.candidates[0].original_message_ids.includes(rfc),
        'DELIVERY_NOTICE_RECIPIENT_MISMATCH');
      selected.push({report_id:report.id,recipient_id:row.id,action:row.action,state:row.state,
        terminal:row.terminal,status:row.status,diagnostic:row.diagnostic,
        final_recipient:clone(row.final_recipient),original_recipient:clone(row.original_recipient),
        last_attempt_at:row.last_attempt?.utc??null,failure_kind:null,failure_scope:row.action==='failed'?'delivery':null});
    }
  }
  let failure=null;
  if(!reports.length&&typeof gmail.googleSendingLimitFailure==='function'){
    const original=gmail.normalized.normalizeMessages([sent],{mailbox:account.email})[0];
    const returned=gmail.normalized.normalizeMessages([notice],{mailbox:account.email})[0];
    failure=gmail.googleSendingLimitFailure(returned,original,target);
    if(failure)selected.push({report_id:noticeId,recipient_id:target,action:'failed',state:'FAILED',terminal:true,status:'',
      diagnostic:{raw:failure.diagnostic,type:'gmail-sending-limit',value:failure.diagnostic},final_recipient:null,original_recipient:null,last_attempt_at:null,
      failure_kind:'GMAIL_SENDING_LIMIT',failure_scope:'account',evidence:clone(failure)});
  }
  need(selected.length,'DELIVERY_NOTICE_RECIPIENT_MISMATCH');
  need(typeof recordedAt==='string'&&Number.isFinite(Date.parse(recordedAt))&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(recordedAt),
    'DELIVERY_NOTICE_RECORDED_TIME_REQUIRED');
  const source={sent:clone(sent),notice:clone(notice)};
  const record={schema:VERSION,id:noticeId,mailbox:account,
    original:{message_id:sentId,thread_id:identityId(sentIdentity.thread_id),rfc_message_id:rfc,recipient:target,
      subject,sent_at:sentIdentity.occurred_at},
    notice:{message_id:noticeId,thread_id:identityId(noticeIdentity.thread_id),rfc_message_id:noticeRfc,
      received_at:noticeIdentity.occurred_at},
    reports:clone(reports),outcomes:selected,source,source_sha256:digest(source),
    content_sha256:digest({sent:contentIdentity(sent),notice:contentIdentity(notice)}),
    recorded_at:new Date(recordedAt).toISOString()};
  return {...record,sha256:digest(record)};
}
function validateDeliveryNotice(record){
  need(plain(record)&&record.schema===VERSION,'DELIVERY_NOTICE_RECORD_REQUIRED');
  const expected=readDeliveryNotice({sent:record.source?.sent,notice:record.source?.notice,
    mailbox:record.mailbox,recipient:record.original?.recipient,recordedAt:record.recorded_at});
  need(canonical(expected)===canonical(record),'DELIVERY_NOTICE_RECORD_CHANGED');return record;
}
function sameOriginal(left,right){
  return canonical(left.original)===canonical(right.original)&&canonical(left.mailbox)===canonical(right.mailbox);
}
function appendDeliveryNotice(records,record){
  need(Array.isArray(records),'DELIVERY_NOTICE_HISTORY_REQUIRED');validateDeliveryNotice(record);
  records.forEach(validateDeliveryNotice);
  need(records.every(row=>sameOriginal(row,record)),'DELIVERY_NOTICE_HISTORY_IDENTITY_CHANGED');
  const prior=records.find(row=>row.id===record.id);
  if(prior){
    need(prior.content_sha256===record.content_sha256,'DELIVERY_NOTICE_PROVIDER_SOURCE_CHANGED');
    return {records:clone(records),record:clone(prior),replayed:true};
  }
  return {records:[...clone(records),clone(record)],record:clone(record),replayed:false};
}
function deliveryState(records=[]){
  need(Array.isArray(records),'DELIVERY_NOTICE_HISTORY_REQUIRED');records.forEach(validateDeliveryNotice);
  if(!records.length)return {schema:STATE,status:'SENT',notice_count:0,current:null,contact_repair:{required:false}};
  need(records.every(row=>sameOriginal(row,records[0])),'DELIVERY_NOTICE_HISTORY_IDENTITY_CHANGED');
  need(new Set(records.map(row=>row.id)).size===records.length,'DELIVERY_NOTICE_HISTORY_ID_REPEATED');
  const ordered=[...records].sort((a,b)=>Date.parse(a.notice.received_at)-Date.parse(b.notice.received_at)||a.id.localeCompare(b.id));
  const entries=ordered.flatMap(notice=>notice.outcomes.map(outcome=>({notice,outcome})));
  const failures=entries.filter(row=>row.outcome.action==='failed');
  let selected=entries.at(-1),status;
  if(failures.length){
    selected=failures.at(-1);
    const laterSuccess=entries.some(row=>['delivered','relayed','expanded'].includes(row.outcome.action)&&
      Date.parse(row.notice.notice.received_at)>=Date.parse(selected.notice.notice.received_at));
    status=laterSuccess?'DELIVERY_REVIEW_REQUIRED':selected.outcome.failure_scope==='account'?'ACCOUNT_DELIVERY_FAILED':'DELIVERY_FAILED';
  }else{
    const actions=new Set(entries.filter(row=>row.notice.notice.received_at===selected.notice.notice.received_at).map(row=>row.outcome.action));
    status=actions.size>1?'DELIVERY_REVIEW_REQUIRED':
      ({delayed:'DELIVERY_DELAYED',delivered:'DELIVERED_REPORTED',relayed:'RELAYED_REPORTED',expanded:'EXPANDED_REPORTED'})[selected.outcome.action];
  }
  const addressFailure=failures.some(row=>row.outcome.failure_scope!=='account'&&/^5\.1\.[123]$/.test(row.outcome.status));
  const deliveryFailure=failures.some(row=>row.outcome.failure_scope!=='account');
  return {schema:STATE,status,notice_count:records.length,original:clone(records[0].original),
    current:{notice_id:selected.notice.id,received_at:selected.notice.notice.received_at,...clone(selected.outcome)},
    contact_repair:{required:addressFailure,recipient:records[0].original.recipient,
      reason:addressFailure?'RECIPIENT_ADDRESS_FAILED':null},
    delivery_review_required:deliveryFailure&&!addressFailure||status==='DELIVERY_REVIEW_REQUIRED',
    account_recovery_required:failures.some(row=>row.outcome.failure_scope==='account'),
    history:ordered.map(row=>({id:row.id,received_at:row.notice.received_at,sha256:row.sha256}))};
}
module.exports={VERSION,STATE,canonical,digest,readDeliveryNotice,validateDeliveryNotice,appendDeliveryNotice,deliveryState};
