// MIT. Node 22+. Existing-API application handler for the original SF30 runtime.
// This module performs no payment verification, settlement, signature or retry.
import { request as httpRequest, validateHeaderName, validateHeaderValue } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import { compileResponseContract } from './response-contract.mjs';
import { canonicalOperationJSON, operationRequestHash } from './upstream-idempotency.mjs';
import { supportsSellerMethod, requiresJsonBody } from './http-methods.mjs';

// Private per-invocation metadata. Never serialized into a response or retained in
// operation state; lets availability distinguish a real backend call from replay.
export const UPSTREAM_ATTEMPT = Symbol('sf30.upstream.attempt');

const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length', 'host', 'expect']);
const CREDENTIAL = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'api-key', 'apikey']);
const OWNED = new Set(['accept-encoding', 'content-encoding', 'content-type']);
const payment = name => /^(?:payment-|x-payment(?:-|$)|x402-|extension-responses$|settlement-overrides$)/.test(name);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x));
const failure = (status, error, upstreamStatus) => ({ status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: { error, ...(upstreamStatus === undefined ? {} : { upstreamStatus }) } });
const integer = (n, min, max, name) => {
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new TypeError(`Invalid ${name}`);
  return n;
};
function headerList(value, response = false) {
  if (!Array.isArray(value) || value.length > 32) throw new TypeError('Expected header-name array');
  const result = new Set();
  for (const name of value) {
    if (typeof name !== 'string') throw new TypeError('Invalid header name');
    const key = name.toLowerCase();
    validateHeaderName(key);
    if (HOP.has(key) || CREDENTIAL.has(key) || payment(key) ||
        (OWNED.has(key) && !(response && key === 'content-type')) ||
        /^(?:proxy-|forwarded$|x-forwarded-|sec-)/.test(key)) {
      throw new TypeError(`Reserved forwarded header: ${key}`);
    }
    result.add(key);
  }
  return Object.freeze([...result]);
}
function connectionTokens(headers) {
  const value = headers.connection;
  return new Set((Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : '')
    .split(',').map(name => name.trim().toLowerCase()).filter(Boolean));
}
function serverHeaders(value) {
  if (!object(value)) throw new TypeError('Server headers must be a plain object');
  const result = Object.create(null);
  for (const [name, val] of Object.entries(value)) {
    const key = name.toLowerCase();
    validateHeaderName(key);
    if (HOP.has(key) || OWNED.has(key) || payment(key) || key === 'set-cookie' ||
        /^(?:proxy-|forwarded$|x-forwarded-|sec-)/.test(key) || Object.hasOwn(result, key)) {
      throw new TypeError('Reserved or duplicate server header');
    }
    if (typeof val !== 'string' || val.length > 8192) throw new TypeError('Invalid server header value');
    validateHeaderValue(key, val);
    result[key] = val;
  }
  if (Object.keys(result).length > 32) throw new TypeError('Too many server headers');
  return Object.freeze(result);
}
function compileTarget(baseUrl, path, allowLocal) {
  if (typeof baseUrl !== 'string' || baseUrl !== baseUrl.trim()) throw new TypeError('baseUrl required');
  const base = new URL(baseUrl);
  const local = allowLocal && base.protocol === 'http:' &&
    ['127.0.0.1', '[::1]', 'localhost'].includes(base.hostname);
  if ((!local && base.protocol !== 'https:') || base.username || base.password || base.search || base.hash) {
    throw new TypeError('Upstream requires a trusted HTTPS base URL; explicit loopback HTTP is development-only');
  }
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('//')) {
    throw new TypeError('Upstream path must be an absolute path template, not a URL');
  }
  const parts = path.slice(1).split('/');
  for (const part of parts) {
    if (!/^(?:[A-Za-z0-9._~-]*|:[A-Za-z_][A-Za-z0-9_]*)$/.test(part) || ['.', '..'].includes(part)) {
      throw new TypeError('Use literal path segments or whole :parameter segments');
    }
  }
  const prefix = base.pathname.replace(/\/$/, '');
  return context => {
    const segments = parts.map(part => {
      if (!part.startsWith(':')) return part;
      const name = part.slice(1), params = context.pathParams;
      const value = object(params) && Object.hasOwn(params, name) ? params[name] : undefined;
      if (typeof value !== 'string' || !value || value.length > 512 || ['.', '..'].includes(value) ||
          /[\x00-\x1f\x7f/%\\?#]/.test(value)) throw new TypeError('Invalid upstream path parameter');
      return encodeURIComponent(value);
    });
    const expected = `${prefix}/${segments.join('/')}`;
    const target = new URL(expected, base.origin);
    if (target.origin !== base.origin || target.pathname !== expected) throw new TypeError('Invalid upstream target');
    return target;
  };
}
function queryMapping(value) {
  const pairs = Array.isArray(value) ? value.map(name => [name, name]) : object(value) ? Object.entries(value) : null;
  if (!pairs || pairs.length > 64) throw new TypeError('query must be a name array or source-to-upstream mapping');
  const result = new Map(), outputs = new Set();
  for (const [source, target] of pairs) {
    if (typeof source !== 'string' || typeof target !== 'string' ||
        !/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(source) || !/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(target) ||
        result.has(source) || outputs.has(target)) throw new TypeError('Invalid or ambiguous query mapping');
    result.set(source, target); outputs.add(target);
  }
  return result;
}

/**
 * Create an SF30 application handler for one operator-owned upstream operation.
 * Invoke only through the existing seller payment gate. Config is trusted local
 * code, never a buyer parameter or an automatically accepted discovery listing.
 */
export function createUpstreamHandler(options = {}) {
  if (!object(options)) throw new TypeError('Upstream options must be a plain object');
  const known = new Set(['baseUrl', 'path', 'method', 'query', 'headers', 'requestHeaders',
    'responseHeaders', 'responseType', 'timeoutMs', 'maxRequestBytes', 'maxResponseBytes',
    'maxInFlight', 'allowLocal', 'lookup', 'onResult', 'responseContract', 'idempotency']);
  for (const key of Object.keys(options)) if (!known.has(key)) throw new TypeError(`Unknown upstream option: ${key}`);
  const { baseUrl, path, method = 'GET', query = [], headers: configuredHeaders = {},
    requestHeaders = [], responseHeaders = ['content-type', 'content-language'], responseType = 'json',
    timeoutMs = 10000, maxRequestBytes = 1048576, maxResponseBytes = 1048576,
    maxInFlight = 16, allowLocal = false, lookup, onResult, responseContract, idempotency } = options;
  if (!supportsSellerMethod(method) || !['json', 'bytes'].includes(responseType) || typeof allowLocal !== 'boolean' ||
      onResult !== undefined && typeof onResult !== 'function' ||
      lookup !== undefined && typeof lookup !== 'function') throw new TypeError('Invalid upstream options');
  integer(timeoutMs, 1, 120000, 'timeoutMs');
  integer(maxRequestBytes, 1, 16 * 1048576, 'maxRequestBytes');
  integer(maxResponseBytes, 1, 16 * 1048576, 'maxResponseBytes');
  integer(maxInFlight, 1, 256, 'maxInFlight');
  const targetFor = compileTarget(baseUrl, path, allowLocal), queries = queryMapping(query);
  const forward = headerList(requestHeaders), expose = headerList(responseHeaders, true);
  if (responseContract !== undefined && (responseType !== 'json' || !expose.includes('content-type')))
    throw new TypeError('A response contract requires JSON mode and exposed content-type');
  const responseCheck = responseContract === undefined ? null : compileResponseContract(responseContract, { method });
  // Static credentials are copied at construction; a synchronous factory reads
  // freshly rotated environment credentials on each request without buyer input.
  const staticHeaders = typeof configuredHeaders === 'function' ? null : serverHeaders(configuredHeaders);
  if (idempotency !== undefined) {
    if (!object(idempotency) || method !== 'POST' || typeof idempotency.scope !== 'string' ||
        !object(idempotency.operations) || ['issue','admit','execute','inspect','recover'].some(k => typeof idempotency.operations[k] !== 'function') ||
        typeof idempotency.requestHeader !== 'string' || typeof idempotency.backendHeader !== 'string') {
      throw new TypeError('Idempotency requires a configured POST operation controller');
    }
    headerList([idempotency.requestHeader, idempotency.backendHeader]);
    if (idempotency.requestHeader !== idempotency.requestHeader.toLowerCase() ||
        idempotency.backendHeader !== idempotency.backendHeader.toLowerCase() ||
        idempotency.requestHeader === idempotency.backendHeader ||
        forward.includes(idempotency.requestHeader) || forward.includes(idempotency.backendHeader) ||
        staticHeaders && (Object.hasOwn(staticHeaders,idempotency.requestHeader) || Object.hasOwn(staticHeaders,idempotency.backendHeader))) {
      throw new TypeError('Operation ticket and backend idempotency headers are server-owned');
    }
  }
  const totals = { started: 0, completed: 0, inFlight: 0, failed: 0, timedOut: 0, responseBytes: 0 };
  function prepare(context) {
    if (!object(context) || context.method !== method) throw new TypeError('Method mismatch');
    const target = targetFor(context);
    if (!(context.url instanceof URL)) throw new TypeError('SF30 application URL required');
    for (const [key, value] of context.url.searchParams) {
      if (!queries.has(key)) throw new TypeError('Undeclared query parameter');
      target.searchParams.append(queries.get(key), value);
    }
    if (target.href.length > 8192) throw new TypeError('Upstream target too long');
    const outgoing = Object.create(null);
    const incoming = object(context.headers) ? context.headers : {};
    const incomingHop = connectionTokens(incoming);
    for (const key of forward) {
      if (incomingHop.has(key)) continue;
      const value = incoming[key];
      if (value === undefined) continue;
      if (typeof value !== 'string' || value.length > 8192) throw new TypeError('Invalid forwarded header');
      validateHeaderValue(key, value); outgoing[key] = value;
    }
    let body;
    if (requiresJsonBody(method)) {
      const encoded = idempotency ? canonicalOperationJSON(context.body) : JSON.stringify(context.body);
      if (encoded === undefined) throw new TypeError('Replayable JSON body required');
      body = Buffer.from(encoded);
      if (body.length > maxRequestBytes) throw new TypeError('Upstream request body too large');
    }
    const operation = idempotency ? {
      ticket: incomingHop.has(idempotency.requestHeader) ? undefined : incoming[idempotency.requestHeader],
      requestHash: operationRequestHash({scope:idempotency.scope,method,sourceUrl:context.url.href,
        targetUrl:target.href,headers:outgoing,body}),
    } : undefined;
    return { target, outgoing, body, operation };
  }
  function exchange({ target, outgoing, body }, signal) {
    return new Promise(resolve => {
      let request, response, decoded, timer, done = false, dispatched = false, count = 0, wire = 0;
      const chunks = [];
      const aborted = () => bad(499, 'UPSTREAM_ABORTED');
      function finish(result, outcome = 'COMPLETE') {
        if (done) return;
        done = true; clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
        // Stop both compressed and decoded streams immediately on any limit,
        // timeout or error. No drain, retry, redirect or uncertain request replay.
        decoded?.destroy(); response?.destroy(); request?.destroy();
        resolve({response:result,outcome,error:result.body?.error});
      }
      const bad = (status, code, upstreamStatus) => finish(failure(status, code, upstreamStatus),
        dispatched ? 'UNCERTAIN' : 'NOT_DISPATCHED');
      try {
        if (signal?.aborted) return aborted();
        signal?.addEventListener('abort', aborted, {once:true});
        dispatched = true;
        request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
          method, headers: outgoing, maxHeaderSize: 16384, agent: false,
          ...(lookup === undefined ? {} : { lookup }),
        }, res => {
          response = res;
          res.on('error', () => bad(502, 'UPSTREAM_RESPONSE_INCOMPLETE'));
          res.on('aborted', () => bad(502, 'UPSTREAM_RESPONSE_INCOMPLETE'));
          const status = res.statusCode, responseHop = connectionTokens(res.headers);
          if (status >= 300 && status < 400) return bad(502, 'UPSTREAM_REDIRECT_REFUSED', status);
          if (status === 402) return bad(502, 'UPSTREAM_PAYMENT_REQUIRED', status);
          if (status === 401 || status === 403) return bad(502, 'UPSTREAM_AUTH_FAILED', status);
          if (status < 200 || status > 599 || status === 206) return bad(502, 'UPSTREAM_STATUS_UNSUPPORTED', status);
          if (status >= 400) {
            const result = failure(status, 'UPSTREAM_REQUEST_FAILED', status);
            const retryAfter = res.headers['retry-after'];
            if ((status === 429 || status === 503) && !responseHop.has('retry-after') && typeof retryAfter === 'string' && retryAfter.length <= 128 &&
                (/^\d+$/.test(retryAfter) || Number.isFinite(Date.parse(retryAfter)))) result.headers['retry-after'] = retryAfter;
            return finish(result);
          }
          const resultHeaders = Object.create(null);
          for (const key of expose) {
            if (responseHop.has(key)) continue;
            const value = res.headers[key];
            if (typeof value === 'string' && value.length <= 8192) resultHeaders[key] = value;
          }
          if (method === 'HEAD' || status === 204 || status === 205) {
            res.resume();
            res.once('end', () => {
              if (!res.complete) return bad(502, 'UPSTREAM_RESPONSE_INCOMPLETE');
              const body = Buffer.alloc(0), error = responseCheck?.validate({ status, body });
              if (error) return bad(502, error, status);
              finish({ status, headers: resultHeaders, body });
            });
            return;
          }
          if (responseType === 'json' && !/^application\/(?:[\w!#$&^.+-]+\+)?json(?:\s*;|$)/i.test(res.headers['content-type'] ?? '')) {
            return bad(502, 'UPSTREAM_CONTENT_TYPE_UNEXPECTED');
          }
          const encoding = String(res.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
          if (!['identity', 'gzip', 'deflate', 'br'].includes(encoding)) return bad(502, 'UPSTREAM_ENCODING_UNSUPPORTED');
          const length = res.headers['content-length'];
          if (length !== undefined && (!/^\d+$/.test(length) || BigInt(length) > BigInt(maxResponseBytes))) {
            return bad(502, 'UPSTREAM_RESPONSE_TOO_LARGE');
          }
          res.on('data', chunk => { wire += chunk.length; if (wire > maxResponseBytes) bad(502, 'UPSTREAM_RESPONSE_TOO_LARGE'); });
          decoded = encoding === 'identity' ? res : encoding === 'gzip' ? createGunzip() :
            encoding === 'deflate' ? createInflate() : createBrotliDecompress();
          decoded.on('error', () => bad(502, 'UPSTREAM_RESPONSE_INCOMPLETE'));
          decoded.on('data', chunk => {
            if (done) return;
            count += chunk.length;
            if (count > maxResponseBytes) return bad(502, 'UPSTREAM_RESPONSE_TOO_LARGE');
            chunks.push(chunk);
          });
          decoded.once('end', () => {
            if (done) return;
            if (!res.complete) return bad(502, 'UPSTREAM_RESPONSE_INCOMPLETE');
            const content = Buffer.concat(chunks, count);
            let value;
            if (responseType === 'json') {
              try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)); }
              catch { return bad(502, 'UPSTREAM_JSON_INVALID'); }
            }
            const contractError = responseCheck?.validate({ status, body: content, value,
              contentType: responseHop.has('content-type') ? undefined : res.headers['content-type'] });
            if (contractError) return bad(502, contractError, status);
            finish({ status, headers: resultHeaders, body: content });
          });
          if (decoded !== res) res.pipe(decoded);
        });
        request.on('error', () => bad(502, 'UPSTREAM_UNAVAILABLE'));
        request.on('upgrade', (_res, socket) => { socket.destroy(); bad(502, 'UPSTREAM_STATUS_UNSUPPORTED'); });
        timer = setTimeout(() => bad(504, 'UPSTREAM_TIMEOUT'), timeoutMs);
        request.end(body);
      } catch { bad(502, 'UPSTREAM_UNAVAILABLE'); }
    });
  }
  function storedResponseError(response) {
    if (!responseCheck || response?.status < 200 || response?.status > 299) return null;
    let body, value;
    try {
      body = Buffer.isBuffer(response.body) || response.body instanceof Uint8Array ? Buffer.from(response.body) :
        Buffer.from(typeof response.body === 'string' ? response.body : canonicalOperationJSON(response.body ?? null));
      if (body.length && ![204,205].includes(response.status)) value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));
    } catch { return 'UPSTREAM_RESPONSE_CONTRACT_BODY'; }
    const contentType = Object.entries(response.headers ?? {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1];
    return responseCheck.validate({status:response.status,contentType,body,value});
  }
  async function upstreamHandler(context) {
    let prepared, attempt;
    try { prepared = prepare(context); }
    catch { return failure(400, 'UPSTREAM_REQUEST_INVALID'); }
    try {
      const trustedHeaders = staticHeaders ?? serverHeaders(configuredHeaders());
      if (idempotency && (Object.hasOwn(trustedHeaders,idempotency.requestHeader) || Object.hasOwn(trustedHeaders,idempotency.backendHeader))) {
        throw new TypeError('Operation headers cannot be supplied as credentials');
      }
      Object.assign(prepared.outgoing, trustedHeaders);
      prepared.outgoing['accept-encoding'] = 'gzip, deflate, br';
      prepared.outgoing.accept ??= responseType === 'json' ? 'application/json' : '*/*';
      if (prepared.body !== undefined) {
        prepared.outgoing['content-type'] = 'application/json; charset=utf-8';
        prepared.outgoing['content-length'] = String(prepared.body.length);
      }
    } catch { return failure(503, 'UPSTREAM_CONFIGURATION_UNAVAILABLE'); }
    async function perform({backendKey} = {}) {
      if (totals.inFlight >= maxInFlight) return {outcome:'NOT_DISPATCHED',
        response:failure(503,'UPSTREAM_CAPACITY_EXHAUSTED'),error:'UPSTREAM_CAPACITY_EXHAUSTED'};
      if (backendKey !== undefined) prepared.outgoing[idempotency.backendHeader] = backendKey;
      totals.started++; totals.inFlight++;
      const began = performance.now();
      const result = await exchange(prepared, context.signal);
      attempt = Object.freeze({dispatched:result.outcome !== 'NOT_DISPATCHED',
        status:result.response.status,error:result.response.body?.error ?? null,
        upstreamStatus:result.response.body?.upstreamStatus ?? null});
      totals.inFlight--; totals.completed++;
      if (result.response.status >= 400) totals.failed++;
      if (result.response.body?.error === 'UPSTREAM_TIMEOUT') totals.timedOut++;
      const bytes = Buffer.isBuffer(result.response.body) ? result.response.body.length : 0;
      totals.responseBytes += bytes;
      if (onResult) {
        const event = Object.freeze({ method, status: result.response.status, responseBytes: bytes,
          durationMs: Math.round(performance.now() - began), error: result.response.body?.error ?? null });
        try { Promise.resolve(onResult(event)).catch(() => {}); } catch { /* telemetry cannot change delivery */ }
      }
      return result;
    }
    let result = idempotency ? await idempotency.operations.execute({...prepared.operation,signal:context.signal},perform) :
      (await perform()).response;
    // Recovered results and prior-version stored results remain subject to the
    // active original response contract. A mismatch never repeats the mutation.
    const contractError = idempotency ? storedResponseError(result) : null;
    if (contractError) result = failure(502,contractError,result.status);
    Object.defineProperty(result,UPSTREAM_ATTEMPT,{value:attempt ?? Object.freeze({dispatched:false})});
    return result;
  }
  // No URL, credential, request or response payload is retained in diagnostics.
  upstreamHandler.snapshot = () => Object.freeze({ ...totals,
    ...(idempotency ? {idempotency:idempotency.operations.snapshot()} : {}) });
  if (idempotency) {
    upstreamHandler.admit = context => {
      let prepared;
      try { prepared = prepare(context); } catch { return failure(400,'UPSTREAM_REQUEST_INVALID'); }
      return idempotency.operations.admit(prepared.operation);
    };
    upstreamHandler.idempotency = Object.freeze({
      issue(context, options) { const prepared = prepare(context); return idempotency.operations.issue({...options,requestHash:prepared.operation.requestHash}); },
      inspect:idempotency.operations.inspect,
      recover(options) {
        if (options?.action === 'complete') {
          const response = options.response;
          for (const [name,value] of Object.entries(response?.headers ?? {})) {
            const key = name.toLowerCase();
            const retryAfter = key === 'retry-after' && [429,503].includes(response.status) &&
              typeof value === 'string' && value.length <= 128 &&
              (/^\d+$/.test(value) || Number.isFinite(Date.parse(value)));
            if (!expose.includes(key) && !retryAfter) throw new TypeError('Recovery headers must match configured upstream responseHeaders');
            validateHeaderValue(key,value);
          }
        }
        const error = options?.action === 'complete' ? storedResponseError(options.response) : null;
        if (error) throw new TypeError('Recovered response violates configured upstream contract: ' + error);
        return idempotency.operations.recover(options);
      },
      close:idempotency.operations.close,
    });
  }
  return upstreamHandler;
}

