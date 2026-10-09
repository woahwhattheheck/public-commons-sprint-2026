// SPDX-License-Identifier: MIT
// The hackathon key must ONLY be sent to Qloo's fixed hackathon origin.
const QLOO_ORIGIN = 'https://hackathon.api.qloo.com';
const TYPES = new Set(['artist', 'book', 'brand', 'destination', 'movie', 'place', 'tv_show']);

export class QlooError extends Error {
  constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}

function arrayOfEntities(payload) {
  // The supporting search APIs and Insights API can have different envelopes.
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.entities)) return payload.entities;
  if (Array.isArray(payload?.data?.results)) return payload.data.results;
  if (Array.isArray(payload?.data?.entities)) return payload.data.entities;
  if (Array.isArray(payload?.results?.entities)) return payload.results.entities;
  // A valid no-match response is an explicitly empty results/entities array.
  // Unknown envelopes are provider schema failures, not evidence of no matches.
  throw new QlooError('QLOO_RESPONSE_SHAPE_UNRECOGNIZED', 502);
}

// Qloo normally reports a broad type (urn:entity) and the actual category
// in subtype. A mismatched explicit subtype must never be treated as evidence
// that the entity satisfies a requested category (especially venue/place).
function matchesRequestedType(item, requested) {
  const expected = `urn:entity:${requested}`;
  return [item?.type, item?.subtype].every(value => {
    if (value == null || value === '') return true; // Older envelopes omit metadata.
    if (typeof value !== 'string') return false;
    const actual = value.trim().toLowerCase();
    return actual === 'urn:entity' || actual === requested ||
      actual === expected || actual.startsWith(`${expected}:`);
  });
}

function toEntity(item) {
  if (!item || typeof item !== 'object') return null;
  const id = item.entity_id ?? item.id ?? item.qloo_id;
  const name = item.name ?? item.properties?.name ?? item.title;
  if (typeof id !== 'string' || id.length > 256 || !id || typeof name !== 'string' || !name) return null;
  const score = item.query?.affinity ?? item.affinity ?? null;
  return { id, name: name.slice(0, 160), score: typeof score === 'number' && Number.isFinite(score) ? score : null,
    type: String(item.subtype ?? item.type ?? '').slice(0, 80) };
}

function isSafeCity(city) { return typeof city === 'string' && city.length < 80 && /^[\p{L}\p{N} ,.'-]*$/u.test(city); }

export class QlooClient {
  constructor({key, fetcher = globalThis.fetch, now = () => Date.now(), maxUpstreamRequestsPerMinute = 48}) {
    if (typeof key !== 'string' || !key) throw new QlooError('QLOO_KEY_MISSING', 503);
    if (!Number.isInteger(maxUpstreamRequestsPerMinute) ||
        maxUpstreamRequestsPerMinute < 1 || maxUpstreamRequestsPerMinute > 120)
      throw new QlooError('INVALID_QLOO_UPSTREAM_BUDGET', 400);
    this.key = key;
    this.fetcher = fetcher;
    this.now = now;
    this.cache = new Map();
    this.inFlight = new Map(); // Singleflight by exact canonical request URL.
    this.calls = 0;
    // One process-wide budget per shared client, not a per-IP limit or per-plan
    // quota. This guards real outbound calls while leaving cache hits free.
    this.maxUpstreamRequestsPerMinute = maxUpstreamRequestsPerMinute;
    this.upstreamWindow = {start: now(), used: 0};
  }

  reserveUpstreamCall() {
    const now = this.now();
    if (!Number.isFinite(now)) throw new QlooError('QLOO_BUDGET_CLOCK_UNAVAILABLE', 503);
    if (now < this.upstreamWindow.start || now - this.upstreamWindow.start >= 60000)
      this.upstreamWindow = {start: now, used: 0};
    if (this.upstreamWindow.used >= this.maxUpstreamRequestsPerMinute)
      throw new QlooError('QLOO_LOCAL_BUDGET', 429);
    this.upstreamWindow.used += 1;
  }

  async get(path, params) {
    if (!['/search', '/v2/insights'].includes(path)) throw new QlooError('UNSUPPORTED_ENDPOINT', 400);
    const url = new URL(path, QLOO_ORIGIN);
    for (const [name, value] of Object.entries(params)) if (value !== '' && value != null) url.searchParams.set(name, String(value));
    const cacheKey = url.toString();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.until > this.now()) return cached.result;
    // A completed-response cache does not protect Qloo from simultaneous identical
    // requests. Share their pending fetch (and its one timeout) without caching
    // failures, so 429 and transient outages remain retryable on the next call.
    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;
    const pending = this.fetchOnce(url, cacheKey);
    this.inFlight.set(cacheKey, pending);
    try {
      return await pending;
    } finally {
      if (this.inFlight.get(cacheKey) === pending) this.inFlight.delete(cacheKey);
    }
  }

  async fetchOnce(url, cacheKey) {
    // Reserve synchronously before the first await: competing requests to
    // different URLs cannot overspend the shared key's local limit.
    this.reserveUpstreamCall();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    try {
      this.calls += 1;
      const response = await this.fetcher(url, {method: 'GET', headers: { 'X-Api-Key': this.key, Accept: 'application/json'}, signal: controller.signal});
      if (!response?.ok) throw new QlooError(response?.status === 429 ? 'QLOO_RATE_LIMIT' :
        response?.status === 401 ? 'QLOO_KEY_REJECTED' : `QLOO_HTTP_${response?.status ?? 'UNKNOWN'}`,
        response?.status === 429 ? 429 : 502);
      const result = await response.json();
      // Validate before the five-minute cache: do not persist schema failures
      // as successful provider responses or convert them to empty recommendations.
      arrayOfEntities(result);
      if (this.cache.size > 48) this.cache.clear();
      this.cache.set(cacheKey, { until: this.now() + 300000, result }); // private, server-memory only
      return result;
    } catch (error) {
      if (error?.name === 'AbortError') throw new QlooError('QLOO_TIMEOUT', 504);
      if (error instanceof QlooError) throw error;
      throw new QlooError('QLOO_UNAVAILABLE', 502);
    } finally { clearTimeout(timer); }
  }

  async search(seed) {
    const query = seed.trim();
    if (query.length < 2 || query.length > 100) throw new QlooError('INVALID_SEED', 400);
    const payload = await this.get('/search', {query, take: 8});
    return arrayOfEntities(payload).map(toEntity).filter(Boolean).slice(0, 8);
  }

  async insights(type, ids, {city = '', take = 6} = {}) {
    if (!TYPES.has(type) || !Array.isArray(ids) || ids.length < 1 || ids.length > 3 ||
        ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9:._/-]{1,256}$/.test(id)) ||
        !isSafeCity(city)) throw new QlooError('INVALID_INSIGHT_REQUEST', 400);
    const query = {'filter.type': `urn:entity:${type}`, 'signal.interests.entities': ids.join(','),
      'feature.explainability': 'true', take: Math.max(1, Math.min(8, Number(take) || 6))};
    if (city && type === 'place') query['filter.location.query'] = city; // documented geospatial filter
    const payload = await this.get('/v2/insights', query);
    return arrayOfEntities(payload).filter(entity => matchesRequestedType(entity, type))
      .map(toEntity).filter(Boolean).slice(0, 8);
  }
}
