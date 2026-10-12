import {createHash} from 'node:crypto';

export class NativeSourceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'NativeSourceError';
    this.code = code;
    this.details = details;
  }
}

export function stableJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJSON(value[key])).join(',') + '}';
}
export function sourceHash(value) {
  return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : stableJSON(value)).digest('hex');
}
export function normalizeNetwork(value) {
  const names = {
    'stellar:pubnet': 'Public Global Stellar Network ; September 2015',
    'stellar:testnet': 'Test SDF Network ; September 2015',
    'stellar:futurenet': 'Test SDF Future Network ; October 2022',
  };
  if (typeof value !== 'string' || !value.trim() || value.length > 1024) throw new NativeSourceError('NETWORK_REQUIRED', 'Select the original Stellar network passphrase or a supported network alias.');
  return names[value] || value;
}
export function plain(value, name = 'value') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new NativeSourceError('INVALID_INPUT', name + ' must be an object.');
  return value;
}
export function textValue(value, name, maximum = 2048) {
  if (typeof value !== 'string' || !value.length || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new NativeSourceError('INVALID_INPUT', name + ' must be a nonempty text value.', {field: name});
  return value;
}
export function integer(value, name, fallback, maximum) {
  const selected = value === undefined || value === null ? fallback : value;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) throw new NativeSourceError('INVALID_INPUT', name + ' is outside the supported native range.', {field: name, maximum});
  return selected;
}
export function originalJSON(response) {
  if (!response.bodyComplete) return {value: null, error: {code: 'INCOMPLETE_RESPONSE', message: 'The retained native response ended before the complete body was received.'}};
  try {
    const text = new TextDecoder('utf-8', {fatal: true}).decode(response.body);
    return {value: JSON.parse(text), error: null};
  } catch {
    return {value: null, error: {code: 'INVALID_NATIVE_JSON', message: 'The retained native response is not a complete UTF-8 JSON document.'}};
  }
}
export function errorResult(request, response, code, message, details = {}, value = null) {
  return {request, response, value, records: [], continuation: {done: true, next: null}, error: {code, message, details}};
}

export function createReadOnlyTransport(provider, connection = {}) {
  plain(connection, 'connection');
  let base;
  try { base = new URL(connection.baseUrl); } catch { throw new NativeSourceError('CONNECTION_REQUIRED', 'A valid native service baseUrl is required.'); }
  if (base.username || base.password || base.search || base.hash) throw new NativeSourceError('INVALID_CONNECTION', 'Keep credentials in private headers and use a base URL without userinfo, query, or fragment.');
  if (base.protocol !== 'https:' && !(connection.allowHttp === true && base.protocol === 'http:')) throw new NativeSourceError('INVALID_CONNECTION', 'The native connection requires HTTPS or explicit private allowHttp.');
  base.pathname = base.pathname.replace(/\/+$/, '') + '/';
  const network = normalizeNetwork(connection.network);
  const headers = new Headers(connection.headers || {});
  if (connection.token !== undefined || connection.apiKey !== undefined) {
    const token = textValue(connection.token ?? connection.apiKey, 'token', 16384);
    if (headers.has('authorization') && headers.get('authorization') !== 'Bearer ' + token) throw new NativeSourceError('INVALID_CONNECTION', 'The selected connection contains conflicting authorization headers.');
    headers.set('Authorization', 'Bearer ' + token);
  }
  if (connection.tenantName !== undefined) {
    const tenant = textValue(connection.tenantName, 'tenantName', 255);
    if (headers.has('SDP-Tenant-Name') && headers.get('SDP-Tenant-Name') !== tenant) throw new NativeSourceError('INVALID_CONNECTION', 'The selected connection contains conflicting tenant scopes.');
    headers.set('SDP-Tenant-Name', tenant);
  }
  if (connection.walletId !== undefined && connection.walletId !== null) {
    const wallet = textValue(connection.walletId, 'walletId', 255);
    if (headers.has('X-Wallet-Id') && headers.get('X-Wallet-Id') !== wallet) throw new NativeSourceError('INVALID_CONNECTION', 'The selected connection contains conflicting distribution account scopes.');
    headers.set('X-Wallet-Id', wallet);
  }
  headers.set('Accept', 'application/json');
  const timeoutMs = integer(connection.timeoutMs, 'timeoutMs', 30000, 300000);
  const maximumResponseBytes = integer(connection.maximumResponseBytes, 'maximumResponseBytes', 32 * 1024 * 1024, 256 * 1024 * 1024);
  const descriptor = Object.freeze({
    provider, network, origin: base.origin,
    basePathSha256: sourceHash(base.pathname),
    tenantName: provider === 'sdp' ? headers.get('SDP-Tenant-Name') : null,
    walletId: provider === 'sdp' ? headers.get('X-Wallet-Id') : null,
    id: sourceHash({provider, baseUrl: base.href, network,
      tenantName: provider === 'sdp' ? headers.get('SDP-Tenant-Name') : null,
      walletId: provider === 'sdp' ? headers.get('X-Wallet-Id') : null}),
  });
  function urlFor(pathname, query = {}) {
    const url = new URL(pathname.replace(/^\/+/, ''), base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new NativeSourceError('INVALID_ROUTE', 'The native read escaped the selected service.');
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    return url;
  }
  function continueURL(original, expected, changingKey, {minimum = null, order = 'asc'} = {}) {
    textValue(original, 'cursor', 16384);
    let next;
    try { next = new URL(original, expected); } catch { throw new NativeSourceError('INVALID_NATIVE_CURSOR', 'The original service returned an invalid next-page link.'); }
    if (next.username || next.password || next.hash || !['https:', 'http:'].includes(next.protocol)) throw new NativeSourceError('INVALID_NATIVE_CURSOR', 'The native next-page link contains unsupported URL components.');
    // The maintained Horizon SDK rebases protocol/host to the configured server.
    // Both providers still have to retain the exact selected endpoint and filters.
    if (next.pathname !== expected.pathname) throw new NativeSourceError('NATIVE_SELECTION_CHANGED', 'The original next-page link changed the selected endpoint.');
    const originalKeys = new Set([...expected.searchParams.keys(), changingKey]);
    for (const key of next.searchParams.keys()) if (!originalKeys.has(key) || next.searchParams.getAll(key).length !== 1) throw new NativeSourceError('NATIVE_SELECTION_CHANGED', 'The original next-page link changed the selected query.', {field: key});
    for (const [key, value] of expected.searchParams) {
      if (key !== changingKey && next.searchParams.get(key) !== value) throw new NativeSourceError('NATIVE_SELECTION_CHANGED', 'The original next-page link changed the selected query.', {field: key});
    }
    const cursor = next.searchParams.get(changingKey);
    if (cursor === null || cursor === '') throw new NativeSourceError('INVALID_NATIVE_CURSOR', 'The original next-page link has no native cursor.');
    if (minimum !== null) {
      if (!/^\d+$/.test(cursor)) throw new NativeSourceError('INVALID_NATIVE_CURSOR', 'The original service returned a nonnumeric native cursor.');
      const now = BigInt(cursor), before = BigInt(minimum);
      if (order === 'desc' ? now >= before : now <= before) throw new NativeSourceError('NATIVE_CURSOR_STALLED', 'The original next-page cursor did not advance.');
    }
    next.protocol = base.protocol;
    next.host = base.host;
    return next;
  }
  async function get(url, request, signal) {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const controller = new AbortController();
    let timer;
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, {once: true});
    timer = setTimeout(() => controller.abort(new Error('Native request timed out.')), timeoutMs);
    timer.unref?.();
    let status = 0, responseHeaders = {}, bodyComplete = false, failure = null, size = 0;
    const chunks = [];
    try {
      const response = await fetch(url, {method: 'GET', headers, redirect: 'manual', cache: 'no-store', signal: controller.signal});
      status = response.status;
      responseHeaders = Object.fromEntries(response.headers.entries());
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const {value, done} = await reader.read();
            if (done) { bodyComplete = true; break; }
            const chunk = Buffer.from(value);
            const remaining = maximumResponseBytes - size;
            if (chunk.length > remaining) {
              if (remaining > 0) { chunks.push(chunk.subarray(0, remaining)); size += remaining; }
              failure = {code: 'NATIVE_RESPONSE_TOO_LARGE', message: 'The native page exceeded the selected response byte limit.', details: {maximumResponseBytes}};
              await reader.cancel();
              break;
            }
            chunks.push(chunk); size += chunk.length;
          }
        } finally { reader.releaseLock(); }
      } else bodyComplete = true;
    } catch {
      failure = {code: signal?.aborted ? 'INTERRUPTED' : controller.signal.aborted ? 'NATIVE_TIMEOUT' : 'NATIVE_CONNECTION_ERROR', message: signal?.aborted ? 'The native read was interrupted.' : controller.signal.aborted ? 'The native read timed out.' : 'The native service read failed.', details: {}};
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
    const response = {status, headers: responseHeaders, body: Buffer.concat(chunks, size), bodyComplete,
      startedAt, observedAt: new Date().toISOString(), elapsedMs: Date.now() - started};
    if (failure) return errorResult(request, response, failure.code, failure.message, failure.details);
    const parsed = originalJSON(response);
    if (status < 200 || status >= 300) return errorResult(request, response, 'NATIVE_HTTP_ERROR', 'The native service returned HTTP ' + status + '.', {status, retryAfter: responseHeaders['retry-after'] || null}, parsed.value);
    if (parsed.error) return errorResult(request, response, parsed.error.code, parsed.error.message);
    return {request, response, value: parsed.value, records: [], continuation: {done: true, next: null}, error: null};
  }
  return {descriptor, urlFor, continueURL, get};
}
