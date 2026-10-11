// MIT. Declarative reuse policy around the original cache and upstream engines.
import { createResponseCache } from './cache.mjs';
import { createCachedUpstream } from './upstream.mjs';
import { protectUpstream } from '../upstream-readiness.mjs';

const fields = new Set(['shareAcrossBuyers', 'ttlMs', 'maxEntries', 'maxBytes',
  'maxEntryBytes', 'maxSourceInFlight', 'maxWaiters', 'sourceTimeoutMs']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** JSON never supplies functions or changes the original transport response cap. */
export function compileUpstreamCache(value, binding) {
  if (value === undefined) return null;
  if (!plain(value) || Object.keys(value).some(key => !fields.has(key)) ||
      value.shareAcrossBuyers !== true || !['GET', 'HEAD'].includes(binding.method)) {
    throw new TypeError('cache requires GET/HEAD, explicit shareAcrossBuyers:true and supported limit fields');
  }
  const options = { ...value, maxResponseBytes: binding.maxResponseBytes,
    maxEntryBytes: value.maxEntryBytes ?? Math.min(binding.maxResponseBytes, value.maxBytes ?? 16777216),
    maxSourceInFlight: value.maxSourceInFlight ?? binding.maxInFlight,
    sourceTimeoutMs: value.sourceTimeoutMs ?? Math.min(120000, binding.timeoutMs + 1000),
    varyHeaders: [...binding.requestHeaders] };
  if (options.maxSourceInFlight > binding.maxInFlight) {
    throw new TypeError('cache.maxSourceInFlight must not exceed the upstream maxInFlight');
  }
  // The original constructor is the single validator for limits and header keys.
  // Its empty controller has no tasks, sockets or timers, and is never invoked.
  const limits = createResponseCache({ ...options, handler: () => { throw new Error('Configuration only'); } }).stats().limits;
  return Object.freeze({ shareAcrossBuyers: true, ...limits, varyHeaders: Object.freeze(limits.varyHeaders) });
}

/**
 * Keep original availability around actual source calls, before serialization.
 * Hits cannot clear a backend failure streak. One availability state survives
 * cache invalidation and all underlying immutable credential generations.
 */
export function createConfiguredCachedUpstream(upstream, policy, availability) {
  const totals = { started: 0, completed: 0, inFlight: 0, failed: 0, timedOut: 0, responseBytes: 0 };
  const dispatch = async ({ source, context }) => {
    totals.started++; totals.inFlight++;
    try {
      const result = await source(context);
      totals.completed++;
      if (result.status >= 400) totals.failed++;
      if (result.body?.error === 'UPSTREAM_TIMEOUT') totals.timedOut++;
      if (Buffer.isBuffer(result.body)) totals.responseBytes += result.body.length;
      return result;
    } finally { totals.inFlight--; }
  };
  dispatch.snapshot = () => Object.freeze({ ...totals });
  const source = availability ? protectUpstream(dispatch, availability, { maxInFlight: upstream.maxInFlight }) : dispatch;
  const control = createCachedUpstream({ ...upstream,
    invokeSource: (original, context) => source({ source: original, context }) }, policy);
  const handler = control.handler;
  handler.admit = async context => {
    const result = await control.admit(context);
    if (result !== true && result !== undefined && result !== null) return result;
    return typeof source.admit === 'function' ? source.admit(context) : true;
  };
  handler.snapshot = () => Object.freeze({ ...source.snapshot(), cache: control.stats(),
    ...(upstream.credentialProvider ? {oauth2:upstream.credentialProvider.snapshot()} : {}) });
  handler.cache = control;
  return handler;
}
