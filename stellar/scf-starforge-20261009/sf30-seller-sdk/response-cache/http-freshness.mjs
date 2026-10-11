// MIT. Conservative HTTP freshness policy for the original SF30 upstream adapter.
// Cache storage/coalescing belongs to response-cache/cache.mjs, never this module.
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** Parse directives without splitting quoted field-name lists or escaped quotes. */
export function cacheDirectives(value) {
  if (value === undefined) return new Map();
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x08\x0a-\x1f\x7f]/.test(value)) return null;
  const parts = []; let start = 0, quoted = false, escaped = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === '\\') { escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    if (char === ',' && !quoted) { parts.push(value.slice(start, i)); start = i + 1; }
  }
  if (quoted || escaped) return null;
  parts.push(value.slice(start));
  const directives = new Map();
  for (const part of parts) {
    if (!part.trim()) continue;
    const equal = part.indexOf('='), name = (equal < 0 ? part : part.slice(0, equal)).trim().toLowerCase();
    let argument = equal < 0 ? null : part.slice(equal + 1).trim();
    if (!TOKEN.test(name) || directives.has(name)) return null;
    if (argument !== null) {
      if (argument.startsWith('"')) {
        if (!/^"(?:[^"\\\x00-\x1f\x7f]|\\[\t\x20-\x7e])*"$/.test(argument)) return null;
        argument = argument.slice(1, -1).replace(/\\(.)/g, '$1');
      } else if (!TOKEN.test(argument)) return null;
    }
    directives.set(name, argument);
  }
  return directives;
}

const seconds = value => typeof value === 'string' && /^\d+$/.test(value) ? Math.min(Number(value), 2147483648) : null;
const reject = reason => Object.freeze({ cacheable: false, ttlMs: 0, reason });

/**
 * Storage decision for already validated, complete original upstream responses.
 * The merchant TTL is an upper bound, not permission to override origin policy.
 * Date/Age/response-delay arithmetic follows RFC 9111 sections 4.2.1 and 4.2.3.
 */
export function upstreamFreshness(result, { ttlMs, requestTime, responseTime, now = Date.now(), authenticated = false,
  hasSetCookie = false, policyFieldsComplete = true } = {}) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 ||
      ![requestTime, responseTime, now].every(Number.isFinite) ||
      responseTime < requestTime || now < responseTime) return reject('INVALID_CLOCK_OR_TTL');
  if (result?.status !== 200) return reject('STATUS_NOT_CACHEABLE');
  if (!policyFieldsComplete) return reject('ORIGIN_POLICY_INCOMPLETE');
  if (hasSetCookie) return reject('ORIGIN_SESSION_RESPONSE');
  const headers = result.headers ?? {}, directives = cacheDirectives(headers['cache-control']);
  if (!directives) return reject('INVALID_CACHE_CONTROL');
  if (['no-store', 'private', 'no-cache'].some(name => directives.has(name))) return reject('ORIGIN_REQUIRES_FRESH_REQUEST');
  if (/\bno-cache\b/i.test(headers.pragma ?? '')) return reject('ORIGIN_REQUIRES_FRESH_REQUEST');
  if (own(headers, 'set-cookie')) return reject('ORIGIN_SESSION_RESPONSE');
  const vary = headers.vary === undefined ? [] : typeof headers.vary === 'string' ? headers.vary.split(',').map(x => x.trim().toLowerCase()) : null;
  if (vary === null || vary.some(name => !TOKEN.test(name) || name === '*')) return reject('VARY_NOT_REUSABLE');
  if (authenticated && !['public', 's-maxage', 'must-revalidate'].some(name => directives.has(name))) return reject('AUTHENTICATED_RESPONSE_NOT_SHARED');
  let freshnessLifetime = ttlMs;
  // Reject malformed age directives even when another directive takes precedence.
  for (const name of ['s-maxage', 'max-age']) {
    if (directives.has(name) && seconds(directives.get(name)) === null) return reject('INVALID_MAX_AGE');
  }
  const date = headers.date === undefined ? responseTime : Date.parse(headers.date);
  if (!Number.isFinite(date)) return reject('INVALID_DATE');
  if (directives.has('s-maxage')) freshnessLifetime = Math.min(ttlMs, seconds(directives.get('s-maxage')) * 1000);
  else if (directives.has('max-age')) freshnessLifetime = Math.min(ttlMs, seconds(directives.get('max-age')) * 1000);
  else if (headers.expires !== undefined) {
    const expires = Date.parse(headers.expires);
    if (!Number.isFinite(expires)) return reject('INVALID_EXPIRES');
    freshnessLifetime = Math.min(ttlMs, Math.max(0, expires - date));
  }
  const age = headers.age === undefined ? 0 : seconds(headers.age);
  if (age === null) return reject('INVALID_AGE');
  const apparentAge = Math.max(0, responseTime - date);
  const correctedAge = age * 1000 + (responseTime - requestTime);
  const remaining = Math.floor(freshnessLifetime - Math.max(apparentAge, correctedAge) - (now - responseTime));
  return remaining > 0 ? Object.freeze({ cacheable: true, ttlMs: remaining, reason: 'FRESH', vary: Object.freeze(vary) }) : reject('STALE');
}

/** Request preferences that need the original transport, never a stored result. */
export function upstreamCacheBypass(headers = {}) {
  const directives = cacheDirectives(headers['cache-control']);
  if (!directives) return 'INVALID_CACHE_CONTROL';
  if (['no-cache', 'no-store', 'max-age', 'min-fresh', 'only-if-cached'].some(name => directives.has(name)) || /\bno-cache\b/i.test(headers.pragma ?? '')) return 'REQUEST_CACHE_PREFERENCE';
  if (Object.keys(headers).some(name => /^(?:range|if-range|if-match|if-none-match|if-modified-since|if-unmodified-since)$/i.test(name))) return 'CONDITIONAL_OR_RANGE_REQUEST';
  return null;
}
