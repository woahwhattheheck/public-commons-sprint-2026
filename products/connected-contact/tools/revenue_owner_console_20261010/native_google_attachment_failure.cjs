'use strict';
/** Reconcile Gmail's native attachment-policy notice with its reviewed original SENT. */
const GOOGLE_ATTACHMENT_FAILURE_KIND = 'GMAIL_ATTACHMENT_POLICY';
const GOOGLE_ATTACHMENT_FAILURE_VERSION = 'gmail.attachment-policy-failure.v1';
const addresses=value=>[...new Set(String(value??'').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g)||[])];
const noticeText="For security reasons, Gmail does not allow you to use this type of file as it violates Google policy for executables and archives.";
const native=value=>value?.source_format==='GMAIL_NATIVE_MIME' &&
  /^[a-f0-9]{64}$/.test(value.native_review?.source_sha256??'') &&
  value.content_complete===true;

/**
 * This notice has no failed-recipient field or SMTP code. Only its native
 * direct reply to one original recipient can establish that recipient.
 * The caller still validates chronology and the original saved SENT event.
 */
function googleAttachmentFailure(message, original, recipient) {
  if (!native(message) || !native(original) || message.delivery_status?.length ||
      !original.labels?.includes('SENT') ||
      message.labels?.some(value=>value==='SENT'||value==='DRAFT')) return null;
  const mailbox=String(message.mailbox??'').toLowerCase();
  const recipients=addresses((original.native_review.headers??[])
    .filter(header=>['to','cc','bcc'].includes(header.name)).map(header=>header.value).join(','));
  if (!mailbox || original.mailbox?.toLowerCase()!==mailbox ||
      addresses(message.from).join(',')!=='mailer-daemon@googlemail.com' ||
      addresses(message.to?.join(',')).join(',')!==mailbox ||
      addresses(original.from).join(',')!==mailbox ||
      recipients.join(',')!==recipient) return null;
  if (!original.rfc_message_id || message.in_reply_to?.length!==1 ||
      message.in_reply_to[0]!==original.rfc_message_id ||
      message.rfc_message_id===original.rfc_message_id ||
      !/^re:\s*/i.test(message.subject??'') ||
      message.subject.replace(/^re:\s*/i,'').trim()!==original.subject.trim()) return null;
  const firstParagraph=String(message.body??'').split(/\r?\n\s*\r?\n/,1)[0].replace(/\s+/g,' ').trim();
  if (firstParagraph!==noticeText) return null;
  return {recipient,action:'failed',status:'',diagnostic:firstParagraph,
    delivery_failure_kind:GOOGLE_ATTACHMENT_FAILURE_KIND,
    delivery_failure_evidence:{version:GOOGLE_ATTACHMENT_FAILURE_VERSION,
      notice_source_sha256:message.native_review.source_sha256,
      outbound_source_sha256:original.native_review.source_sha256}};
}

module.exports={GOOGLE_ATTACHMENT_FAILURE_KIND,GOOGLE_ATTACHMENT_FAILURE_VERSION,googleAttachmentFailure};
