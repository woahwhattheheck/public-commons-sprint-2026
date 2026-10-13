'use strict';
/** Shared original receipt checks for native and self-contained portable receiving. */
const {renderFirstContactTextHtml}=require('../../host/first_contact_content.cjs');
const PREPARED_ASSET_LIMIT_BYTES=2*1024*1024*1024;
const issue=(status,message)=>Object.assign(new Error(message),{status});
function normalizePreparedDownload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.filename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.(?:docx|xlsx|zip|md|pdf|html|csv|json|tgz|txt|png|jpg|jpeg|webp)$/.test(value.filename) ||
      typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) ||
      !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > PREPARED_ASSET_LIMIT_BYTES ||
      (value.storage !== undefined && value.storage !== 'workspace'))
    throw issue(422, 'The prepared download needs its exact filename, size, digest and supported storage location.');
  return { filename: value.filename, bytes: value.bytes, sha256: value.sha256,
    ...(value.storage === 'workspace' ? { storage: 'workspace' } : {}) };
}
function createFirstContactProofs({Buffer,sha256,normalizeMessages,MAILBOXES,URL=globalThis.URL}){
const fail=(status,code,message=code)=>{throw Object.assign(new Error(message),{status,code});};
function contactMailbox(linkId = MAILBOXES.business.link_id) {
  const selected = Object.entries(MAILBOXES).find(([,mailbox]) => mailbox.link_id === linkId);
  if (!selected) fail(422,'CONTACT_GMAIL_ACCOUNT_INVALID');
  return {...selected[1], name:selected[0]};
}
const savedMailbox=saved=>{const mailbox=contactMailbox(saved.preview.message.link_id);if(saved.preview.sender!==mailbox.email)fail(409,'CONTACT_SAVED_SENDER_CHANGED');return mailbox;};
// Attachment and source checks retain their original single-code failure contract.
const attachment=(()=>{
const fail=code=>{throw Object.assign(new Error(code),{code,status:422});};
const mime=value=>String(value??'').split(';')[0].trim().toLowerCase();
const email=value=>typeof value==='string'&&/^[a-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[a-z0-9.-]+\.[a-z]{2,63}$/i.test(value);
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
const bodyValue = raw => {
  if (raw?.isError) fail('CONTACT_DELIVERY_PROVIDER_ERROR');
  const value = raw?.structuredContent ?? raw;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('CONTACT_DELIVERY_RESULT_REQUIRED');
  if (typeof value.content === 'string') {
    try { const parsed = JSON.parse(value.content); if (parsed && typeof parsed === 'object') return parsed; } catch {}
  }
  return value;
};
function normalizeContactSourceShare(value, download) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('CONTACT_SOURCE_SHARE_REQUIRED');
  const file = normalizePreparedDownload(download), native = value.schema === 'commons.contact-drive-source/v2';
  if ((!native && value.schema !== 'commons.contact-drive-source/v1') || !safeId(value.file_id) ||
      (native ? !safeId(value.revision_id) : typeof value.version !== 'string' || !/^[0-9]{1,32}$/.test(value.version)) ||
      !email(value.recipient) || (!native && !safeId(value.permission_id)) || value.permission !== 'reader' ||
      !safeId(String(value.account?.id ?? '')) || !email(value.account?.email) ||
      !/^[a-f0-9]{32}$/.test(value.md5 ?? '') || value.sha256 !== file.sha256 ||
      value.filename !== file.filename || value.bytes !== file.bytes ||
      typeof value.checked_at !== 'string' || !Number.isFinite(Date.parse(value.checked_at)))
    fail('CONTACT_SOURCE_SHARE_INVALID');
  let url;
  try { url = new URL(value.url); } catch { fail('CONTACT_SOURCE_URL_INVALID'); }
  if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || url.username || url.password ||
      !(url.pathname === '/file/d/' + value.file_id + '/view' ||
        (url.pathname === '/open' && url.searchParams.get('id') === value.file_id)))
    fail('CONTACT_SOURCE_URL_INVALID');
  return {schema:value.schema, file_id:value.file_id, url:url.href,
    ...(native ? {revision_id:value.revision_id} : {version:value.version,permission_id:value.permission_id}),
    filename:file.filename, bytes:file.bytes, sha256:file.sha256, md5:value.md5,
    recipient:value.recipient.toLowerCase(), permission:'reader',
    account:{id:String(value.account.id),email:value.account.email.toLowerCase()}, checked_at:value.checked_at};
}
function contactNativeAttachmentParts(native) {
  const message = bodyValue(native), result = [];
  const walk = (part,path) => {
    if (!part || typeof part !== 'object') return;
    if (part.filename) result.push({part,path});
    (part.parts ?? []).forEach((child,index) => walk(child,path+'.'+index));
  };
  walk(message.payload,'0');
  return {message,parts:result};
}
function inlineBytes(part) {
  const body = part.body ?? {};
  if (typeof body.base64_url_content === 'string') return Buffer.from(body.base64_url_content,'base64url');
  if (typeof body.data === 'string') return Buffer.from(body.data,'base64url');
  if (typeof body.content === 'string') return Buffer.from(body.content,'utf8');
  return null;
}
function validatePart(part,expected) {
  if (part.filename !== expected.filename || mime(part.mime_type ?? part.mimeType) !== expected.mime_type)
    fail('CONTACT_SENT_ATTACHMENT_MISMATCH');
  const size = part.body?.size ?? part.body?.size_bytes;
  if (size !== undefined && Number(size) !== expected.bytes) fail('CONTACT_SENT_ATTACHMENT_SIZE_MISMATCH');
}
function verifyContactAttachmentReceipts(input,native,messageId) {
  if (!Object.hasOwn(input,'attachments')) return [];
  const expected = input.attachments, {parts} = contactNativeAttachmentParts(native);
  const receipts = native.contact_attachment_receipts;
  if (parts.length !== expected.length ||
      receipts?.schema !== 'commons.contact-attachment-receipts/v1' ||
      receipts.message_id !== messageId || !Array.isArray(receipts.attachments) ||
      receipts.attachments.length !== expected.length) fail('CONTACT_SENT_ATTACHMENT_RECEIPT_REQUIRED');
  return expected.map(item => {
    const found = receipts.attachments.find(receipt => receipt.filename === item.filename);
    const selected = parts.find(row => row.path === found?.part_path);
    const metadataOnly = found?.bytes_source === 'submitted-native-metadata';
    if (!found || !selected || found.message_id !== messageId ||
        ['item_id','filename','mime_type','bytes','sha256'].some(key => found[key] !== item[key]) ||
        (metadataOnly ? typeof found.submitted_base64_url_content !== 'string'
          : typeof found.base64_url_content !== 'string' && found.bytes_source !== 'native-inline'))
      fail('CONTACT_SENT_ATTACHMENT_RECEIPT_CHANGED');
    validatePart(selected.part,item);
    if (metadataOnly) {
      const part = selected.part, declared = part.body?.size ?? part.body?.size_bytes;
      const observedId = part.body?.attachment_id ?? part.body?.attachmentId;
      const attachmentId = typeof observedId === 'string' && observedId &&
        !observedId.includes('...') && !part.body?.attachment_id_truncated && !part.attachment_id_truncated
        ? observedId : null;
      if (part.read_attachment_supported !== false || inlineBytes(part) !== null ||
          !Number.isSafeInteger(Number(declared)) || Number(declared) !== item.bytes ||
          found.native_part_id !== (part.part_id ?? part.partId ?? null) || found.attachment_id !== attachmentId ||
          found.content_readback !== false || found.verification !== 'sent-mime-metadata' ||
          Object.hasOwn(found,'base64_url_content'))
        fail('CONTACT_SENT_ATTACHMENT_RECEIPT_CHANGED');
    }
    const bytes = metadataOnly ? Buffer.from(found.submitted_base64_url_content,'base64url')
      : found.bytes_source === 'native-inline' ? inlineBytes(selected.part) : Buffer.from(found.base64_url_content,'base64url');
    if (!bytes || bytes.length !== item.bytes || sha256(bytes) !== item.sha256)
      fail('CONTACT_SENT_ATTACHMENT_RECEIPT_CHANGED');
    return {...item,attachment_id:found.attachment_id,file_id:found.file_id,message_id:messageId,
      content_readback:!metadataOnly,
      verification:metadataOnly ? 'sent-mime-metadata' : found.bytes_source === 'native-inline' ? 'native-inline-bytes' : 'downloaded-bytes',
      ...(metadataOnly ? {submitted_sha256:item.sha256,native_part_id:found.native_part_id} : {})};
  });
}
return {normalizeContactSourceShare,contactNativeAttachmentParts,inlineBytes,validatePart,verifyContactAttachmentReceipts};
})();
const {verifyContactAttachmentReceipts}=attachment;
function verifyFirstContactReceipt(saved, native, expectedId) {
  const messages = normalizeMessages(native, { mailbox: savedMailbox(saved).email });
  if (messages.length !== 1) fail(422, 'CONTACT_SINGLE_RECEIPT_REQUIRED');
  const message = messages[0], exact = saved.preview.message, sender = savedMailbox(saved);
  const from = String(message.from ?? '').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
  if (message.mailbox !== sender.email || from.length !== 1 || from[0] !== sender.email)
    fail(422, 'CONTACT_NATIVE_SENT_IDENTITY_MISMATCH', 'Read the complete original SENT message from the saved sender account.');
  // The native connected carrier preserves the reviewed plain text through
  // this exact HTML renderer. Match complete original MIME bytes, never a
  // lossy HTML-to-text projection, when receiving that same saved preview.
  const renderedNativeText = exact.body_type === 'text/plain' &&
    message.source_format === 'GMAIL_NATIVE_MIME' && message.content_complete === true &&
    message.body_format === 'HTML_AS_TEXT' &&
    message.original_html === renderFirstContactTextHtml(exact.body);
  if (exact.body_type && (message.content_complete !== true ||
      (message.body_format !== (exact.body_type === 'text/html' ? 'HTML_AS_TEXT' : 'PLAIN_TEXT') && !renderedNativeText)))
    fail(422,'CONTACT_COMPLETE_BODY_FORMAT_REQUIRED');
  const recipients = (message.to || []).flatMap(v => String(v).toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []);
  if ((expectedId && message.id !== expectedId) || !message.labels?.includes('SENT') || recipients.length !== 1 || recipients[0] !== exact.to || message.subject !== exact.subject ||
      !(renderedNativeText || [message.body, message.original_html].filter(value => typeof value === 'string' && value.length)
        .some(value => value.replace(/\r\n/g, '\n') === exact.body))) fail(422, 'CONTACT_FULL_RECEIPT_MISMATCH', 'This message does not match the saved recipient, subject, body, and original SENT label.');
  return {...message, delivered_attachments:verifyContactAttachmentReceipts(exact,native,message.id)};
}
return {...attachment,contactMailbox,verifyFirstContactReceipt};
}
module.exports={createFirstContactProofs,normalizePreparedDownload,PREPARED_ASSET_LIMIT_BYTES};
