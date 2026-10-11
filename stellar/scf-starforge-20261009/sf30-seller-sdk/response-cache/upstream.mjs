// MIT. One response-cache engine and the original SF30 upstream transport.
import { createHash } from 'node:crypto';
import { createUpstreamHandler } from '../upstream-handler.mjs';
import { createResponseCache } from './cache.mjs';
import { cacheDirectives, upstreamCacheBypass, upstreamFreshness } from './http-freshness.mjs';

const META = ['cache-control', 'vary', 'age', 'date', 'expires', 'pragma'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const failure = (status, error) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: { error } });

function frozenHeaders(value) {
  if (!plain(value)) throw new TypeError('Invalid upstream header configuration');
  const entries = Object.entries(value).map(([name, text]) => [name.toLowerCase(), text]).sort(([a], [b]) => a.localeCompare(b));
  if (entries.some(([, text]) => typeof text !== 'string') || new Set(entries.map(([name]) => name)).size !== entries.length) {
    throw new TypeError('Invalid upstream header configuration');
  }
  return Object.freeze(Object.fromEntries(entries));
}

/**
 * Opt-in reusable GET/HEAD application results. Returns the same control shape
 * as createResponseCache. Native SF30 still verifies and settles every delivery.
 * Trusted server headers are resolved once per application invocation, then
 * frozen in the ORIGINAL transport before selecting any cached result.
 */
export function createCachedUpstream(options, cacheOptions) {
  if (!plain(options) || !plain(cacheOptions)) throw new TypeError('Upstream and cache options required');
  const method = options.method ?? 'GET';
  if (!['GET', 'HEAD'].includes(method)) throw new TypeError('Cached upstream supports only GET and HEAD');
  if (Object.hasOwn(cacheOptions, 'handler') || Object.hasOwn(cacheOptions, 'storagePolicy') || Object.hasOwn(cacheOptions, 'bypassRequest')) {
    throw new TypeError('Upstream factory owns handler and HTTP cache policy hooks');
  }
  const { headers = {}, lookup, onResult, ...serializable } = options;
  const fixed = structuredClone(serializable);
  if (lookup !== undefined) fixed.lookup = lookup;
  if (onResult !== undefined) fixed.onResult = onResult;
  const headerFactory = typeof headers === 'function' ? headers : null;
  const staticHeaders = headerFactory ? null : frozenHeaders(headers);
  const expose = new Set((fixed.responseHeaders ?? ['content-type', 'content-language']).map(name => name.toLowerCase()));
  fixed.responseHeaders = [...new Set([...expose, ...META])];
  const forwarded = [...new Set((fixed.requestHeaders ?? []).map(name => name.toLowerCase()))];
  const varyHeaders = [...new Set([...forwarded, ...(cacheOptions.varyHeaders ?? [])])];
  const ttlMs = cacheOptions.ttlMs ?? 1000;
  const maxSourceInFlight = Math.min(cacheOptions.maxSourceInFlight ?? 16, fixed.maxInFlight ?? 16);
  const { admit, ...cacheData } = cacheOptions;
  const policy = { ...structuredClone(cacheData), ...(admit === undefined ? {} : { admit }), varyHeaders,
    maxSourceInFlight, maxResponseBytes: cacheOptions.maxResponseBytes ?? fixed.maxResponseBytes ?? 1048576 };
  // Original factories perform their complete construction-time validation.
  createUpstreamHandler({ ...fixed, headers: staticHeaders ?? {} });
  const admission = createResponseCache({ ...policy, handler: () => { throw new Error('Admission-only cache has no source'); } });
  const generations = new Set();
  const totals = { requests: 0, credentialUnavailable: 0, credentialRotations: 0, invalidations: 0,
    sourceStarted: 0, sourceCompleted: 0, sourceInFlight: 0, sourceFailed: 0, sourceResponseBytes: 0 };
  let current = null, sequence = 0, closed = false, closing;

  function release(generation) {
    if (generation !== current && generation.users === 0 && generation.active === 0) {
      generation.cache.close(); generations.delete(generation);
    }
  }
  function retire() {
    if (!current) return;
    const previous = current; current = null;
    previous.cache.invalidate(); release(previous);
  }
  function select(serverHeaders) {
    // This digest is only a private equality token, never a diagnostic or output.
    const fingerprint = createHash('sha256').update(JSON.stringify(serverHeaders)).digest('hex');
    if (current?.fingerprint === fingerprint) return current;
    const original = createUpstreamHandler({ ...fixed, headers: serverHeaders });
    if (current) { totals.credentialRotations++; retire(); }
    const generation = { fingerprint, number: ++sequence, users: 0, active: 0, cache: null };
    const authenticated = Object.hasOwn(serverHeaders, 'authorization');
    const source = async context => {
      if (closed) return failure(503, 'UPSTREAM_CACHE_CLOSED');
      if (totals.sourceInFlight >= maxSourceInFlight) return failure(503, 'UPSTREAM_CAPACITY_EXHAUSTED');
      totals.sourceStarted++; totals.sourceInFlight++; generation.active++;
      const requestTime = Date.now();
      try {
        const result = await original(context);
        totals.sourceCompleted++;
        if (result.status >= 400) totals.sourceFailed++;
        if (Buffer.isBuffer(result.body)) totals.sourceResponseBytes += result.body.length;
        return { ...result, cacheMetadata: { requestTime, responseTime: Date.now(), authenticated } };
      } finally {
        totals.sourceInFlight--; generation.active--; release(generation);
      }
    };
    generation.cache = createResponseCache({ ...policy, handler: source,
      bypassRequest: context => upstreamCacheBypass(context.headers) !== null,
      storagePolicy: result => {
        const decision = upstreamFreshness(result, { ttlMs, ...result.cacheMetadata });
        return { cacheable: decision.cacheable, ttlMs: decision.ttlMs };
      },
    });
    current = generation; generations.add(generation);
    return generation;
  }

  async function handler(context) {
    totals.requests++;
    if (closed) return failure(503, 'UPSTREAM_CACHE_CLOSED');
    if (!plain(context) || context.method !== method || !(context.url instanceof URL)) return failure(400, 'UPSTREAM_REQUEST_INVALID');
    if (context.signal?.aborted) return failure(499, 'UPSTREAM_REQUEST_ABORTED');
    // This application cache does not implement HTTP only-if-cached/revalidation.
    // Refuse the former explicitly rather than accidentally contacting a backend.
    if (cacheDirectives(context.headers?.['cache-control'])?.has('only-if-cached')) return failure(504, 'UPSTREAM_CACHE_ONLY_IF_CACHED_UNSUPPORTED');
    let generation;
    try { generation = select(headerFactory ? frozenHeaders(headerFactory()) : staticHeaders); }
    catch { totals.credentialUnavailable++; return failure(503, 'UPSTREAM_CONFIGURATION_UNAVAILABLE'); }
    // The generic cache removes hop fields before invoking source. Preserve the
    // original transport's Connection-nominated header removal before that step.
    const incoming = { ...(context.headers ?? {}) };
    const connection = incoming.connection;
    const nominated = new Set((Array.isArray(connection) ? connection.join(',') : typeof connection === 'string' ? connection : '')
      .split(',').map(name => name.trim().toLowerCase()).filter(Boolean));
    for (const name of forwarded) if (nominated.has(name)) delete incoming[name];
    generation.users++;
    try {
      const result = await generation.cache.handler({ ...context, headers: incoming });
      const outward = { ...result.headers };
      for (const name of META) if (!expose.has(name)) delete outward[name];
      // Cache metadata is never a seller response field, even for a bypass.
      return { status: result.status, headers: outward, body: result.body };
    } finally { generation.users--; release(generation); }
  }

  const stats = () => Object.freeze({ schema: 'stellar-forge.upstream-response-cache.v1', ...totals,
    generation: current?.number ?? null, retiredGenerations: generations.size - Number(current !== null),
    cache: current?.cache.stats() ?? null, closed });
  const invalidate = () => { totals.invalidations++; retire(); return Object.freeze({ generation: null }); };
  const close = options => {
    if (closing) return closing;
    closed = true;
    const pending = [admission.close(options), ...[...generations].map(generation => generation.cache.close(options))];
    current = null;
    closing = Promise.all(pending).then(() => {
      for (const generation of generations) release(generation);
      return stats();
    });
    return closing;
  };
  handler.admit = admission.admit;
  handler.snapshot = stats;
  return Object.freeze({ handler, admit: admission.admit, stats, invalidate, close });
}

/** Convenience export for existing application.mjs handler bindings. */
export function createCachedUpstreamHandler(options, cacheOptions) {
  const control = createCachedUpstream(options, cacheOptions);
  control.handler.cache = control;
  return control.handler;
}
