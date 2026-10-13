'use strict';

/**
 * Receive a complete earlier direct-native contact input as source for the
 * original connected sender. This module only prepares data. The maintained
 * factory owns current reservations, account admission, dispatch and receipts.
 */
const SCHEMA = 'commons.original-first-contact-revision/v1';
const fail = code => { throw Object.assign(new TypeError(code), {code}); };
const clone = value => JSON.parse(JSON.stringify(value));
const present = (value, name, limit = 1000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > limit ||
      /[\x00-\x1f\x7f]/.test(value)) fail('ORIGINAL_CONTACT_' + name + '_INVALID');
  return value;
};

function createOriginalContactInput({sha256Utf8, classifyReturnedGmailRateLimit, attachments, gateway} = {}) {
  if (typeof sha256Utf8 !== 'function' ||
      typeof classifyReturnedGmailRateLimit !== 'function' ||
      (attachments != null && typeof attachments?.prepare !== 'function') ||
      typeof gateway?.recipientClaimPath !== 'function')
    fail('ORIGINAL_CONTACT_MODULES_REQUIRED');
  const hash = value => sha256Utf8(value).sha256;
  const sameHash = (text, expected, name) => {
    if (!/^[a-f0-9]{64}$/.test(expected || '') || hash(text) !== expected)
      fail('ORIGINAL_CONTACT_' + name + '_HASH_CHANGED');
  };

  function prepare({source, identity, attachment_data, received_at = new Date().toISOString()} = {}) {
    if (!source || typeof source.content !== 'string' ||
        source.content.length > 16 * 1024 * 1024) fail('ORIGINAL_CONTACT_COMPLETE_SOURCE_REQUIRED');
    sameHash(source.content, source.sha256, 'SOURCE');
    present(source.ref, 'SOURCE_REF', 2000);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(received_at) ||
        !Number.isFinite(Date.parse(received_at)) ||
        new Date(received_at).toISOString() !== received_at) fail('ORIGINAL_CONTACT_RECEIVED_AT_INVALID');
    let packet;
    try {packet = JSON.parse(source.content);} catch {fail('ORIGINAL_CONTACT_SOURCE_JSON_INVALID');}
    if (packet?.schema !== SCHEMA || !Number.isSafeInteger(packet.revision) || packet.revision < 1)
      fail('ORIGINAL_CONTACT_SOURCE_SCHEMA_INVALID');
    const operation = present(packet.operation_id, 'OPERATION', 300);
    if (packet.body_type !== 'text/plain' || typeof packet.body !== 'string' || !packet.body.trim())
      fail('ORIGINAL_CONTACT_REVIEWED_TEXT_REQUIRED');
    sameHash(packet.body, packet.body_sha256, 'BODY');
    for (const [key, name] of [['sender','SENDER'],['recipient','RECIPIENT'],['subject','SUBJECT'],['link_id','ACCOUNT']])
      present(packet[key], name);
    const prior = packet.previous, request = prior?.request;
    if (!request || typeof request !== 'object' || Array.isArray(request))
      fail('ORIGINAL_CONTACT_PRIOR_REQUEST_REQUIRED');
    sameHash(JSON.stringify(request), prior.request_sha256, 'PRIOR_REQUEST');
    if (request.link_id !== packet.link_id ||
        request.from_address !== packet.sender ||
        request.to !== packet.recipient) fail('ORIGINAL_CONTACT_PRIOR_IDENTITY_CHANGED');
    if (!Array.isArray(prior.attempts) || !prior.attempts.length || prior.attempts.length > 1000)
      fail('ORIGINAL_CONTACT_PRIOR_RETURNS_REQUIRED');
    const returns = prior.attempts.map((attempt, index) => {
      if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt))
        fail('ORIGINAL_CONTACT_PRIOR_RETURN_INVALID');
      sameHash(JSON.stringify(attempt.returned), attempt.returned_sha256, 'PRIOR_RETURN');
      const classification = classifyReturnedGmailRateLimit(attempt.returned);
      if (!classification) fail('ORIGINAL_CONTACT_PRIOR_RETURN_RECONCILIATION_REQUIRED');
      // Keep the source's actual time/window fields. A minute window is not
      // promoted to an invented millisecond timestamp or a reservation event.
      const {returned, returned_sha256, ...observation} = attempt;
      return {source_index:index, observation:clone(observation),
        request_sha256:prior.request_sha256, returned_sha256,
        classification:clone(classification)};
    });
    const organization = present(identity?.prospect_org, 'ORGANIZATION');
    const opportunity = present(identity?.opportunity_id, 'BUSINESS_KEY', 300);
    const touchpoint = present(identity?.touchpoint, 'TOUCHPOINT', 300);
    if (opportunity !== operation) fail('ORIGINAL_CONTACT_BUSINESS_OPERATION_CHANGED');
    const itemId = present(identity?.attachment_item_id, 'ATTACHMENT_ITEM', 200);
    const attachment = packet.attachment;
    if (!attachment || typeof attachment !== 'object') fail('ORIGINAL_CONTACT_ATTACHMENT_REQUIRED');
    const selected = {item_id:itemId, filename:attachment.filename,
      mime_type:attachment.mime_type, bytes:attachment.bytes, sha256:attachment.sha256};
    // Original preparation validates the manifest, complete base64 and every
    // selected file byte; it also retains its canonical runtime representation.
    if (typeof attachments?.prepare !== 'function') fail('ORIGINAL_CONTACT_ATTACHMENT_MODULE_REQUIRED');
    const delivery = attachments.prepare({attachments:[selected], attachment_data});
    const input = {prospect_org:organization, opportunity_id:opportunity, touchpoint,
      to:gateway.recipientClaimPath(packet.recipient).recipient, subject:packet.subject, body:packet.body, link_id:packet.link_id,
      attachments:delivery.attachments, attachment_data:delivery.attachment_data};
    const {attachment_data:fullFiles, ...reviewed} = input;
    const history = {
      schema:'commons.original-first-contact-source/v1',
      operation_id:operation, revision:packet.revision, received_at,
      source:{ref:source.ref, sha256:source.sha256,
        bytes:sha256Utf8(source.content).bytes, content:source.content},
      kind:'direct-native-before-canonical-contact',
      previous_request_sha256:prior.request_sha256,
      historical_returned_attempts:returns,
      current_reviewed_input_sha256:hash(JSON.stringify(reviewed)),
      current_sender:packet.sender,
      current_prepared_at:packet.prepared_at,
      case_source:packet.internal_source?.case_canvas || null
    };
    return {state:'ORIGINAL_INPUT_READY', operation_id:operation, input,
      history, historical_returned_attempts:returns.length};
  }

  /**
   * Receive an unchanged prepared_partner_workshare source, including every
   * complete direct-native rejection. No canonical reservation is invented.
   */
  function prepareNativePartnerWorkshare({source,identity,received_at=new Date().toISOString()}={}) {
    if (!source || typeof source.content !== 'string' || source.content.length > 16 * 1024 * 1024)
      fail('ORIGINAL_CONTACT_COMPLETE_SOURCE_REQUIRED');
    sameHash(source.content,source.sha256,'SOURCE');
    present(source.ref,'SOURCE_REF',2000);
    const iso=value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value;
    if (!iso(received_at)) fail('ORIGINAL_CONTACT_RECEIVED_AT_INVALID');
    let packet;
    try {packet=JSON.parse(source.content);} catch {fail('ORIGINAL_CONTACT_SOURCE_JSON_INVALID');}
    if (packet?.record_kind !== 'prepared_partner_workshare' || !iso(packet.recorded_at))
      fail('ORIGINAL_CONTACT_PARTNER_SOURCE_REQUIRED');
    const operation=present(packet.operation_id,'OPERATION',300);
    const organization=present(identity?.prospect_org,'ORGANIZATION');
    if (identity?.opportunity_id !== operation || identity?.touchpoint !== 'first-contact' ||
        packet.company !== organization)
      fail('ORIGINAL_CONTACT_BUSINESS_OPERATION_CHANGED');
    const sender=packet.sender_account, request=packet.original_native_arguments;
    if (!sender || typeof sender.email !== 'string' || !sender.email.includes('@') ||
        typeof sender.link_id !== 'string' || !/^\d+$/.test(String(sender.profile_id ?? '')) ||
        !request || typeof request !== 'object' || Array.isArray(request))
      fail('ORIGINAL_CONTACT_PRIOR_REQUEST_REQUIRED');
    sameHash(JSON.stringify(request),packet.original_native_arguments_sha256,'PRIOR_REQUEST');
    const message=packet.original_message;
    if (!message || message.to !== request.to || message.subject !== request.subject ||
        message.html !== request.payload?.body?.content || request.payload?.mime_type !== 'text/html')
      fail('ORIGINAL_CONTACT_PRIOR_MESSAGE_CHANGED');
    const input={prospect_org:organization,opportunity_id:operation,touchpoint:'first-contact',
      to:gateway.recipientClaimPath(request.to).recipient,subject:request.subject,
      body:message.html,link_id:sender.link_id,body_type:'text/html',native_arguments:clone(request)};
    if (typeof gateway.originalNativeFirstContactArguments !== 'function')
      fail('ORIGINAL_CONTACT_NATIVE_GATEWAY_REQUIRED');
    const selected=gateway.originalNativeFirstContactArguments(input,sender);
    sameHash(JSON.stringify(selected),packet.original_native_arguments_sha256,'SELECTED_REQUEST');
    if (!Array.isArray(packet.completed_native_returns) || !packet.completed_native_returns.length ||
        packet.completed_native_returns.length > 1000)
      fail('ORIGINAL_CONTACT_PRIOR_RETURNS_REQUIRED');
    const returns=packet.completed_native_returns.map((attempt,index) => {
      if (!attempt || typeof attempt !== 'object' || attempt.ordinal !== index + 1)
        fail('ORIGINAL_CONTACT_PRIOR_RETURN_INVALID');
      const classification=classifyReturnedGmailRateLimit(attempt.raw);
      if (!classification) fail('ORIGINAL_CONTACT_PRIOR_RETURN_RECONCILIATION_REQUIRED');
      const {raw,...observation}=attempt;
      return {source_index:index,observation:clone(observation),
        request_sha256:packet.original_native_arguments_sha256,
        returned_sha256:hash(JSON.stringify(raw)),classification:clone(classification)};
    });
    const history={schema:'commons.original-first-contact-source/v1',
      operation_id:operation,received_at,
      source:{ref:source.ref,sha256:source.sha256,bytes:sha256Utf8(source.content).bytes,content:source.content},
      kind:'direct-native-before-canonical-contact',
      previous_request_sha256:packet.original_native_arguments_sha256,
      historical_returned_attempts:returns,
      current_reviewed_input_sha256:hash(JSON.stringify(input)),
      current_sender:sender.email,source_recorded_at:packet.recorded_at,
      case_source:packet.source_case || null};
    return {state:'ORIGINAL_INPUT_READY',operation_id:operation,input,history,
      historical_returned_attempts:returns.length};
  }

  return Object.freeze({prepare,prepareNativePartnerWorkshare});
}

module.exports = {createOriginalContactInput};
