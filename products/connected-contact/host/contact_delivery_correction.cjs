'use strict';

/** Shared original-gateway contract for reviewed delivery corrections. */
const crypto = require('node:crypto');
const VERSION = 'commons.contact-delivery-correction/v1';
const CLAIM_VERSION = 'commons.delivery-correction-claim/v1';
const sha = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key)+':'+canonical(value[key])).join(',') + '}';
  throw new TypeError('Delivery correction contains a non-JSON value');
}
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const printable = (value, maximum=4096) => typeof value === 'string' && value.trim() && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);
const address = value => printable(value,254) && /^[^\s<>@]+@[^\s<>@]+$/.test(value) && value === value.trim().toLowerCase();
const instant = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
// The connected V8 carrier has no URL constructor. Accept ordinary credential-free
// HTTPS source URLs in both runtimes; provider-specific file validation remains in
// the original Drive adapter.
const href = value => {
  if (typeof value !== 'string' || value.length>8192 || /[\x00-\x20\x7f\\]/.test(value)) return false;
  const match=/^https:\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?(?:[/?#][^\s]*)?$/i.exec(value);
  return Boolean(match && match[1].split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) &&
    (match[2]===undefined || Number(match[2])<=65535));
};
function fail(code) { throw Object.assign(new Error(code), {code}); }
function deliveryCorrectionDigest(proof) { return sha(canonical(proof)); }
function deliveryPayloadDigest(input) {
  return sha(canonical({to:input.to,subject:input.subject,body:input.body,body_type:input.body_type ?? 'text/plain',
    link_id:input.link_id,prospect_org:input.prospect_org,opportunity_id:input.opportunity_id,touchpoint:input.touchpoint,
    attachments:input.attachments ?? [],source_links:input.source_links ?? []}));
}
function reviewAttempt(a) {
  return object(a) && printable(a.outbound_event_id,160) && printable(a.outbound_provider_id,128) &&
    address(a.mailbox) && address(a.recipient_email) && instant(a.sent_at) && href(a.sent_url) &&
    digest(a.outbound_source_sha256) && printable(a.failure_event_id,160) && printable(a.failure_provider_id,128) &&
    instant(a.failed_at) && Date.parse(a.failed_at)>=Date.parse(a.sent_at) && href(a.failure_url) &&
    digest(a.failure_source_sha256) && printable(a.reviewed_by,120) && instant(a.reviewed_at) &&
    Date.parse(a.reviewed_at)>=Date.parse(a.failed_at);
}
function policyAttempt(a) {
  return reviewAttempt(a) && a.delivery_failure_kind==='GMAIL_ATTACHMENT_POLICY' &&
    a.delivery_failure_evidence?.version==='gmail.attachment-policy-failure.v1' &&
    a.delivery_failure_evidence.notice_source_sha256===a.failure_source_sha256 &&
    a.delivery_failure_evidence.outbound_source_sha256===a.outbound_source_sha256 &&
    a.delivery_diagnostic==='For security reasons, Gmail does not allow you to use this type of file as it violates Google policy for executables and archives.';
}
/** Read the original parser's exact member manifest without reopening historical bytes. */
function readContactDocumentArchives(input, {required=false}={}) {
  const files=input?.attachments ?? [];
  if (!Array.isArray(files)) fail('CONTACT_DOCUMENT_ARCHIVE_REVIEW_REQUIRED');
  const ordinary=input?.document_archives, correction=input?.delivery_correction?.document_archives;
  if (ordinary != null && correction != null && canonical(ordinary)!==canonical(correction))
    fail('CONTACT_DOCUMENT_ARCHIVE_CHANGED');
  const saved=ordinary ?? correction;
  if (saved == null && !required) return null;
  const archives=saved ?? [], zipped=files.filter(f=>/\.zip$/i.test(f?.filename ?? ''));
  if (!Array.isArray(archives) || archives.length!==zipped.length)
    fail('CONTACT_DOCUMENT_ARCHIVE_REVIEW_REQUIRED');
  for (const f of files) {
    if (/\.zip$/i.test(f?.filename ?? '') !== (f?.mime_type==='application/zip'))
      fail('CONTACT_DOCUMENT_ARCHIVE_REVIEW_REQUIRED');
    if (!/\.zip$/i.test(f?.filename ?? '')) continue;
    if (!printable(f.filename,240) || !Number.isSafeInteger(f.bytes) ||
        f.bytes<1 || f.bytes>8*1024*1024 || !digest(f.sha256))
      fail('CONTACT_DOCUMENT_ARCHIVE_REVIEW_REQUIRED');
    const matched=archives.filter(a=>a?.filename===f.filename && a.sha256===f.sha256 && a.bytes===f.bytes);
    if (matched.length!==1) fail('CONTACT_DOCUMENT_ARCHIVE_REVIEW_REQUIRED');
    const a=matched[0],seenEntries=new Set();let total=0;
    if (a.version!=='commons.contact-document-archive/v1' || !Array.isArray(a.entries) ||
        a.entries.length<1 || a.entries.length>100) fail('CONTACT_DOCUMENT_ARCHIVE_REVIEW_REQUIRED');
    for (const entry of a.entries) {
      if (!printable(entry.path,500) || !/^[a-z0-9 _()./-]+$/i.test(entry.path) ||
          entry.path.split('/').some(part=>!part || part==='.' || part==='..') ||
          !/\.(pdf|txt|md|csv|json|html|htm|cjs|mjs)$/i.test(entry.path) ||
          [...seenEntries].some(path=>path===entry.path.toLowerCase() || path.startsWith(entry.path.toLowerCase()+'/') || entry.path.toLowerCase().startsWith(path+'/')) || !Number.isSafeInteger(entry.bytes) ||
          entry.bytes<0 || entry.bytes>16*1024*1024 || !digest(entry.sha256))
        fail('CONTACT_DOCUMENT_ARCHIVE_REVIEW_REQUIRED');
      seenEntries.add(entry.path.toLowerCase());total+=entry.bytes;
    }
    if (total>32*1024*1024 || total!==a.expanded_bytes) fail('CONTACT_DOCUMENT_ARCHIVE_REVIEW_REQUIRED');
  }
  return archives;
}
function contactDocumentArchivesDigest(archives) { return sha(canonical(archives)); }
/** Join an actual original-parser inspection to the same frozen attachment identities. */
function assertContactDocumentArchives(input, inspected) {
  if (!Array.isArray(inspected)) fail('CONTACT_DOCUMENT_ARCHIVE_REVIEW_REQUIRED');
  const declared=readContactDocumentArchives(input);
  const actual=readContactDocumentArchives({...input,document_archives:inspected},{required:true});
  if (declared !== null && canonical(declared)!==canonical(actual))
    fail('CONTACT_DOCUMENT_ARCHIVE_CHANGED');
  return actual;
}


const ADMINISTRATOR_MODE = 'ADMINISTRATOR_RECIPIENT_CORRECTION';
function administratorCorrection(proof) { return proof?.mode === ADMINISTRATOR_MODE; }
const PUBLISHED_MODE = 'PUBLISHED_RECIPIENT_CORRECTION';
function publishedRecipientCorrection(proof) { return proof?.mode === PUBLISHED_MODE; }
function sameOfferRecipientCorrection(proof) { return administratorCorrection(proof) || publishedRecipientCorrection(proof); }
function recipientCorrectionSource(proof) {
  return relatedCompanyCorrection(proof) ? proof.original_sources : publishedRecipientCorrection(proof) ? proof.published_source : proof?.administrator_source;
}
function publicationHost(value) {
  if (!href(value)) return null;
  return /^https:\/\/([^/:?#]+)/i.exec(value)[1].toLowerCase().replace(/^www\./, '');
}
function assertPublishedRecipientPublication(input, source) {
  const p=input.delivery_correction, publication=source?.publication;
  const host=publicationHost(p.company_url);
  const companyPage=url=>{
    const selected=publicationHost(url);
    return Boolean(host && selected && (selected===host || selected.endsWith('.'+host)));
  };
  if (!object(publication) || publication.version!=='commons.company-published-recipient/v1' ||
      !companyPage(publication.requested_url) || !companyPage(publication.final_url) ||
      !instant(publication.retrieved_at) || Date.parse(publication.retrieved_at)>Date.parse(p.review.at) ||
      !['original-html','provider-extracted-html-text'].includes(publication.representation) ||
      typeof publication.text!=='string' || !publication.text || publication.text.length>2000000 ||
      !digest(publication.text_sha256) || sha(publication.text)!==publication.text_sha256 ||
      !printable(publication.recipient_name,240) || !printable(publication.contact_text,4096) ||
      !publication.text.includes(publication.contact_text) ||
      !publication.contact_text.toLowerCase().includes(p.recipient) ||
      p.recipient.split('@')[1]!==host)
    fail('CONTACT_RECIPIENT_PUBLISHED_SOURCE_REQUIRED');
  return {version:publication.version,requested_url:publication.requested_url,
    final_url:publication.final_url,retrieved_at:publication.retrieved_at,
    representation:publication.representation,text_sha256:publication.text_sha256,
    recipient_name:publication.recipient_name,contact_text:publication.contact_text};
}
function deliveryOfferDigest(input) {
  return sha(canonical({subject:input.subject,body:input.body,body_type:input.body_type ?? 'text/plain',
    link_id:input.link_id,prospect_org:input.prospect_org,opportunity_id:input.opportunity_id,
    attachments:input.attachments ?? [],source_links:input.source_links ?? []}));
}
// Labels/history are mailbox state. The entire original MIME tree, date and
// message/thread identity are immutable source; retain the native envelopes too.
function deliveryNativeSourceDigest(message) {
  return sha(canonical({id:message.id,thread_id:message.thread_id,
    internal_date:message.internal_date,payload:message.payload}));
}
// Gmail may return a new opaque attachment handle on each FULL read. Keep the
// original envelope hash as evidence, and compare the fresh MIME/content identity
// without those transport locators. The original attachment receiver still checks
// every selected file against FULL/RAW bytes before any outgoing invocation.
function deliveryNativeContentDigest(message) {
  let count=0;
  function payload(part,depth=0) {
    if (!object(part) || depth>12 || ++count>128) fail('CONTACT_RECIPIENT_SOURCE_MIME_INVALID');
    const result={...part};
    if (object(part.body)) {
      result.body={...part.body};
      delete result.body.attachment_id; delete result.body.attachmentId;
    }
    if (part.parts!=null) {
      if (!Array.isArray(part.parts)) fail('CONTACT_RECIPIENT_SOURCE_MIME_INVALID');
      result.parts=part.parts.map(child=>payload(child,depth+1));
    }
    return result;
  }
  return sha(canonical({id:message.id,thread_id:message.thread_id,
    internal_date:message.internal_date,payload:payload(message.payload)}));
}
function sourceHeader(part,name) {
  const values=(part?.headers ?? []).filter(h=>h.name?.toLowerCase()===name).map(h=>h.value);
  if (values.length!==1 || typeof values[0]!=='string') fail('CONTACT_RECIPIENT_SOURCE_HEADER_REQUIRED');
  return values[0];
}
const sourceAddress = value => value.trim().replace(/^.*<([^>]+)>$/, '$1').toLowerCase();
function sourceParts(part) { return [part,...(part?.parts ?? []).flatMap(sourceParts)]; }
function sourceFields(text) {
  if (typeof text!=='string') fail('CONTACT_RECIPIENT_SOURCE_BODY_REQUIRED');
  const fields={};
  for (const line of text.replace(/\r?\n[ \t]+/g,' ').split(/\r?\n/)) {
    const match=/^([^:\s]+):[ \t]*(.*)$/.exec(line); if (!match) continue;
    const key=match[1].toLowerCase();
    if (Object.hasOwn(fields,key)) fail('CONTACT_RECIPIENT_SOURCE_AMBIGUOUS');
    fields[key]=match[2];
  }
  return fields;
}
function originalClaimMatches(spec,record) {
  const last=spec.delivery_correction.failed_attempts.at(-1);
  return record?.protocol==='commons-first-contact-v1' && record.status==='sent' &&
    record.case===spec.opportunity_id && record.provider==='gmail' &&
    record.provider_message_id===last.outbound_provider_id && printable(record.lease,200) &&
    instant(record.sent_verified_at);
}
/** Verify reviewed original provider bytes, never execute a message's instructions. */
function assertRecipientSources(input,sent,notice,{html}={}) {
  const p=input.delivery_correction;
  if (!sameOfferRecipientCorrection(p)) return null;
  const published=publishedRecipientCorrection(p);
  const a=p.failed_attempts.at(-1), source=recipientCorrectionSource(p), original=source?.original_message;
  if (!object(source) || source.version!==(published ? 'commons.published-recipient-source/v1' : 'commons.administrator-recipient-source/v1') ||
      !object(original) || original.to!==a.recipient_email || original.touchpoint!=='first-contact' ||
      !digest(source.offer_sha256) || source.offer_sha256!==deliveryOfferDigest(original) ||
      source.offer_sha256!==deliveryOfferDigest(input) ||
      source.recipient!==p.recipient || p.recipient===a.recipient_email ||
      p.recipient.split('@')[1]!==a.recipient_email.split('@')[1] ||
      source.sent_id!==a.outbound_provider_id || source.failure_id!==a.failure_provider_id ||
      sent?.id!==source.sent_id || notice?.id!==source.failure_id ||
      !digest(source.sent_native_sha256) || !digest(source.failure_native_sha256) ||
      !object(source.sent_native) || !object(source.failure_native) ||
      deliveryNativeSourceDigest(source.sent_native)!==source.sent_native_sha256 ||
      deliveryNativeSourceDigest(source.failure_native)!==source.failure_native_sha256 ||
      deliveryNativeContentDigest(sent)!==deliveryNativeContentDigest(source.sent_native) ||
      deliveryNativeContentDigest(notice)!==deliveryNativeContentDigest(source.failure_native) ||
      !(sent.label_ids ?? []).includes('SENT') ||
      Number(sent.internal_date)!==Date.parse(a.sent_at) ||
      Number(notice.internal_date)!==Date.parse(a.failed_at) ||
      sourceHeader(sent.payload,'message-id')!==source.rfc_message_id ||
      !/^<[^<>\s]+>$/.test(source.rfc_message_id ?? '') ||
      sourceAddress(sourceHeader(sent.payload,'from'))!==p.mailbox ||
      sourceAddress(sourceHeader(sent.payload,'to'))!==a.recipient_email ||
      sourceHeader(sent.payload,'subject')!==input.subject ||
      notice.payload?.mime_type!=='multipart/report' ||
      sourceHeader(notice.payload,'auto-submitted')!=='auto-replied' ||
      sourceAddress(sourceHeader(notice.payload,'to'))!==p.mailbox ||
      sourceHeader(notice.payload,'in-reply-to')!==source.rfc_message_id)
    fail(published ? 'CONTACT_RECIPIENT_PUBLISHED_SOURCE_CHANGED' : 'CONTACT_RECIPIENT_ADMINISTRATOR_SOURCE_CHANGED');
  const reports=sourceParts(notice.payload).filter(part=>part?.mime_type==='message/delivery-status');
  const selected=reports.flatMap(report=>sourceParts(report)).filter(part=>
    typeof part?.body?.content==='string' && /(?:^|\r?\n)Final-Recipient:/i.test(part.body.content));
  if (selected.length!==1) fail('CONTACT_RECIPIENT_SOURCE_AMBIGUOUS');
  const report=selected[0], fields=sourceFields(report.body.content);
  if (fields['final-recipient']?.toLowerCase()!=='rfc822; '+a.recipient_email ||
      fields.action!=='failed' || !/^5\.\d+\.\d+$/.test(fields.status ?? '') ||
      fields.status!==a.delivery_status ||
      sourceHeader(report,'x-original-message-id')!==source.rfc_message_id ||
      fields['diagnostic-code']!==source.diagnostic ||
      (!published && (!printable(source.directive,1000) || source.directive!=='You can contact '+p.recipient+' instead.' ||
        !fields['diagnostic-code'].includes(source.directive))))
    fail(published ? 'CONTACT_RECIPIENT_PUBLISHED_FAILURE_REQUIRED' : 'CONTACT_RECIPIENT_ADMINISTRATOR_DIRECTIVE_REQUIRED');
  const publication=published ? assertPublishedRecipientPublication(input,source) : null;
  const body=sent.payload.mime_type==='multipart/mixed'?sent.payload.parts?.[0]:sent.payload;
  const originalFiles=sent.payload.mime_type==='multipart/mixed'?sent.payload.parts.slice(1):[];
  if (body?.mime_type!=='text/html' || body.filename || body.parts?.length ||
      typeof body.body?.content!=='string' || !digest(source.html_sha256) ||
      sha(body.body.content)!==source.html_sha256 ||
      (html!==undefined && body.body.content!==html) ||
      originalFiles.length!==(input.attachments ?? []).length ||
      originalFiles.some((part,i)=>part.filename!==input.attachments[i].filename ||
        part.mime_type!==input.attachments[i].mime_type || part.body?.size!==input.attachments[i].bytes))
    fail('CONTACT_RECIPIENT_ORIGINAL_OFFER_CHANGED');
  if (!/^[a-f0-9]{40}$/.test(p.original_claim?.sha ?? '') ||
      !originalClaimMatches(input,p.original_claim?.record) ||
      p.original_claim.recipient!==a.recipient_email)
    fail('CONTACT_RECIPIENT_ORIGINAL_CLAIM_REQUIRED');
  return {version:source.version,sent_id:sent.id,failure_id:notice.id,
    sent_native_sha256:source.sent_native_sha256,failure_native_sha256:source.failure_native_sha256,
    original_recipient:a.recipient_email,recipient:p.recipient,rfc_message_id:source.rfc_message_id,
    ...(published ? {publication} : {directive:source.directive}),offer_sha256:source.offer_sha256};
}
function assertAdministratorRecipientSources(input,sent,notice,options={}) {
  return administratorCorrection(input?.delivery_correction) ? assertRecipientSources(input,sent,notice,options) : null;
}


const RELATED_COMPANY_MODE = 'RELATED_COMPANY_RECIPIENT_CORRECTION';
function relatedCompanyCorrection(proof) { return proof?.mode === RELATED_COMPANY_MODE; }
function recipientCorrection(proof) { return sameOfferRecipientCorrection(proof) || relatedCompanyCorrection(proof); }
const sourceHost = value => href(value) ? /^https:\/\/([^/:?#]+)/i.exec(value)[1].toLowerCase().replace(/^www\./,'') : null;
const hostFamily = (value, parent) => Boolean(value && parent && (value===parent || value.endsWith('.'+parent)));
function utf8Bytes(value) {
  let bytes=0;
  for (const ch of value) { const cp=ch.codePointAt(0); bytes+=cp<0x80?1:cp<0x800?2:cp<0x10000?3:4; }
  return bytes;
}
function sourceAnchors(text) {
  return [...text.matchAll(/<a\b[^>]*\shref\s*=\s*(["'])(.*?)\1[^>]*>/gi)].map(match=>match[2]);
}
/**
 * Receive the two complete public originals used for an explicit common-owner
 * routing review. Excerpt offsets are UTF-16 code units, end-exclusive. Text is
 * retained as data; it is never executed or treated as an instruction.
 */
function readRelatedCompanySource(source,{companyUrl,recipient,asOf=new Date().toISOString()}={}) {
  const now=Date.parse(asOf), host=sourceHost(companyUrl), recipientHost=recipient?.split('@')[1];
  if (!object(source) || source.version!=='commons.related-company-contact-source.v1' ||
      !host || !address(recipient) || !Number.isFinite(now) || source.company_url!==companyUrl ||
      source.recipient!==recipient || source.relationship!=='COMMON_OWNER' || source.recipient_role!=='OWNER_ROUTING' ||
      !printable(source.related_company?.name,240) || !href(source.related_company?.homepage) ||
      !hostFamily(sourceHost(source.related_company.homepage),recipientHost) ||
      !printable(source.reviewed_by,120) || !instant(source.reviewed_at) ||
      Date.parse(source.reviewed_at)>now || !printable(source.note,2000) ||
      !Array.isArray(source.sources) || source.sources.length!==2)
    fail('CONTACT_RELATED_COMPANY_SOURCE_REQUIRED');
  const selected={};
  for (const original of source.sources) {
    if (!object(original) || !['company-relationship','related-contact'].includes(original.id) ||
        selected[original.id] || !href(original.url) || !instant(original.retrieved_at) ||
        Date.parse(original.retrieved_at)>Date.parse(source.reviewed_at) ||
        !/^text\/html(?:\s*;|$)|^application\/xhtml\+xml(?:\s*;|$)/i.test(original.content_type ?? '') ||
        typeof original.content!=='string' || !original.content ||
        !Number.isSafeInteger(original.bytes) || original.bytes!==utf8Bytes(original.content) ||
        !digest(original.sha256) || sha(original.content)!==original.sha256 ||
        !Array.isArray(original.excerpts))
      fail('CONTACT_RELATED_COMPANY_ORIGINAL_CHANGED');
    const excerpts={};
    for (const excerpt of original.excerpts) {
      if (!object(excerpt) || !['COMMON_OWNER','PUBLISHED_RECIPIENT','COMPANY_BACKLINK'].includes(excerpt.purpose) ||
          excerpts[excerpt.purpose] || !Number.isSafeInteger(excerpt.start) || !Number.isSafeInteger(excerpt.end) ||
          excerpt.start<0 || excerpt.end<=excerpt.start || excerpt.end>original.content.length ||
          typeof excerpt.text!=='string' || original.content.slice(excerpt.start,excerpt.end)!==excerpt.text)
        fail('CONTACT_RELATED_COMPANY_EXCERPT_CHANGED');
      excerpts[excerpt.purpose]=excerpt.text;
    }
    if (original.id==='company-relationship') {
      if (original.kind!=='COMPANY_RELATIONSHIP' || !hostFamily(sourceHost(original.url),host) ||
          original.excerpts.length!==1 || !excerpts.COMMON_OWNER ||
          !excerpts.COMMON_OWNER.toLowerCase().includes(source.related_company.name.toLowerCase()))
        fail('CONTACT_RELATED_COMPANY_RELATIONSHIP_REQUIRED');
    } else {
      if (original.kind!=='RELATED_CONTACT' ||
          !hostFamily(sourceHost(original.url),recipientHost) ||
          original.excerpts.length!==2 ||
          !sourceAnchors(excerpts.PUBLISHED_RECIPIENT ?? '').some(link=>
            link.toLowerCase().split('?')[0]==='mailto:'+recipient) ||
          !sourceAnchors(excerpts.COMPANY_BACKLINK ?? '').some(link=>hostFamily(sourceHost(link),host)))
        fail('CONTACT_RELATED_COMPANY_CONTACT_REQUIRED');
    }
    selected[original.id]=original;
  }
  if (!selected['company-relationship'] || !selected['related-contact'])
    fail('CONTACT_RELATED_COMPANY_SOURCE_REQUIRED');
  return JSON.parse(JSON.stringify(source));
}
/** Refresh original native send/failure identity before the reviewed routing send. */
function assertRelatedCompanyRecipientSources(input,sent,notice,{originalHtml}={}) {
  const p=input.delivery_correction;
  if (!relatedCompanyCorrection(p)) return null;
  const a=p.failed_attempts.at(-1), source=p.original_sources, original=source?.original_message;
  readRelatedCompanySource(p.related_company_source,{companyUrl:p.company_url,recipient:p.recipient,asOf:p.review.at});
  if (!object(source) || source.version!=='commons.related-recipient-original-sources/v1' ||
      !object(original) || original.to!==a.recipient_email || !printable(original.touchpoint,200) ||
      original.opportunity_id!==input.opportunity_id || original.prospect_org!==input.prospect_org ||
      original.link_id!==input.link_id || p.recipient===a.recipient_email ||
      source.sent_id!==a.outbound_provider_id || source.failure_id!==a.failure_provider_id ||
      sent?.id!==source.sent_id || notice?.id!==source.failure_id ||
      !digest(source.sent_native_sha256) || !digest(source.failure_native_sha256) ||
      !object(source.sent_native) || !object(source.failure_native) ||
      deliveryNativeSourceDigest(source.sent_native)!==source.sent_native_sha256 ||
      deliveryNativeSourceDigest(source.failure_native)!==source.failure_native_sha256 ||
      deliveryNativeContentDigest(sent)!==deliveryNativeContentDigest(source.sent_native) ||
      deliveryNativeContentDigest(notice)!==deliveryNativeContentDigest(source.failure_native) ||
      !(sent.label_ids ?? []).includes('SENT') ||
      Number(sent.internal_date)!==Date.parse(a.sent_at) || Number(notice.internal_date)!==Date.parse(a.failed_at) ||
      sourceHeader(sent.payload,'message-id')!==source.rfc_message_id ||
      !/^<[^<>\s]+>$/.test(source.rfc_message_id ?? '') ||
      sourceAddress(sourceHeader(sent.payload,'from'))!==p.mailbox ||
      sourceAddress(sourceHeader(sent.payload,'to'))!==a.recipient_email ||
      sourceHeader(sent.payload,'subject')!==original.subject ||
      notice.payload?.mime_type!=='multipart/report' ||
      sourceHeader(notice.payload,'auto-submitted')!=='auto-replied' ||
      sourceAddress(sourceHeader(notice.payload,'to'))!==p.mailbox ||
      sourceHeader(notice.payload,'in-reply-to')!==source.rfc_message_id)
    fail('CONTACT_RELATED_RECIPIENT_ORIGINAL_CHANGED');
  const reports=sourceParts(notice.payload).filter(part=>part?.mime_type==='message/delivery-status');
  const selected=reports.flatMap(report=>sourceParts(report)).filter(part=>
    typeof part?.body?.content==='string' && /(?:^|\r?\n)Final-Recipient:/i.test(part.body.content));
  if (selected.length!==1) fail('CONTACT_RECIPIENT_SOURCE_AMBIGUOUS');
  const report=selected[0],fields=sourceFields(report.body.content);
  if (fields['final-recipient']?.toLowerCase()!=='rfc822; '+a.recipient_email ||
      fields.action!=='failed' || !/^5\.\d+\.\d+$/.test(fields.status ?? '') ||
      fields.status!==a.delivery_status || sourceHeader(report,'x-original-message-id')!==source.rfc_message_id)
    fail('CONTACT_RELATED_RECIPIENT_FAILURE_REQUIRED');
  const body=sent.payload.mime_type==='multipart/mixed'?sent.payload.parts?.[0]:sent.payload;
  const files=sent.payload.mime_type==='multipart/mixed'?sent.payload.parts.slice(1):[];
  if (body?.mime_type!=='text/html' || body.filename || body.parts?.length ||
      typeof body.body?.content!=='string' || !digest(source.html_sha256) ||
      sha(body.body.content)!==source.html_sha256 ||
      originalHtml!==undefined && body.body.content!==originalHtml ||
      !Array.isArray(original.attachments ?? []) ||
      !Array.isArray(original.attachment_data ?? []) ||
      (original.attachment_data ?? []).length!==(original.attachments ?? []).length ||
      files.length!==(original.attachments ?? []).length ||
      files.some((part,i)=>part.filename!==original.attachments[i].filename ||
        part.mime_type!==original.attachments[i].mime_type || part.body?.size!==original.attachments[i].bytes))
    fail('CONTACT_RELATED_RECIPIENT_ORIGINAL_DELIVERY_CHANGED');
  if (!/^[a-f0-9]{40}$/.test(p.original_claim?.sha ?? '') ||
      !originalClaimMatches(input,p.original_claim?.record) || p.original_claim.recipient!==a.recipient_email)
    fail('CONTACT_RECIPIENT_ORIGINAL_CLAIM_REQUIRED');
  return {version:source.version,sent_id:sent.id,failure_id:notice.id,
    sent_native_sha256:source.sent_native_sha256,failure_native_sha256:source.failure_native_sha256,
    original_recipient:a.recipient_email,recipient:p.recipient,rfc_message_id:source.rfc_message_id,
    related_source_sha256:deliveryCorrectionDigest(p.related_company_source),
    original_html_sha256:source.html_sha256};
}

function readDeliveryCorrection(input) {
  if (input?.delivery_correction == null) return null;
  const p=input.delivery_correction;
  if (!object(p) || p.version!==VERSION || !printable(p.case_id,160) ||
      p.opportunity_id!==input.opportunity_id || !['buyer','partner'].includes(p.prospect) ||
      !href(p.company_url) || !address(p.recipient) || p.recipient!==input.to ||
      !address(p.mailbox) || p.link_id!==input.link_id || !printable(p.link_id,160) ||
      p.touchpoint!==input.touchpoint || !Array.isArray(p.failed_attempts) || !p.failed_attempts.length ||
      p.failed_attempts.length>100 || p.failed_attempts.some(a=>!reviewAttempt(a)) ||
      p.payload_sha256!==deliveryPayloadDigest(input) || !printable(p.review?.by,120) ||
      !printable(p.review?.note,2000) || !instant(p.review?.at))
    fail('CONTACT_DELIVERY_CORRECTION_INVALID');
  const seen=new Set();
  for (let i=0;i<p.failed_attempts.length;i++) {
    const a=p.failed_attempts[i],key=a.mailbox+'\0'+a.outbound_provider_id;
    if (seen.has(key) || Date.parse(a.reviewed_at)>Date.parse(p.review.at)) fail('CONTACT_DELIVERY_CORRECTION_HISTORY_CHANGED');
    seen.add(key);
    if (i && (Date.parse(p.failed_attempts[i-1].sent_at)>Date.parse(a.sent_at) ||
        (p.failed_attempts[i-1].sent_at===a.sent_at &&
        (p.failed_attempts[i-1].mailbox+'\0'+p.failed_attempts[i-1].outbound_provider_id).localeCompare(a.mailbox+'\0'+a.outbound_provider_id)>0)))
      fail('CONTACT_DELIVERY_CORRECTION_HISTORY_CHANGED');
  }
  const last=p.failed_attempts.at(-1);
  const expected='delivery-recovery-v1-'+sha(JSON.stringify(['dealscout.delivery-recovery-attempt.v1',last.mailbox,last.outbound_provider_id]));
  if (p.touchpoint!==expected || last.mailbox!==p.mailbox)
    fail('CONTACT_DELIVERY_CORRECTION_ORIGINAL_REQUIRED');
  if (relatedCompanyCorrection(p)) {
    if (p.failed_attempts.some(a=>a.recipient_email===p.recipient))
      fail('CONTACT_DELIVERY_CORRECTION_RECIPIENT_ALREADY_TRIED');
    assertRelatedCompanyRecipientSources(input,p.original_sources?.sent_native,p.original_sources?.failure_native);
  } else if (sameOfferRecipientCorrection(p)) {
    if (p.failed_attempts.some(a=>a.recipient_email===p.recipient))
      fail('CONTACT_DELIVERY_CORRECTION_RECIPIENT_ALREADY_TRIED');
    const source=recipientCorrectionSource(p);
    assertRecipientSources(input,source?.sent_native,source?.failure_native);
  } else if (p.mode !== undefined && p.mode!=='ATTACHMENT_DELIVERY_CORRECTION' ||
      last.recipient_email!==p.recipient ||
      p.failed_attempts.filter(a=>a.recipient_email===p.recipient).some(a=>a.mailbox!==p.mailbox || !policyAttempt(a)))
    fail('CONTACT_DELIVERY_CORRECTION_ORIGINAL_REQUIRED');
  const files=input.attachments ?? [], links=input.source_links ?? [];
  if (!Array.isArray(files) || !Array.isArray(links) || !recipientCorrection(p) && !files.length && !links.length ||
      files.length>10 || links.length>10) fail('CONTACT_DELIVERY_CORRECTION_DELIVERY_REQUIRED');
  for (const f of files) {
    if (!printable(f.filename,240) || (!relatedCompanyCorrection(p) && !(sameOfferRecipientCorrection(p) && /\.html?$/i.test(f.filename) && f.mime_type==='text/html') && (!/\.(pdf|txt|md|csv|json|xlsx|docx|zip)$/i.test(f.filename) ||
        !['application/pdf','text/plain','text/markdown','text/csv','application/json','application/zip',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(f.mime_type))) ||
        !Number.isSafeInteger(f.bytes) || f.bytes<1 || !digest(f.sha256))
      fail('CONTACT_DELIVERY_CORRECTION_DOCUMENT_REQUIRED');
  }
  readContactDocumentArchives(input,{required:true});
  for (const link of links) {
    if (!['commons.contact-drive-source/v1','commons.contact-drive-source/v2'].includes(link.schema) ||
        link.recipient!==p.recipient || !href(link.url) || !digest(link.sha256) ||
        !Number.isSafeInteger(link.bytes) || link.bytes<1 || !input.body.includes(link.url))
      fail('CONTACT_DELIVERY_CORRECTION_SOURCE_REQUIRED');
  }
  return p;
}
function reviewedDeliveryMessageIds(proof, mailbox, kind='sent') {
  if (!proof) return [];
  if (!['sent','inbound','organization'].includes(kind)) throw TypeError('Unknown delivery census kind');
  return [...new Set(proof.failed_attempts.filter(a=>a.mailbox===mailbox &&
    (kind==='organization' || a.recipient_email===proof.recipient)).flatMap(a=>
      kind==='sent' ? [a.outbound_provider_id] : kind==='inbound' ? [a.failure_provider_id] :
        [a.outbound_provider_id,a.failure_provider_id]))];
}
function assertDeliveryCorrectionGate(proof, decision) {
  if (proof && (decision?.can_contact!==true || decision.case_id!==proof.case_id ||
      decision.delivery_correction_sha256!==deliveryCorrectionDigest(proof)))
    fail('CONTACT_DELIVERY_CORRECTION_CURRENT_REVIEW_REQUIRED');
  return decision;
}
function canReserveDeliveryCorrection(spec, record) {
  const proof=readDeliveryCorrection(spec);
  if (!proof) return false;
  return recipientCorrection(proof) ? record == null : originalClaimMatches(spec,record);
}
function makeDeliveryCorrectionClaim(spec, before, {lease,now,expiresAt}) {
  const proof=readDeliveryCorrection(spec);
  if (!proof || !/^[a-f0-9]{40}$/.test(before?.sha ?? '') ||
      !(recipientCorrection(proof) ? originalClaimMatches(spec,before.record) &&
        before.sha===proof.original_claim.sha && canonical(before.record)===canonical(proof.original_claim.record)
        : canReserveDeliveryCorrection(spec,before.record)) || !printable(lease,200) ||
      lease===before.record.lease || !instant(now) || !instant(expiresAt) ||
      Date.parse(expiresAt)<=Date.parse(now) || Date.parse(now)<Date.parse(proof.review.at))
    fail('CONTACT_DELIVERY_CORRECTION_CLAIM_CHANGED');
  return {protocol:'commons-first-contact-v1',status:'reserved',case:spec.opportunity_id,lease,
    reserved_at:now,send_expires_at:expiresAt,
    delivery_correction:{version:CLAIM_VERSION,proof_sha256:deliveryCorrectionDigest(proof),
      payload_sha256:proof.payload_sha256,case_id:proof.case_id,
      original_provider_message_id:proof.failed_attempts.at(-1).outbound_provider_id},
    prior_delivery_claim:{sha:before.sha,record:JSON.parse(JSON.stringify(before.record))}};
}
function matchesDeliveryCorrectionClaim(spec, record, lease) {
  const proof=readDeliveryCorrection(spec);
  if (!proof) return record?.delivery_correction == null;
  return record?.protocol==='commons-first-contact-v1' && record.case===spec.opportunity_id &&
    record.lease===lease && ['reserved','sent'].includes(record.status) &&
    record.delivery_correction?.version===CLAIM_VERSION &&
    record.delivery_correction.proof_sha256===deliveryCorrectionDigest(proof) &&
    record.delivery_correction.payload_sha256===proof.payload_sha256 &&
    record.delivery_correction.case_id===proof.case_id &&
    record.delivery_correction.original_provider_message_id===proof.failed_attempts.at(-1).outbound_provider_id &&
    /^[a-f0-9]{40}$/.test(record.prior_delivery_claim?.sha ?? '') &&
    (recipientCorrection(proof) ? record.prior_delivery_claim.sha===proof.original_claim.sha &&
      canonical(record.prior_delivery_claim.record)===canonical(proof.original_claim.record) &&
      originalClaimMatches(spec,record.prior_delivery_claim.record) :
      canReserveDeliveryCorrection(spec,record.prior_delivery_claim.record));
}
module.exports={VERSION,CLAIM_VERSION,ADMINISTRATOR_MODE,administratorCorrection,PUBLISHED_MODE,
  publishedRecipientCorrection,sameOfferRecipientCorrection,recipientCorrectionSource,assertRecipientSources,
  assertPublishedRecipientPublication,RELATED_COMPANY_MODE,
  relatedCompanyCorrection,recipientCorrection,readRelatedCompanySource,assertRelatedCompanyRecipientSources,deliveryOfferDigest,
  deliveryNativeSourceDigest,deliveryNativeContentDigest,assertAdministratorRecipientSources,deliveryPayloadDigest,deliveryCorrectionDigest,readDeliveryCorrection,
  readContactDocumentArchives,assertContactDocumentArchives,contactDocumentArchivesDigest,
  reviewedDeliveryMessageIds,assertDeliveryCorrectionGate,canReserveDeliveryCorrection,makeDeliveryCorrectionClaim,
  matchesDeliveryCorrectionClaim};
