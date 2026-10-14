'use strict';

/**
 * Join an original Gmail FULL message with its format=raw response. The existing
 * connected MIME parser owns decoding; this module only binds provider/RFC
 * identity and adapts that complete parse to the existing Gmail MIME consumer.
 * No provider calls, storage, outgoing mail, or active-content execution.
 */
const {parseGmailRaw, decodeHeaderWords} = require('./connected_mime.cjs');
const {sha256Utf8} = require('./connected_sha256.cjs');
const MAX_RAW_BYTES = 64 * 1024 * 1024;
const own = (v, key) => Object.prototype.hasOwnProperty.call(v, key);
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function fail(code, message) { const e = new TypeError(message || code); e.code = code; throw e; }
function unwrap(value) {
  for (let i = 0; i < 8 && !Array.isArray(value); i++) {
    if (!record(value) || value.isError === true || value.error != null || value.error_code != null)
      fail('GMAIL_RAW_PROVIDER_ERROR', 'A successful original Gmail response is required');
    if (value.structuredContent) value = value.structuredContent;
    else if (value.result) value = value.result;
    else break;
  }
  return value;
}
function rawMessageIndex(value) {
  const result = new Map();
  if (value === undefined || value === null) return result;
  const visit = input => {
    const source = unwrap(input);
    if (Array.isArray(source)) { for (const member of source) visit(member); return; }
    if (!record(source)) fail('GMAIL_RAW_RESPONSE_REQUIRED');
    const rows = source.responses ?? source.messages;
    if (Array.isArray(rows)) { for (const member of rows) visit(member); return; }
    if (typeof source.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(source.id) || typeof source.raw !== 'string')
      fail('GMAIL_RAW_MESSAGE_REQUIRED');
    if (result.has(source.id)) fail('GMAIL_RAW_DUPLICATE_ID');
    result.set(source.id, source);
  };
  visit(value);
  return result;
}
function headerValues(part, name) {
  if (!Array.isArray(part?.headers)) return [];
  return part.headers.filter(h => String(h?.name).toLowerCase() === name).map(h => String(h.value ?? ''));
}
function rfcIds(values) { return [...new Set(values.join(' ').match(/<[^<>\s]+@[^<>\s]+>/g) || [])]; }
function addresses(values) {
  return [...new Set(values.join(' ').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [])].sort();
}
function decoded(values) {
  const warnings = [];
  const result = values.map(value => decodeHeaderWords(value, warnings).replace(/\s+/g, ' ').trim());
  if (warnings.length) fail('GMAIL_RAW_IDENTITY_HEADER_UNREADABLE');
  return result;
}
function threadId(value) { return value.thread_id ?? value.threadId; }
function needsGmailRawMessage(message) {
  if (!record(message?.payload)) return false;
  let parts = 0;
  const visit = (part, returned = false, depth = 0) => {
    if (!record(part) || depth >= 32 || ++parts > 5000) return true;
    const type = String(part.mime_type ?? part.mimeType ?? '').split(';')[0].trim().toLowerCase();
    const nestedReturn = returned || type === 'message/rfc822' || type === 'message/global';
    if (!nestedReturn && (['message/delivery-status', 'message/global-delivery-status'].includes(type) ||
      (type === 'multipart/report' && /\breport-type\s*=\s*["']?(?:global-)?delivery-status\b/i.test(headerValues(part, 'content-type').join(';'))))) return true;
    return !nestedReturn && (part.parts ?? []).some(child => visit(child, nestedReturn, depth + 1));
  };
  return visit(message.payload) ||
    /\b(?:mailer-daemon|postmaster)@/i.test(headerValues(message.payload, 'from').join(' ')) ||
    /^(?:delivery status notification|undeliverable|mail delivery failed|failure notice|delivery failure|returned mail)\b/i
      .test(decoded(headerValues(message.payload, 'subject')).join(' '));
}
function bindGmailRawMessage(fullMessage, rawResponse, {mailbox} = {}) {
  const full = unwrap(fullMessage), index = rawMessageIndex(rawResponse);
  if (!record(full?.payload) || typeof full.id !== 'string') fail('GMAIL_FULL_MESSAGE_REQUIRED');
  if (index.size !== 1 || !index.has(full.id)) fail('GMAIL_RAW_MESSAGE_ID_MISMATCH');
  const raw = index.get(full.id);
  if (typeof threadId(full) !== 'string' || !threadId(full) || threadId(raw) !== threadId(full))
    fail('GMAIL_RAW_THREAD_MISMATCH');
  if (typeof mailbox !== 'string' || mailbox !== mailbox.toLowerCase() ||
      addresses([mailbox]).length !== 1 || addresses([mailbox])[0] !== mailbox) fail('GMAIL_RAW_MAILBOX_REQUIRED');
  if (raw.raw.length > Math.ceil(MAX_RAW_BYTES / 3) * 4 + 4) fail('GMAIL_RAW_SOURCE_TOO_LARGE');
  const parsed = parseGmailRaw(raw, {accountId: mailbox, includeBase64: true, includeText: true, maxParts: 5000, maxDepth: 32});
  if (!parsed.complete || parsed.rfc2822.bytes > MAX_RAW_BYTES)
    fail(parsed.rfc2822.bytes > MAX_RAW_BYTES ? 'GMAIL_RAW_SOURCE_TOO_LARGE' : 'GMAIL_RAW_MIME_INCOMPLETE');
  const root = parsed.nodes[0], originalId = rfcIds(headerValues(full.payload, 'message-id'));
  const rawId = rfcIds(headerValues(root, 'message-id'));
  if (headerValues(full.payload, 'message-id').length !== 1 || headerValues(root, 'message-id').length !== 1 ||
      originalId.length !== 1 || rawId.length !== 1 || originalId[0] !== rawId[0]) fail('GMAIL_RAW_RFC_MESSAGE_ID_MISMATCH');
  for (const name of ['from', 'to', 'cc']) {
    const expected = addresses(decoded(headerValues(full.payload, name))), actual = addresses(decoded(headerValues(root, name)));
    if ((name === 'from' && !expected.length) || JSON.stringify(expected) !== JSON.stringify(actual)) fail('GMAIL_RAW_ADDRESS_MISMATCH');
  }
  if (JSON.stringify(decoded(headerValues(full.payload, 'subject'))) !== JSON.stringify(decoded(headerValues(root, 'subject'))))
    fail('GMAIL_RAW_SUBJECT_MISMATCH');
  const nodes = new Map(parsed.nodes.map(n => [n.partId, n])), parts = new Map(parsed.parts.map(p => [p.partId, p]));
  const deliverySources = [];
  const convert = (id, returned = false) => {
    const node = nodes.get(id), part = parts.get(id);
    if (!node) fail('GMAIL_RAW_MIME_INCOMPLETE');
    const inReturn = returned || node.mimeType === 'message/rfc822' || node.mimeType === 'message/global';
    if (!inReturn && ['message/delivery-status', 'message/global-delivery-status'].includes(node.mimeType))
      deliverySources.push({part_id: id, mime_type: node.mimeType, bytes: part.bytes, sha256: part.sha256});
    const payload = {part_id: id, mime_type: node.mimeType, filename: node.filename || '',
      headers: node.headers.map(h => ({name: h.name, value: h.value})),
      body: part ? {size: part.bytes, base64_url_content: part.base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
        ...(typeof part.text === 'string' ? {content: part.text} : {})} : {size: 0},
      parts: node.children.map(child => convert(child, inReturn))};
    return payload;
  };
  const payload = convert(root.partId);
  // Keep the provider's original FULL header representation after checking it
  // against the RAW message. The complete raw header bytes remain retained.
  payload.headers = full.payload.headers;
  const source = {schema: 'gmail.native-raw-source.v1', mailbox, message_id: full.id, thread_id: threadId(full),
    rfc_message_id: originalId[0], bytes: parsed.rfc2822.bytes, sha256: parsed.rfc2822.sha256,
    full_response_sha256: sha256Utf8(JSON.stringify(full)).sha256,
    raw_response_sha256: sha256Utf8(JSON.stringify(raw)).sha256,
    parts: parsed.nodes.length,
    warnings: parsed.nodes.flatMap(node => node.warnings.map(warning => ({part_id: node.partId, ...warning})))};
  return {message: {...full, payload}, source, delivery_sources: deliverySources, raw};
}
function withGmailRawMessages(messages, rawMessages) {
  if (rawMessages === undefined || rawMessages === null) return messages;
  const source = unwrap(messages);
  if (record(source) && own(source, 'raw_messages')) fail('GMAIL_RAW_SOURCE_ALREADY_PRESENT');
  // The enclosing review/job retains the complete original provider exports.
  // This view changes no FULL message or RAW response body.
  rawMessageIndex(rawMessages);
  return Array.isArray(source) ? {messages: source, raw_messages: rawMessages} : {...source, raw_messages: rawMessages};
}
module.exports = {MAX_RAW_BYTES, rawMessageIndex, needsGmailRawMessage, bindGmailRawMessage, withGmailRawMessages};
