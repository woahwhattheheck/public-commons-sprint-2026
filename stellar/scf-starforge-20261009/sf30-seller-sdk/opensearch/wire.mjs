// MIT. Preserve native long/sort tokens while using ordinary Node HTTP and TLS.
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export class NativeInteger {
  constructor(token) {
    if (typeof token !== 'string' || !/^-?(?:0|[1-9]\d*)$/.test(token) || token.length > 128)
      throw new TypeError('OPENSEARCH_INTEGER_TOKEN_INVALID');
    this.token = token;
    Object.freeze(this);
  }
}
export class OpenSearchSourceError extends Error {
  constructor(code, query, upstreamStatus) {
    super(code); this.name = 'OpenSearchSourceError'; this.code = code;
    if (query) this.query = query;
    if (Number.isInteger(upstreamStatus)) this.upstreamStatus = upstreamStatus;
  }
}
export function fail(code, query, status) { throw new OpenSearchSourceError(code, query, status); }
export function assertLosslessJSONSupport() {
  let token;
  JSON.parse('9007199254740993', (_key, _value, context) => { token = context?.source; });
  if (token !== '9007199254740993') fail('OPENSEARCH_JSON_SOURCE_SUPPORT_REQUIRED');
}
export function parseNativeJSON(text) {
  return JSON.parse(text, (_key, value, context) => {
    if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
      if (!context?.source || !/^-?(?:0|[1-9]\d*)$/.test(context.source))
        fail('OPENSEARCH_UNSAFE_NUMERIC_ENCODING');
      return new NativeInteger(context.source);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) fail('OPENSEARCH_UNSAFE_NUMERIC_ENCODING');
    return value;
  });
}
// NativeInteger is constructed only from validated JSON number tokens and
// declared Int64 values. Never interpolate caller strings into a JSON document.
export function nativeJSON(value) {
  if (value instanceof NativeInteger) return value.token;
  if (value === null || ['string', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(nativeJSON).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).map(([key, item]) =>
    JSON.stringify(key) + ':' + nativeJSON(item)).join(',') + '}';
  throw new TypeError('OPENSEARCH_JSON_VALUE_INVALID');
}
export function portableJSON(value) {
  const paths = [];
  const escape = key => String(key).replace(/~/g, '~0').replace(/\//g, '~1');
  function visit(item, path) {
    if (item instanceof NativeInteger) { paths.push(path); return item.token; }
    if (Array.isArray(item)) return item.map((child, index) => visit(child, path + '/' + index));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) =>
      [key, visit(child, path + '/' + escape(key))]));
    return item;
  }
  return { value: visit(value, ''), exactIntegerPaths: paths };
}
export function resolveConnection(config, env) {
  const endpoint = env[config.endpointEnv];
  if (typeof endpoint !== 'string' || !endpoint || endpoint.length > 2048 || endpoint.trim() !== endpoint)
    fail('OPENSEARCH_ENDPOINT_ENV_UNAVAILABLE');
  let url;
  try { url = new URL(endpoint); } catch { fail('OPENSEARCH_ENDPOINT_INVALID'); }
  const local = config.allowLocal === true && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash ||
      !/^\/(?:[A-Za-z0-9_.~-]+\/)*$/.test(url.pathname)) fail('OPENSEARCH_ENDPOINT_INVALID');
  const headers = { accept: 'application/json', 'accept-encoding': 'identity' };
  function secret(name, empty = false) {
    const value = env[name];
    if (typeof value !== 'string' || (!empty && !value) || value.length > 8192 || /[\x00-\x1f\x7f]/.test(value))
      fail('OPENSEARCH_AUTH_ENV_UNAVAILABLE');
    return value;
  }
  if (config.auth.type === 'basic') {
    const user = secret(config.auth.userEnv);
    if (user.includes(':')) fail('OPENSEARCH_AUTH_ENV_INVALID');
    headers.authorization = 'Basic ' + Buffer.from(user + ':' + secret(config.auth.passwordEnv, true)).toString('base64');
  } else if (config.auth.type === 'bearer') headers.authorization = 'Bearer ' + secret(config.auth.tokenEnv);
  return { endpoint: url, headers };
}
export function createWire(connection) {
  return function requestJSON(method, path, { body, signal, timeoutMs = 15000, maxBytes = 1048576 } = {}) {
    const target = new URL(path.replace(/^\//, ''), connection.endpoint);
    if (target.origin !== connection.endpoint.origin || !target.pathname.startsWith(connection.endpoint.pathname))
      return Promise.reject(new OpenSearchSourceError('OPENSEARCH_REQUEST_TARGET_INVALID'));
    let bytes;
    try { bytes = body === undefined ? undefined : Buffer.from(nativeJSON(body)); }
    catch (issue) { return Promise.reject(issue); }
    if (bytes && bytes.length > 262144) return Promise.reject(new OpenSearchSourceError('OPENSEARCH_REQUEST_TOO_LARGE'));
    return new Promise((resolve, reject) => {
      let request, response, done = false, timer, count = 0;
      const chunks = [];
      const aborted = () => finish(new OpenSearchSourceError(signal?.reason?.code === 'QUERY_TIMEOUT' ? 'QUERY_TIMEOUT' : 'QUERY_ABORTED'));
      function finish(issue, value) {
        if (done) return; done = true;
        clearTimeout(timer); signal?.removeEventListener('abort', aborted);
        response?.destroy(); request?.destroy();
        issue ? reject(issue) : resolve(value);
      }
      if (signal?.aborted) { aborted(); return; }
      signal?.addEventListener('abort', aborted, { once: true });
      timer = setTimeout(() => finish(new OpenSearchSourceError('QUERY_TIMEOUT')), timeoutMs);
      timer.unref?.();
      try {
        request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
          method, agent: false, maxHeaderSize: 16384,
          headers: { ...connection.headers, ...(bytes ? { 'content-type': 'application/json', 'content-length': String(bytes.length) } : {}) },
        }, res => {
          response = res;
          const status = res.statusCode;
          if (status !== 200) return finish(new OpenSearchSourceError(
            status === 401 || status === 403 ? 'OPENSEARCH_AUTH_FAILED' :
            status === 429 ? 'OPENSEARCH_RATE_LIMITED' : 'OPENSEARCH_REQUEST_FAILED', undefined, status));
          if (!/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(String(res.headers['content-type'] ?? '')) ||
              !['', 'identity'].includes(String(res.headers['content-encoding'] ?? '').toLowerCase()))
            return finish(new OpenSearchSourceError('OPENSEARCH_RESPONSE_FORMAT_INVALID'));
          const declared = res.headers['content-length'];
          if (declared !== undefined && (!/^\d+$/.test(declared) || BigInt(declared) > BigInt(maxBytes)))
            return finish(new OpenSearchSourceError('QUERY_RESULT_TOO_LARGE'));
          res.on('error', () => finish(new OpenSearchSourceError('OPENSEARCH_RESPONSE_INCOMPLETE')));
          res.on('aborted', () => finish(new OpenSearchSourceError('OPENSEARCH_RESPONSE_INCOMPLETE')));
          res.on('data', chunk => {
            count += chunk.length;
            if (count > maxBytes) { finish(new OpenSearchSourceError('QUERY_RESULT_TOO_LARGE')); return; }
            chunks.push(chunk);
          });
          res.on('end', () => {
            if (done) return;
            if (!res.complete) { finish(new OpenSearchSourceError('OPENSEARCH_RESPONSE_INCOMPLETE')); return; }
            try { finish(null, parseNativeJSON(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, count)))); }
            catch (issue) { finish(issue instanceof OpenSearchSourceError ? issue : new OpenSearchSourceError('OPENSEARCH_RESPONSE_INVALID')); }
          });
        });
        request.on('error', () => finish(new OpenSearchSourceError('OPENSEARCH_UNAVAILABLE')));
        request.on('upgrade', (_response, socket) => { socket.destroy(); finish(new OpenSearchSourceError('OPENSEARCH_RESPONSE_INVALID')); });
        request.end(bytes);
      } catch { finish(new OpenSearchSourceError('OPENSEARCH_UNAVAILABLE')); }
    });
  };
}
