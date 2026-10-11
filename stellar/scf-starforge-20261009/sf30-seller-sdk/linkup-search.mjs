// MIT. Linkup product composition over the original SF30 upstream transport.
import { createUpstreamHandlers, closeUpstreamHandlers } from './upstream.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const need = (value, message) => { if (!value) throw new TypeError(message); };
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};

export const LINKUP_SOURCE = freeze({
  api: 'https://api.linkup.so/v1/search',
  reference: 'https://docs.linkup.so/pages/documentation/endpoints/search/reference',
  overview: 'https://docs.linkup.so/pages/documentation/endpoints/search/overview',
  sdk: 'https://github.com/LinkupPlatform/linkup-js-sdk/tree/832dbecf81f0728dc9e00cdf9f4355a625e219d5',
});

export const LINKUP_OPERATIONS = freeze({
  linkupSearch: { id: 'linkup-search', path: '/research/linkup/search', depth: 'standard', outputType: 'searchResults' },
  linkupAnswer: { id: 'linkup-answer', path: '/research/linkup/answer', depth: 'standard', outputType: 'sourcedAnswer' },
});

// The provider's documentation examples omit favicon; its SDK types include it.
// Accept both documented forms, preserve that field and all future extra fields.
const sourceProperties = { name: { type: 'string' }, url: { type: 'string' }, favicon: { type: 'string' } };
export const LINKUP_RESPONSE_SCHEMAS = freeze({
  searchResults: { type: 'object', required: ['results'], properties: {
    results: { type: 'array', items: { type: 'object', required: ['type', 'name', 'url', 'content'],
      properties: { ...sourceProperties, type: { const: 'text' }, content: { type: 'string' } } } },
  } },
  sourcedAnswer: { type: 'object', required: ['answer', 'sources'], properties: {
    answer: { type: 'string' },
    sources: { type: 'array', items: { type: 'object', required: ['name', 'url', 'snippet'],
      properties: { ...sourceProperties, snippet: { type: 'string' } } } },
  } },
});

function date(value) {
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1970-01-01', 'Invalid search date');
  const parsed = new Date(value + 'T00:00:00.000Z');
  need(Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value, 'Invalid search date');
  return value;
}

/** Validate the merchant's public query/filter contract without changing its text. */
export function linkupRequestBody(input, operation) {
  need(Object.values(LINKUP_OPERATIONS).includes(operation), 'Original Linkup operation required');
  const keys = ['query', 'includeDomains', 'excludeDomains', 'fromDate', 'toDate', 'maxResults'];
  need(plain(input) && Object.keys(input).every(key => keys.includes(key)), 'Invalid Linkup query fields');
  need(typeof input.query === 'string' && input.query.trim() && Buffer.byteLength(input.query, 'utf8') <= 8000,
    'Linkup query must be nonblank and at most 8000 UTF-8 bytes');
  const body = { q: input.query, depth: operation.depth, outputType: operation.outputType, includeImages: false };
  if (operation.outputType === 'sourcedAnswer') body.includeInlineCitations = true;
  for (const key of ['includeDomains', 'excludeDomains']) {
    if (!Object.hasOwn(input, key)) continue;
    need(Array.isArray(input[key]) && input[key].length <= 100 && input[key].every(value =>
      typeof value === 'string' && value.trim() && !/[\u0000-\u0020\u007f]/.test(value) &&
      Buffer.byteLength(value, 'utf8') <= 512), 'Search domain filters must contain at most 100 nonblank domain strings');
    body[key] = [...input[key]];
  }
  for (const key of ['fromDate', 'toDate']) if (Object.hasOwn(input, key)) body[key] = date(input[key]);
  need(body.fromDate === undefined || body.toDate === undefined || body.fromDate < body.toDate,
    'fromDate must precede toDate');
  if (Object.hasOwn(input, 'maxResults')) {
    need(Number.isSafeInteger(input.maxResults) && input.maxResults >= 1 && input.maxResults <= 100,
      'Merchant maxResults must be an integer from 1 to 100');
    body.maxResults = input.maxResults;
  }
  need(Buffer.byteLength(JSON.stringify(body), 'utf8') <= 65536, 'Linkup request exceeds 64 KiB');
  return body;
}

function sourceContext(context, operation) {
  need(plain(context) && context.method === 'POST' && context.url instanceof URL &&
    context.url.pathname === operation.path && context.url.search === '' &&
    context.bodyPresent !== false && (context.bodyType === undefined || context.bodyType === 'json') &&
    (context.multipart === undefined || context.multipart === null), 'Original Linkup JSON request required');
  const body = linkupRequestBody(context.body, operation);
  return { ...context, body, bodyPresent: true, bodyType: 'json',
    rawBody: Buffer.from(JSON.stringify(body), 'utf8'), multipart: null };
}

const invalid = () => ({ status: 400, headers: { 'content-type': 'application/json; charset=utf-8' },
  body: { error: 'INVALID_LINKUP_QUERY', message: 'Supply query and optional includeDomains, excludeDomains, fromDate, toDate or maxResults; use the selected fixed search or answer route.' } });

/**
 * The server owns one ordinary Linkup API account. Linkup's existing API-key and
 * Base x402 routes keep their own billing and behavior. These handlers add two
 * explicitly configured Stellar merchant offers over the original API-key path.
 * The original seller owns verification, authorization, settlement and recovery.
 */
export function createLinkupSearchHandlers(configuration, { env = process.env } = {}) {
  need(plain(configuration) && plain(configuration.bindings) &&
    Object.keys(configuration.bindings).length === 2 &&
    Object.keys(LINKUP_OPERATIONS).every(key => Object.hasOwn(configuration.bindings, key)),
    'Use both original Linkup search and answer bindings');
  const apiKey = env.LINKUP_API_KEY;
  need(typeof apiKey === 'string' && apiKey.length > 0 && apiKey.length <= 4096 &&
    apiKey === apiKey.trim() && !/[\u0000-\u0020\u007f]/.test(apiKey), 'Server LINKUP_API_KEY required');
  const bindings = structuredClone(configuration);
  for (const [name, operation] of Object.entries(LINKUP_OPERATIONS)) {
    const binding = bindings.bindings[name];
    need(plain(binding) && binding.origin === 'https://api.linkup.so' && binding.path === '/v1/search' &&
      binding.method === 'POST' && binding.responseMode === 'json' &&
      (binding.bodyType === undefined || binding.bodyType === 'json') &&
      plain(binding.headerEnv) && Object.keys(binding.headerEnv).length === 1 &&
      binding.headerEnv.authorization === 'LINKUP_AUTHORIZATION' &&
      (binding.query === undefined || Array.isArray(binding.query) && binding.query.length === 0) &&
      (binding.requestHeaders === undefined || Array.isArray(binding.requestHeaders) && binding.requestHeaders.length === 0) &&
      ['oauth2', 'cache', 'idempotency', 'stream', 'responseContract'].every(key => !Object.hasOwn(binding, key)),
      'Linkup requires fixed POST /v1/search JSON with server-owned API authorization');
    binding.responseContract = { schema: 'stellar-forge.upstream-response-contract.v1', method: 'POST',
      responses: { '200': { content: { 'application/json': LINKUP_RESPONSE_SCHEMAS[operation.outputType] } } } };
  }
  // A private derived environment, never process.env, buyer headers or metadata.
  const upstreams = createUpstreamHandlers(bindings, { env: { ...env, LINKUP_AUTHORIZATION: `Bearer ${apiKey}` } });
  const handlers = {};
  for (const [name, operation] of Object.entries(LINKUP_OPERATIONS)) {
    const original = upstreams[name];
    const admit = context => {
      let request;
      try { request = sourceContext(context, operation); } catch { return invalid(); }
      return original.admit?.(request) ?? true;
    };
    const handler = context => {
      let request;
      try { request = sourceContext(context, operation); } catch { return invalid(); }
      return original(request);
    };
    handler.admit = admit;
    handler.snapshot = original.snapshot;
    handlers[name] = handler;
    handlers[`admit${name[0].toUpperCase()}${name.slice(1)}`] = admit;
  }
  return Object.freeze({ handlers: Object.freeze(handlers),
    close: () => closeUpstreamHandlers(upstreams),
    snapshot: () => ({ schema: 'stellar-forge.linkup-search-status.v1', capturedAt: new Date().toISOString(),
      operations: Object.entries(LINKUP_OPERATIONS).map(([name, operation]) => ({ ...operation,
        ...upstreams[name].snapshot() })) }),
  });
}
