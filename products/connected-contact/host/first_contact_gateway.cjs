'use strict';

// One executable path for first-touch Gmail transport, not just a preflight.
// Provider adaptors perform genuine GitHub CAS and Gmail operations; there is
// no automatic retry of an ambiguous send or ambiguous remote reservation.
const crypto = require('node:crypto');
const {fingerprint} = require('./revenue_outbound_intent.cjs');
const {readDeliveryCorrection,reviewedDeliveryMessageIds,assertDeliveryCorrectionGate,
  canReserveDeliveryCorrection,matchesDeliveryCorrectionClaim} = require('./contact_delivery_correction.cjs');

const CLAIM_DIR = 'tools/sales_first_contact/claims/v1';

const claimGuardFailures = new WeakSet();

function claimGuardFailure(message, decision) {
  const error = Object.assign(new Error(message), {
    name:'FirstContactClaimPreservationError',
    code:decision?.code || 'first_contact_claim_guard_unavailable',
    provider_invoked:false,
    ...(decision ? {decision:Object.freeze({...decision})} : {})
  });
  claimGuardFailures.add(error);
  return error;
}

function assertFirstContactClaims({subject, body, payload, body_type} = {}) {
  if (typeof subject !== 'string' || typeof body !== 'string')
    throw claimGuardFailure('Complete original subject and text required for claim preservation');
  const visibleBodies = [body];
  if (payload !== undefined) {
    // Preserve the original body container and both reviewed text alternatives.
    // Attachment documents remain with the complete MIME attachment receiver.
    const container = payload?.mime_type === 'multipart/mixed' ? payload.parts?.[0] : payload;
    const exact = body_type !== undefined;
    const alternative = container?.mime_type === 'multipart/alternative';
    if (alternative) {
      if (!exact || container.filename || !Array.isArray(container.parts) ||
          container.parts.length !== 2 ||
          new Set(container.parts.map(part => part?.mime_type)).size !== 2 ||
          container.parts.some(part => !['text/plain','text/html'].includes(part?.mime_type) ||
            part.filename || part.parts != null || typeof part.charset !== 'string' ||
            part.charset.toLowerCase() !== 'utf-8' || typeof part.body?.content !== 'string'))
        throw claimGuardFailure('Complete original plain/HTML alternatives required');
      visibleBodies.push(container.parts[1].body.content);
    }
    const primary = alternative ? container.parts[0] : container;
    if (exact && !['text/plain','text/html'].includes(body_type))
      throw claimGuardFailure('Original native text MIME type required');
    if (!primary || primary.mime_type !== (exact ? body_type : 'text/html') || (typeof primary.charset !== 'string' || primary.charset.toLowerCase() !== 'utf-8') ||
        primary.filename || primary.parts !== undefined ||
        primary.body?.content !== (exact ? body : renderFirstContactTextHtml(body)))
      throw claimGuardFailure('Original final MIME text differs from its reviewed body');
  }
  let policy;
  try { policy = require('../commons-publication-policy.cjs'); }
  catch { throw claimGuardFailure('Load the canonical claim-preservation source with the original contact modules'); }
  if (typeof policy?.checkClaimPreservation !== 'function')
    throw claimGuardFailure('Canonical checkClaimPreservation export required');
  let decision;
  for (const text of visibleBodies) {
    try { decision = policy.checkClaimPreservation(text, subject); }
    catch { throw claimGuardFailure('Canonical claim-preservation check did not return a decision'); }
    if (decision?.allowed !== true)
      throw claimGuardFailure(decision?.message || 'Original visible fields did not pass claim preservation', decision);
  }
  return decision;
}


const {renderFirstContactTextHtml}=require('./first_contact_content.cjs');

/**
 * Select an already-authored native text envelope without rendering it again.
 * The connected factory still owns account admission and recipient election.
 */
function originalNativeFirstContactArguments(input, sender, attachments) {
  if (input?.native_arguments === undefined) {
    if (input?.body_type === 'text/html')
      throw new TypeError('Select the complete original native HTML arguments');
    return null;
  }
  const only = (value, keys) => value && typeof value === 'object' &&
    !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
  const args = JSON.parse(JSON.stringify(input.native_arguments));
  const multipart = args?.payload?.mime_type === 'multipart/mixed';
  const body = multipart ? args.payload.parts?.[0] : args?.payload;
  const alternative = body?.mime_type === 'multipart/alternative';
  const text = alternative ? body.parts?.[0] : body;
  if (!sender || typeof sender.link_id !== 'string' || typeof sender.email !== 'string' ||
      !only(args,['link_id','from_address','to','subject','payload','response_fields']) ||
      args.link_id !== sender.link_id || args.link_id !== input.link_id ||
      (args.from_address !== undefined && args.from_address !== sender.email) ||
      recipientClaimPath(args.to).recipient !== recipientClaimPath(input.to).recipient ||
      args.subject !== input.subject || typeof args.subject !== 'string' || !args.subject.trim() ||
      /[\r\n]/.test(args.subject) ||
      !['text/plain','text/html'].includes(input.body_type) ||
      !only(text,['mime_type','charset','body']) ||
      text.mime_type !== input.body_type || typeof text.charset !== 'string' || text.charset.toLowerCase() !== 'utf-8' ||
      !only(text.body,['content']) || typeof input.body !== 'string' || !input.body.trim() ||
      text.body.content !== input.body ||
      (args.response_fields !== undefined && (!Array.isArray(args.response_fields) ||
        !args.response_fields.includes('id') || args.response_fields.some(value =>
          typeof value !== 'string' || !value || /[\x00-\x20]/.test(value)))) ||
      input.delivery_correction != null)
    throw new TypeError('Retain the original single-recipient native envelope and sender');
  if (multipart || alternative) {
    if (typeof attachments?.prepareNative !== 'function' ||
        !Array.isArray(input.attachments) || multipart && !input.attachments.length)
      throw new TypeError('Complete native MIME module and explicit attachment manifest required');
    const native = attachments.prepareNative(args.payload);
    const runtime = attachments.prepare(input);
    const fields = ['filename','mime_type','bytes','sha256'];
    if (native.bodies[0].content !== input.body || native.bodies[0].mime_type !== input.body_type ||
        native.prepared.attachments.length !== runtime.attachments.length ||
        native.prepared.attachments.some((item,index) =>
          fields.some(key => item[key] !== runtime.attachments[index][key])))
      throw new TypeError('Native file bytes differ from the reviewed original attachment selection');
  } else if (input.attachments?.length || input.document_archives != null) {
    throw new TypeError('The native text envelope has no selected attachment files');
  }
  assertFirstContactClaims({subject:args.subject,body:input.body,payload:args.payload,
    body_type:input.body_type});
  return args;
}

// Validate new native dispatch, while preserving historical envelope parsing.
function assertNativeResponseFields(args) {
  const fields = ['id','thread_id','label_ids','snippet','history_id','internal_date',
    'payload','size_estimate','classification_label_values'];
  if (args?.response_fields !== undefined && (!Array.isArray(args.response_fields) ||
      !args.response_fields.includes('id') ||
      args.response_fields.some(field => !fields.includes(field))))
    throw new TypeError('Gmail response_fields requires id and native snake_case field names');
  return args;
}

function recipientClaimPath(address) {
  if (typeof address !== 'string') throw new TypeError('recipient required');
  const normalized = address.trim().toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)
      || normalized.includes('..')) throw new TypeError('single ASCII recipient required');
  const key = crypto.createHash('sha256')
    .update('commons-first-contact-v1\0' + normalized, 'utf8').digest('hex');
  return {recipient: normalized, path: `${CLAIM_DIR}/${key.slice(0, 2)}/${key}.json`};
}

function verifiedCensus(value, {deliveryCorrection} = {}) {
  // Both linked Gmail accounts must be searched; an unavailable provider is not 'empty'.
  for (const mailbox of ['business', 'secondary']) {
    const record = value?.[mailbox];
    if (!record || record.checked !== true || !Array.isArray(record.sent_ids)) {
      return {clear: false, reason: `UNVERIFIED_${mailbox.toUpperCase()}_SENT`};
    }
    const allowed = deliveryCorrection ? reviewedDeliveryMessageIds(deliveryCorrection,record.mailbox,'sent') : [];
    if (deliveryCorrection && (record.complete !== true || typeof record.mailbox !== 'string'))
      return {clear:false,reason:'UNVERIFIED_'+mailbox.toUpperCase()+'_SENT'};
    if (record.sent_ids.some(id => !allowed.includes(id))) return {clear: false, reason: 'EXISTING_SENT'};
  }
  return {clear: true};
}

function verifiedInboundCensus(value, {deliveryCorrection} = {}) {
  const evidence = {};
  for (const mailbox of ['business', 'secondary']) {
    const record = value?.[mailbox];
    if (!record || record.checked !== true || !Array.isArray(record.message_ids)
        || record.message_ids.some(id => typeof id !== 'string' || !id.trim())) {
      return {clear: false, reason: `UNVERIFIED_${mailbox.toUpperCase()}_INBOUND`};
    }
    evidence[mailbox] = record.message_ids;
    const allowed = deliveryCorrection ? reviewedDeliveryMessageIds(deliveryCorrection,record.mailbox,'inbound') : [];
    if (deliveryCorrection && typeof record.mailbox !== 'string')
      return {clear:false,reason:'UNVERIFIED_'+mailbox.toUpperCase()+'_INBOUND'};
    if (record.message_ids.some(id => !allowed.includes(id))) return {clear: false, reason: 'INBOUND_REVIEW_REQUIRED', evidence};
    if (record.complete !== true) return {clear: false, reason: `UNVERIFIED_${mailbox.toUpperCase()}_INBOUND`};
  }
  return {clear: true};
}

async function incomingDecision(adapters, spec) {
  // New inbound cannot be treated as cold merely because the saved case has
  // not been imported yet. First contact stops for native-message review;
  // positive HUMAN replies require the relationship-wide Bryce handoff.
  try { return verifiedInboundCensus(await adapters.inboundCensus(spec), {deliveryCorrection:readDeliveryCorrection(spec)}); }
  catch (error) { return {clear:false,reason:'INBOUND_READ_UNAVAILABLE',
    ...(error?.native_failure ? {native_failure:error.native_failure} : {})}; }
}

function matchingSent(receipt, spec) {
  if (!receipt || typeof receipt.id !== 'string' || !receipt.id.trim()
      || !Array.isArray(receipt.labels) || !receipt.labels.includes('SENT')
      || !Array.isArray(receipt.to)
      || !receipt.to.some(a => typeof a === 'string' && a.trim().toLowerCase() === spec.recipient)
      || receipt.subject !== spec.subject) return false;
  return true;
}

async function prepareFinalCensus(adapters, spec) {
  // The connected carrier acquires its existing account lease here, after the
  // original reservation is ready and before the final current-mail checks.
  // Other native adapters keep their existing gateway behavior.
  if (adapters.beforeFinalCensus === undefined) return;
  if (typeof adapters.beforeFinalCensus !== 'function')
    throw new TypeError('beforeFinalCensus must be a function');
  await adapters.beforeFinalCensus(spec);
}

async function sendFirstContact(input, adapters, {resumeReservation} = {}) {
  if (input?.native_arguments !== undefined) assertNativeResponseFields(input.native_arguments);
  if (!input || typeof input !== 'object' || !adapters) throw new TypeError('input and adapters required');
  const functions = ['census', 'inboundCensus', 'reserveIntent', 'reserveRecipient', 'readIntent',
    'readRecipient', 'sendEmail', 'readEmail', 'completeRecipient'];
  for (const name of functions) if (typeof adapters[name] !== 'function') {
    throw new TypeError(`missing provider adapter ${name}`);
  }
  const {recipient, path} = recipientClaimPath(input.to);
  const subject = input.subject;
  const body = input.body;
  if (typeof subject !== 'string' || !subject.trim() || /[\r\n]/.test(subject)
      || typeof body !== 'string' || !body.trim() || typeof input.link_id !== 'string') {
    throw new TypeError('nonempty subject/body, one link_id required');
  }
  assertFirstContactClaims({subject,body});
  const intent = fingerprint(input);
  const spec = {...input, recipient, to: recipient, subject, body, recipient_claim_path: path,
    intent_branch: intent.branch, intent_key: intent.key};
  const deliveryCorrection = readDeliveryCorrection(spec);
  const recipientPending = resumeReservation?.recipient_pending === true;
  if (resumeReservation &&
      (!(/^[a-f0-9]{40}$/.test(resumeReservation.intent_ref_sha ?? '') || adapters.storage_kind==='commons.connected-contact-local-state/v1' && /^local:[a-f0-9]{64}$/.test(resumeReservation.intent_ref_sha ?? '')) ||
       (!recipientPending && (typeof resumeReservation.lease !== 'string' || !resumeReservation.lease || typeof adapters.renewRecipient !== 'function')) ||
       (recipientPending && resumeReservation.lease !== undefined)))
    throw TypeError('original reservation required for before-send continuation');

  // A retained full reservation is read back and renewed below before its one
  // final fresh correspondence/relationship census. New and recipient-pending
  // work still checks correspondence before attempting a create-only claim.
  if (!resumeReservation || recipientPending) {
    if (deliveryCorrection) {
      if (typeof adapters.beforeSend !== 'function') throw TypeError('Current delivery correction review required');
      const decision = await adapters.beforeSend(spec);
      if (!decision?.can_contact) return {status:'NOT_SENT',reason:'DELIVERY_CORRECTION_REVIEW_REQUIRED',contact_state:decision};
      assertDeliveryCorrectionGate(deliveryCorrection,decision);
    }
    const first = verifiedCensus(await adapters.census(spec), {deliveryCorrection});
    if (!first.clear) return {status: 'NOT_SENT', reason: first.reason};
    const incoming = await incomingDecision(adapters, spec);
    if (!incoming.clear) return {status: 'NOT_SENT', ...incoming,
      action: 'Read original inbound messages; positive human reply means HOLD / BRYCE INVOLVED. No automatic reply.'};
  }

  // New work must win a create-only ref; an explicit continuation retains its
  // original proven reservation and renews only that same recipient lease.
  let recipientLock;
  if (resumeReservation) {
    if (recipientPending) {
      // The original create-only intent was won, but its recipient create may
      // have lost a moving-main race. Reuse that exact intent only while the
      // original native reader establishes that no recipient record exists.
      const retainedIntent = await adapters.readIntent(spec);
      if (retainedIntent?.exists !== true || retainedIntent.branch !== intent.branch || retainedIntent.ref_sha !== resumeReservation.intent_ref_sha)
        return {status: 'NOT_SENT', reason: 'ORIGINAL_INTENT_CHANGED'};
      const originalRecipient = await adapters.readRecipient(spec);
      if (deliveryCorrection ? !canReserveDeliveryCorrection(spec,originalRecipient) : originalRecipient !== null)
        return {status: 'NOT_SENT', reason: 'RECIPIENT_ALREADY_RESERVED'};
      recipientLock = await adapters.reserveRecipient(spec);
    } else recipientLock = {status: 'RESERVED', lease: resumeReservation.lease};
  } else {
    const i = await adapters.reserveIntent(spec);
    if (i?.status !== 'RESERVED') return {status: 'NOT_SENT', reason: 'INTENT_NOT_WON', intent_status: i?.status || 'UNKNOWN'};
    recipientLock = await adapters.reserveRecipient(spec);
  }
  if (recipientLock?.status !== 'RESERVED' || !recipientLock.lease) {
    return {status: 'NOT_SENT', reason: 'RECIPIENT_NOT_WON', intent_branch: intent.branch};
  }
  // Read back both independent provider records, including our unique recipient lease.
  const [remoteIntent, remoteRecipient] = await Promise.all([
    adapters.readIntent(spec), adapters.readRecipient(spec),
  ]);
  if (remoteIntent?.branch !== intent.branch || remoteIntent?.exists !== true
      || remoteRecipient?.status !== 'reserved'
      || remoteRecipient?.lease !== recipientLock.lease
      || !matchesDeliveryCorrectionClaim(spec,remoteRecipient,recipientLock.lease)
      || (resumeReservation && (remoteIntent.ref_sha !== resumeReservation.intent_ref_sha || remoteRecipient.case !== spec.opportunity_id))) {
    return {status: 'NOT_SENT', reason: 'REMOTE_RESERVATION_READBACK_MISMATCH'};
  }
  if (resumeReservation && !recipientPending && (await adapters.renewRecipient(spec, recipientLock.lease))?.status !== 'RENEWED') {
    return {status: 'NOT_SENT', reason: 'ORIGINAL_RESERVATION_CHANGED'};
  }
  await prepareFinalCensus(adapters, spec);
  // Catch a human/direct Gmail send racing during our reservation round-trip.
  const second = verifiedCensus(await adapters.census(spec), {deliveryCorrection});
  if (!second.clear) return {status: 'NOT_SENT', reason: second.reason};
  // Re-read actual mail at the final send boundary, including continuations.
  // Saved case review, urgency and elapsed cooldown never replace this read.
  const latestIncoming = await incomingDecision(adapters, spec);
  if (!latestIncoming.clear) return {status: 'NOT_SENT', ...latestIncoming,
    action: 'Read original inbound messages; positive human reply means HOLD / BRYCE INVOLVED. No automatic reply.'};

  // The saved console re-reads the full current relationship here. Keep this
  // outside the provider-send catch: a denied/failed gate made zero sends and
  // must never be recorded as an ambiguous outgoing-provider outcome.
  if (adapters.beforeSend !== undefined) {
    if (typeof adapters.beforeSend !== 'function') throw new TypeError('beforeSend must be a function');
    const contactState = await adapters.beforeSend(spec);
    if (typeof contactState?.can_contact !== 'boolean') throw new TypeError('beforeSend must return can_contact:boolean');
    if (!contactState.can_contact) return {status: 'NOT_SENT',
      reason: 'RELATIONSHIP_' + (contactState.decision || 'REVIEW_REQUIRED'), contact_state: contactState};
    assertDeliveryCorrectionGate(deliveryCorrection,contactState);
  }

  assertFirstContactClaims({subject,body});

  let sent;
  try {
    // ONLY call to the outgoing mail provider is here. Never automatically replay it.
    sent = await adapters.sendEmail({to: recipient, subject, body, link_id: input.link_id});
  } catch (error) {
    // Only errors created by this local guard establish zero provider calls.
    if (claimGuardFailures.has(error)) throw error;
    return {status: 'SEND_OUTCOME_UNKNOWN', intent_branch: intent.branch,
      recipient_claim_path: path, action: 'reconcile Gmail SENT; do not retry blindly'};
  }
  const id = sent?.id ?? sent?.result?.id;
  if (typeof id !== 'string' || !id.trim()) {
    return {status: 'SEND_OUTCOME_UNKNOWN', intent_branch: intent.branch,
      recipient_claim_path: path, action: 'reconcile Gmail SENT; do not retry blindly'};
  }
  let receipt;
  try { receipt = await adapters.readEmail({message_id: id, link_id: input.link_id}); }
  catch { receipt = null; }
  const read = receipt?.result || receipt;
  if (!matchingSent(read, spec) || read.id !== id) {
    return {status: 'SEND_RECEIPT_UNCERTAIN', message_id: id,
      recipient_claim_path: path, action: 'read this existing Gmail message; do not resend'};
  }
  let completion = 'RECORDED';
  try {
    const recorded = await adapters.completeRecipient(spec, recipientLock.lease, id);
    if (recorded?.status !== 'SENT_RECORDED') completion = 'RECONCILE';
  } catch { completion = 'RECONCILE'; }
  return {status: 'SENT_VERIFIED', message_id: id, intent_branch: intent.branch,
    recipient_claim_path: path, completion};
}

module.exports = {recipientClaimPath, verifiedCensus, verifiedInboundCensus, sendFirstContact, prepareFinalCensus, renderFirstContactTextHtml, assertFirstContactClaims, originalNativeFirstContactArguments, assertNativeResponseFields};

