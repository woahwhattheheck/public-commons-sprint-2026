// MIT. One response-cache engine and the original SF30 upstream transport.
import { createHash } from 'node:crypto';
import { createUpstreamHandler, beginUpstreamRequest, resolveUpstreamHeaders } from '../upstream-handler.mjs';
import { createResponseCache, normalizeCacheRetention } from './cache.mjs';
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
  const { headers = {}, lookup, onResult, invokeSource, credentialProvider, supplierQuota, tls, agent, ...serializable } = options;
  if (invokeSource !== undefined && typeof invokeSource !== 'function') throw new TypeError('invokeSource must be a trusted source function');
  const fixed = structuredClone(serializable);
  if (lookup !== undefined) fixed.lookup = lookup;
  if (onResult !== undefined) fixed.onResult = onResult;
  if (supplierQuota !== undefined) fixed.supplierQuota = supplierQuota;
  // Native TLS contexts and the host-owned agent retain their identity across
  // cache generations; neither belongs in the serializable request declaration.
  if (tls !== undefined) fixed.tls = tls;
  if (agent !== undefined) fixed.agent = agent;
  const headerFactory = typeof headers === 'function' ? headers : null;
  const staticHeaders = headerFactory ? null : frozenHeaders(headers);
  const expose = new Set((fixed.responseHeaders ?? ['content-type', 'content-language']).map(name => name.toLowerCase()));
  fixed.responseHeaders = [...new Set([...expose, ...META])];
  fixed.cachePolicyMetadata = true;
  const forwarded = [...new Set((fixed.requestHeaders ?? []).map(name => name.toLowerCase()))];
  const varyHeaders = [...new Set([...forwarded, ...(cacheOptions.varyHeaders ?? [])])];
  let ttlMs = cacheOptions.ttlMs ?? 1000;
  const maxSourceInFlight = Math.min(cacheOptions.maxSourceInFlight ?? 16, fixed.maxInFlight ?? 16);
  const { admit, ...cacheData } = cacheOptions;
  const policy = { ...structuredClone(cacheData), ...(admit === undefined ? {} : { admit }), varyHeaders,
    maxSourceInFlight, maxResponseBytes: cacheOptions.maxResponseBytes ?? fixed.maxResponseBytes ?? 1048576 };
  // Original factories perform their complete construction-time validation.
  createUpstreamHandler({ ...fixed, headers: staticHeaders ?? {}, ...(credentialProvider ? {credentialProvider} : {}) });
  const admission = createResponseCache({ ...policy, handler: () => { throw new Error('Admission-only cache has no source'); } });
  const generations = new Set(), credentialWaiters = new Set();
  const maxCredentialWaiters = admission.stats().limits.maxWaiters;
  const totals = { requests: 0, credentialUnavailable: 0, credentialRotations: 0, invalidations: 0, credentialInFlight: 0,
    sourceStarted: 0, sourceCompleted: 0, sourceInFlight: 0, sourceFailed: 0, sourceResponseBytes: 0 };
  let current = null, sequence = 0, revision = 0, closed = false, closing;

  function release(generation) {
    if (generation !== current && generation.users === 0 && generation.active === 0) {
      generation.cache.close(); generations.delete(generation);
    }
  }
  function retire() {
    if (!current) return;
    const previous = current; current = null; revision++;
    previous.cache.invalidate(); release(previous);
  }
  function select(serverHeaders, credentialGeneration) {
    // This digest is only a private equality token, never a diagnostic or output.
    const fingerprint = createHash('sha256').update(JSON.stringify([serverHeaders,credentialGeneration])).digest('hex');
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
        const result = await (invokeSource ? invokeSource(original, context) : original(context));
        if (credentialProvider && result.body?.upstreamStatus === 401) {
          try { credentialProvider.invalidate(serverHeaders.authorization); } catch { /* Do not rewrite a native result. */ }
        }
        totals.sourceCompleted++;
        if (result.status >= 400) totals.sourceFailed++;
        if (Buffer.isBuffer(result.body)) totals.sourceResponseBytes += result.body.length;
        return { ...result, cacheMetadata: { ...result.cacheMetadata,
          requestTime, responseTime: Date.now(), authenticated } };
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
    current = generation; generations.add(generation); revision++;
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
    if (credentialWaiters.size >= maxCredentialWaiters) return failure(503, 'UPSTREAM_CAPACITY_EXHAUSTED');
    let generation, lifetime;
    try {
      lifetime = beginUpstreamRequest(context.signal,fixed.timeoutMs ?? 10000);
      let complete;
      const waiting = {lifetime,done:new Promise(resolve => {complete=resolve;})};
      credentialWaiters.add(waiting); totals.credentialInFlight++;
      try {
        // Token renewal/rotation precedes cache selection. Each source generation
        // still receives one fixed immutable authorization snapshot, never a
        // provider that can change credentials while its cached data is in use.
        const trusted = frozenHeaders(await resolveUpstreamHeaders(headerFactory ?? staticHeaders,credentialProvider,lifetime));
        if (closed) return failure(503,'UPSTREAM_CACHE_CLOSED');
        const epoch = credentialProvider ? credentialProvider.generation() : null;
        if (epoch !== null && (!Number.isSafeInteger(epoch) || epoch < 0)) throw new TypeError('Invalid credential generation');
        generation = select(trusted,epoch);
      } catch {
        if (closed) return failure(503,'UPSTREAM_CACHE_CLOSED');
        if (lifetime.signal.aborted) return failure(lifetime.signal.reason.code === 'UPSTREAM_TIMEOUT' ? 504 : 499,lifetime.signal.reason.code);
        totals.credentialUnavailable++; retire(); return failure(503,'UPSTREAM_CONFIGURATION_UNAVAILABLE');
      } finally { totals.credentialInFlight--; credentialWaiters.delete(waiting); complete(); }
      // Preserve original Connection-nominated header removal before cache input.
      const incoming = { ...(context.headers ?? {}) };
      const connection = incoming.connection;
      const nominated = new Set((Array.isArray(connection) ? connection.join(',') : typeof connection === 'string' ? connection : '')
        .split(',').map(name => name.trim().toLowerCase()).filter(Boolean));
      for (const name of forwarded) if (nominated.has(name)) delete incoming[name];
      generation.users++;
      try {
        const result = await lifetime.wait(generation.cache.handler({ ...context, headers: incoming, signal:lifetime.signal }));
        const outward = { ...result.headers };
        for (const name of META) if (!expose.has(name)) delete outward[name];
        return { status: result.status, headers: outward, body: result.body };
      } finally { generation.users--; release(generation); }
    } catch {
      if (closed) return failure(503,'UPSTREAM_CACHE_CLOSED');
      const error = lifetime?.signal.aborted ? lifetime.signal.reason.code : 'UPSTREAM_CONFIGURATION_UNAVAILABLE';
      return failure(error === 'UPSTREAM_TIMEOUT' ? 504 : error === 'UPSTREAM_ABORTED' ? 499 : 503,error);
    } finally { lifetime?.close(); }
  }

  const stats = () => Object.freeze({ schema: 'stellar-forge.upstream-response-cache.v1', ...totals,
    generation: current?.number ?? null, revision, retiredGenerations: generations.size - Number(current !== null),
    cache: current?.cache.stats() ?? null, closed });
  const invalidate = () => {
    totals.invalidations++; revision++; retire();
    return Object.freeze({ generation: null, revision });
  };
  const inspect = () => {
    const snapshot = stats(), limits = admission.stats().limits;
    return { kind: 'upstream', revision, generation: snapshot.generation,
      cacheGeneration: snapshot.cache?.generation ?? null, closed,
      policy: Object.fromEntries(['ttlMs', 'maxEntries', 'maxBytes', 'maxEntryBytes'].map(key => [key, limits[key]])),
      limits, stats: snapshot };
  };
  const configure = value => {
    if (closed) throw Object.assign(new Error('Upstream response cache is closed'), { code: 'CACHE_CONTROL_CLOSED' });
    const next = normalizeCacheRetention(value, admission.stats().limits);
    const previous = inspect().policy;
    // Retain this outer controller's admission, availability and global source
    // counters. Retired credential generations still occupy their existing
    // slots until every active source and admitted consumer has finished.
    const invalidated = invalidate();
    admission.configure(next);
    Object.assign(policy, next); ttlMs = next.ttlMs;
    return { previous, policy: { ...next }, ...invalidated };
  };
  const close = options => {
    if (closing) return closing;
    closed = true;
    const credentialDrains = [...credentialWaiters].map(waiting => { waiting.lifetime.cancel(); return waiting.done; });
    const pending = [...credentialDrains, admission.close(options), ...[...generations].map(generation => generation.cache.close(options))];
    current = null;
    closing = Promise.all(pending).then(() => {
      for (const generation of generations) release(generation);
      return stats();
    });
    return closing;
  };
  handler.admit = admission.admit;
  handler.snapshot = stats;
  return Object.freeze({ handler, admit: admission.admit, stats, inspect, configure, invalidate, close });
}

/** Convenience export for existing application.mjs handler bindings. */
export function createCachedUpstreamHandler(options, cacheOptions) {
  const control = createCachedUpstream(options, cacheOptions);
  control.handler.cache = control;
  return control.handler;
}
