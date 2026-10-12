// MIT. Application-result reuse inside the ORIGINAL SF30 payment lifecycle.
import { createHash } from 'node:crypto';
import { validateHeaderName, validateHeaderValue } from 'node:http';
import { performance } from 'node:perf_hooks';

const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x));
const payment = name => /^(?:payment-|x-payment(?:-|$)|x402-|extension-responses$|settlement-overrides$)/.test(name);
const reserved = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization',
  'host', 'connection', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade',
  'content-length', 'expect', 'cache-control', 'pragma', 'range', 'if-range',
  'if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since']);
const integer = (value, min, max, name) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`Invalid ${name}`);
  return value;
};
const failed = (status, error) => ({ status, headers: { 'content-type': 'application/json' }, body: { error } });
const aborted = () => new DOMException('Source read cancelled', 'AbortError');
const RETENTION = Object.freeze(['ttlMs', 'maxEntries', 'maxBytes', 'maxEntryBytes']);

/** Validate one retention patch without changing source/admission/transport limits. */
export function normalizeCacheRetention(value, current) {
  if (!plain(value) || !Object.keys(value).length ||
      Object.keys(value).some(key => !RETENTION.includes(key))) {
    throw new TypeError('Retention policy supports only ttlMs, maxEntries, maxBytes and maxEntryBytes');
  }
  const next = Object.fromEntries(RETENTION.map(key => [key,
    Object.hasOwn(value, key) ? value[key] : current[key]]));
  integer(next.ttlMs, 1, 3600000, 'ttlMs');
  integer(next.maxEntries, 1, 100000, 'maxEntries');
  integer(next.maxBytes, 1, 256 * 1024 * 1024, 'maxBytes');
  integer(next.maxEntryBytes, 1, Math.min(next.maxBytes, current.maxResponseBytes), 'maxEntryBytes');
  return Object.freeze(next);
}

const copy = response => ({ status: response.status, headers: { ...response.headers }, body: Buffer.from(response.body) });

/**
 * The merchant must explicitly declare that the handler is a read-only shared
 * data product. Only the request projection used in the key reaches the source.
 * Admission keeps the original request and runs independently for every buyer.
 */
export function createResponseCache({ handler, admit, shareAcrossBuyers,
  ttlMs = 1000, maxEntries = 256, maxBytes = 16 * 1024 * 1024,
  maxEntryBytes = 1024 * 1024, maxResponseBytes = 1024 * 1024,
  maxSourceInFlight = 16, maxWaiters = 128, sourceTimeoutMs = 10000,
  varyHeaders = [], storagePolicy, bypassRequest } = {}) {
  if (typeof handler !== 'function' || admit !== undefined && typeof admit !== 'function' ||
      shareAcrossBuyers !== true || storagePolicy !== undefined && typeof storagePolicy !== 'function' ||
      bypassRequest !== undefined && typeof bypassRequest !== 'function')
    throw new TypeError('A read-only handler, explicit shareAcrossBuyers:true and valid policy are required');
  integer(ttlMs, 1, 3600000, 'ttlMs'); integer(maxEntries, 1, 100000, 'maxEntries');
  integer(maxBytes, 1, 256 * 1024 * 1024, 'maxBytes');
  integer(maxResponseBytes, 1, 16 * 1024 * 1024, 'maxResponseBytes');
  integer(maxEntryBytes, 1, Math.min(maxBytes, maxResponseBytes), 'maxEntryBytes');
  integer(maxSourceInFlight, 1, 256, 'maxSourceInFlight');
  integer(maxWaiters, 1, 1024, 'maxWaiters'); integer(sourceTimeoutMs, 1, 120000, 'sourceTimeoutMs');
  if (!Array.isArray(varyHeaders) || varyHeaders.length > 32) throw new TypeError('varyHeaders must be a header-name array');
  const vary = new Set();
  for (const name of varyHeaders) {
    if (typeof name !== 'string') throw new TypeError('Invalid vary header');
    const key = name.toLowerCase(); validateHeaderName(key);
    if (reserved.has(key) || payment(key) || /^(?:proxy-|forwarded$|x-forwarded-|sec-)/.test(key) || vary.has(key))
      throw new TypeError('Reserved or duplicate vary header');
    vary.add(key);
  }
  const entries = new Map(), flights = new Map(), tasks = new Set();
  const totals = { requests: 0, hits: 0, misses: 0, coalesced: 0, sourceReads: 0,
    sourceErrors: 0, sourceTimeouts: 0, cancelledConsumers: 0, evictions: 0,
    expired: 0, bypasses: 0, invalidations: 0, rejectedAtCapacity: 0 };
  let bytes = 0, generation = 0, revision = 0, closed = false, consumers = 0;

  function project(context) {
    if (!plain(context) || !['GET', 'HEAD'].includes(context.method) ||
        !(context.url instanceof URL) || context.url.href.length > 8192 ||
        context.body !== undefined && context.body !== null) throw new TypeError('Read-only GET/HEAD request required');
    const incoming = context.headers ?? {};
    if (!plain(incoming)) throw new TypeError('Request headers must be a plain object');
    const all = Object.create(null);
    for (const [name, value] of Object.entries(incoming)) {
      const key = name.toLowerCase();
      if (Object.hasOwn(all, key)) throw new TypeError('Duplicate request header');
      all[key] = value;
    }
    for (const key of ['range', 'if-range', 'if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since'])
      if (all[key] !== undefined) throw new TypeError('Partial and conditional reads are unsupported');
    const selected = Object.create(null);
    for (const name of [...vary].sort()) {
      const value = all[name];
      if (value === undefined) continue;
      if (typeof value !== 'string' || value.length > 8192) throw new TypeError('Invalid varied header value');
      validateHeaderValue(name, value); selected[name] = value;
    }
    const params = context.pathParams ?? {};
    if (!plain(params) || Object.keys(params).length > 32) throw new TypeError('Invalid path parameters');
    const pathParams = Object.create(null);
    for (const name of Object.keys(params).sort()) {
      if (typeof params[name] !== 'string' || params[name].length > 512) throw new TypeError('Invalid path parameter');
      pathParams[name] = params[name];
    }
    const url = new URL(context.url.href), query = Object.create(null);
    for (const [name, value] of url.searchParams) {
      if (!Object.hasOwn(query, name)) query[name] = value;
      else query[name] = Array.isArray(query[name]) ? [...query[name], value] : [query[name], value];
    }
    const key = createHash('sha256').update(JSON.stringify([context.method, url.href, pathParams, selected])).digest('hex');
    const directives = [all['cache-control'], all.pragma].filter(x => typeof x === 'string').join(',');
    const extraBypass = bypassRequest ? bypassRequest(context) : false;
    if (typeof extraBypass !== 'boolean') throw new TypeError('bypassRequest must return a boolean');
    const bypass = extraBypass || /(?:^|,)\s*(?:no-cache|no-store|max-age\s*=\s*0)(?:\s|,|$)/i.test(directives);
    return { key, bypass, input: { method: context.method, url, query,
      pathParams, headers: selected, body: null } };
  }

  function responseSnapshot(result) {
    if (!plain(result)) throw new TypeError('Application response required');
    const status = result.status ?? 200;
    if (!Number.isInteger(status) || status < 200 || status > 599 || status >= 300 && status < 400)
      throw new TypeError('Unsupported application status');
    if (!plain(result.headers ?? {})) throw new TypeError('Invalid application headers');
    const headers = Object.create(null);
    for (const [name, value] of Object.entries(result.headers ?? {})) {
      const key = name.toLowerCase(); validateHeaderName(key);
      if (typeof value !== 'string' || value.length > 8192 || Object.hasOwn(headers, key) || payment(key))
        throw new TypeError('Invalid, duplicate or payment-owned application header');
      validateHeaderValue(key, value); headers[key] = value;
    }
    if (Object.keys(headers).length > 64) throw new TypeError('Too many response headers');
    let body;
    if (Buffer.isBuffer(result.body)) {
      body = Buffer.from(result.body); headers['content-type'] ??= 'application/octet-stream';
    } else if (typeof result.body === 'string') {
      body = Buffer.from(result.body); headers['content-type'] ??= 'text/plain; charset=utf-8';
    } else {
      const encoded = JSON.stringify(Object.hasOwn(result, 'body') ? result.body : {});
      if (encoded === undefined) throw new TypeError('Unsupported response body');
      body = Buffer.from(encoded); headers['content-type'] ??= 'application/json; charset=utf-8';
    }
    if (body.length > maxResponseBytes) throw new RangeError('Application response exceeds cache response limit');
    const size = body.length + Buffer.byteLength(JSON.stringify(headers)) + 128;
    const control = headers['cache-control'] ?? '';
    const varied = (headers.vary ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    const reusable = status === 200 && headers['set-cookie'] === undefined &&
      !/(?:^|,)\s*(?:private|no-store|no-cache)(?:\s|=|,|$)/i.test(control) &&
      varied.every(name => vary.has(name));
    let lifetime = ttlMs;
    const freshness = [...control.matchAll(/(?:^|,)\s*(?:s-maxage|max-age)\s*=\s*"?(\d+)"?\s*(?=,|$)/gi)]
      .map(x => Number(x[1]));
    const age = /^\d+$/.test(headers.age ?? '') ? Number(headers.age) : 0;
    if (freshness.length) lifetime = Math.min(lifetime, Math.max(0, Math.min(...freshness) - age) * 1000);
    const response = { status, headers, body };
    let policyAllowed = true;
    if (storagePolicy && status === 200) {
      const decision = storagePolicy({ ...copy(response), ...(Object.hasOwn(result, 'cacheMetadata') ?
        { cacheMetadata: structuredClone(result.cacheMetadata) } : {}) });
      if (!plain(decision) || Object.keys(decision).some(key => !['ttlMs', 'cacheable'].includes(key)) ||
          decision.cacheable !== undefined && typeof decision.cacheable !== 'boolean')
        throw new TypeError('Invalid storage policy result');
      if (decision.ttlMs !== undefined) {
        integer(decision.ttlMs, 0, 3600000, 'storage policy ttlMs');
        lifetime = Math.min(lifetime, decision.ttlMs);
      }
      policyAllowed = decision.cacheable !== false;
    }
    return { response, size, reusable: reusable && policyAllowed && lifetime > 0, lifetime };
  }

  function remove(key, reason) {
    const entry = entries.get(key);
    if (entry) { bytes -= entry.size; entries.delete(key); if (reason) totals[reason]++; }
  }
  function sweep() {
    const now = performance.now();
    for (const [key, entry] of entries) if (entry.expiresAt <= now) remove(key, 'expired');
  }
  function lookup(key) {
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= performance.now()) { remove(key, 'expired'); return null; }
    entries.delete(key); entries.set(key, entry); return entry;
  }
  function retain(key, outcome, epoch) {
    if (closed || epoch !== generation || !outcome.reusable ||
        outcome.response.body.length > maxEntryBytes || outcome.size > maxBytes) return;
    sweep(); remove(key);
    while (entries.size >= maxEntries || bytes + outcome.size > maxBytes) remove(entries.keys().next().value, 'evictions');
    entries.set(key, { ...outcome, expiresAt: performance.now() + outcome.lifetime }); bytes += outcome.size;
  }

  function start(projected, retainResult) {
    if (closed || tasks.size >= maxSourceInFlight) {
      totals.rejectedAtCapacity++;
      return { promise: Promise.resolve({ response: responseSnapshot(failed(503,
        closed ? 'RESPONSE_CACHE_CLOSED' : 'CACHE_SOURCE_AT_CAPACITY')).response, reusable: false }),
      controller: new AbortController(), waiters: 0, done: true };
    }
    const controller = new AbortController(), epoch = generation;
    const task = { controller, waiters: 0, done: false, timer: null };
    tasks.add(task); totals.sourceReads++;
    let expire;
    const interruption = new Promise(resolve => { expire = resolve; });
    task.timer = setTimeout(() => {
      totals.sourceTimeouts++; controller.abort();
      expire({ response: responseSnapshot(failed(504, 'CACHE_SOURCE_TIMEOUT')).response, reusable: false });
    }, sourceTimeoutMs);
    const source = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return handler({ ...projected.input, signal: controller.signal });
    }).then(result => responseSnapshot(result), () => {
      totals.sourceErrors++;
      return { response: responseSnapshot(failed(502, 'CACHE_SOURCE_FAILED')).response, reusable: false };
    }).catch(() => {
      totals.sourceErrors++;
      return { response: responseSnapshot(failed(502, 'CACHE_SOURCE_RESPONSE_INVALID')).response, reusable: false };
    }).finally(() => { clearTimeout(task.timer); tasks.delete(task); });
    task.settled = source;
    task.promise = Promise.race([source, interruption]).then(outcome => {
      task.done = true;
      if (flights.get(projected.key) === task) flights.delete(projected.key);
      if (retainResult && !controller.signal.aborted) retain(projected.key, outcome, epoch);
      return outcome;
    });
    // A timed-out handler keeps its source slot until it actually stops, even if
    // it ignores AbortSignal; timeout cannot create unbounded detached work.
    return task;
  }

  function wait(task, signal) {
    task.waiters++; consumers++;
    return new Promise((resolve, reject) => {
      let finished = false;
      const done = (fn, result) => {
        if (finished) return;
        finished = true; task.waiters--; consumers--;
        signal?.removeEventListener('abort', cancel);
        if (!task.waiters && !task.done) task.controller.abort();
        fn(result);
      };
      const cancel = () => { totals.cancelledConsumers++; done(reject, aborted()); };
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      task.promise.then(result => done(resolve, result), error => done(reject, error));
    });
  }

  async function cached(context) {
    totals.requests++; context?.signal?.throwIfAborted();
    const projected = project(context);
    if (closed) return failed(503, 'RESPONSE_CACHE_CLOSED');
    if (projected.bypass) {
      totals.bypasses++;
      return copy((await wait(start(projected, false), context.signal)).response);
    }
    const entry = lookup(projected.key);
    if (entry) { totals.hits++; return copy(entry.response); }
    totals.misses++;
    let task = flights.get(projected.key), follower = false;
    if (task?.controller.signal.aborted) task = undefined;
    if (task && task.waiters >= maxWaiters) {
      totals.rejectedAtCapacity++; return failed(503, 'CACHE_WAITERS_AT_CAPACITY');
    }
    if (task) { follower = true; totals.coalesced++; }
    else { task = start(projected, true); if (!task.done) flights.set(projected.key, task); }
    let outcome = await wait(task, context.signal);
    // A source may announce private/no-store, cookies or undeclared Vary only
    // after it finishes. Followers then execute their own original reads; none
    // receive another request's non-shareable response.
    if (follower && !outcome.reusable) {
      context.signal?.throwIfAborted();
      outcome = await wait(start(projected, false), context.signal);
    }
    return copy(outcome.response);
  }

  const admission = async context => {
    if (closed) throw new Error('RESPONSE_CACHE_CLOSED');
    try { project(context); } catch { return failed(400, 'CACHE_READ_REQUEST_UNSUPPORTED'); }
    return admit ? admit(context) : true;
  };
  function stats() {
    sweep();
    return { ...totals, closed, entries: entries.size, bytes, sourceInFlight: tasks.size,
      sharedReads: flights.size, consumers, generation, revision,
      limits: { ttlMs, maxEntries, maxBytes, maxEntryBytes, maxResponseBytes,
        maxSourceInFlight, maxWaiters, sourceTimeoutMs, varyHeaders: [...vary] } };
  }
  function invalidate() {
    const removed = entries.size; generation++; revision++; entries.clear(); flights.clear(); bytes = 0;
    totals.invalidations++; return { removed, generation };
  }
  function inspect() {
    const snapshot = stats();
    return { kind: 'application', revision, generation, closed,
      policy: Object.fromEntries(RETENTION.map(key => [key, snapshot.limits[key]])),
      limits: snapshot.limits, stats: snapshot };
  }
  function configure(value) {
    if (closed) throw Object.assign(new Error('Response cache is closed'), { code: 'CACHE_CONTROL_CLOSED' });
    const next = normalizeCacheRetention(value, stats().limits);
    const previous = { ttlMs, maxEntries, maxBytes, maxEntryBytes };
    // Every admitted consumer keeps its original source promise. Clearing the
    // shared-flight index advances the epoch so old results cannot refill the
    // cache under new retention terms or attract a newly admitted buyer.
    const invalidated = invalidate();
    ({ ttlMs, maxEntries, maxBytes, maxEntryBytes } = next);
    return { previous, policy: { ...next }, ...invalidated, revision };
  }
  async function close({ graceMs = 5000 } = {}) {
    integer(graceMs, 1, 300000, 'graceMs');
    closed = true; invalidate();
    for (const task of tasks) task.controller.abort();
    let timer;
    await Promise.race([Promise.allSettled([...tasks].map(task => task.settled)),
      new Promise(resolve => { timer = setTimeout(resolve, graceMs); })]);
    clearTimeout(timer); return { drained: tasks.size === 0, ...stats() };
  }
  return Object.freeze({ handler: cached, admit: admission, stats, inspect, configure, invalidate, close });
}
