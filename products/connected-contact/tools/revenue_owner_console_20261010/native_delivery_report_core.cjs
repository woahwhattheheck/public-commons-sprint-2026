'use strict';
/** Shared original Gmail delivery report parsing; hosts supply standard byte, IDNA and SHA-256 primitives. */
function createNativeDeliveryReports({createHash,domainToASCII,Buffer,TextDecoder}) {

/**
 * Native delivery-status reports, RFC 3464 / RFC 6533.
 * Original machine fields and MIME source locations remain attached to every
 * report and recipient. This module parses and correlates; it never sends mail
 * or writes the canonical workspace.
 */
const DELIVERY_REPORT_VERSION = 'gmail.delivery-report.v1';
const ACTIONS = new Set(['failed', 'delayed', 'delivered', 'relayed', 'expanded']);
const MESSAGE_FIELDS = new Set(['original-envelope-id', 'reporting-mta', 'dsn-gateway',
  'received-from-mta', 'arrival-date']);
const RECIPIENT_FIELDS = new Set(['original-recipient', 'final-recipient', 'action', 'status',
  'remote-mta', 'diagnostic-code', 'localized-diagnostic', 'last-attempt-date', 'final-log-id', 'will-retry-until']);
const DSN_TYPES = new Set(['message/delivery-status', 'message/global-delivery-status']);
const RETURN_TYPES = new Set(['message/rfc822', 'message/global']);
const RETURN_HEADERS = new Set(['text/rfc822-headers', 'message/global-headers']);
const MAX_TEXT = 16 * 1024 * 1024;
const MAX_PARTS = 5000;
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const unique = list => [...new Set(list)];
const headerValues = (part, name) => (part?.headers || [])
  .filter(h => String(h?.name || '').toLowerCase() === name).map(h => String(h.value ?? ''));
const mimeType = part => String(part?.mime_type ?? part?.mimeType ?? '').split(';')[0].trim().toLowerCase();
const issue = (code, detail) => detail === undefined ? { code } : { code, detail };
function fail(ok, why) { if (!ok) throw new Error('Delivery report: ' + why); }

function messageIds(value) {
  // Message-ID is not a Gmail provider ID or an SMTP envelope ID. Preserve case.
  return unique(String(value ?? '').match(/<[^<>\s]+@[^<>\s]+>/gu) || []);
}
function withoutComments(value) {
  let result = '', depth = 0, quoted = false, escaped = false;
  for (const c of String(value ?? '')) {
    if (escaped) { if (!depth) result += c; escaped = false; continue; }
    if (c === '\\') { if (!depth) result += c; escaped = true; continue; }
    if (!depth && c === '"') { quoted = !quoted; result += c; continue; }
    if (!quoted && c === '(') { depth++; continue; }
    if (!quoted && c === ')' && depth) { depth--; continue; }
    if (!depth) result += c;
  }
  return { value: result.trim(), balanced: !depth && !quoted && !escaped };
}
function mailboxValue(value) {
  const cleaned = withoutComments(value).value.trim();
  const angle = cleaned.match(/^.*<([^<>]+)>$/u);
  const address = (angle ? angle[1] : cleaned).trim();
  if (/[\r\n\0]/u.test(address)) return null;
  const at = address.lastIndexOf('@');
  if (at < 1 || at === address.length - 1) return null;
  const local = address.slice(0, at), originalDomain = address.slice(at + 1);
  if ((!/^"(?:[^"\\]|\\.)+"$/u.test(local) && /[\s<>(),;:\[\]\\"]/u.test(local)) ||
      /[\s<>(),;\\"]/u.test(originalDomain)) return null;
  const ascii = originalDomain.startsWith('[') && originalDomain.endsWith(']')
    ? originalDomain.toLowerCase() : domainToASCII(originalDomain.toLowerCase());
  if (!ascii) return null;
  return { value: address, local, domain: ascii, key: local + '@' + ascii };
}
function decodeUnitext(value) {
  let invalid = false;
  const decoded = value.replace(/\\x\{([^}]*)\}/g, (whole, hex) => {
    if (!/^[0-9A-Fa-f]{2,6}$/.test(hex)) { invalid = true; return whole; }
    const n = parseInt(hex, 16);
    const allowedAscii = n >= 1 && n <= 32 || [43, 61, 92, 127].includes(n);
    if (n === 0 || n > 0x10ffff || n >= 0xd800 && n <= 0xdfff || n < 128 && !allowedAscii) {
      invalid = true; return whole;
    }
    return String.fromCodePoint(n);
  });
  if (/\\x\{/i.test(decoded)) invalid = true;
  return { value: decoded, valid: !invalid };
}
function deliveryAddress(value) {
  const raw = String(value ?? ''), at = raw.indexOf(';');
  if (at < 0) return { raw, address_type: null, address: raw.trim(), mailbox: null, valid: false };
  const token = withoutComments(raw.slice(0, at));
  const body = withoutComments(raw.slice(at + 1));
  const type = token.value.toLowerCase();
  const valid = token.balanced && body.balanced && /^[a-z0-9][a-z0-9_-]*$/i.test(type) && Boolean(body.value);
  const decoded = type === 'utf-8' ? decodeUnitext(body.value) : { value: body.value, valid: true };
  const mailbox = valid && decoded.valid && ['rfc822', 'utf-8'].includes(type) ? mailboxValue(decoded.value) : null;
  return { raw, address_type: type || null, address: body.value, decoded_address: decoded.value, mailbox,
    valid: valid && decoded.valid && (!['rfc822', 'utf-8'].includes(type) || Boolean(mailbox)) };
}
function recipientAddress(value) {
  const parsed = deliveryAddress(value);
  if (parsed.valid || parsed.raw.includes(';')) return parsed;
  // Some deployed MTAs emit a bare ASCII addr-spec in Final-Recipient.
  // Keep the public typed-address parser strict and retain this distinction.
  const address = parsed.raw.trim();
  if (!/^[^\s<>(),;:\[\]\\"]+@[A-Za-z0-9.-]+$/.test(address) ||
      /[^\x21-\x7e]/.test(address)) return parsed;
  const inferred = deliveryAddress('rfc822; ' + address);
  return inferred.valid ? { ...inferred, raw: parsed.raw, address_type: null,
    inferred_address_type: 'rfc822', syntax: 'BARE_MAILBOX' } : parsed;
}
function typedValue(value) {
  const raw = String(value ?? ''), at = raw.indexOf(';');
  return { raw, type: at < 0 ? null : withoutComments(raw.slice(0, at)).value.toLowerCase(),
    value: (at < 0 ? raw : raw.slice(at + 1)).trim() };
}
function dateValue(value) {
  if (value == null) return null;
  const raw = String(value), parsed = Date.parse(raw);
  return { raw, utc: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null };
}
function decodePart(part, path) {
  const body = part.body || {}, notes = [];
  let text = '', bytes = 0, complete = false;
  const encoded = body.base64_url_content ?? body.data;
  const contentType = headerValues(part, 'content-type').join(';');
  const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1] || 'utf-8';
  if (typeof encoded === 'string' && encoded) {
    if (!/^[A-Za-z0-9_-]*={0,2}$/.test(encoded)) notes.push(issue('INVALID_BASE64URL'));
    else {
      const buffer = Buffer.from(encoded, 'base64url');
      if (buffer.toString('base64url') !== encoded.replace(/=+$/, '')) notes.push(issue('NONCANONICAL_BASE64URL'));
      else {
        bytes = buffer.length;
        fail(bytes <= MAX_TEXT, 'one MIME part exceeds 16 MiB');
        try { text = new TextDecoder(charset, { fatal: true }).decode(buffer); }
        catch { notes.push(issue('MIME_CHARSET_DECODE_FAILED', charset)); }
        complete = Number.isSafeInteger(body.size) && bytes === body.size && notes.length === 0;
        if (typeof body.content === 'string' && body.content !== text) {
          complete = false; notes.push(issue('MIME_TEXT_AND_BYTES_DIFFER'));
        }
      }
    }
  } else if (typeof body.content === 'string') {
    text = body.content; bytes = Buffer.byteLength(text, 'utf8');
    fail(bytes <= MAX_TEXT, 'one MIME text exceeds 16 MiB');
    complete = /^(utf-8|utf8|us-ascii|ascii)$/i.test(charset) &&
      Number.isSafeInteger(body.size) && body.size === bytes;
  } else if (body.size === 0 && !(body.attachment_id ?? body.attachmentId)) complete = true;
  else notes.push(issue('MIME_BODY_NOT_MATERIALIZED', body.attachment_id ?? body.attachmentId ?? null));
  if (!complete) notes.push(issue('MIME_BODY_INCOMPLETE'));
  return { text, source: { part_id: String(part.part_id ?? part.partId ?? path), path,
    mime_type: mimeType(part), bytes, declared_bytes: body.size ?? null, charset,
    sha256: sha(text), complete }, issues: notes };
}
function decomposedStatusPart(part, path) {
  // Gmail FULL can expose an attachment-backed delivery-status body as one
  // decoded child: message fields in native headers, recipient fields in text.
  // Accept that complete representation only when every original byte fits
  // the parent size; an absent or truncated child never completes the report.
  const body = part.body || {}, children = part.parts || [];
  if (typeof body.content === 'string' || body.data || body.base64_url_content ||
      children.length !== 1 || !Number.isSafeInteger(body.size)) return null;
  const child = children[0], childPath = path + '.0';
  if ((child.parts || []).length || mimeType(child) !== 'text/plain') return null;
  const headers = child.headers || [];
  if (!headers.length || headers.some(h => !MESSAGE_FIELDS.has(String(h?.name || '').toLowerCase()) ||
      typeof h.value !== 'string' || /[\r\n]/.test(h.value))) return null;
  const decoded = decodePart(child, childPath);
  if (!decoded.source.complete) return null;
  const text = headers.map(h => h.name + ': ' + h.value).join('\r\n') +
    '\r\n\r\n' + decoded.text;
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes !== body.size || bytes > MAX_TEXT) return null;
  return { text, issues: [], source: {
    part_id: String(part.part_id ?? part.partId ?? path), path, mime_type: mimeType(part),
    origin: 'NATIVE_DECOMPOSED_CHILD', bytes, declared_bytes: body.size, charset: 'utf-8',
    sha256: sha(text), complete: true, child: decoded.source,
    headers: headers.map(h => ({ name: h.name, value: h.value }))
  } };
}
function parseFields(text, source) {
  const groups = [], issues = [];
  let fields = [], current = null;
  function finishField() { if (current) { fields.push(current); current = null; } }
  function finishGroup() { finishField(); if (fields.length) { groups.push({ fields, source }); fields = []; } }
  for (const rawLine of String(text).replace(/\r\n/g, '\n').split('\n')) {
    if (rawLine === '') { finishGroup(); continue; }
    if (/^[ \t]/.test(rawLine)) {
      if (!current) issues.push(issue('ORPHAN_FIELD_CONTINUATION', source.path));
      else { current.raw += '\n' + rawLine; current.value += ' ' + rawLine.trimStart(); }
      continue;
    }
    finishField();
    const match = /^([!-9;-~]+):[ \t]*(.*)$/.exec(rawLine);
    if (!match) { issues.push(issue('INVALID_MACHINE_FIELD', { path: source.path, line: rawLine })); continue; }
    current = { name: match[1], key: match[1].toLowerCase(), value: match[2], raw: rawLine };
  }
  finishGroup();
  return { groups, issues };
}
function nativeHeaderGroup(part, path) {
  const machine = (part.headers || []).filter(h =>
    !/^(content-|mime-version$)/i.test(String(h?.name || '')));
  if (!machine.length) return null;
  const fields = machine.map(h => ({ name: String(h.name), key: String(h.name).toLowerCase(),
    value: String(h.value ?? '').replace(/\r?\n[ \t]+/g, ' '), raw: String(h.name) + ': ' + String(h.value ?? '') }));
  const raw = machine.map(h => String(h.name) + ': ' + String(h.value ?? '')).join('\r\n');
  return { fields, source: { part_id: String(part.part_id ?? part.partId ?? path),
    path, mime_type: mimeType(part), origin: 'NATIVE_HEADERS', bytes: Buffer.byteLength(raw),
    sha256: sha(raw), complete: true } };
}
function values(fields, key) { return fields.filter(f => f.key === key).map(f => f.value); }
function single(fields, key, issues, required = false) {
  const found = values(fields, key);
  if (found.length > 1) issues.push(issue('DUPLICATE_MACHINE_FIELD', key));
  if (required && !found.length) issues.push(issue('MISSING_MACHINE_FIELD', key));
  return found.length === 1 ? found[0] : null;
}
function normalizeRecipient(group, index, reportId) {
  const issues = [], fields = group.fields;
  const final = single(fields, 'final-recipient', issues, true);
  const original = single(fields, 'original-recipient', issues);
  const actionRaw = single(fields, 'action', issues, true);
  const statusRaw = single(fields, 'status', issues, true);
  const action = withoutComments(actionRaw || '').value.toLowerCase();
  const status = withoutComments(statusRaw || '').value;
  if (!ACTIONS.has(action)) issues.push(issue('INVALID_DELIVERY_ACTION', actionRaw));
  if (!/^[245]\.(?:0|[1-9]\d{0,2})\.(?:0|[1-9]\d{0,2})$/.test(status)) issues.push(issue('INVALID_ENHANCED_STATUS', statusRaw));
  if (ACTIONS.has(action) && /^[245]\./.test(status) &&
      (action === 'delayed' && status[0] !== '4' ||
       ['delivered', 'relayed', 'expanded'].includes(action) && status[0] !== '2' ||
       action === 'failed' && !['4', '5'].includes(status[0])))
    issues.push(issue('ACTION_STATUS_CLASS_MISMATCH', {action, status}));
  const finalRecipient = final == null ? null : recipientAddress(final);
  const originalRecipient = original == null ? null : recipientAddress(original);
  if (finalRecipient && !finalRecipient.valid) issues.push(issue('INVALID_FINAL_RECIPIENT', final));
  if (originalRecipient && !originalRecipient.valid) issues.push(issue('INVALID_ORIGINAL_RECIPIENT', original));
  const diagnostic = single(fields, 'diagnostic-code', issues);
  const remote = single(fields, 'remote-mta', issues);
  const lastAttempt = single(fields, 'last-attempt-date', issues);
  const willRetry = single(fields, 'will-retry-until', issues);
  const finalLog = single(fields, 'final-log-id', issues);
  const localizedDiagnostics = values(fields, 'localized-diagnostic').map(typedValue);
  const languages = localizedDiagnostics.map(d => d.type);
  if (new Set(languages).size !== languages.length || languages.some(l => !l || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(l)))
    issues.push(issue('INVALID_LOCALIZED_DIAGNOSTIC_LANGUAGES'));
  // Action is authoritative. An MTA can abandon retries after a 4.x failure.
  const terminal = ['failed', 'delivered'].includes(action);
  const state = ({ failed: 'FAILED', delayed: 'DELAYED', delivered: 'DELIVERED',
    relayed: 'RELAYED', expanded: 'EXPANDED' })[action] || 'UNCLASSIFIED';
  return { id: reportId + '-recipient-' + (index + 1), ordinal: index + 1,
    original_recipient: originalRecipient, final_recipient: finalRecipient,
    action, action_raw: actionRaw, state, terminal, status, status_raw: statusRaw,
    status_class: /^[245]\./.test(status) ? Number(status[0]) : null,
    diagnostic: diagnostic == null ? null : typedValue(diagnostic),
    remote_mta: remote == null ? null : typedValue(remote),
    last_attempt: dateValue(lastAttempt), will_retry_until: dateValue(willRetry),
    final_log_id: finalLog, localized_diagnostics: localizedDiagnostics, fields, extensions: fields.filter(f => !RECIPIENT_FIELDS.has(f.key)),
    source: group.source, valid: issues.length === 0 && group.source.complete, issues };
}
function returnedIdentities(payload) {
  const result = [], issues = [], counter = { n: 0 };
  function walk(part, path, returned = false, depth = 0) {
    fail(part && typeof part === 'object' && depth < 32 && ++counter.n <= MAX_PARTS, 'invalid MIME tree');
    const type = mimeType(part);
    const inReturned = returned || RETURN_TYPES.has(type);
    if (inReturned) for (const value of headerValues(part, 'message-id'))
      for (const id of messageIds(value)) result.push({ message_id: id, path, origin: 'RETURNED_MESSAGE_HEADER' });
    if (RETURN_HEADERS.has(type) || (RETURN_TYPES.has(type) && !(part.parts || []).length)) {
      const decoded = decodePart(part, path);
      issues.push(...decoded.issues);
      const prefix = decoded.text.split(/\r?\n\r?\n/, 1)[0];
      const parsed = parseFields(prefix, decoded.source);
      for (const group of parsed.groups) for (const value of values(group.fields, 'message-id'))
        for (const id of messageIds(value)) result.push({ message_id: id, path,
          origin: 'RETURNED_HEADER_BODY', source: decoded.source });
    }
    for (let i = 0; i < (part.parts || []).length; i++)
      walk(part.parts[i], path + '.' + i, inReturned, depth + 1);
  }
  walk(payload, '0');
  return { identities: result, issues };
}
function unwrapNativeMessages(raw) {
  for (let n = 0; n < 8 && raw && !Array.isArray(raw); n++) {
    if (raw.structuredContent) raw = raw.structuredContent;
    else if (raw.result) raw = raw.result;
    else break;
  }
  const result = Array.isArray(raw) ? raw : raw?.responses ?? raw?.messages ?? raw?.emails ?? (raw?.id ? [raw] : null);
  fail(Array.isArray(result), 'expected a native Gmail message, batch or thread');
  return result.map(m => {
    for (let n = 0; n < 8 && m && !m.id; n++) {
      if (m.structuredContent) m = m.structuredContent;
      else if (m.result) m = m.result;
      else break;
    }
    fail(m?.id && m.payload && typeof m.payload === 'object', 'full native Gmail payload is required');
    return m;
  });
}
function providerTime(native) {
  const raw = native.internal_date ?? native.internalDate;
  const value = typeof raw === 'number' ? raw : /^\d+$/.test(String(raw ?? '')) ? Number(raw) : NaN;
  return Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000 ? new Date(value).toISOString() : null;
}
function parseDeliveryReports(native, { mailbox = '' } = {}) {
  fail(native?.id && native.payload, 'full native Gmail message is required');
  const returned = returnedIdentities(native.payload), reports = [], counter = { n: 0 };
  const rootType = headerValues(native.payload, 'content-type').join(';');
  const declaredReport = mimeType(native.payload) === 'multipart/report' &&
    /report-type\s*=\s*["']?(?:global-)?delivery-status\b/i.test(rootType);
  const originals = unique([
    ...returned.identities.filter(i => !i.source || i.source.complete).map(i => i.message_id),
    ...headerValues(native.payload, 'in-reply-to').flatMap(messageIds)
  ]);
  function walk(part, path, depth = 0) {
    fail(part && typeof part === 'object' && depth < 32 && ++counter.n <= MAX_PARTS, 'invalid MIME tree');
    const type = mimeType(part);
    if (DSN_TYPES.has(type)) {
      const id = 'dsn-' + sha([mailbox, String(native.id), String(part.part_id ?? part.partId ?? path)]).slice(0, 40);
      const groups = [], sources = [], issues = [];
      function gather(node, nodePath, subDepth = 0) {
        fail(subDepth < 32, 'invalid delivery-status nesting');
        const headerGroup = nativeHeaderGroup(node, nodePath);
        if (headerGroup) { groups.push(headerGroup); sources.push(headerGroup.source); }
        const nativeDecoded = decodePart(node, nodePath);
        const decoded = nativeDecoded.source.complete ? nativeDecoded :
          (decomposedStatusPart(node, nodePath) || nativeDecoded);
        if (decoded.text || !decoded.source.complete) {
          sources.push(decoded.source); issues.push(...decoded.issues);
          const parsed = parseFields(decoded.text, decoded.source);
          groups.push(...parsed.groups); issues.push(...parsed.issues);
        }
        // A materialized machine body already contains its decoded children.
        if (decoded.source.complete && decoded.text) return;
        for (let i = 0; i < (node.parts || []).length; i++) gather(node.parts[i], nodePath + '.' + i, subDepth + 1);
      }
      gather(part, path);
      const messageGroups = [], recipientGroups = [];
      for (const group of groups) {
        if (group.fields.some(f => f.key === 'final-recipient' || f.key === 'original-recipient' || f.key === 'action'))
          recipientGroups.push(group);
        else messageGroups.push(group);
      }
      const fields = messageGroups.flatMap(g => g.fields);
      const reporting = single(fields, 'reporting-mta', issues, true);
      const envelope = single(fields, 'original-envelope-id', issues);
      const arrival = single(fields, 'arrival-date', issues);
      const gateway = single(fields, 'dsn-gateway', issues);
      const received = single(fields, 'received-from-mta', issues);
      const recipients = recipientGroups.map((group, i) => normalizeRecipient(group, i, id));
      if (!recipients.length) issues.push(issue('NO_RECIPIENT_OUTCOMES'));
      if (sources.some(s => !s.complete)) issues.push(issue('REPORT_SOURCE_INCOMPLETE'));
      const source = { mime_type: type, part_id: String(part.part_id ?? part.partId ?? path), path,
        parts: sources, sha256: sha({ groups: groups.map(g => ({ fields: g.fields, source: g.source })) }) };
      const extensionIds = fields.filter(f => f.key === 'x-original-message-id')
        .flatMap(f => messageIds(f.value)).map(message_id => ({ message_id, path, origin: 'REPORT_EXTENSION_HEADER' }));
      const originalIds = unique([...originals, ...extensionIds.map(i => i.message_id)]);
      const account = mailboxValue(mailbox), labels = native.label_ids ?? native.labelIds ?? [];
      const addressed = account && ['to', 'cc', 'delivered-to', 'x-original-to'].some(field =>
        headerMailboxes(native, field).some(recipient => recipient.key === account.key));
      const nativeInbound = Boolean(addressed) && !labels.some(label => ['SENT', 'DRAFT'].includes(label)) &&
        Boolean(providerTime(native)) && headerValues(native.payload, 'message-id').flatMap(messageIds).length === 1;
      reports.push({ version: DELIVERY_REPORT_VERSION, id, provider_id: String(native.id),
        thread_id: String(native.thread_id ?? native.threadId ?? ''), mailbox, observed_at: providerTime(native),
        native_inbound: nativeInbound, labels: [...labels],
        message_id: headerValues(native.payload, 'message-id').flatMap(messageIds)[0] || null,
        original_message_ids: originalIds,
        original_id_sources: [...returned.identities, ...extensionIds,
          ...headerValues(native.payload, 'in-reply-to').flatMap(messageIds).map(message_id =>
            ({ message_id, path: '0', origin: 'REPORT_IN_REPLY_TO' }))],
        original_envelope_id: envelope, reporting_mta: reporting == null ? null : typedValue(reporting),
        dsn_gateway: gateway == null ? null : typedValue(gateway),
        received_from_mta: received == null ? null : typedValue(received), arrival: dateValue(arrival),
        fields, extensions: fields.filter(f => !MESSAGE_FIELDS.has(f.key)), recipients,
        source, complete: sources.every(s => s.complete) && recipients.length > 0,
        valid: issues.length === 0 && recipients.every(r => r.valid),
        issues, returned_header_issues: returned.issues });
      return;
    }
    // A delivery report nested inside the returned original is historical content.
    if (RETURN_TYPES.has(type)) return;
    for (let i = 0; i < (part.parts || []).length; i++) walk(part.parts[i], path + '.' + i, depth + 1);
  }
  walk(native.payload, '0');
  return { version: DELIVERY_REPORT_VERSION, report_like: declaredReport || reports.length > 0,
    reports, missing_machine_part: declaredReport && !reports.length };
}

function headerMailboxes(native, field) {
  return headerValues(native.payload, field).flatMap(value => {
    // Split on comma only outside quoted local/display names and angle brackets.
    const chunks = []; let current = '', quoted = false, angle = 0, escaped = false;
    for (const c of value) {
      if (escaped) { current += c; escaped = false; continue; }
      if (c === '\\') { current += c; escaped = true; continue; }
      if (c === '"') quoted = !quoted;
      if (!quoted && c === '<') angle++;
      if (!quoted && c === '>') angle = Math.max(0, angle - 1);
      if (!quoted && !angle && c === ',') { chunks.push(current); current = ''; } else current += c;
    }
    chunks.push(current);
    return chunks.map(mailboxValue).filter(Boolean);
  });
}
function nativeSentIdentity(native, { mailbox = '' } = {}) {
  const labels = native.label_ids ?? native.labelIds ?? [];
  const from = headerMailboxes(native, 'from');
  const account = mailboxValue(mailbox);
  const recipientFields = ['to', 'cc', 'bcc'];
  const recipients = recipientFields.flatMap(field => headerMailboxes(native, field).map(value => ({ field, ...value })));
  return { provider_id: String(native.id), thread_id: String(native.thread_id ?? native.threadId ?? ''),
    mailbox, occurred_at: providerTime(native), labels: [...labels],
    message_ids: unique(headerValues(native.payload, 'message-id').flatMap(messageIds)),
    envelope_ids: unique(['original-envelope-id', 'x-original-envelope-id']
      .flatMap(field => headerValues(native.payload, field))),
    from, recipients, source_sha256: sha({ id: native.id,
      internal_date: native.internal_date ?? native.internalDate, payload: native.payload }),
    native_sent: labels.includes('SENT') && !labels.includes('DRAFT') &&
      Boolean(account) && from.length === 1 && from[0].key === account.key };
}

/** Recover the original native header identity already retained on a saved SENT.
 * Its origin remains explicit; no body or provider result is reconstructed. */
function savedSentIdentity(event) {
  const source=event?.native_message_source;
  if(event?.type!=='SENT'||source?.version!=='gmail.native-message-review.v1'||
    !/^[a-f0-9]{64}$/.test(source.source_sha256??'')||!Array.isArray(source.headers)||
    !Array.isArray(source.labels)||!source.labels.includes('SENT'))return null;
  const headerSource={payload:{headers:source.headers}};
  const mailbox=event.mailbox??'',account=mailboxValue(mailbox);
  const from=headerMailboxes(headerSource,'from');
  const recipients=['to','cc','bcc'].flatMap(field=>
    headerMailboxes(headerSource,field).map(value=>({field,...value})));
  const ids=unique(headerValues(headerSource.payload,'message-id').flatMap(messageIds));
  const native=Boolean(account)&&from.length===1&&from[0].key===account.key&&
    ids.length===1&&ids[0]===event.rfc_message_id&&recipients.length>0&&
    source.body_complete===true&&!source.labels.includes('DRAFT')&&
    Number.isFinite(Date.parse(event.occurred_at));
  if(!native)return null;
  return {provider_id:event.provider_id,thread_id:event.provider_thread_id??'',mailbox,
    occurred_at:event.occurred_at,labels:[...source.labels],message_ids:ids,
    envelope_ids:unique(['original-envelope-id','x-original-envelope-id']
      .flatMap(field=>headerValues(headerSource.payload,field))),
    from,recipients,source_sha256:source.source_sha256,
    native_review_source_sha256:source.source_sha256,native_sent:true,
    origin:'RETAINED_NATIVE_SENT_HEADERS',event_id:event.id};
}

function ledgerCases(ledger) {
  if (Array.isArray(ledger)) return ledger;
  if (Array.isArray(ledger?.cases)) return ledger.cases;
  return [];
}
/**
 * Match each native outcome using original RFC/envelope identity AND recipient.
 * A matching thread, subject, sender address or failure text is never sufficient.
 * The caller reviews every accepted binding before the existing case transaction.
 */
function correlateDeliveryReports({ reports, sentMessages = [], ledger = { cases: [] }, mailbox = '' }) {
  const cases = ledgerCases(ledger);
  const sent = sentMessages.map(m => nativeSentIdentity(m, { mailbox }));
  for (const record of cases) for (const event of record.events || []) {
    const identity = savedSentIdentity(event);
    if (identity && identity.mailbox === mailbox && !sent.some(value => value.provider_id === identity.provider_id)) sent.push(identity);
  }
  return reports.map(report => ({
    ...report,
    recipients: report.recipients.map(recipient => {
      const findings = [], candidates = [];
      for (const message of sent) {
        if (!message.native_sent) continue;
        const rfc = message.message_ids.filter(id => report.original_message_ids.includes(id));
        const envelope = report.original_envelope_id && message.envelope_ids.includes(report.original_envelope_id)
          ? report.original_envelope_id : null;
        if (!rfc.length && !envelope) continue;
        // Original-Recipient names the initial envelope target. A rewritten
        // Final-Recipient must not associate this outcome to a different send.
        const targets = recipient.original_recipient
          ? (recipient.original_recipient.mailbox ? [{kind:'ORIGINAL_RECIPIENT',mailbox:recipient.original_recipient.mailbox}] : [])
          : (recipient.final_recipient?.mailbox ? [{kind:'FINAL_RECIPIENT',mailbox:recipient.final_recipient.mailbox}] : []);
        const matches = targets.flatMap(target => message.recipients
          .filter(actual => actual.key === target.mailbox.key).map(actual => ({ ...target, header_field: actual.field })));
        if (!matches.length) { findings.push(issue('ORIGINAL_SENT_RECIPIENT_NOT_MATCHED', message.provider_id)); continue; }
        const originalTarget = matches.find(m => m.kind === 'ORIGINAL_RECIPIENT') || matches[0];
        if (!report.observed_at || !message.occurred_at || Date.parse(message.occurred_at) > Date.parse(report.observed_at)) {
          findings.push(issue('PROVIDER_TIME_ORDER_UNCONFIRMED', message.provider_id)); continue;
        }
        const attached = [];
        for (const c of cases) for (const event of c.events || []) {
          if (event.type !== 'SENT' || event.provider_id !== message.provider_id) continue;
          const eventRecipients = unique([event.recipient_email, ...(event.recipient_emails || [])]
            .filter(Boolean)).map(mailboxValue).filter(Boolean);
          if (eventRecipients.length && eventRecipients.some(value => !message.recipients.some(actual => actual.key === value.key))) continue;
          if (event.rfc_message_id && !message.message_ids.includes(event.rfc_message_id)) continue;
          if (Date.parse(event.occurred_at) !== Date.parse(message.occurred_at)) continue;
          attached.push({ case_id: c.id ?? c.case_id, sent_event_id: event.id,
            recipient_email: originalTarget.mailbox.key, occurred_at: event.occurred_at });
        }
        candidates.push({ provider_id: message.provider_id, mailbox: message.mailbox,
          original_message_ids: rfc, original_envelope_id: envelope,
          recipient_email: originalTarget.mailbox.key, recipient_match: originalTarget.kind,
          header_field: originalTarget.header_field, source_sha256: message.source_sha256,
          occurred_at: message.occurred_at, case_bindings: attached });
      }
      const eligible = recipient.valid && report.complete && report.valid && report.native_inbound;
      const state = !eligible ? 'REVIEW_SOURCE' : candidates.length === 1
        ? candidates[0].case_bindings.length === 1 ? 'MATCHED_CASE' : candidates[0].case_bindings.length > 1
          ? 'AMBIGUOUS_CASE' : 'MATCHED_SENT'
        : candidates.length ? 'AMBIGUOUS_SENT' : 'UNMATCHED';
      return { ...recipient, correlation: { state, candidates, issues: findings } };
    })
  }));
}
function deliveryReportSummary(reports) {
  const counts = { failed: 0, delayed: 0, delivered: 0, relayed: 0, expanded: 0, unclassified: 0,
    matched_case: 0, matched_sent: 0, ambiguous: 0, unmatched: 0, review_source: 0 };
  for (const report of reports) for (const recipient of report.recipients) {
    counts[ACTIONS.has(recipient.action) ? recipient.action : 'unclassified']++;
    const state = recipient.correlation?.state;
    if (state === 'MATCHED_CASE') counts.matched_case++;
    else if (state === 'MATCHED_SENT') counts.matched_sent++;
    else if (state?.startsWith('AMBIGUOUS')) counts.ambiguous++;
    else if (state === 'REVIEW_SOURCE') counts.review_source++;
    else counts.unmatched++;
  }
  return { reports: reports.length, recipients: reports.reduce((n, r) => n + r.recipients.length, 0), ...counts };
}

return {DELIVERY_REPORT_VERSION,messageIds,deliveryAddress,unwrapNativeMessages,parseDeliveryReports,nativeSentIdentity,savedSentIdentity,correlateDeliveryReports,deliveryReportSummary};
}
module.exports={createNativeDeliveryReports};
