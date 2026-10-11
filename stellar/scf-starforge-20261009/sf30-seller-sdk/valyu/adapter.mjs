// MIT. Fixed Valyu provider composition over the original SF30 HTTP transport.
import { lookup as dnsLookup } from 'node:dns/promises';
import { createUpstreamHandler, UPSTREAM_ATTEMPT } from '../upstream-handler.mjs';
import { isPublicAddress } from '../../sf31-buyer-client/public-transport.mjs';
import { normalizeValyuProvider, normalizeValyuRequest, VALYU_ROUTE, VALYU_SOURCE } from './config.mjs';
import { projectValyuDelivery, valyuUpstreamSha256, assertValyuDelivery } from './delivery.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const need = (value, message) => { if (!value) throw new TypeError(message); };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;
const failure = (status, error, message, extra = {}) => ({ status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  body: { error, ...(message ? { message } : {}), ...extra } });

/** Complete provider response, including structured payloads and future metadata. */
export function validateValyuSearchResponse(input, { request = {} } = {}) {
  need(plain(input) && typeof input.success === 'boolean', 'Valyu response must contain success');
  need(typeof input.tx_id === 'string' && input.tx_id.trim() && input.tx_id.length <= 4096,
    'Valyu response must contain its provider transaction ID');
  if (input.success === false) {
    const error = new Error('The Valyu provider reported an unsuccessful search');
    error.code = 'VALYU_SEARCH_FAILED';
    error.providerTxId = input.tx_id;
    throw error;
  }
  need(typeof input.query === 'string' && Array.isArray(input.results) && plain(input.results_by_source) &&
    nonnegativeInteger(input.results_by_source.web) && nonnegativeInteger(input.results_by_source.proprietary) &&
    finite(input.total_deduction_dollars) && input.total_deduction_dollars >= 0 &&
    nonnegativeInteger(input.total_characters), 'Valyu result and usage fields are incomplete');
  if (input.error !== undefined && input.error !== null)
    need(typeof input.error === 'string', 'Valyu error or warning must be text');
  if (input.warnings !== undefined)
    need(Array.isArray(input.warnings) && input.warnings.every(value => typeof value === 'string'),
      'Valyu warnings must be strings');
  for (const result of input.results) {
    need(plain(result) && ['title', 'url', 'source'].every(key => typeof result[key] === 'string') &&
      finite(result.price) && result.price >= 0 && nonnegativeInteger(result.length),
      'Valyu result identity, price or length is incomplete');
    if (result.content === undefined && request.url_only === true) continue;
    need(typeof result.content === 'string' || plain(result.content) ||
      Array.isArray(result.content) && result.content.every(plain),
      'Valyu content must be text, an object or an array of objects');
  }
  return input;
}

function requestContext(context, provider) {
  need(plain(context) && context.method === VALYU_ROUTE.method && context.url instanceof URL &&
    context.url.pathname === VALYU_ROUTE.path && context.url.search === '' &&
    context.bodyPresent !== false && (context.bodyType === undefined || context.bodyType === 'json') &&
    (context.multipart === undefined || context.multipart === null), 'Use POST /research/search with a JSON body');
  const body = normalizeValyuRequest(context.body, { defaults: provider.defaults, limits: provider.limits });
  const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
  need(rawBody.length <= provider.maxRequestBytes, 'Search exceeds this merchant request byte limit');
  return { ...context, body, rawBody, bodyPresent: true, bodyType: 'json', multipart: null };
}
export function createValyuAdmission(providerInput = {}) {
  const provider = normalizeValyuProvider(providerInput);
  return context => {
    try { context?.signal?.throwIfAborted(); requestContext(context, provider); return true; }
    catch (error) {
      if (context?.signal?.aborted) throw error;
      return failure(400, 'INVALID_VALYU_QUERY', error.message);
    }
  };
}

/** The target is fixed; source filters are body data and cannot choose an egress URL. */
function valyuLookup(host, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  Promise.resolve().then(async () => {
    need(host === 'api.valyu.ai', 'Unexpected Valyu hostname');
    const addresses = await dnsLookup(host, { all: true, verbatim: true });
    need(addresses.length > 0 && addresses.every(row => isPublicAddress(row.address)),
      'Valyu hostname did not resolve to public addresses');
    const family = typeof options === 'number' ? options : options?.family ?? 0;
    const selected = family ? addresses.filter(row => row.family === family) : addresses;
    need(selected.length > 0, 'Valyu hostname has no requested address family');
    return options?.all ? callback(null, selected) : callback(null, selected[0].address, selected[0].family);
  }).catch(error => callback(error));
}

/** Native SF30 handles verification, authorization, cancellation and settlement.
 * upstreamFactory is an explicit trusted embedding seam, never a customer field. */
export function createValyuAdapter({ provider: providerInput = {}, apiKey, env = process.env,
  upstreamFactory = createUpstreamHandler, lookup = valyuLookup } = {}) {
  const provider = normalizeValyuProvider(providerInput);
  const credential = apiKey ?? (env !== null && typeof env === 'object' && !Array.isArray(env) &&
    Object.hasOwn(env, provider.apiKeyEnv) ? env[provider.apiKeyEnv] : undefined);
  need(typeof credential === 'string' && credential.length > 0 && credential.length <= 4096 &&
    credential === credential.trim() && !/[\u0000-\u0020\u007f]/.test(credential),
    'The server credential environment reference must contain the existing Valyu API key');
  need(typeof upstreamFactory === 'function' && typeof lookup === 'function', 'Trusted upstream constructor and resolver required');
  const upstream = upstreamFactory({ baseUrl: 'https://api.valyu.ai', path: '/v1/search',
    method: 'POST', bodyType: 'json', headers: { 'x-api-key': credential },
    requestHeaders: [], responseHeaders: ['content-type'], responseType: 'json',
    timeoutMs: provider.timeoutMs, maxResponseBytes: provider.maxResponseBytes,
    maxRequestBytes: provider.maxRequestBytes, maxInFlight: provider.maxInFlight, lookup });
  need(typeof upstream === 'function', 'Original upstream constructor must return a handler');
  const admission = createValyuAdmission(provider), active = new Set();
  const counters = { acceptedSearchResponses: 0, providerFailures: 0, invalidProviderResponses: 0, responsesWithWarnings: 0 };
  let closed = false;
  function carryAttempt(next, previous) {
    if (previous?.[UPSTREAM_ATTEMPT] !== undefined)
      Object.defineProperty(next, UPSTREAM_ATTEMPT, { value: previous[UPSTREAM_ATTEMPT] });
    return next;
  }
  async function valyuSearch(context) {
    if (closed) return failure(503, 'VALYU_ADAPTER_CLOSED');
    let request;
    try { request = requestContext(context, provider); }
    catch (error) { return failure(400, 'INVALID_VALYU_QUERY', error.message); }
    context.signal?.throwIfAborted();
    const cancellation = new AbortController();
    active.add(cancellation);
    request.signal = context.signal ? AbortSignal.any([context.signal, cancellation.signal]) : cancellation.signal;
    try {
      const response = await upstream(request);
      request.signal.throwIfAborted();
      if (!response || !Number.isInteger(response.status)) {
        counters.invalidProviderResponses++;
        return failure(502, 'VALYU_RESPONSE_INVALID');
      }
      // The original transport preserves 429/503 and Retry-After, rejects
      // redirects/auth/payment failures, bounds compressed+decoded bytes and
      // finishes its single attempt before this native settlement boundary.
      if (response.status < 200 || response.status >= 300) return response;
      let value, upstreamSha256;
      try {
        need([200, 206].includes(response.status) && Buffer.isBuffer(response.body) &&
          response.body.length <= provider.maxResponseBytes, 'Valyu must return complete buffered HTTP 200 or 206 JSON');
        upstreamSha256 = valyuUpstreamSha256(response.body);
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body));
        validateValyuSearchResponse(value, { request: request.body });
      } catch (error) {
        if (error.code === 'VALYU_SEARCH_FAILED') {
          counters.providerFailures++;
          return carryAttempt(failure(502, error.code, undefined, { providerStatus: response.status,
            providerTxId: error.providerTxId, upstreamSha256 }), response);
        }
        counters.invalidProviderResponses++;
        return carryAttempt(failure(502, 'VALYU_RESPONSE_INVALID', undefined,
          { providerStatus: response.status }), response);
      } finally {
        // The original buyer can retain only the projected delivery, never this
        // complete publisher response. Clear the finished transport buffer.
        if (Buffer.isBuffer(response.body)) response.body.fill(0);
      }
      const delivery = projectValyuDelivery(value, { request: request.body,
        profile: provider.deliveryProfile, upstreamSha256, httpStatus: response.status });
      assertValyuDelivery(delivery, { profile: provider.deliveryProfile, request: request.body, upstreamSha256 });
      const body = Buffer.from(JSON.stringify(delivery), 'utf8');
      if (body.length > provider.maxResponseBytes)
        return carryAttempt(failure(502, 'VALYU_DELIVERY_TOO_LARGE'), response);
      counters.acceptedSearchResponses++;
      if (value.error || value.warnings?.length) counters.responsesWithWarnings++;
      // The source profile is server-owned; customer requests cannot add a
      // license or put request-only bytes into original buyer storage.
      return carryAttempt({ status: response.status, headers: { 'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store' }, body }, response);
    } finally { active.delete(cancellation); }
  }
  valyuSearch.admit = admission;
  const snapshot = () => ({ schema: 'stellar-forge.valyu-search-status.v1', capturedAt: new Date().toISOString(),
    endpoint: VALYU_SOURCE.endpoint, closed, ...counters,
    transport: typeof upstream.snapshot === 'function' ? upstream.snapshot() : null });
  valyuSearch.snapshot = snapshot;
  return Object.freeze({ handlers: Object.freeze({ valyuSearch, admitValyuSearch: admission }),
    publicProviderConfig: provider, snapshot,
    async close() {
      if (closed) return;
      closed = true;
      for (const controller of active) controller.abort(Object.assign(new Error('Valyu adapter closed'), { code: 'UPSTREAM_ABORTED' }));
    } });
}
