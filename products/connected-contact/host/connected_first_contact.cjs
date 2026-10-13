'use strict';

// Execute the original first-contact gateway through native connected tools.
// Source loading accepts repository code reviewed by the caller, never provider message bodies.
// The journal is private caller-owned data; store complete native envelopes there.

function loadOriginalContactModules(sources) {
  for (const key of ['hash', 'intent', 'gateway']) {
    if (typeof sources?.[key] !== 'string' || !sources[key]) throw new TypeError('Complete original ' + key + ' source required');
  }
  const hashModule = {exports: {}};
  new Function('module', 'exports', sources.hash)(hashModule, hashModule.exports);
  const {sha256Utf8, sha256Bytes} = hashModule.exports;
  if (typeof sha256Utf8 !== 'function') throw new TypeError('Original connected SHA-256 export required');
  const cryptoBridge = {
    createHash(algorithm) {
      if (algorithm !== 'sha256') throw new TypeError('Original contact modules require SHA-256');
      let text = '', finalized = false;
      const hash = {
        update(value, encoding) {
          if (finalized || typeof value !== 'string' || (encoding !== undefined && encoding !== 'utf8')) throw new TypeError('Complete UTF-8 text hash input required');
          text += value; return hash;
        },
        digest(encoding) {
          if (finalized || encoding !== 'hex') throw new TypeError('One hexadecimal hash result required');
          finalized = true; return sha256Utf8(text).sha256;
        }
      };
      return hash;
    }
  };
  const intentModule = {exports: {}};
  const intentRequire = name => {
    if (name === 'node:crypto') return cryptoBridge;
    throw new TypeError('Unresolved original intent dependency: ' + name);
  };
  new Function('require', 'module', 'exports', sources.intent)(intentRequire, intentModule, intentModule.exports);
  let deliveryCorrection = null;
  if (sources.deliveryCorrection !== undefined) {
    if (typeof sources.deliveryCorrection !== 'string' || !sources.deliveryCorrection)
      throw new TypeError('Complete original delivery correction source required');
    const correctionModule = {exports:{}};
    new Function('require','module','exports',sources.deliveryCorrection)(
      intentRequire,correctionModule,correctionModule.exports);
    deliveryCorrection = correctionModule.exports;
    for (const name of ['readDeliveryCorrection','deliveryCorrectionDigest','reviewedDeliveryMessageIds',
      'assertDeliveryCorrectionGate','canReserveDeliveryCorrection','makeDeliveryCorrectionClaim',
      'matchesDeliveryCorrectionClaim'])
      if (typeof deliveryCorrection[name] !== 'function')
        throw new TypeError('Complete original delivery correction interface required');
  }
  let publicationPolicy = null;
  if (sources.publicationPolicy !== undefined) {
    if (typeof sources.publicationPolicy !== 'string' || !sources.publicationPolicy)
      throw new TypeError('Complete canonical claim-preservation source required');
    const policyModule = {exports:{}};
    new Function('module','exports',sources.publicationPolicy)(policyModule,policyModule.exports);
    if (typeof policyModule.exports.checkClaimPreservation !== 'function')
      throw new TypeError('Canonical checkClaimPreservation export required');
    publicationPolicy = Object.freeze({...policyModule.exports,
      source_sha256:sha256Utf8(sources.publicationPolicy).sha256});
  }
  let contentModule=null;
  if(sources.content!==undefined) {
    if(typeof sources.content!=='string'||!sources.content)
      throw new TypeError('Complete original first-contact content source required');
    contentModule={exports:{}};
    new Function('module','exports',sources.content)(contentModule,contentModule.exports);
    if(typeof contentModule.exports.renderFirstContactTextHtml!=='function')
      throw new TypeError('Original first-contact text renderer export required');
  }
  const gatewayModule = {exports: {}};
  const gatewayRequire = name => {
    if (name === 'node:crypto') return cryptoBridge;
    if (name === './revenue_outbound_intent.cjs') return intentModule.exports;
    if (name === './first_contact_content.cjs' && contentModule) return contentModule.exports;
    if (name === '../commons-publication-policy.cjs' && publicationPolicy) return publicationPolicy;
    if (name === './contact_delivery_correction.cjs' && deliveryCorrection) return deliveryCorrection;
    throw new TypeError('Unresolved original gateway dependency: ' + name);
  };
  new Function('require', 'module', 'exports', sources.gateway)(gatewayRequire, gatewayModule, gatewayModule.exports);
  let attachments = null;
  if (sources.attachments !== undefined) {
    if (typeof sources.attachments !== 'string' || !sources.attachments || typeof sha256Bytes !== 'function')
      throw new TypeError('Complete original attachment and connected binary hash sources required');
    const attachmentModule = {exports:{}};
    new Function('module', 'exports', sources.attachments)(attachmentModule, attachmentModule.exports);
    attachments = attachmentModule.exports.createConnectedContactAttachments({sha256Utf8, sha256Bytes});
  }
  let mailboxAdmission = null;
  if (sources.mailboxAdmission !== undefined) {
    if (typeof sources.mailboxAdmission !== 'string' || !sources.mailboxAdmission)
      throw new TypeError('Complete original mailbox admission source required');
    const admissionModule = {exports:{}};
    new Function('module','exports',sources.mailboxAdmission)(admissionModule,admissionModule.exports);
    if (typeof admissionModule.exports.createConnectedMailboxAdmission !== 'function')
      throw new TypeError('Original mailbox admission export required');
    mailboxAdmission = admissionModule.exports;
  }
  let deliveryNotices = null;
  if (sources.deliveryNotices !== undefined) {
    if (typeof sources.deliveryNotices !== 'string' || !sources.deliveryNotices)
      throw new TypeError('Complete delivery notice source required');
    // These are complete reviewed repository source files, supplied through
    // the same original-source transport as the gateway; never message bodies.
    const sourceMap={...sources.deliveryNoticeSources,
      'host/connected_sha256.cjs':sources.hash,
      'host/connected_delivery_notices.cjs':sources.deliveryNotices};
    const cache=new Map();
    function resolveNoticeModule(from,request) {
      if (!request.startsWith('.')) throw new TypeError('Delivery notice sources require a relative repository module');
      const parts=[];
      for (const part of (from.slice(0,from.lastIndexOf('/')+1)+request).split('/')) {
        if (part==='..') {if (!parts.length) throw new TypeError('Delivery notice source leaves the repository');parts.pop();}
        else if (part && part!=='.') parts.push(part);
      }
      return parts.join('/');
    }
    function noticeSource(path) {
      if (cache.has(path)) return cache.get(path).exports;
      const source=sourceMap[path];
      if (typeof source!=='string' || !source) throw new TypeError('Complete maintained delivery source required: '+path);
      const module={exports:{}};cache.set(path,module);
      new Function('require','module','exports',source)(
        request=>noticeSource(resolveNoticeModule(path,request)),module,module.exports);
      return module.exports;
    }
    const noticeModule={exports:noticeSource('host/connected_delivery_notices.cjs')};
    for (const name of ['readDeliveryNotice','validateDeliveryNotice','appendDeliveryNotice','deliveryState'])
      if (typeof noticeModule.exports[name] !== 'function')
        throw new TypeError('Complete delivery notice interface required');
    deliveryNotices = noticeModule.exports;
  }
  return Object.freeze({sha256Utf8, sha256Bytes, intent: intentModule.exports,
    gateway: gatewayModule.exports, attachments, mailboxAdmission, deliveryCorrection, publicationPolicy, deliveryNotices});
}

// Only this complete connector rejection establishes failure before dispatch.
function classifyReturnedArgumentBindingRejection(raw) {
  const native = raw?.structuredContent, data = native?.error_data;
  const only = (value, keys) => value && typeof value === 'object' &&
    !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
  const message = 'InvalidActionArgumentsError: Invalid action arguments';
  if (raw?.isError !== true || !only(raw,['isError','content','structuredContent']) ||
      !only(native,['error','error_code','error_data']) ||
      native.error !== message || native.error_code !== 'INVALID_ARGUMENT' ||
      !only(data,['type','code','reason','failure_stage']) ||
      data.type !== 'invalid_action_arguments' || data.code !== 'invalid_action_arguments' ||
      data.reason !== 'schema_validation' || data.failure_stage !== 'argument_binding' ||
      !Array.isArray(raw.content) || raw.content.length !== 1 ||
      !only(raw.content[0],['type','text']) || raw.content[0].type !== 'text' ||
      raw.content[0].text !== message) return null;
  return Object.freeze({provider_invoked:false,failure_stage:'argument_binding',
    reason:'schema_validation'});
}

function classifyReturnedGmailHttpRateLimit(raw) {
  // Only the complete returned Gmail HTTP rejection establishes retry eligibility.
  if (!raw || raw.isError !== true) return null;
  const native = raw.structuredContent;
  const data = native?.error_data;
  if (native?.error_code !== 'RATE_LIMITED' || data?.type !== 'http_error' ||
      data.code !== 429 || data.response?.status !== 429 ||
      (data.status !== undefined && data.status !== 429) ||
      (native.status !== undefined && native.status !== 429)) return null;
  if (typeof data.response.payload !== 'string') return null;
  let payload;
  try { payload = JSON.parse(data.response.payload); } catch { return null; }
  if (!payload || Array.isArray(payload) || Object.keys(payload).some(key => key !== 'error')) return null;
  const error = payload.error;
  if (error?.code !== 429 || error.status !== 'RESOURCE_EXHAUSTED' ||
      !Array.isArray(error.errors) || !error.errors.length) return null;
  const pattern = /^User-rate limit exceeded\.\s+Retry after (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) \(Mail sending\)$/;
  const match = pattern.exec(error.message || '');
  if (!match || !Number.isFinite(Date.parse(match[1])) ||
      new Date(match[1]).toISOString() !== match[1]) return null;
  if (error.errors.some(item => item?.domain !== 'global' || item.reason !== 'rateLimitExceeded' ||
      item.message !== error.message)) return null;
  // A mixed error/success or provider message identity requires reconciliation.
  const containsIdentity = value => {
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) =>
      /^(?:id|message_id|messageId|thread_id|threadId|draft_id|draftId|result)$/.test(key) ||
      containsIdentity(child));
  };
  if (containsIdentity(native)) return null;
  return Object.freeze({retry_after: match[1], provider_status: 429,
    provider_reason: 'rateLimitExceeded', provider_service: 'gmail', activity: 'Mail sending'});
}


// This is the connector's own returned method quota, separate from a Gmail
// HTTP rejection. A relative Retry-After is anchored to its retained return;
// consulting the same evidence later must never move the deadline.
function classifyReturnedConnectorRateLimit(raw, observedAt) {
  if (raw?.isError !== true || typeof observedAt !== 'string' ||
      !Number.isFinite(Date.parse(observedAt)) ||
      new Date(observedAt).toISOString() !== observedAt) return null;
  const native = raw.structuredContent, data = native?.error_data;
  if (native?.error_code !== 'RATE_LIMITED' ||
      data?.code !== 'connector_tool_rate_limited' ||
      typeof data.message !== 'string' || data.type !== undefined ||
      data.response !== undefined || data.http_status !== undefined ||
      data.status !== undefined || native.http_status !== undefined ||
      native.status !== undefined) return null;
  const match = /^Tool '(send_email|send_draft)' was rate limited: tool '\1' \(limit ([1-9]\d*) per ([1-9]\d*)s\)\. Try again in (0|[1-9]\d*)s\.$/.exec(data.message);
  if (!match) return null;
  const tool = match[1];
  const [limit,windowSeconds,seconds] = match.slice(2).map(Number);
  if (![limit,windowSeconds,seconds].every(Number.isSafeInteger) ||
      data.retry_after_seconds !== seconds ||
      (native.retry_after_seconds !== undefined && native.retry_after_seconds !== seconds) ||
      (native.retry_after !== undefined && native.retry_after !== String(seconds)) ||
      native.error !== 'ConnectorToolRateLimit: ' + data.message) return null;
  const containsIdentity = value => value && typeof value === 'object' &&
    Object.entries(value).some(([key,child]) =>
      /^(?:id|message_id|messageId|thread_id|threadId|draft_id|draftId|result)$/.test(key) ||
      containsIdentity(child));
  if (containsIdentity(native)) return null;
  if (!Array.isArray(raw.content) || !raw.content.length ||
      raw.content.some(block => block?.type !== 'text' || block.text !== native.error))
    return null;
  const deadline = Date.parse(observedAt) + seconds * 1000;
  if (!Number.isSafeInteger(deadline) || !Number.isFinite(new Date(deadline).getTime()))
    return null;
  return Object.freeze({
    retry_after:new Date(deadline).toISOString(),
    retry_after_seconds:seconds, returned_at:observedAt,
    provider_status:null, provider_reason:'connector_tool_rate_limited',
    provider_service:'connector', activity:'Mail sending',
    rejection_source:'connector',quota_scope:'connector_tool',connector_tool:tool,
    connector_limit:limit,connector_window_seconds:windowSeconds,
    scope:Object.freeze({kind:'connector_tool',
      binding:'mcp__codex_apps__gmail_'+tool,tool}),
    limit:Object.freeze({count:limit,window_seconds:windowSeconds})
  });
}

function classifyReturnedSendRateLimit(raw, observedAt) {
  return classifyReturnedGmailHttpRateLimit(raw) ||
    classifyReturnedConnectorRateLimit(raw,observedAt);
}

// Preserve the published general entrypoint. Callers requiring only Gmail's
// HTTP quota can use classifyReturnedGmailHttpRateLimit explicitly.
function classifyReturnedGmailRateLimit(raw, observedAt) {
  return classifyReturnedSendRateLimit(raw,observedAt);
}


function organizationReviewDomains(values, recipient) {
  if (!Array.isArray(values) || !values.length || values.length > 32)
    throw new TypeError('Supply the reviewed organization domains');
  const domain = value => {
    if (typeof value !== 'string' || value !== value.trim() || value.length > 253 ||
        !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(value) ||
        !value.includes('.') || value.split('.').some(label =>
          !label || label.length > 63 || label.startsWith('-') || label.endsWith('-')))
      throw new TypeError('Use explicit DNS names for the reviewed organization');
    return value.toLowerCase();
  };
  const selected = [...new Set(values.map(domain))].sort();
  if (recipient !== undefined) {
    const address = String(recipient).toLowerCase();
    const target = address.slice(address.lastIndexOf('@') + 1);
    if (!address.includes('@') || !selected.some(item =>
        target === item || target.endsWith('.' + item)))
      throw new TypeError('Organization review must include the original recipient domain');
  }
  return Object.freeze(selected);
}

// This reads a complete native Gmail message. Eligibility is not a relationship
// decision: the original owner must separately review its body and name the
// exact fingerprint in beforeSend. Own drafts and recognized automated notices
// also require that exact review; ordinary incoming correspondence keeps its
// original owner. Draft eligibility never grants permission to send the draft.
function inspectOriginalOrganizationMessage(options) {
  const {native, mailbox, organizationDomains, senderMailboxes, sha256Utf8,
    fingerprintVersion='mime-content-v2'} = options || {};
  if(!['native-payload-v1','mime-content-v2'].includes(fingerprintVersion))
    throw new TypeError('Select the original message fingerprint version');
  const domains = organizationReviewDomains(organizationDomains);
  if (typeof sha256Utf8 !== 'function' || typeof mailbox !== 'string' ||
      !Array.isArray(senderMailboxes) || !senderMailboxes.length)
    throw new TypeError('Original native mailbox identity and hash source required');
  const owned = senderMailboxes.map(value => String(value).toLowerCase());
  const selectedMailbox = mailbox.toLowerCase();
  if (!owned.includes(selectedMailbox))
    throw new TypeError('Inspect only an original configured mailbox');
  const id = native?.id ?? native?.message_id;
  const thread = native?.thread_id ?? native?.threadId;
  const internalDate = native?.internal_date ?? native?.internalDate;
  const labels = native?.label_ids ?? native?.labelIds;
  const headers = native?.payload?.headers;
  const initial = {schema:'commons.organization-correspondence-review/v1',
    mailbox:selectedMailbox,message_id:id,organization_domains:domains,
    eligible:false,decision:'COMPLETE_NATIVE_MESSAGE_REQUIRED'};
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id) ||
      typeof thread !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(thread) ||
      typeof internalDate !== 'string' || !/^[0-9]+$/.test(internalDate) ||
      !Array.isArray(labels) || labels.some(label => typeof label !== 'string') ||
      !Array.isArray(headers) || headers.some(header =>
        typeof header?.name !== 'string' || typeof header?.value !== 'string'))
    return initial;
  const canonical = value => {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
      .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    return JSON.stringify(value);
  };
  // Gmail attachment handles are retrieval capabilities and can rotate on a
  // fresh read of the same message. Preserve their presence, while comparing
  // the complete message body, MIME metadata, attachment names and sizes.
  const contentPart = part => {
    if(!part || typeof part!=='object' || Array.isArray(part))return part;
    const selected={...part};
    if(part.body && typeof part.body==='object' && !Array.isArray(part.body)) {
      selected.body={...part.body};
      for(const field of ['attachment_id','attachmentId'])
        if(typeof selected.body[field]==='string' && selected.body[field].length)
          selected.body[field]='<native-attachment-reference>';
    }
    if(Array.isArray(part.parts))selected.parts=part.parts.map(contentPart);
    return selected;
  };
  const fingerprint = sha256Utf8(canonical({
    id,thread_id:thread,internal_date:internalDate,
    payload:fingerprintVersion==='mime-content-v2'?contentPart(native.payload):native.payload
  }));
  if (!/^[a-f0-9]{64}$/.test(fingerprint?.sha256 || ''))
    throw new TypeError('Complete original message hash required');
  const report = {...initial,thread_id:thread,content_sha256:fingerprint.sha256,
    ...(fingerprintVersion==='mime-content-v2'?{fingerprint_version:fingerprintVersion}:{})};
  const values = name => headers.filter(header => header.name.toLowerCase() === name)
    .map(header => header.value);
  // Accept complete common mailbox lists, including quoted display names.
  // Unrecognized address syntax is retained for owner review, never excluded.
  const list = raw => {
    const pieces = []; let current = '', quoted = false, escaped = false, angle = false;
    for (const char of raw.replace(/\r?\n[ \t]+/g,' ')) {
      if (escaped) {current += char; escaped = false; continue;}
      if (quoted && char === '\\') {current += char; escaped = true; continue;}
      if (char === '"') {quoted = !quoted; current += char; continue;}
      if (!quoted && char === '<') {if (angle) return null; angle = true;}
      if (!quoted && char === '>') {if (!angle) return null; angle = false;}
      if (!quoted && !angle && char === ',') {
        if (!current.trim()) return null;
        pieces.push(current.trim()); current = ''; continue;
      }
      if (!quoted && !angle && /[:;()\r\n]/.test(char)) return null;
      current += char;
    }
    if (quoted || escaped || angle) return null;
    if (current.trim()) pieces.push(current.trim());
    else if (pieces.length) return null;
    const result = [];
    for (const piece of pieces) {
      const angleAddress = piece.match(/^[^<>]*<([^<>]+)>$/);
      const value = (angleAddress ? angleAddress[1] : piece).trim().toLowerCase();
      if (!/^[a-z0-9.!#$%&'*+/=?^_{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(value))
        return null;
      const domain = value.slice(value.lastIndexOf('@') + 1);
      try {organizationReviewDomains([domain]);} catch {return null;}
      result.push(value);
    }
    return result;
  };
  const parsed = {};
  for (const name of ['from','to','cc','bcc','sender','reply-to']) {
    parsed[name] = [];
    for (const value of values(name)) {
      const addresses = list(value);
      if (addresses === null || value.trim() && !addresses.length)
        return {...report,decision:'ADDRESS_SYNTAX_REQUIRES_OWNER_REVIEW'};
      parsed[name].push(...addresses);
    }
  }
  const belongs = address => {
    const domain = address.slice(address.lastIndexOf('@') + 1);
    return domains.some(target => domain === target || domain.endsWith('.' + target));
  };
  const allAddresses = Object.values(parsed).flat();
  const organizationAddresses = allAddresses.filter(belongs);
  if (organizationAddresses.length)
    return {...report,decision:'ORGANIZATION_CORRESPONDENT_PRESENT',
      organization_addresses:[...new Set(organizationAddresses)]};
  if (headers.some(header => /^resent-/i.test(header.name)))
    return {...report,decision:'RESENT_MESSAGE_REQUIRES_OWNER_REVIEW'};
  // An original operator-authored draft can be unrelated work in the same
  // mailbox. Receive it through the same complete sender/body review as sent
  // work, including an internal draft addressed only to configured mailboxes.
  const ownDraft = labels.includes('DRAFT') &&
    !labels.includes('SENT') && !labels.includes('INBOX');
  if (!ownDraft && (!labels.includes('SENT') || labels.includes('INBOX') || labels.includes('DRAFT'))) {
    const unchanged = {...report,decision:'INCOMING_OR_NON_SENT_MESSAGE'};
    if (!labels.includes('INBOX') || labels.includes('SENT') || labels.includes('DRAFT') ||
        values('from').length !== 1 || parsed.from.length !== 1)
      return unchanged;
    const recipients = [...parsed.to,...parsed.cc,...parsed.bcc];
    if (!recipients.includes(selectedMailbox))
      return {...report,decision:'ORIGINAL_MAILBOX_NOT_A_NOTICE_RECIPIENT'};
    const one = name => {
      const found = values(name);
      return found.length === 1 ? found[0].trim() : null;
    };
    const domainOf = address => address.slice(address.lastIndexOf('@') + 1);
    const githubAddress = address => {
      const domain = domainOf(address);
      return domain === 'github.com' || domain.endsWith('.github.com');
    };
    const archive = one('list-archive');
    const repository = typeof archive === 'string'
      ? archive.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/) : null;
    const repositoryName = repository ? repository[1] + '/' + repository[2] : null;
    const githubNotice = repository &&
      parsed.from[0] === 'notifications@github.com' &&
      one('precedence')?.toLowerCase() === 'list' &&
      one('x-auto-response-suppress')?.toLowerCase() === 'all' &&
      one('x-github-recipient-address')?.toLowerCase() === selectedMailbox &&
      typeof one('x-github-sender') === 'string' && !!one('x-github-sender') &&
      typeof one('x-github-reason') === 'string' && !!one('x-github-reason') &&
      one('list-id') === repositoryName + ' <' + repository[2] + '.' + repository[1] + '.github.com>' &&
      one('message-id')?.startsWith('<' + repositoryName + '/') &&
      one('message-id')?.endsWith('@github.com>') &&
      one('subject')?.startsWith('[' + repositoryName + '] ') &&
      allAddresses.every(address => owned.includes(address) || githubAddress(address));
    const internalNotice = parsed.from[0] === 'onboarding@resend.dev' &&
      /^TJLabs private incident notice\s*<onboarding@resend\.dev>$/i.test(one('from') || '') &&
      /^\[TJLabs\] Publication held for Bryce [\u2014-] [a-f0-9]{12}$/.test(one('subject') || '') &&
      /^<[^<>\s]+@email\.amazonses\.com>$/.test(one('message-id') || '') &&
      !!one('x-ses-outgoing') &&
      parsed.to.length > 0 && recipients.every(address => owned.includes(address)) &&
      [...parsed.sender,...parsed['reply-to']].every(address => owned.includes(address));
    if (!githubNotice && !internalNotice) return unchanged;
    const text = []; let incomplete = false;
    const receiveText = part => {
      if (!part || typeof part !== 'object' || part.filename || part.body?.attachment_id) {
        incomplete = true; return;
      }
      const mime = part.mime_type ?? part.mimeType;
      if (mime === 'text/plain' || mime === 'text/html') {
        if (typeof part.body?.content !== 'string' ||
            !part.body.content.length && part.body.size !== 0) incomplete = true;
        else text.push(part.body.content);
      } else if (typeof mime !== 'string' || !mime.startsWith('multipart/')) incomplete = true;
      if (part.parts !== undefined && part.parts !== null) {
        if (!Array.isArray(part.parts)) incomplete = true;
        else part.parts.forEach(receiveText);
      }
    };
    receiveText(native.payload);
    if (incomplete || !text.length)
      return {...report,decision:'COMPLETE_NOTICE_BODY_REQUIRED'};
    const searchable = [...headers.map(header => header.value),...text].join('\n').toLowerCase();
    if (domains.some(domain => searchable.includes(domain)))
      return {...report,decision:'ORGANIZATION_REFERENCE_REQUIRES_OWNER_REVIEW'};
    if (internalNotice) {
      const normalized = text.join('\n').replace(/\r\n/g,'\n');
      if (!normalized.startsWith('Bryce,\n\nThe publishing service held this proposed outgoing communication under your incident policy.') ||
          !/\nOperation: [^\n]+\n/.test(normalized) ||
          !normalized.includes('\nExact proposed content:\n'))
        return unchanged;
    }
    return {...report,eligible:true,decision:'UNRELATED_AUTOMATED_NOTICE',
      notice_kind:githubNotice ? 'github_repository_notification' : 'internal_publication_notice',
      from:parsed.from[0],recipients:[...new Set(recipients)]};
  }
  if (values('from').length !== 1 || parsed.from.length !== 1 ||
      parsed.from[0] !== selectedMailbox)
    return {...report,decision:'ORIGINAL_MAILBOX_NOT_THE_SENDER'};
  if (parsed.sender.some(address => !owned.includes(address)) ||
      parsed['reply-to'].some(address => !owned.includes(address)))
    return {...report,decision:'DELEGATED_SENDER_REQUIRES_OWNER_REVIEW'};
  const recipients = [...parsed.to,...parsed.cc,...parsed.bcc];
  // A retained own draft may have no addressee. It still requires the exact
  // complete-message review below; sent internal mail keeps its original rule.
  if (!ownDraft && (!parsed.to.length || !recipients.some(address => !owned.includes(address))))
    return {...report,decision:'INTERNAL_OR_SELF_CORRESPONDENCE'};
  let textParts = 0, incompleteText = false;
  const inspectPart = part => {
    if (!part || typeof part !== 'object') {incompleteText = true; return;}
    const mime = part.mime_type ?? part.mimeType;
    if (mime === 'text/plain' || mime === 'text/html') {
      textParts++;
      const body = part.body;
      if (!body || typeof body !== 'object' ||
          !(typeof body.content === 'string' && (body.content.length || body.size === 0)) &&
          !(typeof body.base64_url_content === 'string' && body.base64_url_content.length))
        incompleteText = true;
    }
    if (part.parts !== undefined && part.parts !== null) {
      if (!Array.isArray(part.parts)) incompleteText = true;
      else part.parts.forEach(inspectPart);
    }
  };
  inspectPart(native.payload);
  if (!textParts || incompleteText)
    return {...report,decision:'COMPLETE_MESSAGE_BODY_REQUIRED'};
  return {...report,eligible:true,
    decision:ownDraft ? 'OWN_DRAFT_OTHER_ORGANIZATION' : 'OWN_OUTBOUND_OTHER_ORGANIZATION',
    from:parsed.from[0],recipients:[...new Set(recipients)]};
}

function selectConnectedGitActor(tools, requestedAction) {
  const choices = ['github_get_profile', 'github_get_user_login'];
  if (requestedAction !== undefined && !choices.includes(requestedAction))
    throw new TypeError('Select the native github_get_profile or github_get_user_login actor reader');
  // Select an available capability before any invocation. A provider error
  // never causes an automatic retry, account change or alternate identity read.
  const action = requestedAction === undefined
    ? choices.find(name => typeof tools?.['mcp__codex_apps__' + name] === 'function')
    : requestedAction;
  if (!action || typeof tools?.['mcp__codex_apps__' + action] !== 'function')
    throw new TypeError('Missing selected native GitHub actor reader');
  return Object.freeze({action, binding:'mcp__codex_apps__' + action,
    expected_id:'293286387', expected_login:'woahwhattheheck',
    login_field:action === 'github_get_profile' ? 'nickname' : 'login'});
}

function selectConnectedGitRef(tools, requestedAction) {
  const choices = ['github_fetch', 'github_fetch_commit'];
  if (requestedAction !== undefined && !choices.includes(requestedAction))
    throw new TypeError('Select the native github_fetch_commit or github_fetch ref reader');
  // Prefer the exact Git ref resource so branch reads retain its complete small
  // response. The commit reader remains available when it is the only binding.
  // An explicit choice is fixed before invocation; provider results never switch it.
  const action = requestedAction === undefined
    ? choices.find(name => typeof tools?.['mcp__codex_apps__' + name] === 'function')
    : requestedAction;
  if (!action || typeof tools?.['mcp__codex_apps__' + action] !== 'function')
    throw new TypeError('Missing selected native GitHub ref reader');
  return Object.freeze({action, binding:'mcp__codex_apps__' + action,
    expected_repository:'woahwhattheheck/commons'});
}

function createConnectedFirstContact(options) {
  const {tools, input, modules, load, store, stateKey, lease, organizationQuery, organizationDomains, beforeSend, beforeNativeSend, githubActorAction, githubRefAction, nativeDraft, storage} = options || {};
  if(storage && (storage.kind!=='commons.connected-contact-local-state/v1' || typeof storage.verify!=='function' || typeof storage.read!=='function' || typeof storage.compareAndSwap!=='function' || typeof storage.receive!=='function'))
    throw new TypeError('Use the selected complete private contact coordinator.');
  const repository = 'woahwhattheheck/commons';
  const nativeSendBinding = nativeDraft ? 'mcp__codex_apps__gmail_send_draft' : 'mcp__codex_apps__gmail_send_email';
  if (nativeDraft && (typeof nativeDraft.receive !== 'function' ||
      typeof nativeDraft.metadata !== 'function' ||
      JSON.stringify(nativeDraft.metadata(input?.native_draft)) !== JSON.stringify(nativeDraft.identity)))
    throw new TypeError('The complete original reviewed draft receiver is required');
  if (input?.native_draft !== undefined && !nativeDraft)
    throw new TypeError('Open this original Gmail draft through the maintained draft receiver');
  const configured=options.mailboxes||modules?.mailboxes;
  if(!Array.isArray(configured)||configured.length!==2||
     configured.some((m,i)=>!m||m.name!==['business','secondary'][i]||typeof m.link_id!=='string'||!m.link_id||
       !/^\d+$/.test(String(m.id))||typeof m.email!=='string'||!/^[^@\s]+@[^@\s]+$/.test(m.email))||
     new Set(configured.map(m=>m.link_id)).size!==2||new Set(configured.map(m=>String(m.id))).size!==2)
    throw new TypeError('Supply the original private business/secondary mailbox configuration; no account is selected by default.');
  const mailboxes=configured.map(m=>Object.freeze({name:m.name,link_id:m.link_id,id:String(m.id),email:m.email}));
  const actorSelection = selectConnectedGitActor(tools, githubActorAction);
  const actorAction = actorSelection.action;
  const refSelection = selectConnectedGitRef(tools, githubRefAction);
  const refAction = refSelection.action;
  const bindings = [
    actorAction, refAction, 'github_fetch_file', 'gmail_get_profile', 'gmail_search_email_ids',
    nativeDraft ? 'gmail_send_draft' : 'gmail_send_email', 'gmail_read_email',
    ...(nativeDraft ? ['gmail_list_drafts'] : [])
  ].map(name => 'mcp__codex_apps__' + name);
  for (const binding of bindings) if (typeof tools?.[binding] !== 'function') throw new TypeError('Missing native binding: ' + binding);
  if (typeof load !== 'function' || typeof store !== 'function' || typeof stateKey !== 'string' || !stateKey) throw new TypeError('Private retained state required');
  if (typeof lease !== 'string' || !lease || /[\x00-\x1f\x7f]/.test(lease)) throw new TypeError('Stable original operation lease required');
  if (typeof modules?.gateway?.sendFirstContact !== 'function' || typeof modules?.intent?.reserveIntent !== 'function' ||
      typeof modules?.sha256Utf8 !== 'function') throw new TypeError('Original contact modules required');
  if (beforeSend !== undefined && typeof beforeSend !== 'function') throw new TypeError('beforeSend must be the original relationship callback');
  if (beforeNativeSend !== undefined && typeof beforeNativeSend !== 'function') throw new TypeError('beforeNativeSend must be the original exact-payload guard');
  if (organizationQuery !== undefined && (typeof organizationQuery !== 'string' || !organizationQuery.trim())) throw new TypeError('Original organization query must be nonempty');
  if (input?.source_items?.length)
    throw new TypeError('Prepare selected sources through the original console source-link transport');
  if (input?.source_links !== undefined && !Array.isArray(input.source_links))
    throw new TypeError('Original reviewed source-link array required');
  if (input?.source_links?.length && !input?.delivery_correction)
    throw new TypeError('Use the original console source-link transport for selected shared sources');
  if (input?.delivery_correction != null &&
      (typeof modules.deliveryCorrection?.readDeliveryCorrection !== 'function' ||
       typeof beforeSend !== 'function' ||
       input.body_type !== undefined && input.body_type !== 'text/plain'))
    throw new TypeError('Original correction proof, plain-text preview and current case callback required');
  // Own every structured field admitted to the immutable reviewed message.
  const frozenJson = value => {
    const freeze = item => {
      if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); }
      return item;
    };
    return freeze(JSON.parse(JSON.stringify(value)));
  };
  for (const key of ['attachments', 'attachment_data'])
    if (input?.[key] !== undefined && !Array.isArray(input[key]))
      throw new TypeError('Original selected attachment arrays required');
  if (!input?.attachments?.length && input?.attachment_data?.length)
    throw new TypeError('Original selected attachment manifest required');
  if (input?.delivery_correction?.mode === 'ADMINISTRATOR_RECIPIENT_CORRECTION' &&
      (typeof modules.deliveryCorrection?.administratorCorrection!=='function' ||
       typeof modules.deliveryCorrection?.assertAdministratorRecipientSources!=='function'))
    throw new TypeError('Load the complete administrator-recipient source contract');
  if (input?.delivery_correction?.mode === 'PUBLISHED_RECIPIENT_CORRECTION' &&
      (typeof modules.deliveryCorrection?.recipientCorrection!=='function' ||
       typeof modules.deliveryCorrection?.recipientCorrectionSource!=='function' ||
       typeof modules.deliveryCorrection?.assertRecipientSources!=='function'))
    throw new TypeError('Load the complete published-recipient source contract');
  if (input?.delivery_correction?.mode === 'RELATED_COMPANY_RECIPIENT_CORRECTION' &&
      (typeof modules.deliveryCorrection?.recipientCorrection!=='function' ||
       typeof modules.deliveryCorrection?.assertRelatedCompanyRecipientSources!=='function' ||
       typeof modules.deliveryCorrection?.readRelatedCompanySource!=='function'))
    throw new TypeError('Load the complete related-company recipient source contract');
  const delivery = input?.attachments?.length ? (() => {
    if (typeof modules.attachments?.prepare !== 'function' ||
        typeof modules.attachments?.payload !== 'function' || typeof modules.attachments?.receive !== 'function')
      throw new TypeError('Load the original connected attachment module for selected files');
    return modules.attachments.prepare(input);
  })() : null;
  const sender = mailboxes.find(mailbox => mailbox.link_id === input?.link_id);
  if (!sender) throw new TypeError('Explicit original business or secondary mailbox required');
  const {recipient, path} = modules.gateway.recipientClaimPath(input.to);
  for (const key of ['prospect_org', 'opportunity_id', 'touchpoint', 'subject', 'body']) {
    if (typeof input[key] !== 'string' || !input[key].trim()) throw new TypeError('Complete reviewed ' + key + ' required');
  }
  if (/[\r\n]/.test(input.subject)) throw new TypeError('One subject line required');
  const nativeArguments = modules.gateway.originalNativeFirstContactArguments
    ? modules.gateway.originalNativeFirstContactArguments(input,sender,modules.attachments) : null;
  if (input.native_arguments !== undefined && !nativeArguments)
    throw new TypeError('Load the original native-envelope gateway with this selected input');
  const reviewed = Object.freeze({
    prospect_org: input.prospect_org, opportunity_id: input.opportunity_id, touchpoint: input.touchpoint,
    to: recipient, subject: input.subject, body: input.body, link_id: input.link_id,
    ...(nativeArguments ? {body_type:input.body_type,native_arguments:frozenJson(nativeArguments)} : {}),
    ...(nativeDraft ? {native_draft:frozenJson(nativeDraft.identity)} : {}),
    ...(delivery ? {attachments:delivery.attachments} : {}),
    ...(input.document_archives != null ? {document_archives:frozenJson(input.document_archives)} : {}),
    ...(input.delivery_correction != null ? {body_type:'text/plain',
      delivery_correction:frozenJson(input.delivery_correction),
      ...(input.source_links?.length ? {source_links:frozenJson(input.source_links)} : {})} : {})
  });
  const reviewedOrganizationDomains = organizationDomains === undefined ? null
    : organizationReviewDomains(organizationDomains, reviewed.to);
  if (reviewedOrganizationDomains && (!organizationQuery || typeof beforeSend !== 'function'))
    throw new TypeError('An explicit organization review uses the original query and relationship callback');
  const correction = modules.deliveryCorrection;
  const deliveryCorrection = correction?.readDeliveryCorrection(reviewed) || null;
  if (reviewed.document_archives != null) {
    if (typeof correction?.readContactDocumentArchives !== 'function')
      throw new TypeError('Load the original document-archive review contract with the reviewed input');
    correction.readContactDocumentArchives(reviewed,{required:true});
  }
  if (deliveryCorrection && deliveryCorrection.mailbox !== sender.email)
    throw new TypeError('Delivery correction keeps its original verified sender');
  const intent = modules.intent.fingerprint(reviewed);
  const identity = modules.sha256Utf8(JSON.stringify(reviewed)).sha256;
  const html = nativeArguments ? reviewed.body : modules.gateway.renderFirstContactTextHtml(reviewed.body);
  function assertFinalContactClaims(args = rateNativeArguments()) {
    if (nativeDraft) {
      if (JSON.stringify(args) !== JSON.stringify(nativeDraft.sendArguments))
        throw new TypeError('Original native draft send arguments changed');
      args = reviewedNativeArguments();
    }
    if (!nativeDraft) {
      if (typeof modules.gateway.assertNativeResponseFields !== 'function')
        throw new TypeError('Load the maintained native response-field gateway before sending');
      modules.gateway.assertNativeResponseFields(args);
    }
    if (typeof modules.gateway.assertFirstContactClaims !== 'function')
      throw new TypeError('Load the maintained original gateway and canonical claim-preservation source before sending');
    if (args?.subject !== reviewed.subject)
      throw new TypeError('Original final subject changed');
    return modules.gateway.assertFirstContactClaims({
      subject:args.subject, body:reviewed.body, payload:args.payload,
      ...(nativeArguments ? {body_type:reviewed.body_type} : {})});
  }
  let journal = load(stateKey);
  if (journal && (journal.schema !== 'commons.connected-first-contact/v1' || journal.input_sha256 !== identity || journal.lease !== lease)) {
    throw new TypeError('Retained contact input or original lease changed');
  }
  if (!journal) journal = {schema: 'commons.connected-first-contact/v1', input_sha256: identity, input: reviewed, lease, events: [], outcome: null};
  store(stateKey, journal);
  const openedReturnedMailboxRevision=journal.returned_mailbox_revision?.selection_id || null;
  function assertCurrentReview() {
    const current = load(stateKey);
    if (current?.schema !== 'commons.connected-first-contact/v1' ||
        current.input_sha256 !== identity || current.lease !== lease ||
        (current.returned_mailbox_revision?.selection_id || null) !== openedReturnedMailboxRevision)
      throw new TypeError('Reopen the original contact with its current reviewed input revision');
  }
  let publicCalls = 0, mailboxSelectionActive = false;
  const record = event => {
    assertCurrentReview();
    const retained = {...event, observed_at:new Date().toISOString()};
    journal.events.push(retained);
    store(stateKey,journal);
    return retained;
  };
  const retainOutcome = outcome => {journal.outcome = outcome; store(stateKey, journal); return outcome;};
  const accountOperationKey = modules.sha256Utf8(
    JSON.stringify({input_sha256:identity,lease})).sha256;
  let mailboxAdmission = null, activeAccountAttempt = null;
  function originalMailboxAdmission() {
    if (!mailboxAdmission) {
      const create = modules.mailboxAdmission?.createConnectedMailboxAdmission;
      if (typeof create !== 'function')
        throw new TypeError('Load the maintained original mailbox admission source before sending');
      mailboxAdmission = create({tools,storage,sha256Utf8:modules.sha256Utf8,
        classifyReturnedGmailRateLimit,classifyReturnedSendRateLimit,account:sender,
        send_binding:nativeSendBinding,githubRefAction:refAction,
        verificationScope:{operation_key:accountOperationKey,input_sha256:identity,operation_lease:lease},
        history:() => journal.events.filter(event=>event.phase==='account-admission').map(event=>event.event),
        record:event => record({phase:'account-admission',event})});
      for (const key of ['inspect','prepareUsage','acquire','confirm','observe','observeReturnedLimit','release','refreshAutomationUsage'])
        if (typeof mailboxAdmission?.[key] !== 'function')
          throw new TypeError('Load the complete paired sender and returned-limit admission source');
      if (mailboxAdmission.manual_headroom !== 'rolling_usage_v2')
        throw new TypeError('Load the owner-requested manual-headroom admission source');
      if (mailboxAdmission.returned_dispatch_identity !== 'charged_token_v1')
        throw new TypeError('Load the paired original charged-token return receiver');
      if (mailboxAdmission.returned_limit_scope !== 'connector_tool_and_gmail_profile')
        throw new TypeError('Original admission must retain the connector method scope');
    }
    return mailboxAdmission;
  }
  async function receiveOriginalAccountReturn(args,raw,observedAt,originalAttempt=null) {
    const classified = classifyReturnedSendRateLimit(raw,observedAt);
    // Retain the method's actual originating invocation. A method-name quota
    // alone does not establish a deadline for another configured account.
    if(originalAttempt && (originalAttempt.lease?.operation_key!==accountOperationKey ||
        originalAttempt.lease.attempt_key!==originalAttempt.attempt_key ||
        !/^[a-f0-9]{64}$/.test(originalAttempt.lease.token || '')))
      throw new TypeError('Receive the original charged account attempt');
    const observation = await originalMailboxAdmission().observeReturnedLimit({
      args,raw,operation_key:accountOperationKey,observed_at:observedAt,
      source_account:sender,
      ...(originalAttempt?{attempt_key:originalAttempt.attempt_key,
        dispatch_token:originalAttempt.lease.token}:{})});
    if (classified) {
      if (!['PROVIDER_DEADLINE_RECORDED','PROVIDER_DEADLINE_RETAINED'].includes(observation?.status) ||
          !Number.isFinite(Date.parse(observation.retry_after)) ||
          Date.parse(observation.retry_after) < Date.parse(classified.retry_after))
        throw Object.assign(new TypeError('Original returned send deadline still needs admission receiving'),
          {account_readback:observation,source_account:sender.id});
    } else if (observation?.status !== 'NOT_A_RETURNED_GMAIL_RATE_LIMIT')
      throw new TypeError('Original account observation is incomplete');
    if (classified?.scope?.kind === 'connector_tool')
      record({phase:'connector-limit-received',operation_key:accountOperationKey,
        source_account:{id:sender.id,email:sender.email,link_id:sender.link_id},
        scope:classified.scope,retry_after:classified.retry_after,
        returned_at:observedAt,return_sha256:modules.sha256Utf8(JSON.stringify(raw)).sha256,
        observations:[{profile_id:sender.id,...observation}]});
    return observation;
  }
  async function releaseOriginalAccountLease(active,outcome) {
    const released = await originalMailboxAdmission().release(active.lease,{outcome});
    if (!['RELEASED','ORIGINAL_LEASE_NO_LONGER_ACTIVE'].includes(released?.status))
      throw Object.assign(new TypeError('Original account lease still needs release receiving'),
        {account_readback:released});
    record({phase:'account-attempt-released',operation_key:accountOperationKey,
      attempt_key:active.attempt_key,returned:!!active.returned,result:released});
    active.next_turn = released.next_turn || null;
    return released;
  }
  async function acquireOriginalAccountAttempt(boundary, scope = 'PRE_SEND_CENSUS') {
    if (accountBoundary !== boundary || boundary.attempt_key || boundary.account_attempt)
      throw new TypeError('One account attempt in the original operation boundary required');
    // Resolve the unchanged reviewed envelope before acquiring the original lease.
    // An invalid attachment/source argument must not strand a won account token.
    const args = rateNativeArguments();
    const attemptKey = modules.sha256Utf8(rateCanonical({
      schema:'commons.connected-account-attempt/v1',operation_key:accountOperationKey,
      input_sha256:identity,operation_lease:lease,journal_events:journal.events.length,
      observed_at:new Date().toISOString(),nonce:Math.random()
    })).sha256;
    record({phase:'account-attempt-prepared',operation_key:accountOperationKey,
      attempt_key:attemptKey,scope});
    boundary.attempt_key = attemptKey;
    let admission;
    try {
      const usage = await originalMailboxAdmission().prepareUsage({operation_key:accountOperationKey});
      admission = ['AUTOMATION_USAGE_REFRESHING','AUTOMATION_USAGE_REQUIRED'].includes(usage?.status)
        ? usage : await originalMailboxAdmission().acquire({
          operation_key:accountOperationKey,attempt_key:attemptKey,operation_lease:lease});
    } catch (error) {
      record({phase:'account-acquire-unfinished',operation_key:accountOperationKey,
        attempt_key:attemptKey,message:String(error.message || error)});
      deferAccount({status:'ACCOUNT_ADMISSION_UNAVAILABLE',operation_key:accountOperationKey,
        attempt_key:attemptKey});
    }
    if (admission?.status !== 'ACQUIRED') deferAccount(admission);
    if (admission.lease === undefined || admission.lease === null)
      throw new TypeError('Original acquired account lease required');
    const active = {args,lease:admission.lease,
      account_key:admission.account_key,attempt_key:attemptKey,
      invoked:null,returned:null,observed:false,terminated:false,finished:false};
    boundary.account_attempt = active;
    record({phase:'account-attempt-acquired',operation_key:accountOperationKey,
      attempt_key:attemptKey,lease:admission.lease,scope,
      accepted_write:admission.accepted_write || null,state_sha:admission.state_sha || null,
      commit_sha:admission.commit_sha || null,revision:admission.revision ?? null,
      ...(admission.storage_receipt?{storage_receipt:admission.storage_receipt,
        source_commit_sha:admission.source_commit_sha,source_state_sha:admission.source_state_sha}:{})});
    return active;
  }
  async function finishOriginalAccountAttempt(active) {
    if (!active || active.finished) return;
    active.finished = true;
    if (activeAccountAttempt === active) activeAccountAttempt = null;
    if (!active.invoked || active.observed || active.terminated) {
      try {
        await releaseOriginalAccountLease(active,active.terminated ? 'ORIGINAL_CALL_TERMINATED'
          : active.invoked ? 'NATIVE_RETURNED' : 'NOT_INVOKED');
      } catch (error) {
        // Preserve the real provider return or proved-unused preflight even when
        // the original token needs release receiving after this call finishes.
        record({phase:'account-attempt-release-failed',operation_key:accountOperationKey,
          attempt_key:active.attempt_key,invoked:!!active.invoked,returned:!!active.returned,
          terminated:active.terminated,message:String(error.message || error),
          ...(error.account_readback ? {account_readback:error.account_readback} : {})});
      }
    } else record({phase:'account-attempt-reconciliation',operation_key:accountOperationKey,
      attempt_key:active.attempt_key,returned:!!active.returned,
      reason:active.returned ? 'ACCOUNT_OBSERVATION_UNFINISHED' : 'PROVIDER_RETURN_UNRESOLVED'});
  }
  // Preserve native protocol fields separately from a numeric HTTP status.
  // A Google search RATE_LIMIT_EXCEEDED with no HTTP response/deadline remains
  // that exact read failure; it never becomes a returned Gmail send rejection.
  function nativeFailureDetails(raw) {
    const value = raw?.structuredContent;
    const data = value?.error_data;
    const response = data?.response;
    const candidates = [response?.status,value?.http_status,data?.http_status,
      data?.status,value?.status,data?.code];
    const httpStatus = candidates.find(item =>
      (typeof item === 'number' || typeof item === 'string' && /^[1-5][0-9]{2}$/.test(item)) &&
      Number.isInteger(Number(item)) && Number(item) >= 100 && Number(item) <= 599);
    const scalar = item => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean';
    const fields = {error_code:value?.error_code,type:data?.type,code:data?.code,
      status:data?.status,reason:data?.reason,
      message:value?.error || data?.message || 'Native provider error',
      http_status:httpStatus === undefined ? null : Number(httpStatus)};
    const result = Object.fromEntries(Object.entries(fields).filter(([,item])=>item === null || scalar(item)));
    const retainedHeaders = {};
    const allowedHeaders = new Set(['retry-after','ratelimit-reset','ratelimit-remaining',
      'x-ratelimit-reset','x-ratelimit-remaining','x-ratelimit-resource',
      'x-github-request-id','x-request-id','request-id']);
    for (const source of [value?.headers,data?.headers,response?.headers]) {
      const entries = Array.isArray(source) ? source.filter(item=>Array.isArray(item) && item.length===2)
        : source && typeof source === 'object' ? Object.entries(source) : [];
      for (const [key,item] of entries) {
        const name = String(key).toLowerCase();
        if (allowedHeaders.has(name) && scalar(item)) retainedHeaders[name] = item;
      }
    }
    if (Object.keys(retainedHeaders).length) result.headers = retainedHeaders;
    for (const key of ['retry_after','retry_after_seconds','retry_after_ms','reset_at','request_id']) {
      const item = response?.[key] ?? data?.[key] ?? value?.[key];
      if (scalar(item)) result[key] = item;
    }
    return frozenJson(result);
  }
  function nativeValue(raw, binding) {
    if (raw?.isError) {
      const provider = nativeFailureDetails(raw);
      throw Object.assign(new Error(provider.message), {
        status:provider.http_status,code:provider.code ?? provider.error_code ?? null,
        provider_error:provider,native_result:raw
      });
    }
    const value = raw?.structuredContent;
    if (value === undefined || value === null) throw new TypeError('Native structured result required');
    // fetch returns REST JSON inside content; fetch_file returns literal file text.
    if (binding === 'mcp__codex_apps__github_fetch') {
      if (typeof value.content !== 'string') throw new TypeError('Native GitHub REST content required');
      return JSON.parse(value.content);
    }
    return value;
  }
  const nativeFailures = new WeakMap();
  async function invoke(binding, args, provenance = {}) {
    if(/^mcp__codex_apps__github_(?:create|update|delete|merge)/.test(binding))
      throw Object.assign(new Error('Private Git state mutations have moved to the selected original local coordinator.'),{code:'CONTACT_LOCAL_STORAGE_REQUIRED'});
    const selectedArgs = frozenJson(args);
    const gmail = binding === nativeSendBinding;
    const accountAttempt = gmail ? activeAccountAttempt : null;
    if (gmail) {
      try {
        if (!accountAttempt || rateCanonical(accountAttempt.args) !== rateCanonical(selectedArgs))
          throw new TypeError('Original account admission required for this Gmail invocation');
        if (delivery) {
          if (typeof modules.attachments.assertGmailPayload !== 'function')
            throw new TypeError('Load the current original attachment module for Gmail delivery.');
          // Validate the exact new payload before recording or dispatching Gmail.
          // Historical SENT/DSN receiving remains on its original path.
          modules.attachments.assertGmailPayload(nativeDraft ? reviewedNativeArguments().payload : selectedArgs.payload);
        }
        assertFinalContactClaims(selectedArgs);
      } catch (error) {
        const failure = {name:String(error?.name || 'Error'),
          message:String(error?.message || error),
          status:typeof error?.status === 'number' && Number.isFinite(error.status) ? error.status : null,
          ...(typeof error?.code === 'string' ? {code:error.code} : {})};
        record({phase:'gmail-pre-dispatch-rejected',binding,
          input_sha256:identity,operation_lease:lease,operation_key:accountOperationKey,
          attempt_key:accountAttempt?.attempt_key || null,
          args_sha256:modules.sha256Utf8(rateCanonical(selectedArgs)).sha256,
          gmail_invocations:sendInvocationCount(),failure});
        if (accountBoundary && sendInvocationCount() === accountBoundary.gmail_invocations)
          accountBoundary.local_preflight_error = error;
        throw error;
      }
    }
    const invocationEvent = journal.events.length;
    const argsSha256 = modules.sha256Utf8(rateCanonical(selectedArgs)).sha256;
    const call = {invocation_event:invocationEvent,args_sha256:argsSha256,
      call_id:modules.sha256Utf8(rateCanonical({operation_key:accountOperationKey,
        binding,invocation_event:invocationEvent,args_sha256:argsSha256})).sha256,
      ...(typeof selectedArgs.link_id === 'string' ? {link_id:selectedArgs.link_id} : {})};
    const invoking = record({...provenance,phase:'invoking',binding,args:selectedArgs,...call});
    if (accountAttempt) accountAttempt.invoked = invoking;
    let returned = null, returnedIndex = null, receivedRaw = null, providerReturned = false;
    try {
      const raw = await tools[binding](selectedArgs);
      receivedRaw = raw; providerReturned = true;
      // Each complete return names its original invocation even when other
      // accounts or identical bindings return in a different order.
      returnedIndex = journal.events.length;
      returned = record({phase:'returned',binding,...call,raw});
      if (accountAttempt) {
        accountAttempt.returned = returned;
        await receiveOriginalAccountReturn(selectedArgs,raw,returned.observed_at,accountAttempt);
        accountAttempt.observed = true;
      }
      return nativeValue(raw, binding);
    } catch (error) {
      const failure = frozenJson({binding,...call,returned_event:returnedIndex,
        name:String(error?.name || 'Error'),message:String(error?.message || error),
        status:typeof error?.status === 'number' && Number.isFinite(error.status) ? error.status : null,
        ...(error?.provider_error ? {provider:error.provider_error} : {})});
      if (error && (typeof error === 'object' || typeof error === 'function')) {
        nativeFailures.set(error,failure);
        try { Object.defineProperty(error,'native_failure',{value:failure,configurable:true}); } catch {}
      }
      record({phase:'failed',binding,...call,returned_event:returnedIndex,
        status:failure.status,message:failure.message,native_failure:failure});
      if (accountAttempt && !accountAttempt.returned) {
        // A local journal failure after the native response must leave this
        // original account return for receiving, not label it a lost call.
        if (providerReturned) accountAttempt.returned = {
          phase:'returned',binding,...call,raw:receivedRaw,
          observed_at:new Date().toISOString()};
        else accountAttempt.terminated = true;
      }
      throw error;
    }
  }
  // Keep account scheduling in the same original operation. The account owner
  // calls deferAccount(decision) only before its one native Gmail invocation.
  let accountBoundary = null;
  const accountDeferredSignal = Symbol('original-account-deferral');
  function receivedRateHistory() {
    if (!journal.recovered_rate_history) return null;
    if (typeof modules.checkpoints?.validateReceivedRateHistory !== 'function')
      throw new TypeError('Load the original durable checkpoint reader for this received provider history');
    return modules.checkpoints.validateReceivedRateHistory({
      history:journal.recovered_rate_history,reviewed,args:rateNativeArguments(),lease,intent,path,
      sha256Utf8:modules.sha256Utf8,classifyReturnedGmailRateLimit:classifyReturnedSendRateLimit});
  }
  function validateLocalGuardWitness(witness) {
    const fail = message => {throw new TypeError(message);};
    const binding = nativeSendBinding;
    const historical = reviewedRuntime(witness?.runtime_input);
    if (witness?.schema !== 'commons.contact-local-guard-witness/v1' ||
        witness.input_sha256 !== historical.identity || witness.operation_lease !== lease ||
        witness.intent_branch !== intent.branch || witness.recipient_claim_path !== path ||
        witness.native_binding_invoked !== false ||
        witness.guard_argument !== 'args.body' ||
        witness.native_body_argument !== 'args.payload.body.content' ||
        witness.guard_before_native_binding !== true ||
        typeof witness.source_fragment !== 'string' ||
        !witness.source_fragment.includes('requireClaim(args.body, args.subject)') ||
        !Number.isSafeInteger(witness.invocation_event) || witness.invocation_event < 0 ||
        witness.failed_event !== witness.invocation_event + 1 ||
        !Number.isSafeInteger(witness.event_count) || witness.event_count <= witness.failed_event ||
        witness.event_count > journal.events.length ||
        modules.sha256Utf8(JSON.stringify(journal.events.slice(0,witness.event_count))).sha256 !== witness.events_sha256)
      fail('Complete original synchronous guard witness required');
    const invocation = journal.events[witness.invocation_event];
    const failure = journal.events[witness.failed_event];
    if (invocation?.phase !== 'invoking' || invocation.binding !== binding ||
        failure?.phase !== 'failed' || failure.binding !== binding || failure.status !== 0 ||
        failure.message !== 'Claim preservation body and subject must be strings.' ||
        Object.prototype.hasOwnProperty.call(invocation.args || {},'body') ||
        typeof invocation.args?.subject !== 'string' ||
        typeof invocation.args?.payload?.body?.content !== 'string' ||
        rateCanonical(invocation.args) !== rateCanonical(historical.args))
      fail('The retained failure is not this original local argument guard');
    if (!modules.publicationPolicy ||
        modules.publicationPolicy.source_sha256 !== witness.guard_source_sha256)
      fail('Load the same complete original claim-preservation source');
    let reproduced;
    try {
      modules.publicationPolicy.checkClaimPreservation(invocation.args.body,invocation.args.subject);
    } catch (error) {reproduced = error;}
    if (reproduced?.name !== 'TypeError' || reproduced.message !== failure.message)
      fail('The original synchronous guard failure did not reproduce');
    const released = journal.events.slice(witness.failed_event+1,witness.event_count).find(event =>
      event.phase === 'account-attempt-released' &&
      event.operation_key === invocation.account_operation_key &&
      event.attempt_key === invocation.account_attempt_key &&
      event.returned === false && ['RELEASED','ORIGINAL_LEASE_NO_LONGER_ACTIVE'].includes(event.result?.status));
    if (!released || journal.events.slice(witness.failed_event+1,witness.event_count).some(event =>
        event.binding === binding && ['invoking','returned'].includes(event.phase)))
      fail('The original local call has not ended without a provider return');
    return witness.invocation_event;
  }
  function localGuardInvocation() {
    const received = journal.local_pre_dispatch;
    if (!received) return null;
    const {sha256,...body} = received;
    if (received.schema !== 'commons.contact-local-pre-dispatch/v1' ||
        received.input_sha256 !== received.witness?.input_sha256 || received.operation_lease !== lease ||
        received.gmail_invocations !== 0 ||
        modules.sha256Utf8(JSON.stringify(body)).sha256 !== sha256)
      throw new TypeError('Original local pre-dispatch receiving changed');
    return validateLocalGuardWitness(received.witness);
  }
  function argumentBindingInvocation() {
    const received = journal.argument_binding_rejection;
    if (!received) return null;
    const fail = () => {throw new TypeError('Retain the complete original argument-binding rejection');};
    const {sha256,...body} = received;
    if (received.schema !== 'commons.contact-argument-binding-rejection/v1' ||
        received.operation_lease !== lease ||
        modules.sha256Utf8(JSON.stringify(body)).sha256 !== sha256 ||
        !Number.isSafeInteger(received.event_count) || received.event_count < 1 ||
        received.event_count > journal.events.length ||
        modules.sha256Utf8(JSON.stringify(journal.events.slice(0,received.event_count))).sha256 !== received.events_sha256)
      fail();
    const historical = reviewedRuntime(received.runtime_input);
    const invocation = journal.events[received.invocation_event];
    const returned = journal.events[received.returned_event];
    const released = journal.events[received.release_event];
    const operation = modules.sha256Utf8(JSON.stringify({
      input_sha256:historical.identity,lease})).sha256;
    if (historical.identity !== received.input_sha256 ||
        invocation?.phase !== 'invoking' || invocation.binding !== nativeSendBinding ||
        nativeSendBinding !== 'mcp__codex_apps__gmail_send_email' ||
        invocation.invocation_event !== received.invocation_event ||
        invocation.account_operation_key !== operation ||
        rateCanonical(invocation.args) !== rateCanonical(historical.args) ||
        invocation.args_sha256 !== modules.sha256Utf8(rateCanonical(invocation.args)).sha256 ||
        invocation.call_id !== modules.sha256Utf8(rateCanonical({operation_key:operation,
          binding:nativeSendBinding,invocation_event:received.invocation_event,
          args_sha256:invocation.args_sha256})).sha256 ||
        returned?.phase !== 'returned' || returned.binding !== nativeSendBinding ||
        returned.invocation_event !== received.invocation_event ||
        returned.call_id !== invocation.call_id || returned.args_sha256 !== invocation.args_sha256 ||
        returned.link_id !== invocation.link_id ||
        !classifyReturnedArgumentBindingRejection(returned.raw) ||
        !(received.invocation_event < received.returned_event &&
          received.returned_event < received.release_event && received.release_event < received.event_count) ||
        released?.phase !== 'account-attempt-released' || released.returned !== true ||
        released.operation_key !== operation || released.attempt_key !== invocation.account_attempt_key ||
        !['RELEASED','ORIGINAL_LEASE_NO_LONGER_ACTIVE'].includes(released.result?.status) ||
        journal.events.slice(received.invocation_event+1,received.event_count).some(event =>
          event.binding === nativeSendBinding && event.phase === 'invoking'))
      fail();
    return received.invocation_event;
  }
  function receiveArgumentBindingRejection() {
    if (journal.argument_binding_rejection) return argumentBindingInvocation();
    if (nativeDraft || !nativeArguments || publicCalls || mailboxSelectionActive ||
        activeAccountAttempt || accountBoundary || activeRateContinuation ||
        journal.receipt || journal.native_receipt || journal.console_handoff ||
        receivedRateHistory() || sendInvocationCount() !== 1)
      throw new TypeError('Receive only the ended original native-envelope argument rejection');
    const calls = rateNativeCalls(nativeSendBinding);
    if (calls.length !== 1 || !classifyReturnedArgumentBindingRejection(calls[0].raw))
      throw new TypeError('The complete original connector argument-binding return is required');
    const call = calls[0];
    const releaseIndex = journal.events.findIndex((event,index) =>
      index > call.returned_index && event.phase === 'account-attempt-released' &&
      event.operation_key === call.event.account_operation_key &&
      event.attempt_key === call.event.account_attempt_key);
    const body = {schema:'commons.contact-argument-binding-rejection/v1',
      input_sha256:identity,operation_lease:lease,runtime_input:frozenJson(input),
      invocation_event:call.index,returned_event:call.returned_index,release_event:releaseIndex,
      event_count:journal.events.length,
      events_sha256:modules.sha256Utf8(JSON.stringify(journal.events)).sha256,
      received_at:new Date().toISOString()};
    journal.argument_binding_rejection = {...body,sha256:modules.sha256Utf8(JSON.stringify(body)).sha256};
    try { argumentBindingInvocation(); } catch (error) {
      delete journal.argument_binding_rejection; throw error;
    }
    record({phase:'argument-binding-rejection-received',invocation_event:call.index,
      returned_event:call.returned_index,release_event:releaseIndex,
      rejection_sha256:journal.argument_binding_rejection.sha256,
      input_sha256:identity,operation_lease:lease,provider_invoked:false});
    return call.index;
  }
  const sendInvocationCount = (end=journal.events.length) => {
    const local = localGuardInvocation(), rejected = argumentBindingInvocation();
    return (receivedRateHistory()?.count || 0) + journal.events.slice(0,end).filter((event,index) =>
      event.phase === 'invoking' && event.binding === nativeSendBinding &&
      index !== local && index !== rejected).length;
  };
  function receiveLocalPreDispatch(witness) {
    if (publicCalls || activeAccountAttempt || accountBoundary || journal.receipt)
      throw new TypeError('Receive the original ended local call before another contact operation');
    const selected = frozenJson(witness);
    const invocation = validateLocalGuardWitness(selected);
    if (journal.local_pre_dispatch) {
      if (rateCanonical(journal.local_pre_dispatch.witness) !== rateCanonical(selected))
        throw new TypeError('The original local pre-dispatch witness differs');
      localGuardInvocation();
      return {status:'LOCAL_PRE_DISPATCH_RECEIVED',input_sha256:identity,
        invocation_event:invocation,sha256:journal.local_pre_dispatch.sha256,
        gmail_invocations:sendInvocationCount()};
    }
    if (selected.input_sha256 !== identity || sendInvocationCount() !== 1 || receivedRateHistory())
      throw new TypeError('Receive only the single original local guard invocation');
    const reservation = journal.prepared_account_reservation;
    if (reservation?.input_sha256 !== identity || reservation.operation_lease !== lease ||
        reservation.intent_branch !== intent.branch || reservation.recipient_claim_path !== path ||
        reservation.lease !== lease || !originalReference(reservation.intent_ref_sha))
      throw new TypeError('The original won recipient reservation is required');
    const body = {schema:'commons.contact-local-pre-dispatch/v1',
      input_sha256:identity,operation_lease:lease,gmail_invocations:0,
      witness:selected,received_at:new Date().toISOString()};
    journal.local_pre_dispatch = {...body,sha256:modules.sha256Utf8(JSON.stringify(body)).sha256};
    record({phase:'local-pre-dispatch-received',input_sha256:identity,operation_lease:lease,
      invocation_event:invocation,failed_event:selected.failed_event,
      witness_sha256:journal.local_pre_dispatch.sha256,original_outcome:journal.outcome});
    return {status:'LOCAL_PRE_DISPATCH_RECEIVED',input_sha256:identity,
      invocation_event:invocation,sha256:journal.local_pre_dispatch.sha256,
      gmail_invocations:sendInvocationCount()};
  }
  function rememberPreparedAccountReservation(reservation) {
    if (!originalReference(reservation?.intent_ref_sha) ||
        (reservation.recipient_pending === true
          ? reservation.lease !== undefined
          : reservation.recipient_pending !== undefined || reservation.lease !== lease))
      throw new TypeError('Original prepared reservation required');
    journal.prepared_account_reservation = {
      input_sha256: identity, intent_branch: intent.branch, recipient_claim_path: path,
      operation_lease: lease, intent_ref_sha: reservation.intent_ref_sha,
      ...(reservation.recipient_pending === true ? {recipient_pending:true} : {lease})
    };
    store(stateKey,journal);
  }

  // Receive retained queued-return facts and current provider source after the
  // original local owner ended. Lost invocation pairs are never synthesized.
  async function receiveQueuedReservation(source) {
    if (publicCalls || mailboxSelectionActive || accountBoundary || activeAccountAttempt ||
        activeRateContinuation || sendInvocationCount() || journal.receipt || journal.native_receipt ||
        deliveryCorrection || nativeDraft || journal.console_handoff)
      throw new TypeError('Receive only an ended ordinary zero-send queued operation');
    if (!source || Object.keys(source).some(key=>!['content','sha256'].includes(key)) ||
        typeof source.content!=='string' || source.content.length>1024*1024 ||
        modules.sha256Utf8(source.content).sha256!==source.sha256)
      throw new TypeError('Complete retained queued-return witness bytes and SHA256 required');
    const witness=frozenJson(JSON.parse(source.content));
    const ended=witness.execution,returned=witness.queued_return,request=returned?.request;
    if (witness.schema!=='commons.contact-ended-queued-return/v1' ||
        witness.input_sha256!==identity || witness.operation_lease!==lease ||
        witness.intent_branch!==intent.branch || witness.recipient_claim_path!==path ||
        ended?.state!=='TERMINATED_AFTER_QUEUED_RETURN' ||
        ended.pending!=='LOCAL_TIMER' || ended.send_invocations!==0 ||
        typeof ended.execution_id!=='string' || !ended.execution_id ||
        !Number.isFinite(Date.parse(ended.ended_at)) ||
        returned?.status!=='ACCOUNT_DEFERRED' || returned.account_status!=='ACCOUNT_QUEUED' ||
        request?.operation_key!==accountOperationKey || request.operation_lease!==lease ||
        !Number.isSafeInteger(request.sequence) || request.sequence<1 ||
        !Number.isFinite(Date.parse(request.queued_at)) ||
        !/^[a-f0-9]{40}$/.test(returned.source_commit_sha||returned.commit_sha||'') ||
        !/^[a-f0-9]{40}$/.test(returned.source_state_sha||returned.state_sha||'') ||
        !originalReference(witness.intent_ref_sha) ||
        !originalReference(witness.recipient_sha) ||
        Date.parse(ended.ended_at)<Date.parse(request.queued_at))
      throw new TypeError('Witness must identify the same ended queued return and original input');
    const admission=originalMailboxAdmission();
    if (typeof admission.receiveQueuedReturn!=='function')
      throw new TypeError('Load the maintained atomic queued-return receiving interface');
    if (returned.account_key!==admission.location().account_key)
      throw new TypeError('Queued return belongs to another configured mailbox');
    await verifyActor();await verifyMailboxes();
    const [remote,claim,census]=await together([
      adapters.readIntent(spec),readClaim(spec),
      together(mailboxes.map(async mailbox=>({mailbox:mailbox.email,
        sent_ids:await messageIds(mailbox,'in:sent to:'+recipient,true),
        inbound_ids:await messageIds(mailbox,'in:anywhere from:'+recipient+' -in:sent',true)})))
    ]);
    if (census.some(item=>item.sent_ids.length||item.inbound_ids.length))
      return {status:'QUEUED_RESERVATION_REVIEW',reason:'CURRENT_RECIPIENT_CORRESPONDENCE',census};
    if (!remote.exists || remote.ref_sha!==witness.intent_ref_sha ||
        !claim || claim.sha!==witness.recipient_sha || claim.record.status!=='reserved' ||
        claim.record.case!==reviewed.opportunity_id || claim.record.lease!==lease ||
        Date.parse(claim.record.reserved_at)>Date.parse(request.queued_at))
      throw new TypeError('Original won intent and same recipient reservation changed');
    const relationship=await adapters.beforeSend(spec);
    if (relationship?.can_contact!==true)
      return {status:'QUEUED_RESERVATION_REVIEW',reason:'CURRENT_RELATIONSHIP',relationship};
    // The original mailbox change() rechecks this exact waiting generation
    // after each CAS conflict; it cannot recreate an expired/admitted request.
    const received=await admission.receiveQueuedReturn({
      operation_key:accountOperationKey,operation_lease:lease,sequence:request.sequence,
      queued_at:request.queued_at,source_commit_sha:returned.source_commit_sha||returned.commit_sha,
      source_state_sha:returned.source_state_sha||returned.state_sha,
      ...(returned.storage_receipt?{source_storage_receipt:returned.storage_receipt}:{}),recovery_sha256:source.sha256});
    record({phase:'queued-return-account-received',input_sha256:identity,
      operation_lease:lease,source_sha256:source.sha256,result:received});
    if (!['QUEUED_RETURN_RECEIVED','EXPIRED_QUEUED_RETURN_RECEIVED'].includes(received.status))
      return {status:'QUEUED_RESERVATION_PENDING',account:received};
    // Re-read the two other original resources after the queue CAS. Receiving
    // grants no send permission: run() retains its existing claim/account CAS,
    // current relationship census, final provider deadline and payload checks.
    const [currentIntent,currentClaim]=await together([adapters.readIntent(spec),readClaim(spec)]);
    if (!currentIntent.exists || currentIntent.ref_sha!==witness.intent_ref_sha ||
        currentClaim?.sha!==witness.recipient_sha)
      return {status:'QUEUED_RESERVATION_REVIEW',reason:'ORIGINAL_RESERVATION_CHANGED_AFTER_QUEUE_RECEIVING'};
    journal.queued_return_recovery={input_sha256:identity,operation_lease:lease,
      gmail_invocations:0,observed_at:new Date().toISOString(),source:frozenJson(source),
      witness,account:received,census,recipient_sha:currentClaim.sha,intent_ref_sha:currentIntent.ref_sha};
    rememberPreparedAccountReservation({intent_ref_sha:currentIntent.ref_sha,lease});
    record({phase:'queued-reservation-received',input_sha256:identity,operation_lease:lease,
      source_sha256:source.sha256,original_queue_sequence:request.sequence,
      source_account_commit:returned.commit_sha,receiving_account_commit:received.commit_sha,
      recipient_sha:currentClaim.sha,intent_ref_sha:currentIntent.ref_sha,gmail_invocations:0});
    return retainOutcome({status:'QUEUED_RESERVATION_RECEIVED',input_sha256:identity,
      operation_lease:lease,intent_branch:intent.branch,recipient_claim_path:path,
      source_sha256:source.sha256,account:received,gmail_invocations:0});
  }

  function preparedAccountReservation() {
    const deferred = journal.account_deferred || journal.reviewed_revision || journal.mailbox_selection || journal.local_pre_dispatch || journal.intent_readback_received || journal.account_interruption_received || journal.queued_return_recovery;
    const reservation = journal.prepared_account_reservation;
    // Any prior provider invocation belongs to the original explicit retry or
    // receipt reconciliation, never the no-send recipient continuation.
    if (sendInvocationCount() !== 0 || !deferred || !reservation) return null;
    if (deferred.input_sha256 !== identity || deferred.operation_lease !== lease ||
        deferred.gmail_invocations !== sendInvocationCount() ||
        reservation.input_sha256 !== identity || reservation.operation_lease !== lease ||
        reservation.intent_branch !== intent.branch || reservation.recipient_claim_path !== path ||
        !originalReference(reservation.intent_ref_sha) ||
        (reservation.recipient_pending === true
          ? reservation.lease !== undefined
          : reservation.recipient_pending !== undefined || reservation.lease !== lease))
      throw new TypeError('Original account-deferred operation changed');
    return {intent_ref_sha:reservation.intent_ref_sha,
      ...(reservation.recipient_pending === true ? {recipient_pending:true} : {lease})};
  }
  function accountRecheckAt(admission, now=Date.now()) {
    // A provider deadline is authoritative. Local queue/lease expiry is only
    // an upper-bound retry hint: an active owner can release much sooner.
    if(['PROVIDER_DEFERRED','AUTOMATION_DEFERRED','AUTOMATION_USAGE_REFRESHING','AUTOMATION_USAGE_REQUIRED'].includes(admission?.status)) {
      const floors=[Date.parse(admission.retry_after),Date.parse(admission.automation?.retry_after)].filter(Number.isFinite);
      return floors.length?new Date(Math.max(...floors)).toISOString():null;
    }
    if(!['SEND_ACTIVE','ACCOUNT_QUEUED'].includes(admission?.status)) return null;
    const candidates=[now+30000,Date.parse(admission.retry_after),
      Date.parse(admission.queue?.turn?.expires_at),Date.parse(admission.queue?.waiting_renew_at)];
    return new Date(Math.max(now,Math.min(...candidates.filter(Number.isFinite)))).toISOString();
  }
  function accountMaintenanceAt(admission, now=Date.now()) {
    if (!['PROVIDER_DEFERRED','AUTOMATION_DEFERRED'].includes(admission?.status)) return null;
    const request=admission.queue?.request, renew=Date.parse(admission.queue?.waiting_renew_at);
    if (!request || request.operation_key!==accountOperationKey || request.operation_lease!==lease ||
        (request.send_binding || 'mcp__codex_apps__gmail_send_email')!==nativeSendBinding ||
        admission.queue?.active_operation_key===accountOperationKey ||
        !Number.isFinite(renew) || Date.parse(request.expires_at)<=now ||
        !Number.isFinite(Date.parse(request.expires_at))) return null;
    // This is a queue-maintenance time, never permission to invoke Gmail.
    // Keep the provider's separate retry_after/recheck_at unchanged.
    return new Date(Math.max(now,renew)).toISOString();
  }
  function deferAccount(decision) {
    if (!accountBoundary || sendInvocationCount() !== accountBoundary.gmail_invocations ||
        !decision || typeof decision !== 'object' || Array.isArray(decision))
      throw new TypeError('Account deferral must precede this original Gmail invocation');
    const retained = JSON.parse(JSON.stringify(decision));
    const outcome = {status:'ACCOUNT_DEFERRED', account:retained,
      recheck_at:accountRecheckAt(retained), queue_maintenance_at:accountMaintenanceAt(retained),
      intent_branch:intent.branch, recipient_claim_path:path,
      action:'Continue this same original operation after account admission'};
    journal.account_deferred = {input_sha256:identity, operation_lease:lease,
      gmail_invocations:accountBoundary.gmail_invocations, observed_at:new Date().toISOString(),
      outcome};
    accountBoundary.deferred = outcome;
    store(stateKey,journal);
    const error = new Error('Original Gmail account admission deferred');
    error[accountDeferredSignal] = true;
    throw error;
  }
  function retainedOriginalAccountWait() {
    for (let index=journal.events.length-1;index>=0;index--) {
      const event=journal.events[index];
      if (event.operation_key!==accountOperationKey) continue;
      if (event.phase==='account-attempt-acquired' ||
          event.phase==='account-wait-withdrawn' &&
          ['ACCOUNT_WAIT_WITHDRAWN','NO_RETAINED_ACCOUNT_WAIT'].includes(event.result?.status))
        return false;
      if (['operation-account-deferred-ended','account-attempt-deferred-ended'].includes(event.phase) &&
          event.account?.queue?.request?.operation_key===accountOperationKey) return true;
    }
    return false;
  }
  // A fully ended zero-send wait may be observed without creating a new
  // attempt, renewing the recipient or appending provider reads to its journal.
  // The durable checkpoint caller separately fences its unchanged pointer.
  async function inspectAccountWait() {
    assertCurrentReview();
    const ended=journal.events.at(-1), deferred=journal.account_deferred;
    if (journal.console_handoff || journal.returned_mailbox_revision || journal.receipt ||
        sendInvocationCount() || activeAccountAttempt || accountBoundary ||
        activeRateContinuation || journal.outcome?.status!=='ACCOUNT_DEFERRED' ||
        !['PROVIDER_DEFERRED','AUTOMATION_DEFERRED','AUTOMATION_USAGE_REFRESHING','AUTOMATION_USAGE_REQUIRED','SEND_ACTIVE','ACCOUNT_QUEUED'].includes(journal.outcome.account?.status) ||
        deferred?.input_sha256!==identity || deferred.operation_lease!==lease ||
        deferred.gmail_invocations!==0 || rateCanonical(deferred.outcome)!==rateCanonical(journal.outcome) ||
        ended?.phase!=='operation-account-deferred-ended' || ended.operation_key!==accountOperationKey ||
        ended.input_sha256!==identity || ended.operation_lease!==lease ||
        ended.gmail_invocations_before!==0 || ended.gmail_invocations_after!==0 ||
        rateCanonical(ended.account)!==rateCanonical(journal.outcome.account)) return null;
    assertFinalContactClaims();
    const create=modules.mailboxAdmission?.createConnectedMailboxAdmission;
    if (typeof create!=='function') return null;
    const basis=rateCanonical(journal), observations=[];
    const readTools=Object.create(tools);
    for (const name of ['github_create_branch','github_create_file','github_update_file','github_create_blob','gmail_send_email','gmail_send_draft'])
      readTools['mcp__codex_apps__'+name]=async()=>{throw new TypeError('Read-only waiting observation cannot mutate a provider');};
    const observer=create({tools:readTools,storage:storage?Object.freeze({...storage,
      compareAndSwap:async()=>{throw new TypeError('Read-only waiting observation cannot change local state');},
      receive:async()=>{throw new TypeError('Read-only waiting observation cannot receive local state');}}):undefined,sha256Utf8:modules.sha256Utf8,
      classifyReturnedGmailRateLimit,classifyReturnedSendRateLimit,account:sender,
      send_binding:nativeSendBinding,githubRefAction:refAction,
      verificationScope:{operation_key:accountOperationKey,input_sha256:identity,operation_lease:lease},
      history:()=>journal.events.filter(event=>event.phase==='account-admission').map(event=>event.event),
      record:event=>{observations.push(event);}});
    const admission=await observer.inspect({operation_key:accountOperationKey});
    assertCurrentReview();
    if (rateCanonical(journal)!==basis) throw new TypeError('Original contact changed during read-only account observation');
    if (!['PROVIDER_DEFERRED','AUTOMATION_DEFERRED','AUTOMATION_USAGE_REFRESHING','AUTOMATION_USAGE_REQUIRED','SEND_ACTIVE','ACCOUNT_QUEUED'].includes(admission?.status) ||
        admission.queue?.active_operation_key===accountOperationKey) return null;
    const now=Date.now(), request=admission.queue?.request;
    // An absent/expired wait needs the original checkpointed acquisition once,
    // even during a provider floor. Observation must not strand it outside the
    // maintained queue. A retained healthy wait remains entirely read-only.
    if (!request || request.operation_key!==accountOperationKey || request.operation_lease!==lease ||
        (request.send_binding || 'mcp__codex_apps__gmail_send_email')!==nativeSendBinding ||
        !Number.isFinite(Date.parse(request.expires_at)) || Date.parse(request.expires_at)<=now ||
        !Number.isFinite(Date.parse(admission.queue.waiting_renew_at)) ||
        Date.parse(admission.queue.waiting_renew_at)<=now) return null;
    if (['PROVIDER_DEFERRED','AUTOMATION_DEFERRED','AUTOMATION_USAGE_REFRESHING','AUTOMATION_USAGE_REQUIRED'].includes(admission.status) &&
        (!Number.isFinite(Date.parse(admission.retry_after)) || Date.parse(admission.retry_after)<=now)) return null;
    if (admission.status==='SEND_ACTIVE' && Date.parse(admission.retry_after)<=now) return null;
    // This is an observation, not a saved attempt/result or a send permission.
    // Every eligible continuation still runs the original current admission,
    // reservation, dual-mailbox/relationship and write-before-send boundaries.
    return {status:'ACCOUNT_DEFERRED',account:admission,read_only:true,
      observed_at:new Date(now).toISOString(),recheck_at:accountRecheckAt(admission,now),
      queue_maintenance_at:accountMaintenanceAt(admission,now),
      intent_branch:intent.branch,recipient_claim_path:path,
      action:'Continue this same original operation after account admission'};
  }
  async function withdrawOriginalAccountWait(reason,{required=false,force=false}={}) {
    const admission=originalMailboxAdmission();
    if (!force && !retainedOriginalAccountWait())
      return {status:'NO_RETAINED_ACCOUNT_WAIT',operation_key:accountOperationKey};
    if (typeof admission.withdraw!=='function') {
      if (force || retainedOriginalAccountWait())
        throw new TypeError('Load the complete maintained account waiting interface');
      return {status:'NO_RETAINED_ACCOUNT_WAIT',operation_key:accountOperationKey};
    }
    try {
      const result=await admission.withdraw({operation_key:accountOperationKey,reason});
      if (!['ACCOUNT_WAIT_WITHDRAWN','NO_RETAINED_ACCOUNT_WAIT'].includes(result?.status))
        throw Object.assign(new TypeError('Original waiting withdrawal needs its same-state receiving'),
          {account_readback:result});
      record({phase:'account-wait-withdrawn',operation_key:accountOperationKey,
        input_sha256:identity,operation_lease:lease,reason,result});
      return result;
    } catch (error) {
      record({phase:'account-wait-withdrawal-unfinished',operation_key:accountOperationKey,
        input_sha256:identity,operation_lease:lease,reason,message:String(error?.message || error),
        ...(error.account_readback ? {account_readback:error.account_readback} : {})});
      if (required) throw error;
      return {status:'ACCOUNT_WAIT_WITHDRAWAL_PENDING',operation_key:accountOperationKey,reason};
    }
  }
  async function withPreparedAccountBoundary(operation) {
    if (accountBoundary || typeof operation !== 'function')
      throw new TypeError('One original account-admission operation required');
    const current = {gmail_invocations:sendInvocationCount(), deferred:null, attempt_key:null, account_attempt:null,
      event_start:journal.events.length, started_at:new Date().toISOString(), mailbox_identity_check:null};
    accountBoundary = current;
    try {
      let outcome;
      try {
        assertFinalContactClaims();
        const preparesBeforeAccount = typeof modules.gateway.prepareFinalCensus === 'function';
        if (preparesBeforeAccount) {
          const admission = await originalMailboxAdmission().prepareUsage({operation_key:accountOperationKey});
          const waiting = admission?.queue?.request, now = Date.now();
          const renewAt = Date.parse(admission?.queue?.waiting_renew_at);
          const renewProviderWait = ['PROVIDER_DEFERRED','AUTOMATION_DEFERRED'].includes(admission?.status) && waiting &&
            waiting.operation_key === accountOperationKey && waiting.operation_lease === lease &&
            (waiting.send_binding || 'mcp__codex_apps__gmail_send_email') === nativeSendBinding &&
            admission.queue?.active_operation_key !== accountOperationKey &&
            Number.isFinite(renewAt) && renewAt <= now &&
            Number.isFinite(Date.parse(waiting.expires_at)) && Date.parse(waiting.expires_at) > now;
          const enterProviderWait = ['PROVIDER_DEFERRED','AUTOMATION_DEFERRED'].includes(admission?.status) &&
            admission.queue?.request === null &&
            admission.queue?.active_operation_key !== accountOperationKey;
          if (enterProviderWait || renewProviderWait) {
            // Register an absent original wait, or renew this due original wait,
            // through the same admission CAS. The provider deadline still wins
            // and no send token is issued while it holds. Expired requests get
            // an ordinary new sequence, never their historical position.
            // If the floor expires during acquisition, retain that one actual
            // token for the unchanged fresh gateway census and final checks.
            await acquireOriginalAccountAttempt(current,enterProviderWait
              ? 'ORIGINAL_PROVIDER_WAIT' : 'RETAINED_PROVIDER_WAIT');
          }
          if (!current.account_attempt &&
              !['READY','SEND_ACTIVE','ACCOUNT_QUEUED'].includes(admission?.status))
            deferAccount(admission);
          if (['SEND_ACTIVE','ACCOUNT_QUEUED'].includes(admission.status) &&
              preparedAccountReservation()) {
            // An existing prepared recipient does not need another renewal
            // merely to wait. Keep queue entry/renewal and any raced READY
            // acquisition inside the unchanged account CAS before the gateway.
            await acquireOriginalAccountAttempt(current,'RETAINED_RECIPIENT_WAIT');
          }
          // A retained complete reservation can acquire the currently available
          // account before repeating preflight. The ready-runner admission CAS
          // still decides ownership; the gateway receives the exact original
          // intent/recipient and completes its fresh census with this same token.
          const request = admission.queue?.request, turn = admission.queue?.turn;
          const offered = admission.status === 'READY' && request && turn &&
            request.operation_key === accountOperationKey &&
            request.operation_lease === lease &&
            (request.send_binding || 'mcp__codex_apps__gmail_send_email') === nativeSendBinding &&
            turn.operation_key === accountOperationKey && turn.sequence === request.sequence;
          const prepared = admission.status === 'READY' ? preparedAccountReservation() : null;
          if (offered || prepared?.lease === lease)
            await acquireOriginalAccountAttempt(current,offered
              ? 'OFFERED_ORIGINAL_TURN' : 'PREPARED_ORIGINAL_CONTACT');
        } else {
          // The original acquisition both registers the prepared operation's
          // waiting turn and, when eligible, wins its actual account token.
          await acquireOriginalAccountAttempt(current);
        }
        // First preparation still reserves the original intent/recipient before
        // final-census acquisition. A retained complete reservation or offered
        // turn reuses its token above; older gateways keep early acquisition.
        outcome = await operation();
        // The gateway preserves provider uncertainty by catching sendEmail errors.
        // Re-raise only this boundary's source-owned validation failure, which
        // happened before the native invoking event and made no new Gmail call.
        if (current.local_preflight_error &&
            sendInvocationCount() === current.gmail_invocations)
          throw current.local_preflight_error;
      }
      catch (error) {
        if (error?.[accountDeferredSignal] !== true) {
          if (sendInvocationCount() === current.gmail_invocations) {
            const eventEnd = journal.events.length;
            const failure = {name:String(error?.name || 'Error'),
              message:String(error?.message || error),
              status:typeof error?.status === 'number' && Number.isFinite(error.status) ? error.status : null,
              ...(nativeFailures.has(error) ? {native_failure:nativeFailures.get(error)} : {}),
              ...(recipientWriteContentions.has(error)
                ? {recipient_write:recipientWriteContentions.get(error)} : {})};
            const failedEvents = journal.events.slice(current.event_start,eventEnd)
              .flatMap((event,index) => event.phase === 'failed'
                ? [current.event_start+index] : []);
            const nativeFailuresInAttempt = failedEvents
              .map(index=>journal.events[index].native_failure).filter(Boolean);
            const ended = record({phase:'operation-preflight-ended',
              input_sha256:identity,operation_lease:lease,operation_key:accountOperationKey,
              attempt_key:current.attempt_key,started_at:current.started_at,
              event_start:current.event_start,event_end:eventEnd,failed_events:failedEvents,
              native_failures:nativeFailuresInAttempt,
              gmail_invocations_before:current.gmail_invocations,
              gmail_invocations_after:sendInvocationCount(),failure,
              previous_outcome:journal.outcome || null});
            retainOutcome({status:'PREFLIGHT_FAILED',stage:'BEFORE_GMAIL_INVOCATION',
              error:failure,operation_key:accountOperationKey,attempt_key:current.attempt_key,
              observed_at:ended.observed_at,event_start:current.event_start,
              event_end:eventEnd,failed_events:failedEvents,native_failures:nativeFailuresInAttempt,
              ended_event:journal.events.indexOf(ended),
              gmail_invocations_before:current.gmail_invocations,
              gmail_invocations_after:sendInvocationCount(),
              intent_branch:intent.branch,recipient_claim_path:path,
              ...(journal.receipt?.message_id ? {message_id:journal.receipt.message_id} : {}),
              action:'Continue the same original operation after receiving its failed preflight'});
          }
          throw error;
        }
      }
      // The existing gateway catches sendEmail failures. Translate only the
      // source-owned deferral that made zero new Gmail invocations in this run.
      if (current.deferred && sendInvocationCount() === current.gmail_invocations) {
        if (current.attempt_key) record({phase:'account-attempt-deferred-ended',
          operation_key:accountOperationKey,attempt_key:current.attempt_key,
          input_sha256:identity,operation_lease:lease,gmail_invocations:current.gmail_invocations,
          account:current.deferred.account});
        // Account inspection can defer before an attempt is acquired, and an
        // ordinary acquisition can defer after the recipient CAS was renewed.
        // Both completed zero-send paths retain their original operation span.
        record({phase:'operation-account-deferred-ended',
          input_sha256:identity,operation_lease:lease,operation_key:accountOperationKey,
          attempt_key:current.attempt_key,started_at:current.started_at,
          event_start:current.event_start,event_end:journal.events.length,
          gmail_invocations_before:current.gmail_invocations,
          gmail_invocations_after:sendInvocationCount(),
          account:current.deferred.account});
        return retainOutcome(current.deferred);
      }
      await finishOriginalAccountAttempt(current.account_attempt);
      if (returnedReservationOutcome(outcome) &&
          current.gmail_invocations===0 && sendInvocationCount()===0) {
        record({phase:'operation-returned-no-send-ended',
          input_sha256:identity,operation_lease:lease,operation_key:accountOperationKey,
          attempt_key:current.attempt_key,started_at:current.started_at,
          event_start:current.event_start,event_end:journal.events.length,
          gmail_invocations_before:0,gmail_invocations_after:0,
          outcome:frozenJson(outcome),
          outcome_sha256:modules.sha256Utf8(rateCanonical(outcome)).sha256});
      }
      const handoff = current.account_attempt?.next_turn;
      outcome = connectorRateOutcome(outcome);
      return retainOutcome(handoff?.next_operation && outcome && typeof outcome === 'object'
        ? {...outcome,account_handoff:handoff} : outcome);
    } finally {
      try {
        await finishOriginalAccountAttempt(current.account_attempt);
        if (!current.deferred && !current.account_attempt &&
            sendInvocationCount()===current.gmail_invocations)
          await withdrawOriginalAccountWait('ORIGINAL_PREFLIGHT_FINISHED');
      } finally { accountBoundary = null; }
    }
  }
  async function together(promises) {
    const results = await Promise.allSettled(promises);
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw failures[0].reason;
    return results.map(result => result.value);
  }
  async function verifyActor() {
    if(storage)return storage.verify();
    const actor = await invoke(actorSelection.binding, {});
    if (String(actor.id) !== actorSelection.expected_id ||
        actor[actorSelection.login_field] !== actorSelection.expected_login)
      throw new TypeError('Original connected GitHub writer identity changed');
    return actor;
  }
  async function verifyMailboxes() {
    const boundary = accountBoundary;
    if (boundary?.mailbox_identity_check) {
      record({phase:'mailbox-identities-reused',attempt_key:boundary.attempt_key,
        scope:'CURRENT_ACCOUNT_ATTEMPT'});
      return boundary.mailbox_identity_check;
    }
    const check = together(mailboxes.map(async mailbox => {
      const profile = await invoke('mcp__codex_apps__gmail_get_profile', {link_id: mailbox.link_id});
      if (String(profile.id) !== mailbox.id || String(profile.email).toLowerCase() !== mailbox.email) throw new TypeError('Original mailbox identity changed');
      return profile;
    }));
    // Only immutable account identities are reused within this one attempt.
    // Correspondence remains fresh; sendEmail rechecks its selected sender.
    if (boundary) boundary.mailbox_identity_check = check;
    return check;
  }
  async function messageIds(mailbox, query, complete) {
    const ids = [], seenIds = new Set(), seenPages = new Set();
    let page;
    do {
      const found = await invoke('mcp__codex_apps__gmail_search_email_ids', {
        link_id: mailbox.link_id, query, max_results: complete ? 100 : 5,
        ...(page ? {next_page_token: page} : {})
      });
      if (!Array.isArray(found.message_ids) || found.message_ids.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) throw new TypeError('Native Gmail IDs incomplete');
      for (const id of found.message_ids) if (!seenIds.has(id)) {seenIds.add(id); ids.push(id);}
      const next = found.next_page_token;
      if (next !== undefined && next !== null && (typeof next !== 'string' || !next || next.length > 4096)) throw new TypeError('Native Gmail cursor invalid');
      if (!complete || !next) return ids;
      if (seenPages.has(next)) throw new TypeError('Native Gmail pagination incomplete');
      seenPages.add(next); page = next;
    } while (page);
    return ids;
  }
  const refBindings = ['mcp__codex_apps__github_fetch','mcp__codex_apps__github_fetch_commit'];
  function refArguments(binding, branch) {
    if (branch !== 'main' && branch !== intent.branch) throw new TypeError('Unexpected original intent ref');
    if (binding === 'mcp__codex_apps__github_fetch_commit')
      return {repo_full_name:repository,commit_sha:'refs/heads/' + branch};
    if (binding === 'mcp__codex_apps__github_fetch')
      return {url:'https://api.github.com/repos/' + repository + '/git/ref/heads/' + branch};
    return null;
  }
  function matchesRefCall(call, branch) {
    const expected = refArguments(call.binding,branch);
    return expected !== null && rateCanonical(call.args) === rateCanonical(expected);
  }
  function nativeRef(value, binding, branch) {
    if (binding === 'mcp__codex_apps__github_fetch') {
      if (value.ref !== 'refs/heads/' + branch || value.object?.type !== 'commit' ||
          !/^[a-f0-9]{40}$/.test(value.object.sha || ''))
        throw new TypeError('Original GitHub ref mismatch');
      return value;
    }
    if (binding !== 'mcp__codex_apps__github_fetch_commit')
      throw new TypeError('Original GitHub ref binding changed');
    const commit = value?.commit, sha = commit?.sha;
    if (!/^[a-f0-9]{40}$/.test(sha || '') || commit.repository_full_name !== repository ||
        commit.url !== 'https://api.github.com/repos/' + repository + '/commits/' + sha ||
        commit.html_url !== 'https://github.com/' + repository + '/commit/' + sha ||
        value.url !== commit.html_url)
      throw new TypeError('Original native commit repository or identity changed');
    // The exact refs/heads argument selects the original branch; retain its
    // complete native envelope in the journal and adapt only the intent ABI.
    return {ref:'refs/heads/' + branch,object:{type:'commit',sha}};
  }
  function absentRef(raw, binding, branch) {
    if (raw?.isError !== true) return false;
    const value = raw.structuredContent, data = value?.error_data;
    const statuses = [data?.response?.status,data?.code,data?.status,value?.status]
      .filter(status => status !== undefined && status !== null).map(Number);
    if (!statuses.length || statuses.some(status => !Number.isInteger(status) || status !== statuses[0]))
      return false;
    if (statuses[0] === 404) return true;
    return binding === 'mcp__codex_apps__github_fetch_commit' && statuses[0] === 422 &&
      value.error_code === 'INVALID_ARGUMENT' && value.commit === undefined &&
      data.message === 'No commit found for SHA: refs/heads/' + branch &&
      data.documentation_url === 'https://docs.github.com/rest/commits/commits#get-a-commit';
  }
  function retainedRef(call, branch) {
    if (!matchesRefCall(call,branch) || !call.raw || call.raw.isError) return null;
    return nativeRef(nativeValue(call.raw,call.binding),call.binding,branch).object.sha;
  }
  async function request(method, resource, payload) {
    const prefix = '/repos/' + repository + '/git/ref/heads/';
    if (method === 'GET' && resource.startsWith(prefix)) {
      const branch = resource.slice(prefix.length);
      if (branch !== 'main' && branch !== intent.branch) throw new TypeError('Unexpected original intent ref');
      const binding = 'mcp__codex_apps__' + refAction;
      try {
        const found = await invoke(binding,refArguments(binding,branch));
        return {status:200,body:nativeRef(found,binding,branch)};
      } catch (error) {
        if (error.status === 404 || absentRef(error.native_result,binding,branch))
          return {status:404,body:{}};
        throw error;
      }
    }
    if (method === 'POST' && resource === '/repos/' + repository + '/git/refs' && payload?.ref === 'refs/heads/' + intent.branch) {
      try {
        const found = await invoke('mcp__codex_apps__github_create_branch', {
          repository_full_name: repository, branch_name: intent.branch, sha: payload.sha
        });
        if (found.branch !== intent.branch && found.ref !== payload.ref && found.name !== intent.branch) throw new TypeError('Original ref creation uncertain');
        return {status: 201, body: found};
      } catch (error) {if (error.status === 422) return {status: 422, body: {}}; throw error;}
    }
    throw new TypeError('Unexpected original intent operation');
  }
  const localReference=value=>typeof value==='string'&&/^local:[a-f0-9]{64}$/.test(value);
  const originalReference=value=>typeof value==='string'&&(/^[a-f0-9]{40}$/.test(value)||storage&&localReference(value));
  async function localCall(action,args) {
    if(!storage)throw Object.assign(new Error('Select the one original private state coordinator before continuing.'),{code:'CONTACT_LOCAL_STORAGE_REQUIRED'});
    const binding='commons.local-state.'+action;
    const selected=frozenJson(args),call_id=modules.sha256Utf8(rateCanonical({operation_key:accountOperationKey,binding,args:selected})).sha256;
    record({phase:'invoking',binding,args:selected,call_id});
    try{const raw=await storage[action](selected);record({phase:'returned',binding,call_id,raw});return raw;}
    catch(error){record({phase:'failed',binding,call_id,status:Number(error.status)||0,message:String(error.message||error)});throw error;}
  }
  function localContent(value,namespace,key){
    if(!value)return null;
    if(value.kind!=='commons.connected-contact-local-snapshot/v1'||value.coordinator_id!==storage.coordinatorId||
       value.namespace!==namespace||value.key!==key||typeof value.content!=='string'||
       modules.sha256Utf8(value.content).sha256!==value.sha256||
       value.receipt?.sha256!==value.sha256)
      throw new TypeError('Complete original local state and receipt required.');
    return JSON.parse(value.content);
  }
  async function localIntent() {
    let value=await localCall('read',{namespace:'intent',key:intent.branch});
    if(!value){
      const found=await modules.intent.inspectIntent(spec,{request,repository});
      if(found.status==='ALREADY_RESERVED'){
        const content=JSON.stringify({schema:'commons.local-contact-intent/v1',branch:intent.branch,
          reference:found.ref_sha,original_reference:{repository,branch:intent.branch,ref_sha:found.ref_sha}});
        value=await localCall('receive',{namespace:'intent',key:intent.branch,
          operation_id:'receive-intent:'+intent.key+':'+found.ref_sha,content,
          origin:{kind:'git-original-ref-readback',repository,branch:intent.branch,ref_sha:found.ref_sha,
            sha256:modules.sha256Utf8(content).sha256,observed_at:new Date().toISOString(),
            receipt:frozenJson(found)}});
      }
    }
    const data=localContent(value,'intent',intent.branch);
    if(data&&(data.schema!=='commons.local-contact-intent/v1'||data.branch!==intent.branch||!originalReference(data.reference)))
      throw new TypeError('Original local intent identity changed.');
    return {exists:!!data,branch:intent.branch,ref_sha:data?.reference||null,
      ...(value?{storage_receipt:value.receipt}:{})};
  }
  async function reserveLocalIntent() {
    const before=await localIntent();
    if(before.exists)return {status:'ALREADY_RESERVED',...before};
    const reference='local:'+modules.sha256Utf8(rateCanonical({coordinator_id:storage.coordinatorId,intent_key:intent.key})).sha256;
    const content=JSON.stringify({schema:'commons.local-contact-intent/v1',branch:intent.branch,reference,operation_lease:lease,input_sha256:identity});
    try{
      const value=await localCall('compareAndSwap',{namespace:'intent',key:intent.branch,expected_sha256:null,
        operation_id:'reserve-intent:'+intent.key+':'+modules.sha256Utf8(lease).sha256,content});
      return {status:'RESERVED',branch:intent.branch,ref_sha:reference,storage_receipt:value.receipt};
    }catch(error){if(error.code==='LOCAL_STATE_CONFLICT')return {status:'ALREADY_RESERVED',...await localIntent()};throw error;}
  }
  async function localClaim(selectedPath) {
    let value=await localCall('read',{namespace:'recipient',key:selectedPath});
    if(!value){
      let found;
      try{found=await invoke('mcp__codex_apps__github_fetch_file',{
        repository_full_name:repository,path:selectedPath,ref:'main',encoding:'utf-8'});}
      catch(error){if(error.status===404)return null;throw error;}
      if(typeof found.content!=='string'||!/^[a-f0-9]{40}$/.test(found.sha||''))
        throw new TypeError('Original recipient source readback required.');
      // Read its current commit explicitly for immutable receiving provenance.
      const selected=await invoke('mcp__codex_apps__github_fetch',{
        url:'https://api.github.com/repos/'+repository+'/git/ref/heads/main'});
      const commit=selected.object?.sha;
      if(!/^[a-f0-9]{40}$/.test(commit||''))throw new TypeError('Original recipient source commit required.');
      const exact=await invoke('mcp__codex_apps__github_fetch_file',{
        repository_full_name:repository,path:selectedPath,ref:commit,encoding:'utf-8'});
      if(exact.content!==found.content||exact.sha!==found.sha)throw new TypeError('Original recipient changed during adoption; reopen its actual current source.');
      value=await localCall('receive',{namespace:'recipient',key:selectedPath,
        operation_id:'receive-recipient:'+modules.sha256Utf8(selectedPath).sha256+':'+exact.sha,
        content:exact.content,origin:{kind:'git-original-readback',repository,path:selectedPath,
          commit_sha:commit,blob_sha:exact.sha,sha256:modules.sha256Utf8(exact.content).sha256,
          observed_at:new Date().toISOString(),receipt:frozenJson(exact)}});
    }
    const data=localContent(value,'recipient',selectedPath);
    if(data.protocol!=='commons-first-contact-v1')throw new TypeError('Original recipient protocol changed.');
    return {sha:value.receipt.origin?.blob_sha&&value.receipt.origin.sha256===value.sha256?value.receipt.origin.blob_sha:'local:'+value.sha256,
      storage_sha256:value.sha256,record:data,storage_receipt:value.receipt,
      original_git_sha:value.receipt.origin?.blob_sha||null};
  }

  async function readClaim(spec) {
    if(storage){
      if(spec.recipient_claim_path!==path)throw new TypeError('Original recipient path changed');
      const found=await localClaim(path),record=found?.record;
      if(record?.lease===lease&&record.case===spec.opportunity_id){
        if(correction&&!correction.matchesDeliveryCorrectionClaim(spec,record,lease))
          throw new TypeError('Original recipient delivery correction changed');
        const selected=journal.delivery_correction_reservation;
        if(deliveryCorrection&&selected&&rateCanonical(record.prior_delivery_claim)!==rateCanonical(selected.prior_delivery_claim))
          throw new TypeError('Original failed recipient claim changed');
      }
      return found;
    }
    if (spec.recipient_claim_path !== path) throw new TypeError('Original recipient path changed');
    try {
      const found = await invoke('mcp__codex_apps__github_fetch_file', {
        repository_full_name: repository, path, ref: 'main', encoding: 'utf-8'
      });
      if (typeof found.content !== 'string' || !/^[a-f0-9]{40}$/.test(found.sha || '')) throw new TypeError('Original recipient file incomplete');
      const record = JSON.parse(found.content);
      if (record.protocol !== 'commons-first-contact-v1') throw new TypeError('Original recipient protocol changed');
      if (record.lease === lease && record.case === spec.opportunity_id) {
        if (correction && !correction.matchesDeliveryCorrectionClaim(spec,record,lease))
          throw new TypeError('Original recipient delivery correction changed');
        const selected = journal.delivery_correction_reservation;
        if (deliveryCorrection && selected &&
            rateCanonical(record.prior_delivery_claim) !== rateCanonical(selected.prior_delivery_claim))
          throw new TypeError('Original failed recipient claim changed');
      }
      return {sha: found.sha, record};
    } catch (error) {if (error.status === 404) return null; throw error;}
  }
  const isRecipientCorrection = () => correction?.recipientCorrection
    ? correction.recipientCorrection(deliveryCorrection) : correction?.administratorCorrection?.(deliveryCorrection);
  async function readRecipientOriginalClaim() {
    if (!isRecipientCorrection()) return null;
    const original=deliveryCorrection.original_claim;
    const selected=modules.gateway.recipientClaimPath(original.recipient);
    if(storage){const found=await localClaim(selected.path);if(!found||(found.sha!==original.sha&&found.original_git_sha!==original.sha)||rateCanonical(found.record)!==rateCanonical(original.record))throw new TypeError('Original failed recipient claim changed');return found;}
    if (selected.path===path) throw new TypeError('Replacement recipient must retain a separate original claim');
    const found=await invoke('mcp__codex_apps__github_fetch_file',{
      repository_full_name:repository,path:selected.path,ref:'main',encoding:'utf-8'});
    if (found.sha!==original.sha || typeof found.content!=='string' ||
        rateCanonical(JSON.parse(found.content))!==rateCanonical(original.record))
      throw new TypeError('The original failed recipient claim changed');
    return {sha:found.sha,record:JSON.parse(found.content)};
  }
  async function receiveRecipientSource() {
    if (!isRecipientCorrection()) return;
    const related=correction.relatedCompanyCorrection?.(deliveryCorrection)===true;
    const published=correction.publishedRecipientCorrection?.(deliveryCorrection)===true;
    const original=related ? deliveryCorrection.original_sources
      : published ? deliveryCorrection.published_source : deliveryCorrection.administrator_source;
    const [sent,notice]=await together([original.sent_id,original.failure_id].map(message_id=>
      invoke('mcp__codex_apps__gmail_read_email',{link_id:sender.link_id,message_id,format:'full'})));
    const evidence=related
      ? correction.assertRelatedCompanyRecipientSources(reviewed,sent,notice,{
        originalHtml:modules.gateway.renderFirstContactTextHtml(original.original_message.body)})
      : published ? correction.assertRecipientSources(reviewed,sent,notice,{html})
      : correction.assertAdministratorRecipientSources(reviewed,sent,notice,{html});
    await readRecipientOriginalClaim();
    let attachments=null;
    const originalDelivery=related
      ? (original.original_message.attachments?.length
        ? (() => {
          if (typeof modules.attachments?.prepare!=='function' || typeof modules.attachments?.receive!=='function')
            throw new TypeError('Load the complete original attachment receiver for the retained failed message');
          return modules.attachments.prepare(original.original_message);
        })() : null)
      : delivery;
    if (originalDelivery) {
      const received=await modules.attachments.receive(originalDelivery,sent,{readRaw:message_id=>
        invoke('mcp__codex_apps__gmail_read_email',{link_id:sender.link_id,message_id,format:'raw'})});
      attachments=received.contact_attachment_receipts.attachments.map(item=>{
        const {base64_url_content,...metadata}=item;return metadata;
      });
    }
    record({phase:related?'related-company-recipient-source-received'
      : published?'published-recipient-source-received':'administrator-recipient-source-received',...evidence,attachments});
  }
  const recipientWriteContentions = new WeakMap();
  async function writeClaim(spec, proposedRecord, sha) {
    if (spec.recipient_claim_path !== path) throw new TypeError('Original recipient path changed');
    if (correction && !correction.matchesDeliveryCorrectionClaim(spec,proposedRecord,lease))
      throw new TypeError('Retain the complete original recipient delivery proof in every CAS');
    if(storage){
      let expected=sha==null?null:localReference(sha)?sha.slice(6):null;
      if(sha!=null&&expected===null){const before=await localClaim(path);if(before?.sha!==sha)throw Object.assign(new Error('Original recipient advanced.'),{status:409,code:'LOCAL_STATE_CONFLICT'});expected=before.storage_sha256;}
      const content=JSON.stringify(proposedRecord,null,2)+'\n';
      const args={namespace:'recipient',key:path,expected_sha256:expected,
        operation_id:'recipient:'+modules.sha256Utf8(rateCanonical({path,expected,content})).sha256,content};
      return localCall('compareAndSwap',args);
    }
    const binding = sha ? 'mcp__codex_apps__github_update_file' : 'mcp__codex_apps__github_create_file';
    const args = {repository_full_name:repository, branch:'main', path,
      content:JSON.stringify(proposedRecord,null,2)+'\n',
      message:'revenue: first-contact recipient reservation [skip ci]', ...(sha ? {sha} : {})};
    for (let attempt = 0; ; attempt++) {
      try { return await invoke(binding, args); }
      catch (error) {
        if (error.status !== 409) throw error;
        const current = await readClaim(spec);
        if (sha ? current?.sha !== sha : current !== null) throw error;
        if (attempt >= 2) {
          const contention = {status:'RECIPIENT_WRITE_CONTENDED',
            recipient_claim_path:path,expected_sha:sha || null,
            observed_sha:current?.sha || null,write_attempts:attempt + 1};
          recipientWriteContentions.set(error,contention);
          record({phase:'recipient-write-contended',...contention});
          throw error;
        }
        // A moving-main rejection did not change this exact target. Retain the
        // original CAS, complete body and create-only/update distinction.
      }
    }
  }
  async function readMatchingSent(messageId, {exactEnvelope = false} = {}) {
    if (typeof messageId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(messageId)) throw new TypeError('Original Gmail message ID required');
    const native = await invoke('mcp__codex_apps__gmail_read_email', {
      link_id: sender.link_id, message_id: messageId, format: 'full'
    });
    const headers = native.payload?.headers || [];
    const header = name => {
      const selected = headers.filter(entry => entry.name?.toLowerCase() === name);
      if ((nativeDraft || exactEnvelope) && (selected.length > 1 || selected.some(entry => typeof entry.value !== 'string')))
        throw new TypeError('Duplicate or incomplete original draft SENT header: ' + name);
      return selected[0]?.value || '';
    };
    const address = value => value.trim().replace(/^.*<([^>]+)>$/, '$1').toLowerCase();
    const to = header('to').split(',').map(address);
    const labels = native.label_ids || native.labelIds || [];
    const originalBody = delivery ? native.payload?.parts?.[0] : native.payload;
    const receivedBodies = nativeArguments && typeof modules.attachments?.receiveNativeBody === 'function'
      ? modules.attachments.receiveNativeBody(nativeArguments.payload, native.payload) : null;
    const bodyPart = receivedBodies ? receivedBodies.primary : originalBody;
    if (delivery && (native.payload?.mime_type !== 'multipart/mixed' ||
        !Array.isArray(native.payload.parts) || native.payload.parts.length !== delivery.attachments.length + 1 ||
        bodyPart?.filename || bodyPart?.mime_type !== (nativeArguments ? reviewed.body_type : 'text/html') || bodyPart?.parts?.length))
      throw new TypeError('Original reviewed multipart body changed');
    if (nativeArguments && (bodyPart?.mime_type !== reviewed.body_type || bodyPart?.parts?.length || bodyPart?.filename))
      throw new TypeError('Original native text MIME type changed in SENT');
    if ((nativeDraft || exactEnvelope) && (header('cc') || header('bcc') || labels.includes('DRAFT')))
      throw new TypeError('Original recipient envelope changed in SENT');
    if (nativeDraft && (native.thread_id || native.threadId) !== nativeDraft.identity.thread_id)
      throw new TypeError('Original draft thread changed in SENT');
    if (native.id !== messageId || !labels.includes('SENT') || address(header('from')) !== sender.email ||
        to.length !== 1 || to[0] !== recipient || header('subject') !== reviewed.subject ||
        bodyPart?.body?.content !== html) throw new TypeError('Original full SENT envelope mismatch');
    let attachmentReceipts = null;
    if (delivery) {
      const received = await modules.attachments.receive(delivery, native, {
        readRaw: id => invoke('mcp__codex_apps__gmail_read_email', {
          link_id: sender.link_id, message_id:id, format:'raw'
        })
      });
      journal.native_receipt = received;
      attachmentReceipts = received.contact_attachment_receipts.attachments.map(item => {
        const {base64_url_content, ...metadata} = item; return metadata;
      });
    }
    journal.receipt = {message_id: messageId, thread_id: native.thread_id || native.threadId,
      mailbox: {link_id:sender.link_id, profile_id:sender.id, email:sender.email},
      internal_date: native.internal_date, rfc_message_id: header('message-id'),
      ...(!nativeArguments || reviewed.body_type === 'text/html'
        ? {html_sha256:modules.sha256Utf8(html).sha256} : {}),
      ...(nativeArguments ? {body_mime_type:reviewed.body_type,
        body_sha256:modules.sha256Utf8(html).sha256,
        native_arguments_sha256:modules.sha256Utf8(JSON.stringify(nativeArguments)).sha256,
        ...(receivedBodies ? {body_manifest:receivedBodies.bodies} : {})} : {}),
      ...(attachmentReceipts ? {attachments:attachmentReceipts} : {}),
      ...(nativeDraft ? {original_draft:frozenJson(nativeDraft.identity),native_send_binding:nativeSendBinding} : {}),
      ...(deliveryCorrection ? {delivery_correction_sha256:correction.deliveryCorrectionDigest(deliveryCorrection),
        original_provider_message_id:deliveryCorrection.failed_attempts.at(-1).outbound_provider_id,
        ...(reviewed.source_links?.length ? {source_delivery:journal.source_delivery} : {})} : {})};
    store(stateKey, journal);
    return {id: native.id, labels, to, subject: header('subject')};
  }
  function receiveSourceDelivery(decision,startedAt) {
    if (!reviewed.source_links?.length) return;
    const checks = decision.source_delivery;
    if (!Array.isArray(checks) || checks.length !== reviewed.source_links.length)
      throw new TypeError('Recheck every original reviewed Drive source before delivery');
    const seen = new Set();
    for (const link of reviewed.source_links) {
      if (typeof link.file_id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(link.file_id) ||
          seen.has(link.file_id) || !/^[a-f0-9]{32}$/.test(link.md5 || '') ||
          link.permission !== 'reader' || !link.account?.id || !link.account.email ||
          link.recipient !== recipient ||
          !link.url.startsWith('https://drive.google.com/'))
        throw new TypeError('Complete original prepared Drive source identity required');
      seen.add(link.file_id);
      const matches = checks.filter(item => item?.file_id === link.file_id);
      const check = matches[0];
      if (matches.length !== 1 ||
          ['file_id','url','sha256','md5','bytes','recipient','permission'].some(key => check[key] !== link[key]) ||
          check.account?.id !== link.account.id || check.account.email !== link.account.email ||
          !Number.isFinite(Date.parse(check.checked_at)) || Date.parse(check.checked_at) < startedAt ||
          Date.parse(check.checked_at) > Date.now())
        throw new TypeError('Original source identity, recipient permission or current receiving changed');
      if (link.schema === 'commons.contact-drive-source/v2') {
        if (typeof link.revision_id !== 'string' || !link.revision_id ||
            check.schema !== link.schema || check.revision_id !== link.revision_id ||
            check.filename !== link.filename || check.content_verified !== true)
          throw new TypeError('Receive the original Drive revision and complete downloaded bytes');
      } else if (typeof link.version !== 'string' || !link.version ||
          typeof link.permission_id !== 'string' || !link.permission_id ||
          check.version !== link.version || check.permission_id !== link.permission_id)
        throw new TypeError('Receive the original Drive version and reader permission');
    }
    journal.source_delivery = frozenJson(checks);
    store(stateKey,journal);
  }
  // A lost Git acknowledgement can be received from the same full journal and
  // exact target postimage. This never replays a Gmail invocation.
  async function receivePreparedCorrectionReservation() {
    if (!deliveryCorrection || sendInvocationCount() !== 0) return null;
    const prepared = journal.prepared_account_reservation;
    if (!prepared) return null;
    if (prepared.input_sha256 !== identity || prepared.operation_lease !== lease ||
        prepared.intent_branch !== intent.branch || prepared.recipient_claim_path !== path ||
        !originalReference(prepared.intent_ref_sha) ||
        (prepared.recipient_pending === true ? prepared.lease !== undefined : prepared.lease !== lease))
      throw new TypeError('Original prepared delivery correction reservation changed');
    const [remote,current] = await together([adapters.readIntent(spec),readClaim(spec)]);
    if (!remote.exists || remote.branch !== intent.branch || remote.ref_sha !== prepared.intent_ref_sha)
      throw new TypeError('Original delivery correction intent changed');
    if (current?.record.lease === lease && current.record.status === 'reserved' &&
        correction.matchesDeliveryCorrectionClaim(spec,current.record,lease)) {
      const retained = journal.delivery_correction_reservation;
      if (!retained || retained.input_sha256 !== identity || retained.operation_lease !== lease ||
          rateCanonical(current.record.prior_delivery_claim) !== rateCanonical(retained.prior_delivery_claim))
        throw new TypeError('Retain the original delivery correction CAS before its continuation');
      rememberPreparedAccountReservation({intent_ref_sha:remote.ref_sha,lease});
      return {intent_ref_sha:remote.ref_sha,lease};
    }
    if (!correction.canReserveDeliveryCorrection(spec,current?.record))
      throw new TypeError('Original failed delivery claim changed before correction');
    const original=isRecipientCorrection()
      ? await readRecipientOriginalClaim() : current;
    if (journal.delivery_correction_reservation &&
        ((current?.sha ?? null) !== journal.delivery_correction_reservation.expected_sha ||
         original.sha !== journal.delivery_correction_reservation.prior_delivery_claim.sha ||
         rateCanonical(original.record) !== rateCanonical(journal.delivery_correction_reservation.prior_delivery_claim.record)))
      throw new TypeError('Original failed delivery claim changed before correction');
    return {intent_ref_sha:remote.ref_sha,recipient_pending:true};
  }
  async function receiveLocalReservation(){
    if(!storage||sendInvocationCount()||journal.receipt)return null;
    const created=journal.events.find(event=>event.phase==='returned'&&event.binding==='commons.local-state.compareAndSwap'&&
      event.raw?.namespace==='intent'&&event.raw.key===intent.branch&&
      event.raw.receipt?.action==='compareAndSwap'&&
      (()=>{const v=localContent(event.raw,'intent',intent.branch);return v?.operation_lease===lease&&v.input_sha256===identity;})());
    if(!created)return null;
    const remote=await localIntent(),claim=await readClaim(spec);
    const accepted=localContent(created.raw,'intent',intent.branch);
    if(!remote.exists||remote.ref_sha!==accepted.reference)throw new TypeError('Original local intent changed.');
    if(claim&&(claim.record.lease!==lease||claim.record.case!==reviewed.opportunity_id||claim.record.status!=='reserved'))
      throw new TypeError('Original local recipient has another accepted state; reconcile it.');
    const reservation={intent_ref_sha:remote.ref_sha,...(claim?{lease}:{recipient_pending:true})};
    rememberPreparedAccountReservation(reservation);
    return reservation;
  }

  const adapters = {
    storage_kind:storage?.kind,
    async census(spec) {
      await verifyMailboxes();
      return Object.fromEntries(await together(mailboxes.map(async mailbox => [
        mailbox.name, {checked:true, complete:true, mailbox:mailbox.email,
          sent_ids:await messageIds(mailbox, 'in:sent to:' + spec.recipient, true)}
      ])));
    },
    async inboundCensus(spec) {
      return Object.fromEntries(await together(mailboxes.map(async mailbox => [
        mailbox.name, {checked: true, complete: true, mailbox: mailbox.email,
          message_ids: await messageIds(mailbox, 'in:anywhere from:' + spec.recipient + ' -in:sent', true)}
      ])));
    },
    async reserveIntent(spec) {
      const reserved = storage ? await reserveLocalIntent() : await modules.intent.reserveIntent(spec,{request,repository});
      if (reserved?.status === 'RESERVED' && reserved.branch === intent.branch)
        rememberPreparedAccountReservation({intent_ref_sha:reserved.ref_sha,recipient_pending:true});
      return reserved;
    },
    async readIntent(spec) {
      if(storage)return localIntent();
      const found = await modules.intent.inspectIntent(spec, {request, repository});
      return {exists: found.status === 'ALREADY_RESERVED', branch: found.branch, ref_sha: found.ref_sha};
    },
    async reserveRecipient(spec) {
      const now = new Date();
      let prior = null, proposed, expectedSha = null;
      if (deliveryCorrection) {
        const target = await readClaim(spec);
        if (!correction.canReserveDeliveryCorrection(spec,target?.record)) return {status:'NOT_RESERVED'};
        expectedSha=target?.sha ?? null;
        prior = isRecipientCorrection()
          ? await readRecipientOriginalClaim() : target;
        proposed = correction.makeDeliveryCorrectionClaim(spec,prior,{
          lease,now:now.toISOString(),expiresAt:new Date(now.getTime()+600000).toISOString()});
        const previous = journal.delivery_correction_reservation;
        if (previous) {
          if (previous.input_sha256 !== identity || previous.operation_lease !== lease ||
              previous.expected_sha !== expectedSha ||
              rateCanonical(previous.prior_delivery_claim) !== rateCanonical(proposed.prior_delivery_claim) ||
              !correction.matchesDeliveryCorrectionClaim(spec,previous.proposed_record,lease))
            throw new TypeError('Receive the same original delivery correction reservation');
          proposed = previous.proposed_record;
        } else {
          journal.delivery_correction_reservation = frozenJson({
            input_sha256:identity,operation_lease:lease,expected_sha:expectedSha,
            prior_delivery_claim:proposed.prior_delivery_claim,proposed_record:proposed,
            observed_at:now.toISOString()});
          store(stateKey,journal);
        }
      } else proposed = {protocol:'commons-first-contact-v1',status:'reserved',case:spec.opportunity_id,
        lease,reserved_at:now.toISOString(),send_expires_at:new Date(now.getTime()+600000).toISOString()};
      let mutationError;
      try { await writeClaim(spec,proposed,expectedSha ?? undefined); }
      catch (error) {
        if (!deliveryCorrection) {
          if (recipientWriteContentions.has(error)) throw error;
          if ([409,422].includes(error.status)) return {status:'NOT_RESERVED',http_status:error.status};
          throw error;
        }
        mutationError = error;
      }
      const back = await readClaim(spec);
      if (back?.record.lease !== lease || back.record.status !== 'reserved' ||
          back.record.case !== spec.opportunity_id ||
          deliveryCorrection && rateCanonical(back.record) !== rateCanonical(proposed)) {
        if (mutationError) throw mutationError;
        return {status:'READBACK_UNCERTAIN'};
      }
      const prepared = journal.prepared_account_reservation;
      if (prepared?.input_sha256 === identity && prepared.operation_lease === lease &&
          prepared.intent_branch === intent.branch && prepared.recipient_claim_path === path)
        rememberPreparedAccountReservation({intent_ref_sha:prepared.intent_ref_sha,lease});
      if (deliveryCorrection) record({phase:'delivery-correction-reserved',
        prior_recipient_sha:prior.sha,recipient_sha:back.sha,
        proof_sha256:correction.deliveryCorrectionDigest(deliveryCorrection),
        mutation_reconciled:Boolean(mutationError)});
      return {status:'RESERVED',lease};
    },
    async readRecipient(spec) {return (await readClaim(spec))?.record || null;},
    async renewRecipient(spec, originalLease) {
      const before = await readClaim(spec);
      if (before?.record.lease !== originalLease || before.record.status !== 'reserved' ||
          before.record.case !== spec.opportunity_id) return {status:'RECONCILE'};
      const updated = {...before.record,send_expires_at:new Date(Date.now()+600000).toISOString()};
      try { await writeClaim(spec,updated,before.sha); }
      catch (error) {
        if (recipientWriteContentions.has(error)) throw error;
        if (error.status === 409) return {status:'RECONCILE'};
        throw error;
      }
      const after = await readClaim(spec);
      return after?.record.lease === originalLease && after.record.status === 'reserved' &&
        after.record.case === spec.opportunity_id && after.record.send_expires_at === updated.send_expires_at
        ? {status:'RENEWED'} : {status:'RECONCILE'};
    },
    async beforeFinalCensus(spec) {
      const boundary = accountBoundary;
      if (!boundary || boundary.deferred ||
          sendInvocationCount() !== boundary.gmail_invocations ||
          spec.intent_branch !== intent.branch || spec.recipient_claim_path !== path ||
          spec.opportunity_id !== reviewed.opportunity_id)
        throw new TypeError('Original prepared contact required before the final census');
      // A retained prepared reservation, offered turn or older gateway can own
      // this exact attempt. First preparation acquires after its reservation.
      if (boundary.account_attempt) {
        const active = boundary.account_attempt;
        if (active.finished || active.invoked || activeAccountAttempt ||
            boundary.attempt_key !== active.attempt_key)
          throw new TypeError('Original unused account attempt required before the final census');
        return;
      }
      await acquireOriginalAccountAttempt(boundary, 'FINAL_SEND_CENSUS');
    },
    async beforeSend(spec, revision = null) {
      const selectedReview = revision?.reviewed ?? reviewed;
      const selectedDraft = revision?.nativeDraft ?? nativeDraft;
      const selectedIdentity = revision?.identity ?? identity;
      let decision = {can_contact:true};
      if (beforeSend) {
        const startedAt = Date.now();
        decision = frozenJson(await beforeSend(spec));
        record({phase:'relationship',decision});
        if (typeof decision?.can_contact !== 'boolean') throw new TypeError('Original relationship decision required');
        if (journal.console_handoff) {
          const data = journal.console_handoff.data;
          if (decision.handoff_sha256 !== journal.console_handoff.sha256 || decision.draft_id !== data.draft_id ||
              decision.operation_id !== data.operation_id || decision.case_id !== data.case_id)
            throw new TypeError('Current relationship gate must name this exact original console handoff');
        }
        if (!decision.can_contact) return decision;
        if (deliveryCorrection) {
          correction.assertDeliveryCorrectionGate(deliveryCorrection,decision);
          await receiveRecipientSource();
          receiveSourceDelivery(decision,startedAt);
        }
      }
      const reviewedMessages = decision.reviewed_organization_messages ?? [];
      if (!Array.isArray(reviewedMessages) ||
          reviewedMessages.length && !reviewedOrganizationDomains)
        throw new TypeError('Reviewed organization messages require explicit original domains');
      const reviewKeys = new Set();
      for (const review of reviewedMessages) {
        const key = review?.mailbox + ':' + review?.message_id;
        if (review?.schema !== 'commons.organization-correspondence-review/v1' ||
            !['OWN_OUTBOUND_OTHER_ORGANIZATION','OWN_DRAFT_OTHER_ORGANIZATION','UNRELATED_AUTOMATED_NOTICE'].includes(review.decision) ||
            review.fingerprint_version!==undefined && review.fingerprint_version!=='mime-content-v2' ||
            !mailboxes.some(mailbox => mailbox.email === review.mailbox) ||
            typeof review.message_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(review.message_id) ||
            !/^[a-f0-9]{64}$/.test(review.content_sha256 || '') ||
            typeof review.reason !== 'string' || !review.reason.trim() || review.reason.length > 2000 ||
            JSON.stringify(organizationReviewDomains(review.organization_domains)) !==
              JSON.stringify(reviewedOrganizationDomains) || reviewKeys.has(key))
          throw new TypeError('Each organization exception names one explicitly reviewed original message');
        reviewKeys.add(key);
      }
      if (organizationQuery) {
        const found = await together(mailboxes.map(async mailbox => ({
          checked:true,complete:true,mailbox:mailbox.email,
          message_ids:await messageIds(mailbox,organizationQuery,true)
        })));
        const receivedReviews = [];
        for (const review of reviewedMessages) {
          const census = found.find(mailbox => mailbox.mailbox === review.mailbox);
          if (!census.message_ids.includes(review.message_id)) continue;
          const mailbox = mailboxes.find(mailbox => mailbox.email === review.mailbox);
          const native = await invoke('mcp__codex_apps__gmail_read_email', {
            link_id:mailbox.link_id,message_id:review.message_id,format:'full'
          });
          const current = inspectOriginalOrganizationMessage({native,mailbox:mailbox.email,
            fingerprintVersion:review.fingerprint_version || 'native-payload-v1',
            organizationDomains:reviewedOrganizationDomains,
            senderMailboxes:mailboxes.map(item => item.email),sha256Utf8:modules.sha256Utf8});
          if (current.message_id !== review.message_id || !current.eligible ||
              current.content_sha256 !== review.content_sha256 || current.decision !== review.decision ||
              current.decision === 'UNRELATED_AUTOMATED_NOTICE' && current.notice_kind !== review.notice_kind)
            throw new TypeError('Re-review the complete current original organization message');
          const received = {...current,reason:review.reason};
          record({phase:'organization-message-reviewed',review:received});
          receivedReviews.push(received);
        }
        let matches = found.flatMap(mailbox => {
          const allowed = deliveryCorrection
            ? correction.reviewedDeliveryMessageIds(deliveryCorrection,mailbox.mailbox,'organization') : [];
          const ownerReviewed = receivedReviews.filter(review => review.mailbox === mailbox.mailbox)
            .map(review => review.message_id);
          const unreviewed = mailbox.message_ids.filter(id => !allowed.includes(id) && !ownerReviewed.includes(id));
          return unreviewed.length ? [{...mailbox,unreviewed_message_ids:unreviewed}] : [];
        });
        let originalDraftReview = null;
        // A full-folder census can contain this operation's saved draft. Receive
        // that exact draft through the existing full-MIME path when it is the
        // sole remaining unreviewed message. Every other match keeps its review.
        if (selectedDraft && matches.length === 1 && matches[0].mailbox === sender.email &&
            matches[0].unreviewed_message_ids.length === 1 &&
            matches[0].unreviewed_message_ids[0] === selectedDraft.identity.message_id) {
          const received = await receiveDraftSelection(selectedDraft, selectedIdentity);
          if (received.link_id !== sender.link_id ||
              received.message_id !== selectedDraft.identity.message_id)
            throw new TypeError('Keep the original sender and saved draft for organization review');
          originalDraftReview = {mailbox:sender.email,draft:selectedDraft.identity,
            received_event:journal.events.length-1,body_sha256:received.body_sha256,
            native_arguments_sha256:received.native_arguments_sha256};
          matches = [];
        }
        const censusEvent = record({phase:'organization-census',query:organizationQuery,
          input_sha256:selectedIdentity,operation_lease:lease,
          census:found,matches,reviewed_messages:receivedReviews,
          ...(originalDraftReview ? {reviewed_original_draft:originalDraftReview} : {})});
        if (matches.length) {
          const blocked = {...decision,can_contact:false,
            decision:'CURRENT_ORGANIZATION_CORRESPONDENCE',matches};
          record({phase:'relationship',source:'organization-census',input_sha256:selectedIdentity,
            operation_lease:lease,organization_census_event:journal.events.indexOf(censusEvent),
            decision:blocked});
          return blocked;
        }
      }
      if ((selectedReview.attachments ?? []).some(file=>/\.zip$/i.test(file.filename))) {
        if (typeof correction?.readContactDocumentArchives !== 'function' ||
            typeof correction?.assertContactDocumentArchives !== 'function' ||
            typeof correction?.contactDocumentArchivesDigest !== 'function')
          throw new TypeError('Load the original document-archive review contract before sending a ZIP');
        // A legacy input remains byte-identical: its native callback can inspect the
        // retained snapshots and return the review separately from the saved message.
        const declared=correction.readContactDocumentArchives(selectedReview);
        const archives=correction.assertContactDocumentArchives(selectedReview,decision.document_archives ?? declared);
        const accepted=frozenJson({input_sha256:selectedIdentity,document_archives:archives,
          document_archives_sha256:correction.contactDocumentArchivesDigest(archives)});
        if (accountBoundary?.account_attempt) accountBoundary.account_attempt.archive_review=accepted;
        record({phase:'document-archive-review',source:declared===null?'original-before-send':'reviewed-input',...accepted});
        decision={...decision,document_archives:archives,document_archives_sha256:accepted.document_archives_sha256};
      }
      return decision;
    },
    async sendEmail(envelope) {
      if (envelope.to !== reviewed.to || envelope.subject !== reviewed.subject || envelope.body !== reviewed.body ||
          envelope.link_id !== reviewed.link_id) throw new TypeError('Original reviewed envelope changed');
      const profile = await invoke('mcp__codex_apps__gmail_get_profile', {link_id: sender.link_id});
      if (String(profile.id) !== sender.id || profile.email !== sender.email) throw new TypeError('Original selected sender changed');
      const args = rateNativeArguments();
      assertFinalContactClaims(args);
      const active = accountBoundary?.account_attempt;
      if (!active || active.finished || active.invoked || activeAccountAttempt ||
          accountBoundary.attempt_key !== active.attempt_key ||
          rateCanonical(active.args) !== rateCanonical(args))
        throw new TypeError('Original preflight account token required for this exact native invocation');
      if ((reviewed.attachments ?? []).some(file=>/\.zip$/i.test(file.filename))) {
        const accepted=active.archive_review;
        if (accepted?.input_sha256 !== identity ||
            correction.contactDocumentArchivesDigest(correction.assertContactDocumentArchives(reviewed,accepted.document_archives)) !== accepted.document_archives_sha256)
          throw new TypeError('Retain this account attempt’s exact attachment review before the native call');
      }
      const attemptKey = active.attempt_key;
      activeAccountAttempt = active;
      try {
        if (nativeDraft) await receiveReviewedDraft();
        if (beforeNativeSend) {
          const binding = nativeSendBinding;
          // A local exact-payload guard runs before an invocation is recorded.
          // The existing account finalizer receives any failure as unused dispatch.
          const original = frozenJson(args);
          try {
            const decision = frozenJson(await beforeNativeSend(original));
            if (decision?.can_send !== true || rateCanonical(args) !== rateCanonical(original))
              throw new TypeError('Original exact-payload guard must approve the unchanged native arguments');
            record({phase:'native-send-preflight',binding,
              args_sha256:modules.sha256Utf8(JSON.stringify(args)).sha256,decision});
          } catch (error) {
            record({phase:'native-send-preflight-failed',binding,
              args_sha256:modules.sha256Utf8(JSON.stringify(args)).sha256,
              name:String(error?.name || 'Error'),message:String(error?.message || error)});
            throw error;
          }
        }
        // Receive the durable headroom debit before consuming the original
        // retry permission; a volume deferral must leave that permission unused.
        let confirmed;
        try { confirmed = await originalMailboxAdmission().confirm(active.lease,{
          dispatch:{args,envelope:reviewedNativeArguments()}}); }
        catch (error) {
          record({phase:'account-confirm-unfinished',operation_key:accountOperationKey,
            attempt_key:attemptKey,message:String(error.message || error)});
          deferAccount({status:'ACCOUNT_ADMISSION_UNAVAILABLE',operation_key:accountOperationKey,
            attempt_key:attemptKey});
        }
        if (confirmed?.status !== 'CONFIRMED' || confirmed.lease?.token !== active.lease.token)
          deferAccount(confirmed || {status:'ACCOUNT_LEASE_CHANGED'});
        if (Date.parse(active.lease.expires_at) <= Date.now())
          deferAccount({status:'ACCOUNT_LEASE_EXPIRED',account_key:active.account_key,
            retry_after:active.lease.expires_at});
        const provenance = await consumeRateInvocation(args);
        // The retry CAS may take time. Recheck the same charged token without
        // charging it again. Existing releaseUnusedRateAttempt() receives a
        // proved zero-invocation retry marker if this final check defers.
        const finalConfirmation=await originalMailboxAdmission().confirm(active.lease,{
          verify_only:true,dispatch:{args,envelope:reviewedNativeArguments()}});
        if(finalConfirmation?.status!=='CONFIRMED' || finalConfirmation.lease?.token!==active.lease.token)
          deferAccount(finalConfirmation || {status:'ACCOUNT_LEASE_CHANGED'});
        return await invoke(nativeSendBinding,args,{
          ...provenance,account_operation_key:accountOperationKey,account_attempt_key:attemptKey});
      } finally {
        await finishOriginalAccountAttempt(active);
      }
    },
    async readEmail({message_id, link_id}) {
      if (link_id !== sender.link_id) throw new TypeError('Original receipt mailbox changed');
      return readMatchingSent(message_id);
    },
    async completeRecipient(spec, originalLease, messageId) {
      const before = await readClaim(spec);
      if (before?.record.lease !== originalLease || before.record.status !== 'reserved' || before.record.case !== spec.opportunity_id) return {status: 'RECONCILE'};
      const record = {...before.record, status: 'sent', provider: 'gmail',
        provider_message_id: messageId, sent_verified_at: new Date().toISOString()};
      await writeClaim(spec, record, before.sha);
      const after = await readClaim(spec);
      return after?.record.status === 'sent' && after.record.lease === originalLease &&
        after.record.provider_message_id === messageId ? {status: 'SENT_RECORDED'} : {status: 'RECONCILE'};
    }
  };
  // Receive an older implicit company-census stop from its original native
  // pages. This is a zero-send reservation proof, never a new contact decision.
  function organizationCensusStop(index) {
    const event = journal.events[index];
    const fail = message => { throw new TypeError(message); };
    if (!event || event.phase !== 'organization-census' ||
        !Array.isArray(event.matches) || !event.matches.length)
      fail('Original completed organization-census match required');
    if (!organizationQuery || deliveryCorrection || journal.receipt || sendInvocationCount() ||
        event.query !== undefined && event.query !== organizationQuery ||
        event.input_sha256 !== undefined && event.input_sha256 !== identity ||
        event.operation_lease !== undefined && event.operation_lease !== lease)
      fail('Original organization query, input and zero-send operation required');
    const binding = 'mcp__codex_apps__gmail_search_email_ids';
    const firstArgs = mailbox => ({link_id:mailbox.link_id,query:organizationQuery,max_results:100});
    const start = journal.events.findLastIndex((item,at) => at < index &&
      item.phase === 'invoking' && item.binding === binding &&
      rateCanonical(item.args) === rateCanonical(firstArgs(mailboxes[0])));
    if (start < 0 || start + 1 >= index ||
        journal.events[start+1]?.phase !== 'invoking' ||
        journal.events[start+1]?.binding !== binding ||
        rateCanonical(journal.events[start+1]?.args) !== rateCanonical(firstArgs(mailboxes[1])))
      fail('Keep both original first organization-search pages in their original order');
    for (let at=start;at<index;at++)
      if (['relationship','organization-census','operation-preflight-ended'].includes(journal.events[at]?.phase))
        fail('Organization pages cross another original relationship boundary');

    const receivedCall = (at, expectedBinding, expectedArgs) => {
      const invoked = journal.events[at];
      const argsSha = modules.sha256Utf8(rateCanonical(expectedArgs)).sha256;
      const callId = modules.sha256Utf8(rateCanonical({operation_key:accountOperationKey,
        binding:expectedBinding,invocation_event:at,args_sha256:argsSha})).sha256;
      if (invoked?.phase !== 'invoking' || invoked.binding !== expectedBinding ||
          rateCanonical(invoked.args) !== rateCanonical(expectedArgs) ||
          invoked.invocation_event !== at || invoked.args_sha256 !== argsSha ||
          invoked.call_id !== callId || invoked.link_id !== expectedArgs.link_id)
        fail('Original organization native invocation binding changed');
      const outcomes = journal.events.slice(at+1,index).flatMap((item,offset) =>
        item.binding === expectedBinding && item.invocation_event === at
          ? [{event:item,index:at+1+offset}] : []);
      if (outcomes.length !== 1 || outcomes[0].event.phase !== 'returned')
        fail('Original organization native call has no single complete return');
      const returned = outcomes[0];
      if (returned.event.call_id !== callId || returned.event.args_sha256 !== argsSha ||
          returned.event.link_id !== expectedArgs.link_id || !returned.event.raw ||
          returned.event.raw.isError)
        fail('Original organization native return binding changed');
      const value = nativeValue(returned.event.raw,expectedBinding);
      return {value,proof:{invocation_event:at,returned_event:returned.index,
        call_id:callId,args_sha256:argsSha,
        response_sha256:modules.sha256Utf8(rateCanonical(returned.event.raw)).sha256}};
    };
    const state = new Map(mailboxes.map(mailbox => [mailbox.link_id,{
      mailbox,ids:[],seenIds:new Set(),seenPages:new Set(),pages:[],next:undefined,complete:false
    }]));
    const used = new Set();
    for (let at=start;at<index;at++) {
      const invoked = journal.events[at];
      if (invoked.binding !== binding || invoked.phase !== 'invoking') continue;
      const row = state.get(invoked.args?.link_id);
      if (!row || row.complete || row.pages.length &&
          row.pages.at(-1).returned_event >= at)
        fail('Original organization page sequence is incomplete or repeated');
      const args = {...firstArgs(row.mailbox),
        ...(row.next ? {next_page_token:row.next} : {})};
      const received = receivedCall(at,binding,args);
      const value = received.value;
      if (!value || !Array.isArray(value.message_ids) ||
          value.message_ids.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)))
        fail('Original organization search did not return complete message IDs');
      for (const id of value.message_ids)
        if (!row.seenIds.has(id)) { row.seenIds.add(id); row.ids.push(id); }
      const next = value.next_page_token;
      if (next !== undefined && next !== null &&
          (typeof next !== 'string' || !next || next.length > 4096 || row.seenPages.has(next)))
        fail('Original organization pagination has an invalid or repeated cursor');
      if (next) row.seenPages.add(next);
      row.next = next; row.complete = !next; row.pages.push(received.proof);
      used.add(at); used.add(received.proof.returned_event);
    }
    for (let at=start;at<index;at++)
      if (journal.events[at].binding === binding && !used.has(at))
        fail('Original organization search has an unmatched native event');
    const census = mailboxes.map(mailbox => {
      const row = state.get(mailbox.link_id);
      if (!row.complete || !row.pages.length)
        fail('Both original organization searches require a terminal page');
      return {checked:true,complete:true,mailbox:mailbox.email,message_ids:row.ids};
    });
    if (rateCanonical(event.census) !== rateCanonical(census))
      fail('Original organization census differs from its complete native pages');

    const reviews = event.reviewed_messages ?? [];
    if (!Array.isArray(reviews) || reviews.length && !reviewedOrganizationDomains)
      fail('Keep the original explicitly received organization reviews');
    const reviewKeys = new Set();
    for (const review of reviews) {
      const mailbox = mailboxes.find(item => item.email === review?.mailbox);
      const key = review?.mailbox + ':' + review?.message_id;
      if (!mailbox || reviewKeys.has(key) || !state.get(mailbox.link_id).ids.includes(review.message_id) ||
          review.schema !== 'commons.organization-correspondence-review/v1' ||
          review.eligible !== true ||
          !['OWN_OUTBOUND_OTHER_ORGANIZATION','OWN_DRAFT_OTHER_ORGANIZATION','UNRELATED_AUTOMATED_NOTICE'].includes(review.decision) ||
          typeof review.reason !== 'string' || !review.reason.trim() || review.reason.length > 2000 ||
          rateCanonical(organizationReviewDomains(review.organization_domains)) !==
            rateCanonical(reviewedOrganizationDomains))
        fail('Original organization review identity changed');
      const observations = journal.events.slice(start,index).flatMap((item,offset) =>
        item.phase === 'organization-message-reviewed' &&
        rateCanonical(item.review) === rateCanonical(review) ? [start+offset] : []);
      if (observations.length !== 1)
        fail('Keep the original single received organization review');
      const args = {link_id:mailbox.link_id,message_id:review.message_id,format:'full'};
      const at = journal.events.findLastIndex((item,position) => position >= start &&
        position < observations[0] && item.phase === 'invoking' &&
        item.binding === 'mcp__codex_apps__gmail_read_email' &&
        rateCanonical(item.args) === rateCanonical(args));
      if (at < start) fail('Original organization review has no native message read');
      const received = receivedCall(at,'mcp__codex_apps__gmail_read_email',args);
      if (received.proof.returned_event >= observations[0])
        fail('Original organization review precedes its native message');
      const inspected = inspectOriginalOrganizationMessage({native:received.value,mailbox:mailbox.email,
        fingerprintVersion:review.fingerprint_version || 'native-payload-v1',
        organizationDomains:reviewedOrganizationDomains,
        senderMailboxes:mailboxes.map(item => item.email),sha256Utf8:modules.sha256Utf8});
      if (!inspected.eligible ||
          rateCanonical({...inspected,reason:review.reason}) !== rateCanonical(review))
        fail('Original organization review differs from its retained native message');
      reviewKeys.add(key);
    }
    const matches = census.flatMap(row => {
      const ids = row.message_ids.filter(id => !reviewKeys.has(row.mailbox + ':' + id));
      return ids.length ? [{...row,unreviewed_message_ids:ids}] : [];
    });
    if (!matches.length || rateCanonical(matches) !== rateCanonical(event.matches))
      fail('Original organization stop differs from its retained unreviewed matches');
    return {census_event:index,query:organizationQuery,input_sha256:identity,operation_lease:lease,
      census_sha256:modules.sha256Utf8(rateCanonical(event)).sha256,
      mailboxes:mailboxes.map(mailbox => ({mailbox:mailbox.email,
        pages:state.get(mailbox.link_id).pages}))};
  }
  // A completed account deferral establishes only the end of this original
  // pre-send operation. Current account admission, recipient CAS and all fresh
  // correspondence remain mandatory when that reservation is used again.
  function completedAccountDeferral(index) {
    const event = journal.events[index];
    const scoped = event?.phase === 'operation-account-deferred-ended';
    if (!scoped && event?.phase !== 'account-attempt-deferred-ended') return null;
    const fail = () => {throw new TypeError('Original completed account deferral changed');};
    const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value;
    // A reviewed draft/mailbox revision can keep older completed history.
    // It cannot supply the current input's reservation proof.
    if (event.input_sha256 !== identity || event.operation_lease !== lease ||
        event.operation_key !== accountOperationKey) return null;
    if (!iso(event.observed_at) || !event.account || typeof event.account !== 'object' ||
        Array.isArray(event.account) || typeof event.account.status !== 'string' ||
        !event.account.status)
      fail();
    if (scoped) {
      if (event.gmail_invocations_before !== 0 || event.gmail_invocations_after !== 0 ||
          !Number.isSafeInteger(event.event_start) || event.event_start < 0 ||
          !Number.isSafeInteger(event.event_end) || event.event_end !== index ||
          event.event_start > event.event_end || !iso(event.started_at) ||
          Date.parse(event.started_at) > Date.parse(event.observed_at) ||
          sendInvocationCount(event.event_end) !== 0)
        fail();
    } else {
      // Older source already retained this ended attempt and its full returned
      // decision. Read that existing proof without rewriting historical events.
      const deferred = journal.account_deferred;
      if (event.gmail_invocations !== 0 || deferred?.input_sha256 !== identity ||
          deferred.operation_lease !== lease || deferred.gmail_invocations !== 0 ||
          !iso(deferred.observed_at) ||
          Date.parse(deferred.observed_at) > Date.parse(event.observed_at) ||
          deferred.outcome?.status !== 'ACCOUNT_DEFERRED' ||
          deferred.outcome.intent_branch !== intent.branch ||
          deferred.outcome.recipient_claim_path !== path ||
          rateCanonical(deferred.outcome.account) !== rateCanonical(event.account) ||
          sendInvocationCount(index + 1) !== 0)
        return null;
    }
    if (event.attempt_key !== null) {
      if (!/^[a-f0-9]{64}$/.test(event.attempt_key || '')) fail();
      const preparedIndex = journal.events.findLastIndex((item,at) => at < index &&
        item.phase === 'account-attempt-prepared' && item.operation_key === accountOperationKey);
      const prepared = journal.events[preparedIndex];
      if (preparedIndex < 0 || prepared.attempt_key !== event.attempt_key ||
          !iso(prepared.observed_at) || Date.parse(prepared.observed_at) > Date.parse(event.observed_at) ||
          scoped && preparedIndex < event.event_start)
        fail();
    } else if (!scoped) fail();
    return {event,index,account_deferral:{
      ended_event:index,operation_key:accountOperationKey,attempt_key:event.attempt_key,
      ...(scoped ? {event_start:event.event_start,event_end:event.event_end} : {}),
      account:event.account,
      event_sha256:modules.sha256Utf8(rateCanonical(event)).sha256
    }};
  }

  function completedNoSendSource(source) {
    const fail = message => {throw new TypeError(message);};
    if (!source || Object.keys(source).some(key => !['content','sha256'].includes(key)) ||
        typeof source.content !== 'string' || source.content.length > 10 * 1024 * 1024 ||
        !/^[a-f0-9]{64}$/.test(source.sha256 || '') ||
        modules.sha256Utf8(source.content).sha256 !== source.sha256)
      fail('Complete retained original no-send journal bytes and SHA-256 required');
    let previous;
    try {previous = JSON.parse(source.content);} catch {
      fail('Complete retained original no-send journal JSON required');
    }
    const same = (left,right) => rateCanonical(left) === rateCanonical(right);
    const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value;
    const gmailBinding = nativeSendBinding;
    const wasInvoked = events => events.some(outer => {
      const event = outer.phase === 'account-admission' ? outer.event : outer;
      return event?.binding === gmailBinding && event.phase === 'invoking';
    });
    if (previous?.schema !== 'commons.connected-first-contact/v1' ||
        previous.input_sha256 !== identity || previous.lease !== lease ||
        !same(previous.input,reviewed) || !Array.isArray(previous.events) ||
        previous.events.length > journal.events.length ||
        previous.events.some((event,index) => !same(event,journal.events[index])) ||
        previous.receipt || previous.native_receipt || journal.receipt || journal.native_receipt ||
        wasInvoked(previous.events) || wasInvoked(journal.events) || sendInvocationCount() ||
        previous.outcome?.status !== 'SEND_OUTCOME_UNKNOWN' || previous.outcome.message_id ||
        previous.outcome.intent_branch !== intent.branch ||
        previous.outcome.recipient_claim_path !== path)
      fail('Receive only this complete ended original journal with no Gmail invocation');
    const reservation = previous.prepared_account_reservation;
    if (!reservation || !same(reservation,journal.prepared_account_reservation) ||
        reservation.input_sha256 !== identity || reservation.operation_lease !== lease ||
        reservation.intent_branch !== intent.branch || reservation.recipient_claim_path !== path ||
        reservation.lease !== lease || reservation.recipient_pending !== undefined ||
        !originalReference(reservation.intent_ref_sha))
      fail('Preserve the original won intent and recipient reservation');
    const releasedIndex = previous.events.length - 1, released = previous.events[releasedIndex];
    const acquiredIndex = previous.events.findLastIndex(event =>
      event.phase === 'account-attempt-acquired' && event.operation_key === accountOperationKey);
    const acquired = previous.events[acquiredIndex];
    const preparedIndex = previous.events.findLastIndex(event =>
      event.phase === 'account-attempt-prepared' && event.operation_key === accountOperationKey);
    const prepared = previous.events[preparedIndex];
    const location = originalMailboxAdmission().location();
    const accepted = (write,record) => write?.schema === 'commons.gmail-account-write/v1' &&
      write.repository === location.repository && write.branch === location.branch &&
      write.path === location.path && write.account_key === location.account_key &&
      Number.isSafeInteger(write.revision) && write.revision === record.revision &&
      /^[a-f0-9]{40}$/.test(write.previous_sha || '') &&
      /^[a-f0-9]{40}$/.test(write.content_sha || '') &&
      /^[a-f0-9]{40}$/.test(write.commit_sha || '') &&
      /^[a-f0-9]{64}$/.test(write.content_sha256 || '') &&
      write.content_sha === record.state_sha && write.commit_sha === record.commit_sha;
    if (preparedIndex < 0 || acquiredIndex <= preparedIndex || releasedIndex <= acquiredIndex ||
        released?.phase !== 'account-attempt-released' || released.operation_key !== accountOperationKey ||
        released.returned !== false || released.result?.status !== 'RELEASED' ||
        !/^[a-f0-9]{64}$/.test(released.attempt_key || '') ||
        prepared.attempt_key !== released.attempt_key || acquired.attempt_key !== released.attempt_key ||
        acquired.lease?.operation_key !== accountOperationKey ||
        acquired.lease.attempt_key !== released.attempt_key ||
        !iso(acquired.lease.acquired_at) || !iso(acquired.lease.expires_at) ||
        !iso(prepared.observed_at) || !iso(acquired.observed_at) || !iso(released.observed_at) ||
        Date.parse(prepared.observed_at) > Date.parse(acquired.observed_at) ||
        Date.parse(acquired.observed_at) > Date.parse(released.observed_at) ||
        !accepted(acquired.accepted_write,acquired) ||
        !accepted(released.result.accepted_write,released.result) ||
        released.result.revision !== acquired.revision + 1 ||
        released.result.accepted_write.previous_sha !== acquired.state_sha ||
        previous.events.slice(preparedIndex+1,releasedIndex).some((event,offset) =>
          event.phase === 'account-attempt-prepared' ||
          event.phase === 'account-attempt-acquired' && preparedIndex+1+offset !== acquiredIndex))
      fail('The original acquired account attempt must have its exact acknowledged unused release');

    const readOnly = binding => /^mcp__codex_apps__(github_fetch(?:_file|_blob|_commit)?|github_get_(?:profile|user_login|repo)|gmail_(?:get_profile|search_email_ids|search_emails|read_email|read_thread|read_attachment))$/.test(binding || '');
    function completedCalls(events, start, readsOnly) {
      const pending = new Map(), returned = new Map();
      for (let offset=0;offset<events.length;offset++) {
        const outer=events[offset], nested=outer.phase==='account-admission';
        if (readsOnly && outer.phase==='operation-completed-no-send-received' &&
            outer.original_journal?.sha256===source.sha256) continue;
        const event=nested ? outer.event : outer;
        if (!event || !['invoking','returned','failed'].includes(event.phase)) {
          if (readsOnly && !['mailbox-identities-reused','relationship','organization-census'].includes(outer.phase))
            fail('A later operation must finish before receiving this earlier no-send return');
          continue;
        }
        const key=(nested?'account:':'contact:')+(event.call_id || event.binding);
        if (event.phase==='invoking') {
          if (event.binding===gmailBinding || readsOnly && !readOnly(event.binding) || pending.has(key))
            fail('The original no-send boundary contains another write or unresolved call');
          pending.set(key,{binding:event.binding,event,index:start+offset});returned.delete(key);continue;
        }
        const call=pending.get(key);
        if (event.phase==='failed') {
          if (!call && !returned.has(key) || call && !readOnly(call.binding))
            fail('Reconcile the original unresolved native write before receiving its no-send return');
          pending.delete(key);continue;
        }
        if (!call || !event.raw || !Array.isArray(event.raw.content) ||
            typeof event.raw.isError!=='boolean' ||
            !readOnly(call.binding) && event.raw.isError)
          fail('Complete paired native calls and acknowledged original writes are required');
        pending.delete(key);returned.set(key,{call,event,index:start+offset});
      }
      if (pending.size) fail('Finish the original native calls before receiving the completed no-send return');
    }
    completedCalls(previous.events,0,false);
    return {previous,preparedIndex,acquiredIndex,releasedIndex,released,
      assertLaterReads:()=>completedCalls(journal.events.slice(previous.events.length),previous.events.length,true)};
  }

  const returnedReservationOutcome = outcome => outcome?.status === 'NOT_SENT' &&
    ['RECIPIENT_NOT_WON','REMOTE_RESERVATION_READBACK_MISMATCH'].includes(outcome.reason) &&
    !outcome.message_id && !outcome.thread_id &&
    (outcome.intent_branch === undefined || outcome.intent_branch === intent.branch);

  // Older factory editions retained the ordinary gateway return only in
  // journal.outcome. Receive that complete original journal, rather than
  // inventing a thrown rejection or rewriting its native call history.
  function completedReservationReturnSource(source) {
    const fail = message => {throw new TypeError(message);};
    const same = (left,right) => rateCanonical(left) === rateCanonical(right);
    if (!source || Object.keys(source).some(key => !['content','sha256'].includes(key)) ||
        typeof source.content !== 'string' || source.content.length > 10 * 1024 * 1024 ||
        !/^[a-f0-9]{64}$/.test(source.sha256 || '') ||
        modules.sha256Utf8(source.content).sha256 !== source.sha256)
      fail('Complete retained original reservation-return journal and SHA-256 required');
    let previous;
    try {previous = JSON.parse(source.content);} catch {
      fail('Complete retained original reservation-return journal JSON required');
    }
    const invoked = events => events.some(outer => {
      const event = outer.phase === 'account-admission' ? outer.event : outer;
      return event?.binding === nativeSendBinding &&
        ['invoking','returned','failed','checkpoint-not-dispatched'].includes(event.phase);
    });
    if (deliveryCorrection || journal.console_handoff ||
        previous?.schema !== 'commons.connected-first-contact/v1' ||
        previous.input_sha256 !== identity || previous.lease !== lease ||
        !same(previous.input,reviewed) || !Array.isArray(previous.events) ||
        !previous.events.length || previous.events.length > journal.events.length ||
        previous.events.some((event,index) => !same(event,journal.events[index])) ||
        previous.receipt || previous.native_receipt || journal.receipt || journal.native_receipt ||
        invoked(previous.events) || invoked(journal.events) || sendInvocationCount() ||
        !returnedReservationOutcome(previous.outcome))
      fail('Receive this original returned NOT_SENT reservation with zero Gmail calls');
    const reservation = previous.prepared_account_reservation;
    const currentReservation=journal.prepared_account_reservation;
    if (!reservation || !currentReservation ||
        reservation.input_sha256 !== identity || reservation.operation_lease !== lease ||
        reservation.intent_branch !== intent.branch || reservation.recipient_claim_path !== path ||
        reservation.recipient_pending !== true || reservation.lease !== undefined ||
        !originalReference(reservation.intent_ref_sha) ||
        currentReservation.input_sha256!==identity || currentReservation.operation_lease!==lease ||
        currentReservation.intent_branch!==intent.branch || currentReservation.recipient_claim_path!==path ||
        currentReservation.intent_ref_sha!==reservation.intent_ref_sha ||
        (currentReservation.recipient_pending===true ? currentReservation.lease!==undefined :
          currentReservation.recipient_pending!==undefined || currentReservation.lease!==lease))
      fail('Preserve this original pending recipient and acknowledged intent');
    const readOnly = binding => /^mcp__codex_apps__(github_fetch(?:_file|_blob|_commit)?|github_get_(?:profile|user_login|repo)|gmail_(?:get_profile|search_email_ids|search_emails|read_email|read_thread|read_attachment))$/.test(binding || '');
    const calls = [], pending = new Map(), returned = new Map();
    function inspect(events,start,readsOnly) {
      for (let offset=0;offset<events.length;offset++) {
        const outer=events[offset],nested=outer.phase==='account-admission';
        if (readsOnly && outer.phase==='operation-reservation-return-received' &&
            outer.original_journal?.sha256===source.sha256) continue;
        const event=nested ? outer.event : outer;
        if (!event || !['invoking','returned','failed'].includes(event.phase)) {
          if (readsOnly && !['mailbox-identities-reused','relationship','organization-census'].includes(outer.phase))
            fail('Finish the later original operation before receiving this reservation return');
          continue;
        }
        const key=(nested?'account:':'contact:')+(event.call_id || event.binding);
        if (event.phase==='invoking') {
          if (event.binding===nativeSendBinding || pending.has(key) ||
              readsOnly && !readOnly(event.binding))
            fail('Retain complete original calls; this receiving path creates no new write');
          if (!nested && (event.invocation_event !== start+offset ||
              event.args_sha256 !== modules.sha256Utf8(rateCanonical(event.args)).sha256 ||
              event.call_id !== modules.sha256Utf8(rateCanonical({
                operation_key:accountOperationKey,binding:event.binding,
                invocation_event:start+offset,args_sha256:event.args_sha256})).sha256))
            fail('Original reservation invocation identity changed');
          pending.set(key,{event,index:start+offset,nested});
          returned.delete(key);continue;
        }
        const call=pending.get(key);
        if (event.phase==='failed') {
          if (!call && !returned.has(key) || call && !readOnly(call.event.binding))
            fail('Receive the unresolved original native write before this reservation return');
          pending.delete(key);continue;
        }
        if (!call || !event.raw || !Array.isArray(event.raw.content) ||
            typeof event.raw.isError!=='boolean' ||
            !readOnly(call.event.binding) && event.raw.isError ||
            !nested && (event.invocation_event!==call.index ||
              event.args_sha256!==call.event.args_sha256 || event.call_id!==call.event.call_id))
          fail('Original reservation calls require their exact paired native returns');
        const received={...call,returned:event,returned_index:start+offset};
        pending.delete(key);returned.set(key,received);
        if (!readsOnly && !nested) calls.push(received);
      }
      if (pending.size) fail('Finish the original native calls before receiving this returned reservation');
    }
    inspect(previous.events,0,false);
    const writes=calls.filter(call=>['mcp__codex_apps__github_create_file',
      'mcp__codex_apps__github_update_file'].includes(call.event.binding));
    if (writes.length!==1 || writes[0].event.binding!=='mcp__codex_apps__github_create_file')
      fail('This returned reservation needs its single original acknowledged creation');
    const created=writes[0],args=created.event.args;
    if (args?.repository_full_name!==repository || args.branch!=='main' || args.path!==path ||
        args.sha!==undefined || typeof args.content!=='string' || created.returned.raw.isError)
      fail('Original acknowledged recipient creation differs');
    let original;
    try {original=JSON.parse(args.content);} catch {fail('Original complete recipient postimage required');}
    const result=nativeValue(created.returned.raw,'mcp__codex_apps__github_create_file');
    if (original.protocol!=='commons-first-contact-v1' || original.status!=='reserved' ||
        original.case!==reviewed.opportunity_id || original.lease!==lease ||
        !/^[a-f0-9]{40}$/.test(result.commit_sha || result.commit?.sha || ''))
      fail('Original recipient body, lease and acknowledged provider commit required');
    const firstRead=calls.find(call=>call.index>created.returned_index &&
      call.event.binding==='mcp__codex_apps__github_fetch_file' &&
      call.event.args?.repository_full_name===repository && call.event.args.path===path &&
      call.event.args.ref==='main' && call.event.args.encoding==='utf-8');
    const status=Number(firstRead?.returned.raw?.structuredContent?.error_data?.status ??
      firstRead?.returned.raw?.structuredContent?.status ?? 0);
    if (!firstRead || firstRead.returned.raw.isError!==true || status!==404 ||
        firstRead.returned_index<=created.returned_index)
      fail('Retain the original acknowledged-create followed by its actual 404 read');
    return {previous,created,firstRead,index:previous.events.length-1,
      assertLaterReads:()=>inspect(journal.events.slice(previous.events.length),previous.events.length,true)};
  }

  function receiveCompletedReservationReturn(source) {
    const proof=completedReservationReturnSource(source);
    const existing=journal.events.find(event=>event.phase==='operation-reservation-return-received' &&
      event.recipient_creation_event===proof.created.index);
    if (existing && (existing.original_journal?.sha256!==source.sha256 ||
        existing.input_sha256!==identity || existing.operation_lease!==lease ||
        existing.operation_key!==accountOperationKey ||
        existing.original_event_count!==proof.previous.events.length ||
        rateCanonical(existing.original_outcome)!==rateCanonical(proof.previous.outcome) ||
        existing.recipient_return_event!==proof.created.returned_index ||
        existing.recipient_absence_event!==proof.firstRead.returned_index))
      throw new TypeError('Keep the original received reservation-return source');
    // Re-adopting an already validated receipt cannot discard progress. Its
    // historical proof stays bound to the original prefix, while later ordinary
    // receiving and reservations retain their own journal and boundaries.
    if (!existing) proof.assertLaterReads();
    if (!existing) record({phase:'operation-reservation-return-received',
      input_sha256:identity,operation_lease:lease,operation_key:accountOperationKey,
      original_event_count:proof.previous.events.length,
      original_outcome:frozenJson(proof.previous.outcome),
      recipient_creation_event:proof.created.index,
      recipient_return_event:proof.created.returned_index,
      recipient_absence_event:proof.firstRead.returned_index,
      original_journal:{content:source.content,sha256:source.sha256}});
    return {status:'COMPLETED_NO_SEND_RECEIVED',input_sha256:identity,
      operation_key:accountOperationKey,source_sha256:source.sha256,
      original_outcome:frozenJson(proof.previous.outcome),
      recipient_creation_event:proof.created.index,provider_outcome:'NOT_INVOKED'};
  }


  function receiveCompletedNoSend(source) {
    if (publicCalls || mailboxSelectionActive || accountBoundary || activeAccountAttempt || activeRateContinuation)
      throw new TypeError('Finish the original native operation before receiving its completed no-send return');
    if (typeof source?.content==='string' && source.content.length<=10*1024*1024) {
      let original;
      try {original=JSON.parse(source.content);} catch {}
      if (returnedReservationOutcome(original?.outcome)) return receiveCompletedReservationReturn(source);
    }
    const proof=completedNoSendSource(source);
    proof.assertLaterReads();
    const existing=journal.events.find(event=>event.phase==='operation-completed-no-send-received' &&
      event.operation_key===accountOperationKey && event.attempt_key===proof.released.attempt_key);
    if (existing && existing.original_journal?.sha256!==source.sha256)
      throw new TypeError('This original account attempt already has a different completed no-send source');
    if (!existing) record({phase:'operation-completed-no-send-received',
      input_sha256:identity,operation_lease:lease,operation_key:accountOperationKey,
      attempt_key:proof.released.attempt_key,provider_outcome:'NOT_INVOKED',
      original_event_count:proof.previous.events.length,
      prepared_event:proof.preparedIndex,acquired_event:proof.acquiredIndex,
      released_event:proof.releasedIndex,original_completed_at:proof.released.observed_at,
      original_journal:{content:source.content,sha256:source.sha256}});
    return {status:'COMPLETED_NO_SEND_RECEIVED',input_sha256:identity,
      operation_key:accountOperationKey,attempt_key:proof.released.attempt_key,
      source_sha256:source.sha256,original_completed_at:proof.released.observed_at,
      provider_outcome:'NOT_INVOKED',gmail_invocations:0};
  }

  function completedNoSendBoundary() {
    for (let index=journal.events.length-1;index>=0;index--) {
      const event = journal.events[index];
      if (event.phase === 'operation-reservation-return-received') {
        const proof=completedReservationReturnSource(event.original_journal);
        if (event.input_sha256!==identity || event.operation_lease!==lease ||
            event.operation_key!==accountOperationKey ||
            event.original_event_count!==proof.previous.events.length ||
            rateCanonical(event.original_outcome)!==rateCanonical(proof.previous.outcome) ||
            event.recipient_creation_event!==proof.created.index ||
            event.recipient_return_event!==proof.created.returned_index ||
            event.recipient_absence_event!==proof.firstRead.returned_index ||
            proof.index>=index)
          throw new TypeError('The original received reservation return changed');
        return {event,index:proof.index,returned_reservation:{
          source_sha256:event.original_journal.sha256,
          outcome:proof.previous.outcome,
          recipient_creation_event:proof.created.index,
          recipient_absence_event:proof.firstRead.returned_index}};
      }
      if (event.phase === 'operation-returned-no-send-ended') {
        if (event.input_sha256!==identity || event.operation_lease!==lease ||
            event.operation_key!==accountOperationKey ||
            event.gmail_invocations_before!==0 || event.gmail_invocations_after!==0 ||
            !Number.isInteger(event.event_start) || event.event_start<0 ||
            event.event_start>index || event.event_end!==index ||
            !returnedReservationOutcome(event.outcome) ||
            event.outcome_sha256!==modules.sha256Utf8(rateCanonical(event.outcome)).sha256)
          throw new TypeError('Original returned no-send boundary changed');
        return {event,index,returned_reservation:{outcome:event.outcome,
          outcome_sha256:event.outcome_sha256}};
      }
      if(event.phase==='account-interruption-received') {
        const prepared=journal.events[event.prepared_event];
        if(!prepared)throw new TypeError('The original account interruption preparation changed');
        const received=receivedAccountInterruption(prepared,event.prepared_event);
        if(received && received.index===index)
          return {event,index,account_interruption:event.checkpoint_proof};
      }
      if (event.phase === 'operation-completed-no-send-received') {
        const proof=completedNoSendSource(event.original_journal);
        if (event.input_sha256!==identity || event.operation_lease!==lease ||
            event.operation_key!==accountOperationKey ||
            event.attempt_key!==proof.released.attempt_key ||
            event.provider_outcome!=='NOT_INVOKED' ||
            event.original_event_count!==proof.previous.events.length ||
            event.prepared_event!==proof.preparedIndex || event.acquired_event!==proof.acquiredIndex ||
            event.released_event!==proof.releasedIndex ||
            event.original_completed_at!==proof.released.observed_at || proof.releasedIndex>=index)
          throw new TypeError('The received original no-send boundary changed');
        // The authority ends at the original released attempt, not today's
        // receiving event. A later recipient write needs its own ended boundary.
        return {event,index:proof.releasedIndex};
      }
      if (event.phase === 'operation-account-deferred-ended' ||
          event.phase === 'account-attempt-deferred-ended') {
        const ended = completedAccountDeferral(index);
        if (ended) return ended;
      }
      if (event.phase === 'relationship' && event.decision?.can_contact === false) {
        if (event.source === 'organization-census') {
          if (event.input_sha256 !== identity || event.operation_lease !== lease ||
              event.organization_census_event !== index-1 ||
              event.decision.decision !== 'CURRENT_ORGANIZATION_CORRESPONDENCE' ||
              rateCanonical(event.decision.matches) !== rateCanonical(journal.events[index-1]?.matches))
            throw new TypeError('Original explicit organization relationship outcome changed');
          return {event,index,organization_census:organizationCensusStop(index-1)};
        }
        return {event,index};
      }
      if (event.phase === 'operation-preflight-ended' &&
          event.input_sha256 === identity && event.operation_lease === lease &&
          event.gmail_invocations_before === 0 && event.gmail_invocations_after === 0 &&
          Number.isInteger(event.event_start) && event.event_start >= 0 &&
          Number.isInteger(event.event_end) && event.event_end <= index)
        return {event,index};
      if (event.phase === 'organization-census' && Array.isArray(event.matches) && event.matches.length)
        return {event,index,organization_census:organizationCensusStop(index)};
    }
    return null;
  }

  // A beforeNativeSend callback runs inside the original adapter before the
  // native invocation is recorded. Receive only that adapter's complete failed
  // boundary and its explicit unused account release. An absent send result or
  // an expired lease is not a no-send proof.
  function completedNativePreflightBoundary() {
    const binding = nativeSendBinding;
    if (sendInvocationCount() || journal.receipt || journal.native_receipt) return null;
    const failedIndex = journal.events.findLastIndex(event =>
      event.phase === 'native-send-preflight-failed' && event.binding === binding);
    if (failedIndex < 0) return null;
    const failed = journal.events[failedIndex];
    const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value;
    if (!iso(failed.observed_at) ||
        failed.args_sha256 !== modules.sha256Utf8(JSON.stringify(rateNativeArguments())).sha256 ||
        typeof failed.name !== 'string' || typeof failed.message !== 'string')
      throw new TypeError('Original native preflight failure changed');
    // Keep actual, unresolved and separately received provider calls on their
    // existing receiving path; this boundary never subtracts an invocation.
    if (journal.events.some(event => event.binding === binding &&
        ['invoking','returned','failed','checkpoint-not-dispatched'].includes(event.phase)))
      return null;
    const acquiredIndex = journal.events.findLastIndex((event,index) =>
      index < failedIndex && event.phase === 'account-attempt-acquired' &&
      event.operation_key === accountOperationKey);
    const acquired = journal.events[acquiredIndex];
    if (!acquired || !/^[a-f0-9]{64}$/.test(acquired.attempt_key || '') ||
        acquired.lease?.operation_key !== accountOperationKey ||
        acquired.lease.attempt_key !== acquired.attempt_key ||
        !/^[a-f0-9]{64}$/.test(acquired.lease.token || '') ||
        !iso(acquired.observed_at) || Date.parse(acquired.observed_at) > Date.parse(failed.observed_at))
      throw new TypeError('Original native preflight account acquisition required');
    if (journal.events.slice(acquiredIndex+1).some(event =>
        ['account-attempt-prepared','account-attempt-acquired'].includes(event.phase) &&
        event.operation_key === accountOperationKey))
      return null;
    const releasedIndex = journal.events.findLastIndex((event,index) =>
      index > failedIndex && event.phase === 'account-attempt-released' &&
      event.operation_key === accountOperationKey && event.attempt_key === acquired.attempt_key &&
      event.returned === false &&
      ['RELEASED','ORIGINAL_LEASE_NO_LONGER_ACTIVE'].includes(event.result?.status));
    if (releasedIndex < 0) return null;
    const released = journal.events[releasedIndex];
    if (!iso(released.observed_at) || Date.parse(released.observed_at) < Date.parse(failed.observed_at))
      throw new TypeError('Original native preflight release order changed');
    return {event:released,index:releasedIndex,native_preflight:{
      failure_event:failedIndex,args_sha256:failed.args_sha256,
      account_acquired_event:acquiredIndex,account_released_event:releasedIndex,
      attempt_key:acquired.attempt_key}};
  }

  // Receive the original acknowledged intent when its immediate ref lookup
  // finished before the new branch became visible. The retained native create
  // and its preceding absent/base reads establish the original creator.
  function intentReadbackContinuation() {
    if (deliveryCorrection || journal.console_handoff || journal.receipt ||
        sendInvocationCount() || journal.prepared_account_reservation) return null;
    const pairs = binding => {
      const found = []; let pending = null;
      journal.events.forEach((event,index) => {
        if (event.binding !== binding) return;
        if (event.phase === 'invoking') {
          if (pending || event.invocation_event !== index ||
              event.args_sha256 !== modules.sha256Utf8(rateCanonical(event.args)).sha256 ||
              event.call_id !== modules.sha256Utf8(rateCanonical({operation_key:accountOperationKey,
                binding,invocation_event:index,args_sha256:event.args_sha256})).sha256)
            throw new TypeError('Complete original intent invocation required');
          pending = {index,args:event.args,args_sha256:event.args_sha256,call_id:event.call_id,binding};
        } else if (event.phase === 'returned') {
          if (!pending || event.invocation_event !== pending.index ||
              event.args_sha256 !== pending.args_sha256 || event.call_id !== pending.call_id)
            throw new TypeError('Original intent native return differs');
          found.push({...pending,returned_index:index,raw:event.raw}); pending = null;
        } else if (event.phase === 'failed' && pending) {
          found.push({...pending,failed_index:index,failure:event}); pending = null;
        } else if (event.phase === 'checkpoint-not-dispatched') {
          throw new TypeError('Receive the original undispatched intent call through its checkpoint');
        }
      });
      if (pending) throw new TypeError('Original intent call still needs its native result');
      return found;
    };
    const createdCalls = pairs('mcp__codex_apps__github_create_branch');
    if (!createdCalls.length) return null;
    if (createdCalls.length !== 1)
      throw new TypeError('Receive the original single acknowledged intent creation');
    const created = createdCalls[0];
    if (created.args?.repository_full_name !== repository ||
        created.args.branch_name !== intent.branch ||
        !/^[a-f0-9]{40}$/.test(created.args.sha || '') ||
        !created.raw || created.raw.isError) return null;
    const result = nativeValue(created.raw,'mcp__codex_apps__github_create_branch');
    if (result.branch !== intent.branch && result.ref !== 'refs/heads/' + intent.branch &&
        result.name !== intent.branch)
      throw new TypeError('Original acknowledged intent identity differs');
    // Once recipient work starts, its existing receiving methods retain custody.
    if (journal.events.some(event => event.phase === 'invoking' &&
        ['mcp__codex_apps__github_create_file','mcp__codex_apps__github_update_file'].includes(event.binding) &&
        event.args?.repository_full_name === repository && event.args.path === path)) return null;
    const refs = refBindings.flatMap(binding => pairs(binding))
      .sort((left,right) => left.index - right.index);
    const absent = refs.filter(call => call.returned_index < created.index &&
      matchesRefCall(call,intent.branch) && absentRef(call.raw,call.binding,intent.branch)).at(-1);
    const base = refs.filter(call => call.returned_index < created.index &&
      retainedRef(call,'main') === created.args.sha).at(-1);
    if (!absent || !base || absent.returned_index >= base.index)
      throw new TypeError('Original absent intent and selected main revision required');
    const later = refs.filter(call => call.index > created.returned_index &&
      matchesRefCall(call,intent.branch));
    if (!later.length || later.some(call => !call.raw))
      throw new TypeError('Receive the original intent readback result');
    let readback = null;
    for (const call of later) {
      if (call.raw.isError) continue;
      if (retainedRef(call,intent.branch) !== created.args.sha)
        throw new TypeError('Original intent ref changed after its acknowledged creation');
      readback = call;
    }
    return {
      intent_ref_sha:created.args.sha,recipient_pending:true,
      intent_branch:intent.branch,recipient_claim_path:path,input_sha256:identity,
      intent_creation_event:created.index,intent_creation_returned_event:created.returned_index,
      intent_absent_event:absent.returned_index,intent_base_event:base.returned_index,
      intent_readback_event:readback?.returned_index ?? null
    };
  }

  async function receiveAcknowledgedIntentReadback() {
    const original = intentReadbackContinuation();
    if (!original) return null;
    const eventStart = journal.events.length;
    const [remote,current] = await together([adapters.readIntent(spec),readClaim(spec)]);
    if (!remote.exists || remote.branch !== intent.branch ||
        remote.ref_sha !== original.intent_ref_sha)
      throw new TypeError('Original acknowledged intent is not present at its selected revision');
    if (current !== null)
      throw new TypeError('Receive the existing original recipient reservation before continuing');
    const received = intentReadbackContinuation();
    if (!received || received.intent_creation_event !== original.intent_creation_event ||
        received.intent_readback_event === null || received.intent_readback_event < eventStart)
      throw new TypeError('Fresh original intent readback required');
    journal.intent_readback_received = {
      ...received,operation_lease:lease,gmail_invocations:sendInvocationCount(),
      observed_at:new Date().toISOString()
    };
    record({phase:'intent-readback-received',...journal.intent_readback_received});
    rememberPreparedAccountReservation({intent_ref_sha:received.intent_ref_sha,recipient_pending:true});
    return {intent_ref_sha:received.intent_ref_sha,recipient_pending:true};
  }

  function recipientContinuation(inspectCreationAbsence = false) {
    const fail = message => {throw new TypeError(message);};
    if (!Array.isArray(journal.events)) fail('Complete original native journal required');
    if (journal.receipt || sendInvocationCount())
      fail('Original Gmail invocation retained; reconcile its existing message');
    // The original Git transport is sequential for each of these bindings.
    // Pair retained invocation/response events; caller-supplied resume flags
    // and a current remote ref alone never establish who won its creation.
    const calls = binding => {
      const result = []; let pending;
      journal.events.forEach((event, index) => {
        if (event.binding !== binding) return;
        if (event.phase === 'checkpoint-not-dispatched') {
          if (pending) fail('Original native call is still unresolved');
          const receive = modules.checkpoints?.receiveUndispatchedNativeCall;
          if (typeof receive !== 'function')
            fail('Load the complete original checkpoint to receive its undispatched recipient call');
          const undispatched = receive({eventIndex:index,binding});
          result.push({index,args:event.args,undispatched});
        } else if (event.phase === 'invoking') {
          if (pending) fail('Original native call is still unresolved');
          pending = {index, args: event.args};
        } else if (event.phase === 'returned') {
          if (!pending) fail('Original native response has no invocation');
          result.push({...pending, returned_index: index, raw: event.raw}); pending = null;
        } else if (event.phase === 'failed' && pending) {
          result.push({...pending, failed_index: index, failure: event}); pending = null;
        }
      });
      if (pending) result.push(pending);
      return result;
    };
    const status = call => Number(call.raw?.structuredContent?.error_data?.status ??
      call.raw?.structuredContent?.status ?? 0);
    const fetches = refBindings.flatMap(binding => calls(binding).map(call => ({...call,binding})))
      .sort((left,right) => left.index - right.index);
    const refResult = retainedRef;
    const branches = calls('mcp__codex_apps__github_create_branch');
    if (branches.length !== 1) fail('Original successful intent creation required');
    const created = branches[0];
    if (created.args?.repository_full_name !== repository || created.args.branch_name !== intent.branch ||
        !/^[a-f0-9]{40}$/.test(created.args.sha || '') || !created.raw || created.raw.isError)
      fail('Original successful intent creation required');
    const result = nativeValue(created.raw, 'mcp__codex_apps__github_create_branch');
    if (result.branch !== intent.branch && result.ref !== 'refs/heads/' + intent.branch && result.name !== intent.branch)
      fail('Original created intent differs');
    const base = fetches.find(call => call.returned_index < created.index &&
      refResult(call, 'main') === created.args.sha);
    const absent = fetches.find(call => call.returned_index < created.index &&
      matchesRefCall(call,intent.branch) && absentRef(call.raw,call.binding,intent.branch));
    const readback = fetches.find(call => call.index > created.returned_index &&
      refResult(call, intent.branch) === created.args.sha);
    if (!base || !absent || !readback) fail('Original intent creation and provider readback required');

    const mutations = [...calls('mcp__codex_apps__github_create_file').map(call => ({...call, kind: 'create'})),
      ...calls('mcp__codex_apps__github_update_file').map(call => ({...call, kind: 'update'}))]
      .sort((left, right) => left.index - right.index);
    if (!mutations.length) fail('Original rejected recipient creation required');

    // A completed relationship/preflight return can leave the original won
    // reservation intact. Receive that source-owned zero-send boundary before
    // renewing it; a current remote reservation alone is not a continuation.
    const ordinaryEnd = completedNoSendBoundary();
    const nativePreflightEnd = completedNativePreflightBoundary();
    const ended = nativePreflightEnd && (!ordinaryEnd || nativePreflightEnd.index > ordinaryEnd.index)
      ? nativePreflightEnd : ordinaryEnd;
    // A returned transport error remains an unknown write until this original
    // operation receives the exact recipient path absent from the same actor.
    // The proof permits only the gateway's create-only reservation continuation.
    const transportUnknown = call => {
      const raw = call.raw, native = raw?.structuredContent;
      return call.kind === 'create' && raw?.isError === true &&
        native?.error_code === 'UNKNOWN' &&
        native.error === 'RemoteProtocolError: Server disconnected without sending a response.' &&
        native.error_data === undefined && native.status === undefined &&
        Array.isArray(raw.content) && raw.content.length === 1 &&
        raw.content[0].type === 'text' && raw.content[0].text === native.error;
    };
    const receivedAbsence = call => {
      if (!transportUnknown(call)) return null;
      const receiptIndex = journal.events.findIndex((event,index) =>
        event.phase === 'recipient-create-absence-received' &&
        event.recipient_creation_event === call.index &&
        event.recipient_return_event === call.returned_index &&
        index > call.returned_index);
      if (receiptIndex < 0) return null;
      const proof = journal.events[receiptIndex];
      const recipientRead = calls('mcp__codex_apps__github_fetch_file')
        .find(read => read.returned_index === proof.recipient_absence_event);
      const intentRead = fetches.find(read => read.returned_index === proof.intent_readback_event);
      const boundary = journal.events[proof.completed_no_send_event];
      if (proof.input_sha256 !== identity || proof.operation_lease !== lease ||
          proof.intent_branch !== intent.branch || proof.recipient_claim_path !== path ||
          proof.intent_ref_sha !== created.args.sha || proof.gmail_invocations !== 0 ||
          proof.recipient_args_sha256 !== modules.sha256Utf8(rateCanonical(call.args)).sha256 ||
          !Number.isInteger(proof.completed_no_send_event) ||
          proof.completed_no_send_event <= call.returned_index ||
          proof.completed_no_send_event >= recipientRead?.index ||
          boundary?.phase !== 'operation-preflight-ended' ||
          boundary.input_sha256 !== identity || boundary.operation_lease !== lease ||
          boundary.gmail_invocations_before !== 0 || boundary.gmail_invocations_after !== 0 ||
          !intentRead || intentRead.index <= proof.completed_no_send_event ||
          intentRead.returned_index >= receiptIndex ||
          refResult(intentRead,intent.branch) !== created.args.sha ||
          !recipientRead || recipientRead.index <= proof.completed_no_send_event ||
          recipientRead.returned_index >= receiptIndex ||
          recipientRead.args?.repository_full_name !== repository ||
          recipientRead.args.path !== path || recipientRead.args.ref !== 'main' ||
          recipientRead.args.encoding !== 'utf-8' ||
          recipientRead.raw?.isError !== true || status(recipientRead) !== 404 ||
          mutations.some(other => other.index > call.index && other.index < receiptIndex))
        fail('Original recipient absence receiving proof changed');
      return {event:receiptIndex,proof};
    };
    const unreceived = [];
    const successfulCreate = mutations.find(call => call.kind === 'create' &&
      call.raw && !call.raw.isError && call.returned_index < (ended?.index ?? -1));
    if (ended && successfulCreate) {
      const retained = journal.prepared_account_reservation;
      if (!retained || retained.input_sha256 !== identity ||
          retained.operation_lease !== lease || retained.intent_branch !== intent.branch ||
          retained.recipient_claim_path !== path ||
          (retained.recipient_pending === true ? retained.lease !== undefined
            : retained.recipient_pending !== undefined || retained.lease !== lease) ||
          retained.intent_ref_sha !== created.args.sha)
        fail('Original completed no-send reservation changed');
      if (mutations.filter(call => call.kind === 'create' && !receivedAbsence(call)).length !== 1)
        fail('Original successful recipient creation required');
      for (const call of mutations) {
        const absence = receivedAbsence(call);
        if (absence && absence.event < successfulCreate.index) continue;
        const args = call.args;
        if (args?.repository_full_name !== repository || args.branch !== 'main' ||
            args.path !== path || typeof args.content !== 'string' ||
            call.index <= readback.returned_index || !call.raw || call.raw.isError ||
            call.returned_index >= ended.index ||
            (call.kind === 'create' ? args.sha !== undefined : !/^[a-f0-9]{40}$/.test(args.sha || '')))
          fail('Original recipient mutation requires reconciliation');
        const reserved = JSON.parse(args.content);
        if (reserved.protocol !== 'commons-first-contact-v1' || reserved.status !== 'reserved' ||
            reserved.case !== reviewed.opportunity_id || reserved.lease !== lease)
          fail('Original recipient input or lease changed');
        const result = nativeValue(call.raw,call.kind === 'create'
          ? 'mcp__codex_apps__github_create_file' : 'mcp__codex_apps__github_update_file');
        if (!/^[a-f0-9]{40}$/.test(result.commit_sha || result.commit?.sha || ''))
          fail('Original recipient write has no completed provider commit');
      }
      const finalMutation = mutations.at(-1);
      const recipientReadback = calls('mcp__codex_apps__github_fetch_file').findLast(call => {
        if (call.index <= finalMutation.returned_index ||
            call.args?.repository_full_name !== repository || call.args.path !== path ||
            call.args.ref !== 'main' || call.args.encoding !== 'utf-8' ||
            !call.raw || call.raw.isError) return false;
        const result = nativeValue(call.raw,'mcp__codex_apps__github_fetch_file');
        return /^[a-f0-9]{40}$/.test(result.sha || '') &&
          result.content === finalMutation.args.content;
      });
      const proof = {intent_ref_sha:created.args.sha,
        intent_branch:intent.branch,recipient_claim_path:path,input_sha256:identity,
        intent_creation_event:created.index,intent_readback_event:readback.returned_index,
        recipient_creation_event:successfulCreate.index,
        recipient_write_event:finalMutation.index,
        recipient_write_sha256:modules.sha256Utf8(finalMutation.args.content).sha256,
        completed_no_send_event:ended.index,
        ...(ended.returned_reservation ? {returned_reservation:ended.returned_reservation} : {}),
        ...(ended.native_preflight ? {native_preflight:ended.native_preflight} : {}),
        ...(ended.organization_census ? {organization_census:ended.organization_census} : {}),
        ...(ended.account_deferral ? {account_deferral:ended.account_deferral} : {}),
        ...(ended.account_interruption ? {account_interruption:ended.account_interruption} : {})};
      if (!recipientReadback) {
        if (retained.recipient_pending !== true)
          fail('Original successful recipient write and readback required');
        // The original create committed, but this operation has not received its
        // exact file yet. This proof authorizes only the native readback below.
        return {...proof,recipient_pending:true,recipient_readback_required:true};
      }
      return {...proof,lease,recipient_readback_event:recipientReadback.returned_index};
    }
    for (const call of mutations) {
      const args = call.args;
      if (call.kind !== 'create' || args?.repository_full_name !== repository || args.branch !== 'main' ||
          args.path !== path || args.sha !== undefined || typeof args.content !== 'string' ||
          call.index <= readback.returned_index)
        fail('Original recipient mutation requires reconciliation');
      const reserved = JSON.parse(args.content);
      if (reserved.protocol !== 'commons-first-contact-v1' || reserved.status !== 'reserved' ||
          reserved.case !== reviewed.opportunity_id || reserved.lease !== lease)
        fail('Original recipient input or lease changed');
      if (call.undispatched) {
        const proof = call.undispatched;
        if (proof.status !== 'NOT_DISPATCHED' || proof.input_sha256 !== identity ||
            proof.operation_lease !== lease || proof.event_index !== call.index ||
            proof.binding !== 'mcp__codex_apps__github_create_file' ||
            proof.args_sha256 !== modules.sha256Utf8(JSON.stringify(args)).sha256)
          fail('Original undispatched recipient creation changed');
        continue;
      }
      const absence = receivedAbsence(call);
      if (absence) continue;
      if (inspectCreationAbsence && transportUnknown(call)) {
        const boundary = journal.events.findIndex((event,index) =>
          index > call.returned_index && event.phase === 'operation-preflight-ended' &&
          event.input_sha256 === identity && event.operation_lease === lease &&
          event.gmail_invocations_before === 0 && event.gmail_invocations_after === 0 &&
          Number.isInteger(event.event_start) && event.event_start <= call.index &&
          Number.isInteger(event.event_end) && event.event_end > call.returned_index &&
          event.event_end <= index);
        if (boundary < 0) fail('Original recipient transport call has no completed no-send boundary');
        unreceived.push({recipient_creation_event:call.index,
          recipient_return_event:call.returned_index,
          recipient_args_sha256:modules.sha256Utf8(rateCanonical(args)).sha256,
          completed_no_send_event:boundary});
        continue;
      }
      const conflict = call.raw?.structuredContent?.error_data;
      const match = /^is at ([a-f0-9]{40}) but expected ([a-f0-9]{40})$/.exec(conflict?.message || '');
      if (call.raw?.isError !== true || status(call) !== 409 || !match || match[1] === match[2])
        fail('Original recipient create has no definite moving-main rejection; reconcile its provider result');
    }
    return {intent_ref_sha: created.args.sha, recipient_pending: true,
      intent_branch: intent.branch, recipient_claim_path: path, input_sha256: identity,
      intent_creation_event: created.index, intent_readback_event: readback.returned_index,
      rejected_recipient_events: mutations.filter(call => !call.undispatched && !transportUnknown(call)).map(call => call.returned_index),
      ...(unreceived.length ? {recipient_creation_absence_required:unreceived} : {}),
      ...(mutations.some(call => receivedAbsence(call)) ? {
        absent_recipient_events:mutations.map(call => receivedAbsence(call)).filter(Boolean).map(row => row.event)
      } : {}),
      ...(mutations.some(call => call.undispatched) ? {
        undispatched_recipient_events:mutations.filter(call => call.undispatched).map(call => call.undispatched)
      } : {})};
  }

  // Explicit read-only reconciliation of one original returned transport loss.
  // A Gmail invocation, a permission/quota rejection, a live/unreturned call or
  // a present recipient file cannot enter this path.
  async function receiveRecipientCreationAbsence() {
    if (deliveryCorrection || journal.console_handoff || journal.receipt || sendInvocationCount())
      throw new TypeError('Use this original zero-send recipient operation');
    const inspected = recipientContinuation(true);
    const pending = inspected.recipient_creation_absence_required;
    if (!pending?.length) return {status:'RECIPIENT_CREATION_ABSENCE_ALREADY_RECEIVED',...inspected};
    if (pending.length !== 1)
      throw new TypeError('Reconcile one original uncertain recipient creation at a time');
    await verifyActor();
    const start = journal.events.length;
    const remote = await adapters.readIntent(spec);
    if (!remote.exists || remote.branch !== intent.branch || remote.ref_sha !== inspected.intent_ref_sha)
      throw new TypeError('Original acknowledged intent changed');
    const current = await readClaim(spec);
    if (current !== null)
      throw new TypeError('Original recipient file is present; reconcile that existing reservation');
    // Bind the complete native read envelopes, including their actual 404.
    const recent = journal.events.slice(start);
    const intentOffset = recent.findLastIndex(event => event.phase === 'returned' &&
      refBindings.includes(event.binding));
    const absenceOffset = recent.findLastIndex(event => event.phase === 'returned' &&
      event.binding === 'mcp__codex_apps__github_fetch_file');
    if (intentOffset < 0 || absenceOffset < 0)
      throw new TypeError('Complete original intent and recipient absence reads required');
    record({phase:'recipient-create-absence-received',input_sha256:identity,
      operation_lease:lease,intent_branch:intent.branch,recipient_claim_path:path,
      intent_ref_sha:remote.ref_sha,...pending[0],
      intent_readback_event:start+intentOffset,recipient_absence_event:start+absenceOffset,
      gmail_invocations:sendInvocationCount()});
    const received = recipientContinuation();
    return {status:'RECIPIENT_CREATION_ABSENCE_RECEIVED',...received};
  }

  // Receive an acknowledged original recipient write whose required file read
  // ended before Gmail. Provider reads remain in the original native journal.
  // No branch, recipient file, account lease or email is created here.
  async function receiveRecipientReadback(continuation) {
    if (continuation.recipient_readback_required !== true) return continuation;
    const eventStart = journal.events.length;
    const [remote,current] = await together([adapters.readIntent(spec),readClaim(spec)]);
    if (!remote.exists || remote.branch !== intent.branch ||
        remote.ref_sha !== continuation.intent_ref_sha ||
        !current || current.record.status !== 'reserved' ||
        current.record.case !== reviewed.opportunity_id || current.record.lease !== lease)
      throw new TypeError('Original acknowledged recipient reservation changed');
    // Re-evaluate the source proof from complete native envelopes. The matching
    // file must come from this read, not an older matching observation.
    const received = recipientContinuation();
    if (received.recipient_readback_required === true || received.lease !== lease ||
        received.recipient_readback_event < eventStart ||
        received.recipient_write_event !== continuation.recipient_write_event ||
        received.recipient_write_sha256 !== continuation.recipient_write_sha256)
      throw new TypeError('Exact original recipient postimage was not received');
    record({phase:'recipient-readback-received',input_sha256:identity,
      operation_lease:lease,intent_branch:intent.branch,recipient_claim_path:path,
      intent_ref_sha:remote.ref_sha,recipient_sha:current.sha,
      recipient_creation_event:received.recipient_creation_event,
      recipient_write_event:received.recipient_write_event,
      recipient_write_sha256:received.recipient_write_sha256,
      recipient_readback_event:received.recipient_readback_event,
      completed_no_send_event:received.completed_no_send_event,
      gmail_invocations:sendInvocationCount()});
    rememberPreparedAccountReservation({intent_ref_sha:remote.ref_sha,lease});
    return received;
  }
  async function receivePreparedRecipientReservation() {
    if (deliveryCorrection || journal.receipt || sendInvocationCount() ||
        journal.prepared_account_reservation?.recipient_pending !== true) return null;
    const ended = completedNoSendBoundary();
    const created = journal.events.some(event =>
      event.phase === 'returned' && event.binding === 'mcp__codex_apps__github_create_file' &&
      event.raw && !event.raw.isError);
    if (!ended || !created) return null;
    const received = await receiveRecipientReadback(recipientContinuation());
    if (received.lease !== lease)
      throw new TypeError('Receive the original completed recipient reservation');
    return {intent_ref_sha:received.intent_ref_sha,lease};
  }
  function consoleHandoff(packet) {
    const data = packet?.data;
    const fail = message => {throw new TypeError(message);};
    if (deliveryCorrection) fail('Use the saved delivery correction preview with its own complete reviewed input');
    if (packet?.schema !== 'commons.connected-contact-handoff/v1' || !data ||
        packet.sha256 !== modules.sha256Utf8(JSON.stringify(data,null,2)+'\n').sha256 ||
        !/^contact-[a-f0-9]{32}$/.test(data.draft_id || '') ||
        !/^op-[a-f0-9]{32}$/.test(data.operation_id || '') ||
        !/^contact-[a-f0-9]{32}$/.test(data.source_draft_id || '') ||
        !/^op-[a-f0-9]{32}$/.test(data.source_operation_id || '') ||
        data.source_draft_id === data.draft_id || typeof data.case_id !== 'string' || !data.case_id ||
        ['review_digest','case_fingerprint','request_sha256','source_request_sha256','source_result_sha256']
          .some(key => !/^[a-f0-9]{64}$/.test(data[key] || '')) ||
        data.state_key !== stateKey || data.state_key !== 'contact-native:'+data.draft_id+':'+data.operation_id ||
        data.lease !== lease || data.intent_branch !== intent.branch || data.intent_key !== intent.key ||
        data.recipient_claim_path !== path || typeof beforeSend !== 'function')
      fail('Complete original console handoff and current native relationship callback required');
    const incoming = data.input;
    if (!incoming || incoming.body_type !== 'text/plain' || incoming.source_links?.length ||
        Object.keys(reviewed).filter(key => !['attachments','document_archives'].includes(key)).some(key => incoming[key] !== reviewed[key]) ||
        rateCanonical(incoming.document_archives ?? null) !== rateCanonical(reviewed.document_archives ?? null) ||
        (incoming.attachments?.length || 0) !== (reviewed.attachments?.length || 0) ||
        (reviewed.attachments || []).some((file,index) => ['item_id','filename','mime_type','bytes','sha256']
          .some(key => incoming.attachments[index]?.[key] !== file[key])))
      fail('Original reviewed console message or attachments changed');
    const reservation = data.reservation;
    if (!originalReference(reservation?.intent_ref_sha) ||
        (reservation.recipient_pending === true
          ? reservation.lease !== undefined || lease !== data.operation_id
          : reservation.recipient_pending !== undefined || reservation.lease !== lease))
      fail('Original console reservation required');
    return data;
  }
  async function resumedConsoleReservation(data) {
    const mutations = [];
    for (const event of journal.events) {
      if (event.phase !== 'invoking' || !/mcp__codex_apps__github_(?:create_file|update_file)$/.test(event.binding || '')) continue;
      const args = event.args, expected = typeof args?.content === 'string' ? JSON.parse(args.content) : null;
      if (args?.repository_full_name !== repository || args.branch !== 'main' || args.path !== path ||
          expected?.protocol !== 'commons-first-contact-v1' || expected.status !== 'reserved' ||
          expected.case !== reviewed.opportunity_id || expected.lease !== lease)
        throw new TypeError('Original recipient mutation requires its own reconciliation');
      mutations.push({event,expected});
    }
    const [remoteIntent,current] = await together([adapters.readIntent(spec),readClaim(spec)]);
    if (!remoteIntent.exists || remoteIntent.ref_sha !== data.reservation.intent_ref_sha ||
        remoteIntent.branch !== intent.branch) throw new TypeError('Original console intent changed');
    if (current) {
      if (current.record.status !== 'reserved' || current.record.case !== reviewed.opportunity_id ||
          current.record.lease !== lease) throw new TypeError('Original console recipient changed; inspect its existing message');
      if (data.reservation.recipient_pending === true &&
          !mutations.some(row => row.event.binding === 'mcp__codex_apps__github_create_file' &&
            row.expected.reserved_at === current.record.reserved_at))
        throw new TypeError('Original console recipient creation is not in this retained native journal');
      record({phase:'console-reservation-readback',recipient_sha:current.sha,intent_ref_sha:remoteIntent.ref_sha});
      return {intent_ref_sha:remoteIntent.ref_sha,lease};
    }
    if (data.reservation.recipient_pending !== true) throw new TypeError('Original console recipient is absent');
    // A previous create may be retried only after a definite native rejection.
    // Unknown calls retain their original journal for provider reconciliation.
    for (const row of mutations) {
      const i = journal.events.indexOf(row.event);
      const tail = journal.events.slice(i+1);
      const next = tail.findIndex(event => event.phase === 'invoking' && event.binding === row.event.binding);
      const response = (next < 0 ? tail : tail.slice(0,next)).find(event =>
        event.phase === 'returned' && event.binding === row.event.binding);
      const status = Number(response?.raw?.structuredContent?.error_data?.status ??
        response?.raw?.structuredContent?.status ?? 0);
      if (!response?.raw?.isError || ![401,403,404,409,422,429].includes(status))
        throw new TypeError('Original recipient creation outcome requires read-only reconciliation');
    }
    return {intent_ref_sha:remoteIntent.ref_sha,recipient_pending:true};
  }

  // The same original journal and recipient record carry a definite returned
  // Gmail rejection into one explicit continuation. No remote call is replayed
  // merely because a timeout elapsed or a caller supplied a retry flag.
  let activeRateContinuation = null;
  const rateCanonical = value => {
    if (Array.isArray(value)) return '[' + value.map(rateCanonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
      .map(key => JSON.stringify(key) + ':' + rateCanonical(value[key])).join(',') + '}';
    return JSON.stringify(value);
  };
  function rateNativeArguments() {
    return nativeDraft ? frozenJson(nativeDraft.sendArguments) : reviewedNativeArguments();
  }
  function reviewedNativeArguments() {
    if (nativeArguments) return frozenJson(nativeArguments);
    return {link_id: sender.link_id, from_address: sender.email,
      to: recipient, subject: reviewed.subject,
      payload: delivery ? modules.attachments.payload(delivery,
        {mime_type:'text/html', charset:'UTF-8', body:{content:html}})
        : {mime_type:'text/html', charset:'UTF-8', body:{content:html}}};
  }
  function rateNativeCalls(binding, end = journal.events.length) {
    const result = []; let pending = null;
    const local = binding === nativeSendBinding ? localGuardInvocation() : null;
    const rejected = binding === nativeSendBinding ? argumentBindingInvocation() : null;
    journal.events.slice(0, end).forEach((event, index) => {
      if (event.binding !== binding || local !== null && (index === local || index === local + 1) ||
          rejected !== null && (index === rejected || event.invocation_event === rejected)) return;
      if (event.phase === 'invoking') {
        if (pending) throw new TypeError('Original native invocation is unresolved');
        pending = {index, event, args:event.args};
      } else if (event.phase === 'returned') {
        if (!pending) throw new TypeError('Original native return has no invocation');
        result.push({...pending, returned_index:index, returned:event, raw:event.raw});
        pending = null;
      } else if (event.phase === 'failed' && pending) {
        result.push({...pending, failed_index:index, failed:event}); pending = null;
      }
      // nativeValue may reject a complete returned error and append failed.
      // That interpretive failure does not discard the provider's prior return.
    });
    if (pending) result.push(pending);
    return result;
  }

  function reviewedRuntime(runtime) {
    const selected = mailboxes.find(item => item.link_id === runtime?.link_id);
    if (!selected) throw new TypeError('Retained reviewed sender is not an original mailbox');
    const target = modules.gateway.recipientClaimPath(runtime.to);
    const prepared = runtime.attachments?.length ? modules.attachments?.prepare(runtime) : null;
    if (runtime.attachments?.length && !prepared)
      throw new TypeError('Retain the original attachment source with its reviewed input');
    const historicalNative = modules.gateway.originalNativeFirstContactArguments
      ? modules.gateway.originalNativeFirstContactArguments(runtime,selected,modules.attachments) : null;
    if (runtime.native_arguments !== undefined && !historicalNative)
      throw new TypeError('Load the native-envelope gateway for this retained input');
    const value = {
      prospect_org:runtime.prospect_org,opportunity_id:runtime.opportunity_id,
      touchpoint:runtime.touchpoint,to:target.recipient,subject:runtime.subject,
      body:runtime.body,link_id:selected.link_id,
      ...(historicalNative ? {body_type:runtime.body_type,native_arguments:frozenJson(historicalNative)} : {}),
      ...(runtime.native_draft ? {native_draft:frozenJson(nativeDraft.metadata(runtime.native_draft))} : {}),
      ...(prepared ? {attachments:prepared.attachments} : {}),
      ...(runtime.document_archives != null ? {document_archives:frozenJson(runtime.document_archives)} : {}),
      ...(runtime.delivery_correction != null ? {body_type:'text/plain',
        delivery_correction:frozenJson(runtime.delivery_correction),
        ...(runtime.source_links?.length ? {source_links:frozenJson(runtime.source_links)} : {})} : {})
    };
    const historicalCorrection = correction?.readDeliveryCorrection(value);
    if (value.document_archives != null) {
      if (typeof correction?.readContactDocumentArchives !== 'function')
        throw new TypeError('Load the original document-archive review contract for this retained input');
      correction.readContactDocumentArchives(value,{required:true});
    }
    if (historicalCorrection && historicalCorrection.mailbox !== selected.email)
      throw new TypeError('Retained delivery correction sender changed');
    if (target.path !== path || modules.intent.fingerprint(value).branch !== intent.branch)
      throw new TypeError('Retained reviewed input belongs to another original contact');
    if (historicalNative) return {reviewed:value,
      identity:modules.sha256Utf8(JSON.stringify(value)).sha256,
      args:runtime.native_draft ? {link_id:selected.link_id,draft_id:runtime.native_draft.draft_id} : historicalNative};
    const body = {mime_type:'text/html',charset:'UTF-8',
      body:{content:modules.gateway.renderFirstContactTextHtml(value.body)}};
    return {reviewed:value,identity:modules.sha256Utf8(JSON.stringify(value)).sha256,
      args:{link_id:selected.link_id,from_address:selected.email,to:target.recipient,
        subject:value.subject,payload:prepared ? modules.attachments.payload(prepared,body) : body}};
  }
  function returnedMailboxRevision() {
    const selected = journal.returned_mailbox_revision;
    if (!selected) return null;
    const fail = () => {throw new TypeError('Retain the complete original returned-rate mailbox revision');};
    const draft = selected.revision_kind === 'draft';
    if (selected.schema !== (draft ? 'commons.returned-rate-input-revision/v1' : 'commons.returned-rate-mailbox-revision/v1') ||
        selected.input_sha256 !== identity || selected.operation_lease !== lease ||
        selected.intent_branch !== intent.branch || selected.recipient_claim_path !== path ||
        selected.sender?.link_id !== sender.link_id || selected.sender.id !== sender.id ||
        selected.sender.email !== sender.email ||
        !/^[a-f0-9]{64}$/.test(selected.selection_id || '') ||
        !Number.isSafeInteger(selected.selected_event) || selected.selected_event < 0 ||
        !Array.isArray(selected.closed_calls) || !selected.closed_calls.length)
      fail();
    const event = journal.events[selected.selected_event];
    if (event?.phase !== (draft ? 'returned-rate-input-selected' : 'returned-rate-mailbox-selected') ||
        rateCanonical(event.selection) !== rateCanonical(selected)) fail();
    if (selected.retry_id !== modules.sha256Utf8(
        'commons.gmail-mailbox-continuation/v1\0'+selected.selection_id).sha256) fail();
    const original = journal.input_revisions?.findLast(row =>
      row.input_sha256 === selected.previous_input_sha256 &&
      row.returned_mailbox_selection_id === selected.selection_id);
    if (!original?.runtime_input) fail();
    const old = reviewedRuntime(original.runtime_input);
    if (old.identity !== selected.previous_input_sha256 ||
        rateCanonical(old.reviewed) !== rateCanonical(original.input) ||
        (!draft && rateCanonical({...old.reviewed,link_id:sender.link_id}) !== rateCanonical(reviewed)))
      fail();
    if (draft) {
      const mutable=new Set(['subject','body','body_type','native_arguments','attachments','document_archives']);
      const retained=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!mutable.has(key)));
      if (nativeDraft || old.reviewed.native_draft ||
          typeof selected.reason !== 'string' || !selected.reason.trim() || selected.reason.length>2000 ||
          rateCanonical(retained(old.reviewed)) !== rateCanonical(retained(reviewed)) ||
          selected.previous_sender?.link_id !== sender.link_id ||
          selected.previous_sender.id !== sender.id || selected.previous_sender.email !== sender.email)
        fail();
    }
    const sources = new Map();
    for (const row of journal.input_revisions || []) {
      if (!row.runtime_input) continue;
      const source = reviewedRuntime(row.runtime_input);
      if (source.identity !== row.input_sha256 ||
          rateCanonical(source.reviewed) !== rateCanonical(row.input)) fail();
      const previous = sources.get(source.identity);
      if (previous && rateCanonical(previous) !== rateCanonical(source)) fail();
      sources.set(source.identity,source);
    }
    const calls = rateNativeCalls(nativeSendBinding,selected.selected_event);
    if (calls.length !== selected.closed_calls.length) fail();
    for (let i=0;i<calls.length;i++) {
      const call=calls[i],closed=selected.closed_calls[i],source=sources.get(closed.input_sha256);
      const classified=classifyReturnedSendRateLimit(call.raw,call.returned?.observed_at);
      const invokedAt=Date.parse(call.event.observed_at),returnedAt=Date.parse(call.returned?.observed_at);
      if (!source || !classified || !draft && classified.quota_scope === 'connector_tool' &&
          Date.parse(classified.retry_after) > Date.parse(selected.observed_at) ||
          call.index !== closed.invocation_event ||
          call.returned_index !== closed.returned_event ||
          !Number.isFinite(invokedAt) || !Number.isFinite(returnedAt) ||
          returnedAt < invokedAt || Date.parse(classified.retry_after) < returnedAt ||
          rateCanonical(call.args) !== rateCanonical(source.args))
        fail();
      const proof={schema:'commons.gmail-returned-rate-rejection/v1',
        input_sha256:source.identity,lease,args:call.args,raw:call.raw,
        invoked_at:call.event.observed_at,returned_at:call.returned.observed_at};
      const proofHashes=[modules.sha256Utf8(rateCanonical(proof)).sha256];
      if (classified.provider_service==='connector') {
        const argsSha=modules.sha256Utf8(rateCanonical(call.args)).sha256;
        const boundProof={...proof,binding:nativeSendBinding,
          call_id:call.event.call_id,invocation_event:call.index,args_sha256:argsSha};
        proofHashes.push(modules.sha256Utf8(rateCanonical(boundProof)).sha256);
      }
      if (!proofHashes.includes(closed.proof_sha256) ||
          closed.retry_after !== classified.retry_after) fail();
    }
    const last=selected.closed_calls.at(-1);
    if (last.proof_sha256 !== selected.previous_rate_plan?.proof_sha256 ||
        selected.previous_rate_plan.input_sha256 !== selected.previous_input_sha256 ||
        selected.previous_rate_plan.intent_ref_sha !== selected.intent_ref_sha ||
        selected.previous_rate_plan.lease !== lease) fail();
    if (selected.marker?.schema !== 'commons.gmail-rate-attempt/v1' ||
        selected.marker.state !== (draft ? 'input-selected' : 'mailbox-selected') ||
        selected.marker.mailbox_selection_id !== selected.selection_id ||
        selected.marker.retry_id !== selected.retry_id ||
        selected.marker.proof_sha256 !== last.proof_sha256 ||
        selected.marker.input_sha256 !== identity ||
        selected.marker.sender_link_id !== sender.link_id) fail();
    return selected;
  }
  function selectedMailboxRatePlan(selected) {
    const draft=selected.revision_kind==='draft';
    const retryAfter=draft && selected.previous_rate_plan.retry_after>selected.observed_at
      ? selected.previous_rate_plan.retry_after : selected.observed_at;
    return {schema:'commons.gmail-rate-continuation/v1',
      input_sha256:identity,case_id:reviewed.opportunity_id,
      intent_branch:intent.branch,intent_ref_sha:selected.intent_ref_sha,
      recipient_claim_path:path,lease,
      intent_readback_event:selected.intent_readback_event,
      recipient_readback_event:selected.recipient_readback_event,
      rejected_invocations:0,rejected:[],
      historical_rejected_invocations:selected.closed_calls.length,
      proof_sha256:selected.previous_rate_plan.proof_sha256,
      previous_retry_id:selected.previous_rate_plan.previous_retry_id,
      retry_id:selected.retry_id,retry_after:retryAfter,provider_eligible:Date.now()>=Date.parse(retryAfter),
      retry_basis:draft?'EXPLICIT_REVIEWED_INPUT_ORIGINAL_ACCOUNT':'EXPLICIT_SELECTED_ACCOUNT_ADMISSION',
      previous_provider_retry_after:selected.previous_rate_plan.retry_after,
      mailbox_selection_id:selected.selection_id};
  }

  // Exact retained local returns supply the same pre-send provenance as the
  // original Git readbacks. This is pure journal inspection, never a state read.
  function localRateIdentities() {
    const identities=new Set([identity]);
    if (journal.returned_mailbox_revision) {
      // The original validator checks every retained input and closed call.
      returnedMailboxRevision();
      for (const row of journal.input_revisions || []) identities.add(row.input_sha256);
    }
    return identities;
  }
  function localRateReadbacks(end) {
    const result=[],identities=localRateIdentities();
    for (const action of ['read','receive','compareAndSwap']) {
      const binding='commons.local-state.'+action;
      for (const call of rateNativeCalls(binding,end)) {
        const args=call.args;
        if (!['intent','recipient'].includes(args?.namespace) ||
            args.key!==(args.namespace==='intent'?intent.branch:path) ||
            !call.returned || call.raw===null) continue;
        const row=call.raw,r=row?.receipt,measured=typeof row?.content==='string'
          ? modules.sha256Utf8(row.content) : null;
        const expectedCalls=[...identities].map(input_sha256=>modules.sha256Utf8(rateCanonical({
          operation_key:modules.sha256Utf8(JSON.stringify({input_sha256,lease})).sha256,binding,args})).sha256);
        if (!expectedCalls.includes(call.event.call_id) || call.returned.call_id!==call.event.call_id ||
            row?.kind!=='commons.connected-contact-local-snapshot/v1' ||
            typeof row.coordinator_id!=='string' || !row.coordinator_id ||
            storage && row.coordinator_id!==storage.coordinatorId ||
            row.namespace!==args.namespace || row.key!==args.key ||
            !Number.isSafeInteger(row.revision) || row.revision<1 ||
            !measured || measured.sha256!==row.sha256 ||
            r?.schema!=='commons.connected-contact-local-receipt/v1' ||
            r.coordinator_id!==row.coordinator_id || r.namespace!==row.namespace ||
            r.key!==row.key || r.revision!==row.revision || r.sha256!==row.sha256 ||
            r.bytes!==measured.bytes ||
            !['receive','compareAndSwap'].includes(r.action) ||
            typeof r.operation_id!=='string' || !r.operation_id ||
            !Number.isFinite(Date.parse(call.event.observed_at)) ||
            !Number.isFinite(Date.parse(call.returned.observed_at)) ||
            Date.parse(call.returned.observed_at)<Date.parse(call.event.observed_at))
          throw new TypeError('Original local pre-send readback and receipt changed');
        if (action!=='read' && (row.content!==args.content ||
            r.operation_id!==args.operation_id || r.action!==action ||
            r.previous_sha256!==(action==='receive'?null:args.expected_sha256)))
          throw new TypeError('Original local pre-send mutation return changed');
        let value;try {value=JSON.parse(row.content);} catch {
          throw new TypeError('Complete original local pre-send state required');
        }
        if (!value || typeof value!=='object' || Array.isArray(value))
          throw new TypeError('Complete original local pre-send state required');
        result.push({call,row,value,coordinator_id:row.coordinator_id});
      }
    }
    return result.sort((a,b)=>a.call.returned_index-b.call.returned_index);
  }
  function rateLimitContinuation() {
    if (!Array.isArray(journal.events) || journal.input_sha256 !== identity ||
        journal.lease !== lease || rateCanonical(journal.input) !== rateCanonical(reviewed))
      throw new TypeError('Complete unchanged original contact journal required');
    if (journal.receipt || journal.native_receipt || journal.outcome?.status === 'SENT_VERIFIED')
      throw new TypeError('Original message receipt exists; use its reconciliation');
    const selectedRevision=returnedMailboxRevision();
    const calls = rateNativeCalls(nativeSendBinding)
      .filter(call => !selectedRevision || call.index > selectedRevision.selected_event);
    if (!calls.length && selectedRevision) return selectedMailboxRatePlan(selectedRevision);
    const received = receivedRateHistory();
    if (!calls.length && received) return received.plan;
    if (!calls.length) throw new TypeError('Original returned Gmail rejection required');
    const expected = rateCanonical(rateNativeArguments());
    const rejected = [...(received?.rejected || []), ...calls.map(call => {
      const classified = classifyReturnedSendRateLimit(call.raw,call.returned?.observed_at);
      const invokedAt = Date.parse(call.event.observed_at);
      const returnedAt = Date.parse(call.returned?.observed_at);
      if (!classified || !Number.isFinite(invokedAt) || !Number.isFinite(returnedAt) ||
          returnedAt < invokedAt || Date.parse(classified.retry_after) < returnedAt ||
          rateCanonical(call.args) !== expected)
        throw new TypeError('Original send is unresolved, changed or not a definite returned Gmail rate rejection');
      const connector = classified.provider_service === 'connector';
      const argsSha = connector ? modules.sha256Utf8(rateCanonical(call.args)).sha256 : null;
      if (connector && (call.event.invocation_event !== call.index ||
          call.returned.invocation_event !== call.index ||
          call.event.account_operation_key !== accountOperationKey ||
          call.event.call_id !== modules.sha256Utf8(rateCanonical({operation_key:accountOperationKey,
            binding:nativeSendBinding,invocation_event:call.index,args_sha256:argsSha})).sha256 ||
          call.returned.call_id !== call.event.call_id ||
          call.event.args_sha256 !== argsSha || call.returned.args_sha256 !== argsSha ||
          call.event.link_id !== sender.link_id || call.returned.link_id !== sender.link_id))
        throw new TypeError('Complete original connector invocation and returned-call identity required');
      const proof = {schema:'commons.gmail-returned-rate-rejection/v1',
        input_sha256:identity, lease, args:call.args, raw:call.raw,
        invoked_at:call.event.observed_at, returned_at:call.returned.observed_at,
        ...(connector ? {binding:nativeSendBinding,
          call_id:call.event.call_id,invocation_event:call.index,args_sha256:argsSha} : {})};
      return {...classified,
        ...(connector ? {call_id:call.event.call_id,args_sha256:argsSha,
          source_account:{id:sender.id,email:sender.email,link_id:sender.link_id},
          return_sha256:modules.sha256Utf8(JSON.stringify(call.raw)).sha256} : {}),
        invocation_event:call.index, returned_event:call.returned_index,
        invocation_retry_id:call.event.rate_retry_id || null,
        proof_sha256:modules.sha256Utf8(rateCanonical(proof)).sha256};
    })];
    const firstIndex = calls[0].index;
    const refs = refBindings.flatMap(binding => rateNativeCalls(binding,firstIndex)
      .map(call => ({...call,binding}))).sort((left,right) => left.index - right.index).flatMap(call => {
      if (!call.returned) return [];
      let sha;
      try {sha = retainedRef(call,intent.branch);} catch {return [];}
      return sha ? [{sha,event:call.returned_index}] : [];
    });
    const claims = rateNativeCalls('mcp__codex_apps__github_fetch_file', firstIndex).flatMap(call => {
      if (call.args?.repository_full_name !== repository || call.args.path !== path ||
          call.args.ref !== 'main' || !call.returned || call.raw?.isError) return [];
      const file = call.raw.structuredContent; let value;
      try { value = JSON.parse(file?.content); } catch { return []; }
      return /^[a-f0-9]{40}$/.test(file.sha || '') && value.protocol === 'commons-first-contact-v1' &&
        value.status === 'reserved' && value.case === reviewed.opportunity_id && value.lease === lease &&
        (!correction || correction.matchesDeliveryCorrectionClaim(spec,value,lease))
        ? [{sha:file.sha, event:call.returned_index}] : [];
    });
    const local=localRateReadbacks(firstIndex),localInputs=localRateIdentities();
    const coordinators=new Set(local.map(item=>item.coordinator_id));
    if (coordinators.size>1)
      throw new TypeError('Original local pre-send states belong to different coordinators');
    for (const item of local) {
      const {value,row,call}=item;
      if (row.namespace==='intent') {
        if (value.schema!=='commons.local-contact-intent/v1' || value.branch!==intent.branch)
          throw new TypeError('Original local pre-send intent changed');
        const imported=/^[a-f0-9]{40}$/.test(value.reference||'');
        if (imported) {
          if (value.original_reference?.repository!==repository ||
              value.original_reference.branch!==intent.branch ||
              value.original_reference.ref_sha!==value.reference ||
              row.receipt.origin?.kind!=='git-original-ref-readback' ||
              row.receipt.origin.repository!==repository ||
              row.receipt.origin.branch!==intent.branch ||
              row.receipt.origin.ref_sha!==value.reference)
            throw new TypeError('Original received Git intent identity changed');
        } else if (value.reference!=='local:'+modules.sha256Utf8(rateCanonical({
            coordinator_id:row.coordinator_id,intent_key:intent.key})).sha256 ||
            value.operation_lease!==lease || !localInputs.has(value.input_sha256))
          throw new TypeError('Original local intent reservation changed');
        refs.push({sha:value.reference,event:call.returned_index});
      } else if (value.protocol==='commons-first-contact-v1' && value.status==='reserved' &&
          value.case===reviewed.opportunity_id && value.lease===lease &&
          (!correction || correction.matchesDeliveryCorrectionClaim(spec,value,lease))) {
        const origin=row.receipt.origin;
        const sha=origin?.kind==='git-original-readback' &&
          /^[a-f0-9]{40}$/.test(origin.blob_sha||'') && origin.sha256===row.sha256
          ? origin.blob_sha : 'local:'+row.sha256;
        claims.push({sha,event:call.returned_index});
      }
    }
    refs.sort((a,b)=>a.event-b.event);claims.sort((a,b)=>a.event-b.event);
    if (!refs.length || !claims.length || refs.some(value => value.sha !== refs[0].sha))
      throw new TypeError('Original pre-send intent and same-case recipient lease readback required');
    const last = rejected[rejected.length - 1];
    const providerRetryAfter = rejected.reduce((value, item) =>
      item.retry_after > value ? item.retry_after : value, rejected[0].retry_after);
    return {schema:'commons.gmail-rate-continuation/v1', input_sha256:identity,
      case_id:reviewed.opportunity_id, intent_branch:intent.branch,
      intent_ref_sha:refs[refs.length - 1].sha, recipient_claim_path:path, lease,
      intent_readback_event:refs[refs.length - 1].event,
      recipient_readback_event:claims[claims.length - 1].event,
      rejected_invocations:rejected.length, rejected,
      proof_sha256:last.proof_sha256, previous_retry_id:last.invocation_retry_id,
      retry_id:modules.sha256Utf8('commons.gmail-rate-continuation/v1\0' + last.proof_sha256).sha256,
      retry_after:providerRetryAfter,
      provider_eligible:Date.now() >= Date.parse(providerRetryAfter)};
  }
  function originalConnectorDeadline(plan) {
    return plan.rejected.filter(row => row.provider_service === 'connector' &&
      row.scope?.kind === 'connector_tool').reduce((latest,row) =>
        !latest || row.retry_after > latest.retry_after ? row : latest,null);
  }
  function connectorDeadlineReceived(rejection) {
    if (!rejection) return true;
    const source = rejection.invocation_event === null
      ? JSON.parse(journal.recovered_rate_history.body.account_source.content).deadline_source
      : null;
    const returnedAt = rejection.returned_at || source?.observed_at;
    const returnSha = rejection.return_sha256 || source?.return_sha256;
    return journal.events.some(event => event.phase === 'connector-limit-received' &&
      event.operation_key === accountOperationKey &&
      event.returned_at === returnedAt && event.return_sha256 === returnSha &&
      event.scope?.binding === nativeSendBinding &&
      event.scope.kind === 'connector_tool' &&
      event.scope.tool === (nativeDraft ? 'send_draft' : 'send_email') &&
      Date.parse(event.retry_after) >= Date.parse(rejection.retry_after) &&
      event.source_account?.id === sender.id && event.source_account.email === sender.email &&
      event.source_account.link_id === sender.link_id &&
      Array.isArray(event.observations) && event.observations.length === 1 &&
      event.observations.some(value => value.profile_id === sender.id &&
        ['PROVIDER_DEADLINE_RECORDED','PROVIDER_DEADLINE_RETAINED'].includes(value.status) &&
        Date.parse(value.retry_after) >= Date.parse(rejection.retry_after)));
  }
  async function receiveRetainedConnectorDeadline(plan) {
    const rejection = originalConnectorDeadline(plan);
    if (!rejection || connectorDeadlineReceived(rejection)) return null;
    if (rejection.invocation_event === null) {
      const received = receivedRateHistory();
      if (!received || received.history_sha256 !== rejection.checkpoint_history_sha256)
        throw new TypeError('Retain the complete original returned-limit history');
      const proof = JSON.parse(journal.recovered_rate_history.body.account_source.content).deadline_source;
      return receiveOriginalAccountReturn(rateNativeArguments(),proof.raw,proof.observed_at);
    }
    const call = rateNativeCalls(nativeSendBinding)
      .find(value => value.index === rejection.invocation_event);
    if (!call || call.returned_index !== rejection.returned_event)
      throw new TypeError('Retain the original connector return selected by this continuation');
    return receiveOriginalAccountReturn(call.args,call.raw,call.returned.observed_at);
  }
  function connectorRateOutcome(outcome) {
    if (outcome?.status !== 'SEND_OUTCOME_UNKNOWN') return outcome;
    let plan;
    try { plan = rateLimitContinuation(); } catch { return outcome; }
    const rejection = plan.rejected.at(-1);
    if (rejection?.provider_service !== 'connector') return outcome;
    return {...outcome,status:'RATE_LIMIT_WAIT',gateway_status:outcome.status,
      reason:'CONNECTOR_TOOL_RATE_LIMIT',retry_after:plan.retry_after,
      provider_eligible:plan.provider_eligible,scope:rejection.scope,limit:rejection.limit,
      source_account:{id:sender.id,email:sender.email,link_id:sender.link_id},
      admission_receiving_required:!connectorDeadlineReceived(originalConnectorDeadline(plan)),
      proof_sha256:plan.proof_sha256,
      action:'Continue this original returned-rate rejection after its retained provider interval'};
  }

  async function consumeRateInvocation(args) {
    const previous = sendInvocationCount();
    if (!previous) return {};
    const active = activeRateContinuation;
    if (!active || active.used || active.dispatching || !active.claimed ||
        rateCanonical(args) !== rateCanonical(rateNativeArguments()))
      throw new TypeError('Original provider invocation retained; use its explicit saved continuation');
    active.dispatching = true;
    const current = rateLimitContinuation();
    if (current.proof_sha256 !== active.plan.proof_sha256 || !current.provider_eligible)
      throw new TypeError('Original returned rejection or provider interval changed');
    const before = await readClaim(spec);
    const marker = before?.record.gmail_rate_retry;
    if (before?.record.case !== reviewed.opportunity_id || before.record.lease !== lease ||
        before.record.status !== 'reserved' || marker?.state !== 'claimed' ||
        marker.retry_id !== active.plan.retry_id || marker.proof_sha256 !== active.plan.proof_sha256 ||
        marker.claim_nonce !== active.claim_nonce)
      throw new TypeError('Original retry claim changed before dispatch');
    const dispatchNonce = modules.sha256Utf8(rateCanonical({claim_nonce:active.claim_nonce,
      observed_at:new Date().toISOString(), journal_events:journal.events.length, nonce:Math.random()})).sha256;
    const dispatch = {...marker, state:'dispatching', dispatch_nonce:dispatchNonce,
      dispatch_claimed_at:new Date().toISOString()};
    // Account admission must already have granted this original sender before
    // this final CAS. Only one current recipient nonce can cross this boundary.
    let mutationError;
    try { await writeClaim(spec, {...before.record, gmail_rate_retry:dispatch}, before.sha); }
    catch (error) { mutationError = error; }
    const after = await readClaim(spec);
    const observed = after?.record.gmail_rate_retry;
    if (after?.record.case !== reviewed.opportunity_id || after.record.lease !== lease ||
        after.record.status !== 'reserved' || observed?.state !== 'dispatching' ||
        observed.claim_nonce !== active.claim_nonce || observed.dispatch_nonce !== dispatchNonce ||
        observed.retry_id !== active.plan.retry_id || observed.proof_sha256 !== active.plan.proof_sha256)
      throw mutationError || new TypeError('Original retry dispatch CAS is not owned by this invocation');
    active.used = true;
    active.dispatch_nonce = dispatchNonce;
    record({phase:'rate-dispatch-owned', retry_id:active.plan.retry_id,
      claim_nonce:active.claim_nonce, dispatch_nonce:dispatchNonce,
      proof_sha256:active.plan.proof_sha256, recipient_sha:after.sha,
      mutation_reconciled:Boolean(mutationError)});
    return {rate_retry_id:active.plan.retry_id, rate_retry_claim:active.claim_nonce,
      rate_dispatch_nonce:dispatchNonce, rate_rejection_sha256:active.plan.proof_sha256};
  }
  async function fullRateCensus() {
    await verifyMailboxes();
    return Object.fromEntries(await together(mailboxes.map(async mailbox => [
      mailbox.name, {checked:true,complete:true,mailbox:mailbox.email,
        sent_ids:await messageIds(mailbox, 'in:sent to:' + recipient, true)}
    ])));
  }
  async function reconcileRateCensus(census, plan) {
    const currentIds = mailbox => {
      const allowed = deliveryCorrection
        ? correction.reviewedDeliveryMessageIds(deliveryCorrection,mailbox.email,'sent') : [];
      return census[mailbox.name].sent_ids.filter(id => !allowed.includes(id));
    };
    if (!mailboxes.some(mailbox => currentIds(mailbox).length)) return null;
    const matching = [];
    for (const id of currentIds(sender)) {
      try { await readMatchingSent(id); matching.push(id); }
      catch (error) {
        // Every existing SENT prevents another first contact. A provider/read
        // failure remains an error; a full envelope mismatch is reported below.
        if (!(error instanceof TypeError)) throw error;
      }
    }
    if (matching.length !== 1) return retainOutcome({status:'NOT_SENT',
      reason:matching.length > 1 ? 'MULTIPLE_MATCHING_SENT' : 'EXISTING_SENT',
      matching_message_ids:matching, census, intent_branch:intent.branch,
      recipient_claim_path:path});
    const [remote, before] = await together([adapters.readIntent(spec), readClaim(spec)]);
    if (!remote.exists || remote.branch !== intent.branch || remote.ref_sha !== plan.intent_ref_sha ||
        before?.record.case !== reviewed.opportunity_id || before.record.lease !== lease ||
        !['reserved','sent'].includes(before.record.status))
      throw new TypeError('Original reservation changed during SENT reconciliation');
    const messageId = matching[0];
    if (before.record.status === 'sent' && before.record.provider_message_id !== messageId)
      throw new TypeError('Original recorded message differs from recovered SENT');
    const completion = before.record.status === 'sent' ? 'RECORDED'
      : (await adapters.completeRecipient(spec, lease, messageId)).status === 'SENT_RECORDED' ? 'RECORDED' : 'RECONCILE';
    return retainOutcome({status:'SENT_VERIFIED', message_id:messageId,
      intent_branch:intent.branch, recipient_claim_path:path, completion,
      recovered_from_rate_reconciliation:true});
  }
  function retainedRateClaim(marker, expectedState = 'claimed') {
    if (marker?.schema !== 'commons.gmail-rate-attempt/v1' || marker.state !== expectedState ||
        !/^[a-f0-9]{64}$/.test(marker.claim_nonce || '')) return null;
    for (let index = journal.events.length - 1; index >= 0; index--) {
      const event = journal.events[index];
      if (event.phase !== 'invoking') continue;
      const args=event.args,local=event.binding==='commons.local-state.compareAndSwap';
      if (local) {
        if (!storage || args?.namespace!=='recipient' || args.key!==path ||
            !/^[a-f0-9]{64}$/.test(args.expected_sha256||'') || typeof args.content!=='string')
          continue;
        const operation='recipient:'+modules.sha256Utf8(rateCanonical({
          path,expected:args.expected_sha256,content:args.content})).sha256;
        const callIds=[...localRateIdentities()].map(input_sha256=>modules.sha256Utf8(rateCanonical({
          operation_key:modules.sha256Utf8(JSON.stringify({input_sha256,lease})).sha256,binding:event.binding,args})).sha256);
        if (args.operation_id!==operation || !callIds.includes(event.call_id))
          throw new TypeError('Original local retry claim invocation changed');
      } else if (event.binding!=='mcp__codex_apps__github_update_file' ||
          args?.repository_full_name!==repository || args.branch!=='main' ||
          args.path!==path || !/^[a-f0-9]{40}$/.test(args.sha||'') ||
          typeof args.content!=='string') continue;
      let proposed;
      try { proposed = JSON.parse(event.args.content); } catch { continue; }
      if (proposed.protocol === 'commons-first-contact-v1' && proposed.status === 'reserved' &&
          proposed.case === reviewed.opportunity_id && proposed.lease === lease &&
          rateCanonical(proposed.gmail_rate_retry) === rateCanonical(marker))
        return {invocation_event:index, expected_recipient_sha:local?'local:'+args.expected_sha256:args.sha,
          proposed_sha256:modules.sha256Utf8(args.content).sha256,
          ...(local?{storage_kind:storage.kind,coordinator_id:storage.coordinatorId,
            operation_id:args.operation_id,call_id:event.call_id}:{})};
    }
    return null;
  }
  function retainedLegacyReleasedRateClaim(marker, plan, recipientSha) {
    // Keep the same validated original returned call and current recipient CAS.
    // A released remote claim remains authoritative after a runtime loses its
    // last local checkpoint; preserved local write evidence adds provenance.
    if (marker?.schema !== 'commons.gmail-rate-attempt/v1' || marker.state !== 'released' ||
        !/^[a-f0-9]{64}$/.test(marker.claim_nonce || '') ||
        !originalReference(recipientSha)) return null;
    const current = rateLimitContinuation();
    if (current.proof_sha256 !== plan.proof_sha256 || current.retry_id !== plan.retry_id)
      return null;
    const last = current.rejected.at(-1);
    if (last?.provider_service !== 'connector' || !Number.isInteger(last.invocation_event))
      return null;
    const call = rateNativeCalls(nativeSendBinding).find(value => value.index === last.invocation_event);
    if (!call || call.returned_index !== last.returned_event) return null;
    const proof = {schema:'commons.gmail-returned-rate-rejection/v1',
      input_sha256:identity, lease, args:call.args, raw:call.raw,
      invoked_at:call.event.observed_at, returned_at:call.returned.observed_at};
    const legacyProof = modules.sha256Utf8(rateCanonical(proof)).sha256;
    const legacyRetry = modules.sha256Utf8('commons.gmail-rate-continuation/v1\0' + legacyProof).sha256;
    if (legacyProof === current.proof_sha256 || marker.proof_sha256 !== legacyProof ||
        marker.retry_id !== legacyRetry || marker.provider_retry_after !== plan.retry_after) return null;
    const continuationIndex = journal.events.findLastIndex(event =>
      event.phase === 'rate-continuation' &&
      event.continuation?.input_sha256 === identity && event.continuation.lease === lease &&
      event.continuation.case_id === reviewed.opportunity_id &&
      event.continuation.intent_branch === plan.intent_branch &&
      event.continuation.intent_ref_sha === plan.intent_ref_sha &&
      event.continuation.recipient_claim_path === path &&
      event.continuation.retry_id === marker.retry_id &&
      event.continuation.proof_sha256 === marker.proof_sha256 &&
      event.continuation.retry_after === plan.retry_after &&
      event.continuation.rejected?.at(-1)?.invocation_event === last.invocation_event &&
      event.continuation.rejected.at(-1).returned_event === last.returned_event &&
      event.continuation.rejected.at(-1).proof_sha256 === marker.proof_sha256);
    if (continuationIndex <= last.returned_event ||
        journal.events.some(event => event.phase === 'invoking' &&
          event.binding === nativeSendBinding && event.rate_retry_claim === marker.claim_nonce)) return null;
    const retained = retainedRateClaim(marker, 'released');
    return {kind:'legacy-released-proof',retained,
      source:'CURRENT_RELEASED_RECIPIENT_READBACK',recipient_sha:recipientSha,
      original_marker:frozenJson(marker),continuation_event:continuationIndex,
      previous_claim_nonce:marker.claim_nonce,legacy_proof_sha256:legacyProof,
      legacy_retry_id:legacyRetry,invocation_event:call.index,
      returned_event:call.returned_index,call_id:call.event.call_id};
  }
  async function claimRateAttempt(active, target, originalLease) {
    const original = await readClaim(target);
    if (originalLease !== lease || original?.record.case !== reviewed.opportunity_id ||
        original.record.lease !== lease || original.record.status !== 'reserved')
      return {status:'NOT_RENEWED'};
    const eligibility = (value, recipientSha) => {
      if (!value) return {kind:'initial'};
      if (active.plan.mailbox_selection_id) {
        const selected=returnedMailboxRevision();
        if (selected?.selection_id === active.plan.mailbox_selection_id &&
            rateCanonical(value) === rateCanonical(selected.marker))
          return {kind:'selected-mailbox'};
      }
      if (value.retry_id === active.plan.retry_id && value.proof_sha256 === active.plan.proof_sha256 &&
          value.state === 'released') return {kind:'released'};
      const legacyReleased = retainedLegacyReleasedRateClaim(value, active.plan, recipientSha);
      if (legacyReleased) return legacyReleased;
      if (value.retry_id === active.plan.previous_retry_id && value.proof_sha256 !== active.plan.proof_sha256)
        return {kind:'next-return'};
      if (value.retry_id === active.plan.retry_id && value.proof_sha256 === active.plan.proof_sha256 &&
          value.state === 'claimed') {
        const retained = retainedRateClaim(value);
        if (retained) return {kind:'claim-recovery', retained, previous_claim_nonce:value.claim_nonce};
      }
      if (value.retry_id === active.plan.retry_id && value.proof_sha256 === active.plan.proof_sha256 &&
          value.state === 'dispatching') {
        const cancellation = journal.events.findIndex(event =>
          event.phase === 'rate-dispatch-cancel-selected' && event.retry_id === value.retry_id &&
          event.proof_sha256 === value.proof_sha256 && event.claim_nonce === value.claim_nonce &&
          event.dispatch_nonce === value.dispatch_nonce);
        const invoked = journal.events.some(event => event.phase === 'invoking' &&
          event.binding === nativeSendBinding && event.rate_retry_claim === value.claim_nonce);
        const retained = cancellation >= 0 && !invoked && retainedRateClaim(value,'dispatching');
        if (retained) return {kind:'dispatch-cancellation-recovery', retained,
          cancellation_event:cancellation, previous_claim_nonce:value.claim_nonce};
      }
      return null;
    };
    const prior = original.record.gmail_rate_retry;
    if (!eligibility(prior, original.sha)) return {status:'ALREADY_CLAIMED',
      retry_id:prior?.retry_id, claim_nonce:prior?.claim_nonce, state:prior?.state};
    const renewed = await adapters.renewRecipient(target, originalLease);
    if (renewed?.status !== 'RENEWED') return renewed;
    const before = await readClaim(target);
    const accepted = eligibility(before?.record.gmail_rate_retry, before?.sha);
    if (before?.record.case !== reviewed.opportunity_id || before.record.lease !== lease ||
        before.record.status !== 'reserved' || !accepted) return {status:'NOT_RENEWED'};
    const marker = {schema:'commons.gmail-rate-attempt/v1', retry_id:active.plan.retry_id,
      claim_nonce:active.claim_nonce, proof_sha256:active.plan.proof_sha256,
      provider_retry_after:active.plan.retry_after, state:'claimed', claimed_at:new Date().toISOString()};
    // Recovery rotates the proven original claim through this same target CAS.
    // A live former owner must win its own claimed->dispatching CAS and is
    // fenced by the changed nonce. No timeout is used as death evidence.
    let mutationError;
    try { await writeClaim(target, {...before.record, gmail_rate_retry:marker}, before.sha); }
    catch (error) { mutationError = error; }
    const after = await readClaim(target);
    if (after?.record.case !== reviewed.opportunity_id || after.record.lease !== lease ||
        after.record.status !== 'reserved' || after.record.gmail_rate_retry?.state !== 'claimed' ||
        after.record.gmail_rate_retry?.claim_nonce !== active.claim_nonce ||
        after.record.gmail_rate_retry?.proof_sha256 !== active.plan.proof_sha256)
      throw mutationError || new TypeError('Original retry claim CAS is not owned by this continuation');
    active.claimed = true;
    record({phase:accepted.kind === 'claim-recovery' ? 'rate-attempt-claim-recovered' :
      accepted.kind === 'dispatch-cancellation-recovery' ? 'rate-attempt-cancellation-recovered' :
      accepted.kind === 'legacy-released-proof' ? 'rate-attempt-proof-upgraded' : 'rate-attempt-claimed',
      retry_id:active.plan.retry_id, claim_nonce:active.claim_nonce,
      proof_sha256:active.plan.proof_sha256, recipient_sha:after.sha,
      ...(['claim-recovery','dispatch-cancellation-recovery'].includes(accepted.kind)
        ? {original_claim:accepted.retained, previous_claim_nonce:accepted.previous_claim_nonce,
          ...(accepted.cancellation_event !== undefined ? {cancellation_event:accepted.cancellation_event} : {})} : {}),
      ...(accepted.kind === 'legacy-released-proof' ? {legacy_proof_upgrade:accepted} : {}),
      mutation_reconciled:Boolean(mutationError)});
    return {status:'RENEWED'};
  }
  async function releaseUnusedRateAttempt(active) {
    if (!active.claimed || journal.events.some(event => event.phase === 'invoking' &&
        event.binding === nativeSendBinding && event.rate_retry_claim === active.claim_nonce)) return;
    if (active.dispatch_nonce) {
      // This finally branch runs only after this local gateway call has ended.
      // Retain its decision before the cancellation read/CAS, so a lost native
      // acknowledgement can reopen the same proved unused dispatch marker.
      record({phase:'rate-dispatch-cancel-selected', retry_id:active.plan.retry_id,
        claim_nonce:active.claim_nonce, dispatch_nonce:active.dispatch_nonce,
        proof_sha256:active.plan.proof_sha256});
    }
    const before = await readClaim(spec);
    if (before?.record.case !== reviewed.opportunity_id || before.record.lease !== lease ||
        before.record.status !== 'reserved' ||
        before.record.gmail_rate_retry?.claim_nonce !== active.claim_nonce ||
        before.record.gmail_rate_retry?.retry_id !== active.plan.retry_id ||
        before.record.gmail_rate_retry?.proof_sha256 !== active.plan.proof_sha256) return;
    const current = before.record.gmail_rate_retry;
    // The completed local call can return from a final account check after
    // winning dispatch CAS but before invoking Gmail. Release only that exact
    // read-back dispatch nonce; another caller cannot adopt dispatching state.
    const ownUninvokedDispatch = current.state === 'dispatching' &&
      typeof active.dispatch_nonce === 'string' && current.dispatch_nonce === active.dispatch_nonce;
    if (current.state !== 'claimed' && !ownUninvokedDispatch) return;
    const marker = {...before.record.gmail_rate_retry, state:'released', released_at:new Date().toISOString()};
    await writeClaim(spec, {...before.record, gmail_rate_retry:marker}, before.sha);
    const after = await readClaim(spec);
    record({phase:'rate-attempt-release', retry_id:active.plan.retry_id, claim_nonce:active.claim_nonce,
      released:after?.record.gmail_rate_retry?.claim_nonce === active.claim_nonce &&
        after.record.gmail_rate_retry.state === 'released'});
  }
  function receiveCompletedAccountDeferral(source) {
    if (publicCalls || mailboxSelectionActive || accountBoundary || activeAccountAttempt || activeRateContinuation)
      throw new TypeError('Finish the original native operation before receiving its completed return');
    if (sendInvocationCount() || journal.receipt || journal.native_receipt)
      throw new TypeError('An invoked contact keeps its original provider receiving path');
    if (!source || Object.keys(source).some(key => !['content','sha256'].includes(key)) ||
        typeof source.content !== 'string' || source.content.length > 10 * 1024 * 1024 ||
        !/^[a-f0-9]{64}$/.test(source.sha256 || '') ||
        modules.sha256Utf8(source.content).sha256 !== source.sha256)
      throw new TypeError('Complete retained original journal bytes and SHA-256 required');
    let previous;
    try { previous = JSON.parse(source.content); }
    catch { throw new TypeError('Complete retained original journal JSON required'); }
    const same = (left,right) => rateCanonical(left) === rateCanonical(right);
    const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value;
    const deferred = previous?.account_deferred, outcome = previous?.outcome;
    if (previous?.schema !== 'commons.connected-first-contact/v1' ||
        previous.input_sha256 !== identity || previous.lease !== lease ||
        !same(previous.input,reviewed) || !Array.isArray(previous.events) ||
        previous.events.length > journal.events.length ||
        previous.events.some((event,index) => !same(event,journal.events[index])) ||
        deferred?.input_sha256 !== identity || deferred.operation_lease !== lease ||
        deferred.gmail_invocations !== 0 || !iso(deferred.observed_at) ||
        outcome?.status !== 'ACCOUNT_DEFERRED' || !same(outcome,deferred.outcome) ||
        outcome.intent_branch !== intent.branch || outcome.recipient_claim_path !== path ||
        previous.receipt || previous.native_receipt)
      throw new TypeError('The completed return must preserve this original journal prefix and reviewed contact');
    const preparedIndex = previous.events.findLastIndex(event =>
      event.phase === 'account-attempt-prepared' && event.operation_key === accountOperationKey);
    const prepared = previous.events[preparedIndex];
    if (preparedIndex < 0 || !/^[a-f0-9]{64}$/.test(prepared?.attempt_key || '') ||
        journal.events.slice(preparedIndex+1).some(event =>
          ['account-attempt-prepared','account-attempt-acquired'].includes(event.phase) &&
          event.operation_key === accountOperationKey))
      throw new TypeError('The completed return must identify the current original unused account attempt');
    const location = originalMailboxAdmission().location();
    const accountArgs = {repository_full_name:location.repository,path:location.path,
      ref:location.branch,encoding:'utf-8'};
    const actorBindings = ['mcp__codex_apps__github_get_profile','mcp__codex_apps__github_get_user_login'];
    function completedReadSpan(events, startIndex, allowReceived) {
      const pending = new Map(), returned = new Map();
      const accountReads = [];
      const priorEvent = startIndex===preparedIndex+1 ? prepared : journal.events[startIndex-1];
      let previousTime = Date.parse(priorEvent?.observed_at), calls = 0;
      if (!iso(prepared.observed_at) || !iso(priorEvent?.observed_at))
        throw new TypeError('The original prepared and preceding account times are required');
      for (let offset=0; offset<events.length; offset++) {
        const outer=events[offset], eventIndex=startIndex+offset;
        if (!iso(outer?.observed_at) || Date.parse(outer.observed_at)<previousTime)
          throw new TypeError('Preserve the complete original account read order');
        previousTime=Date.parse(outer.observed_at);
        if (allowReceived && outer.phase==='account-attempt-deferred-ended' &&
            outer.operation_key===accountOperationKey && outer.attempt_key===prepared.attempt_key &&
            outer.source==='RETAINED_COMPLETED_NORMAL_DEFERRAL' &&
            outer.original_journal?.sha256===source.sha256) continue;
        const nested=outer.phase==='account-admission', event=nested ? outer.event : outer;
        if (!event || !['invoking','returned','failed'].includes(event.phase) ||
            !iso(event.observed_at) || Date.parse(event.observed_at)>Date.parse(outer.observed_at))
          throw new TypeError('Receive only the complete original read-only account span');
        const binding=event.binding, key=(nested ? 'account:' : 'contact:')+binding;
        if (event.phase==='invoking') {
          let kind;
          if (actorBindings.includes(binding) && same(event.args,{})) kind='actor';
          else if (nested && binding==='mcp__codex_apps__gmail_get_profile' &&
              same(event.args,{link_id:sender.link_id})) kind='profile';
          else if (nested && binding==='mcp__codex_apps__github_fetch' &&
              same(event.args,{url:'https://api.github.com/repos/'+location.repository})) kind='repository';
          else if (nested && binding==='mcp__codex_apps__github_get_repo' &&
              same(event.args,{repository_full_name:location.repository})) kind='repository';
          else if (nested && binding==='mcp__codex_apps__github_fetch_file' &&
              same(event.args,accountArgs)) kind='account';
          if (!kind || pending.has(key))
            throw new TypeError('The completed account return contains a write, different target or unresolved read');
          pending.set(key,{kind,binding,args:event.args,index:eventIndex,observed_at:outer.observed_at});
          returned.delete(key); calls++;
          continue;
        }
        const call=pending.get(key);
        if (event.phase==='failed') {
          // A read can terminate by throwing, or record its already-returned
          // native rejection. Neither shape is an account/recipient mutation.
          if (!call && returned.get(key)?.raw?.isError!==true)
            throw new TypeError('The original failed read must retain its invocation or returned rejection');
          pending.delete(key); returned.delete(key);
          continue;
        }
        if (!call || !event.raw || typeof event.raw!=='object' ||
            !Array.isArray(event.raw.content) || typeof event.raw.isError!=='boolean')
          throw new TypeError('Complete paired original read invocations and native returns required');
        pending.delete(key);
        const completed={...call,raw:event.raw,returned_index:eventIndex,returned_at:outer.observed_at};
        returned.set(key,completed);
        if (event.raw.isError) continue;
        const value=nativeValue(event.raw,binding);
        if (call.kind==='actor') {
          const login=binding==='mcp__codex_apps__github_get_user_login' ? value.login : value.nickname;
          if (String(value.id)!=='293286387' || login!=='woahwhattheheck')
            throw new TypeError('The original account read used a different GitHub actor');
        } else if (call.kind==='profile') {
          if (String(value.id)!==sender.id || value.email!==sender.email)
            throw new TypeError('The original account read used a different selected mailbox');
        } else if (call.kind==='repository') {
          const names=[value.full_name,value.repository_full_name].filter(name=>name!=null);
          if (!names.length || names.some(name=>name!==location.repository))
            throw new TypeError('The original account read used a different repository');
        } else {
          if (typeof value.content!=='string' || !/^[a-f0-9]{40}$/.test(value.sha||''))
            throw new TypeError('The original account read must retain its complete file and blob');
          let state; try {state=JSON.parse(value.content);} catch {
            throw new TypeError('The original account read must retain its complete native state');
          }
          if (!['commons.gmail-account-admission/v1','commons.gmail-account-admission/v2'].includes(state?.schema) ||
              state.account_key!==location.account_key || state.profile_id!==sender.id ||
              state.provider!=='gmail' || state.activity!=='Mail sending')
            throw new TypeError('The original read must belong to this selected account');
          accountReads.push({...completed,value});
        }
      }
      if (pending.size)
        throw new TypeError('Finish every original account read before receiving its completed return');
      return {calls,accountReads};
    }
    const readSpan=completedReadSpan(previous.events.slice(preparedIndex+1),preparedIndex+1,false);
    // Later completed inspections can remain appended to the same journal.
    // An intervening write, acquisition, unresolved call or different receiving
    // marker cannot use an older completed return to close the current attempt.
    completedReadSpan(journal.events.slice(previous.events.length),previous.events.length,true);
    const lastRead=readSpan.accountReads.at(-1);
    if (!lastRead || lastRead.returned_index!==previous.events.length-1 ||
        Date.parse(deferred.observed_at)<Date.parse(lastRead.returned_at))
      throw new TypeError('The completed deferral must end with its selected original account-file return');
    const value=lastRead.value;
    let state;
    try { state = JSON.parse(value.content); }
    catch { throw new TypeError('Complete original account state required'); }
    const proof = state?.deadline_source, classified = classifyReturnedSendRateLimit(proof?.raw,proof?.observed_at);
    if (!['commons.gmail-account-admission/v1','commons.gmail-account-admission/v2'].includes(state?.schema) ||
        state.account_key !== location.account_key || state.profile_id !== sender.id ||
        state.provider !== 'gmail' || state.activity !== 'Mail sending' ||
        !Number.isSafeInteger(state.revision) || state.revision < 0 ||
        !iso(state.updated_at) || Date.parse(state.updated_at)>Date.parse(lastRead.returned_at) ||
        !iso(state.not_before) ||
        Date.parse(state.not_before) <= Date.parse(deferred.observed_at) ||
        classified?.retry_after !== state.not_before || proof.profile_id !== sender.id ||
        !/^[a-f0-9]{64}$/.test(proof.operation_key || '') ||
        !/^[a-f0-9]{64}$/.test(proof.invocation_sha256 || '') ||
        !iso(proof.observed_at) ||
        proof.return_sha256 !== modules.sha256Utf8(JSON.stringify(proof.raw)).sha256 ||
        !same(outcome.account,{status:'PROVIDER_DEFERRED',retry_after:state.not_before,
          account_key:location.account_key,deadline_return_sha256:proof.return_sha256}) &&
        !same(outcome.account,{status:'PROVIDER_DEFERRED',retry_after:state.not_before,
          account_key:location.account_key,deadline_return_sha256:proof.return_sha256,
          state_sha:value.sha,revision:state.revision,provider_not_before:state.not_before}))
      throw new TypeError('The completed normal deferral must reproduce its original provider-backed account result');
    const existing = journal.events.find(event =>
      event.phase === 'account-attempt-deferred-ended' &&
      event.operation_key === accountOperationKey && event.attempt_key === prepared.attempt_key &&
      event.source === 'RETAINED_COMPLETED_NORMAL_DEFERRAL');
    if (existing) {
      if (existing.original_journal?.sha256 !== source.sha256)
        throw new TypeError('This original account attempt already has a different completed return');
      return {status:'ACCOUNT_COMPLETED_DEFERRAL_RECEIVED',operation_key:accountOperationKey,
        attempt_key:prepared.attempt_key,source_sha256:source.sha256,
        original_completed_at:deferred.observed_at,provider_outcome:'NOT_INVOKED'};
    }
    record({phase:'account-attempt-deferred-ended',operation_key:accountOperationKey,
      attempt_key:prepared.attempt_key,input_sha256:identity,operation_lease:lease,
      gmail_invocations:0,account:outcome.account,source:'RETAINED_COMPLETED_NORMAL_DEFERRAL',
      original_completed_at:deferred.observed_at,original_event_count:previous.events.length,
      original_account_reads:{start_event:preparedIndex+1,end_event:lastRead.returned_index,
        native_calls:readSpan.calls,account_file_reads:readSpan.accountReads.length,
        selected_state_sha:value.sha,selected_revision:state.revision},
      original_journal:{content:source.content,sha256:source.sha256}});
    return {status:'ACCOUNT_COMPLETED_DEFERRAL_RECEIVED',operation_key:accountOperationKey,
      attempt_key:prepared.attempt_key,source_sha256:source.sha256,
      original_completed_at:deferred.observed_at,provider_outcome:'NOT_INVOKED'};
  }

  function receiveEndedRateAccountAttempt(prepared,preparedIndex,invocationsBefore) {
    // Older returned-rate callers closed an unused acquisition through their
    // original rate result and confirmed recipient release. Receive those
    // complete native events before the ordinary account reconciliation.
    if (!invocationsBefore || sendInvocationCount() !== invocationsBefore ||
        journal.events.slice(preparedIndex+1).some(event =>
          ['account-attempt-prepared','account-attempt-acquired'].includes(event.phase) &&
          event.operation_key === accountOperationKey)) return null;
    const rateIndex=journal.events.findLastIndex((event,index) => index < preparedIndex &&
      event.phase === 'rate-continuation');
    const rate=journal.events[rateIndex], plan=rate?.continuation;
    if (!plan || plan.input_sha256 !== identity || plan.lease !== lease ||
        plan.intent_branch !== intent.branch || plan.recipient_claim_path !== path ||
        !/^[a-f0-9]{64}$/.test(rate.claim_nonce || '')) return null;
    const current=rateLimitContinuation();
    if (plan.retry_id !== current.retry_id || plan.proof_sha256 !== current.proof_sha256 ||
        plan.intent_ref_sha !== current.intent_ref_sha ||
        rateCanonical(plan.rejected) !== rateCanonical(current.rejected)) return null;
    const resultIndex=journal.events.findIndex((event,index) => index > preparedIndex &&
      event.phase === 'rate-continuation-returned' && event.retry_id === plan.retry_id &&
      event.claim_nonce === rate.claim_nonce);
    const result=journal.events[resultIndex], outcome=result?.outcome;
    if (!result || result.provider_invoked !== false || result.send_permission_consumed !== false ||
        outcome?.status !== 'NOT_SENT' || outcome.reason !== 'RATE_DISPATCH_NOT_INVOKED' ||
        outcome.gateway_status !== 'SEND_OUTCOME_UNKNOWN' ||
        outcome.intent_branch !== intent.branch || outcome.recipient_claim_path !== path ||
        journal.events.slice(rateIndex+1,resultIndex).some(event =>
          event.phase === 'rate-continuation' ||
          event.phase === 'invoking' && event.binding === nativeSendBinding))
      return null;
    const tail=journal.events.slice(preparedIndex+1,resultIndex);
    if (tail.length !== 2 || tail.some(event => event.phase !== 'account-admission') ||
        tail[0].event?.phase !== 'invoking' || tail[1].event?.phase !== 'returned' ||
        tail.some(event => event.event?.binding !== 'mcp__codex_apps__github_fetch_file'))
      return null;
    const iso=value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value;
    const times=[rate.observed_at,prepared.observed_at,tail[0].observed_at,
      tail[1].observed_at,result.observed_at];
    if (times.some(value => !iso(value)) ||
        times.some((value,index) => index && Date.parse(value) < Date.parse(times[index-1])))
      return null;
    const location=originalMailboxAdmission().location(), args=tail[0].event.args;
    const raw=tail[1].event.raw, file=raw?.structuredContent;
    if (args?.repository_full_name !== location.repository || args.path !== location.path ||
        args.ref !== location.branch || args.encoding !== 'utf-8' ||
        raw?.isError || typeof file?.content !== 'string' ||
        !/^[a-f0-9]{40}$/.test(file.sha || '')) return null;
    let state;try {state=JSON.parse(file.content);} catch {return null;}
    if (!['commons.gmail-account-admission/v1','commons.gmail-account-admission/v2'].includes(state?.schema) ||
        state.account_key !== location.account_key || state.profile_id !== sender.id ||
        state.provider !== 'gmail' || state.activity !== 'Mail sending' ||
        !Number.isSafeInteger(state.revision) || state.revision < 0 ||
        !iso(state.updated_at) || Date.parse(state.updated_at) > Date.parse(tail[1].observed_at) ||
        state.not_before !== null && !iso(state.not_before)) return null;
    const endedAt=Date.parse(result.observed_at);
    let account;
    if (state.not_before && Date.parse(state.not_before) > endedAt) {
      const proof=state.deadline_source, classified=classifyReturnedSendRateLimit(proof?.raw,proof?.observed_at);
      if (classified?.retry_after !== state.not_before || proof.profile_id !== sender.id ||
          !/^[a-f0-9]{64}$/.test(proof.operation_key || '') ||
          !/^[a-f0-9]{64}$/.test(proof.invocation_sha256 || '') ||
          !iso(proof.observed_at) ||
          proof.return_sha256 !== modules.sha256Utf8(JSON.stringify(proof.raw)).sha256)
        return null;
      account={status:'PROVIDER_DEFERRED',retry_after:state.not_before,
        account_key:location.account_key,deadline_return_sha256:proof.return_sha256};
    } else {
      const active=state.active;
      if (!active || !/^[a-f0-9]{64}$/.test(active.operation_key || '') ||
          !/^[a-f0-9]{64}$/.test(active.attempt_key || '') ||
          !/^[a-f0-9]{64}$/.test(active.token || '') ||
          !iso(active.acquired_at) || !iso(active.expires_at) ||
          Date.parse(active.expires_at)-Date.parse(active.acquired_at) !== 600000 ||
          Date.parse(active.acquired_at) > Date.parse(tail[1].observed_at) ||
          Date.parse(active.expires_at) <= endedAt ||
          active.operation_key === accountOperationKey && active.attempt_key === prepared.attempt_key)
        return null;
      account={status:'SEND_ACTIVE',retry_after:active.expires_at,account_key:location.account_key};
    }
    const releaseIndex=journal.events.findIndex((event,index) => index > resultIndex &&
      event.phase === 'rate-attempt-release' && event.retry_id === plan.retry_id &&
      event.claim_nonce === rate.claim_nonce && event.released === true);
    const release=journal.events[releaseIndex];
    if (!release || !iso(release.observed_at) || Date.parse(release.observed_at) < endedAt)
      return null;
    const readback=rateNativeCalls('mcp__codex_apps__github_fetch_file',releaseIndex+1).findLast(call => {
      if (call.index <= resultIndex || !call.returned || call.raw?.isError ||
          call.args?.repository_full_name !== repository || call.args.path !== path ||
          call.args.ref !== 'main' || !/^[a-f0-9]{40}$/.test(call.raw.structuredContent?.sha || ''))
        return false;
      let claim;try {claim=JSON.parse(call.raw.structuredContent.content);} catch {return false;}
      const marker=claim?.gmail_rate_retry, write=retainedRateClaim(marker,'released');
      return claim.protocol === 'commons-first-contact-v1' && claim.status === 'reserved' &&
        claim.case === reviewed.opportunity_id && claim.lease === lease &&
        marker?.retry_id === plan.retry_id && marker.claim_nonce === rate.claim_nonce &&
        marker.proof_sha256 === plan.proof_sha256 && write &&
        write.invocation_event > resultIndex && write.invocation_event < call.index;
    });
    if (!readback) return null;
    return record({phase:'account-attempt-deferred-ended',operation_key:accountOperationKey,
      attempt_key:prepared.attempt_key,input_sha256:identity,operation_lease:lease,
      gmail_invocations:invocationsBefore,account,source:'RETAINED_COMPLETED_RATE_ACCOUNT_DEFERRAL',
      original_completed_at:result.observed_at,rate_continuation_event:rateIndex,
      account_invocation_event:preparedIndex+1,account_returned_event:preparedIndex+2,
      account_return_sha256:modules.sha256Utf8(JSON.stringify(raw)).sha256,
      rate_returned_event:resultIndex,rate_release_event:releaseIndex,
      recipient_readback_event:readback.returned_index,
      recipient_readback_sha:readback.raw.structuredContent.sha});
  }
  function endedAccountAcquisition(prepared,preparedIndex) {
    const invocationsBefore = sendInvocationCount(preparedIndex);
    let ended = journal.events.findLast(event => event.phase === 'account-attempt-deferred-ended' &&
      event.operation_key === accountOperationKey && event.attempt_key === prepared.attempt_key);
    if (!ended) {
      // The earlier acquisition-error path already saved an explicit final
      // ACCOUNT_DEFERRED outcome naming this exact attempt after acquire threw.
      const deferred = journal.account_deferred, outcome = journal.outcome;
      const failed = journal.events.findLast(event => event.phase === 'account-acquire-unfinished' &&
        event.operation_key === accountOperationKey && event.attempt_key === prepared.attempt_key);
      if (failed && journal.events.indexOf(failed) > preparedIndex &&
          deferred?.input_sha256 === identity && deferred.operation_lease === lease &&
          deferred.gmail_invocations === invocationsBefore &&
          outcome?.status === 'ACCOUNT_DEFERRED' &&
          outcome.account?.operation_key === accountOperationKey &&
          outcome.account.attempt_key === prepared.attempt_key &&
          rateCanonical(outcome) === rateCanonical(deferred.outcome) &&
          Number.isFinite(Date.parse(deferred.observed_at)) &&
          Date.parse(deferred.observed_at) >= Date.parse(failed.observed_at) &&
          sendInvocationCount() === invocationsBefore) {
        ended = record({phase:'account-attempt-deferred-ended',operation_key:accountOperationKey,
          attempt_key:prepared.attempt_key,input_sha256:identity,operation_lease:lease,
          gmail_invocations:invocationsBefore,account:outcome.account,
          source:'RETAINED_FINAL_ACQUISITION_ERROR_DEFERRAL'});
      }
    }
    if (!ended) ended = receiveEndedRateAccountAttempt(prepared,preparedIndex,invocationsBefore);
    if (!ended) return null;
    const endedIndex = journal.events.indexOf(ended);
    if (endedIndex <= preparedIndex || ended.input_sha256 !== identity ||
        ended.operation_lease !== lease || ended.gmail_invocations !== invocationsBefore ||
        journal.events.slice(preparedIndex,endedIndex+1).some(event =>
          event.phase === 'invoking' && event.binding === nativeSendBinding))
      throw new TypeError('Original ended account deferral does not describe an unused attempt');
    return {ended,endedIndex};
  }
  function receivedAccountInterruption(prepared,preparedIndex) {
    const received=journal.account_interruption_received;
    if(!received || received.attempt_key!==prepared.attempt_key)return null;
    const event=journal.events[received.received_event],proof=event?.checkpoint_proof;
    if(received.input_sha256!==identity || received.operation_lease!==lease ||
        received.operation_key!==accountOperationKey || received.gmail_invocations!==0 ||
        sendInvocationCount() || !event || event.phase!=='account-interruption-received' ||
        event.operation_key!==accountOperationKey || event.attempt_key!==prepared.attempt_key ||
        event.prepared_event!==preparedIndex || event.gmail_invocations!==0 ||
        proof?.schema!=='commons.contact-checkpoint-account-interruption/v1' ||
        proof.operation_key!==accountOperationKey || proof.input_sha256!==identity ||
        proof.operation_lease!==lease || proof.attempt_key!==prepared.attempt_key ||
        proof.prepared_event!==preparedIndex ||
        proof.original_event_count>received.received_event ||
        event.result?.status!=='ACCOUNT_RECONCILED' ||
        event.result.provider_outcome!=='NOT_INVOKED' ||
        !Array.isArray(event.result.results) || !event.result.results.length ||
        event.result.results.some(row=>!['RELEASED','ORIGINAL_LEASE_NO_LONGER_ACTIVE'].includes(row.released?.status)))
      throw new TypeError('The original received account interruption changed');
    return {event,index:received.received_event,result:event.result};
  }
  async function reconcileUnacquiredAccountAttempt(prepared,preparedIndex) {
    if (!/^[a-f0-9]{64}$/.test(prepared.attempt_key || ''))
      throw new TypeError('Original prepared account attempt required');
    const received=receivedAccountInterruption(prepared,preparedIndex);
    if(received)return received.result;
    let finished = endedAccountAcquisition(prepared,preparedIndex),interruption=null;
    if(!finished && typeof modules.checkpoints?.receiveInterruptedAccountAttempt==='function') {
      interruption=await modules.checkpoints.receiveInterruptedAccountAttempt({
        preparedIndex,attemptKey:prepared.attempt_key,location:originalMailboxAdmission().location()});
      if(interruption) {
        if(interruption.schema!=='commons.contact-checkpoint-account-interruption/v1' ||
            interruption.operation_key!==accountOperationKey || interruption.input_sha256!==identity ||
            interruption.operation_lease!==lease || interruption.attempt_key!==prepared.attempt_key ||
            interruption.prepared_event!==preparedIndex || interruption.gmail_invocations!==0 ||
            sendInvocationCount() || journal.receipt || journal.native_receipt ||
            !Number.isSafeInteger(interruption.original_event_count) ||
            interruption.original_event_count>journal.events.length ||
            interruption.account_write_event<=preparedIndex ||
            !(storage?interruption.receiving_checkpoint?.kind==='commons.connected-contact-local-checkpoint/v1'&&
              interruption.receiving_checkpoint.coordinator_id===storage.coordinatorId&&
              interruption.receiving_checkpoint.storage_receipt?.coordinator_id===storage.coordinatorId&&
              interruption.receiving_checkpoint.storage_receipt.namespace==='checkpoint'&&
              interruption.receiving_checkpoint.storage_receipt.key===accountOperationKey&&
              interruption.receiving_checkpoint.storage_receipt.sha256===interruption.receiving_checkpoint.sha256:
              interruption.receiving_checkpoint?.repository==='woahwhattheheck/commons-ship-enforcer'&&
              /^[a-f0-9]{40}$/.test(interruption.receiving_checkpoint?.commit||''))||
            !/^[a-f0-9]{64}$/.test(interruption.receiving_checkpoint?.token || ''))
          throw new TypeError('The original fenced account interruption changed');
        finished={endedIndex:interruption.original_event_count};
      }
    }
    if (!finished) return {status:'ACCOUNT_ORIGINAL_CALL_RECONCILIATION_REQUIRED',
      operation_key:accountOperationKey,attempt_key:prepared.attempt_key};
    const admission = originalMailboxAdmission();
    if (typeof admission.location !== 'function')
      throw new TypeError('Original account-state location required for acquisition receiving');
    const location = admission.location(), candidates = new Map();
    const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value;
    for (let index=preparedIndex+1;index<finished.endedIndex;index++) {
      const outer=journal.events[index], event=outer.phase === 'account-admission' ? outer.event : null;
      const local=storage&&event?.binding==='commons.local-state.compareAndSwap';
      if(event?.phase!=='invoking'||(!local&&
         !['mcp__codex_apps__github_create_file','mcp__codex_apps__github_update_file'].includes(event.binding)))continue;
      const args=event.args;
      if(typeof args?.content!=='string'||(local?
        location.storage_kind!=='commons.connected-contact-local-state/v1'||location.coordinator_id!==storage.coordinatorId||
        args.namespace!=='account'||args.key!==location.account_key||typeof args.operation_id!=='string':
        args.repository_full_name!==location.repository||args.branch!==location.branch||args.path!==location.path))continue;
      let postimage;try { postimage=JSON.parse(args.content); } catch { continue; }
      const token=postimage?.active;
      if (token?.operation_key !== accountOperationKey || token.attempt_key !== prepared.attempt_key) continue;
      if (!['commons.gmail-account-admission/v1','commons.gmail-account-admission/v2'].includes(postimage.schema) ||
          postimage.account_key !== location.account_key || postimage.provider !== 'gmail' ||
          postimage.profile_id !== sender.id || postimage.activity !== 'Mail sending' ||
          !Number.isSafeInteger(postimage.revision) || postimage.revision < 1 ||
          !/^[a-f0-9]{64}$/.test(token.token || '') ||
          !validTime(token.acquired_at) || !validTime(token.expires_at) ||
          Date.parse(token.expires_at)-Date.parse(token.acquired_at) !== 600000)
        throw new TypeError('Complete original account acquisition postimage required');
      const candidate={lease:JSON.parse(JSON.stringify(token)),source_index:index,
        postimage_sha256:modules.sha256Utf8(args.content).sha256};
      const prior=candidates.get(token.token);
      if (prior && rateCanonical(prior.lease) !== rateCanonical(candidate.lease))
        throw new TypeError('Original acquisition token has conflicting retained postimages');
      candidates.set(token.token,candidate);
    }
    if(interruption && (candidates.size!==1 ||
        !candidates.has(interruption.account_lease.token) ||
        candidates.get(interruption.account_lease.token).source_index!==interruption.account_write_event ||
        candidates.get(interruption.account_lease.token).postimage_sha256!==interruption.postimage_sha256 ||
        rateCanonical(candidates.get(interruption.account_lease.token).lease)!==rateCanonical(interruption.account_lease)))
      throw new TypeError('Receive the exact interrupted original account write');
    if (!candidates.size) return {status:'ACCOUNT_RECONCILED',operation_key:accountOperationKey,
      attempt_key:prepared.attempt_key,provider_outcome:'NOT_INVOKED',
      acquisition:'NO_RETAINED_ACQUISITION_WRITE'};
    await verifyActor();
    const results=[];
    for (const candidate of [...candidates.values()].reverse()) {
      // Only the original ended attempt is eligible. A later provider invocation
      // with its identity remains in the original message receiving path.
      if (rateNativeCalls(nativeSendBinding).some(call =>
          call.event.account_operation_key === accountOperationKey &&
          call.event.account_attempt_key === prepared.attempt_key))
        throw new TypeError('An invoked account attempt requires original provider receiving');
      const confirmation=await admission.confirm(candidate.lease,{observe_only:true});
      if (confirmation?.status==='ACCOUNT_STATE_READBACK_PENDING')
        return {...confirmation,operation_key:accountOperationKey,
          attempt_key:prepared.attempt_key,stage:'ORIGINAL_ACQUISITION_CONFIRM'};
      if (!['LEASE_CONFIRMED','PROVIDER_DEFERRED','ACCOUNT_LEASE_CHANGED'].includes(confirmation?.status))
        throw new TypeError('Original acquired account token confirmation is incomplete');
      // release() rereads and CAS-matches this exact token/operation/attempt.
      // It also safely clears an expired own token, or preserves a newer owner.
      const released=await admission.release(candidate.lease,{outcome:'UNACQUIRED_DEFERRAL_RECONCILED'});
      if (released?.status==='ACCOUNT_STATE_READBACK_PENDING')
        return {...released,operation_key:accountOperationKey,
          attempt_key:prepared.attempt_key,stage:'ORIGINAL_ACQUISITION_RELEASE'};
      if (!['RELEASED','ORIGINAL_LEASE_NO_LONGER_ACTIVE'].includes(released?.status))
        throw new TypeError('Original unacknowledged account acquisition still needs release receiving');
      const result={source_index:candidate.source_index,postimage_sha256:candidate.postimage_sha256,
        token:candidate.lease.token,confirmation,released};
      results.push(result);
      record({phase:'account-acquisition-release-received',operation_key:accountOperationKey,
        attempt_key:prepared.attempt_key,...result});
      if (released.status === 'RELEASED') break;
    }
    const result={status:'ACCOUNT_RECONCILED',operation_key:accountOperationKey,
      attempt_key:prepared.attempt_key,provider_outcome:'NOT_INVOKED',
      acquisition:'RETAINED_ORIGINAL_POSTIMAGE',results};
    if(interruption) {
      const event=record({phase:'account-interruption-received',
        input_sha256:identity,operation_lease:lease,operation_key:accountOperationKey,
        attempt_key:prepared.attempt_key,prepared_event:preparedIndex,gmail_invocations:0,
        checkpoint_proof:interruption,result});
      journal.account_interruption_received={input_sha256:identity,operation_lease:lease,
        operation_key:accountOperationKey,attempt_key:prepared.attempt_key,
        gmail_invocations:0,received_event:journal.events.indexOf(event),
        observed_at:event.observed_at};
      store(stateKey,journal);
    }
    return result;
  }
  function receivedUndispatchedAccountAttempt(acquired) {
    const validTime=value=>typeof value==='string' && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString()===value;
    const acquiredIndex = journal.events.indexOf(acquired);
    const cancelled = [];
    for (let index=acquiredIndex+1;index<journal.events.length;index++) {
      const event=journal.events[index];
      if (event.binding===nativeSendBinding && event.phase==='checkpoint-not-dispatched' &&
          event.account_operation_key===accountOperationKey &&
          event.account_attempt_key===acquired.attempt_key)
        cancelled.push({event,index});
    }
    if (!cancelled.length) return null;
    if (cancelled.length!==1)
      throw new TypeError('Receive the original single cancelled account call');
    const call=cancelled[0];
    const endedIndex=journal.events.findLastIndex((event,index) => index>call.index &&
      event.phase==='account-attempt-release-failed' &&
      event.operation_key===accountOperationKey && event.attempt_key===acquired.attempt_key &&
      event.invoked===true && event.returned===false && event.terminated===true);
    if (endedIndex<0) return null;
    const ended=journal.events[endedIndex];
    if (rateCanonical(call.event.args)!==rateCanonical(rateNativeArguments()) ||
        !validTime(acquired.observed_at) || !validTime(call.event.observed_at) ||
        !validTime(ended.observed_at) ||
        Date.parse(acquired.observed_at)>Date.parse(call.event.observed_at) ||
        Date.parse(call.event.observed_at)>Date.parse(ended.observed_at) ||
        journal.events.slice(acquiredIndex+1).some(event =>
          event.binding===nativeSendBinding && ['invoking','returned'].includes(event.phase) ||
          event.operation_key===accountOperationKey &&
          ['account-attempt-prepared','account-attempt-acquired'].includes(event.phase)))
      throw new TypeError('Original cancelled account attempt selection changed');
    const receive=modules.checkpoints?.receiveUndispatchedNativeCall;
    if (typeof receive!=='function')
      throw new TypeError('Load the complete checkpoint to receive the original cancelled account call');
    // The checkpoint validates its complete retained transport, input, lease,
    // argument hash, call ID and cancellation time. A failed call or an empty
    // SENT search is not evidence that the provider was never invoked.
    const proof=receive({eventIndex:call.index,binding:nativeSendBinding});
    if (proof?.schema!=='commons.contact-checkpoint-undispatched-call/v1' ||
        proof.status!=='NOT_DISPATCHED' || proof.operation_key!==accountOperationKey ||
        proof.input_sha256!==identity || proof.operation_lease!==lease ||
        proof.event_index!==call.index || proof.binding!==nativeSendBinding ||
        !validTime(proof.not_dispatched_at) ||
        Date.parse(proof.not_dispatched_at)<Date.parse(call.event.observed_at) ||
        Date.parse(proof.not_dispatched_at)>Date.parse(ended.observed_at))
      throw new TypeError('Original cancelled account transport proof changed');
    return {proof,account_acquired_event:acquiredIndex,account_ended_event:endedIndex};
  }

  async function reconcileAccountAdmission({withdraw_wait=false,reason='ORIGINAL_OPERATION_WITHDRAWN'} = {}) {
    if (accountBoundary || activeAccountAttempt)
      throw new TypeError('Finish the active original account operation before receiving its result');
    if (typeof withdraw_wait !== 'boolean')
      throw new TypeError('Explicit waiting withdrawal selection required');
    if (withdraw_wait)
      return withdrawOriginalAccountWait(reason,{required:true,force:true});
    const acquired = journal.events.filter(event => event.phase === 'account-attempt-acquired' &&
      event.operation_key === accountOperationKey).at(-1);
    const prepared = journal.events.findLast(event => event.phase === 'account-attempt-prepared' &&
      event.operation_key === accountOperationKey);
    if (prepared && (!acquired || journal.events.indexOf(prepared) > journal.events.indexOf(acquired)))
      return reconcileUnacquiredAccountAttempt(prepared,journal.events.indexOf(prepared));
    if (!acquired) {
      const received = receivedRateHistory();
      if (!received || !originalConnectorDeadline(received.plan))
        return {status:'NO_RETAINED_ACCOUNT_ATTEMPT'};
      await verifyActor();
      const observation = await receiveRetainedConnectorDeadline(received.plan);
      return {status:'ACCOUNT_RECONCILED',operation_key:accountOperationKey,
        observation,provider_outcome:'RETAINED_CONNECTOR_RETURN_RECEIVED',
        history_sha256:received.history_sha256};
    }
    const accountLease = acquired.lease;
    if (!/^[a-f0-9]{64}$/.test(acquired.attempt_key || '') ||
        accountLease?.operation_key !== accountOperationKey ||
        accountLease.attempt_key !== acquired.attempt_key ||
        !/^[a-f0-9]{64}$/.test(accountLease.token || ''))
      throw new TypeError('Complete original acquired account token required');
    const calls = rateNativeCalls(nativeSendBinding).filter(call =>
      call.event.account_operation_key === accountOperationKey &&
      call.event.account_attempt_key === acquired.attempt_key);
    if (calls.length > 1) throw new TypeError('Original account token has multiple provider invocations');
    const call = calls[0];
    const active = {lease:accountLease,attempt_key:acquired.attempt_key,returned:call?.returned || null};
    await verifyActor();
    if (call) {
      if (call.index <= journal.events.indexOf(acquired) ||
          rateCanonical(call.args) !== rateCanonical(rateNativeArguments()))
        throw new TypeError('Original retained Gmail invocation changed');
      if (!call.raw || !call.returned) {
        if (!call.failed) return {status:'ACCOUNT_PROVIDER_RECONCILIATION_REQUIRED',
          operation_key:accountOperationKey,attempt_key:acquired.attempt_key};
        const released = await releaseOriginalAccountLease(active,'ORIGINAL_CALL_TERMINATED');
        return {status:'ACCOUNT_RECONCILED',operation_key:accountOperationKey,
          attempt_key:acquired.attempt_key,released,provider_outcome:'ORIGINAL_RECONCILIATION'};
      }
      // A legacy caller may have retained several original tool rejections
      // before this classifier was installed. Receive their greatest deadline
      // before observing the last call or releasing its existing account token.
      if (rateNativeCalls(nativeSendBinding).some(value =>
          classifyReturnedConnectorRateLimit(value.raw,value.returned?.observed_at)))
        await receiveRetainedConnectorDeadline(rateLimitContinuation());
      // The greatest historical deadline was received above. The actual
      // original call still needs its own charged-token return before release.
      const observation = await receiveOriginalAccountReturn(
        call.args,call.raw,call.returned.observed_at,active);
      const released = await releaseOriginalAccountLease(active,'NATIVE_RETURN_RECONCILED');
      return {status:'ACCOUNT_RECONCILED',operation_key:accountOperationKey,
        attempt_key:acquired.attempt_key,observation,released};
    }
    // An explicit unused-release record or a complete checkpoint cancellation
    // can settle this ended attempt. An acquired token alone cannot.
    const ended = journal.events.findLast(event => event.phase === 'account-attempt-release-failed' &&
      event.operation_key === accountOperationKey && event.attempt_key === acquired.attempt_key &&
      event.invoked === false);
    const cancelled = ended ? null : receivedUndispatchedAccountAttempt(acquired);
    if (!ended && !cancelled) return {status:'ACCOUNT_ORIGINAL_CALL_RECONCILIATION_REQUIRED',
      operation_key:accountOperationKey,attempt_key:acquired.attempt_key};
    if (cancelled) record({phase:'account-undispatched-call-received',
      operation_key:accountOperationKey,attempt_key:acquired.attempt_key,...cancelled});
    const released = await releaseOriginalAccountLease(active,
      cancelled ? 'CHECKPOINT_NOT_DISPATCHED_RECONCILED' : 'UNUSED_RETURN_RECONCILED');
    return {status:'ACCOUNT_RECONCILED',operation_key:accountOperationKey,
      attempt_key:acquired.attempt_key,released,
      ...(cancelled ? {provider_outcome:'NOT_DISPATCHED',undispatched:cancelled.proof} : {})};
  }
  async function resumeRateLimited() {
    if (journal.outcome?.status === 'SENT_VERIFIED') return journal.outcome;
    if (activeRateContinuation) throw new TypeError('This original rate continuation is already running');
    const plan = rateLimitContinuation();
    // A retained provider interval can be answered entirely from this original
    // journal. Do not poll Git admission or either mailbox before that time.
    if (!plan.provider_eligible) return retainOutcome({status:'RATE_LIMIT_WAIT',
      retry_after:plan.retry_after, proof_sha256:plan.proof_sha256,
      provider_eligible:false,
      ...(originalConnectorDeadline(plan) ? {scope:originalConnectorDeadline(plan).scope,
        source_account:{id:sender.id,email:sender.email,link_id:sender.link_id},
        admission_receiving_required:!connectorDeadlineReceived(originalConnectorDeadline(plan))} : {}),
      intent_branch:intent.branch, recipient_claim_path:path});
    await receiveRetainedConnectorDeadline(plan);
    return withPreparedAccountBoundary(async () => {
    if (typeof adapters.renewRecipient !== 'function')
      throw new TypeError('Load the maintained original recipient-lease renewal');
    const active = {plan, used:false, claimed:false,
      claim_nonce:modules.sha256Utf8(rateCanonical({retry_id:plan.retry_id,
        journal_events:journal.events.length, observed_at:new Date().toISOString(), nonce:Math.random()})).sha256};
    activeRateContinuation = active;
    record({phase:'rate-continuation', continuation:plan, claim_nonce:active.claim_nonce});
    try {
      await verifyActor();
      const census = await fullRateCensus();
      const recovered = await reconcileRateCensus(census, plan);
      if (recovered) return recovered;
      const retryAdapters = {...adapters,
        // The earlier census reconciles a possible existing SENT. The gateway
        // now performs its single final census after the original retry claim,
        // so that final read must never reuse the earlier correspondence.
        census:() => fullRateCensus(),
        renewRecipient:(target, originalLease) => claimRateAttempt(active, target, originalLease)};
      const outcome = await modules.gateway.sendFirstContact(reviewed, retryAdapters, {
        resumeReservation:{intent_ref_sha:plan.intent_ref_sha, lease}
      });
      const invoked = journal.events.some(event => event.phase === 'invoking' &&
        event.binding === nativeSendBinding && event.rate_retry_claim === active.claim_nonce);
      const result = !invoked && outcome.status === 'SEND_OUTCOME_UNKNOWN'
        ? {...outcome, status:'NOT_SENT', reason:'RATE_DISPATCH_NOT_INVOKED',
          action:'Continue the same retained original recipient claim', gateway_status:outcome.status}
        : outcome;
      record({phase:'rate-continuation-returned', retry_id:plan.retry_id,
        claim_nonce:active.claim_nonce, send_permission_consumed:active.used, provider_invoked:invoked, outcome:result});
      return retainOutcome(result);
    } finally {
      // A completed pre-send refusal can be attempted later from the same
      // input; an invoked or unresolved provider call keeps its exact marker.
      try { await releaseUnusedRateAttempt(active); }
      catch (error) { record({phase:'rate-attempt-release-failed', retry_id:plan.retry_id,
        claim_nonce:active.claim_nonce, message:String(error.message || error)}); }
      activeRateContinuation = null;
    }
    });
  }


  async function adoptReturnedRateMailbox(selection,kind='mailbox') {
    const draft=kind==='draft';
    if (deliveryCorrection) throw new TypeError('Delivery correction retains the original failed sender and account continuation');
    if (!selection || Object.keys(selection).some(key =>
        !(draft ? ['expected_input_sha256','expected_rate_proof_sha256','subject','body','body_type',
          'native_arguments','attachments','attachment_data','document_archives','reason']
          : ['link_id','expected_input_sha256','expected_rate_proof_sha256']).includes(key)) ||
        selection.expected_input_sha256 !== identity)
      throw new TypeError('Select the original mailbox against the complete reviewed input and returned-rate proof');
    const selected=draft?sender:mailboxes.find(item => item.link_id === selection.link_id);
    if (!selected || !draft && selected.link_id === sender.link_id)
      throw new TypeError('Explicitly select the other original verified mailbox');
    if (publicCalls || mailboxSelectionActive || accountBoundary || activeAccountAttempt || activeRateContinuation)
      throw new TypeError('Finish the current original contact operation before selecting its mailbox');
    if (journal.console_handoff)
      throw new TypeError('Receive this saved contact through its original Case Desk preview and handoff');
    const plan=rateLimitContinuation();
    if (!plan.rejected_invocations || selection.expected_rate_proof_sha256 !== plan.proof_sha256)
      throw new TypeError('Use the exact current terminal returned Gmail rejection');
    if (!draft && plan.rejected.some(item => item.quota_scope === 'connector_tool' &&
        Date.parse(item.retry_after) > Date.now()))
      throw new TypeError('Continue the original sender after its retained connector deadline before selecting a revised mailbox');
    const prior=returnedMailboxRevision();
    const currentCalls=plan.rejected.map(row => ({input_sha256:identity,
      invocation_event:row.invocation_event,returned_event:row.returned_event,
      proof_sha256:row.proof_sha256,retry_after:row.retry_after}));
    const closedCalls=[...(prior?.closed_calls || []),...currentCalls];
    const nextInput={...JSON.parse(JSON.stringify(input)),link_id:selected.link_id};
    if (draft) {
      if (nativeDraft || journal.recovered_rate_history ||
          typeof selection.reason!=='string' || !selection.reason.trim() || selection.reason.length>2000)
        throw new TypeError('Select the complete direct-message revision and its reason from the original returned history');
      if (nativeArguments) {
        if (!Object.hasOwn(selection,'body_type') || !Object.hasOwn(selection,'native_arguments'))
          throw new TypeError('Review the complete original native envelope with the revised message');
        nextInput.body_type=selection.body_type;
        nextInput.native_arguments=frozenJson(selection.native_arguments);
      } else if (Object.hasOwn(selection,'body_type') || Object.hasOwn(selection,'native_arguments'))
        throw new TypeError('Keep the original direct-message route');
      for (const field of ['subject','body']) if (Object.hasOwn(selection,field)) {
        if (typeof selection[field]!=='string' || !selection[field].trim() ||
            field==='subject' && /[\r\n]/.test(selection[field]))
          throw new TypeError('Complete reviewed subject and body required');
        nextInput[field]=selection[field];
      }
      const manifest=Object.hasOwn(selection,'attachments'),bytes=Object.hasOwn(selection,'attachment_data');
      if (manifest!==bytes || manifest && (!Array.isArray(selection.attachments) || !Array.isArray(selection.attachment_data)))
        throw new TypeError('Revise the complete attachment manifest and bytes together');
      if (manifest) {
        nextInput.attachments=frozenJson(selection.attachments);
        nextInput.attachment_data=frozenJson(selection.attachment_data);
        delete nextInput.document_archives;
      }
      if (Object.hasOwn(selection,'document_archives')) {
        if (!Array.isArray(selection.document_archives))throw new TypeError('Retain the complete selected document archive review');
        nextInput.document_archives=frozenJson(selection.document_archives);
      }
      if (!nextInput.attachments?.length && nextInput.attachment_data?.length)
        throw new TypeError('Original selected attachment manifest required');
    }
    const nextReview=reviewedRuntime(nextInput),nextReviewed=nextReview.reviewed,nextIdentity=nextReview.identity;
    if (draft && nextIdentity===identity)
      throw new TypeError('Select an actual reviewed message correction');
    if (modules.intent.fingerprint(nextReviewed).branch !== intent.branch)
      throw new TypeError('The selected mailbox must retain the original company intent');
    const pending=journal.pending_rate_mailbox_selection;
    if (pending && (pending.schema !== (draft?'commons.returned-rate-input-selection/v1':'commons.returned-rate-mailbox-selection/v1') ||
        (pending.revision_kind==='draft')!==draft || draft && pending.reason!==selection.reason.trim() ||
        pending.previous_input_sha256 !== identity || pending.input_sha256 !== nextIdentity ||
        pending.expected_rate_proof_sha256 !== plan.proof_sha256 ||
        pending.operation_lease !== lease || pending.sender.link_id !== selected.link_id ||
        rateCanonical(pending.input) !== rateCanonical(nextInput) ||
        rateCanonical(pending.closed_calls) !== rateCanonical(closedCalls)))
      throw new TypeError('Receive the retained original mailbox selection before choosing another');
    mailboxSelectionActive=true;
    try {
      const prepared=journal.events.findLast(event =>
        event.phase === 'account-attempt-prepared' && event.operation_key === accountOperationKey);
      const released=prepared && journal.events.slice(journal.events.indexOf(prepared)+1).findLast(event =>
        event.operation_key === accountOperationKey && event.attempt_key === prepared.attempt_key &&
        (event.phase === 'account-attempt-released' &&
          ['RELEASED','ORIGINAL_LEASE_NO_LONGER_ACTIVE'].includes(event.result?.status) ||
         event.phase === 'account-acquisition-release-received' &&
          ['RELEASED','ORIGINAL_LEASE_NO_LONGER_ACTIVE'].includes(event.released?.status)));
      const account=released ? {status:'ACCOUNT_RECONCILED',operation_key:accountOperationKey,
        attempt_key:prepared.attempt_key,release_event:journal.events.indexOf(released)}
        : await reconcileAccountAdmission();
      if (!['NO_RETAINED_ACCOUNT_ATTEMPT','ACCOUNT_RECONCILED'].includes(account?.status))
        return {status:'MAILBOX_SELECTION_PENDING',account,input_sha256:identity,
          intent_branch:intent.branch,recipient_claim_path:path};
      await verifyActor();
      await verifyMailboxes();
      const census=await together(mailboxes.map(async mailbox => ({
        mailbox:mailbox.email,sent_ids:await messageIds(mailbox,'in:sent to:'+recipient,true),
        inbound_ids:await messageIds(mailbox,'in:anywhere from:'+recipient+' -in:sent',true)
      })));
      if (census.some(item => item.sent_ids.length || item.inbound_ids.length))
        return {status:'MAILBOX_SELECTION_REVIEW',reason:'CURRENT_RECIPIENT_CORRESPONDENCE',census};
      const nextSpec={...nextReviewed,recipient,recipient_claim_path:path,intent_branch:intent.branch,intent_key:intent.key};
      const relationship=await adapters.beforeSend(nextSpec,{reviewed:nextReviewed,nativeDraft,identity:nextIdentity});
      if (relationship?.can_contact !== true)
        return {status:'MAILBOX_SELECTION_REVIEW',reason:'CURRENT_RELATIONSHIP',relationship};
      const [remoteIntent,before]=await together([adapters.readIntent(spec),readClaim(spec)]);
      if (!remoteIntent.exists || remoteIntent.branch !== intent.branch ||
          remoteIntent.ref_sha !== plan.intent_ref_sha ||
          before?.record.status !== 'reserved' || before.record.case !== reviewed.opportunity_id ||
          before.record.lease !== lease)
        throw new TypeError('Receive the unchanged original intent and recipient reservation');
      const marker=before.record.gmail_rate_retry;
      let retained=journal.pending_rate_mailbox_selection;
      if (!retained) {
        const lastInvocation=journal.events[plan.rejected.at(-1).invocation_event];
        let eligible=false;
        if (!marker) eligible=!lastInvocation.rate_retry_id;
        else if (marker.retry_id === lastInvocation.rate_retry_id &&
            marker.state === 'dispatching' &&
            marker.claim_nonce === lastInvocation.rate_retry_claim &&
            marker.dispatch_nonce === lastInvocation.rate_dispatch_nonce &&
            marker.proof_sha256 === lastInvocation.rate_rejection_sha256)
          eligible=!!retainedRateClaim(marker,'dispatching');
        else if (marker.retry_id === plan.retry_id && marker.proof_sha256 === plan.proof_sha256 &&
            ['claimed','released'].includes(marker.state)) {
          const original=retainedRateClaim(marker,marker.state);
          const invoked=journal.events.some(event => event.phase === 'invoking' &&
            event.binding === nativeSendBinding &&
            event.rate_retry_claim === marker.claim_nonce);
          eligible=!!original && !invoked;
        } else if (marker.retry_id === plan.retry_id && marker.proof_sha256 === plan.proof_sha256 &&
            marker.state === 'dispatching') {
          const canceled=journal.events.some(event => event.phase === 'rate-dispatch-cancel-selected' &&
            event.retry_id === marker.retry_id && event.proof_sha256 === marker.proof_sha256 &&
            event.claim_nonce === marker.claim_nonce && event.dispatch_nonce === marker.dispatch_nonce);
          const invoked=journal.events.some(event => event.phase === 'invoking' &&
            event.binding === nativeSendBinding &&
            event.rate_retry_claim === marker.claim_nonce);
          eligible=canceled && !invoked && !!retainedRateClaim(marker,'dispatching');
        }
        if (!eligible) return {status:'MAILBOX_SELECTION_REVIEW',
          reason:'ORIGINAL_RETRY_OWNERSHIP',input_sha256:identity,
          intent_branch:intent.branch,recipient_claim_path:path};
        const at=new Date().toISOString();
        const nonce=modules.sha256Utf8(rateCanonical({input_sha256:identity,
          selected_input_sha256:nextIdentity,proof_sha256:plan.proof_sha256,
          observed_at:at,journal_events:journal.events.length,nonce:Math.random()})).sha256;
        const selectionId=modules.sha256Utf8(rateCanonical({
          schema:draft?'commons.returned-rate-input-selection/v1':'commons.returned-rate-mailbox-selection/v1',
          ...(draft?{revision_kind:'draft',reason:selection.reason.trim()}:{}),
          previous_input_sha256:identity,input_sha256:nextIdentity,operation_lease:lease,
          intent_branch:intent.branch,intent_ref_sha:plan.intent_ref_sha,
          recipient_claim_path:path,expected_rate_proof_sha256:plan.proof_sha256,
          sender:selected,closed_calls:closedCalls,nonce})).sha256;
        const retryId=modules.sha256Utf8(
          'commons.gmail-mailbox-continuation/v1\0'+selectionId).sha256;
        const proposedMarker={schema:'commons.gmail-rate-attempt/v1',state:draft?'input-selected':'mailbox-selected',
          retry_id:retryId,proof_sha256:plan.proof_sha256,claim_nonce:nonce,
          mailbox_selection_id:selectionId,previous_input_sha256:identity,
          input_sha256:nextIdentity,sender_link_id:selected.link_id,
          sender_profile_id:selected.id,selected_at:at,
          previous_provider_retry_after:plan.retry_after};
        const proposed={...before.record,gmail_rate_retry:proposedMarker};
        retained={schema:draft?'commons.returned-rate-input-selection/v1':'commons.returned-rate-mailbox-selection/v1',
          ...(draft?{revision_kind:'draft',reason:selection.reason.trim()}:{}),
          selection_id:selectionId,previous_input_sha256:identity,input_sha256:nextIdentity,
          expected_rate_proof_sha256:plan.proof_sha256,operation_lease:lease,
          input:nextInput,reviewed:nextReviewed,previous_sender:{...sender},sender:{...selected},
          intent_branch:intent.branch,intent_ref_sha:plan.intent_ref_sha,recipient_claim_path:path,
          previous_rate_plan:JSON.parse(JSON.stringify(plan)),closed_calls:closedCalls,
          observed_at:at,nonce,retry_id:retryId,marker:proposedMarker,
          expected_recipient_sha:before.sha,previous_recipient:JSON.parse(JSON.stringify(before.record)),
          proposed_recipient:proposed,proposed_recipient_sha256:modules.sha256Utf8(JSON.stringify(proposed)).sha256};
        journal.pending_rate_mailbox_selection=retained;
        record({phase:'returned-rate-mailbox-selection-prepared',selection:retained,
          account_reconciliation:account});
      }
      let after=before,mutationError;
      if (rateCanonical(before.record) !== rateCanonical(retained.proposed_recipient)) {
        if (before.sha !== retained.expected_recipient_sha ||
            rateCanonical(before.record) !== rateCanonical(retained.previous_recipient))
          return {status:'MAILBOX_SELECTION_REVIEW',reason:'ORIGINAL_SELECTION_CAS_CHANGED',
            selection_id:retained.selection_id,input_sha256:identity};
        record({phase:'returned-rate-mailbox-selection-write',selection_id:retained.selection_id,
          expected_recipient_sha:retained.expected_recipient_sha,
          proposed_recipient_sha256:retained.proposed_recipient_sha256});
        try { await writeClaim(spec,retained.proposed_recipient,retained.expected_recipient_sha); }
        catch (error) { mutationError=error; }
        after=await readClaim(spec);
      }
      if (rateCanonical(after?.record) !== rateCanonical(retained.proposed_recipient))
        return {status:'MAILBOX_SELECTION_PENDING',reason:'ORIGINAL_SELECTION_READBACK',
          selection_id:retained.selection_id,input_sha256:identity,
          ...(mutationError ? {error:{name:mutationError.name,message:String(mutationError.message),
            status:mutationError.status || 0}} : {})};
      assertCurrentReview();
      const currentPlan=rateLimitContinuation();
      if (currentPlan.proof_sha256 !== plan.proof_sha256 ||
          rateCanonical(currentPlan.rejected) !== rateCanonical(plan.rejected))
        throw new TypeError('The original returned provider history changed during mailbox selection');
      if (typeof originalMailboxAdmission().withdraw==='function')
        await withdrawOriginalAccountWait('ORIGINAL_INPUT_REVISED',{required:true,force:true});
      const at=new Date().toISOString(),next=JSON.parse(JSON.stringify(journal));
      const selectionRecord={schema:draft?'commons.returned-rate-input-revision/v1':'commons.returned-rate-mailbox-revision/v1',
        ...(draft?{revision_kind:'draft',reason:selection.reason.trim()}:{}),
        selection_id:retained.selection_id,previous_input_sha256:identity,input_sha256:nextIdentity,
        operation_lease:lease,previous_sender:{...sender},sender:{...selected},
        intent_branch:intent.branch,intent_ref_sha:plan.intent_ref_sha,recipient_claim_path:path,
        previous_rate_plan:retained.previous_rate_plan,closed_calls:retained.closed_calls,
        observed_at:at,retry_id:retained.retry_id,marker:retained.marker,
        recipient_sha:after.sha,selected_event:next.events.length,
        intent_readback_event:plan.intent_readback_event,
        recipient_readback_event:journal.events.findLastIndex(event =>
          event.phase === 'returned' && event.binding === 'mcp__codex_apps__github_fetch_file' &&
          event.raw?.structuredContent?.sha === after.sha)};
      next.input_revisions=[...(next.input_revisions || []),{
        input_sha256:identity,input:JSON.parse(JSON.stringify(reviewed)),
        runtime_input:JSON.parse(JSON.stringify(input)),selected_until:at,
        returned_mailbox_selection_id:retained.selection_id,
        outcome:next.outcome,account_deferred:next.account_deferred || null,
        mailbox_selection:next.mailbox_selection || null,reviewed_revision:next.reviewed_revision || null,
        returned_mailbox_revision:next.returned_mailbox_revision || null,
        prepared_account_reservation:next.prepared_account_reservation || null}];
      next.input=nextReviewed;next.runtime_input=nextInput;next.input_sha256=nextIdentity;
      next.returned_mailbox_revision=selectionRecord;
      delete next.account_deferred;delete next.pending_rate_mailbox_selection;
      next.events.push({phase:draft?'returned-rate-input-selected':'returned-rate-mailbox-selected',observed_at:at,
        selection:selectionRecord,account_reconciliation:account,
        mutation_reconciled:Boolean(mutationError)});
      next.outcome={status:draft?'DRAFT_REVISED_AFTER_REJECTION':'MAILBOX_SELECTED',input_sha256:nextIdentity,sender:{...selected},
        selection_id:retained.selection_id,historical_rejected_invocations:closedCalls.length,
        intent_branch:intent.branch,recipient_claim_path:path};
      store(stateKey,next);
      return {...next.outcome,input:nextInput,previous_input_sha256:identity,
        state_key:stateKey,lease};
    } finally { mailboxSelectionActive=false; }
  }

  async function adoptReviewedInput(selection,kind) {
    if (deliveryCorrection)
      throw new TypeError('Revise the reviewed delivery correction through its original Case Desk preview');
    if (journal.recovered_rate_history)
      throw new TypeError('Preserve this received original provider history with its exact reviewed input');
    const mailbox = kind === 'mailbox', responseFields = kind === 'response_fields';
    if (mailbox && selection?.expected_rate_proof_sha256 !== undefined)
      return adoptReturnedRateMailbox(selection);
    const allowed = mailbox ? ['link_id','expected_input_sha256']
      : responseFields ? ['expected_input_sha256','response_fields','reason']
      : ['expected_input_sha256','subject','body','body_type','native_arguments','native_draft',
        'attachments','attachment_data','document_archives','reason'];
    if (!selection || Object.keys(selection).some(key => !allowed.includes(key)) ||
        selection.expected_input_sha256 !== identity)
      throw new TypeError('Revise this exact original reviewed input SHA-256');
    const selected = mailbox ? mailboxes.find(item => item.link_id === selection.link_id) : sender;
    if (!selected) throw new TypeError('Select the original business or secondary mailbox');
    if (!mailbox && (typeof selection.reason !== 'string' || !selection.reason.trim() ||
        selection.reason.length > 2000))
      throw new TypeError('Describe the concrete reviewed document or message correction');
    if (publicCalls || mailboxSelectionActive || accountBoundary || activeAccountAttempt || activeRateContinuation)
      throw new TypeError('Finish the current original contact operation before revising its input');
    if (journal.console_handoff)
      throw new TypeError('Revise this contact through its original Case Desk preview and handoff');
    if (responseFields) {
      if (!nativeArguments || nativeDraft ||
          typeof modules.gateway.assertNativeResponseFields !== 'function')
        throw new TypeError('The complete original native-envelope response selection is required');
      modules.gateway.assertNativeResponseFields({response_fields:selection.response_fields});
      if (!Array.isArray(selection.response_fields) ||
          rateCanonical(selection.response_fields) === rateCanonical(nativeArguments.response_fields))
        throw new TypeError('Supply a corrected explicit native response-field selection');
      if (sendInvocationCount()) receiveArgumentBindingRejection();
    }
    if (sendInvocationCount() || journal.receipt || journal.native_receipt)
      throw new TypeError('The original Gmail invocation keeps its reviewed message and receipt continuation');
    const nextInput = JSON.parse(JSON.stringify(input));
    let nextDraft = nativeDraft;
    if (mailbox) {
      if (nativeDraft && selected.link_id !== sender.link_id)
        throw new TypeError('Keep the original Gmail draft in its original sender account');
      nextInput.link_id = selected.link_id;
    } else if (kind === 'response_fields') {
      nextInput.native_arguments.response_fields = [...selection.response_fields];
    } else {
      const nativeFields = ['body_type','native_arguments','native_draft'];
      const hasNativeSelection = nativeFields.some(field => Object.hasOwn(selection,field));
      if (hasNativeSelection && !nativeArguments)
        throw new TypeError('Keep the original reviewed message route when revising its input');
      if (nativeArguments) {
        const required = nativeDraft ? nativeFields : nativeFields.slice(0,2);
        if (required.some(field => !Object.hasOwn(selection,field)) ||
            !nativeDraft && Object.hasOwn(selection,'native_draft'))
          throw new TypeError('Review the complete original native envelope and current draft identity together');
        for (const field of required) nextInput[field] = frozenJson(selection[field]);
      }
      for (const field of ['subject','body']) if (Object.hasOwn(selection,field)) {
        if (typeof selection[field] !== 'string' || !selection[field].trim() ||
            (field === 'subject' && /[\r\n]/.test(selection[field])))
          throw new TypeError('Complete reviewed subject and body required');
        nextInput[field] = selection[field];
      }
      const manifest = Object.hasOwn(selection,'attachments');
      const bytes = Object.hasOwn(selection,'attachment_data');
      if (manifest !== bytes || manifest &&
          (!Array.isArray(selection.attachments) || !Array.isArray(selection.attachment_data)))
        throw new TypeError('Revise the complete original attachment manifest and bytes together');
      if (manifest) {
        nextInput.attachments = JSON.parse(JSON.stringify(selection.attachments));
        nextInput.attachment_data = JSON.parse(JSON.stringify(selection.attachment_data));
        delete nextInput.document_archives; // Changed bytes need their own inspection.
      }
      if (Object.hasOwn(selection,'document_archives')) {
        if (!Array.isArray(selection.document_archives))
          throw new TypeError('Retain the complete selected ZIP member manifest');
        nextInput.document_archives = frozenJson(selection.document_archives);
      }
    }
    if (!nextInput.attachments?.length && nextInput.attachment_data?.length)
      throw new TypeError('Original selected attachment manifest required');
    if (nativeDraft && !mailbox) {
      if (typeof nativeDraft.revise !== 'function')
        throw new TypeError('Load the maintained complete native draft revision receiver');
      nextDraft = nativeDraft.revise(nextInput);
      if (JSON.stringify(nextDraft.metadata(nextInput.native_draft)) !== JSON.stringify(nextDraft.identity))
        throw new TypeError('Keep the exact reviewed native draft revision');
    }
    // Use the same complete reviewed envelope and property order as construction,
    // checkpoint receiving and retained input history, including native MIME.
    const nextReview = reviewedRuntime(nextInput);
    const nextReviewed = nextReview.reviewed;
    if (nextReviewed.document_archives != null) {
      if (typeof correction?.readContactDocumentArchives !== 'function')
        throw new TypeError('Load the original document-archive review contract for the changed draft');
      correction.readContactDocumentArchives(nextReviewed,{required:true});
    }
    if (modules.intent.fingerprint(nextReviewed).branch !== intent.branch ||
        modules.gateway.recipientClaimPath(nextInput.to).path !== path)
      throw new TypeError('A reviewed revision must retain its original company intent and recipient');
    const nextIdentity = nextReview.identity;
    const prefix = mailbox ? 'MAILBOX_SELECTION' : responseFields ? 'RESPONSE_FIELDS_REVISION' : 'DRAFT_REVISION';
    if (nextIdentity === identity)
      return {status:mailbox ? 'MAILBOX_UNCHANGED' : 'DRAFT_UNCHANGED',
        input:nextInput,input_sha256:identity,sender:{...sender},
        intent_branch:intent.branch,recipient_claim_path:path,state_key:stateKey,lease};

    mailboxSelectionActive = true;
    try {
      const prepared = journal.events.findLast(event =>
        event.phase === 'account-attempt-prepared' && event.operation_key === accountOperationKey);
      const released = prepared && journal.events.slice(journal.events.indexOf(prepared)+1).findLast(event =>
        event.operation_key === accountOperationKey && event.attempt_key === prepared.attempt_key &&
        (event.phase === 'account-attempt-released' &&
          ['RELEASED','ORIGINAL_LEASE_NO_LONGER_ACTIVE'].includes(event.result?.status) ||
         event.phase === 'account-acquisition-release-received' &&
          ['RELEASED','ORIGINAL_LEASE_NO_LONGER_ACTIVE'].includes(event.released?.status)));
      const account = released ? {status:'ACCOUNT_RECONCILED',operation_key:accountOperationKey,
        attempt_key:prepared.attempt_key,release_event:journal.events.indexOf(released)}
        : await reconcileAccountAdmission();
      if (!['NO_RETAINED_ACCOUNT_ATTEMPT','ACCOUNT_RECONCILED'].includes(account?.status))
        return {status:prefix+'_PENDING', account, input_sha256:identity,
          intent_branch:intent.branch, recipient_claim_path:path};

      await verifyActor();
      await verifyMailboxes();
      const census = await together(mailboxes.map(async mailbox => ({
        mailbox:mailbox.email,
        sent_ids:await messageIds(mailbox,'in:sent to:'+recipient,true),
        inbound_ids:await messageIds(mailbox,'in:anywhere from:'+recipient+' -in:sent',true)
      })));
      if (census.some(item => item.sent_ids.length || item.inbound_ids.length))
        return {status:prefix+'_REVIEW', reason:'CURRENT_RECIPIENT_CORRESPONDENCE', census};
      // Receive this exact saved draft before publishing the revised journal.
      // The sole-draft organization exemption must use the new message ID too.
      const draftReceived = nextDraft ? await receiveDraftSelection(nextDraft,nextIdentity) : null;
      const nextSpec = {...nextReviewed,recipient,recipient_claim_path:path,
        intent_branch:intent.branch,intent_key:intent.key};
      const relationship = await adapters.beforeSend(nextSpec,
        {reviewed:nextReviewed,nativeDraft:nextDraft,identity:nextIdentity});
      if (relationship?.can_contact !== true)
        return {status:prefix+'_REVIEW',reason:'CURRENT_RELATIONSHIP',relationship};

      let reservation = preparedAccountReservation();
      // A completed native preflight can retain its original won reservation
      // without an account-deferred marker. Receive its full original creation,
      // no-send boundary and exact recipient postimage before revising that input.
      if (!reservation && journal.events.some(event => event.phase === 'invoking' &&
          event.binding === 'mcp__codex_apps__github_create_branch' && event.args?.branch_name === intent.branch))
        reservation = await receiveRecipientReadback(recipientContinuation());
      if (!reservation && journal.prepared_account_reservation)
        throw new TypeError('Receive the original prepared recipient reservation before revising its reviewed input');
      const [remoteIntent,remoteRecipient] = await together([adapters.readIntent(spec),readClaim(spec)]);
      if (reservation) {
        if (!remoteIntent.exists || remoteIntent.branch !== intent.branch ||
            remoteIntent.ref_sha !== reservation.intent_ref_sha ||
            (reservation.recipient_pending === true ? remoteRecipient !== null :
              remoteRecipient?.record.status !== 'reserved' ||
              remoteRecipient.record.case !== reviewed.opportunity_id || remoteRecipient.record.lease !== lease))
          throw new TypeError('Receive the original intent and recipient reservation before revising its reviewed input');
      } else if (remoteIntent.exists || remoteRecipient !== null) {
        return {status:prefix+'_REVIEW',reason:'EXISTING_ORIGINAL_RESERVATION',
          intent_branch:intent.branch,recipient_claim_path:path};
      }
      assertCurrentReview();
      if (sendInvocationCount() || accountBoundary || activeAccountAttempt)
        throw new TypeError('Finish the original provider operation before revising its reviewed input');

      if (typeof originalMailboxAdmission().withdraw==='function')
        await withdrawOriginalAccountWait('ORIGINAL_INPUT_REVISED',{required:true,force:true});
      const at = new Date().toISOString();
      const selectionRecord = {input_sha256:nextIdentity,previous_input_sha256:identity,
        operation_lease:lease,gmail_invocations:0,observed_at:at,
        previous_sender:{...sender},sender:{...selected},revision_kind:kind,
        ...(mailbox ? {} : {reason:selection.reason.trim()}),
        ...(draftReceived ? {previous_native_draft:frozenJson(nativeDraft.identity),
          native_draft:frozenJson(nextDraft.identity),
          native_arguments_sha256:draftReceived.native_arguments_sha256} : {}),
        intent_branch:intent.branch,recipient_claim_path:path,
        ...(reservation ? {reservation:JSON.parse(JSON.stringify(reservation))} : {})};
      const next = JSON.parse(JSON.stringify(journal));
      next.input_revisions = [...(next.input_revisions || []),{
        input_sha256:identity,input:JSON.parse(JSON.stringify(reviewed)),
        runtime_input:JSON.parse(JSON.stringify(input)),selected_until:at,
        outcome:next.outcome,account_deferred:next.account_deferred || null,
        mailbox_selection:next.mailbox_selection || null,
        reviewed_revision:next.reviewed_revision || null,
        draft_revision:next.draft_revision || null,
        prepared_account_reservation:next.prepared_account_reservation || null
      }];
      next.input = nextReviewed; next.input_sha256 = nextIdentity;
      next.runtime_input = JSON.parse(JSON.stringify(nextInput));
      if (draftReceived) next.reviewed_native_draft = draftReceived;
      delete next.account_deferred;
      next.reviewed_revision = selectionRecord;
      if (mailbox) next.mailbox_selection = selectionRecord;
      else next.draft_revision = selectionRecord;
      if (reservation) next.prepared_account_reservation = {
        input_sha256:nextIdentity,intent_branch:intent.branch,recipient_claim_path:path,
        operation_lease:lease,intent_ref_sha:reservation.intent_ref_sha,
        ...(reservation.recipient_pending === true ? {recipient_pending:true} : {lease})
      };
      next.events.push({phase:mailbox ? 'mailbox-selected' : 'draft-revised',observed_at:at,...selectionRecord,
        account_reconciliation:account});
      next.outcome = {status:mailbox ? 'MAILBOX_SELECTED' : 'DRAFT_REVISED',input_sha256:nextIdentity,
        sender:{...selected},intent_branch:intent.branch,recipient_claim_path:path};
      // Publish one complete reviewed revision. Its old handle becomes stale.
      store(stateKey,next);
      return {...next.outcome,input:nextInput,previous_input_sha256:identity,state_key:stateKey,lease};
    } finally { mailboxSelectionActive = false; }
  }

  const adoptMailbox = selection => adoptReviewedInput(selection,'mailbox');
  const reviseDraft = selection => adoptReviewedInput(selection,'draft');

  const spec = {...reviewed, recipient, recipient_claim_path: path, intent_branch: intent.branch, intent_key: intent.key};
  async function receiveDraftSelection(selectedDraft, selectedIdentity) {
    if (!selectedDraft) throw new TypeError('This contact uses the original direct-message route');
    const received = await selectedDraft.receive({
      listDrafts:args=>invoke('mcp__codex_apps__gmail_list_drafts',args),
      readEmail:args=>invoke('mcp__codex_apps__gmail_read_email',args)
    });
    if (selectedIdentity === identity) journal.reviewed_native_draft = received;
    store(stateKey,journal);
    record({phase:'original-draft-received',draft:selectedDraft.identity,
      input_sha256:selectedIdentity,
      body_sha256:received.body_sha256,
      attachment_manifest:received.attachment_manifest,
      native_arguments_sha256:received.native_arguments_sha256});
    return received;
  }
  const receiveReviewedDraft = () => receiveDraftSelection(nativeDraft,identity);
  async function prepareReviewedDraft() {
    if (sendInvocationCount() || journal.receipt)
      throw new TypeError('Receive the original send result before preparing another draft attempt');
    const received = await receiveReviewedDraft();
    await verifyActor();
    const attemptKey = modules.sha256Utf8(JSON.stringify({
      operation_key:accountOperationKey,phase:'draft-prepare',draft:nativeDraft.identity
    })).sha256;
    const usage = await originalMailboxAdmission().prepareUsage({operation_key:accountOperationKey});
    const account = ['AUTOMATION_USAGE_REFRESHING','AUTOMATION_USAGE_REQUIRED'].includes(usage?.status)
      ? usage : await originalMailboxAdmission().acquire({
        operation_key:accountOperationKey,attempt_key:attemptKey,operation_lease:lease
      });
    record({phase:'original-draft-account-prepared',draft:nativeDraft.identity,
      operation_key:accountOperationKey,account});
    let released = null;
    if (account.status === 'ACQUIRED') {
      released = await originalMailboxAdmission().release(account.lease,{outcome:'PREPARED_WITHOUT_SEND'});
      record({phase:'original-draft-preparation-released',account:released});
    }
    return {status:account.status === 'ACQUIRED' ? 'DRAFT_PREPARED' : 'DRAFT_ACCOUNT_WAITING',
      draft:nativeDraft.identity,native_send_binding:nativeSendBinding,
      body_sha256:received.body_sha256,attachments:received.attachment_manifest,
      input_sha256:identity,operation_key:accountOperationKey,operation_lease:lease,
      account,release:released};
  }
  // Receive an authorized ordinary contact completed by its original provider
  // operation. This is Gmail readback, independent of Git intent publication.
  // Retain the original reviewed input/lease and all earlier journal events.
  function retainedSentReceiving() {
    const current = load(stateKey);
    if (rateCanonical(current?.sent_receiving ?? null) !== rateCanonical(journal.sent_receiving ?? null))
      throw new TypeError('Reopen the original completed contact receiving checkpoint');
    const selected = journal.sent_receiving;
    if (!selected) return null;
    if (selected.schema !== 'commons.original-contact-sent-receiving/v1'
      || selected.input_sha256 !== identity || selected.operation_lease !== lease
      || typeof selected.message_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(selected.message_id))
      throw new TypeError('Retain the original completed contact receiving identity');
    return selected;
  }
  async function receiveSent(messageId) {
    if (nativeDraft || deliveryCorrection || journal.console_handoff)
      throw new TypeError('Use the original draft, correction or console receiving path');
    if (typeof messageId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(messageId))
      throw new TypeError('Original completed Gmail message ID required');
    if (publicCalls || mailboxSelectionActive || accountBoundary || activeAccountAttempt || activeRateContinuation)
      throw new TypeError('Finish the active original contact operation before receiving its completed message');
    if (sendInvocationCount())
      throw new TypeError('Receive the retained original send invocation through its existing reconciliation');
    const pending = retainedSentReceiving();
    if (pending && pending.message_id !== messageId
      || journal.receipt && journal.receipt.message_id !== messageId
      || journal.outcome?.status === 'SENT_VERIFIED' && journal.outcome.message_id !== messageId)
      throw new TypeError('The original contact already retains a different completed Gmail message');
    if (journal.outcome?.status === 'SENT_VERIFIED') return journal.outcome;
    if (!pending) {
      journal.sent_receiving = {schema:'commons.original-contact-sent-receiving/v1',
        message_id:messageId,input_sha256:identity,operation_lease:lease};
      record({phase:'original-contact-sent-receiving',...journal.sent_receiving});
    }
    await verifyMailboxes();
    await readMatchingSent(messageId, {exactEnvelope:true});
    const receiptSha = modules.sha256Utf8(rateCanonical(journal.receipt)).sha256;
    record({phase:'original-contact-sent-received',source:'EXTERNALLY_COMPLETED_ORIGINAL_CONTACT',
      message_id:messageId,input_sha256:identity,operation_key:accountOperationKey,
      operation_lease:lease,receipt_sha256:receiptSha});
    return retainOutcome({status:'SENT_VERIFIED',message_id:messageId,
      intent_branch:intent.branch,recipient_claim_path:path,
      completion:'PROVIDER_RECEIPT_RECORDED',source:'EXTERNALLY_COMPLETED_ORIGINAL_CONTACT',
      receipt_sha256:receiptSha});
  }
  async function receiveCompletedDraft(messageId) {
    if (!nativeDraft)
      throw new TypeError('Open the original saved Gmail draft through its maintained receiver');
    if (typeof messageId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(messageId))
      throw new TypeError('Original completed Gmail message ID required');
    if (publicCalls || mailboxSelectionActive || accountBoundary || activeAccountAttempt || activeRateContinuation)
      throw new TypeError('Finish the active original contact operation before receiving its completed draft');
    if (sendInvocationCount())
      throw new TypeError('Receive the retained original send invocation through its existing reconciliation');
    if (journal.receipt && journal.receipt.message_id !== messageId
      || journal.outcome?.status === 'SENT_VERIFIED' && journal.outcome.message_id !== messageId)
      throw new TypeError('The original contact already retains a different completed Gmail message');
    const received = journal.reviewed_native_draft;
    const draft = nativeDraft.identity;
    const argumentsSha = modules.sha256Utf8(JSON.stringify(nativeDraft.nativeArguments)).sha256;
    const bodySha = modules.sha256Utf8(reviewed.body).sha256;
    const sameDraft = value => value
      && rateCanonical(nativeDraft.metadata(value)) === rateCanonical(draft);
    if (!received || received.schema !== 'commons.reviewed-original-draft/v1'
      || !sameDraft({draft_id:received.draft_id,message_id:received.message_id,thread_id:received.thread_id})
      || received.link_id !== sender.link_id
      || received.native_arguments_sha256 !== argumentsSha || received.body_sha256 !== bodySha
      || rateCanonical(received.attachment_manifest) !== rateCanonical(nativeDraft.prepared.attachments))
      throw new TypeError('The complete original reviewed draft must already be retained in this checkpoint');
    const prepared = journal.events.findLast(event => event.phase === 'original-draft-received');
    if (!prepared || !sameDraft(prepared.draft)
      || prepared.native_arguments_sha256 !== argumentsSha || prepared.body_sha256 !== bodySha
      || rateCanonical(prepared.attachment_manifest) !== rateCanonical(received.attachment_manifest))
      throw new TypeError('The retained original draft receiving event does not match this reviewed input');
    if (journal.outcome?.status === 'SENT_VERIFIED') return journal.outcome;
    await verifyActor();
    await verifyMailboxes();
    await readMatchingSent(messageId);
    const receiptSha = modules.sha256Utf8(rateCanonical(journal.receipt)).sha256;
    record({phase:'original-draft-sent-received',source:'EXTERNALLY_COMPLETED_ORIGINAL_DRAFT',
      draft:frozenJson(draft),message_id:messageId,input_sha256:identity,
      operation_key:accountOperationKey,operation_lease:lease,
      reviewed_draft_observed_at:received.observed_at,receipt_sha256:receiptSha});
    return retainOutcome({status:'SENT_VERIFIED',message_id:messageId,
      completion:'PROVIDER_RECEIPT_RECORDED',source:'EXTERNALLY_COMPLETED_ORIGINAL_DRAFT',
      original_draft:frozenJson(draft),receipt_sha256:receiptSha});
  }
  function deliveryNoticeModule() {
    const notices=modules.deliveryNotices;
    if (!notices || ['readDeliveryNotice','validateDeliveryNotice','appendDeliveryNotice','deliveryState']
      .some(name=>typeof notices[name]!=='function'))
      throw new TypeError('Load the maintained delivery notice module with this original checkpoint');
    return notices;
  }
  function originalDeliveryReceipt() {
    const receipt=journal.receipt;
    if (journal.outcome?.status!=='SENT_VERIFIED' || !receipt ||
        receipt.message_id!==journal.outcome.message_id ||
        receipt.mailbox?.link_id!==sender.link_id || receipt.mailbox?.profile_id!==sender.id ||
        receipt.mailbox?.email!==sender.email || !receipt.rfc_message_id)
      throw new TypeError('Receive the exact original SENT message before its delivery notices');
    return frozenJson(receipt);
  }
  function deliveryStatus() {
    const notices=deliveryNoticeModule(),rows=journal.delivery_notices || [];
    if (rows.length) {
      const receipt=originalDeliveryReceipt();
      for (const row of rows) {
        notices.validateDeliveryNotice(row);
        if (row.original.message_id!==receipt.message_id || row.original.rfc_message_id!==receipt.rfc_message_id ||
            row.original.recipient!==recipient || row.mailbox.link_id!==sender.link_id ||
            row.mailbox.profile_id!==sender.id || row.mailbox.email!==sender.email)
          throw new TypeError('Saved delivery notices belong to another original contact');
      }
    }
    return journal.outcome?.status==='SENT_VERIFIED' ? notices.deliveryState(rows) : null;
  }
  async function receiveDeliveryNotice(noticeId) {
    const notices=deliveryNoticeModule(),receipt=originalDeliveryReceipt();
    if (typeof noticeId!=='string' || !/^[A-Za-z0-9_-]{1,160}$/.test(noticeId))
      throw new TypeError('Select the original provider delivery notice ID');
    if (publicCalls || activeAccountAttempt || accountBoundary || mailboxSelectionActive)
      throw new TypeError('Finish the current original operation before receiving its delivery notice');
    deliveryStatus();
    const profile=await invoke('mcp__codex_apps__gmail_get_profile',{link_id:sender.link_id});
    if (String(profile.id)!==sender.id || String(profile.email).toLowerCase()!==sender.email)
      throw new TypeError('Original delivery notice mailbox identity changed');
    const [sent,notice]=await together([
      invoke('mcp__codex_apps__gmail_read_email',{link_id:sender.link_id,message_id:receipt.message_id,format:'full'}),
      invoke('mcp__codex_apps__gmail_read_email',{link_id:sender.link_id,message_id:noticeId,format:'full'})
    ]);
    assertCurrentReview();
    if (JSON.stringify(originalDeliveryReceipt())!==JSON.stringify(receipt) || sent?.id!==receipt.message_id ||
        notice?.id!==noticeId)
      throw new TypeError('The original contact receipt changed while receiving its delivery notice');
    const received=notices.readDeliveryNotice({sent,notice,mailbox:receipt.mailbox,recipient});
    if (received.original.thread_id!==receipt.thread_id ||
        received.original.rfc_message_id!==receipt.rfc_message_id || received.original.subject!==reviewed.subject ||
        Number(sent.internal_date ?? sent.internalDate)!==Number(receipt.internal_date))
      throw new TypeError('The provider message differs from its original saved receipt');
    const joined=notices.appendDeliveryNotice(journal.delivery_notices || [],received);
    if (!joined.replayed) {
      journal.delivery_notices=joined.records;
      record({phase:'delivery-notice-received',message_id:receipt.message_id,notice_id:noticeId,
        notice_sha256:joined.record.sha256,notice_source_sha256:joined.record.source_sha256,
        status:notices.deliveryState(joined.records).status});
    }
    return {status:'DELIVERY_NOTICE_RECORDED',replayed:joined.replayed,
      message_id:receipt.message_id,notice_id:noticeId,notice_sha256:joined.record.sha256,
      delivery:deliveryStatus(),send_outcome:frozenJson(journal.outcome)};
  }
  function exportDeliveryNotices() {
    const receipt=originalDeliveryReceipt(),delivery=deliveryStatus();
    const body={schema:'commons.contact-delivery-history/v1',case_id:reviewed.opportunity_id,
      input_sha256:identity,receipt,send_outcome:frozenJson(journal.outcome),
      notices:frozenJson(journal.delivery_notices || []),delivery};
    return {...body,sha256:modules.sha256Utf8(rateCanonical(body)).sha256};
  }
  const api = {
    ...(modules.deliveryNotices ? {receiveDeliveryNotice,deliveryStatus,exportDeliveryNotices} : {}),
    ...(nativeDraft ? {receiveDraft:receiveReviewedDraft,prepareDraft:prepareReviewedDraft,receiveCompletedDraft} : {}),
    plan: () => ({case_id: reviewed.opportunity_id, recipient, input_sha256: identity, sender:{...sender},
      github_actor_binding:{...actorSelection},
      github_ref_binding:{...refSelection},
      ...(nativeDraft ? {native_draft:frozenJson(nativeDraft.identity),native_send_binding:nativeSendBinding} : {}),
      intent_branch: intent.branch, recipient_claim_path: path, state_key: stateKey,
      ...(delivery ? {attachments:delivery.attachments} : {}),
      ...(deliveryCorrection ? {delivery_correction_sha256:correction.deliveryCorrectionDigest(deliveryCorrection),
        original_provider_message_id:deliveryCorrection.failed_attempts.at(-1).outbound_provider_id,
        ...(reviewed.source_links?.length ? {source_links:reviewed.source_links} : {})} : {})}),
    status: () => ({case_id: reviewed.opportunity_id, sender:{...sender}, outcome: connectorRateOutcome(journal.outcome), receipt: journal.receipt || null,
      ...(modules.deliveryNotices ? {delivery:deliveryStatus()} : {}),
      github_actor_binding:{...actorSelection},
      github_ref_binding:{...refSelection},
      native_calls: journal.events.filter(event => event.phase === 'invoking').length,
      send_invocations: sendInvocationCount(),
      ...(journal.recovered_rate_history ? {received_history_sha256:journal.recovered_rate_history.sha256,
        received_historical_invocations:receivedRateHistory().count} : {})}),
    async run() {
      if (journal.console_handoff) throw new TypeError('Resume this original console handoff with resumeConsole');
      if (journal.outcome?.status === 'SENT_VERIFIED') return journal.outcome;
      if (journal.returned_mailbox_revision) return resumeRateLimited();
      if (sendInvocationCount()) {
        return retainOutcome(connectorRateOutcome({status: 'SEND_OUTCOME_UNKNOWN', message_id: journal.receipt?.message_id,
          intent_branch: intent.branch, recipient_claim_path: path, action: 'Read the original Gmail message; continue receipt reconciliation'}));
      }
      await verifyActor();
      return withPreparedAccountBoundary(async () => {
        const reservation = await receivePreparedCorrectionReservation() ||
          await receiveLocalReservation() || await receivePreparedRecipientReservation() || preparedAccountReservation() ||
          await receiveAcknowledgedIntentReadback();
        return modules.gateway.sendFirstContact(reviewed,adapters,
          reservation ? {resumeReservation:reservation} : {});
      });
    },
    adoptMailbox,
    receiveSent,
    receiveLocalPreDispatch,
    reviseDraft,
    reviseReturnedRateDraft:selection=>adoptReturnedRateMailbox(selection,'draft'),
    reviseResponseFields: selection => adoptReviewedInput(selection,'response_fields'),
    receiveCompletedAccountDeferral,
    receiveQueuedReservation,
    receiveCompletedNoSend,
    rateLimitContinuation,
    resumeRateLimited,
    inspectAccountWait,
    accountStatus: (options={}) => originalMailboxAdmission().inspect({...options,operation_key:accountOperationKey}),
    reconcileAccountAdmission,
    intentReadbackContinuation,
    async receiveIntentReadback() {
      if (deliveryCorrection || journal.console_handoff || sendInvocationCount())
        throw new TypeError('Use the original contact delivery receiving');
      const original = intentReadbackContinuation();
      if (!original) {
        const reservation = preparedAccountReservation();
        if (journal.intent_readback_received && reservation?.recipient_pending === true)
          return {status:'INTENT_READBACK_RECEIVED',...journal.intent_readback_received};
        throw new TypeError('Original acknowledged intent readback required');
      }
      await verifyActor();
      await receiveAcknowledgedIntentReadback();
      return {status:'INTENT_READBACK_RECEIVED',...journal.intent_readback_received};
    },
    recipientContinuation: () => recipientContinuation(),
    receiveRecipientCreationAbsence,
    async receiveRecipientReservation() {
      if (deliveryCorrection)
        throw new TypeError('Use the original delivery correction continuation');
      const continuation = recipientContinuation();
      if (continuation.lease !== lease && continuation.recipient_readback_required !== true)
        throw new TypeError('Original acknowledged recipient creation required');
      await verifyActor();
      const received = await receiveRecipientReadback(continuation);
      return {status:'RECIPIENT_RESERVATION_RECEIVED',
        intent_branch:intent.branch,recipient_claim_path:path,input_sha256:identity,
        intent_ref_sha:received.intent_ref_sha,lease,
        recipient_creation_event:received.recipient_creation_event,
        recipient_write_event:received.recipient_write_event,
        recipient_readback_event:received.recipient_readback_event,
        gmail_invocations:sendInvocationCount()};
    },
    async resumeConsole(packet) {
      const data = consoleHandoff(packet);
      if (journal.console_handoff && journal.console_handoff.sha256 !== packet.sha256)
        throw new TypeError('Original console handoff changed');
      if (!journal.console_handoff) {
        if (journal.events.length) throw new TypeError('Use the original console handoff with its unused retained native state');
        journal.console_handoff = packet; store(stateKey,journal);
      }
      if (journal.outcome?.status === 'SENT_VERIFIED') return journal.outcome;
      if (sendInvocationCount())
        return retainOutcome({status:'SEND_OUTCOME_UNKNOWN',message_id:journal.receipt?.message_id,
          intent_branch:intent.branch,recipient_claim_path:path,action:'Read and reconcile the original Gmail message'});
      const continuing = journal.events.length > 0;
      await verifyActor();
      const reservation = continuing ? await resumedConsoleReservation(data) : data.reservation;
      record({phase:'console-continuation',handoff_sha256:packet.sha256,
        draft_id:data.draft_id,operation_id:data.operation_id,reservation});
      rememberPreparedAccountReservation(reservation);
      return withPreparedAccountBoundary(() =>
        modules.gateway.sendFirstContact(reviewed,adapters,{resumeReservation:reservation}));
    },
    async resumeRecipient() {
      if (journal.outcome?.status === 'SENT_VERIFIED') return journal.outcome;
      await verifyActor();
      const retained = await receivePreparedCorrectionReservation() ||
        await receiveLocalReservation() || await receivePreparedRecipientReservation() || preparedAccountReservation();
      const continuation = retained || await receiveRecipientReadback(recipientContinuation());
      record({phase:'recipient-continuation',continuation});
      const reservation = retained || {intent_ref_sha:continuation.intent_ref_sha,
        ...(continuation.lease === lease ? {lease} : {recipient_pending:true})};
      rememberPreparedAccountReservation(reservation);
      return withPreparedAccountBoundary(() =>
        modules.gateway.sendFirstContact(reviewed,adapters,{resumeReservation:reservation}));
    },
    async reconcile(messageId) {
      await verifyActor();
      await verifyMailboxes();
      const [remoteIntent, before] = await together([adapters.readIntent(spec), readClaim(spec)]);
      if (!remoteIntent.exists || remoteIntent.branch !== intent.branch || before?.record.case !== reviewed.opportunity_id ||
          before.record.lease !== lease || !['reserved', 'sent'].includes(before.record.status)) throw new TypeError('Original reservation required for reconciliation');
      if (before.record.status === 'sent' && before.record.provider_message_id !== messageId) throw new TypeError('Original recorded Gmail ID differs');
      await readMatchingSent(messageId);
      const completion = before.record.status === 'sent' ? 'RECORDED'
        : (await adapters.completeRecipient(spec, lease, messageId)).status === 'SENT_RECORDED' ? 'RECORDED' : 'RECONCILE';
      return retainOutcome({status: 'SENT_VERIFIED', message_id: messageId,
        intent_branch: intent.branch, recipient_claim_path: path, completion});
    }
  };
  return Object.freeze(Object.fromEntries(Object.entries(api).map(([name,fn]) => [name,(...args) => {
    assertCurrentReview();
    if (mailboxSelectionActive) throw new TypeError('Finish the explicit reviewed input revision before continuing this contact');
    const receiving = retainedSentReceiving();
    if (receiving && journal.outcome?.status !== 'SENT_VERIFIED' &&
        !['plan','status','receiveSent'].includes(name))
      throw new TypeError('Receive the retained completed Gmail message before continuing this original contact');
    const result = fn(...args);
    if (!result || typeof result.then !== 'function') return result;
    publicCalls++;
    return result.finally(() => { publicCalls--; });
  }])));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {loadOriginalContactModules, createConnectedFirstContact, classifyReturnedArgumentBindingRejection, classifyReturnedGmailRateLimit, classifyReturnedGmailHttpRateLimit, classifyReturnedConnectorRateLimit, classifyReturnedSendRateLimit, selectConnectedGitActor, selectConnectedGitRef, inspectOriginalOrganizationMessage};
}
