'use strict';

/**
 * Shared native Gmail normalization. Hosts provide byte/hash/MIME primitives;
 * no filesystem, process, conversion ledger or provider action is imported.
 * The original native source identities and classification logic live here.
 */
function createGmailNativeMessages({
  createHash, Buffer, rawGmail, googleGroupsFailure, parseDeliveryReports,
  TextDecoder = globalThis.TextDecoder, URL = globalThis.URL,
}) {
const {rawMessageIndex, needsGmailRawMessage, bindGmailRawMessage, withGmailRawMessages} = rawGmail;

function requireValue(ok, why) { if (!ok) throw new Error(`Gmail evidence: ${why}`); }
function obj(v, label) { requireValue(v && typeof v === 'object' && !Array.isArray(v), `${label} must be an object`); return v; }
function time(v) {
  requireValue(typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(v), 'timestamps need explicit UTC offsets');
  const ms = Date.parse(v);
  requireValue(Number.isFinite(ms), 'invalid timestamp');
  return ms;
}
function observedTime(raw, batchUtc) {
  requireValue(typeof raw === 'string', 'message missing Gmail provider timestamp');
  // This connector's batch_read_email returns UTC clock text without a suffix;
  // search_emails returns the same provider instant with an explicit offset.
  // Never interpret a bare timestamp from an arbitrary imported array.
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(raw)) {
    requireValue(batchUtc, 'ambiguous timestamp outside original Gmail batch export');
    return raw + 'Z';
  }
  time(raw);
  return raw;
}
function address(x) {
  const raw = String(x ?? '').toLowerCase();
  const found = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  return found?.[0] ?? null;
}
function exportBody(raw) {
  for (let depth=0; depth<5 && !Array.isArray(raw); depth++) {
    if (raw?.structuredContent) raw=raw.structuredContent;
    else if (raw?.result) raw=raw.result;
    else break;
  }
  return raw;
}
function messageArray(raw) {
  const source=exportBody(raw);
  const list = Array.isArray(source) ? source : (source?.responses ?? source?.emails ?? source?.messages ?? (source?.id ? [source] : null));
  requireValue(Array.isArray(list), 'expected an original Gmail batch, thread, message or search export');
  return list;
}
function headers(part, name) {
  return (part?.headers ?? []).filter(h=>String(h?.name).toLowerCase()===name).map(h=>String(h.value??''));
}
function messageIds(value) { return [...new Set(String(value??'').match(/<[^<>\s]+@[^<>\s]+>/g)||[])]; }
function addresses(value) { return [...new Set(String(value??'').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g)||[])]; }
function mimeText(part) {
  if (typeof part?.body?.content==='string') return part.body.content;
  const encoded=part?.body?.base64_url_content ?? part?.body?.data;
  if (encoded===undefined || encoded===null || encoded==='') return '';
  requireValue(typeof encoded==='string' && /^[A-Za-z0-9_-]*={0,2}$/.test(encoded), 'invalid native MIME body encoding');
  const bytes=Buffer.from(encoded,'base64url');
  requireValue(bytes.toString('base64url')===encoded.replace(/=+$/,''), 'noncanonical native MIME body encoding');
  const type=headers(part,'content-type').join(';');
  const charset=/charset\s*=\s*["']?([^\s;"']+)/i.exec(type)?.[1]||'utf-8';
  try { return new TextDecoder(charset,{fatal:true}).decode(bytes); }
  catch { throw new Error('Gmail evidence: native MIME text cannot be decoded with its recorded charset'); }
}
// Review HTML as literal text. Its exact original source remains available beside
// the projection; no browser markup, remote image or script is ever evaluated.
function htmlReviewText(value) {
  const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',hellip:'…',bull:'•'};
  return value.replace(/<!--[\s\S]*?-->/g,'')
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
    .replace(/<(?:br|hr)\b[^>]*>/gi,'\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote|section|article|table)>/gi,'\n')
    .replace(/<[^>]*>/g,'')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(whole,key)=>{
      if(key[0]!=='#')return entities[key.toLowerCase()]??whole;
      const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
      return n>0 && n<=0x10ffff && !(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):whole;
    }).replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function mimeDetails(payload) {
  const plain=[], html=[], bodySources=[], delivery=[], returned=[], state={parts:0,plainParts:0,completePlain:true,htmlParts:0,completeHtml:true};
  function walk(part, context='', depth=0) {
    requireValue(part && typeof part==='object' && depth<32 && ++state.parts<=5000, 'invalid or excessive MIME nesting');
    const type=String(part.mime_type??part.mimeType??'').toLowerCase();
    const mode=context==='returned' || type==='message/rfc822' || type==='message/global' ? 'returned' : type==='message/delivery-status' ? 'delivery' : context;
    if (mode==='returned') returned.push(...messageIds(headers(part,'message-id').join(' ')));
    if ((!part.filename || type==='message/delivery-status' || type==='text/rfc822-headers') && (type==='text/plain' || type==='text/html' || type==='message/delivery-status' || type==='text/rfc822-headers')) {
      const content=mimeText(part);
      if (mode==='delivery') delivery.push(content);
      else if (mode!=='returned') {
        if(type==='text/html')html.push(content);else plain.push(content);
        if (type==='text/plain') {
          state.plainParts++;
          state.completePlain &&= completePlainPart(part,content);
        }
        if (type==='text/html') {state.htmlParts++;state.completeHtml &&= completePlainPart(part,content);}
        if (type==='text/plain'||type==='text/html')bodySources.push({mime_type:type,sha256:sourceHash(content),
          bytes:Buffer.byteLength(content,'utf8'),complete:completePlainPart(part,content)});
      }
      if (type==='text/rfc822-headers') returned.push(...messageIds(/^message-id:\s*(.*)$/gim.exec(content)?.[1]));
    }
    for (const child of part.parts??[]) walk(child,mode,depth+1);
  }
  walk(payload);
  const statuses=[];
  for (const block of delivery.join('\n').replace(/\r\n/g,'\n').replace(/\n[ \t]+/g,' ').split(/\n\s*\n/)) {
    const fields=new Map();
    for (const row of block.split('\n')) {
      const split=row.indexOf(':');if(split>0)fields.set(row.slice(0,split).trim().toLowerCase(),row.slice(split+1).trim());
    }
    const recipient=address(fields.get('final-recipient')?.split(';').slice(1).join(';'));
    if (recipient) statuses.push({recipient,action:String(fields.get('action')||'').toLowerCase(),
      status:String(fields.get('status')||''),diagnostic:String(fields.get('diagnostic-code')||'').slice(0,2000)});
  }
  const useHtml=state.htmlParts>0 && (state.plainParts===0 ||
    (state.completeHtml && (!state.completePlain || !plain.join('').trim())));
  return {body:useHtml?html.map(htmlReviewText).join('\n\n'):plain.join('\n\n'),body_complete:!useHtml && state.plainParts>0 && state.completePlain,
    body_format:useHtml?'HTML_AS_TEXT':state.plainParts?'PLAIN_TEXT':'NONE',
    content_complete:useHtml?state.completeHtml:state.plainParts>0 && state.completePlain,
    original_html:useHtml?html.join('\n\n'):'',body_sources:bodySources,
    delivery_status:statuses,returned_message_ids:[...new Set(returned)]};
}

function completePlainPart(part,content) {
  const body=part.body??{}, encoded=body.base64_url_content??body.data;
  if (!Number.isSafeInteger(body.size) || body.size<0) return false;
  if (typeof encoded==='string' && encoded) {
    if (!/^[A-Za-z0-9_-]*={0,2}$/.test(encoded)) return false;
    const bytes=Buffer.from(encoded,'base64url');
    return bytes.toString('base64url')===encoded.replace(/=+$/,'') && bytes.length===body.size &&
      mimeText({...part,body:{...body,content:undefined}})===content;
  }
  const charset=/charset\s*=\s*["']?([^\s;"']+)/i.exec(headers(part,'content-type').join(';'))?.[1]??'utf-8';
  return typeof body.content==='string' && /^(utf-8|utf8|us-ascii|ascii)$/i.test(charset) &&
    Buffer.byteLength(content,'utf8')===body.size;
}

const campaignVersion='gmail.account-campaign-review.v1';
const sourceHash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value),'utf8').digest('hex');
const nativeReviewVersion='gmail.native-message-review.v1';
function nativeMessageReview(native,message) {
  const names=['from','to','cc','bcc','delivered-to','x-original-to','subject','message-id','in-reply-to','references',
    'auto-submitted','x-pylon-auto-submitted','x-mailer','list-id','list-unsubscribe','precedence'];
  const originalHeaders=names.flatMap(name=>headers(native.payload,name).map(value=>({name,value})));
  const bounded=originalHeaders.length<=128 && originalHeaders.every(row=>row.value.length<=8192);
  const recipients=['to','cc','delivered-to','x-original-to'].flatMap(name=>headers(native.payload,name).flatMap(addresses));
  const identified=Boolean(message.mailbox&&message.rfc_message_id&&message.thread_id);
  const complete=message.content_complete===true && Boolean(message.body.trim());
  const addressed=identified && recipients.includes(message.mailbox.toLowerCase()) &&
    address(message.from)!==message.mailbox.toLowerCase();
  const incoming=addressed && !message.labels.some(label=>['SENT','DRAFT'].includes(label));
  const classified=kind(message);
  const transport=originalHeaders.filter(row=>['auto-submitted','x-pylon-auto-submitted'].includes(row.name))
    .some(row=>row.value.trim() && row.value.trim().toLowerCase()!=='no');
  const reasons=[];
  if(!identified)reasons.push('NATIVE_MAILBOX_MESSAGE_AND_THREAD_REQUIRED');
  if(!complete)reasons.push('COMPLETE_NATIVE_BODY_REQUIRED');
  if(!bounded)reasons.push('NATIVE_REVIEW_HEADERS_EXCESSIVE');
  if(!incoming)reasons.push('ORIGINAL_INBOUND_ACCOUNT_REQUIRED');
  if(['DELIVERY_FAILURE','DELIVERY_STATUS'].includes(classified))reasons.push('ORIGINAL_DELIVERY_STATUS');
  const identity={version:nativeReviewVersion,id:message.id,mailbox:message.mailbox,email_ts:message.email_ts,
    thread_id:message.thread_id,headers:originalHeaders,body_sources:message.body_sources,
    ...(message.source_format==='GMAIL_NATIVE_MIME_RAW_DELIVERY' ? {
      raw_source:{bytes:message.raw_mime_source.bytes,sha256:message.raw_mime_source.sha256},
      delivery_status_sources:message.delivery_status_sources} : {})};
  return {version:nativeReviewVersion,source_sha256:sourceHash(identity),body_sha256:sourceHash(message.body),
    body_sources:message.body_sources,body_format:message.body_format,body_complete:complete,
    headers:bounded?originalHeaders:[],labels:[...message.labels],classified_as:classified,
    inbound_eligible:incoming&&complete&&bounded,
    human_transport_eligible:reasons.length===0&&transport&&classified==='AUTOMATED_REPLY',
    reason_codes:reasons,
    ...(message.raw_mime_source ? {raw_mime_source:message.raw_mime_source,
      delivery_status_sources:message.delivery_status_sources} : {})};
}
function nativeMessageEvidence(message) {
  const r=message.native_review;
  return {version:r.version,source_sha256:r.source_sha256,body_sha256:r.body_sha256,body_sources:r.body_sources,
    body_format:r.body_format,body_complete:r.body_complete,labels:r.labels,headers:r.headers,classified_as:r.classified_as,
    ...(r.raw_mime_source ? {raw_mime_source:r.raw_mime_source,delivery_status_sources:r.delivery_status_sources} : {})};
}
function nativeCampaignReview(native,message) {
  const names=['list-id','list-unsubscribe','list-unsubscribe-post','precedence','x-mailer'];
  const distribution=names.flatMap(name=>headers(native.payload,name).filter(value=>value.trim()).map(value=>({name,value})));
  const references=['in-reply-to','references'].flatMap(name=>headers(native.payload,name).filter(value=>value.trim()));
  const bounded=distribution.length<=24 && distribution.every(row=>row.value.length<=8192);
  const marker=distribution.some(row=>['list-id','list-unsubscribe'].includes(row.name) ||
    (row.name==='precedence' && /^(bulk|list)$/i.test(row.value.trim())));
  const complete=message.body_complete===true && Boolean(message.body.trim());
  const reasons=[];
  if (!complete) reasons.push('COMPLETE_NATIVE_PLAIN_BODY_REQUIRED');
  if (!marker || !bounded) reasons.push('NATIVE_DISTRIBUTION_HEADER_REQUIRED');
  if (references.length) reasons.push('ORIGINAL_REPLY_REFERENCES_PRESENT');
  if (!message.mailbox || !message.rfc_message_id) reasons.push('NATIVE_MAILBOX_AND_MESSAGE_ID_REQUIRED');
  const bodyHash=sourceHash(message.body);
  // Labels may change after a read; the original message content and mailbox do not.
  const identity={version:campaignVersion,id:message.id,mailbox:message.mailbox,email_ts:message.email_ts,
    thread_id:message.thread_id,from:message.from,to:message.to,subject:message.subject,
    rfc_message_id:message.rfc_message_id,body_sha256:bodyHash,distribution_headers:distribution,
    reply_reference_headers:references};
  return {version:campaignVersion,eligible:reasons.length===0,source_sha256:sourceHash(identity),body_sha256:bodyHash,
    body_complete:complete,distribution_headers:bounded?distribution:[],has_reply_references:references.length>0,reason_codes:reasons};
}

function campaignEvidence(message) {
  const source=message.campaign_review;
  return {version:source.version,body_sha256:source.body_sha256,
    distribution_header_names:[...new Set(source.distribution_headers.map(row=>row.name))],
    has_reply_references:source.has_reply_references};
}

/** Normalize the CURRENT native Gmail MIME response and the original flat export. */
function normalizeMessages(raw,{mailbox,rawMessages}={}) {
  const source=exportBody(withGmailRawMessages(raw,rawMessages)), account=mailbox??source?.mailbox??'';
  const originals=messageArray(source), rawIndex=rawMessageIndex(source?.raw_messages);
  const ids=new Set(originals.map(message=>message?.id));
  requireValue([...rawIndex.keys()].every(id=>ids.has(id)), 'RAW export contains a message absent from the FULL export');
  if (account) requireValue(address(account)===account.toLowerCase() && account===account.trim(), 'mailbox must be the exact account used for this export');
  const batchUtc=Boolean(source?.responses);
  return originals.map(value=>{
    const original=obj(value,'message');
    const rawPair=rawIndex.has(original.id) ? bindGmailRawMessage(original,rawIndex.get(original.id),{mailbox:account}) : null;
    const rawDelivery=Boolean(rawPair && needsGmailRawMessage(original));
    // Ordinary SENT/human FULL source identities remain unchanged when a
    // caller also supplies their RAW bytes. Only delivery notices need the
    // RAW MIME tree to recover a missing message/delivery-status part.
    const m=rawDelivery ? rawPair.message : original;
    if (!m.payload) {
      // Reuse the existing public pipeline's normalized full captures as well
      // as the original flat connector export. Preserve account/RFC identity.
      const capturedMailbox=m.mailbox??m.accountEmail??null;
      requireValue(!account || !capturedMailbox || account.toLowerCase()===capturedMailbox.toLowerCase(), 'capture belongs to a different mailbox');
      const rfcId=m.rfc_message_id??m.rfcMessageId??null;
      requireValue(!rfcId || messageIds(rfcId).length===1, 'flat capture has an ambiguous Message-ID');
      return {...m,from:m.from??m.from_,email_ts:observedTime(m.email_ts,batchUtc),
        mailbox:capturedMailbox||account||null,rfc_message_id:rfcId,
        auto_submitted:m.auto_submitted??String(m.autoSubmitted??'').trim().toLowerCase(),
        campaign_review:{version:campaignVersion,eligible:false,source_sha256:null,body_sha256:null,
          body_complete:false,distribution_headers:[],has_reply_references:false,reason_codes:['ORIGINAL_NATIVE_MIME_REQUIRED']},
        native_review:{version:nativeReviewVersion,source_sha256:null,inbound_eligible:false,human_transport_eligible:false,
          reason_codes:['ORIGINAL_NATIVE_MIME_REQUIRED']},
        source_format:m.source_format||(m.detail?'GMAIL_NORMALIZED_CAPTURE':'GMAIL_FLAT_EXPORT')};
    }
    const milliseconds=String(m.internal_date??m.internalDate??'');
    requireValue(/^\d{1,16}$/.test(milliseconds) && Number.isSafeInteger(Number(milliseconds)) &&
      Number(milliseconds)>=0 && Number(milliseconds)<=8640000000000000, 'native message needs original internal_date epoch milliseconds');
    const labels=m.label_ids??m.labelIds;
    requireValue(Array.isArray(labels) && labels.every(x=>typeof x==='string'), 'native message needs original label_ids');
    requireValue(account || m.display_url, 'enter the mailbox used for this native export so original message links open the correct account');
    const details=googleGroupsFailure(m.payload,mimeDetails(m.payload));
    const rfcIds=messageIds(headers(m.payload,'message-id').join(' '));
    requireValue(rfcIds.length<=1,'native message contains ambiguous Message-ID headers');
    const normalized={id:m.id,thread_id:m.thread_id??m.threadId??null,labels:[...labels],
      email_ts:new Date(Number(milliseconds)).toISOString(),
      from:headers(m.payload,'from').join(', '),to:headers(m.payload,'to'),
      subject:headers(m.payload,'subject').join(' '),snippet:String(m.snippet??''),
      ...details,body:details.body||String(m.snippet??''),
      display_url:m.display_url||'https://mail.google.com/mail/u/?authuser='+encodeURIComponent(account)+'#all/'+encodeURIComponent(m.id),
      mailbox:account||null,source_format:'GMAIL_NATIVE_MIME',rfc_message_id:rfcIds[0]??null,
      in_reply_to:messageIds(headers(m.payload,'in-reply-to').join(' ')),
      auto_submitted:headers(m.payload,'auto-submitted').join(' ').trim().toLowerCase(),
      ...(rawPair ? {raw_mime_source:rawPair.source,delivery_status_sources:rawPair.delivery_sources,
        raw_mime_base64:rawPair.raw.raw} : {}),
      ...(rawDelivery ? {source_format:'GMAIL_NATIVE_MIME_RAW_DELIVERY'} : {})};
    const machine=parseDeliveryReports(m,{mailbox:account});
    normalized.delivery_report_like=machine.report_like;
    normalized.delivery_report_summary={reports:machine.reports.length,
      recipients:machine.reports.reduce((sum,report)=>sum+report.recipients.length,0),
      complete:machine.reports.length>0&&machine.reports.every(report=>report.complete&&report.valid),
      missing_machine_part:machine.missing_machine_part};
    if(machine.reports.length)normalized.delivery_status=machine.reports.flatMap(report=>
      report.recipients.map(row=>({recipient:row.original_recipient?.mailbox?.key??row.final_recipient?.mailbox?.key??'',
        action:row.action,status:row.status,diagnostic:row.diagnostic?.value??'',
        report_id:report.id,recipient_id:row.id,valid:row.valid&&report.valid&&report.complete})));
    normalized.campaign_review=nativeCampaignReview(m,normalized);
    normalized.native_review=nativeMessageReview(m,normalized);
    return normalized;
  });
}
function kind(message) {
  const s = String(message.subject ?? '').trim();
  const sender = String(message.from ?? message.from_ ?? '').toLowerCase();
  const preview = String(message.body ?? message.snippet ?? '').slice(0, 600).toLowerCase();
  if (message.delivery_report_like || message.delivery_status?.length) {
    return message.delivery_status?.some(row=>row.action==='failed'&&row.valid!==false) ? 'DELIVERY_FAILURE' : 'DELIVERY_STATUS';
  }
  if (message.delivery_status?.some(row=>row.action==='failed') || /\b(mailer-daemon|postmaster)@/.test(sender) || /^(delivery status notification|undeliverable|mail delivery failed|failure notice|delivery failure|returned mail)\b/i.test(s)) return 'DELIVERY_FAILURE';
  if ((message.auto_submitted && message.auto_submitted!=='no') || /^(auto(?:matic)?[- ]?(?:reply|response)|out of office|away from (?:the )?office|autoreply|automatic notification)\b/i.test(s) ||
      /\b(automatic reply|out.of.office message|this is an automated (?:response|message))\b/i.test(preview) ||
      (/\bno longer (?:works|with|employed|at)\b/i.test(preview) && /\bplease contact\b/i.test(preview))) return 'AUTOMATED_REPLY';
  return 'POSSIBLE_HUMAN';
}
function providerUrl(m) {
  requireValue(typeof m.display_url === 'string', 'missing provider Gmail display_url');
  const u = new URL(m.display_url);
  requireValue(u.protocol === 'https:' && u.hostname === 'mail.google.com' && u.hash.includes(m.id) && !u.username && !u.password, 'provider URL must be authentic Gmail message link');
  return m.display_url;
}
const matchId = /^[a-z0-9][a-z0-9_-]{3,80}$/;
const validRoles = new Set(['CONTACT_SENT', 'HUMAN_REPLY', 'DELIVERY_FAILURE', 'AUTOMATED_REPLY', 'IGNORE']);
const validSignals = new Set(['POSITIVE', 'NEUTRAL', 'NEGATIVE']);
const validSentPurposes = new Set(['INTRODUCTION','PROPOSAL','FOLLOW_UP','DELIVERY','INFORMATION']);
const changedDispositions=new Set(['SENT_ADDED','SENT_RECIPIENT_ENRICHED','SENT_SOURCE_ENRICHED','SENT_CONTEXT_ENRICHED',
  'HUMAN_REPLY_ADDED','HUMAN_SOURCE_ENRICHED','DELIVERY_FAILURE_ADDED','DELIVERY_FAILURE_SOURCE_ENRICHED','AUTOMATED_REPLY_ADDED','AUTOMATED_REDIRECT_ENRICHED','AUTOMATED_CAMPAIGN_ENRICHED']);
function rawDeliveryEvidence(message,binding,outboundRfcId) {
  if (!message.raw_mime_source || !message.delivery_status_sources?.length) return null;
  const delivery=message.delivery_status.find(row=>row.recipient===binding.counterpart && row.action==='failed');
  if (!delivery) return null;
  const source=message.raw_mime_source;
  return {schema:'gmail.delivery-status-source.v1',mailbox:message.mailbox,
    notice_provider_id:message.id,notice_thread_id:message.thread_id,notice_rfc_message_id:message.rfc_message_id,
    notice_internal_date:message.email_ts,raw:{bytes:source.bytes,sha256:source.sha256},
    parts:message.delivery_status_sources,outbound_provider_id:binding.outbound_provider_id,
    outbound_rfc_message_id:outboundRfcId,
    failed_recipient:binding.counterpart,action:delivery.action,status:delivery.status,
    diagnostic:delivery.diagnostic};
}

return {requireValue, obj, time, address, addresses, sourceHash, nativeReviewVersion, nativeMessageEvidence, campaignEvidence, normalizeMessages, kind, providerUrl, matchId, validRoles, validSignals, validSentPurposes, changedDispositions, rawDeliveryEvidence, withGmailRawMessages};
}

module.exports = {createGmailNativeMessages};
