// MIT. Open311 GeoReport v2 source client. Every civic endpoint operation is GET.
import { createHash } from 'node:crypto';

const DAY = 86_400_000;
const CORE_QUERY = new Set(['service_request_id', 'service_code', 'start_date', 'end_date', 'status']);
const EXTENSION_QUERY = new Set(['page', 'page_size', 'extensions']);
const RECEIPT_HEADERS = new Set(['content-type', 'content-length', 'content-encoding', 'date',
  'etag', 'last-modified', 'cache-control', 'retry-after', 'x-request-id',
  'x-correlation-id', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export class Open311Error extends Error {
  constructor(code, message, result = null) {
    super(message);
    this.name = 'Open311Error';
    this.code = code;
    this.result = result;
    this.receipt = result?.receipt ?? null;
    this.raw = result?.raw ?? null;
  }
  toJSON() {
    return { name: this.name, code: this.code, message: this.message,
      result: this.result, receipt: this.receipt };
  }
}

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(name + ' must be an object');
  return value;
}
function positive(value, fallback, name) {
  const result = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < 1)
    throw new TypeError(name + ' must be a positive integer');
  return result;
}
function identifier(value, name) {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw new TypeError(name + ' numeric identifier is not a safe integer; use a string');
  if (!['string', 'number'].includes(typeof value))
    throw new TypeError(name + ' must be a string');
  const result = String(value).trim();
  if (!result || /[\u0000-\u001f\u007f]/u.test(result))
    throw new TypeError(name + ' must be nonempty and contain no control characters');
  return result;
}
function list(value, name) {
  if (value == null || value === '') return [];
  const input = Array.isArray(value) ? value : [value];
  const result = input.flatMap(item => identifier(item, name).split(','))
    .map(item => item.trim()).filter(Boolean);
  return [...new Set(result)];
}
function names(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError(name + ' must be an array');
  return [...new Set(value.map(item => {
    const result = identifier(item, name);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(result))
      throw new TypeError(name + ' contains an invalid parameter name');
    return result;
  }))];
}
function endpoint(value, name, allowHttp) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError(name + ' must be an absolute URL'); }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:'))
    throw new TypeError(name + ' requires HTTPS, or explicit allowHttp for an HTTP endpoint');
  if (url.username || url.password || url.search || url.hash)
    throw new TypeError(name + ' must not contain credentials, a query or fragment');
  url.pathname = url.pathname.replace(/\/+$/u, '') || '/';
  return url;
}
function dateTime(value, name) {
  if (typeof value !== 'string') throw new TypeError(name + ' must be a timezone-qualified datetime');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) throw new TypeError(name + ' must include a date, time and timezone');
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const zone = match[7];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] ?? 0) > 59 ||
      (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)))
    throw new TypeError(name + ' contains an invalid calendar date, time or offset');
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) throw new TypeError(name + ' is not a supported datetime');
  return instant;
}
function scalar(value, key) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new TypeError(key + ' must be finite');
  if (!['string', 'number'].includes(typeof value))
    throw new TypeError(key + ' extension value must be a string, number or boolean');
  return String(value);
}

export function createClient(config, { fetchImpl = globalThis.fetch } = {}) {
  object(config, 'Open311 connection');
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
  const allowHttp = config.allowHttp === true;
  const base = endpoint(config.baseUrl, 'baseUrl', allowHttp);
  const discovery = config.discoveryUrl
    ? endpoint(config.discoveryUrl, 'discoveryUrl', allowHttp) : null;
  const jurisdiction = config.jurisdictionId == null || config.jurisdictionId === ''
    ? null : identifier(config.jurisdictionId, 'jurisdictionId');
  const apiKeyParameter = config.apiKeyParameter ?? 'api_key';
  if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(apiKeyParameter) ||
      CORE_QUERY.has(apiKeyParameter) || EXTENSION_QUERY.has(apiKeyParameter) ||
      apiKeyParameter === 'jurisdiction_id')
    throw new TypeError('Invalid apiKeyParameter');
  if (config.apiKey != null && config.apiKeyEnv)
    throw new TypeError('Choose apiKey or apiKeyEnv');
  let apiKey = config.apiKey == null ? null : String(config.apiKey);
  if (config.apiKeyEnv) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(config.apiKeyEnv))
      throw new TypeError('apiKeyEnv must name an environment variable');
    apiKey = process.env[config.apiKeyEnv];
    if (!apiKey) throw new Open311Error('CREDENTIAL_UNAVAILABLE', 'Configured API key environment variable is not set');
  }
  const timeoutMs = positive(config.timeoutMs, 30_000, 'timeoutMs');
  const maxResponseBytes = positive(config.maxResponseBytes, 16 * 1024 * 1024, 'maxResponseBytes');
  const responseLimit = positive(config.responseLimit, 1000, 'responseLimit');
  const statusValues = new Set(config.statusValues == null
    ? ['open', 'closed'] : list(config.statusValues, 'statusValues'));
  const queryExtensions = new Set(names(config.queryExtensions, 'queryExtensions'));
  for (const key of queryExtensions) {
    if (CORE_QUERY.has(key) || EXTENSION_QUERY.has(key) || key === 'jurisdiction_id' ||
        key === apiKeyParameter || /key|token|secret|password|signature|authorization/iu.test(key))
      throw new TypeError('queryExtensions must name noncredential provider-specific parameters');
  }
  const pagination = config.pagination === true;
  const extendedAttributes = config.extendedAttributes === true;

  function redactedUrl(value) {
    const result = new URL(value);
    result.username = ''; result.password = '';
    for (const key of [...result.searchParams.keys()]) {
      if (key === apiKeyParameter || /api.?key|access.?token|secret|password|signature|authorization|credential/iu.test(key))
        result.searchParams.set(key, '[redacted]');
    }
    return result.href;
  }
  function urlFor(resource, query = {}) {
    const url = new URL(base.href);
    url.pathname = base.pathname.replace(/\/+$/u, '') + '/' + resource;
    if (jurisdiction != null) url.searchParams.set('jurisdiction_id', jurisdiction);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    if (apiKey) url.searchParams.set(apiKeyParameter, apiKey);
    return url;
  }
  function extraQuery(query = {}, allowedCore = false) {
    object(query, 'query');
    const result = {};
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === '') continue;
      if (allowedCore && (CORE_QUERY.has(key) || EXTENSION_QUERY.has(key))) continue;
      if (!queryExtensions.has(key)) throw new TypeError('Unsupported query parameter: ' + key);
      result[key] = scalar(value, key);
    }
    return result;
  }
  function requestQuery(query = {}) {
    object(query, 'query');
    const ids = list(query.service_request_id, 'service_request_id');
    // GeoReport v2 ID selection supersedes its other request filters.
    if (ids.length) return { service_request_id: ids.join(',') };
    const result = extraQuery(query, true);
    const codes = list(query.service_code, 'service_code');
    if (codes.length) result.service_code = codes.join(',');
    const statuses = list(query.status, 'status');
    if (statuses.some(value => !statusValues.has(value)))
      throw new TypeError('Status is not declared in this connection statusValues');
    if (statuses.length) result.status = statuses.join(',');
    const start = query.start_date == null || query.start_date === '' ? null : dateTime(query.start_date, 'start_date');
    const end = query.end_date == null || query.end_date === '' ? null : dateTime(query.end_date, 'end_date');
    if (start != null && end != null && (end < start || end - start > 90 * DAY))
      throw new TypeError('Request date range must be ordered and span at most 90 days');
    if (start != null) result.start_date = query.start_date;
    if (end != null) result.end_date = query.end_date;
    if (query.page != null && query.page !== '' || query.page_size != null && query.page_size !== '') {
      if (!pagination) throw new TypeError('This connection has not declared the page/page_size extension');
      if (query.page != null && query.page !== '') result.page = String(positive(query.page, 1, 'page'));
      if (query.page_size != null && query.page_size !== '') result.page_size = String(positive(query.page_size, responseLimit, 'page_size'));
    }
    if (query.extensions != null && query.extensions !== '') {
      if (!extendedAttributes) throw new TypeError('This connection has not declared extended attributes');
      if (![true, false, 'true', 'false'].includes(query.extensions))
        throw new TypeError('extensions must be true or false');
      result.extensions = String(query.extensions);
    }
    return result;
  }
  async function readBytes(response) {
    const chunks = [];
    let length = 0;
    if (!response.body?.getReader) {
      try {
        const bytes = Buffer.from(await response.arrayBuffer());
        return { bytes: bytes.subarray(0, maxResponseBytes),
          complete: bytes.length <= maxResponseBytes,
          failure: bytes.length > maxResponseBytes ? 'RESPONSE_TOO_LARGE' : null };
      } catch {
        return { bytes: Buffer.alloc(0), complete: false, failure: 'BODY_READ_FAILED' };
      }
    }
    const reader = response.body.getReader();
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) return { bytes: Buffer.concat(chunks, length), complete: true, failure: null };
        const bytes = Buffer.from(part.value);
        const room = maxResponseBytes - length;
        if (bytes.length > room) {
          if (room > 0) { chunks.push(bytes.subarray(0, room)); length += room; }
          await reader.cancel().catch(() => {});
          return { bytes: Buffer.concat(chunks, length), complete: false, failure: 'RESPONSE_TOO_LARGE' };
        }
        chunks.push(bytes); length += bytes.length;
      }
    } catch {
      return { bytes: Buffer.concat(chunks, length), complete: false, failure: 'BODY_READ_FAILED' };
    } finally { reader.releaseLock(); }
  }
  async function get(url, { kind, query = {}, signal } = {}) {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let response;
    try {
      response = await fetchImpl(url.href, {
        method: 'GET', headers: { Accept: 'application/json' }, redirect: 'manual', signal: requestSignal,
      });
    } catch {
      const receipt = { method: 'GET', url: redactedUrl(url), status: null, statusText: '',
        headers: {}, startedAt, observedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - started), kind, query: structuredClone(query),
        state: requestSignal.aborted ? 'ABORTED' : 'TRANSPORT_FAILED' };
      clearTimeout(timer);
      throw new Open311Error(receipt.state, receipt.state === 'ABORTED'
        ? 'Open311 request was cancelled or timed out' : 'Open311 request could not receive an HTTP response',
      { value: null, raw: null, receipt });
    }
    try {
      const headers = {};
      for (const [key, value] of response.headers.entries()) {
        if (RECEIPT_HEADERS.has(key.toLowerCase())) headers[key.toLowerCase()] = value;
      }
      const body = await readBytes(response);
      const receipt = { method: 'GET', url: redactedUrl(url), status: response.status,
        statusText: response.statusText, headers, startedAt, observedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - started), kind, query: structuredClone(query),
        state: body.failure ?? (response.ok ? 'SUCCEEDED' : 'HTTP_ERROR') };
      const raw = { encoding: 'base64', body: body.bytes.toString('base64'),
        sha256: createHash('sha256').update(body.bytes).digest('hex'), bytes: body.bytes.length,
        complete: body.complete, contentType: headers['content-type'] ?? null };
      let value = null, parseFailed = false;
      if (body.complete) {
        try {
          value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body.bytes));
        } catch { parseFailed = true; }
      }
      const result = { value, raw, receipt };
      if (body.failure)
        throw new Open311Error(body.failure, 'Open311 response body was not received completely', result);
      if (!response.ok)
        throw new Open311Error('HTTP_ERROR', 'Open311 endpoint returned HTTP ' + response.status, result);
      if (parseFailed) {
        receipt.state = /(?:xml|html)/iu.test(raw.contentType ?? '') ? 'UNSUPPORTED_FORMAT' : 'INVALID_JSON';
        throw new Open311Error(receipt.state, 'Endpoint did not return a complete UTF-8 JSON document', result);
      }
      if (kind === 'requests') {
        const rows = Array.isArray(value) ? value
          : Array.isArray(value?.service_requests) ? value.service_requests
          : Array.isArray(value?.service_requests?.request) ? value.service_requests.request : null;
        const selectedIds = Boolean(query.service_request_id);
        const limit = query.page_size ? Math.min(Number(query.page_size), responseLimit) : responseLimit;
        receipt.coverage = { returned: rows?.length ?? null, documentedLimit: limit,
          mayBeTruncated: rows ? rows.length >= limit : null, singlePage: true,
          paginationDeclared: pagination, page: query.page ? Number(query.page) : null,
          rollingDateWindow: !selectedIds && !(query.start_date && query.end_date),
          defaultWindowDays: 90 };
      }
      return result;
    } finally { clearTimeout(timer); }
  }

  return Object.freeze({
    services: (query = {}, options = {}) => get(urlFor('services.json', extraQuery(query)),
      { ...options, kind: 'services', query: extraQuery(query) }),
    service: (code, query = {}, options = {}) => get(
      urlFor('services/' + encodeURIComponent(identifier(code, 'service_code')) + '.json', extraQuery(query)),
      { ...options, kind: 'service', query: extraQuery(query) }),
    requests: (query = {}, options = {}) => {
      const selected = requestQuery(query);
      return get(urlFor('requests.json', selected), { ...options, kind: 'requests', query: selected });
    },
    request: (id, query = {}, options = {}) => {
      const extra = extraQuery(query, true);
      for (const key of Object.keys(query)) {
        if (CORE_QUERY.has(key) || (EXTENSION_QUERY.has(key) && key !== 'extensions'))
          throw new TypeError('Single request selection accepts only declared representation extensions');
      }
      if (query.extensions != null && query.extensions !== '') {
        if (!extendedAttributes || ![true, false, 'true', 'false'].includes(query.extensions))
          throw new TypeError('A declared boolean extended attributes option is required');
        extra.extensions = String(query.extensions);
      }
      return get(urlFor('requests/' + encodeURIComponent(identifier(id, 'service_request_id')) + '.json', extra),
        { ...options, kind: 'request', query: extra });
    },
    token: (id, query = {}, options = {}) => get(
      urlFor('tokens/' + encodeURIComponent(identifier(id, 'token')) + '.json', extraQuery(query)),
      { ...options, kind: 'token', query: extraQuery(query) }),
    discovery: (options = {}) => {
      if (!discovery) throw new TypeError('Set the exact provider discoveryUrl to retrieve discovery');
      const url = new URL(discovery.href);
      if (url.pathname.endsWith('/discovery')) url.pathname += '.json';
      return get(url, { ...options, kind: 'discovery' });
    },
  });
}
