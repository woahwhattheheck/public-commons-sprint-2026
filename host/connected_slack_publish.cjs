'use strict';

// Native Slack bindings; file bodies use Slack's returned upload URL.
// No credential management or automatic retry.
// Known credential spans are replaced before native sends/edits.
class SlackPublishError extends Error {
  constructor(message, progress, cause) {
    super(message);
    this.name = 'SlackPublishError';
    this.progress = progress;
    this.cause = cause;
  }
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(label + ' must be an object');
  }
  return value;
}

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(label + ' is required');
  return value;
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d+\.\d+$/.test(value)) {
    throw new TypeError(label + ' must be the observed Slack timestamp string');
  }
  return value;
}

const RESULT_DESTINATION_SCHEMA = 'commons.connected_slack_result_destination/v1';

function slackReaderFunction(name, options) {
  const implementation = options[name] ?? (typeof require === 'function'
    ? require('./connected_slack_pages.cjs')[name] : undefined);
  if (typeof implementation !== 'function') {
    throw new TypeError(name + ' from connected_slack_pages.cjs is required');
  }
  return implementation;
}

/** Copy a retained operation route without resolving its source message again. */
function retainedSlackResultDestination(destination) {
  object(destination, 'result destination');
  const fields = ['schema', 'operation_id', 'channel_id', 'source_message_ts',
    'parent_thread_ts', 'resolution_basis'];
  for (const key of Object.keys(destination)) {
    if (!fields.includes(key)) throw new TypeError('Unsupported result destination field: ' + key);
  }
  if (destination.schema !== RESULT_DESTINATION_SCHEMA) {
    throw new TypeError('Unsupported result destination schema');
  }
  text(destination.operation_id, 'destination operation_id');
  if (typeof destination.channel_id !== 'string'
      || !/^[CGD][A-Z0-9]{1,127}$/.test(destination.channel_id)) {
    throw new TypeError('Result destination requires the original channel ID');
  }
  const stamp = /^[0-9]{1,16}\.[0-9]{1,16}$/;
  const value = timestamp => {
    const [seconds, fraction] = timestamp.split('.');
    return BigInt(seconds) * 10000000000000000n + BigInt(fraction.padEnd(16, '0'));
  };
  if (typeof destination.source_message_ts !== 'string'
      || typeof destination.parent_thread_ts !== 'string'
      || !stamp.test(destination.source_message_ts)
      || !stamp.test(destination.parent_thread_ts)
      || value(destination.parent_thread_ts) > value(destination.source_message_ts)) {
    throw new TypeError('Result destination requires exact source and parent timestamp strings');
  }
  if (!['native_permalink', 'rendered_thread_reply'].includes(destination.resolution_basis)) {
    throw new TypeError('Result destination requires the resolved original request parent');
  }
  return Object.freeze(Object.fromEntries(fields.map(key => [key, destination[key]])));
}

/** Resolve one observed source reference and retain the route with its existing operation. */
function prepareSlackResultDestination(request, options = {}) {
  object(request, 'result destination request');
  object(options, 'result destination options');
  for (const key of Object.keys(request)) {
    if (!['operation_id', 'source_message'].includes(key)) {
      throw new TypeError('Unsupported result destination request field: ' + key);
    }
  }
  const operationId = text(request.operation_id, 'operation_id');
  const resolve = slackReaderFunction('projectSlackThreadReference', options);
  const reference = resolve(object(request.source_message, 'source_message'));
  if (reference.canonical_parent !== true) {
    throw new TypeError('Source reference needs its native permalink parent or rendered reply parent');
  }
  return retainedSlackResultDestination({
    schema: RESULT_DESTINATION_SCHEMA, operation_id: operationId,
    channel_id: reference.channel_id, source_message_ts: reference.message_ts,
    parent_thread_ts: reference.parent_message_ts, resolution_basis: reference.basis,
  });
}


/** Resolve a source without sending, then retain its route with the operation. */
async function resolveSlackResultDestination(tools, request, options = {}) {
  object(request, 'result destination request');
  object(options, 'result destination options');
  for (const key of Object.keys(request)) {
    if (!['operation_id', 'source_message'].includes(key)) {
      throw new TypeError('Unsupported result destination request field: ' + key);
    }
  }
  const operationId = text(request.operation_id, 'operation_id');
  const source = object(request.source_message, 'source_message');
  const resolve = slackReaderFunction('resolveSlackThreadReference', options);
  const resolution = await resolve(tools, source,
    object(options.resolution ?? {}, 'result destination resolution options'));
  if (resolution.status !== 'RESOLVED') return {result_destination: null, resolution};
  const reference = object(resolution.reference, 'resolved thread reference');
  if (reference.canonical_parent !== true || reference.channel_id !== source.channel_id
      || reference.message_ts !== source.message_ts) {
    throw new TypeError('Resolved parent must belong to the original source message');
  }
  const destination = retainedSlackResultDestination({
    schema: RESULT_DESTINATION_SCHEMA, operation_id: operationId,
    channel_id: reference.channel_id, source_message_ts: reference.message_ts,
    parent_thread_ts: reference.parent_message_ts, resolution_basis: reference.basis,
  });
  return {result_destination: destination, resolution};
}

function requestResultDestination(request) {
  if (request.destination === undefined) return undefined;
  const destination = retainedSlackResultDestination(request.destination);
  if (request.channel_id !== undefined && request.channel_id !== destination.channel_id) {
    throw new TypeError('channel_id differs from the retained result destination');
  }
  if (request.thread_ts !== undefined && request.thread_ts !== destination.parent_thread_ts) {
    throw new TypeError('thread_ts differs from the retained result destination');
  }
  return destination;
}

/** Read original completions through the existing collector before continuing the operation. */
async function readSlackResultThread(tools, destination, request = {}, options = {}) {
  object(request, 'result thread request');
  object(options, 'result thread options');
  for (const key of Object.keys(request)) {
    if (!['args', 'max_pages', 'timeout_ms'].includes(key)) {
      throw new TypeError('Unsupported result thread request field: ' + key);
    }
  }
  const args = {...object(request.args ?? {}, 'result thread args')};
  if (options.onResponse !== undefined && typeof options.onResponse !== 'function') {
    throw new TypeError('onResponse must be a function');
  }
  let retained, resolution;
  if (destination?.schema === RESULT_DESTINATION_SCHEMA) {
    retained = retainedSlackResultDestination(destination);
  } else {
    const prepared = await resolveSlackResultDestination(tools, destination, options);
    resolution = prepared.resolution;
    if (!prepared.result_destination) {
      return {result_destination: null, resolution, collection: null};
    }
    retained = prepared.result_destination;
  }
  if (args.channel_id !== undefined && args.channel_id !== retained.channel_id
      || args.message_ts !== undefined && args.message_ts !== retained.parent_thread_ts) {
    throw new TypeError('Result thread read differs from the retained operation destination');
  }
  args.channel_id = retained.channel_id;
  args.message_ts = retained.parent_thread_ts;
  const collect = slackReaderFunction('collectSlackPages', options);
  const collection = await collect(tools, {operation: 'read_thread', args,
    ...(request.max_pages === undefined ? {} : {max_pages: request.max_pages}),
    ...(request.timeout_ms === undefined ? {} : {timeout_ms: request.timeout_ms}),
  }, options.onResponse ? {
    onResponse: event => options.onResponse({...event, result_destination: retained}),
  } : {});
  // Keep the collector's requests, native captures and continuation cursor intact.
  return {result_destination: retained, ...(resolution ? {resolution} : {}), collection};
}

/** Pure credential-span scrubber; categories are not verified vault inventory refs. */
function redactOutboundSecretText(value) {
  if (typeof value !== 'string' || !value) return value;
  let body = value;
  body = body.replace(/-----BEGIN ((?:(?:RSA|EC|OPENSSH|ENCRYPTED) )?PRIVATE KEY)-----[\s\S]*?-----END \1-----/g,
    'vault:keys/private-key');
  const replacements = [
    [/\b(?:github_pat_[A-Za-z0-9_]{30,}|gh[pousr]_[A-Za-z0-9]{30,})\b/g, 'vault:github/pat'],
    [/\b(?:xox[bposar]-[A-Za-z0-9-]{20,}|xapp-\d+-[A-Za-z0-9-]{20,})\b/g, 'vault:slack/token'],
    [/\bsk-(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]{32,}\b/g, 'vault:openai/api-key'],
    [/\bAIza[A-Za-z0-9_-]{35}\b/g, 'vault:google/api-key'],
    [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, 'vault:aws/access-key-id'],
  ];
  for (const [pattern, marker] of replacements) body = body.replace(pattern, marker);
  body = body.replace(/(\bAuthorization\s*:\s*Bearer\s+)([A-Za-z0-9~._+/=-]{24,})/gi,
    (_, prefix) => prefix + 'vault:generic/bearer');
  body = body.replace(/(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["']?)([A-Za-z0-9._~+/=-]{28,})/gi,
    (_, prefix) => prefix + 'vault:generic/config-secret');
  return body.replace(/https?:\/\/[^\s<>"'`]+/gi, url =>
    /oauth|callback|redirect/i.test(url)
      ? url.replace(/([?&](?:code|access_token|id_token|refresh_token)=)([A-Za-z0-9%._~+/=-]{20,})/gi,
          (_, prefix) => prefix + 'vault:oauth/authorization-code')
      : url);
}

function unpack(result, action) {
  object(result, action + ' response');
  if (result.isError === true) throw new Error(action + ' returned a native tool error');
  if (result.structuredContent && typeof result.structuredContent === 'object'
      && !Array.isArray(result.structuredContent)) return result.structuredContent;
  for (const block of result.content ?? []) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue;
    try { return object(JSON.parse(block.text), action + ' payload'); }
    catch (_) { /* Try the next native text block. */ }
  }
  throw new Error(action + ' did not return a readable native acknowledgement');
}


function readbackBinding(tools, options) {
  const name = options.bindings?.readback ?? 'mcp__codex_apps__slack_slack_read_thread';
  if (typeof tools?.[name] !== 'function') {
    throw new Error('Binding not present: ' + name
      + '. Repeat discovery alongside useful work.');
  }
  return name;
}

function readbackArguments(progress, options) {
  const channel = text(progress.channel_id, 'confirmed channel_id');
  const target = timestamp(progress.message_id, 'confirmed message_id');
  const destination = progress.result_destination === undefined ? undefined
    : retainedSlackResultDestination(progress.result_destination);
  const parent = timestamp(options.readback_thread_ts ?? progress.readback_thread_ts
    ?? progress.thread_ts ?? destination?.parent_thread_ts ?? target, 'readback thread timestamp');
  if (destination && (channel !== destination.channel_id
      || parent !== destination.parent_thread_ts
      || progress.thread_ts !== undefined && progress.thread_ts !== destination.parent_thread_ts
      || progress.readback_thread_ts !== undefined
        && progress.readback_thread_ts !== destination.parent_thread_ts)) {
    throw new TypeError('Readback differs from the retained result destination');
  }
  const args = {channel_id: channel, message_ts: parent, limit: 1};
  if (parent !== target) {
    // Read only the selected reply's timestamp window, not the surrounding feed.
    const [seconds, fractional] = target.split('.');
    const precision = Math.max(6, fractional.length);
    const ticks = BigInt(seconds + fractional.padEnd(precision, '0'));
    const format = value => {
      const digits = String(value).padStart(precision + 1, '0');
      return digits.slice(0, -precision) + '.' + digits.slice(-precision);
    };
    args.oldest = format(ticks > 0n ? ticks - 1n : 0n);
    args.latest = format(ticks + 1n);
  }
  return args;
}

/** Capture one native read for a confirmed edit; never repeat its send or edit. */
async function readSlackPublication(tools, published, options = {}) {
  const progress = {status: 'incomplete', stage: 'validate_readback',
    message_state: 'not_selected', calls: {}, readback_status: 'not_performed',
    progress_callback_errors: 0};
  let lastResponse;
  let announce = async () => {};
  try {
    object(published, 'published progress');
    // Provider bodies stay outside observer metadata, including on continuation.
    for (const key of ['status', 'stage', 'message_state', 'readback_status',
      'progress_callback_errors', 'channel_id', 'message_id', 'message_link',
      'thread_ts', 'readback_thread_ts', 'readback_request',
      'initial_message_chars', 'initial_message_distinct']) {
      if (published[key] !== undefined) progress[key] = published[key];
    }
    if (published.result_destination !== undefined) {
      progress.result_destination = retainedSlackResultDestination(published.result_destination);
    }
    progress.calls = {...object(published.calls ?? {}, 'published call counts')};
    progress.stage = 'validate_readback';
    progress.readback_status = 'not_performed';
    if (progress.message_state !== 'edit_confirmed') {
      throw new TypeError('Readback continuation requires a confirmed edit');
    }
    const observer = options.onProgress;
    if (observer !== undefined && typeof observer !== 'function') {
      throw new TypeError('onProgress must be a function');
    }
    announce = async () => {
      if (!observer) return;
      try { await observer(JSON.parse(JSON.stringify(progress))); }
      catch (_) { progress.progress_callback_errors += 1; }
    };
    const binding = readbackBinding(tools, options);
    const args = readbackArguments(progress, options);
    progress.readback_request = args;
    progress.readback_thread_ts = args.message_ts;
    progress.stage = 'readback';
    progress.readback_status = 'pending';
    await announce();
    progress.calls.readback = (progress.calls.readback ?? 0) + 1;
    lastResponse = await tools[binding](args);
    unpack(lastResponse, 'readback');
    progress.readback_status = 'captured';
    progress.stage = 'complete';
    await announce();
    return {...progress, readback_response: lastResponse};
  } catch (error) {
    if (progress.readback_status === 'pending') progress.readback_status = 'failed';
    await announce();
    const failure = new SlackPublishError(String(error?.message ?? error), progress, error);
    failure.response = lastResponse;
    throw failure;
  }
}

/** Send and restore the caller's exact text, or edit one already-confirmed message. */
async function publishSlackMessage(tools, request, options = {}) {
  const progress = {status: 'incomplete', stage: 'validate', message_state: 'not_attempted',
    calls: {}, readback_status: 'not_performed', progress_callback_errors: 0};
  let lastResponse;
  let announce = async () => {};
  try {
    object(request, 'request');
    const allowed = new Set(['channel_id', 'message', 'message_id', 'thread_ts',
      'reply_broadcast', 'unfurl_app_links', 'destination']);
    for (const key of Object.keys(request)) {
      if (!allowed.has(key)) throw new TypeError('Unsupported request field: ' + key);
    }
    const destination = requestResultDestination(request);
    if (destination) progress.result_destination = destination;
    const channel = text(destination?.channel_id ?? request.channel_id, 'channel_id');
    const message = redactOutboundSecretText(text(request.message, 'message'));
    // Opt-in hygiene measurement: metadata only, no I/O or credential bytes.
    if (message !== request.message) progress.hygiene_scrubbed_messages = 1;
    const editing = request.message_id !== undefined;
    const messageId = editing ? timestamp(request.message_id, 'message_id') : undefined;
    const thread = destination?.parent_thread_ts
      ?? (request.thread_ts === undefined ? undefined : timestamp(request.thread_ts, 'thread_ts'));
    if (editing && request.thread_ts !== undefined) throw new TypeError('thread_ts applies only to a new send');
    // The native creation field has a lower ceiling than markdown_text editing.
    // A retained caller can create one small message, then use the existing
    // exact edit/readback on that returned ID for its complete intended body.
    let initialMessage = message;
    if (options.initial_message !== undefined) {
      if (editing) throw new TypeError('initial_message applies only to a new send');
      initialMessage = redactOutboundSecretText(text(options.initial_message, 'initial_message'));
      if (initialMessage.length > 5000) throw new RangeError('initial_message exceeds the native 5,000-character creation field');
      if (initialMessage !== options.initial_message) progress.hygiene_scrubbed_initial_messages = 1;
      progress.initial_message_chars = initialMessage.length;
      progress.initial_message_distinct = initialMessage !== message;
    }
    const sendOptions = {};
    for (const key of ['reply_broadcast', 'unfurl_app_links']) {
      if (request[key] === undefined) continue;
      if (typeof request[key] !== 'boolean') throw new TypeError(key + ' must be boolean');
      if (editing) throw new TypeError(key + ' applies only to a new send');
      sendOptions[key] = request[key];
    }
    const bindings = {
      send: options.bindings?.send ?? 'mcp__codex_apps__slack_slack_send_message',
      edit: options.bindings?.edit ?? 'mcp__codex_apps__slack_slack_edit_message',
    };
    for (const action of editing ? ['edit'] : ['send', 'edit']) {
      if (typeof tools?.[bindings[action]] !== 'function') {
        throw new Error('Binding not present: ' + bindings[action]
          + '. Repeat discovery alongside useful work.');
      }
    }
    if (options.readback !== undefined && typeof options.readback !== 'boolean') {
      throw new TypeError('readback must be boolean');
    }
    if (options.readback_thread_ts !== undefined) {
      timestamp(options.readback_thread_ts, 'readback_thread_ts');
      if (thread !== undefined && options.readback_thread_ts !== thread) {
        throw new TypeError('readback_thread_ts differs from the new message thread');
      }
    }
    if (options.readback === true) readbackBinding(tools, options);
    const observer = options.onProgress;
    if (observer !== undefined && typeof observer !== 'function') throw new TypeError('onProgress must be a function');
    announce = async () => {
      if (!observer) return;
      try { await observer(JSON.parse(JSON.stringify(progress))); }
      catch (_) { progress.progress_callback_errors += 1; }
    };
    const call = async (action, args) => {
      progress.calls[action] = (progress.calls[action] ?? 0) + 1;
      lastResponse = undefined;
      lastResponse = await tools[bindings[action]](args);
      return unpack(lastResponse, action);
    };
    progress.channel_id = channel;
    if (thread !== undefined) progress.thread_ts = thread;
    if (editing) {
      progress.message_id = messageId;
      progress.message_state = 'existing_message_selected';
    } else {
      progress.stage = 'send';
      progress.message_state = 'send_outcome_unknown';
      await announce();
      const sent = await call('send', {channel_id: channel, message: initialMessage,
        ...(thread === undefined ? {} : {thread_ts: thread}), ...sendOptions});
      const context = object(sent.message_context, 'send message_context');
      progress.channel_id = text(context.channel_id, 'returned channel_id');
      progress.message_id = timestamp(context.message_ts, 'returned message_ts');
      if (typeof sent.message_link === 'string') progress.message_link = sent.message_link;
      progress.message_state = 'sent';
      await announce();
      if (destination && progress.channel_id !== destination.channel_id) {
        throw new Error('Send acknowledgement channel differs from the retained result destination');
      }
    }
    progress.stage = 'edit';
    progress.message_state = 'edit_outcome_unknown';
    await announce();
    const edited = await call('edit', {channel_id: progress.channel_id,
      message_id: progress.message_id, message: {markdown_text: message}});
    if (edited.message_id !== progress.message_id) {
      throw new Error('Edit acknowledgement did not identify the selected message');
    }
    progress.message_state = 'edit_confirmed';
    progress.status = 'updated';
    if (options.readback === true) return await readSlackPublication(tools, progress, options);
    progress.stage = 'complete';
    await announce();
    return progress;
  } catch (error) {
    if (error instanceof SlackPublishError) throw error;
    await announce();
    const failure = new SlackPublishError(String(error?.message ?? error), progress, error);
    failure.response = lastResponse;
    throw failure;
  }
}


/** Select the existing bounded native rendering without changing body characters. */
function selectSlackPublicationBody(published, result) {
  const refuse = reason => ({failure: {...result, reason}});
  if (published.message_state !== 'edit_confirmed' || published.readback_status !== 'captured') {
    return refuse('confirmed_edit_and_capture_required');
  }
  let args;
  try {
    args = readbackArguments(published, {});
    object(published.readback_request, 'retained readback request');
  } catch (_) {
    return refuse('missing_readback_identity');
  }
  result.channel_id = args.channel_id;
  result.message_id = published.message_id;
  result.parent_message_id = args.message_ts;
  const request = published.readback_request;
  if (Object.keys(request).length !== Object.keys(args).length
      || Object.keys(args).some(key => request[key] !== args[key])
      || (published.thread_ts !== undefined && published.thread_ts !== args.message_ts)) {
    return refuse('readback_request_identity_mismatch');
  }

  // Do not choose the first readable object when provider representations conflict.
  const response = published.readback_response;
  if (!response || typeof response !== 'object' || Array.isArray(response)
      || response.isError === true) return refuse('readback_response_unavailable');
  const payloads = [];
  if (response.structuredContent !== undefined) payloads.push(response.structuredContent);
  if (response.content !== undefined) {
    if (!Array.isArray(response.content)) return refuse('unrecognized_readback_payload');
    for (const block of response.content) {
      if (block?.type !== 'text' || typeof block.text !== 'string') {
        return refuse('unrecognized_readback_payload');
      }
      try { payloads.push(JSON.parse(block.text)); }
      catch (_) { return refuse('unrecognized_readback_payload'); }
    }
  }
  if (!payloads.length || payloads.some(payload => !payload || typeof payload !== 'object'
      || Array.isArray(payload) || typeof payload.messages !== 'string'
      || typeof payload.pagination_info !== 'string'
      || Object.keys(payload).some(key => !['messages', 'pagination_info'].includes(key)))) {
    return refuse('unrecognized_readback_payload');
  }
  const representations = new Set(payloads.map(payload =>
    JSON.stringify([payload.messages, payload.pagination_info])));
  if (representations.size !== 1) return refuse('conflicting_readback_payloads');

  const rendered = payloads[0].messages;
  const parent = /^=== THREAD PARENT MESSAGE ===\nFrom: [^\r\n]+\nTime: [^\r\n]+\nMessage TS: (\d+\.\d+)\n/.exec(rendered);
  if (!parent || parent[1] !== args.message_ts) return refuse('unrecognized_parent_framing');
  const tail = rendered.slice(parent[0].length);
  const noReplies = '\n\nNo thread messsages\n';
  const separator = '\n\n=== THREAD REPLIES (1 total) ===\n\n--- Reply 1 of 1 ---\n';
  const records = [];
  if (tail.endsWith(noReplies)) {
    if (tail.includes(separator)) return refuse('ambiguous_message_framing');
    records.push({id: parent[1], body: tail.slice(0, -noReplies.length)});
  } else {
    const parts = tail.split(separator);
    if (parts.length !== 2) return refuse('unrecognized_reply_framing');
    const reply = /^From: [^\r\n]+\nTime: [^\r\n]+\nMessage TS: (\d+\.\d+)\n([\s\S]*)\n$/.exec(parts[1]);
    if (!reply) return refuse('unrecognized_reply_framing');
    records.push({id: parent[1], body: parts[0]}, {id: reply[1], body: reply[2]});
  }
  const marker = /^(?:=== THREAD |--- Reply |Message TS: |No thread messsages$)/m;
  if (records.some(record => marker.test(record.body))
      || new Set(records.map(record => record.id)).size !== records.length) {
    return refuse('ambiguous_message_framing');
  }
  const selected = records.filter(record => record.id === published.message_id);
  if (selected.length !== 1) return refuse('selected_message_not_found');
  return {body: selected[0].body};
}

/** Compare one retained bounded rendering. This pure operation never reads or writes Slack. */

/**
 * Bind Canvas file IDs to the complete permalinks returned in a retained native
 * files search. Content excerpts never supply an identity or a link.
 */
function inspectSlackCanvasLinkReadback(response, request) {
  object(request, 'Canvas link read request');
  if (!['search', 'search_public'].includes(request.operation)) {
    throw new TypeError('Canvas link readback requires the original native file search');
  }
  const args = object(request.args, 'Canvas link read arguments');
  if (args.content_types !== 'files' || args.include_context !== false ||
      args.response_format !== undefined && args.response_format !== 'detailed') {
    throw new TypeError('Retain a detailed files-only search with include_context:false');
  }
  object(response, 'Canvas link native response');
  if (response.isError === true) throw new TypeError('Canvas link search returned a native error');
  const representations = [];
  const admit = value => {
    object(value, 'Canvas link search payload');
    if (Object.keys(value).length !== 2 || typeof value.results !== 'string' ||
        typeof value.pagination_info !== 'string' ||
        value.results.length + value.pagination_info.length > 8388608) {
      throw new TypeError('Retain the complete bounded native file-search rendering');
    }
    representations.push(value);
  };
  if (typeof response.results === 'string') admit(response);
  else {
    if (response.structuredContent !== undefined) admit(response.structuredContent);
    if (response.content !== undefined) {
      if (!Array.isArray(response.content) || response.content.length === 0) {
        throw new TypeError('Native file-search content must retain its JSON envelope');
      }
      for (const block of response.content) {
        if (block?.type !== 'text' || typeof block.text !== 'string' ||
            block.text.length > 8388608) throw new TypeError('Unsupported native file-search content');
        let value;
        try { value = JSON.parse(block.text); }
        catch (_) { throw new TypeError('Native file-search content is not its complete JSON envelope'); }
        admit(value);
      }
    }
  }
  if (!representations.length || representations.some(value =>
      value.results !== representations[0].results ||
      value.pagination_info !== representations[0].pagination_info)) {
    throw new TypeError('Native file-search representations are missing or disagree');
  }
  const rendered = representations[0].results;
  const prefix = /^# Search Results for: [^\r\n]*\n\n/.exec(rendered);
  if (!prefix) throw new TypeError('Unsupported native file-search preamble');
  const rest = rendered.slice(prefix[0].length);
  if (rest === 'No results found.\n') return {links: [], parsed_files: 0};
  const section = /^## Files \(([1-9][0-9]?) results\)\n/.exec(rest);
  if (!section || Number(section[1]) > 20) throw new TypeError('Expected one complete native files section');
  const count = Number(section[1]), body = rest.slice(section[0].length);
  const chunks = body.split(/(?=^### Result [1-9][0-9]* of [1-9][0-9]*\n)/m).filter(Boolean);
  if (chunks.length !== count) throw new TypeError('Native file result count differs from its complete framing');
  const links = [], seen = new Map();
  for (let i = 0; i < chunks.length; i++) {
    const header = /^### Result ([1-9][0-9]*) of ([1-9][0-9]*)\nTitle: ([^\r\n]*)\nFile type: ([^\r\n]+)\nSize: ([^\r\n]+)\nAuthor: [^\r\n]+ \(([UW][A-Z0-9]+)\)\nCreated: [^\r\n]+\nFile ID: (F[A-Z0-9]+)\nPermalink: \[link\]\((https:\/\/[^\s()]+)\)\n\n---\n\nContent: \n/.exec(chunks[i]);
    if (!header || Number(header[1]) !== i + 1 || Number(header[2]) !== count ||
        !chunks[i].endsWith('\n\n---\n\n') ||
        /^(?:## (?:Files|Messages)\b|### Result\b)/m.test(chunks[i].slice(header[0].length))) {
      throw new TypeError('Native file result has incomplete or ambiguous header framing');
    }
    if (header[4] !== 'canvas') continue;
    const url = /^https:\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.slack\.com)\/docs\/(T[A-Z0-9]+)\/(F[A-Z0-9]+)$/.exec(header[8]);
    if (!url || url[3] !== header[7]) throw new TypeError('Native Canvas permalink and file ID disagree');
    const link = {file_id: header[7], url: header[8], title: header[3],
      author: header[6], source_index: i};
    if (seen.has(link.file_id) && seen.get(link.file_id) !== link.url) {
      throw new TypeError('Native Canvas file has conflicting original permalinks');
    }
    seen.set(link.file_id, link.url); links.push(link);
  }
  return {links, parsed_files: count};
}

/** Restore only observed native link display forms against their exact original targets. */
function normalizeSlackUrlTargets(value, options = {}) {
  if (typeof value !== 'string') throw new TypeError('Native URL rendering must be a string');
  object(options, 'URL normalization options');
  const allowed = new Set(['fragment_labels', 'www_slash_labels', 'www_or_slash_labels', 'github_blob_labels', 'original_text', 'canvas_links']);
  for (const [key, flag] of Object.entries(options)) {
    if (!allowed.has(key) || (key === 'original_text' ? typeof flag !== 'string' :
        key === 'canvas_links' ? !Array.isArray(flag) : typeof flag !== 'boolean')) {
      throw new TypeError('Unknown or invalid URL normalization option: ' + key);
    }
  }
  const canvasLinks = new Map();
  for (const link of options.canvas_links ?? []) {
    object(link, 'Native Canvas link');
    const url = typeof link.url === 'string' &&
      /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.slack\.com\/docs\/T[A-Z0-9]+\/(F[A-Z0-9]+)$/.exec(link.url);
    if (!url || url[1] !== link.file_id ||
        canvasLinks.has(link.file_id) && canvasLinks.get(link.file_id) !== link.url) {
      throw new TypeError('Use the exact original native Canvas permalink and file ID');
    }
    canvasLinks.set(link.file_id, link.url);
  }
  if (canvasLinks.size && options.original_text === undefined) {
    throw new TypeError('Canvas display restoration requires the complete original string');
  }
  if (options.original_text !== undefined) {
    const original = options.original_text;
    const empty = () => ({bare_url_wrappers: 0, mailto_addresses: 0,
      ...(canvasLinks.size ? {canvas_file_ids: 0} : {})});
    const counts = empty();
    const unchanged = () => ({text: value, normalizations_applied: empty()});
    let from = 0, position = 0;
    const pattern = /<(https?:\/\/[^<>\s|]+|mailto:[^<>\s|]+)(?:\|([^<>\r\n]+))?>|\bF[A-Z0-9]{1,79}\b/g;
    for (const match of value.matchAll(pattern)) {
      const literal = value.slice(from, match.index);
      if (!original.startsWith(literal, position)) return unchanged();
      position += literal.length;
      const candidates = match[1]
        ? [match[0], match[1], ...(match[1].startsWith('mailto:') ? [match[1].slice(7)] : [])]
        : [match[0], ...(canvasLinks.has(match[0]) ? [canvasLinks.get(match[0])] : [])];
      const selected = [...new Set(candidates)].filter(candidate => original.startsWith(candidate, position));
      if (selected.length !== 1) return unchanged();
      const target = selected[0];
      if (target !== match[0]) {
        if (!match[1]) counts.canvas_file_ids++;
        else {
          counts.bare_url_wrappers++;
          if (match[1].startsWith('mailto:') && target === match[1].slice(7)) counts.mailto_addresses++;
        }
      }
      position += target.length; from = match.index + match[0].length;
    }
    const tail = value.slice(from);
    if (!original.startsWith(tail, position) || position + tail.length !== original.length) return unchanged();
    return {text: original, normalizations_applied: counts};
  }
  const allowFragmentLabels = options.fragment_labels === true;
  const allowWwwSlashLabels = options.www_slash_labels === true;
  const allowIndependentLabels = options.www_or_slash_labels === true;
  const allowGitHubBlobLabels = options.github_blob_labels === true;
  const counts = {bare_url_wrappers: 0};
  if (allowFragmentLabels) counts.fragment_labels = 0;
  if (allowWwwSlashLabels) counts.www_slash_labels = 0;
  if (allowIndependentLabels) { counts.www_prefix_omissions = 0; counts.terminal_slash_omissions = 0; }
  if (allowGitHubBlobLabels) counts.github_blob_labels = 0;
  // Only observed bare-URL label forms are eligible; the URL target is unchanged.
  const comparable = value.replace(/<(https?:\/\/[^<>\s|]+)(?:\|([^<>\r\n]+))?>/g,
    (whole, target, label) => {
      const withoutScheme = target.replace(/^https?:\/\//, '');
      const fragment = withoutScheme.indexOf('#');
      const fragmentLabel = allowFragmentLabels && fragment >= 0
        && fragment < withoutScheme.length - 1
        && label === withoutScheme.slice(0, fragment + 1) + '\u2026';
      const wwwSlashLabel = allowWwwSlashLabels && withoutScheme.startsWith('www.')
        && withoutScheme.endsWith('/') && !/[?#]/.test(withoutScheme)
        && label === withoutScheme.slice(4, -1);
      const independentTarget = allowIndependentLabels && !/[?#]/.test(withoutScheme);
      const wwwOnlyLabel = independentTarget && withoutScheme.startsWith('www.')
        && label === withoutScheme.slice(4);
      const slashOnlyLabel = independentTarget && withoutScheme.endsWith('/')
        && label === withoutScheme.slice(0, -1);
      const independentBothLabel = independentTarget && withoutScheme.startsWith('www.')
        && withoutScheme.endsWith('/') && label === withoutScheme.slice(4, -1);
      // One observed immutable GitHub blob display form; never shorten the target.
      const githubBlobTarget = allowGitHubBlobLabels
        && /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/blob)\/[0-9a-f]{40}\/(?:[A-Za-z0-9_.-]+\/)*([A-Za-z0-9_.-]+)$/.exec(target);
      const githubBlobLabel = githubBlobTarget
        && label === 'github.com/' + githubBlobTarget[1] + '/\u2026/' + githubBlobTarget[2];
      if (label !== undefined && label !== target && label !== withoutScheme
        && !fragmentLabel && !wwwSlashLabel
        && !wwwOnlyLabel && !slashOnlyLabel && !independentBothLabel && !githubBlobLabel) {
        return whole;
      }
      if (githubBlobLabel) counts.github_blob_labels += 1;
      if (fragmentLabel) counts.fragment_labels += 1;
      if (wwwSlashLabel) counts.www_slash_labels += 1;
      if (wwwOnlyLabel || independentBothLabel) counts.www_prefix_omissions += 1;
      if (slashOnlyLabel || independentBothLabel) counts.terminal_slash_omissions += 1;
      counts.bare_url_wrappers += 1;
      return target;
    });
  return {text: comparable, normalizations_applied: counts};
}

function compareSlackPublication(published, expectedMessage, options = {}) {
  object(published, 'published result');
  const sanitizedExpectedMessage = redactOutboundSecretText(text(expectedMessage, 'expected message'));
  object(options, 'comparison options');
  for (const key of Object.keys(options)) {
    if (key !== 'normalization') throw new TypeError('Unsupported comparison option: ' + key);
  }
  const normalization = options.normalization === undefined ? 'none' : options.normalization;
  if (!['none', 'slack_bare_urls_entities',
    'slack_bare_urls_entities_fragment_labels',
    'slack_bare_urls_entities_www_slash_labels',
    'slack_bare_urls_entities_www_or_slash_labels',
    'slack_bare_urls_entities_github_blob_labels'].includes(normalization)) {
    throw new TypeError('normalization must be none, slack_bare_urls_entities, '
      + 'slack_bare_urls_entities_fragment_labels, slack_bare_urls_entities_www_slash_labels, '
      + 'slack_bare_urls_entities_www_or_slash_labels, or slack_bare_urls_entities_github_blob_labels');
  }
  const allowFragmentLabels = normalization === 'slack_bare_urls_entities_fragment_labels';
  const allowWwwSlashLabels = normalization === 'slack_bare_urls_entities_www_slash_labels';
  const allowIndependentLabels = normalization === 'slack_bare_urls_entities_www_or_slash_labels';
  const allowGitHubBlobLabels = normalization === 'slack_bare_urls_entities_github_blob_labels';
  const result = {status: 'uncomparable', matches: null, literal_match: null,
    body_source: 'native_read_thread_rendering', channel_binding: 'retained_readback_request',
    normalization, normalizations_applied: {bare_url_wrappers: 0, entities: 0}};
  if (allowGitHubBlobLabels) result.normalizations_applied.github_blob_labels = 0;
  if (allowFragmentLabels) result.normalizations_applied.fragment_labels = 0;
  if (allowWwwSlashLabels) result.normalizations_applied.www_slash_labels = 0;
  if (allowIndependentLabels) {
    result.normalizations_applied.www_prefix_omissions = 0;
    result.normalizations_applied.terminal_slash_omissions = 0;
  }
  const selection = selectSlackPublicationBody(published, result);
  if (selection.failure) return selection.failure;
  const observed = selection.body;
  result.literal_match = observed === sanitizedExpectedMessage;
  if (result.literal_match) return {...result, status: 'exact', matches: true};
  if (normalization === 'none') {
    return {...result, status: 'mismatch', matches: false, reason: 'different_rendered_body'};
  }

  const urls = normalizeSlackUrlTargets(observed, {
    fragment_labels: allowFragmentLabels, www_slash_labels: allowWwwSlashLabels,
    www_or_slash_labels: allowIndependentLabels, github_blob_labels: allowGitHubBlobLabels});
  let comparable = urls.text;
  Object.assign(result.normalizations_applied, urls.normalizations_applied);
  // Decode once, after link recognition: escaped angle brackets cannot create a link.
  const entities = {'&amp;': '&', '&lt;': '<', '&gt;': '>'};
  comparable = comparable.replace(/&(?:amp|lt|gt);/g, entity => {
    result.normalizations_applied.entities += 1;
    return entities[entity];
  });
  return comparable === sanitizedExpectedMessage
    ? {...result, status: 'presentation_match', matches: true}
    : {...result, status: 'mismatch', matches: false, reason: 'different_rendered_body'};
}

/** Compare only the exact raw span inside one unambiguous triple-backtick pair. */
function compareSlackFencedPayload(published, expectedPayload) {
  object(published, 'published result');
  const sanitizedExpectedPayload = redactOutboundSecretText(text(expectedPayload, 'expected payload'));
  const result = {status: 'uncomparable', matches: null, literal_match: null,
    evidence_scope: 'single_fenced_payload',
    body_source: 'native_read_thread_rendering', channel_binding: 'retained_readback_request',
    normalization: 'none', whole_message_comparison: 'not_performed'};
  const refuse = reason => ({...result, reason});
  const selection = selectSlackPublicationBody(published, result);
  if (selection.failure) return selection.failure;
  const observed = selection.body;
  const fences = [...observed.matchAll(/`{3,}/g)];
  if (fences.length !== 2 || fences.some(fence => fence[0] !== '```')) {
    return refuse('single_triple_backtick_pair_required');
  }
  if (/^[ \t]*~{3,}/m.test(observed)) return refuse('unsupported_fence_form');
  const opening = fences[0].index;
  const closing = fences[1].index;
  if ((opening !== 0 && observed[opening - 1] !== '\n')
      || (closing + 3 !== observed.length && observed[closing + 3] !== '\n')) {
    return refuse('unsupported_fence_boundaries');
  }
  const start = opening + 3;
  const payload = observed.slice(start, closing);
  result.fence = {delimiter: '```', offset_origin: 'selected_rendered_body',
    offset_unit: 'utf16_code_units', range_end: 'exclusive',
    opening: [opening, start], payload: [start, closing], closing: [closing, closing + 3]};
  result.expected_length = sanitizedExpectedPayload.length;
  result.observed_length = payload.length;
  result.literal_match = payload === sanitizedExpectedPayload;
  return result.literal_match
    ? {...result, status: 'exact', matches: true}
    : {...result, status: 'mismatch', matches: false, reason: 'different_fenced_payload'};
}


/** Select only the narrow native send acknowledgement used for parent routing. */
function routingSendAcknowledgement(response) {
  object(response, 'retained native send response');
  if (response.isError === true) throw new TypeError('Native send response is an error');
  const candidates = [];
  if (response.message_context !== undefined || response.message_link !== undefined) {
    candidates.push({value: response, source: 'native_payload'});
  } else {
    if (response.structuredContent !== undefined) {
      candidates.push({value: response.structuredContent, source: 'structuredContent'});
    }
    if (response.content !== undefined) {
      if (!Array.isArray(response.content) || response.content.length > 8) {
        throw new TypeError('Unsupported native send content blocks');
      }
      for (let i = 0; i < response.content.length; i++) {
        const block = response.content[i];
        if (block?.type !== 'text' || typeof block.text !== 'string' || block.text.length > 4096) {
          throw new TypeError('Unsupported native send content block');
        }
        candidates.push({value: JSON.parse(block.text), source: 'content[' + i + '].text'});
      }
    }
  }
  if (!candidates.length) throw new TypeError('Missing native send acknowledgement');
  for (const candidate of candidates) {
    const value = object(candidate.value, 'native send acknowledgement');
    const context = object(value.message_context, 'native send message_context');
    if (Object.keys(value).some(key => !['message_link', 'message_context'].includes(key))
        || Object.keys(context).some(key => !['message_ts', 'channel_id'].includes(key))
        || typeof value.message_link !== 'string' || value.message_link.length > 2048
        || typeof context.channel_id !== 'string' || !/^[CDG][A-Z0-9]+$/.test(context.channel_id)
        || context.channel_id.length > 80
        || typeof context.message_ts !== 'string' || !/^[1-9][0-9]{0,15}\.[0-9]{6}$/.test(context.message_ts)) {
      throw new TypeError('Unsupported native send acknowledgement shape');
    }
    candidate.identity = JSON.stringify([value.message_link, context.channel_id, context.message_ts]);
  }
  if (new Set(candidates.map(candidate => candidate.identity)).size !== 1) {
    throw new TypeError('Conflicting native send acknowledgements');
  }
  return {value: candidates[0].value, sources: candidates.map(candidate => candidate.source)};
}

/** One explicitly selected native-parent read; existing publication inputs stay intact. */
async function readSlackPublicationAtNativeParent(tools, published, retainedSendResponse, options = {}) {
  object(published, 'published progress');
  object(options, 'native-parent read options');
  for (const key of Object.keys(options)) {
    if (!['bindings', 'onProgress', 'readback_thread_ts'].includes(key)) {
      throw new TypeError('Unsupported native-parent read option: ' + key);
    }
  }
  if (published.message_state !== 'edit_confirmed') {
    throw new TypeError('Native-parent readback requires a confirmed edit');
  }
  if (options.onProgress !== undefined && typeof options.onProgress !== 'function') {
    throw new TypeError('onProgress must be a function');
  }
  const ack = routingSendAcknowledgement(retainedSendResponse);
  const context = ack.value.message_context;
  const link = ack.value.message_link;
  if (context.channel_id !== published.channel_id || context.message_ts !== published.message_id
      || link !== published.message_link) {
    throw new TypeError('Native send acknowledgement differs from the retained publication');
  }
  const match = /^https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.slack\.com)\/archives\/([CDG][A-Z0-9]+)\/p([0-9]+)\?([^#]+)$/.exec(link);
  if (!match || match[2] !== context.channel_id
      || match[3] !== context.message_ts.replace('.', '')) {
    throw new TypeError('Native message link does not bind the selected channel and message');
  }
  const query = {};
  const pairs = match[4].split('&');
  if (pairs.length !== 2) throw new TypeError('Native message link needs exactly thread_ts and cid');
  for (const pair of pairs) {
    const parts = pair.split('=');
    if (parts.length !== 2 || !['thread_ts', 'cid'].includes(parts[0])
        || Object.prototype.hasOwnProperty.call(query, parts[0])) {
      throw new TypeError('Ambiguous or unsupported native message link query');
    }
    query[parts[0]] = parts[1];
  }
  if (query.cid !== context.channel_id || !/^[1-9][0-9]{0,15}\.[0-9]{6}$/.test(query.thread_ts ?? '')
      || BigInt(query.thread_ts.replace('.', '')) > BigInt(context.message_ts.replace('.', ''))) {
    throw new TypeError('Native message link has an invalid parent or channel query');
  }
  if (options.readback_thread_ts !== undefined
      && timestamp(options.readback_thread_ts, 'readback_thread_ts') !== query.thread_ts) {
    throw new TypeError('Explicit readback_thread_ts conflicts with the native parent');
  }
  const requested = published.thread_ts === undefined ? null : timestamp(published.thread_ts, 'retained thread_ts');
  const prior = published.readback_thread_ts === undefined ? null
    : timestamp(published.readback_thread_ts, 'retained readback_thread_ts');
  const routing = {
    source: 'caller_retained_native_send_acknowledgement',
    authority: 'reported_routing_metadata', authentication: 'not_performed',
    acknowledgement_sources: ack.sources, native_message_link: link,
    channel_id: context.channel_id, message_id: context.message_ts,
    requested_thread_ts: requested, prior_readback_thread_ts: prior,
    native_parent_thread_ts: query.thread_ts,
  };
  const copyRouting = () => JSON.parse(JSON.stringify(routing));
  const selected = {};
  for (const key of ['status', 'stage', 'message_state', 'progress_callback_errors',
    'channel_id', 'message_id', 'message_link', 'calls', 'result_destination']) {
    if (published[key] !== undefined) selected[key] = published[key];
  }
  selected.thread_ts = query.thread_ts;
  selected.readback_thread_ts = query.thread_ts;
  const readOptions = {...options, readback_thread_ts: query.thread_ts};
  if (options.onProgress) {
    readOptions.onProgress = progress => options.onProgress({
      routing: copyRouting(), observation: progress,
    });
  }
  try {
    const observation = await readSlackPublication(tools, selected, readOptions);
    return {schema: 'commons.connected_slack_native_parent_readback/v1',
      routing: copyRouting(), observation};
  } catch (error) {
    if (error instanceof SlackPublishError) error.routing = copyRouting();
    throw error;
  }
}

/** Preserve source bytes instead of passing code through Slack's Markdown renderer. */
async function publishSlackFile(tools, request, options = {}) {
  const progress = {status: 'incomplete', stage: 'validate', file_state: 'not_attempted',
    calls: {}, readback_status: 'not_performed', progress_callback_errors: 0};
  let announce = async () => {};
  try {
    object(request, 'file request');
    object(options, 'file options');
    const allowed = new Set(['filename', 'content', 'content_type', 'channel_id',
      'thread_ts', 'title', 'initial_comment', 'snippet_type', 'alt_txt', 'destination']);
    for (const key of Object.keys(request)) {
      if (!allowed.has(key)) throw new TypeError('Unsupported file request field: ' + key);
    }
    const destination = requestResultDestination(request);
    if (destination) progress.result_destination = destination;
    const filename = text(request.filename, 'filename');
    let bytes;
    if (typeof request.content === 'string') {
      // encodeURIComponent rejects lone surrogates instead of silently replacing source.
      const encoded = unescape(encodeURIComponent(request.content));
      bytes = Uint8Array.from(encoded, char => char.charCodeAt(0));
    } else if (request.content instanceof Uint8Array) {
      bytes = new Uint8Array(request.content);
    } else throw new TypeError('content must be a UTF-8 string or Uint8Array');
    if (!bytes.length) throw new TypeError('Slack requires a nonempty file');
    // Inspect ASCII credential spans without decoding or rewriting binary/source bytes.
    let inspection = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      inspection += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    if (redactOutboundSecretText(inspection) !== inspection) {
      throw new TypeError('File contains a recognized credential; remove it before publication');
    }
    const channel = destination?.channel_id
      ?? (request.channel_id === undefined ? undefined : text(request.channel_id, 'channel_id'));
    if (channel !== undefined && !/^[CDG][A-Z0-9]+$/.test(channel)) {
      throw new TypeError('channel_id must be the observed Slack channel or conversation ID');
    }
    const thread = destination?.parent_thread_ts
      ?? (request.thread_ts === undefined ? undefined : timestamp(request.thread_ts, 'thread_ts'));
    if (channel === undefined && (thread !== undefined || request.initial_comment !== undefined)) {
      throw new TypeError('thread_ts and initial_comment require an explicit channel_id');
    }
    const contentType = request.content_type ?? 'application/octet-stream';
    text(contentType, 'content_type');
    if (/[\r\n]/.test(contentType)) throw new TypeError('content_type must not contain newlines');
    const allocateArgs = {filename, content_length: bytes.length};
    const completeArgs = {};
    for (const key of ['snippet_type', 'alt_txt', 'title', 'initial_comment']) {
      if (request[key] === undefined) continue;
      const value = text(request[key], key);
      if (redactOutboundSecretText(value) !== value) {
        throw new TypeError(key + ' contains a recognized credential');
      }
      if (key === 'snippet_type' || key === 'alt_txt') allocateArgs[key] = value;
      else completeArgs[key] = value;
    }
    if (redactOutboundSecretText(filename) !== filename) {
      throw new TypeError('filename contains a recognized credential');
    }
    if (channel !== undefined) completeArgs.channel_id = progress.channel_id = channel;
    if (thread !== undefined) completeArgs.thread_ts = progress.thread_ts = thread;
    const bindings = {
      allocate: options.bindings?.allocate ?? 'mcp__codex_apps__slack_slack_get_file_upload_url',
      complete: options.bindings?.complete ?? 'mcp__codex_apps__slack_slack_complete_file_upload',
      readback: options.bindings?.readback ?? 'mcp__codex_apps__slack_slack_read_file',
    };
    if (options.readback !== undefined && typeof options.readback !== 'boolean') {
      throw new TypeError('readback must be boolean');
    }
    for (const action of options.readback ? ['allocate', 'complete', 'readback'] : ['allocate', 'complete']) {
      if (typeof tools?.[bindings[action]] !== 'function') throw new Error('Binding not present: ' + bindings[action]);
    }
    const uploader = options.uploadBytes ?? (typeof globalThis.fetch === 'function'
      ? async ({upload_url, bytes: body, content_type}) => {
        const response = await globalThis.fetch(upload_url, {method: 'POST', redirect: 'error',
          signal: AbortSignal.timeout(60000),
          headers: {'Content-Type': content_type, 'Content-Length': String(body.length)}, body});
        await response.arrayBuffer();
        return {status: response.status};
      } : undefined);
    if (typeof uploader !== 'function') throw new TypeError('uploadBytes or runtime fetch is required');
    if (options.onProgress !== undefined && typeof options.onProgress !== 'function') {
      throw new TypeError('onProgress must be a function');
    }
    announce = async () => {
      if (!options.onProgress) return;
      try { await options.onProgress(JSON.parse(JSON.stringify(progress))); }
      catch (_) { progress.progress_callback_errors += 1; }
    };
    progress.content_length = bytes.length;
    progress.stage = 'allocate';
    progress.file_state = 'allocation_outcome_unknown';
    await announce();
    progress.calls.allocate = 1;
    const fileAck = (response, action) => {
      const payload = unpack(response, action);
      if (typeof payload.result !== 'string') return payload;
      // The connected tools expose file acknowledgements as labelled native text.
      // Read those labels only; never reconstruct the case-sensitive signed URL.
      const field = label => {
        const matches = [...payload.result.matchAll(new RegExp('^' + label + ': ([^\\r\\n]+)$', 'gm'))];
        if (matches.length > 1) throw new Error('Ambiguous file acknowledgement');
        return matches[0]?.[1];
      };
      return {file_id: field('File ID'), upload_url: field('Upload URL'),
        file_link: field('File Link') ?? field('Link') ?? field('Permalink') ?? field('URL')};
    };
    const allocated = fileAck(await tools[bindings.allocate](allocateArgs), 'file allocation');
    const fileId = text(allocated.file_id, 'allocated file_id');
    if (!/^F[A-Z0-9]+$/.test(fileId)) throw new Error('Invalid allocated file_id');
    progress.file_id = completeArgs.file_id = fileId;
    const uploadUrl = text(allocated.upload_url, 'upload_url');
    if (!/^https:\/\//.test(uploadUrl)) throw new Error('Slack did not return an HTTPS upload URL');
    progress.stage = 'upload';
    progress.file_state = 'upload_outcome_unknown';
    await announce();
    progress.calls.upload = 1;
    let uploaded;
    try { uploaded = await uploader({upload_url: uploadUrl, bytes, content_type: contentType}); }
    catch (error) {
      // Keep actionable metadata without an error message, URL, response body or cause.
      const name = error?.name;
      if (typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) {
        progress.upload_error_class = name;
      }
      const status = error?.status ?? error?.statusCode;
      if (Number.isInteger(status) && status >= 100 && status <= 599) progress.upload_http_status = status;
      throw new Error('Raw file upload failed; its outcome may be unknown');
    }
    if (Number.isInteger(uploaded?.status) && uploaded.status >= 100 && uploaded.status <= 599) {
      progress.upload_http_status = uploaded.status;
    }
    if (!Number.isInteger(uploaded?.status) || uploaded.status < 200 || uploaded.status >= 300) {
      throw new Error('Raw file upload did not return a successful HTTP status');
    }
    progress.stage = 'complete';
    progress.file_state = 'completion_outcome_unknown';
    await announce();
    progress.calls.complete = 1;
    const completed = fileAck(await tools[bindings.complete](completeArgs), 'file completion');
    if (completed.file_id !== fileId) throw new Error('Completion identified a different file');
    progress.file_state = 'complete_confirmed';
    progress.status = 'published';
    const link = completed.file_link ?? completed.permalink ?? completed.url;
    if (typeof link === 'string') progress.file_link = link;
    await announce();
    if (options.readback) {
      progress.stage = 'readback';
      progress.readback_status = 'pending';
      await announce();
      progress.calls.readback = 1;
      const response = await tools[bindings.readback]({file_id: fileId});
      object(response, 'file readback');
      if (response.isError) throw new Error('File readback returned a native tool error');
      progress.readback_status = 'captured';
      progress.stage = 'done';
      await announce();
      return {...progress, readback_response: response};
    }
    progress.stage = 'done';
    await announce();
    return progress;
  } catch (error) {
    if (progress.readback_status === 'pending') progress.readback_status = 'failed';
    await announce();
    // Native allocation responses and uploader errors may contain signed URLs.
    // Preserve only useful transport state, never those responses or raw causes.
    const message = progress.stage === 'validate' ? String(error?.message ?? error)
      : 'Slack file publication failed at ' + progress.stage + '; inspect retained file state before any retry';
    throw new SlackPublishError(message, progress);
  }
}


const CANVAS_SOURCE_SCHEMA = 'commons.connected_slack_canvas_source/v1';

function canvasSourceOptions(options) {
  object(options, 'Canvas source options');
  const positive = (value, label, maximum) => {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new TypeError(label + ' must be a positive safe integer no greater than ' + maximum);
    }
    return value;
  };
  return {
    max_canvas_chars: positive(options.max_canvas_chars ?? 16 * 1024 * 1024,
      'max_canvas_chars', 128 * 1024 * 1024),
    max_source_bytes: positive(options.max_source_bytes ?? 16 * 1024 * 1024,
      'max_source_bytes', 64 * 1024 * 1024),
    max_blocks: positive(options.max_blocks ?? 1024, 'max_blocks', 16384),
    max_compressed_bytes: positive(options.max_compressed_bytes ?? 16 * 1024 * 1024,
      'max_compressed_bytes', 64 * 1024 * 1024),
    max_gzip_members: positive(options.max_gzip_members ?? 1024, 'max_gzip_members', 16384),
  };
}

function canvasSourceIdentity(value, label) {
  object(value, label);
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
      || !Number.isSafeInteger(value.bytes) || value.bytes < 0) {
    throw new TypeError(label + ' requires exact bytes and lowercase SHA256');
  }
  return {bytes: value.bytes, sha256: value.sha256};
}

function canvasSourceHasher(options, name = 'sha256Utf8') {
  const implementation = options[name] ?? (typeof require === 'function'
    ? require('./connected_sha256.cjs')[name] : undefined);
  if (typeof implementation !== 'function') {
    throw new TypeError(name + ' from connected_sha256.cjs is required');
  }
  return value => canvasSourceIdentity(implementation(value), name + ' result');
}

function canvasSourceEnvelopeSelection(value) {
  object(value, 'Canvas gzip envelope selection');
  const fields = ['payload_pointer', 'bytes_pointer', 'sha256_pointer'];
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) throw new TypeError('Unsupported gzip envelope field: ' + key);
  }
  const result = {};
  for (const field of fields) {
    const pointer = value[field];
    if (typeof pointer !== 'string' || pointer.length > 4096
        || pointer !== '' && !pointer.startsWith('/') || /~(?![01])/g.test(pointer)) {
      throw new TypeError(field + ' must be an explicit RFC6901 JSON pointer');
    }
    result[field] = pointer;
  }
  return result;
}

function canvasSourceGunzip(options) {
  const implementation = options.gunzipBytes ?? (typeof require === 'function'
    ? require('./connected_gzip.cjs').gunzipBytes : undefined);
  if (typeof implementation !== 'function') {
    throw new TypeError('gunzipBytes from connected_gzip.cjs is required for gzip source');
  }
  return implementation;
}

function canvasSourceRequest(request, requireSelection = true) {
  object(request, 'Canvas source request');
  for (const key of Object.keys(request)) {
    if (!['canvas_id', 'selection'].includes(key)) {
      throw new TypeError('Unsupported Canvas source request field: ' + key);
    }
  }
  if (typeof request.canvas_id !== 'string' || !/^F[A-Z0-9]{1,79}$/.test(request.canvas_id)) {
    throw new TypeError('canvas_id must be the original native Canvas file ID');
  }
  const result = {canvas_id: request.canvas_id};
  if (request.selection === undefined) {
    if (requireSelection) throw new TypeError('An explicit Canvas source selection is required');
    return result;
  }
  const selected = object(request.selection, 'Canvas source selection');
  for (const key of Object.keys(selected)) {
    if (!['blocks', 'encoding', 'bytes', 'sha256', 'envelope'].includes(key)) {
      throw new TypeError('Unsupported Canvas source selection field: ' + key);
    }
  }
  if (!Array.isArray(selected.blocks) || !selected.blocks.length || selected.blocks.length > 16384
      || selected.blocks.some(index => !Number.isSafeInteger(index) || index < 0)
      || new Set(selected.blocks).size !== selected.blocks.length) {
    throw new TypeError('blocks must name unique zero-based fence indices in the original part order');
  }
  for (let i = 0; i < selected.blocks.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(selected.blocks, i)) {
      throw new TypeError('blocks must not contain missing entries');
    }
  }
  if (!['json', 'escaped-json', 'base64-json', 'base64-gzip-json'].includes(selected.encoding)) {
    throw new TypeError('encoding must be json, escaped-json, base64-json or base64-gzip-json');
  }
  if (selected.envelope !== undefined && selected.encoding !== 'base64-gzip-json') {
    throw new TypeError('An envelope selection requires base64-gzip-json encoding');
  }
  result.selection = {...canvasSourceIdentity(selected, 'Canvas source selection'),
    encoding: selected.encoding, blocks: [...selected.blocks],
    ...(selected.envelope !== undefined
      ? {envelope: canvasSourceEnvelopeSelection(selected.envelope)} : {})};
  return result;
}

/** Inspect the original native Canvas rendering without returning its source bodies. */
function inspectSlackCanvasSource(response, request, options = {}) {
  const route = canvasSourceRequest(request, false);
  const limits = canvasSourceOptions(options);
  const payload = unpack(response, 'Canvas read');
  if (payload.canvas_id !== route.canvas_id) throw new TypeError('Canvas read identified another file');
  if (typeof payload.markdown_content !== 'string'
      || payload.markdown_content.length > limits.max_canvas_chars) {
    throw new TypeError('Canvas markdown is missing or exceeds max_canvas_chars');
  }
  const markdown = payload.markdown_content;
  const blocks = [];
  const marker = /^([ \t]*)(\`{3,}|~{3,})([^\r\n]*)\r?$|^(#{1,6})[ \t]+([^\r\n]*)\r?$/gm;
  let opened = null, heading = null, match;
  while ((match = marker.exec(markdown))) {
    if (match[4]) {
      if (opened === null) heading = match[5];
      continue;
    }
    const delimiter = match[2], info = match[3].trim();
    if (opened === null) {
      if (delimiter[0] === '\`' && info.includes('\`')) continue;
      const lineEnd = match.index + match[0].length;
      opened = {start: match.index, content_start: lineEnd + 1, language: info,
        heading, delimiter};
    } else if (delimiter[0] === opened.delimiter[0]
        && delimiter.length >= opened.delimiter.length && !info) {
      let contentEnd = match.index;
      if (markdown.slice(contentEnd - 2, contentEnd) === '\r\n') contentEnd -= 2;
      else if (markdown[contentEnd - 1] === '\n') contentEnd--;
      if (contentEnd < opened.content_start) contentEnd = opened.content_start;
      blocks.push({index: blocks.length, language: opened.language, heading: opened.heading,
        delimiter: opened.delimiter, content_chars: contentEnd - opened.content_start,
        content_range: [opened.content_start, contentEnd],
        fence_range: [opened.start, match.index + match[0].length]});
      if (blocks.length > limits.max_blocks) throw new TypeError('Canvas exceeds max_blocks');
      opened = null;
    }
  }
  return {schema: CANVAS_SOURCE_SCHEMA, status: 'INSPECTED', canvas_id: route.canvas_id,
    content_basis: 'native_canvas_markdown', offset_unit: 'utf16_code_units',
    range_end: 'exclusive', markdown_chars: markdown.length,
    blocks, limits, incomplete_fence: opened ? {
      start: opened.start, language: opened.language, heading: opened.heading} : null};
}

function canvasBase64Bytes(value, maximum, limitLabel = 'max_source_bytes') {
  if (typeof value !== 'string') throw new TypeError('Base64 source must be text');
  const clean = value.replace(/[ \t\r\n]/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  if (clean.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(clean)
      || clean.slice(0, clean.length - padding).includes('=')) {
    throw new TypeError('Source contains noncanonical base64');
  }
  const length = clean.length / 4 * 3 - padding;
  if (length > maximum) throw new TypeError('Decoded source exceeds ' + limitLabel);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const output = new Uint8Array(length);
  let at = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = alphabet.indexOf(clean[i]), b = alphabet.indexOf(clean[i + 1]);
    const c = clean[i + 2] === '=' ? 0 : alphabet.indexOf(clean[i + 2]);
    const d = clean[i + 3] === '=' ? 0 : alphabet.indexOf(clean[i + 3]);
    if (i + 4 === clean.length && (padding === 2 && (b & 15) !== 0 || padding === 1 && (c & 3) !== 0)) {
      throw new TypeError('Source contains nonzero base64 pad bits');
    }
    const word = (a << 18) | (b << 12) | (c << 6) | d;
    if (at < length) output[at++] = word >>> 16;
    if (at < length) output[at++] = word >>> 8 & 255;
    if (at < length) output[at++] = word & 255;
  }
  return output;
}
function canvasUtf8Text(bytes) {
  const parts = [], units = [];
  const fail = () => { throw new TypeError('Decoded source is not valid UTF-8'); };
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++];
    let code = first, remaining = 0, minimum = 0;
    if (first < 128) { /* ASCII */ }
    else if (first >= 0xc2 && first <= 0xdf) { code = first & 31; remaining = 1; minimum = 0x80; }
    else if (first >= 0xe0 && first <= 0xef) { code = first & 15; remaining = 2; minimum = 0x800; }
    else if (first >= 0xf0 && first <= 0xf4) { code = first & 7; remaining = 3; minimum = 0x10000; }
    else fail();
    if (i + remaining > bytes.length) fail();
    for (let count = 0; count < remaining; count++) {
      const next = bytes[i++];
      if ((next & 0xc0) !== 0x80) fail();
      code = code * 64 + (next & 63);
    }
    if (code < minimum || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) fail();
    if (code <= 0xffff) units.push(code);
    else { code -= 0x10000; units.push(0xd800 | code >>> 10, 0xdc00 | code & 1023); }
    if (units.length >= 8192) { parts.push(String.fromCharCode(...units)); units.length = 0; }
  }
  if (units.length) parts.push(String.fromCharCode(...units));
  return parts.join('');
}


function canvasSourceJson(value) {
  try { return JSON.parse(value); }
  catch (_) { throw new TypeError('Selected Canvas source is not complete JSON'); }
}

/** Decode the caller's original source selection from one retained native read. */
function receiveSlackCanvasSource(response, request, options = {}) {
  const route = canvasSourceRequest(request);
  const inspection = inspectSlackCanvasSource(response, route, options);
  const selected = route.selection;
  if (selected.bytes > inspection.limits.max_source_bytes) {
    throw new TypeError('Selected source exceeds max_source_bytes');
  }
  const payload = unpack(response, 'Canvas read');
  const chosen = selected.blocks.map(index => {
    const block = inspection.blocks[index];
    if (!block) throw new TypeError('Selected Canvas source block is missing: ' + index);
    return block;
  });
  const base64Fence = selected.encoding === 'base64-json'
    || selected.encoding === 'base64-gzip-json' && !selected.envelope;
  const languages = base64Fence
    ? ['', 'base64', selected.encoding] : ['', 'json', 'application/json'];
  if (chosen.some(block => !languages.includes(block.language))) {
    throw new TypeError('Selected fence label differs from the declared source encoding');
  }
  const transport = chosen.map(block =>
    payload.markdown_content.slice(block.content_range[0], block.content_range[1])).join('');
  let sourceText, value, sourceEnvelope, compression;
  if (selected.encoding === 'base64-gzip-json') {
    let encoded = transport;
    if (selected.envelope) {
      sourceEnvelope = object(canvasSourceJson(transport), 'Canvas gzip envelope');
      const pointers = selected.envelope;
      const declared = canvasSourceIdentity({
        bytes: canvasSourcePointer(sourceEnvelope, pointers.bytes_pointer),
        sha256: canvasSourcePointer(sourceEnvelope, pointers.sha256_pointer),
      }, 'Original gzip envelope');
      if (declared.bytes !== selected.bytes || declared.sha256 !== selected.sha256) {
        throw new TypeError('Gzip envelope identity differs from the original Canvas selection');
      }
      encoded = canvasSourcePointer(sourceEnvelope, pointers.payload_pointer);
    }
    const compressed = canvasBase64Bytes(encoded,
      inspection.limits.max_compressed_bytes, 'max_compressed_bytes');
    const decoded = canvasSourceGunzip(options)(compressed, {
      expected_bytes: selected.bytes,
      max_output_bytes: inspection.limits.max_source_bytes,
      max_input_bytes: inspection.limits.max_compressed_bytes,
      max_members: inspection.limits.max_gzip_members,
    });
    if (!(decoded?.data instanceof Uint8Array) || decoded.data.length !== selected.bytes) {
      throw new TypeError('gzip decoder must return the complete declared original bytes');
    }
    sourceText = canvasUtf8Text(decoded.data);
    compression = {format: 'gzip',
      compressed: canvasSourceHasher(options, 'sha256Bytes')(compressed),
      members: decoded.members,
      ...(selected.envelope ? {envelope_selection: selected.envelope} : {})};
  } else if (selected.encoding === 'base64-json') {
    sourceText = canvasUtf8Text(canvasBase64Bytes(transport, inspection.limits.max_source_bytes));
  } else if (selected.encoding === 'escaped-json') {
    value = canvasSourceJson(transport);
    sourceText = JSON.stringify(value);
  } else {
    sourceText = transport;
  }
  const identity = canvasSourceHasher(options)(sourceText);
  if (identity.bytes > inspection.limits.max_source_bytes) {
    throw new TypeError('Decoded source exceeds max_source_bytes');
  }
  const summary = {schema: CANVAS_SOURCE_SCHEMA, canvas_id: route.canvas_id,
    selection: selected, source: identity, selected_blocks: chosen,
    content_basis: inspection.content_basis, source_encoding: 'utf-8',
    limits: inspection.limits, ...(compression ? {compression} : {})};
  if (identity.bytes !== selected.bytes || identity.sha256 !== selected.sha256) {
    return {...summary, status: 'SOURCE_MISMATCH'};
  }
  if (value === undefined) value = canvasSourceJson(sourceText);
  return {...summary, status: 'VERIFIED', source_text: sourceText, value,
    ...(sourceEnvelope ? {source_envelope: sourceEnvelope} : {})};
}

/** Read once or replay the original captured response; neither path sends or edits. */
async function readSlackCanvasSource(tools, request, options = {}) {
  const route = canvasSourceRequest(request);
  canvasSourceOptions(options);
  for (const field of ['onResponse', 'onProgress']) {
    if (options[field] !== undefined && typeof options[field] !== 'function') {
      throw new TypeError(field + ' must be a function');
    }
  }
  const binding = options.bindings?.canvas_read ?? 'mcp__codex_apps__slack_slack_read_canvas';
  const progress = {schema: CANVAS_SOURCE_SCHEMA, canvas_id: route.canvas_id,
    selection: route.selection, status: 'PENDING', stage: 'read', calls: 0,
    read_request: {canvas_id: route.canvas_id}, replayed: options.retained_response !== undefined};
  const announce = async () => {
    if (options.onProgress) await options.onProgress(JSON.parse(JSON.stringify(progress)));
  };
  let response = options.retained_response;
  try {
    if (response === undefined) {
      if (typeof tools?.[binding] !== 'function') throw new TypeError('Binding not present: ' + binding);
      progress.calls = 1;
      await announce();
      response = await tools[binding](progress.read_request);
    }
    progress.stage = 'retain';
    if (options.onResponse) await options.onResponse({
      request: canvasSourceRequest(route), native_request: {...progress.read_request},
      response, replayed: progress.replayed});
    progress.stage = 'receive';
    const result = receiveSlackCanvasSource(response, route, options);
    progress.status = result.status;
    progress.source = result.source;
    progress.stage = 'complete';
    await announce();
    return {...result, calls: progress.calls, read_request: progress.read_request,
      replayed: progress.replayed, readback_response: response};
  } catch (error) {
    progress.status = 'FAILED';
    const failure = new SlackPublishError('Canvas source receiving failed at ' + progress.stage
      + '; retain the original response for continuation', progress, error);
    failure.response = response;
    throw failure;
  }
}

function canvasSourcePointer(value, pointer) {
  if (typeof pointer !== 'string' || pointer !== '' && !pointer.startsWith('/')) {
    throw new TypeError('Source pointer must be an RFC6901 JSON pointer');
  }
  if (!pointer) return value;
  for (const token of pointer.slice(1).split('/')) {
    if (/~(?![01])/g.test(token)) throw new TypeError('Invalid source pointer escape');
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    if (value === null || typeof value !== 'object'
        || !Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError('Source pointer does not exist');
    }
    value = value[key];
  }
  return value;
}

function canvasSourcePath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/')
      || /^[A-Za-z]:/.test(value) || /[\\\u0000-\u001f\u007f]/.test(value)
      || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new TypeError('Source path must be an unchanged relative file path');
  }
  return value;
}

/** Receive selected original files for the caller's existing Git or native installer. */
function selectSlackCanvasSourceFiles(received, request, options = {}) {
  object(received, 'Received Canvas source');
  object(request, 'Canvas file selection');
  if (received.schema !== CANVAS_SOURCE_SCHEMA || received.status !== 'VERIFIED') {
    throw new TypeError('A verified original Canvas source is required');
  }
  for (const key of Object.keys(request)) {
    if (!['paths', 'files_pointer', 'manifest_pointer', 'content_pointer', 'encoding'].includes(key)) {
      throw new TypeError('Unsupported Canvas file selection field: ' + key);
    }
  }
  if (request.content_pointer !== undefined
      && (typeof request.content_pointer !== 'string' || request.content_pointer.length > 4096
        || request.content_pointer !== '' && !request.content_pointer.startsWith('/')
        || /~(?![01])/g.test(request.content_pointer))) {
    throw new TypeError('content_pointer must be an explicit RFC6901 JSON pointer');
  }
  if (request.encoding !== undefined && !['utf-8', 'base64'].includes(request.encoding)) {
    throw new TypeError('Unsupported selected file encoding');
  }
  const limits = canvasSourceOptions(options);
  const sourceIdentity = canvasSourceHasher(options)(text(received.source_text, 'source_text'));
  const expected = canvasSourceIdentity(received.selection, 'Original Canvas selection');
  if (sourceIdentity.bytes > limits.max_source_bytes) {
    throw new TypeError('Original source exceeds max_source_bytes');
  }
  if (sourceIdentity.bytes !== expected.bytes || sourceIdentity.sha256 !== expected.sha256) {
    throw new TypeError('Original Canvas source bytes changed before file receiving');
  }
  const packet = canvasSourceJson(received.source_text);
  const paths = request.paths;
  if (!Array.isArray(paths) || !paths.length || paths.length > 4096
      || new Set(paths).size !== paths.length) {
    throw new TypeError('paths must explicitly name unique original source files');
  }
  for (let i = 0; i < paths.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(paths, i)) throw new TypeError('paths must not contain missing entries');
    canvasSourcePath(paths[i]);
  }
  const filesPointer = request.files_pointer ?? '/files';
  const manifestPointer = request.manifest_pointer ?? '/source_manifest';
  const sourceFiles = canvasSourcePointer(packet, filesPointer);
  const manifest = canvasSourcePointer(packet, manifestPointer);
  if (!Array.isArray(manifest) || manifest.length > 65536) {
    throw new TypeError('Original source_manifest must be an array');
  }
  if (sourceFiles === null || typeof sourceFiles !== 'object') {
    throw new TypeError('Original files must be an object or entry array');
  }
  const wanted = new Set(paths), records = new Map(), entries = new Map();
  for (let index = 0; index < manifest.length; index++) {
    const row = manifest[index];
    if (!row || typeof row !== 'object' || !wanted.has(row.path)) continue;
    if (records.has(row.path)) throw new TypeError('Duplicate selected source manifest path: ' + row.path);
    records.set(row.path, {row, index});
  }
  if (Array.isArray(sourceFiles)) {
    for (const entry of sourceFiles) {
      if (!entry || typeof entry !== 'object' || !wanted.has(entry.path)) continue;
      if (entries.has(entry.path)) throw new TypeError('Duplicate selected source file path: ' + entry.path);
      entries.set(entry.path, entry);
    }
  }
  const output = [];
  let totalBytes = 0;
  for (const path of paths) {
    const retained = records.get(path);
    if (!retained) throw new TypeError('Selected source manifest is absent: ' + path);
    const record = retained.row;
    const identity = canvasSourceIdentity(record, 'Original file manifest');
    totalBytes += identity.bytes;
    if (totalBytes > limits.max_source_bytes) throw new TypeError('Selected files exceed max_source_bytes');
    let entry;
    if (Array.isArray(sourceFiles)) {
      if (!entries.has(path)) throw new TypeError('Selected source file is absent: ' + path);
      entry = entries.get(path);
    } else {
      if (!Object.prototype.hasOwnProperty.call(sourceFiles, path)) {
        throw new TypeError('Selected source file is absent: ' + path);
      }
      entry = sourceFiles[path];
    }
    const content = request.content_pointer !== undefined
      ? canvasSourcePointer(entry, request.content_pointer)
      : typeof entry === 'string' ? entry : object(entry, 'Source file entry').content;
    if (typeof content !== 'string') throw new TypeError('Selected file content must be text');
    const declaredEncoding = typeof entry === 'object' && entry.encoding !== undefined
      ? entry.encoding : record.encoding;
    if (request.encoding !== undefined && declaredEncoding !== undefined
        && request.encoding !== declaredEncoding) {
      throw new TypeError('Selected encoding differs from the original source entry');
    }
    const encoding = request.encoding ?? declaredEncoding ?? 'utf-8';
    if (!['utf-8', 'base64'].includes(encoding)) throw new TypeError('Unsupported source file encoding');
    if (typeof entry === 'object' && entry.encoding !== undefined
        && record.encoding !== undefined && entry.encoding !== record.encoding) {
      throw new TypeError('Original file and manifest encodings differ');
    }
    let actual, bytes;
    if (encoding === 'base64') {
      bytes = canvasBase64Bytes(content, limits.max_source_bytes);
      actual = canvasSourceHasher(options, 'sha256Bytes')(bytes);
    } else {
      actual = canvasSourceHasher(options)(content);
    }
    if (actual.bytes !== identity.bytes || actual.sha256 !== identity.sha256) {
      throw new TypeError('Selected file differs from its original source manifest: ' + path);
    }
    const entryMode = typeof entry === 'object' ? entry.mode : undefined;
    if (entryMode !== undefined && record.mode !== undefined && entryMode !== record.mode) {
      throw new TypeError('Original file and manifest modes differ');
    }
    const mode = entryMode ?? record.mode;
    output.push({path, encoding, content, ...identity,
      manifest_index: retained.index, ...(mode !== undefined ? {mode} : {}),
      ...(bytes ? {data: bytes} : {})});
  }
  return {schema: CANVAS_SOURCE_SCHEMA, status: 'FILES_VERIFIED',
    canvas_id: received.canvas_id, source: sourceIdentity,
    files_pointer: filesPointer, manifest_pointer: manifestPointer,
    ...(request.content_pointer !== undefined ? {content_pointer: request.content_pointer} : {}),
    ...(request.encoding !== undefined ? {encoding: request.encoding} : {}),
    bytes: totalBytes, files: output};
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {redactOutboundSecretText, normalizeSlackUrlTargets, inspectSlackCanvasLinkReadback, SlackPublishError,
    prepareSlackResultDestination, resolveSlackResultDestination, readSlackResultThread, publishSlackMessage, readSlackPublication,
    compareSlackPublication, compareSlackFencedPayload, readSlackPublicationAtNativeParent,
    publishSlackFile, inspectSlackCanvasSource, receiveSlackCanvasSource,
    readSlackCanvasSource, selectSlackCanvasSourceFiles};
}
