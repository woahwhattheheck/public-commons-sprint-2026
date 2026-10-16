'use strict';

// Argument and response custody for the existing native Slack search bindings.
// No discovery, transport, credentials, retry loop, cache, or second search index.
const SEARCH_BINDINGS = Object.freeze({
  search: 'mcp__codex_apps__slack_slack_search_public_and_private',
  search_public: 'mcp__codex_apps__slack_slack_search_public',
});
const SCOPE_FIELDS = new Set(['query', 'keywords', 'filters']);
const LEGACY_FILTER = /^(?:in|from|with|creator|has|is|before|after|on|during):\S/;
const MAX_TEXT = 8 * 1024 * 1024;

class SlackSearchScopeError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'SlackSearchScopeError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail) {
  throw new SlackSearchScopeError(code, message, detail);
}
function record(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('SEARCH_CONTRACT_INVALID', name + ' must be an object');
  }
  return value;
}
function nonempty(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    fail('SEARCH_SCOPE_INVALID', name + ' must be a nonempty string without NUL');
  }
  return value;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function argumentsKey(value) {
  return JSON.stringify(Object.keys(value).sort().map(key => [key, value[key]]));
}
function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }

// Preserve quoted text and escapes. Whitespace outside quotes is insignificant.
function queryTokens(text) {
  nonempty(text, 'search expression');
  const tokens = [];
  let token = '', quoted = false, escaped = false;
  for (const character of text.trim()) {
    if (escaped) { token += character; escaped = false; continue; }
    if (character === '\\') { token += character; escaped = true; continue; }
    if (character === '"') { token += character; quoted = !quoted; continue; }
    if (/\s/u.test(character) && !quoted) {
      if (token) tokens.push(token);
      token = '';
    } else token += character;
  }
  if (quoted || escaped) {
    fail('SEARCH_SCOPE_INVALID', 'Search expression contains an unfinished quote or escape');
  }
  if (token) tokens.push(token);
  return tokens;
}
function expressionKey(text) {
  const tokens = queryTokens(text);
  // Conjunctive lexical terms and filters may be reordered by the renderer.
  // Boolean/grouped expressions retain their original ordering.
  const complex = tokens.some(token => /^(?:OR|AND|NOT)$/i.test(token) ||
    (!token.startsWith('"') && /[()]/.test(token)));
  return JSON.stringify(complex ? tokens : tokens.slice().sort());
}
function sameExpression(left, right) {
  try { return expressionKey(left) === expressionKey(right); }
  catch (_) { return false; }
}

/** Compile documented channel mentions without resolving or broadening scope.
 * Call before starting a cursor chain and retain both original and wire args.
 * A cursor already obtained under another expression cannot be transplanted.
 */
function normalizeSlackSearchChannelScopes(originalArgs) {
  record(originalArgs, 'original search arguments');
  const args = clone(originalArgs), changes = [];
  for (const field of ['query', 'filters']) {
    if (args[field] === undefined) continue;
    if (typeof args[field] !== 'string' || args[field].includes('\0')) {
      fail('SEARCH_SCOPE_INVALID', field + ' must be a string without NUL');
    }
    if (!args[field].trim()) continue;
    queryTokens(args[field]); // Validate complete quotes/escapes first.
    const value = args[field];
    let start = 0, quoted = false, escaped = false, out = '';
    const append = end => {
      const token = value.slice(start, end);
      const match = /^in:([CG][A-Z0-9]{1,127})$/.exec(token);
      if (match) {
        const replacement = 'in:<#' + match[1] + '>';
        changes.push({field, start, end, channel_id: match[1],
          original: token, normalized: replacement});
        out += replacement;
      } else out += token;
    };
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { quoted = !quoted; continue; }
      if (!quoted && /\s/u.test(ch)) {
        append(i); out += ch; start = i + 1;
      }
    }
    append(value.length);
    args[field] = out;
  }
  if (changes.length && args.cursor !== undefined) {
    fail('SEARCH_CHANNEL_CURSOR_RESTART_REQUIRED',
      'Retain the existing cursor chain. Normalize channel IDs only in an explicit fresh search request.',
      {changes, cursor_preserved: args.cursor});
  }
  return {schema: 'commons.slack_search_channel_scope/v1',
    original_args: clone(originalArgs), args, changes,
    scope: 'same_literal_channel_identity', native_calls: 0};
}

function structuredIntent(args) {
  const keywords = args.keywords === undefined ? [] : args.keywords;
  if (!Array.isArray(keywords) || keywords.some(word => typeof word !== 'string')) {
    fail('SEARCH_SCOPE_INVALID', 'keywords must be an array of lexical strings');
  }
  for (const keyword of keywords) {
    const tokens = queryTokens(keyword);
    if (tokens.length !== 1 || keyword.trim() !== keyword ||
        (/\s/u.test(keyword) && !(keyword.startsWith('"') && keyword.endsWith('"')))) {
      fail('SEARCH_SCOPE_INVALID', 'Each keyword must be one word or one quoted phrase');
    }
  }
  const filters = args.filters === undefined ? '' : args.filters;
  if (typeof filters !== 'string' || filters.includes('\0')) {
    fail('SEARCH_SCOPE_INVALID', 'filters must be a string without NUL');
  }
  if (filters.trim()) queryTokens(filters);
  return {keywords: keywords.slice(), filters,
    expression: [...keywords, filters.trim()].filter(Boolean).join(' ')};
}
function inferStructuredQuery(query) {
  const keywords = [], filters = [];
  for (const token of queryTokens(query)) {
    if (/^(?:OR|AND|NOT)$/i.test(token) ||
        (!token.startsWith('"') && /[()]/.test(token))) {
      fail('SEARCH_SCOPE_NOT_REPRESENTABLE',
        'This Boolean search requires an advertised query field or explicit structured intent');
    }
    if (LEGACY_FILTER.test(token)) filters.push(token);
    else if (/^[A-Za-z_][\w-]*:/.test(token)) {
      fail('SEARCH_SCOPE_NOT_REPRESENTABLE', 'An unknown search modifier cannot become a keyword');
    } else keywords.push(token);
  }
  return {keywords, filters: filters.join(' '), expression: query};
}

/** Accept only the schema for this exact advertised tool, not an aggregate inventory. */
function describeSlackSearchContract(contract, expectedName) {
  record(contract, 'discovered tool contract');
  const name = contract.name ?? contract.function?.name;
  if (name !== expectedName) {
    fail('SEARCH_BINDING_CHANGED', 'Rediscovery must retain the exact original tool binding');
  }
  const schema = record(contract.inputSchema ?? contract.parameters ??
    contract.function?.parameters, 'discovered input schema');
  const properties = record(schema.properties, 'discovered input properties');
  const required = schema.required ?? [];
  if (!Array.isArray(required) || required.some(key => typeof key !== 'string' || !own(properties, key))) {
    fail('SEARCH_CONTRACT_INVALID', 'required fields must name advertised properties');
  }
  if (!own(properties, 'query') && !own(properties, 'keywords') && !own(properties, 'filters')) {
    fail('SEARCH_CONTRACT_INVALID', 'The selected tool advertises no lexical search scope');
  }
  const signature = JSON.stringify({name, properties: Object.keys(properties).sort(),
    required: required.slice().sort()});
  return {name, properties, required, signature};
}

/** Compile one original intent without adding a field absent from fresh discovery. */
function compileSlackSearchArgs(originalArgs, contract, expectedName) {
  record(originalArgs, 'original search arguments');
  const normalized = normalizeSlackSearchChannelScopes(originalArgs);
  const args = normalized.args;
  const described = describeSlackSearchContract(contract, expectedName);
  const supports = key => own(described.properties, key);
  let intent = structuredIntent(args);
  const hasQuery = args.query !== undefined;
  if (hasQuery) {
    nonempty(args.query, 'query');
    queryTokens(args.query);
    if (intent.expression && !sameExpression(args.query, intent.expression)) {
      fail('SEARCH_SCOPE_CONFLICT', 'query and structured fields describe different searches');
    }
    if (!intent.expression) {
      intent = supports('query') && !described.required.includes('keywords') &&
        !described.required.includes('filters')
        ? {keywords: [], filters: '', expression: args.query}
        : structuredIntent(inferStructuredQuery(args.query));
    }
  }
  nonempty(intent.expression, 'lexical search scope');
  const result = Object.create(null);
  if (supports('query')) {
    result.query = intent.expression;
    // Supply required structured companions only when both representations agree.
    if (described.required.includes('keywords')) result.keywords = intent.keywords;
    if (described.required.includes('filters')) result.filters = intent.filters;
  } else {
    if (intent.keywords.length && !supports('keywords') || intent.filters.trim() && !supports('filters')) {
      fail('SEARCH_SCOPE_NOT_REPRESENTABLE', 'The discovered binding cannot retain every lexical restriction');
    }
    if (supports('keywords') && (intent.keywords.length || described.required.includes('keywords'))) {
      result.keywords = intent.keywords;
    }
    if (supports('filters') && (intent.filters || described.required.includes('filters'))) {
      result.filters = intent.filters;
    }
  }
  if (args.limit !== undefined && args.count !== undefined && args.limit !== args.count) {
    fail('SEARCH_SCOPE_CONFLICT', 'limit and count disagree');
  }
  for (const [key, value] of Object.entries(args)) {
    if (SCOPE_FIELDS.has(key) || value === undefined) continue;
    if (key === 'natural_language_query' && value === '' && !supports(key)) continue;
    let target = key;
    if (key === 'limit' && !supports(key) && supports('count')) target = 'count';
    if (key === 'count' && !supports(key) && supports('limit')) target = 'limit';
    if (!supports(target)) {
      // Even numeric timestamp bounds and channel-type restrictions are retained.
      // They must never be approximated as dates or dropped for compatibility.
      fail('SEARCH_ARGUMENT_UNSUPPORTED', 'Fresh discovery does not accept original field: ' + key,
        {field: key, tool_name: expectedName});
    }
    if (target === 'limit' || target === 'count') {
      const maximum = described.properties[target]?.maximum;
      if (!Number.isSafeInteger(value) || value < 1 ||
          (typeof maximum === 'number' && value > maximum)) {
        fail('SEARCH_SCOPE_INVALID', target + ' is outside the advertised result limit');
      }
    }
    Object.defineProperty(result, target, {value, enumerable: true, writable: true, configurable: true});
  }
  for (const key of described.required) {
    if (!own(result, key)) fail('SEARCH_ARGUMENT_REQUIRED', 'Fresh discovery requires field: ' + key);
  }
  return {tool_name: expectedName, args: clone(result), original_args: clone(originalArgs),
    channel_scope: normalized,
    expected_query: intent.expression, contract_signature: described.signature};
}

function nativeFailure(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    (value.ok === false || value.isError === true || value.is_error === true ||
     (typeof value.error_code === 'string' && typeof value.error === 'string'));
}
function renderedEcho(text) {
  if (typeof text !== 'string' || text.length > MAX_TEXT) return null;
  // Only the renderer's first nonempty line is authoritative. Never search a
  // message body for a copied heading or inspect nested customer message text.
  const first = text.trimStart().split(/\r?\n/, 1)[0];
  const match = /^(?:#{1,6}\s+)?Search Results for:\s*(.*)$/.exec(first);
  return match ? match[1].trim() : null;
}

/** Inspect transport envelopes only. Preserve the original response separately. */
function inspectSlackSearchScope(response, expectedQuery, options = {}) {
  nonempty(expectedQuery, 'expected query');
  const requireEcho = options.require_echo !== false;
  const echoes = [], seen = new Set();
  let failure = false, oversized = false;
  function inspect(value, depth) {
    if (depth > 6 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      if (value.length > MAX_TEXT) { oversized = true; return; }
      const echo = renderedEcho(value);
      if (echo !== null) { echoes.push(echo); return; }
      const text = value.trim();
      if (text.startsWith('{')) {
        try { inspect(JSON.parse(text), depth + 1); } catch (_) { /* opaque text */ }
      }
      return;
    }
    if (typeof value !== 'object' || Array.isArray(value) || seen.has(value)) return;
    seen.add(value);
    if (nativeFailure(value)) { failure = true; return; }
    if (typeof value.query === 'string' &&
        (own(value, 'ok') || own(value, 'messages') || own(value, 'files') || own(value, 'results'))) {
      echoes.push(value.query);
    }
    if (typeof value.results === 'string') {
      const echo = renderedEcho(value.results);
      if (echo !== null) echoes.push(echo);
    }
    if (value.structuredContent) inspect(value.structuredContent, depth + 1);
    if (typeof value.text === 'string') inspect(value.text, depth + 1);
    if (value.result && typeof value.result === 'object') inspect(value.result, depth + 1);
    if (Array.isArray(value.content)) {
      for (const part of value.content) {
        if (part?.type === 'text' && typeof part.text === 'string') inspect(part.text, depth + 1);
      }
    }
  }
  inspect(response, 0);
  if (failure) return {status: 'NATIVE_ERROR', expected_query: expectedQuery, observed_queries: echoes};
  if (!echoes.length) return {status: requireEcho ? 'UNCONFIRMED' : 'UNOBSERVED',
    code: oversized ? 'SEARCH_RESPONSE_TOO_LARGE' : 'SEARCH_QUERY_ECHO_MISSING',
    expected_query: expectedQuery, observed_queries: []};
  const bad = echoes.find(echo => !echo.trim() || !sameExpression(echo, expectedQuery));
  if (bad !== undefined) return {status: 'MISMATCH',
    code: bad.trim() ? 'SEARCH_QUERY_ECHO_MISMATCH' : 'SEARCH_QUERY_ECHO_EMPTY',
    expected_query: expectedQuery, observed_queries: echoes};
  return {status: 'MATCHED', expected_query: expectedQuery, observed_queries: echoes};
}

function stoppedResponse(code, message, detail, nativeResponse) {
  const result = {ok: false, isError: true, error_code: code, error: message, error_data: detail};
  if (nativeResponse !== undefined) result.native_response = nativeResponse;
  return result;
}

/**
 * Wrap only the existing search bindings. Every invocation makes zero or one
 * native call, so collectSlackPages' native-call budget remains truthful.
 */
function createScopeCheckedSlackTools(tools, options) {
  record(tools, 'original native tools');
  record(options, 'scope adapter options');
  const contracts = clone(record(options.contracts, 'discovered contracts'));
  const continuation = options.continuation ? clone(options.continuation) : null;
  if (continuation && (continuation.schema !== 'commons.slack_search_scope_continuation/v1' ||
      continuation.maximum_native_calls !== 1 || continuation.original_native_attempts !== 1)) {
    fail('SEARCH_RECOVERY_INVALID', 'Supply the exact one-call continuation plan');
  }
  let continuationUsed = false;
  const bindings = {...SEARCH_BINDINGS, ...(options.bindings ?? {})};
  const observe = options.onObservation;
  if (observe !== undefined && typeof observe !== 'function') {
    fail('SEARCH_CONTRACT_INVALID', 'onObservation must be a function');
  }
  const wrapped = Object.create(tools);
  for (const operation of Object.keys(SEARCH_BINDINGS)) {
    const name = bindings[operation];
    if (!own(contracts, name)) continue;
    nonempty(name, 'search binding');
    const native = tools[name];
    if (typeof native !== 'function') fail('SEARCH_BINDING_UNAVAILABLE', 'Original tool is unavailable: ' + name);
    // Validate once without mutating or inventing a discovery record.
    describeSlackSearchContract(contracts[name], name);
    Object.defineProperty(wrapped, name, {enumerable: true, value: async originalArgs => {
      let compiled;
      try { compiled = compileSlackSearchArgs(originalArgs, contracts[name], name); }
      catch (error) {
        if (!(error instanceof SlackSearchScopeError)) throw error;
        return stoppedResponse(error.code, error.message, {operation, tool_name: name,
          native_calls: 0, ...error.detail});
      }
      const continuing = continuation?.tool_name === name;
      if (continuing && (continuationUsed || continuation.operation !== operation ||
          continuation.contract_signature !== compiled.contract_signature ||
          argumentsKey(continuation.compiled_args) !== argumentsKey(compiled.args))) {
        return stoppedResponse('SEARCH_RECOVERY_EXHAUSTED',
          'The retained continuation authorizes one call with its exact argument binding.',
          {operation, tool_name: name, native_calls: 0});
      }
      if (continuing) continuationUsed = true;
      const nativeAttempts = continuing ? 2 : 1;
      const response = await native.call(tools, compiled.args);
      const inspection = inspectSlackSearchScope(response, compiled.expected_query,
        {require_echo: options.require_echo !== false});
      const observation = {schema: 'commons.slack_search_scope/v1', operation,
        tool_name: name, native_calls: 1, native_attempts: nativeAttempts, compiled, inspection};
      if (observe) {
        try { await observe(observation, response); }
        catch (error) {
          return stoppedResponse('SEARCH_SCOPE_CUSTODY_FAILED',
            'The original search response arrived, but its custody callback failed.',
            {...observation, callback_error: String(error?.message ?? error).slice(0, 1200)}, response);
        }
      }
      if (['MATCHED', 'UNOBSERVED', 'NATIVE_ERROR'].includes(inspection.status)) return response;
      return stoppedResponse(inspection.code,
        'Slack search did not confirm the original query. Retain this response and refresh this same tool contract before continuation.',
        {...observation, recovery: {same_tool_only: true, discovery_required: true,
          original_args: compiled.original_args, previous_native_args: compiled.args,
          previous_contract_signature: compiled.contract_signature,
          native_attempts: nativeAttempts, maximum_recovery_attempts: 1}}, response);
    }});
  }
  return wrapped;
}

/** Plan an explicit second call after fresh discovery; never call discovery or transport. */
function planSlackSearchScopeContinuation(failedResponse, freshContract) {
  const response = record(failedResponse, 'failed scope response');
  const data = record(response.error_data, 'scope failure detail');
  const recovery = record(data.recovery, 'scope recovery');
  if (!['SEARCH_QUERY_ECHO_EMPTY', 'SEARCH_QUERY_ECHO_MISMATCH', 'SEARCH_QUERY_ECHO_MISSING']
      .includes(response.error_code) || recovery.native_attempts !== 1 ||
      recovery.maximum_recovery_attempts !== 1) {
    fail('SEARCH_RECOVERY_UNAVAILABLE', 'Only one retained scope failure may prepare one continuation');
  }
  const next = compileSlackSearchArgs(recovery.original_args, freshContract, data.tool_name);
  if (next.contract_signature === recovery.previous_contract_signature ||
      argumentsKey(next.args) === argumentsKey(recovery.previous_native_args)) {
    fail('SEARCH_RECOVERY_UNCHANGED', 'Rediscovery supplied no changed, representable argument binding');
  }
  return {schema: 'commons.slack_search_scope_continuation/v1', operation: data.operation,
    tool_name: data.tool_name, args: clone(recovery.original_args), compiled_args: next.args,
    contract: clone(freshContract), contract_signature: next.contract_signature,
    maximum_native_calls: 1, original_native_attempts: 1,
    on_repeat_failure: 'STOP_AND_RETAIN_ORIGINAL_SCOPE',
    // The native opaque cursor, when present, remains exactly the caller's value.
    cursor: next.args.cursor ?? null};
}

module.exports = {SEARCH_BINDINGS, SlackSearchScopeError, describeSlackSearchContract,
  normalizeSlackSearchChannelScopes, compileSlackSearchArgs, inspectSlackSearchScope, createScopeCheckedSlackTools,
  planSlackSearchScopeContinuation};
